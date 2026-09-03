//! Allowed transition graph and crash recovery classification.
//!
//! Enforces:
//! ABSENT | ACTIVE -> STAGED -> PENDING -> QUIESCED -> SWITCHED -> PROBING -> COMMITTED
//! Disallowed or corrupted combinations become RECOVERY_REQUIRED.

use super::error::ReleaseError;
use super::state::ManagerState;
use super::state_record::TransactionPhase;
use serde::{Deserialize, Serialize};

/// High-level lifecycle state of the release installation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeploymentState {
    Absent,
    Active,
    Staged,
    Pending,
    Quiesced,
    Switched,
    Probing,
    Committed,
    RollingBack,
    RolledBack,
    RecoveryRequired,
}

/// Action to execute during boot recovery or crash reconciliation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecoveryAction {
    /// System is consistent; no recovery mutation required.
    NoAction,
    /// Pending candidate left intact; old active release remains running.
    ResumePending,
    /// Restore old active release (or clean baseline for first-install).
    RestorePrevious,
    /// Verify unit enablement and repair current symlink for committed release.
    RepairCommitted,
    /// Inconsistency requires operator intervention; app units blocked.
    RecoveryRequired(String),
}

/// Validate if transitioning from `current` to `target` is allowed.
pub fn validate_transition(
    current: DeploymentState,
    target: DeploymentState,
) -> Result<(), ReleaseError> {
    use DeploymentState::*;
    let allowed = match (current, target) {
        (Absent, Staged) => true,
        (Active, Staged) => true,
        (Staged, Pending) => true,
        (Pending, Quiesced) => true,
        (Quiesced, Switched) => true,
        (Switched, Probing) => true,
        (Probing, Committed) => true,
        (Probing, RollingBack) => true,
        (Switched, RollingBack) => true,
        (Quiesced, RollingBack) => true,
        (RollingBack, RolledBack) => true,
        (RollingBack, RecoveryRequired) => true,
        (RolledBack, Active) => true,
        (RolledBack, Absent) => true,
        (Committed, Active) => true,
        (_, RecoveryRequired) => true,
        _ => false,
    };

    if allowed {
        Ok(())
    } else {
        Err(ReleaseError::Config(format!(
            "invalid deployment transition from {current:?} to {target:?}"
        )))
    }
}

/// Classify the recovery action needed for an arbitrary manager state.
pub fn classify_recovery(state: &ManagerState) -> RecoveryAction {
    if let Err(e) = state.validate() {
        return RecoveryAction::RecoveryRequired(format!("state validation failed: {e}"));
    }

    let tx = match &state.transaction {
        Some(t) => t,
        None => {
            // No active transaction. If pending exists without transaction, it is safe.
            return if state.pending.is_some() {
                RecoveryAction::ResumePending
            } else if state.active.is_some() {
                RecoveryAction::RepairCommitted
            } else {
                RecoveryAction::NoAction
            };
        }
    };

    match tx.phase {
        TransactionPhase::Staged => RecoveryAction::ResumePending,
        TransactionPhase::Quiesced
        | TransactionPhase::Switched
        | TransactionPhase::Probing
        | TransactionPhase::RollingBack => RecoveryAction::RestorePrevious,
        TransactionPhase::Committed => RecoveryAction::RepairCommitted,
        TransactionPhase::RolledBack => RecoveryAction::NoAction,
        TransactionPhase::Failed => RecoveryAction::RecoveryRequired(format!(
            "in-flight transaction {} failed",
            tx.tx_id
        )),
    }
}
