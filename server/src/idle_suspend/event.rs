use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

use crate::config::{
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
use crate::idle_suspend::protocol::validate_request_id;

/// Schema version for canonical server semantic events.
pub const IDLE_SUSPEND_EVENT_SCHEMA_VERSION: u32 = 1;

/// Maximum line length for an emitted event JSON line (16 KiB).
pub const MAX_EVENT_LINE_BYTES: usize = 16 * 1024;

/// Default filesystem path for server semantic events in deployed layouts.
pub const DEFAULT_IDLE_SUSPEND_EVENTS_PATH: &str =
    "/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl";

/// Maximum length of boot_id file read from /proc/sys/kernel/random/boot_id.
const MAX_BOOT_ID_READ_BYTES: usize = 128;

/// Standard error types for event validation.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EventValidationError {
    #[error("Invalid schema version: expected {expected}, got {got}")]
    InvalidSchemaVersion { expected: u32, got: u32 },
    #[error("Invalid UUID string: {0}")]
    InvalidUuid(String),
    #[error("UUID must be version 4: {0}")]
    NotUuidV4(String),
    #[error("Event type '{event_type}' requires correlationId")]
    MissingCorrelationId { event_type: &'static str },
    #[error("Event type '{event_type}' must have null correlationId")]
    ForbiddenCorrelationId { event_type: &'static str },
    #[error("Event type '{event_type}' requires mode")]
    MissingMode { event_type: &'static str },
    #[error("Event type '{event_type}' must have null mode")]
    ForbiddenMode { event_type: &'static str },
    #[error("Event type '{event_type}' cannot use mode '{mode}'")]
    InvalidModeForEvent {
        event_type: &'static str,
        mode: &'static str,
    },
    #[error("Event type '{event_type}' does not match payload variant")]
    PayloadTypeMismatch { event_type: &'static str },
    #[error("Reason code '{code}' is not permitted for event '{event_type}'")]
    ForbiddenReasonCode {
        event_type: &'static str,
        code: &'static str,
    },
    #[error("Final check accepted must have null reason code")]
    FinalCheckAcceptedWithReason,
    #[error("Final check rejected must have non-null reason code")]
    FinalCheckRejectedWithoutReason,
    #[error("Handoff rejection with staleFleetGeneration requires both expected and actual fleet generation")]
    HandoffStaleGenerationMissingGenerations,
    #[error("Handoff rejection with reason '{0}' must have null expected and actual fleet generation")]
    HandoffRejectionForbiddenGenerations(&'static str),
    #[error("Manual attempt cannot have activity revision")]
    ManualAttemptWithActivityRevision,
    #[error("Numeric field '{field}' value {value} out of bounds ({min}..={max})")]
    NumericOutOfBounds {
        field: &'static str,
        value: u64,
        min: u64,
        max: u64,
    },
    #[error("Producer sequence cannot be zero")]
    ZeroSequence,
}

/// Standard error types encountered when emitting/persisting server events.
#[derive(Debug, Error)]
pub enum EventWriteError {
    #[error("Event validation error: {0}")]
    Validation(#[from] EventValidationError),
    #[error("Failed to read system boot ID")]
    BootIdRead,
    #[error("Invalid system boot ID: {0}")]
    BootIdInvalid(String),
    #[error("Event serialization failed: {0}")]
    Serialization(String),
    #[error("Serialized event line exceeds maximum size of {0} bytes: {1} bytes")]
    LineTooLarge(usize, usize),
    #[error("Producer sequence reached maximum value (overflow)")]
    SequenceOverflow,
    #[error("Event writer permanently disabled")]
    Disabled,
    #[error("Event destination parent path rejected: must be an existing 0700 directory owned by effective UID/GID without symlinks")]
    ParentPathRejected,
    #[error("Event destination file rejected: must be a regular 0600 file owned by effective UID/GID without symlinks")]
    FileSecurityRejected,
    #[error("I/O error while writing event: {0}")]
    Io(String),
}

/// Strictly validated canonical lowercase RFC 4122 UUID v4 string for action correlation.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ActionCorrelationId {
    raw: String,
}

impl ActionCorrelationId {
    /// Generate a new cryptographically random UUID v4 correlation ID.
    pub fn new_v4() -> Self {
        Self {
            raw: uuid::Uuid::new_v4().to_string(),
        }
    }

    /// Parse and strictly validate a canonical lowercase UUID v4 string.
    pub fn parse(s: &str) -> Result<Self, EventValidationError> {
        validate_canonical_uuid_v4(s)?;
        Ok(Self { raw: s.to_string() })
    }

    /// String view of the correlation ID for helper IPC wire protocol and queries.
    pub fn as_str(&self) -> &str {
        &self.raw
    }

    /// Convert into owned string without reallocation.
    pub fn into_string(self) -> String {
        self.raw
    }
}

impl Serialize for ActionCorrelationId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.raw)
    }
}

impl<'de> Deserialize<'de> for ActionCorrelationId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Self::parse(&s).map_err(serde::de::Error::custom)
    }
}

impl TryFrom<String> for ActionCorrelationId {
    type Error = EventValidationError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<ActionCorrelationId> for String {
    fn from(value: ActionCorrelationId) -> Self {
        value.raw
    }
}

/// Validates that a string is a strictly canonical lowercase RFC 4122 UUID string.
pub fn validate_canonical_uuid(s: &str) -> Result<(), EventValidationError> {
    if s.len() != 36 {
        return Err(EventValidationError::InvalidUuid(format!(
            "Length must be exactly 36 characters, got {}",
            s.len()
        )));
    }
    let b = s.as_bytes();
    for (i, &byte) in b.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            if byte != b'-' {
                return Err(EventValidationError::InvalidUuid(format!(
                    "Expected '-' at index {i}, got '{}'",
                    byte as char
                )));
            }
        } else if !byte.is_ascii_digit() && !(b'a'..=b'f').contains(&byte) {
            return Err(EventValidationError::InvalidUuid(format!(
                "Expected lowercase hex at index {i}, got '{}'",
                byte as char
            )));
        }
    }
    Ok(())
}

/// Validates that a string is a canonical lowercase RFC 4122 UUID v4 string.
pub fn validate_canonical_uuid_v4(s: &str) -> Result<(), EventValidationError> {
    validate_canonical_uuid(s)?;
    if s.as_bytes()[14] != b'4' {
        return Err(EventValidationError::NotUuidV4(format!(
            "UUID version nibble at index 14 must be '4', got '{}'",
            s.as_bytes()[14] as char
        )));
    }
    Ok(())
}

/// Automatic policy variant reported in coordinator started event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomaticPolicyV1 {
    EmptyFleet,
    AgentActivity,
}

/// Closed mode enum for attempt-scoped server events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdleSuspendModeV1 {
    Automatic,
    Manual,
}

impl IdleSuspendModeV1 {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::Manual => "manual",
        }
    }
}

/// Closed event type enum for the 14 server semantic event types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerIdleSuspendEventTypeV1 {
    CoordinatorStarted,
    AttemptStarted,
    ArmStarted,
    ArmCancelled,
    MeasurementUnavailable,
    MeasurementRecovered,
    FinalCheckStarted,
    FinalCheckCompleted,
    HandoffClaimAccepted,
    HandoffClaimRejected,
    HelperRequestDispatched,
    HelperOutcomeReceived,
    ReconciliationCompleted,
    TerminalRejected,
}

impl ServerIdleSuspendEventTypeV1 {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CoordinatorStarted => "coordinatorStarted",
            Self::AttemptStarted => "attemptStarted",
            Self::ArmStarted => "armStarted",
            Self::ArmCancelled => "armCancelled",
            Self::MeasurementUnavailable => "measurementUnavailable",
            Self::MeasurementRecovered => "measurementRecovered",
            Self::FinalCheckStarted => "finalCheckStarted",
            Self::FinalCheckCompleted => "finalCheckCompleted",
            Self::HandoffClaimAccepted => "handoffClaimAccepted",
            Self::HandoffClaimRejected => "handoffClaimRejected",
            Self::HelperRequestDispatched => "helperRequestDispatched",
            Self::HelperOutcomeReceived => "helperOutcomeReceived",
            Self::ReconciliationCompleted => "reconciliationCompleted",
            Self::TerminalRejected => "terminalRejected",
        }
    }

    /// Whether this event is attempt-scoped (requires non-null correlationId and mode).
    pub const fn is_attempt_scoped(&self) -> bool {
        !matches!(
            self,
            Self::CoordinatorStarted | Self::MeasurementUnavailable | Self::MeasurementRecovered
        )
    }
}

/// Closed set of exactly 26 frozen reason codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerIdleSuspendReasonCodeV1 {
    PolicyDisabled,
    StartupGuard,
    EmptyFleet,
    ActiveFleet,
    RecentInput,
    RecentOutput,
    RecentNetwork,
    MeasurementUnavailable,
    StaleActivityRevision,
    StaleFleetGeneration,
    GraceCancelled,
    FinalCheckFailed,
    HandoffBusy,
    HandoffLost,
    HelperUnavailable,
    CapabilityUnsupported,
    InhibitorPresent,
    Shutdown,
    AuditWriteFailed,
    ProtocolInvalid,
    DuplicateRequest,
    RtcBusy,
    RtcProgrammingFailed,
    SuspendFailed,
    SuspendReturned,
    ResumedSuccessfully,
}

impl ServerIdleSuspendReasonCodeV1 {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::PolicyDisabled => "policyDisabled",
            Self::StartupGuard => "startupGuard",
            Self::EmptyFleet => "emptyFleet",
            Self::ActiveFleet => "activeFleet",
            Self::RecentInput => "recentInput",
            Self::RecentOutput => "recentOutput",
            Self::RecentNetwork => "recentNetwork",
            Self::MeasurementUnavailable => "measurementUnavailable",
            Self::StaleActivityRevision => "staleActivityRevision",
            Self::StaleFleetGeneration => "staleFleetGeneration",
            Self::GraceCancelled => "graceCancelled",
            Self::FinalCheckFailed => "finalCheckFailed",
            Self::HandoffBusy => "handoffBusy",
            Self::HandoffLost => "handoffLost",
            Self::HelperUnavailable => "helperUnavailable",
            Self::CapabilityUnsupported => "capabilityUnsupported",
            Self::InhibitorPresent => "inhibitorPresent",
            Self::Shutdown => "shutdown",
            Self::AuditWriteFailed => "auditWriteFailed",
            Self::ProtocolInvalid => "protocolInvalid",
            Self::DuplicateRequest => "duplicateRequest",
            Self::RtcBusy => "rtcBusy",
            Self::RtcProgrammingFailed => "rtcProgrammingFailed",
            Self::SuspendFailed => "suspendFailed",
            Self::SuspendReturned => "suspendReturned",
            Self::ResumedSuccessfully => "resumedSuccessfully",
        }
    }

    /// R_ARM subset for armCancelled.
    pub const fn is_arm_cancellation_reason(&self) -> bool {
        matches!(
            self,
            Self::RecentInput
                | Self::RecentOutput
                | Self::RecentNetwork
                | Self::StaleActivityRevision
                | Self::StaleFleetGeneration
                | Self::ActiveFleet
                | Self::GraceCancelled
                | Self::Shutdown
        )
    }

    /// R_FINAL subset for finalCheckCompleted failure.
    pub const fn is_final_check_failure_reason(&self) -> bool {
        matches!(
            self,
            Self::FinalCheckFailed
                | Self::RecentInput
                | Self::RecentOutput
                | Self::RecentNetwork
                | Self::MeasurementUnavailable
                | Self::StaleActivityRevision
                | Self::StaleFleetGeneration
                | Self::ActiveFleet
                | Self::Shutdown
        )
    }

    /// R_HANDOFF subset for handoffClaimRejected.
    pub const fn is_handoff_rejection_reason(&self) -> bool {
        matches!(
            self,
            Self::HandoffBusy
                | Self::HandoffLost
                | Self::StaleFleetGeneration
                | Self::ActiveFleet
                | Self::Shutdown
        )
    }

    /// R_OUTCOME subset for helperOutcomeReceived and reconciliationCompleted.
    pub const fn is_outcome_reason(&self) -> bool {
        matches!(
            self,
            Self::ResumedSuccessfully
                | Self::ActiveFleet
                | Self::InhibitorPresent
                | Self::CapabilityUnsupported
                | Self::RtcBusy
                | Self::RtcProgrammingFailed
                | Self::SuspendFailed
                | Self::SuspendReturned
                | Self::HelperUnavailable
                | Self::ProtocolInvalid
                | Self::DuplicateRequest
        )
    }

    /// R_TERMINAL subset for terminalRejected.
    pub const fn is_terminal_rejection_reason(&self) -> bool {
        matches!(
            self,
            Self::PolicyDisabled
                | Self::StartupGuard
                | Self::EmptyFleet
                | Self::ActiveFleet
                | Self::RecentInput
                | Self::RecentOutput
                | Self::RecentNetwork
                | Self::MeasurementUnavailable
                | Self::StaleActivityRevision
                | Self::StaleFleetGeneration
                | Self::FinalCheckFailed
                | Self::HandoffBusy
                | Self::HandoffLost
                | Self::HelperUnavailable
                | Self::CapabilityUnsupported
                | Self::Shutdown
                | Self::AuditWriteFailed
                | Self::ProtocolInvalid
        )
    }
}

// ---------------- Event-specific Payload Structs ----------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoordinatorStartedDataV1 {
    pub automatic_policy: AutomaticPolicyV1,
    pub quiet_period_seconds: u64,
    pub wake_after_seconds: u64,
    pub timing_revision: u64,
    pub status_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptStartedDataV1 {
    pub fleet_generation: u64,
    pub activity_revision: Option<u64>,
    pub timing_revision: u64,
    pub status_revision: u64,
    pub wake_after_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArmStartedDataV1 {
    pub fleet_generation: u64,
    pub activity_revision: Option<u64>,
    pub quiet_period_seconds: u64,
    pub deadline_after_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArmCancelledDataV1 {
    pub reason_code: ServerIdleSuspendReasonCodeV1,
    pub fleet_generation: u64,
    pub activity_revision: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasurementUnavailableDataV1 {
    pub reason_code: ServerIdleSuspendReasonCodeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasurementRecoveredDataV1 {
    pub activity_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalCheckStartedDataV1 {
    pub fleet_generation: u64,
    pub activity_revision: Option<u64>,
    pub timing_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalCheckCompletedDataV1 {
    pub accepted: bool,
    pub reason_code: Option<ServerIdleSuspendReasonCodeV1>,
    pub fleet_generation: u64,
    pub activity_revision: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandoffClaimAcceptedDataV1 {
    pub fleet_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandoffClaimRejectedDataV1 {
    pub reason_code: ServerIdleSuspendReasonCodeV1,
    pub expected_fleet_generation: Option<u64>,
    pub actual_fleet_generation: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperRequestDispatchedDataV1 {
    pub wake_after_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperOutcomeReceivedDataV1 {
    pub reason_code: ServerIdleSuspendReasonCodeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconciliationCompletedDataV1 {
    pub reason_code: ServerIdleSuspendReasonCodeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalRejectedDataV1 {
    pub reason_code: ServerIdleSuspendReasonCodeV1,
    pub fleet_generation: Option<u64>,
    pub activity_revision: Option<u64>,
}

/// Closed enum containing exactly one typed payload matching the event type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdleSuspendEventDataV1 {
    CoordinatorStarted(CoordinatorStartedDataV1),
    AttemptStarted(AttemptStartedDataV1),
    ArmStarted(ArmStartedDataV1),
    ArmCancelled(ArmCancelledDataV1),
    MeasurementUnavailable(MeasurementUnavailableDataV1),
    MeasurementRecovered(MeasurementRecoveredDataV1),
    FinalCheckStarted(FinalCheckStartedDataV1),
    FinalCheckCompleted(FinalCheckCompletedDataV1),
    HandoffClaimAccepted(HandoffClaimAcceptedDataV1),
    HandoffClaimRejected(HandoffClaimRejectedDataV1),
    HelperRequestDispatched(HelperRequestDispatchedDataV1),
    HelperOutcomeReceived(HelperOutcomeReceivedDataV1),
    ReconciliationCompleted(ReconciliationCompletedDataV1),
    TerminalRejected(TerminalRejectedDataV1),
}

impl IdleSuspendEventDataV1 {
    pub const fn event_type(&self) -> ServerIdleSuspendEventTypeV1 {
        match self {
            Self::CoordinatorStarted(_) => ServerIdleSuspendEventTypeV1::CoordinatorStarted,
            Self::AttemptStarted(_) => ServerIdleSuspendEventTypeV1::AttemptStarted,
            Self::ArmStarted(_) => ServerIdleSuspendEventTypeV1::ArmStarted,
            Self::ArmCancelled(_) => ServerIdleSuspendEventTypeV1::ArmCancelled,
            Self::MeasurementUnavailable(_) => {
                ServerIdleSuspendEventTypeV1::MeasurementUnavailable
            }
            Self::MeasurementRecovered(_) => ServerIdleSuspendEventTypeV1::MeasurementRecovered,
            Self::FinalCheckStarted(_) => ServerIdleSuspendEventTypeV1::FinalCheckStarted,
            Self::FinalCheckCompleted(_) => ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
            Self::HandoffClaimAccepted(_) => ServerIdleSuspendEventTypeV1::HandoffClaimAccepted,
            Self::HandoffClaimRejected(_) => ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
            Self::HelperRequestDispatched(_) => {
                ServerIdleSuspendEventTypeV1::HelperRequestDispatched
            }
            Self::HelperOutcomeReceived(_) => ServerIdleSuspendEventTypeV1::HelperOutcomeReceived,
            Self::ReconciliationCompleted(_) => {
                ServerIdleSuspendEventTypeV1::ReconciliationCompleted
            }
            Self::TerminalRejected(_) => ServerIdleSuspendEventTypeV1::TerminalRejected,
        }
    }
}

impl Serialize for IdleSuspendEventDataV1 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::CoordinatorStarted(d) => d.serialize(serializer),
            Self::AttemptStarted(d) => d.serialize(serializer),
            Self::ArmStarted(d) => d.serialize(serializer),
            Self::ArmCancelled(d) => d.serialize(serializer),
            Self::MeasurementUnavailable(d) => d.serialize(serializer),
            Self::MeasurementRecovered(d) => d.serialize(serializer),
            Self::FinalCheckStarted(d) => d.serialize(serializer),
            Self::FinalCheckCompleted(d) => d.serialize(serializer),
            Self::HandoffClaimAccepted(d) => d.serialize(serializer),
            Self::HandoffClaimRejected(d) => d.serialize(serializer),
            Self::HelperRequestDispatched(d) => d.serialize(serializer),
            Self::HelperOutcomeReceived(d) => d.serialize(serializer),
            Self::ReconciliationCompleted(d) => d.serialize(serializer),
            Self::TerminalRejected(d) => d.serialize(serializer),
        }
    }
}

/// Universal camelCase, deny-unknown-fields event envelope for server idle suspend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdleSuspendEventEnvelopeV1 {
    pub event_schema_version: u32,
    pub timestamp_ms: u64,
    pub boot_id: String,
    pub producer_instance_id: String,
    pub producer_sequence: u64,
    pub event_type: ServerIdleSuspendEventTypeV1,
    pub correlation_id: Option<String>,
    pub mode: Option<IdleSuspendModeV1>,
    pub data: IdleSuspendEventDataV1,
}

impl IdleSuspendEventEnvelopeV1 {
    /// Validates all normative envelope invariants, correlation/mode rules, bounds, and reason subsets.
    pub fn validate(&self) -> Result<(), EventValidationError> {
        if self.event_schema_version != IDLE_SUSPEND_EVENT_SCHEMA_VERSION {
            return Err(EventValidationError::InvalidSchemaVersion {
                expected: IDLE_SUSPEND_EVENT_SCHEMA_VERSION,
                got: self.event_schema_version,
            });
        }
        if self.producer_sequence == 0 {
            return Err(EventValidationError::ZeroSequence);
        }
        validate_canonical_uuid(&self.boot_id)?;
        validate_canonical_uuid_v4(&self.producer_instance_id)?;

        let event_type = self.event_type;
        if self.data.event_type() != event_type {
            return Err(EventValidationError::PayloadTypeMismatch {
                event_type: event_type.as_str(),
            });
        }

        // Scope and correlation / mode legality
        if event_type.is_attempt_scoped() {
            let corr = self
                .correlation_id
                .as_deref()
                .ok_or(EventValidationError::MissingCorrelationId {
                    event_type: event_type.as_str(),
                })?;
            validate_canonical_uuid_v4(corr)?;
            // Also assert compatibility with helper protocol request_id
            validate_request_id(corr)
                .map_err(|e| EventValidationError::InvalidUuid(e.to_string()))?;

            let mode = self
                .mode
                .ok_or(EventValidationError::MissingMode {
                    event_type: event_type.as_str(),
                })?;

            // armStarted and armCancelled are strictly automatic
            if (event_type == ServerIdleSuspendEventTypeV1::ArmStarted
                || event_type == ServerIdleSuspendEventTypeV1::ArmCancelled)
                && mode != IdleSuspendModeV1::Automatic
            {
                return Err(EventValidationError::InvalidModeForEvent {
                    event_type: event_type.as_str(),
                    mode: mode.as_str(),
                });
            }
        } else {
            if self.correlation_id.is_some() {
                return Err(EventValidationError::ForbiddenCorrelationId {
                    event_type: event_type.as_str(),
                });
            }
            if self.mode.is_some() {
                return Err(EventValidationError::ForbiddenMode {
                    event_type: event_type.as_str(),
                });
            }
        }

        // Payload-specific bounds and reason subsets
        match &self.data {
            IdleSuspendEventDataV1::CoordinatorStarted(d) => {
                validate_quiet_period(d.quiet_period_seconds)?;
                validate_wake_duration(d.wake_after_seconds)?;
            }
            IdleSuspendEventDataV1::AttemptStarted(d) => {
                validate_wake_duration(d.wake_after_seconds)?;
                if self.mode == Some(IdleSuspendModeV1::Manual) && d.activity_revision.is_some() {
                    return Err(EventValidationError::ManualAttemptWithActivityRevision);
                }
            }
            IdleSuspendEventDataV1::ArmStarted(d) => {
                validate_quiet_period(d.quiet_period_seconds)?;
                if !(1..=MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS).contains(&d.deadline_after_seconds) {
                    return Err(EventValidationError::NumericOutOfBounds {
                        field: "deadlineAfterSeconds",
                        value: d.deadline_after_seconds,
                        min: 1,
                        max: MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
                    });
                }
            }
            IdleSuspendEventDataV1::ArmCancelled(d) => {
                if !d.reason_code.is_arm_cancellation_reason() {
                    return Err(EventValidationError::ForbiddenReasonCode {
                        event_type: event_type.as_str(),
                        code: d.reason_code.as_str(),
                    });
                }
            }
            IdleSuspendEventDataV1::MeasurementUnavailable(d) => {
                if d.reason_code != ServerIdleSuspendReasonCodeV1::MeasurementUnavailable {
                    return Err(EventValidationError::ForbiddenReasonCode {
                        event_type: event_type.as_str(),
                        code: d.reason_code.as_str(),
                    });
                }
            }
            IdleSuspendEventDataV1::MeasurementRecovered(_) => {}
            IdleSuspendEventDataV1::FinalCheckStarted(_) => {}
            IdleSuspendEventDataV1::FinalCheckCompleted(d) => {
                if d.accepted {
                    if d.reason_code.is_some() {
                        return Err(EventValidationError::FinalCheckAcceptedWithReason);
                    }
                } else {
                    let r = d
                        .reason_code
                        .ok_or(EventValidationError::FinalCheckRejectedWithoutReason)?;
                    if !r.is_final_check_failure_reason() {
                        return Err(EventValidationError::ForbiddenReasonCode {
                            event_type: event_type.as_str(),
                            code: r.as_str(),
                        });
                    }
                }
            }
            IdleSuspendEventDataV1::HandoffClaimAccepted(_) => {}
            IdleSuspendEventDataV1::HandoffClaimRejected(d) => {
                if !d.reason_code.is_handoff_rejection_reason() {
                    return Err(EventValidationError::ForbiddenReasonCode {
                        event_type: event_type.as_str(),
                        code: d.reason_code.as_str(),
                    });
                }
                if d.reason_code == ServerIdleSuspendReasonCodeV1::StaleFleetGeneration {
                    if d.expected_fleet_generation.is_none() || d.actual_fleet_generation.is_none() {
                        return Err(
                            EventValidationError::HandoffStaleGenerationMissingGenerations,
                        );
                    }
                } else if d.expected_fleet_generation.is_some()
                    || d.actual_fleet_generation.is_some()
                {
                    return Err(EventValidationError::HandoffRejectionForbiddenGenerations(
                        d.reason_code.as_str(),
                    ));
                }
            }
            IdleSuspendEventDataV1::HelperRequestDispatched(d) => {
                validate_wake_duration(d.wake_after_seconds)?;
            }
            IdleSuspendEventDataV1::HelperOutcomeReceived(d) => {
                if !d.reason_code.is_outcome_reason() {
                    return Err(EventValidationError::ForbiddenReasonCode {
                        event_type: event_type.as_str(),
                        code: d.reason_code.as_str(),
                    });
                }
            }
            IdleSuspendEventDataV1::ReconciliationCompleted(d) => {
                if !d.reason_code.is_outcome_reason() {
                    return Err(EventValidationError::ForbiddenReasonCode {
                        event_type: event_type.as_str(),
                        code: d.reason_code.as_str(),
                    });
                }
            }
            IdleSuspendEventDataV1::TerminalRejected(d) => {
                if !d.reason_code.is_terminal_rejection_reason() {
                    return Err(EventValidationError::ForbiddenReasonCode {
                        event_type: event_type.as_str(),
                        code: d.reason_code.as_str(),
                    });
                }
            }
        }

        Ok(())
    }
}

impl<'de> Deserialize<'de> for IdleSuspendEventEnvelopeV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct RawEnvelope {
            event_schema_version: u32,
            timestamp_ms: u64,
            boot_id: String,
            producer_instance_id: String,
            producer_sequence: u64,
            event_type: ServerIdleSuspendEventTypeV1,
            correlation_id: Option<String>,
            mode: Option<IdleSuspendModeV1>,
            data: serde_json::Value,
        }

        let raw = RawEnvelope::deserialize(deserializer)?;
        let data = match raw.event_type {
            ServerIdleSuspendEventTypeV1::CoordinatorStarted => {
                IdleSuspendEventDataV1::CoordinatorStarted(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::AttemptStarted => {
                IdleSuspendEventDataV1::AttemptStarted(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::ArmStarted => IdleSuspendEventDataV1::ArmStarted(
                serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
            ),
            ServerIdleSuspendEventTypeV1::ArmCancelled => IdleSuspendEventDataV1::ArmCancelled(
                serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
            ),
            ServerIdleSuspendEventTypeV1::MeasurementUnavailable => {
                IdleSuspendEventDataV1::MeasurementUnavailable(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::MeasurementRecovered => {
                IdleSuspendEventDataV1::MeasurementRecovered(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::FinalCheckStarted => {
                IdleSuspendEventDataV1::FinalCheckStarted(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::FinalCheckCompleted => {
                IdleSuspendEventDataV1::FinalCheckCompleted(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::HandoffClaimAccepted => {
                IdleSuspendEventDataV1::HandoffClaimAccepted(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::HandoffClaimRejected => {
                IdleSuspendEventDataV1::HandoffClaimRejected(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::HelperRequestDispatched => {
                IdleSuspendEventDataV1::HelperRequestDispatched(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::HelperOutcomeReceived => {
                IdleSuspendEventDataV1::HelperOutcomeReceived(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::ReconciliationCompleted => {
                IdleSuspendEventDataV1::ReconciliationCompleted(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
            ServerIdleSuspendEventTypeV1::TerminalRejected => {
                IdleSuspendEventDataV1::TerminalRejected(
                    serde_json::from_value(raw.data).map_err(serde::de::Error::custom)?,
                )
            }
        };

        let envelope = Self {
            event_schema_version: raw.event_schema_version,
            timestamp_ms: raw.timestamp_ms,
            boot_id: raw.boot_id,
            producer_instance_id: raw.producer_instance_id,
            producer_sequence: raw.producer_sequence,
            event_type: raw.event_type,
            correlation_id: raw.correlation_id,
            mode: raw.mode,
            data,
        };

        envelope.validate().map_err(serde::de::Error::custom)?;
        Ok(envelope)
    }
}

fn validate_quiet_period(v: u64) -> Result<(), EventValidationError> {
    if !(MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS..=MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS).contains(&v)
    {
        return Err(EventValidationError::NumericOutOfBounds {
            field: "quietPeriodSeconds",
            value: v,
            min: MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            max: MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        });
    }
    Ok(())
}

fn validate_wake_duration(v: u64) -> Result<(), EventValidationError> {
    if v == 0
        || (v >= MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS && v <= MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS)
    {
        Ok(())
    } else {
        Err(EventValidationError::NumericOutOfBounds {
            field: "wakeAfterSeconds",
            value: v,
            min: MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            max: MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
        })
    }
}

/// Producer identity combining host boot ID and process instance UUID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProducerIdentity {
    pub boot_id: String,
    pub producer_instance_id: String,
}

impl ProducerIdentity {
    /// Read production host boot_id from /proc/sys/kernel/random/boot_id and generate a UUID v4 instance ID.
    #[cfg(target_os = "linux")]
    pub fn load() -> Result<Self, EventWriteError> {
        Self::load_from_path(Path::new("/proc/sys/kernel/random/boot_id"))
    }

    #[cfg(windows)]
    pub fn load() -> Result<Self, EventWriteError> {
        Ok(Self {
            boot_id: uuid::Uuid::new_v4().to_string(),
            producer_instance_id: uuid::Uuid::new_v4().to_string(),
        })
    }

    /// Crate-private loader from an explicit boot_id path.
    pub(crate) fn load_from_path(path: &Path) -> Result<Self, EventWriteError> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let mut file = options
            .open(path)
            .map_err(|_| EventWriteError::BootIdRead)?;
        let metadata = file
            .metadata()
            .map_err(|_| EventWriteError::BootIdRead)?;
        if !metadata.file_type().is_file() {
            return Err(EventWriteError::BootIdRead);
        }

        use std::io::Read;
        let mut buf = [0u8; MAX_BOOT_ID_READ_BYTES];
        let bytes_read = file
            .read(&mut buf)
            .map_err(|_| EventWriteError::BootIdRead)?;
        let raw_str = std::str::from_utf8(&buf[..bytes_read])
            .map_err(|_| EventWriteError::BootIdRead)?
            .trim();

        validate_canonical_uuid(raw_str)
            .map_err(|e| EventWriteError::BootIdInvalid(e.to_string()))?;

        Ok(Self {
            boot_id: raw_str.to_string(),
            producer_instance_id: uuid::Uuid::new_v4().to_string(),
        })
    }

    /// Explicit deterministic constructor for tests.
    pub fn with_ids(
        boot_id: String,
        producer_instance_id: String,
    ) -> Result<Self, EventValidationError> {
        validate_canonical_uuid(&boot_id)?;
        validate_canonical_uuid_v4(&producer_instance_id)?;
        Ok(Self {
            boot_id,
            producer_instance_id,
        })
    }
}

/// Internal state tracked under the writer mutex.
struct WriterState {
    next_sequence: u64,
    disabled: bool,
}

/// Hardened synchronized writer for server idle suspend canonical semantic events.
#[derive(Clone)]
pub struct IdleSuspendEventWriter {
    path: Arc<PathBuf>,
    identity: ProducerIdentity,
    state: Arc<Mutex<WriterState>>,
}

impl IdleSuspendEventWriter {
    /// Production constructor loading identity from host environment.
    pub fn new(path: PathBuf) -> Result<Self, EventWriteError> {
        let identity = ProducerIdentity::load()?;
        Ok(Self::with_identity(path, identity))
    }

    /// Deterministic constructor accepting custom identity and path.
    pub fn with_identity(path: PathBuf, identity: ProducerIdentity) -> Self {
        Self {
            path: Arc::new(path),
            identity,
            state: Arc::new(Mutex::new(WriterState {
                next_sequence: 1,
                disabled: false,
            })),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn identity(&self) -> &ProducerIdentity {
        &self.identity
    }
    #[cfg(test)]
    pub(crate) fn set_sequence_for_test(&self, seq: u64) {
        let mut state = self.state.lock();
        state.next_sequence = seq;
    }


    /// Emit one canonical event: validates input, reserves next sequence under lock,
    /// serializes into bounded line, appends to verified regular 0600 file, and syncs.
    pub fn emit(
        &self,
        timestamp_ms: u64,
        event_type: ServerIdleSuspendEventTypeV1,
        correlation_id: Option<&ActionCorrelationId>,
        mode: Option<IdleSuspendModeV1>,
        data: IdleSuspendEventDataV1,
    ) -> Result<IdleSuspendEventEnvelopeV1, EventWriteError> {
        // 1. Validation before sequence reservation
        if data.event_type() != event_type {
            return Err(EventValidationError::PayloadTypeMismatch {
                event_type: event_type.as_str(),
            }
            .into());
        }

        let correlation_id_str = correlation_id.map(|c| c.as_str().to_string());
        let provisional = IdleSuspendEventEnvelopeV1 {
            event_schema_version: IDLE_SUSPEND_EVENT_SCHEMA_VERSION,
            timestamp_ms,
            boot_id: self.identity.boot_id.clone(),
            producer_instance_id: self.identity.producer_instance_id.clone(),
            producer_sequence: 1, // placeholder for early validation
            event_type,
            correlation_id: correlation_id_str.clone(),
            mode,
            data,
        };
        provisional.validate()?;

        // 2. Lock to allocate sequence and perform I/O
        let mut state = self.state.lock();
        if state.disabled {
            return Err(EventWriteError::Disabled);
        }

        if state.next_sequence == u64::MAX {
            state.disabled = true;
            return Err(EventWriteError::SequenceOverflow);
        }

        let seq = state.next_sequence;
        state.next_sequence += 1;

        let envelope = IdleSuspendEventEnvelopeV1 {
            event_schema_version: IDLE_SUSPEND_EVENT_SCHEMA_VERSION,
            timestamp_ms,
            boot_id: self.identity.boot_id.clone(),
            producer_instance_id: self.identity.producer_instance_id.clone(),
            producer_sequence: seq,
            event_type,
            correlation_id: correlation_id_str,
            mode,
            data: provisional.data,
        };

        // 3. Serialize bounded JSON line
        let mut line = serde_json::to_string(&envelope)
            .map_err(|e| EventWriteError::Serialization(e.to_string()))?;
        line.push('\n');

        if line.len() > MAX_EVENT_LINE_BYTES {
            return Err(EventWriteError::LineTooLarge(
                MAX_EVENT_LINE_BYTES,
                line.len(),
            ));
        }

        // 4. File append & sync
        self.append_and_sync_verified(line.as_bytes())?;

        Ok(envelope)
    }

    /// Low-level safe file opening, verification, append and sync.
    fn append_and_sync_verified(&self, line_bytes: &[u8]) -> Result<(), EventWriteError> {
        #[cfg(unix)]
        let parent = self
            .path
            .parent()
            .ok_or(EventWriteError::ParentPathRejected)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

            // Enforce parent directory security: must exist, regular dir, no symlinks, exact mode 0700 owned by effective UID/GID
            let parent_meta = std::fs::symlink_metadata(parent)
                .map_err(|_| EventWriteError::ParentPathRejected)?;
            let expected_uid = unsafe { libc::geteuid() };
            let expected_gid = unsafe { libc::getegid() };

            if !parent_meta.file_type().is_dir()
                || parent_meta.file_type().is_symlink()
                || parent_meta.uid() != expected_uid
                || parent_meta.gid() != expected_gid
                || parent_meta.mode() & 0o7777 != 0o700
            {
                return Err(EventWriteError::ParentPathRejected);
            }

            let mut options = OpenOptions::new();
            options.create(true).write(true).append(true);
            options.mode(0o600);
            options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);

            let mut file = options
                .open(&*self.path)
                .map_err(|_| EventWriteError::FileSecurityRejected)?;

            let meta = file
                .metadata()
                .map_err(|_| EventWriteError::FileSecurityRejected)?;

            if !meta.file_type().is_file()
                || meta.uid() != expected_uid
                || meta.gid() != expected_gid
                || meta.mode() & 0o7777 != 0o600
            {
                return Err(EventWriteError::FileSecurityRejected);
            }

            file.write_all(line_bytes)
                .map_err(|e| EventWriteError::Io(format!("write: {e}")))?;
            file.sync_data()
                .map_err(|e| EventWriteError::Io(format!("sync: {e}")))?;
        }

        #[cfg(windows)]
        {
            let mut options = OpenOptions::new();
            options.create(true).write(true).append(true);
            let mut file = options
                .open(&*self.path)
                .map_err(|_| EventWriteError::FileSecurityRejected)?;
            file.write_all(line_bytes)
                .map_err(|e| EventWriteError::Io(format!("write: {e}")))?;
            file.sync_data()
                .map_err(|e| EventWriteError::Io(format!("sync: {e}")))?;
        }

        Ok(())
    }
}
