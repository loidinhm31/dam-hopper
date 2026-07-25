use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{Receiver, RecvTimeoutError},
        Arc, RwLock,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use super::{store::TelemetryStore, TelemetryCmd};

const BATCH_LIMIT: usize = 100;
const FLUSH_INTERVAL: Duration = Duration::from_millis(250);

/// Runtime controls shared by the PTY gate and future authenticated controls.
#[derive(Default)]
pub struct TelemetryControl {
    enabled: AtomicBool,
    excluded_projects: RwLock<HashSet<String>>,
    rejected: AtomicU64,
}

impl TelemetryControl {
    pub fn new(enabled: bool, excluded_projects: impl IntoIterator<Item = String>) -> Self {
        Self {
            enabled: AtomicBool::new(enabled),
            excluded_projects: RwLock::new(excluded_projects.into_iter().collect()),
            rejected: AtomicU64::new(0),
        }
    }

    pub fn allows_project(&self, project: Option<&str>) -> bool {
        if !self.enabled.load(Ordering::Relaxed) {
            return false;
        }
        let excluded = self
            .excluded_projects
            .read()
            .expect("telemetry exclusions lock poisoned");
        let allowed = project.is_none_or(|project| !excluded.contains(project));
        if !allowed {
            self.rejected.fetch_add(1, Ordering::Relaxed);
        }
        allowed
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }
    pub fn rejected_count(&self) -> u64 {
        self.rejected.load(Ordering::Relaxed)
    }
}

#[derive(Clone, Default)]
pub struct TelemetryHandle {
    pub control: Arc<TelemetryControl>,
    pub store: Option<Arc<TelemetryStore>>,
}

impl TelemetryHandle {
    pub fn disabled() -> Self {
        Self {
            control: Arc::new(TelemetryControl::default()),
            store: None,
        }
    }
    pub fn active(control: Arc<TelemetryControl>, store: Arc<TelemetryStore>) -> Self {
        Self {
            control,
            store: Some(store),
        }
    }
}

pub struct TelemetryWorker {
    receiver: Receiver<TelemetryCmd>,
    store: Arc<TelemetryStore>,
}

impl TelemetryWorker {
    pub fn new(receiver: Receiver<TelemetryCmd>, store: Arc<TelemetryStore>) -> Self {
        Self { receiver, store }
    }

    pub fn spawn(self) -> std::io::Result<JoinHandle<()>> {
        std::thread::Builder::new()
            .name("telemetry-worker".to_string())
            .spawn(move || self.run())
    }

    fn run(self) {
        let mut batch = Vec::with_capacity(BATCH_LIMIT);
        let mut last_flush = Instant::now();
        loop {
            let timeout = FLUSH_INTERVAL.saturating_sub(last_flush.elapsed());
            match self.receiver.recv_timeout(timeout) {
                Ok(TelemetryCmd::Shutdown) => {
                    self.flush(&mut batch);
                    break;
                }
                Ok(command) => {
                    batch.push(command);
                    if batch.len() >= BATCH_LIMIT {
                        self.flush(&mut batch);
                        last_flush = Instant::now();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.flush(&mut batch);
                    last_flush = Instant::now();
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.flush(&mut batch);
                    break;
                }
            }
        }
        let _ = self.store.checkpoint();
    }

    fn flush(&self, batch: &mut Vec<TelemetryCmd>) {
        if batch.is_empty() {
            return;
        }
        let commands = std::mem::take(batch);
        if self.store.write_batch(commands).is_err() {
            // The payload is intentionally never logged. Failure is visible only as a count.
            let now = crate::diagnostics::now_ms() as i64;
            let _ = self.store.increment_health("writer_errors", 1, now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use tempfile::TempDir;

    #[test]
    fn control_pauses_and_excludes_without_payload_inspection() {
        let control = TelemetryControl::new(true, ["private".to_string()]);
        assert!(control.allows_project(Some("public")));
        assert!(!control.allows_project(Some("private")));
        control.set_enabled(false);
        assert!(!control.allows_project(Some("public")));
        assert_eq!(control.rejected_count(), 1);
    }

    #[test]
    fn worker_stops_cleanly() {
        let temp = TempDir::new().unwrap();
        let store = Arc::new(TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap());
        let (sender, receiver) = mpsc::sync_channel(1);
        let worker = TelemetryWorker::new(receiver, store).spawn().unwrap();
        sender.send(TelemetryCmd::Shutdown).unwrap();
        worker.join().unwrap();
    }
}
