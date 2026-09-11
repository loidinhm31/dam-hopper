use serde::{Deserialize, Serialize};

/// Tri-state qualification of current activity observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityMeasurementState {
    /// Initial baseline collection in progress or recovering.
    Initializing,
    /// Observation is fully qualified and comparable.
    Available,
    /// Observation cannot be qualified; suspend handoff is blocked.
    Unavailable,
}

/// Explicit, closed reason codes for activity status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityObservationReason {
    RecentInput,
    RecentOutput,
    RecentNetwork,
    AgentChanged,
    LifecycleBusy,
    Quiet,
    ProcAccess,
    ScanLimit,
    ScanTimeout,
    SocketDiagnostics,
    UnsupportedTransport,
    NamespaceMismatch,
    StaleObservation,
    IdentityUncertain,
    CounterOverflow,
    Reconciling,
    EpochSpent,
}
use crate::idle_suspend::policy::IdleSuspendAutomaticPolicy;
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

/// Explicit reason codes for measurement warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MeasurementWarningReasonCode {
    ProcAccess,
    ScanLimit,
    ScanTimeout,
    SocketDiagnostics,
    UnsupportedTransport,
    NamespaceMismatch,
    StaleObservation,
    IdentityUncertain,
    CounterOverflow,
    Reconciling,
}

/// Attributable process identity for authenticated measurement warning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendWarningProcessV1 {
    pub pid: u32,
    pub executable_identity: Option<String>,
}

/// Authenticated measurement warning detailing why activity observation is blocked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendMeasurementWarningV1 {
    pub reason_code: MeasurementWarningReasonCode,
    pub blocked_since_ms: u64,
    pub processes: Vec<IdleSuspendWarningProcessV1>,
    pub processes_truncated: bool,
}

/// Activity observation status exposed when policy is `agent-activity`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendActivityStatusV1 {
    pub measurement_state: ActivityMeasurementState,
    pub reason_code: Option<ActivityObservationReason>,
    pub recognized_agent_count: Option<usize>,
    pub monitored_terminal_count: Option<usize>,
    pub sampled_at_ms: Option<u64>,
    pub last_activity_at_ms: Option<u64>,
    pub network_coverage: String,
    pub measurement_warning: Option<IdleSuspendMeasurementWarningV1>,
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
    /// Configured automatic idle suspend policy.
    pub automatic_policy: IdleSuspendAutomaticPolicy,
    /// True if idle suspend is enabled by operator startup policy.
    pub enabled: bool,
    /// Whether timing can currently be mutated by an authenticated actor.
    pub timing_mutable: bool,
    /// Reason string when timing cannot be mutated (e.g. "handoffInProgress", "disabled").
    pub timing_mutable_reason: Option<String>,
    /// Capability code reported by policy/executor (e.g. "unavailable", "fake", "rtcwake").
    pub capability_code: String,
    /// Monotonic identifier for the current or last idle epoch.
    pub current_epoch: u64,
    /// Active quiet period duration in seconds before suspend arms.
    pub quiet_period_seconds: u64,
    /// Active wake duration in seconds requested for RTC timer.
    pub wake_after_seconds: u64,
    /// Minimum allowed quiet period duration in seconds.
    pub min_quiet_period_seconds: u64,
    /// Maximum allowed quiet period duration in seconds.
    pub max_quiet_period_seconds: u64,
    /// Minimum allowed wake duration in seconds.
    pub min_wake_after_seconds: u64,
    /// Maximum allowed wake duration in seconds.
    pub max_wake_after_seconds: u64,
    /// Content-free snapshot of current PTY fleet counts and generation.
    pub fleet_snapshot: PtyFleetSnapshot,
    /// Unix timestamp in milliseconds when armed grace expires, if currently armed.
    pub arm_deadline_ms: Option<u64>,
    /// Last typed execution outcome reported by the executor, if any.
    pub last_outcome: Option<SuspendOutcome>,
    /// Human-readable detail or reason string for diagnostics.
    pub detail: Option<String>,
    /// Activity observation details (null under empty-fleet, non-null under agent-activity).
    pub activity: Option<IdleSuspendActivityStatusV1>,
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

    /// Complete, conservative status snapshot used when coordinator has not started.
    pub fn fallback_status(
        policy: &crate::idle_suspend::StartupIdleSuspendPolicy,
        quiet_period_seconds: u64,
        wake_after_seconds: u64,
        fleet_snapshot: PtyFleetSnapshot,
        fallback_warning_onset_ms: u64,
    ) -> Self {
        let activity = match policy.automatic_policy {
            IdleSuspendAutomaticPolicy::EmptyFleet => None,
            IdleSuspendAutomaticPolicy::AgentActivity => Some(IdleSuspendActivityStatusV1 {
                measurement_state: ActivityMeasurementState::Initializing,
                reason_code: Some(ActivityObservationReason::Reconciling),
                recognized_agent_count: None,
                monitored_terminal_count: None,
                sampled_at_ms: None,
                last_activity_at_ms: None,
                network_coverage: "tcp4-tcp6".to_string(),
                measurement_warning: Some(IdleSuspendMeasurementWarningV1 {
                    reason_code: MeasurementWarningReasonCode::Reconciling,
                    blocked_since_ms: fallback_warning_onset_ms,
                    processes: Vec::new(),
                    processes_truncated: false,
                }),
            }),
        };

        Self {
            version: 1,
            status_revision: 0,
            state: CoordinatorState::Disabled,
            automatic_policy: policy.automatic_policy,
            enabled: policy.enabled,
            timing_mutable: false,
            timing_mutable_reason: Some("disabled".to_string()),
            capability_code: policy.capability_selection.as_str().to_string(),
            current_epoch: 0,
            quiet_period_seconds,
            wake_after_seconds,
            min_quiet_period_seconds: crate::config::MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            max_quiet_period_seconds: crate::config::MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            min_wake_after_seconds: crate::config::MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            max_wake_after_seconds: crate::config::MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            fleet_snapshot,
            arm_deadline_ms: None,
            last_outcome: None,
            detail: Some("coordinatorNotStarted".to_string()),
            activity,
            timestamp_ms: Self::now_ms(),
        }
    }
    /// Determines if a new status differs meaningfully from the previous published status.
    ///
    /// Heartbeat sample timestamps (`sampled_at_ms`) and elapsed warning durations
    /// (`blocked_since_ms`) alone are ignored to avoid flooding WebSocket clients.
    pub fn is_meaningful_change(&self, other: &Self) -> bool {
        if self.state != other.state
            || self.automatic_policy != other.automatic_policy
            || self.enabled != other.enabled
            || self.timing_mutable != other.timing_mutable
            || self.timing_mutable_reason != other.timing_mutable_reason
            || self.capability_code != other.capability_code
            || self.current_epoch != other.current_epoch
            || self.quiet_period_seconds != other.quiet_period_seconds
            || self.wake_after_seconds != other.wake_after_seconds
            || self.fleet_snapshot != other.fleet_snapshot
            || self.arm_deadline_ms != other.arm_deadline_ms
            || self.last_outcome != other.last_outcome
            || self.detail != other.detail
        {
            return true;
        }

        match (&self.activity, &other.activity) {
            (None, None) => false,
            (Some(_), None) | (None, Some(_)) => true,
            (Some(a), Some(b)) => {
                if a.measurement_state != b.measurement_state
                    || a.reason_code != b.reason_code
                    || a.recognized_agent_count != b.recognized_agent_count
                    || a.monitored_terminal_count != b.monitored_terminal_count
                    || a.last_activity_at_ms != b.last_activity_at_ms
                    || a.network_coverage != b.network_coverage
                {
                    return true;
                }
                match (&a.measurement_warning, &b.measurement_warning) {
                    (None, None) => false,
                    (Some(_), None) | (None, Some(_)) => true,
                    (Some(w1), Some(w2)) => {
                        w1.reason_code != w2.reason_code
                            || w1.processes != w2.processes
                            || w1.processes_truncated != w2.processes_truncated
                    }
                }
            }
        }
    }
}
