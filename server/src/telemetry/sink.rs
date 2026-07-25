use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc,
};

use super::types::{AgentUsageEvent, CommandEvent, TerminalRunEnd, TerminalRunEvent};

/// Non-blocking boundary between PTY lifecycle code and telemetry persistence.
pub trait TelemetrySink: Send + Sync + 'static {
    /// Implementations must only enqueue/drop; never wait on a receiver or do I/O.
    fn try_record(&self, event: CommandEvent);
    fn try_record_run(&self, event: TerminalRunEvent);
    fn try_finish_run(&self, event: TerminalRunEnd);
    fn try_record_agent_usage(&self, event: AgentUsageEvent);
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

    fn try_record_run(&self, _event: TerminalRunEvent) {}
    fn try_finish_run(&self, _event: TerminalRunEnd) {}
    fn try_record_agent_usage(&self, _event: AgentUsageEvent) {}

    fn dropped_count(&self) -> u64 {
        0
    }
}

pub struct ChannelTelemetrySink {
    tx: SyncSender<TelemetryCmd>,
    dropped: Arc<AtomicU64>,
    control: Option<Arc<super::worker::TelemetryControl>>,
}

impl ChannelTelemetrySink {
    pub fn new(tx: SyncSender<TelemetryCmd>) -> Self {
        Self {
            tx,
            dropped: Arc::new(AtomicU64::new(0)),
            control: None,
        }
    }

    pub fn channel(capacity: usize) -> (Self, Receiver<TelemetryCmd>) {
        let (tx, rx) = mpsc::sync_channel(capacity);
        (Self::new(tx), rx)
    }

    pub fn channel_with_control(
        capacity: usize,
        control: Arc<super::worker::TelemetryControl>,
    ) -> (Self, Receiver<TelemetryCmd>) {
        let (tx, rx) = mpsc::sync_channel(capacity);
        (
            Self {
                tx,
                dropped: Arc::new(AtomicU64::new(0)),
                control: Some(control),
            },
            rx,
        )
    }

    pub fn sender(&self) -> SyncSender<TelemetryCmd> {
        self.tx.clone()
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

impl TelemetrySink for ChannelTelemetrySink {
    fn try_record(&self, event: CommandEvent) {
        self.try_send(TelemetryCmd::Command(event));
    }

    fn try_record_run(&self, event: TerminalRunEvent) {
        self.try_send(TelemetryCmd::TerminalRun(event));
    }

    fn try_finish_run(&self, event: TerminalRunEnd) {
        self.try_send(TelemetryCmd::TerminalRunEnded(event));
    }

    fn try_record_agent_usage(&self, event: AgentUsageEvent) {
        self.try_send(TelemetryCmd::AgentUsage(event));
    }

    fn dropped_count(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

impl ChannelTelemetrySink {
    fn try_send(&self, command: TelemetryCmd) {
        let _admission = self
            .control
            .as_ref()
            .map(|control| control.admission_guard());
        if self
            .control
            .as_ref()
            .is_some_and(|control| !control.is_enabled())
        {
            return;
        }
        if matches!(
            self.tx.try_send(command),
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_))
        ) {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Typed, normalized-only messages accepted by the durable telemetry worker.
#[derive(Debug)]
pub enum TelemetryCmd {
    TerminalRun(TerminalRunEvent),
    TerminalRunEnded(TerminalRunEnd),
    Command(CommandEvent),
    AgentUsage(AgentUsageEvent),
    Purge {
        now_utc_ms: i64,
        detail_retention_days: u16,
        aggregate_retention_days: Option<u32>,
    },
    Delete {
        from_utc_ms: Option<i64>,
        to_utc_ms: Option<i64>,
        completion: std::sync::mpsc::SyncSender<Result<(), String>>,
    },
    ApplyRetention {
        now_utc_ms: i64,
        detail_retention_days: u16,
        aggregate_retention_days: Option<u32>,
        completion: std::sync::mpsc::SyncSender<Result<(), String>>,
    },
    Shutdown,
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
