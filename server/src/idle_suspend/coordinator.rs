use serde::{Deserialize, Serialize};

/// Command to request a timing update through the idle suspend coordinator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateTimingCommand {
    pub actor: String,
    pub quiet_period_seconds: u64,
    pub wake_after_seconds: u64,
}

/// Commands processed sequentially by the coordinator queue to guarantee
/// ordering between timing updates, fleet re-evaluations, and helper handoffs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoordinatorTimingCommand {
    UpdateTiming(UpdateTimingCommand),
}

/// Result returned from processing a coordinator timing command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoordinatorTimingResult {
    /// Update succeeded.
    Success {
        changed: bool,
        status_revision: u64,
        quiet_period_seconds: u64,
        wake_after_seconds: u64,
    },
    /// A helper handoff is currently in flight; caller must retry after resume.
    HandoffInProgress,
    /// Idle suspend feature is disabled or not operational.
    Disabled,
    /// Audit logging failed before mutation could be admitted.
    AuditFailed(String),
    /// Persistence to the canonical registry file failed.
    PersistenceFailed(String),
    /// Input bounds validation failed.
    ValidationFailed(String),
}
