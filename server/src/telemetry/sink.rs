use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc,
};

use super::types::CommandEvent;

/// Non-blocking boundary between PTY lifecycle code and telemetry persistence.
pub trait TelemetrySink: Send + Sync + 'static {
    /// Implementations must only enqueue/drop; never wait on a receiver or do I/O.
    fn try_record(&self, event: CommandEvent);
    fn dropped_count(&self) -> u64;
}

#[derive(Default)]
pub struct NoopTelemetrySink;

impl NoopTelemetrySink {
    pub fn new() -> Self {
        Self::default()
    }
}

impl TelemetrySink for NoopTelemetrySink {
    fn try_record(&self, _event: CommandEvent) {
        // Disabled analytics intentionally discards without reporting queue loss.
    }

    fn dropped_count(&self) -> u64 {
        0
    }
}

pub struct ChannelTelemetrySink {
    tx: SyncSender<CommandEvent>,
    dropped: Arc<AtomicU64>,
}

impl ChannelTelemetrySink {
    pub fn new(tx: SyncSender<CommandEvent>) -> Self {
        Self {
            tx,
            dropped: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn channel(capacity: usize) -> (Self, Receiver<CommandEvent>) {
        let (tx, rx) = mpsc::sync_channel(capacity);
        (Self::new(tx), rx)
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

impl TelemetrySink for ChannelTelemetrySink {
    fn try_record(&self, event: CommandEvent) {
        if matches!(
            self.tx.try_send(event),
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_))
        ) {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn dropped_count(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{normalize_command, privacy::load_or_create_hmac_key, types::*};
    use std::sync::Arc;
    use uuid::Uuid;

    fn event() -> CommandEvent {
        let directory = tempfile::tempdir().unwrap();
        let key = load_or_create_hmac_key(&directory.path().join("key")).unwrap();
        let command = normalize_command("git status", &key);
        CommandEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: CommandEventId {
                run_id: TerminalRunId(Uuid::new_v4()),
                sequence: 1,
            },
            occurred_at_utc_ms: 0,
            duration_ms: None,
            exit_code: None,
            outcome: CommandOutcome::Unknown,
            category: command.category,
            executable: command.executable,
            argument_count: command.argument_count,
            fingerprint: command.fingerprint,
            capture_quality: command.capture_quality,
        }
    }

    #[test]
    fn queue_saturation_and_unavailable_are_counted_without_blocking() {
        let (sink, receiver) = ChannelTelemetrySink::channel(1);
        sink.try_record(event());
        sink.try_record(event());
        assert_eq!(sink.dropped_count(), 1);
        drop(receiver);
        sink.try_record(event());
        assert_eq!(sink.dropped_count(), 2);

        let noop = Arc::new(NoopTelemetrySink::new());
        noop.try_record(event());
        assert_eq!(noop.dropped_count(), 0);
    }
}
