use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use super::event::{normalize, FsEvent};

/// Debounce interval — 150 ms as per spec.
const DEBOUNCE_MS: u64 = 150;
/// Broadcast channel capacity per watcher root.
const BROADCAST_CAP: usize = 256;

struct WatcherHandle {
    tx: broadcast::Sender<FsEvent>,
    refcount: usize,
    /// Keeps the debouncer alive. Drop = stop watcher.
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// Shared, refcounted file-system watcher registry.
///
/// One recursive watcher per workspace root, created on first subscriber,
/// dropped on last unsubscribe. Clone is cheap — Arc-backed.
#[derive(Clone, Default)]
pub struct FsWatcherManager {
    inner: Arc<Mutex<HashMap<PathBuf, WatcherHandle>>>,
}

impl FsWatcherManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribe to FS events for `root`.
    ///
    /// Spawns a watcher if none exists for this root. Returns a broadcast
    /// receiver. Errors only if notify fails to watch the path.
    pub fn subscribe(
        &self,
        root: &Path,
    ) -> Result<broadcast::Receiver<FsEvent>, notify::Error> {
        let mut map = self.inner.lock().unwrap_or_else(|p| p.into_inner());

        if let Some(handle) = map.get_mut(root) {
            handle.refcount += 1;
            debug!(root = %root.display(), refcount = handle.refcount, "watcher ref++");
            return Ok(handle.tx.subscribe());
        }

        let (tx, _) = broadcast::channel(BROADCAST_CAP);
        let tx_clone = tx.clone();

        let debouncer = notify_debouncer_full::new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    let normalized = normalize(events);
                    for ev in normalized {
                        // Ignore send errors — no subscribers is fine.
                        let _ = tx_clone.send(ev);
                    }
                }
                Err(errors) => {
                    for e in errors {
                        warn!(error = %e, "watcher error");
                    }
                }
            },
        )?;

        // In notify-debouncer-full 0.4, Debouncer implements Watcher directly.
        {
            let mut d = debouncer;
            d.watch(root, notify::RecursiveMode::Recursive)?;

            let rx = tx.subscribe();
            map.insert(
                root.to_path_buf(),
                WatcherHandle { tx, refcount: 1, _debouncer: d },
            );
            debug!(root = %root.display(), "watcher spawned, refcount=1");
            return Ok(rx);
        }
    }

    /// Release a subscription for `root`.
    ///
    /// Decrements refcount. Drops the watcher when refcount reaches zero.
    pub fn release(&self, root: &Path) {
        let mut map = self.inner.lock().unwrap_or_else(|p| p.into_inner());

        if let Some(handle) = map.get_mut(root) {
            handle.refcount = handle.refcount.saturating_sub(1);
            debug!(root = %root.display(), refcount = handle.refcount, "watcher ref--");
            if handle.refcount == 0 {
                map.remove(root);
                debug!(root = %root.display(), "watcher dropped (refcount=0)");
            }
        }
    }

    /// Current refcount for a root — for tests.
    #[cfg(test)]
    pub fn refcount(&self, root: &Path) -> usize {
        self.inner
            .lock()
            .expect("FsWatcherManager poisoned")
            .get(root)
            .map(|h| h.refcount)
            .unwrap_or(0)
    }
}
