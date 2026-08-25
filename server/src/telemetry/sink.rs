use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};

use super::types::CodexUsageEvent;

/// The only producer-facing queue in the telemetry runtime. It is deliberately
/// independent from PTY lifecycle code and never waits or performs I/O.
pub struct CodexUsageQueue {
    tx: SyncSender<TelemetryCmd>,
}

impl CodexUsageQueue {
    pub fn channel(capacity: usize) -> (Self, Receiver<TelemetryCmd>) {
        let (tx, receiver) = mpsc::sync_channel(capacity);
        (Self { tx }, receiver)
    }

    pub fn sender(&self) -> SyncSender<TelemetryCmd> {
        self.tx.clone()
    }

    pub fn try_enqueue(&self, event: CodexUsageEvent) -> Result<(), QueueError> {
        self.tx
            .try_send(TelemetryCmd::CodexUsage(event))
            .map_err(|error| match error {
                TrySendError::Full(_) => QueueError::Full,
                TrySendError::Disconnected(_) => QueueError::Disconnected,
            })
    }
}

/// Typed messages accepted by the dedicated Codex usage worker.
#[derive(Debug)]
pub enum TelemetryCmd {
    CodexUsage(CodexUsageEvent),
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueueError {
    Full,
    Disconnected,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{
        CodexModel, CodexVersion, SourceQuality, TokenCounterSemantic, TokenQuality,
        TELEMETRY_SCHEMA_VERSION,
    };

    fn event() -> CodexUsageEvent {
        CodexUsageEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: crate::telemetry::privacy::HmacDigest::try_from("a".repeat(64)).unwrap(),
            occurred_at_utc_ms: 1,
            session_fingerprint: None,
            model: Some(CodexModel::new("gpt-5.6").unwrap()),
            source_version: CodexVersion::new("0.145.0").unwrap(),
            source_quality: SourceQuality::Verified,
            status: crate::telemetry::SafeIdentifier::new("completed").unwrap(),
            counter_semantic: TokenCounterSemantic::Delta,
            duration_ms: None,
            token_quality: TokenQuality::Exact,
            input_tokens: Some(1),
            cached_input_tokens: Some(0),
            output_tokens: Some(1),
            reasoning_tokens: Some(0),
        }
    }

    #[test]
    fn queue_saturation_and_disconnect_are_non_blocking() {
        let (queue, receiver) = CodexUsageQueue::channel(1);
        assert_eq!(queue.try_enqueue(event()), Ok(()));
        assert_eq!(queue.try_enqueue(event()), Err(QueueError::Full));
        drop(receiver);
        assert_eq!(queue.try_enqueue(event()), Err(QueueError::Disconnected));
    }
}
