use serde::{Deserialize, Serialize};

use crate::idle_suspend::protocol::SuspendOutcome;
use crate::pty::fleet_state::PtyFleetSnapshot;

/// Monotonic coordinator states per Phase 02 requirements.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoordinatorState {
    /// Idle suspend feature is disabled by operator/startup configuration.
    Disabled,
    /// Coordinator is actively watching the PTY fleet; fleet is non-empty or arming cancelled.
    Watching,
    /// Fleet transitioned to quiescent; countdown timer is armed for quiet_period_seconds.
    Armed,
    /// Grace deadline reached; verifying final fleet generation and claiming handoff.
    FinalCheck,
    /// Handoff accepted; privileged executor is executing suspend with RTC wake.
    HandedOff,
    /// Attempt was suppressed (e.g. inhibitor, active fleet detected, unsupported capability).
    Suppressed,
    /// Suspend execution failed with an error.
    Failed,
    /// Host has resumed from a successful suspend.
    Resumed,
}

impl CoordinatorState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Watching => "watching",
            Self::Armed => "armed",
            Self::FinalCheck => "finalCheck",
            Self::HandedOff => "handedOff",
            Self::Suppressed => "suppressed",
            Self::Failed => "failed",
            Self::Resumed => "resumed",
        }
    }
}

/// Immutable authoritative v1 status snapshot for the idle suspend subsystem.
///
/// Published by the coordinator on startup and after every state transition,
/// timing update, or handoff outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendStatusV1 {
    /// Schema version (always 1 for v1).
    pub version: u32,
    /// Monotonic revision incremented on every status change or timing mutation.
    pub status_revision: u64,
    /// Current state machine state.
    pub state: CoordinatorState,
    /// True if idle suspend is enabled by operator startup policy.
    pub enabled: bool,
    /// Monotonic identifier for the current or last idle epoch.
    pub current_epoch: u64,
    /// Active quiet period duration in seconds before suspend arms.
    pub quiet_period_seconds: u64,
    /// Active wake duration in seconds requested for RTC timer.
    pub wake_after_seconds: u64,
    /// Content-free snapshot of current PTY fleet counts and generation.
    pub fleet_snapshot: PtyFleetSnapshot,
    /// Unix timestamp in milliseconds when armed grace expires, if currently armed.
    pub arm_deadline_ms: Option<u64>,
    /// Last typed execution outcome reported by the executor, if any.
    pub last_outcome: Option<SuspendOutcome>,
    /// Human-readable detail or reason string for diagnostics.
    pub detail: Option<String>,
    /// Unix timestamp in milliseconds when this status snapshot was generated.
    pub timestamp_ms: u64,
}

impl IdleSuspendStatusV1 {
    pub fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}
