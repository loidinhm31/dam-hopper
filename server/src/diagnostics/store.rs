use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{redact_diagnostic_fields, redact_diagnostic_text, DiagnosticEvent};

const DEFAULT_RETENTION_MINUTES: u64 = 60;
const MAX_EVENTS: usize = 5_000;
const MAX_FILE_EVENTS: usize = 10_000;
const PERSIST_QUEUE_CAPACITY: usize = 1_024;
const COMPACT_EVERY_WRITES: u64 = 256;

#[derive(Clone)]
pub struct DiagnosticStore {
    inner: Arc<Mutex<DiagnosticStoreInner>>,
    log_path: Arc<PathBuf>,
    io_lock: Arc<Mutex<()>>,
    writer_tx: SyncSender<DiagnosticEvent>,
    dropped_persist_events: Arc<AtomicU64>,
    persist_error_count: Arc<AtomicU64>,
}

struct DiagnosticStoreInner {
    events: VecDeque<DiagnosticEvent>,
}

impl DiagnosticStore {
    pub fn new(log_path: PathBuf) -> Self {
        let log_path = Arc::new(log_path);
        let io_lock = Arc::new(Mutex::new(()));
        let dropped_persist_events = Arc::new(AtomicU64::new(0));
        let persist_error_count = Arc::new(AtomicU64::new(0));
        let (writer_tx, writer_rx) = mpsc::sync_channel(PERSIST_QUEUE_CAPACITY);
        spawn_persist_worker(
            Arc::clone(&log_path),
            Arc::clone(&io_lock),
            Arc::clone(&persist_error_count),
            writer_rx,
        );

        Self {
            inner: Arc::new(Mutex::new(DiagnosticStoreInner {
                events: VecDeque::new(),
            })),
            log_path,
            io_lock,
            writer_tx,
            dropped_persist_events,
            persist_error_count,
        }
    }

    pub fn default() -> Self {
        Self::new(default_diagnostics_log_path())
    }

    pub fn log_path(&self) -> &std::path::Path {
        &self.log_path
    }

    pub fn retention_minutes(&self) -> u64 {
        DEFAULT_RETENTION_MINUTES
    }

    pub fn stats(&self) -> DiagnosticStoreStats {
        DiagnosticStoreStats {
            dropped_persist_events: self.dropped_persist_events.load(Ordering::Relaxed),
            persist_error_count: self.persist_error_count.load(Ordering::Relaxed),
        }
    }

    pub fn record_event(&self, mut event: DiagnosticEvent) {
        event.message = redact_diagnostic_text(&event.message);
        event.fields = redact_diagnostic_fields(event.fields);

        {
            let mut inner = self.inner.lock().unwrap();
            inner.events.push_back(event.clone());
            prune_events(&mut inner.events, now_ms(), DEFAULT_RETENTION_MINUTES);
            while inner.events.len() > MAX_EVENTS {
                inner.events.pop_front();
            }
        }

        match self.writer_tx.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                self.dropped_persist_events.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Convenience helper for terminal/transport instrumentation (Phase 03).
    /// Builds a redacted INFO-level event with the given source and fields.
    pub fn record_terminal_event(
        &self,
        source: &str,
        message: &str,
        fields: BTreeMap<String, String>,
    ) {
        self.record_event(DiagnosticEvent {
            timestamp_ms: now_ms(),
            level: "INFO".to_string(),
            source: source.to_string(),
            message: message.to_string(),
            fields,
        });
    }

    pub fn recent_events(&self, window_minutes: u64) -> Vec<DiagnosticEvent> {
        let effective_window_minutes = self.effective_window_minutes(window_minutes);
        self.compact_log_file();
        let cutoff = now_ms().saturating_sub(effective_window_minutes.saturating_mul(60_000));
        let mut events = self.load_recent_from_file(effective_window_minutes);
        events.extend(
            self.inner
                .lock()
                .unwrap()
                .events
                .iter()
                .filter(|event| event.timestamp_ms >= cutoff)
                .cloned(),
        );
        dedupe_sort(events)
    }

    pub fn load_recent_from_file(&self, window_minutes: u64) -> Vec<DiagnosticEvent> {
        let cutoff = now_ms().saturating_sub(
            self.effective_window_minutes(window_minutes)
                .saturating_mul(60_000),
        );
        let _guard = self.io_lock.lock().unwrap();
        let Ok(file) = fs::File::open(&*self.log_path) else {
            return Vec::new();
        };
        BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<DiagnosticEvent>(&line).ok())
            .filter(|event| event.timestamp_ms >= cutoff)
            .collect()
    }

    fn compact_log_file(&self) {
        let _guard = self.io_lock.lock().unwrap();
        if let Err(_error) = compact_jsonl_file(&self.log_path, DEFAULT_RETENTION_MINUTES) {
            self.persist_error_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn effective_window_minutes(&self, window_minutes: u64) -> u64 {
        window_minutes.min(DEFAULT_RETENTION_MINUTES)
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DiagnosticStoreStats {
    pub dropped_persist_events: u64,
    pub persist_error_count: u64,
}

pub fn default_diagnostics_log_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("~/.config"))
        .join("dam-hopper")
        .join("diagnostics")
        .join("backend-log.jsonl")
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn append_jsonl(path: &std::path::Path, event: &DiagnosticEvent) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    serde_json::to_writer(&mut file, event)?;
    file.write_all(b"\n")?;
    Ok(())
}

fn spawn_persist_worker(
    log_path: Arc<PathBuf>,
    io_lock: Arc<Mutex<()>>,
    persist_error_count: Arc<AtomicU64>,
    rx: Receiver<DiagnosticEvent>,
) {
    thread::Builder::new()
        .name("diagnostics-writer".to_string())
        .spawn(move || {
            let mut writes = 0_u64;
            while let Ok(event) = rx.recv() {
                let _guard = io_lock.lock().unwrap();
                if append_jsonl(&log_path, &event).is_err() {
                    persist_error_count.fetch_add(1, Ordering::Relaxed);
                }
                writes = writes.saturating_add(1);
                if writes % COMPACT_EVERY_WRITES == 0
                    && compact_jsonl_file(&log_path, DEFAULT_RETENTION_MINUTES).is_err()
                {
                    persist_error_count.fetch_add(1, Ordering::Relaxed);
                }
            }
        })
        .expect("failed to spawn diagnostics writer");
}

fn compact_jsonl_file(path: &std::path::Path, window_minutes: u64) -> std::io::Result<()> {
    let cutoff = now_ms().saturating_sub(window_minutes.saturating_mul(60_000));
    let Ok(file) = fs::File::open(path) else {
        return Ok(());
    };

    let mut events = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<DiagnosticEvent>(&line).ok())
        .filter(|event| event.timestamp_ms >= cutoff)
        .collect::<Vec<_>>();
    if events.len() > MAX_FILE_EVENTS {
        events = events.split_off(events.len() - MAX_FILE_EVENTS);
    }

    let temp_path = path.with_extension("jsonl.tmp");
    write_jsonl_file(&temp_path, &events)?;
    replace_file(&temp_path, path)?;
    Ok(())
}

fn replace_file(temp_path: &std::path::Path, final_path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        match fs::remove_file(final_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }

    fs::rename(temp_path, final_path)
}

fn write_jsonl_file(path: &std::path::Path, events: &[DiagnosticEvent]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    for event in events {
        serde_json::to_writer(&mut file, event)?;
        file.write_all(b"\n")?;
    }
    Ok(())
}

fn prune_events(events: &mut VecDeque<DiagnosticEvent>, now: u64, retention_minutes: u64) {
    let cutoff = now.saturating_sub(retention_minutes.saturating_mul(60_000));
    while events
        .front()
        .is_some_and(|event| event.timestamp_ms < cutoff)
    {
        events.pop_front();
    }
}

fn dedupe_sort(mut events: Vec<DiagnosticEvent>) -> Vec<DiagnosticEvent> {
    let mut seen = HashSet::new();
    events.retain(|event| {
        let key = serde_json::to_string(event).unwrap_or_default();
        seen.insert(key)
    });
    events.sort_by_key(|event| event.timestamp_ms);
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(message: &str, timestamp_ms: u64) -> DiagnosticEvent {
        DiagnosticEvent {
            timestamp_ms,
            level: "INFO".to_string(),
            source: "test".to_string(),
            message: message.to_string(),
            fields: Default::default(),
        }
    }

    #[test]
    fn records_ring_and_jsonl_with_redaction() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("backend-log.jsonl"));
        store.record_event(event("Bearer secret-token", now_ms()));

        let events = store.recent_events(60);
        assert_eq!(events.len(), 1);
        assert!(!events[0].message.contains("secret-token"));
    }

    #[test]
    fn loader_skips_corrupt_jsonl_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend-log.jsonl");
        let valid = serde_json::to_string(&event("ok", now_ms())).unwrap();
        std::fs::write(&path, format!("not-json\n{valid}\n")).unwrap();

        let store = DiagnosticStore::new(path);
        let events = store.load_recent_from_file(60);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message, "ok");
    }

    #[test]
    fn recent_events_compacts_jsonl_to_retention_window() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend-log.jsonl");
        let old = serde_json::to_string(&event("old", now_ms() - 90 * 60_000)).unwrap();
        let fresh = serde_json::to_string(&event("fresh", now_ms())).unwrap();
        std::fs::write(&path, format!("{old}\n{fresh}\n")).unwrap();

        let store = DiagnosticStore::new(path.clone());
        let events = store.recent_events(120);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message, "fresh");

        let compacted = std::fs::read_to_string(path).unwrap();
        assert!(!compacted.contains("old"));
        assert!(compacted.contains("fresh"));
    }

    #[test]
    fn record_terminal_event_redacts_and_stores() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mut fields = BTreeMap::new();
        fields.insert("sessionId".into(), "shell:test".into());
        fields.insert("token".into(), "secret-value".into());
        store.record_terminal_event("pty", "terminal.create", fields);

        let events = store.recent_events(60);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].source, "pty");
        assert_eq!(events[0].message, "terminal.create");
        // Sensitive field should be redacted.
        assert_eq!(
            events[0].fields.get("token"),
            Some(&"[REDACTED]".to_string())
        );
        assert_eq!(
            events[0].fields.get("sessionId"),
            Some(&"shell:test".to_string())
        );
    }
}
