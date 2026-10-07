use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use super::event::{normalize, FsEvent};
use super::FsError;

/// Debounce interval — 150 ms as per spec.
const DEBOUNCE_MS: u64 = 150;
/// Broadcast channel capacity per watcher root.
const BROADCAST_CAP: usize = 256;

#[cfg(unix)]
type DirectoryObjectId = (u64, u64);
#[cfg(windows)]
type DirectoryObjectId = crate::utils::fs::WindowsFileIdentity;
#[cfg(not(any(unix, windows)))]
type DirectoryObjectId = ();

/// The open directory keeps its filesystem object identity alive even after unlink.
struct PinnedDirectory {
    file: File,
    identity: DirectoryObjectId,
}

impl PinnedDirectory {
    fn open(path: &Path) -> Result<Self, FsError> {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
                FILE_SHARE_READ, FILE_SHARE_WRITE,
            };
            options
                .access_mode(FILE_READ_ATTRIBUTES)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
        }
        let file = options.open(path)?;
        let identity = directory_object_id(&file)?;
        Ok(Self { file, identity })
    }
}

fn directory_object_id(file: &File) -> Result<DirectoryObjectId, FsError> {
    let metadata = file.metadata()?;
    if !metadata.is_dir() {
        return Err(FsError::PathEscape);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok((metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    {
        crate::utils::fs::windows_file_identity_from_handle(file).map_err(FsError::Io)
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(FsError::Unavailable)
    }
}

struct WatcherHandle {
    generation: u64,
    tx: broadcast::Sender<FsEvent>,
    refcount: usize,
    /// Keeps the debouncer alive. Drop = stop watcher.
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    // Field drop order keeps the directory pinned until after the OS watcher stops.
    directory: PinnedDirectory,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct WatcherKey {
    pub project: String,
    pub target_key: String,
    pub root: PathBuf,
}

/// Exact watcher generation owned by one subscription, independent of later pathname reuse.
pub(crate) struct WatcherLease {
    key: WatcherKey,
    generation: u64,
}

#[derive(Default)]
struct WatcherRegistry {
    watchers: HashMap<WatcherKey, Vec<WatcherHandle>>,
    next_generation: u64,
}

/// Shared, refcounted file-system watcher registry.
///
/// One non-recursive watcher per directory identity, created on first subscriber.
/// Replaced directories get a new generation while old leases remain independently releasable.
#[derive(Clone, Default)]
pub struct FsWatcherManager {
    inner: Arc<Mutex<WatcherRegistry>>,
}

impl FsWatcherManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribe to FS events for `root`.
    ///
    /// Reuses only a matching directory identity. Returns an exact generation
    /// lease alongside its events. Rejects a directory changed during installation.
    pub(crate) fn subscribe(
        &self,
        key: &WatcherKey,
    ) -> Result<(WatcherLease, broadcast::Receiver<FsEvent>), FsError> {
        let mut registry = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let directory = PinnedDirectory::open(&key.root)?;
        if let Some(handle) = registry.watchers.get_mut(key).and_then(|generations| {
            generations
                .iter_mut()
                .find(|handle| handle.directory.identity == directory.identity)
        }) {
            if directory_object_id(&handle.directory.file)? != directory.identity
                || PinnedDirectory::open(&key.root)?.identity != directory.identity
            {
                return Err(FsError::Conflict);
            }
            handle.refcount += 1;
            debug!(
                project = %key.project, target_key = %key.target_key,
                root = %key.root.display(), generation = handle.generation,
                refcount = handle.refcount, "watcher ref++"
            );
            return Ok((
                WatcherLease {
                    key: key.clone(),
                    generation: handle.generation,
                },
                handle.tx.subscribe(),
            ));
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
        )
        .map_err(|error| FsError::Io(std::io::Error::other(error)))?;

        // Non-recursive: only watch the immediate directory.
        // Recursive mode traverses every subdirectory to set up inotify watches,
        // which is catastrophically slow for large workspaces (e.g. Rust `target/`
        // with millions of files). The client's delta logic (applyFsDelta) only
        // operates on depth-1 nodes anyway, so deep events would be no-ops.
        {
            let mut d = debouncer;
            if PinnedDirectory::open(&key.root)?.identity != directory_object_id(&directory.file)? {
                return Err(FsError::Conflict);
            }
            d.watch(&key.root, notify::RecursiveMode::NonRecursive)
                .map_err(|error| FsError::Io(std::io::Error::other(error)))?;
            if PinnedDirectory::open(&key.root)?.identity != directory_object_id(&directory.file)? {
                return Err(FsError::Conflict);
            }
            let generation = registry.next_generation;
            registry.next_generation = generation.checked_add(1).ok_or_else(|| {
                FsError::Io(std::io::Error::other("watcher generation exhausted"))
            })?;
            let rx = tx.subscribe();
            registry
                .watchers
                .entry(key.clone())
                .or_default()
                .push(WatcherHandle {
                    directory,
                    generation,
                    tx,
                    refcount: 1,
                    _debouncer: d,
                });
            debug!(
                project = %key.project, target_key = %key.target_key,
                root = %key.root.display(), generation, "watcher spawned, refcount=1"
            );
            return Ok((
                WatcherLease {
                    key: key.clone(),
                    generation,
                },
                rx,
            ));
        }
    }

    /// Release only the generation that issued the subscription's lease.
    /// An old subscription cannot decrement a replacement directory watcher.
    pub(crate) fn release(&self, lease: &WatcherLease) {
        let mut registry = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(generations) = registry.watchers.get_mut(&lease.key) {
            if let Some(index) = generations
                .iter()
                .position(|handle| handle.generation == lease.generation)
            {
                let handle = &mut generations[index];
                handle.refcount -= 1;
                debug!(root = %lease.key.root.display(), generation = lease.generation,
                    refcount = handle.refcount, "watcher ref--");
                if handle.refcount == 0 {
                    generations.swap_remove(index);
                }
            }
            if generations.is_empty() {
                registry.watchers.remove(&lease.key);
            }
        }
    }

    /// Current refcount for a root — for tests.
    #[cfg(test)]
    pub(crate) fn refcount(&self, root: &std::path::Path) -> usize {
        self.inner
            .lock()
            .expect("FsWatcherManager poisoned")
            .watchers
            .iter()
            .filter(|(key, _)| key.root == root)
            .flat_map(|(_, generations)| generations.iter())
            .map(|handle| handle.refcount)
            .sum()
    }
}
