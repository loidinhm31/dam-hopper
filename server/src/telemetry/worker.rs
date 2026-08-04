use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use super::{
    privacy::TelemetryKeyRing, sink::TelemetryCmd, store::TelemetryStore, types::CodexUsageEvent,
};

const BATCH_LIMIT: usize = 100;
const FLUSH_INTERVAL: Duration = Duration::from_millis(250);

/// Runtime pause state for Codex ingestion. This control has no PTY
/// admission lock, project filter, or terminal ownership state.
#[derive(Default)]
pub struct TelemetryControl {
    enabled: AtomicBool,
    rejected: AtomicU64,
    closing: AtomicBool,
    in_flight: AtomicU64,
    exclusive: Mutex<()>,
}

impl TelemetryControl {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: AtomicBool::new(enabled),
            rejected: AtomicU64::new(0),
            closing: AtomicBool::new(false),
            in_flight: AtomicU64::new(0),
            exclusive: Mutex::new(()),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Serialize destructive operations and close the admission window while
    /// they wait for already-admitted sends. The receiver path uses atomics
    /// only, so it never blocks behind this delete-only mutex.
    pub fn with_exclusive_admission<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _serial = self
            .exclusive
            .lock()
            .expect("telemetry admission mutex poisoned");
        self.closing.store(true, Ordering::SeqCst);
        while self.in_flight.load(Ordering::SeqCst) != 0 {
            std::thread::yield_now();
        }
        let _closing = ClosingGuard { control: self };
        operation()
    }

    fn try_admit(&self) -> Option<AdmissionGuard<'_>> {
        if self.closing.load(Ordering::SeqCst) {
            self.rejected.fetch_add(1, Ordering::Relaxed);
            return None;
        }
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        if self.closing.load(Ordering::SeqCst) {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            self.rejected.fetch_add(1, Ordering::Relaxed);
            None
        } else {
            Some(AdmissionGuard { control: self })
        }
    }

    pub fn rejected_count(&self) -> u64 {
        self.rejected.load(Ordering::Relaxed)
    }
}

struct AdmissionGuard<'a> {
    control: &'a TelemetryControl,
}

impl Drop for AdmissionGuard<'_> {
    fn drop(&mut self) {
        self.control.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

struct ClosingGuard<'a> {
    control: &'a TelemetryControl,
}

impl Drop for ClosingGuard<'_> {
    fn drop(&mut self) {
        self.control.closing.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Default)]
pub struct TelemetryHandle {
    pub control: Arc<TelemetryControl>,
    pub store: Option<Arc<TelemetryStore>>,
    pub command_tx: Option<std::sync::mpsc::SyncSender<TelemetryCmd>>,
    pub hmac_keys: Option<Arc<TelemetryKeyRing>>,
}

impl TelemetryHandle {
    pub fn disabled() -> Self {
        Self {
            control: Arc::new(TelemetryControl::default()),
            store: None,
            command_tx: None,
            hmac_keys: None,
        }
    }

    pub fn active(
        control: Arc<TelemetryControl>,
        store: Arc<TelemetryStore>,
        command_tx: Option<std::sync::mpsc::SyncSender<TelemetryCmd>>,
    ) -> Self {
        Self {
            control,
            store: Some(store),
            command_tx,
            hmac_keys: None,
        }
    }

    pub fn with_hmac_keys(mut self, hmac_keys: Arc<TelemetryKeyRing>) -> Self {
        self.hmac_keys = Some(hmac_keys);
        self
    }

    pub fn try_record_codex_usage(&self, event: CodexUsageEvent) -> TelemetryEnqueue {
        let Some(_admission) = self.control.try_admit() else {
            return TelemetryEnqueue::Paused;
        };
        if !self.control.is_enabled() {
            return TelemetryEnqueue::Paused;
        }
        let Some(sender) = &self.command_tx else {
            return TelemetryEnqueue::Unavailable;
        };
        match sender.try_send(TelemetryCmd::CodexUsage(event)) {
            Ok(()) => TelemetryEnqueue::Queued,
            Err(std::sync::mpsc::TrySendError::Full(_)) => TelemetryEnqueue::Dropped,
            Err(std::sync::mpsc::TrySendError::Disconnected(_)) => TelemetryEnqueue::Unavailable,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TelemetryEnqueue {
    Queued,
    Paused,
    Dropped,
    Unavailable,
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
            .name("codex-usage-worker".to_string())
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
                Ok(TelemetryCmd::Delete {
                    from_utc_ms,
                    to_utc_ms,
                    completion,
                }) => {
                    self.flush(&mut batch);
                    let result = self
                        .store
                        .delete_range(from_utc_ms, to_utc_ms)
                        .and_then(|_| self.store.checkpoint())
                        .map_err(|error| error.to_string());
                    let _ = completion.send(result);
                    last_flush = Instant::now();
                }
                Ok(TelemetryCmd::ApplyRetention {
                    now_utc_ms,
                    detail_retention_days,
                    aggregate_retention_days,
                    completion,
                }) => {
                    self.flush(&mut batch);
                    let result = self
                        .store
                        .write_batch(vec![TelemetryCmd::Purge {
                            now_utc_ms,
                            detail_retention_days,
                            aggregate_retention_days,
                        }])
                        .map_err(|error| error.to_string());
                    let _ = completion.send(result);
                    last_flush = Instant::now();
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
            let _ = self.store.increment_health(
                "writer_errors",
                1,
                crate::diagnostics::now_ms() as i64,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use tempfile::TempDir;

    #[test]
    fn control_pause_has_no_project_or_admission_state() {
        let control = TelemetryControl::new(true);
        assert!(control.is_enabled());
        control.set_enabled(false);
        assert!(!control.is_enabled());
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
