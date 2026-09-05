use serde::{Deserialize, Serialize};

/// Exact payload for `PATCH /api/system/idle-suspend/v1/timing`.
///
/// Disallows unknown fields and requires both integer fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdleSuspendTimingPatchRequest {
    pub quiet_period_seconds: u64,
    pub wake_after_seconds: u64,
}

/// Success response for `PATCH /api/system/idle-suspend/v1/timing`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendTimingPatchResponse {
    pub version: u32,
    pub changed: bool,
    pub status_revision: u64,
    pub quiet_period_seconds: u64,
    pub wake_after_seconds: u64,
}

impl IdleSuspendTimingPatchResponse {
    pub fn new(
        changed: bool,
        status_revision: u64,
        quiet_period_seconds: u64,
        wake_after_seconds: u64,
    ) -> Self {
        Self {
            version: 1,
            changed,
            status_revision,
            quiet_period_seconds,
            wake_after_seconds,
        }
    }
}

/// Standard error code strings for idle suspend operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleSuspendErrorCode {
    InvalidTiming,
    Unauthorized,
    InvalidOrigin,
    DisabledNoAuth,
    ActorDisabled,
    HandoffInProgress,
    InvalidContentType,
    AuthenticationUnavailable,
    TimingUnavailable,
    AuditUnavailable,
    PersistenceUnavailable,
    ReconciliationRequired,
}

impl IdleSuspendErrorCode {
    pub fn as_code_str(&self) -> &'static str {
        match self {
            Self::InvalidTiming => "invalidIdleSuspendTiming",
            Self::Unauthorized => "unauthorized",
            Self::InvalidOrigin => "invalidOrigin",
            Self::DisabledNoAuth => "idleSuspendTimingDisabledNoAuth",
            Self::ActorDisabled => "actorDisabled",
            Self::HandoffInProgress => "idleSuspendHandoffInProgress",
            Self::InvalidContentType => "invalidContentType",
            Self::AuthenticationUnavailable => "authenticationUnavailable",
            Self::TimingUnavailable => "idleSuspendTimingUnavailable",
            Self::AuditUnavailable => "idleSuspendTimingAuditUnavailable",
            Self::PersistenceUnavailable => "idleSuspendTimingPersistenceUnavailable",
            Self::ReconciliationRequired => "idleSuspendTimingReconciliationRequired",
        }
    }
}

/// Fixed request sent to privileged helper for RTC wake + suspend.
///
/// Contains strictly bounded fields: no command, argv, shell, device, or mode strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuspendWithRtcWakeRequest {
    /// Idempotency / transaction tracking ID.
    pub request_id: String,
    /// Bounded duration in seconds until scheduled RTC wake.
    pub wake_after_seconds: u64,
}

/// Outcome reported by executor/helper after suspend attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SuspendOutcome {
    /// Suspend succeeded and the system has resumed.
    ResumedSuccessfully {
        request_id: String,
        elapsed_seconds: u64,
    },
    /// Suspend was rejected because the pre-handoff or helper check detected fleet activity.
    RejectedFleetActive {
        request_id: String,
        reason: String,
    },
    /// An active sleep inhibitor blocked or delayed suspend.
    BlockedByInhibitor {
        request_id: String,
        inhibitor: String,
    },
    /// The host lacks RTC alarm or suspend capability.
    UnsupportedCapability {
        request_id: String,
        detail: String,
    },
    /// Execution failed with a fatal error.
    ExecutionFailed {
        request_id: String,
        error: String,
    },
}
