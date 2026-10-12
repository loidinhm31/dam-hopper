use serde::{Deserialize, Serialize};

use crate::pty::PtyFleetSnapshot;

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
/// Push event payload for `host:idleSuspendChanged`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendChangedPayload {
    pub version: u32,
    pub revision: u64,
}

impl IdleSuspendChangedPayload {
    pub fn new(revision: u64) -> Self {
        Self {
            version: 1,
            revision,
        }
    }
}

/// Exact payload for `POST /api/system/idle-suspend/v1/force-suspend`.
///
/// Disallows unknown fields and requires both integer wake duration and boolean force flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForceSuspendRequest {
    pub wake_after_seconds: u64,
    pub force: bool,
}

/// Accepted response for `POST /api/system/idle-suspend/v1/force-suspend` (202 Accepted).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceSuspendAcceptedResponse {
    pub version: u32,
    pub request_id: String,
    pub status_revision: u64,
    pub state: String,
    pub wake_after_seconds: u64,
    pub forced: bool,
    pub fleet_snapshot: PtyFleetSnapshot,
}

impl ForceSuspendAcceptedResponse {
    pub fn new(
        request_id: String,
        status_revision: u64,
        wake_after_seconds: u64,
        forced: bool,
        fleet_snapshot: PtyFleetSnapshot,
    ) -> Self {
        Self {
            version: 1,
            request_id,
            status_revision,
            state: "handedOff".to_string(),
            wake_after_seconds,
            forced,
            fleet_snapshot,
        }
    }
}

/// Conflict response for `POST /api/system/idle-suspend/v1/force-suspend` (409 Conflict).
///
/// Returned when active fleet requires confirmation or generation changes during review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendConflictResponse {
    pub error: String,
    pub code: String,
    pub active_session_count: usize,
    pub fleet_snapshot: PtyFleetSnapshot,
}

impl IdleSuspendConflictResponse {
    pub fn new(
        code: &'static str,
        error: impl Into<String>,
        fleet_snapshot: PtyFleetSnapshot,
    ) -> Self {
        Self {
            error: error.into(),
            code: code.to_string(),
            active_session_count: fleet_snapshot.running_count(),
            fleet_snapshot,
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
    ActiveFleetConfirmationRequired,
    FleetChanged,
    InvalidForceSuspendPayload,
    ForceSuspendDisabledNoAuth,
    CapabilityUnavailable,
    HelperUnavailable,
    Inhibited,
    ProbeTimeout,
    RtcBusy,
    ForceSuspendAuditUnavailable,
    CoordinatorShuttingDown,
    CoordinatorDisabled,
    DecisionAlreadySettled,
    ConsentExpired,
    ConsentCancelled,
    InvalidCapability,
    ConnectionNotFound,
    PresenceUnavailable,
    ConsentUnavailable,
    InvalidConsentPayload,
    ConsentDisabledNoAuth,
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
            Self::ActiveFleetConfirmationRequired => "idleSuspendActiveFleetConfirmationRequired",
            Self::FleetChanged => "idleSuspendFleetChanged",
            Self::InvalidForceSuspendPayload => "invalidForceSuspendPayload",
            Self::ForceSuspendDisabledNoAuth => "idleSuspendDisabledNoAuth",
            Self::CapabilityUnavailable => "idleSuspendCapabilityUnavailable",
            Self::HelperUnavailable => "idleSuspendHelperUnavailable",
            Self::Inhibited => "idleSuspendInhibited",
            Self::ProbeTimeout => "idleSuspendProbeTimeout",
            Self::RtcBusy => "idleSuspendRtcBusy",
            Self::ForceSuspendAuditUnavailable => "idleSuspendAuditUnavailable",
            Self::CoordinatorShuttingDown => "idleSuspendShuttingDown",
            Self::CoordinatorDisabled => "idleSuspendDisabled",
            Self::DecisionAlreadySettled => "decisionAlreadySettled",
            Self::ConsentExpired => "consentExpired",
            Self::ConsentCancelled => "consentCancelled",
            Self::InvalidCapability => "invalidCapability",
            Self::ConnectionNotFound => "connectionNotFound",
            Self::PresenceUnavailable => "presenceUnavailable",
            Self::ConsentUnavailable => "consentUnavailable",
            Self::InvalidConsentPayload => "invalidConsentPayload",
            Self::ConsentDisabledNoAuth => "consentDisabledNoAuth",
        }
    }
}

/// Binary decision payload value for consent decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentDecisionValue {
    Approve,
    Deny,
}

impl ConsentDecisionValue {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Deny => "deny",
        }
    }
}

/// Exact payload for `POST /api/system/idle-suspend/v1/consent/decision`.
///
/// Disallows unknown fields and bounds body memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsentDecisionRequest {
    pub request_id: String,
    pub request_revision: u64,
    pub connection_id: String,
    pub decision_capability: String,
    pub decision: ConsentDecisionValue,
}

/// Accepted response for `POST /api/system/idle-suspend/v1/consent/decision` (200 OK).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentDecisionResponse {
    pub version: u32,
    pub request_id: String,
    pub decision: ConsentDecisionValue,
    pub status_revision: u64,
    pub settled: bool,
}

/// Per-socket frame pushed strictly to individual public UI WebSocket connections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiConnectionFrame {
    pub kind: String,
    pub version: u32,
    pub connection_id: String,
    pub decision_capability: String,
}

impl UiConnectionFrame {
    pub const KIND: &'static str = "host:uiConnection";
    pub const VERSION: u32 = 1;

    pub fn new(connection_id: String, decision_capability: String) -> Self {
        Self {
            kind: Self::KIND.to_string(),
            version: Self::VERSION,
            connection_id,
            decision_capability,
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
    RejectedFleetActive { request_id: String, reason: String },
    /// An active sleep inhibitor blocked or delayed suspend.
    BlockedByInhibitor {
        request_id: String,
        inhibitor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        who: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        why: Option<String>,
    },
    /// The host lacks RTC alarm or suspend capability.
    UnsupportedCapability { request_id: String, detail: String },
    /// Execution failed with a fatal error.
    ExecutionFailed { request_id: String, error: String },
}

impl SuspendOutcome {
    /// Project a public-safe outcome with sanitized error strings per Requirement 48.
    pub fn public_safe(&self) -> Self {
        match self {
            Self::ResumedSuccessfully {
                request_id,
                elapsed_seconds,
            } => Self::ResumedSuccessfully {
                request_id: request_id.clone(),
                elapsed_seconds: *elapsed_seconds,
            },
            Self::RejectedFleetActive { request_id, .. } => Self::RejectedFleetActive {
                request_id: request_id.clone(),
                reason: "fleet activity detected before suspend".into(),
            },
            Self::BlockedByInhibitor { request_id, .. } => Self::BlockedByInhibitor {
                request_id: request_id.clone(),
                inhibitor: "active sleep inhibitor".into(),
                who: None,
                why: None,
            },
            Self::UnsupportedCapability { request_id, .. } => Self::UnsupportedCapability {
                request_id: request_id.clone(),
                detail: "required sleep capability unavailable".into(),
            },
            Self::ExecutionFailed { request_id, .. } => Self::ExecutionFailed {
                request_id: request_id.clone(),
                error: "host sleep execution failed".into(),
            },
        }
    }
}

/// Protocol version for privileged helper IPC.
pub const HELPER_PROTOCOL_VERSION: u32 = 2;

/// Maximum frame size in bytes (4 KiB) for helper IPC to bound memory and prevent DoS.
pub const MAX_HELPER_FRAME_BYTES: usize = 4096;

/// Standard error types encountered during helper protocol serialization/deserialization.
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("Frame length {0} exceeds maximum allowed {1} bytes")]
    FrameTooLarge(usize, usize),
    #[error("Empty frame length (0 bytes)")]
    EmptyFrame,
    #[error("Unexpected EOF while reading frame header")]
    UnexpectedEofHeader,
    #[error("Unexpected EOF while reading frame payload")]
    UnexpectedEofPayload,
    #[error("Trailing data detected after frame: {0} extra bytes")]
    TrailingData(usize),
    #[error("Invalid UTF-8 in frame payload: {0}")]
    InvalidUtf8(#[from] std::string::FromUtf8Error),
    #[error("Failed to parse JSON payload: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("Unsupported protocol version: expected {expected}, got {got}")]
    UnsupportedVersion { expected: u32, got: u32 },
    #[error("Invalid request ID: {0}")]
    InvalidRequestId(String),
    #[error("Invalid wake after seconds: {0}")]
    InvalidWakeSeconds(u64),
    #[error("Duplicate request ID rejected: {0}")]
    DuplicateRequestId(String),
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Invalid response payload: {0}")]
    InvalidResponse(String),
}

/// Closed taxonomy of capability probe failure reasons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeFailureReason {
    // Dimension 1: Transport & Connectivity
    SocketNotFound,
    SocketPermissionDenied,
    ConnectionRefused,
    PeerAuthFailed,
    IpcIoError,
    IpcProtocolError,
    ProtocolVersionMismatch,
    ProbeExecutionError,
    ProbeTimeout,
    ExecutorUnavailable,
    UnknownHelperFailure,

    // Dimension 2: Hardware Capability
    SuspendStateUnsupported,
    RtcAlarmMissing,

    // Dimension 3: Transient Readiness
    InhibitorPresent,
    RtcAlarmBusy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeDimension {
    TransportIpc,
    Hardware,
    TransientReadiness,
}

impl ProbeFailureReason {
    pub fn dimension(&self) -> ProbeDimension {
        match self {
            Self::SocketNotFound
            | Self::SocketPermissionDenied
            | Self::ConnectionRefused
            | Self::PeerAuthFailed
            | Self::IpcIoError
            | Self::IpcProtocolError
            | Self::ProtocolVersionMismatch
            | Self::ProbeExecutionError
            | Self::ProbeTimeout
            | Self::ExecutorUnavailable
            | Self::UnknownHelperFailure => ProbeDimension::TransportIpc,

            Self::SuspendStateUnsupported | Self::RtcAlarmMissing => ProbeDimension::Hardware,

            Self::InhibitorPresent | Self::RtcAlarmBusy => ProbeDimension::TransientReadiness,
        }
    }

    pub fn safe_code(&self) -> &'static str {
        match self {
            Self::SocketNotFound => "socketNotFound",
            Self::SocketPermissionDenied => "socketPermissionDenied",
            Self::ConnectionRefused => "connectionRefused",
            Self::PeerAuthFailed => "peerAuthFailed",
            Self::IpcIoError => "ipcIoError",
            Self::IpcProtocolError => "ipcProtocolError",
            Self::ProtocolVersionMismatch => "protocolVersionMismatch",
            Self::ProbeExecutionError => "probeExecutionError",
            Self::ProbeTimeout => "probeTimeout",
            Self::ExecutorUnavailable => "executorUnavailable",
            Self::UnknownHelperFailure => "unknownHelperFailure",
            Self::SuspendStateUnsupported => "suspendStateUnsupported",
            Self::RtcAlarmMissing => "rtcAlarmMissing",
            Self::InhibitorPresent => "inhibitorPresent",
            Self::RtcAlarmBusy => "rtcAlarmBusy",
        }
    }

    pub fn public_error(&self) -> (IdleSuspendErrorCode, &'static str) {
        match self {
            Self::InhibitorPresent => (
                IdleSuspendErrorCode::Inhibited,
                "host sleep is blocked by an active system inhibitor",
            ),
            Self::RtcAlarmBusy => (
                IdleSuspendErrorCode::RtcBusy,
                "host wake timer is currently in use",
            ),
            Self::ProbeTimeout => (
                IdleSuspendErrorCode::ProbeTimeout,
                "idle-suspend capability probe timed out",
            ),
            Self::SuspendStateUnsupported | Self::RtcAlarmMissing | Self::ExecutorUnavailable => (
                IdleSuspendErrorCode::CapabilityUnavailable,
                "host lacks required sleep or timed-wake capability",
            ),
            _ => (
                IdleSuspendErrorCode::HelperUnavailable,
                "idle-suspend helper is unavailable or inaccessible",
            ),
        }
    }

    pub fn event_reason_code(&self) -> crate::idle_suspend::event::ServerIdleSuspendReasonCodeV1 {
        match self {
            Self::InhibitorPresent => {
                crate::idle_suspend::event::ServerIdleSuspendReasonCodeV1::InhibitorPresent
            }
            Self::RtcAlarmBusy => {
                crate::idle_suspend::event::ServerIdleSuspendReasonCodeV1::RtcBusy
            }
            Self::SuspendStateUnsupported | Self::RtcAlarmMissing | Self::ExecutorUnavailable => {
                crate::idle_suspend::event::ServerIdleSuspendReasonCodeV1::CapabilityUnsupported
            }
            _ => crate::idle_suspend::event::ServerIdleSuspendReasonCodeV1::HelperUnavailable,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProbeDiagnostics {
    pub stage: Option<&'static str>,
    pub errno: Option<i32>,
    pub socket_path: Option<String>,
    pub actual_uid: Option<u32>,
    pub expected_uid: Option<u32>,
    pub actual_pid: Option<u32>,
    pub expected_pid: Option<u32>,
    pub bounded_detail: String,
}

#[derive(Debug, Clone)]
pub struct ProbeFailure {
    pub reason: ProbeFailureReason,
    pub diagnostics: ProbeDiagnostics,
}

impl ProbeFailure {
    pub fn timeout() -> Self {
        Self {
            reason: ProbeFailureReason::ProbeTimeout,
            diagnostics: ProbeDiagnostics {
                stage: Some("timeout"),
                errno: None,
                socket_path: None,
                actual_uid: None,
                expected_uid: None,
                actual_pid: None,
                expected_pid: None,
                bounded_detail: "Capability probe timed out after 3 seconds".into(),
            },
        }
    }
}

#[derive(Debug, Clone)]
pub enum CapabilityProbeOutcome {
    Supported,
    Unavailable(ProbeFailure),
}

impl CapabilityProbeOutcome {
    pub fn is_supported(&self) -> bool {
        matches!(self, Self::Supported)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityProbeRequest {
    pub request_id: String,
}

/// Validates request ID bounds: non-empty, max 64 chars, alphanumeric + '-' + '_'.
pub fn validate_request_id(id: &str) -> Result<(), ProtocolError> {
    if id.is_empty() || id.len() > 64 {
        return Err(ProtocolError::InvalidRequestId(format!(
            "Length must be between 1 and 64 characters, got {}",
            id.len()
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ProtocolError::InvalidRequestId(
            "Only ASCII alphanumeric characters, hyphens, and underscores are allowed".to_string(),
        ));
    }
    Ok(())
}

/// Validates wake after seconds for suspend execution: exactly 0 (indefinite) or bounded (60..=86400).
pub fn validate_suspend_wake_seconds(wake_after_seconds: u64) -> Result<(), ProtocolError> {
    if wake_after_seconds == 0
        || (wake_after_seconds >= crate::config::MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS
            && wake_after_seconds <= crate::config::MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS)
    {
        Ok(())
    } else {
        Err(ProtocolError::InvalidWakeSeconds(wake_after_seconds))
    }
}

/// Bounded FIFO deduplication cache for helper request IDs to reject replays.
#[derive(Debug)]
pub struct RequestDeduplicator {
    max_entries: usize,
    entries: std::collections::VecDeque<String>,
    set: std::collections::HashSet<String>,
}

impl RequestDeduplicator {
    pub fn new(max_entries: usize) -> Self {
        Self {
            max_entries: max_entries.max(1),
            entries: std::collections::VecDeque::with_capacity(max_entries),
            set: std::collections::HashSet::with_capacity(max_entries),
        }
    }

    pub fn check_and_record(&mut self, request_id: &str) -> Result<(), ProtocolError> {
        validate_request_id(request_id)?;
        if self.set.contains(request_id) {
            return Err(ProtocolError::DuplicateRequestId(request_id.to_string()));
        }
        if self.entries.len() >= self.max_entries {
            if let Some(oldest) = self.entries.pop_front() {
                self.set.remove(&oldest);
            }
        }
        self.entries.push_back(request_id.to_string());
        self.set.insert(request_id.to_string());
        Ok(())
    }
}

/// Request payloads accepted by the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", deny_unknown_fields)]
pub enum HelperRequestPayload {
    /// Probe host capability for RTC wake and suspend.
    ProbeCapability(CapabilityProbeRequest),
    /// Execute a fixed RTC-timed suspend.
    SuspendWithRtcWake(SuspendWithRtcWakeRequest),
}

/// Top-level frame for requests sent to the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperRequestFrame {
    pub version: u32,
    pub payload: HelperRequestPayload,
    pub timestamp_ms: u64,
}

impl HelperRequestFrame {
    pub fn new_probe(req: CapabilityProbeRequest) -> Result<Self, ProtocolError> {
        validate_request_id(&req.request_id)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(Self {
            version: HELPER_PROTOCOL_VERSION,
            payload: HelperRequestPayload::ProbeCapability(req),
            timestamp_ms: now,
        })
    }

    pub fn new_suspend(req: SuspendWithRtcWakeRequest) -> Result<Self, ProtocolError> {
        validate_request_id(&req.request_id)?;
        validate_suspend_wake_seconds(req.wake_after_seconds)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(Self {
            version: HELPER_PROTOCOL_VERSION,
            payload: HelperRequestPayload::SuspendWithRtcWake(req),
            timestamp_ms: now,
        })
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != HELPER_PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion {
                expected: HELPER_PROTOCOL_VERSION,
                got: self.version,
            });
        }
        match &self.payload {
            HelperRequestPayload::ProbeCapability(req) => {
                validate_request_id(&req.request_id)?;
                Ok(())
            }
            HelperRequestPayload::SuspendWithRtcWake(req) => {
                validate_request_id(&req.request_id)?;
                validate_suspend_wake_seconds(req.wake_after_seconds)?;
                Ok(())
            }
        }
    }
}

/// Response payloads returned by the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", deny_unknown_fields)]
pub enum HelperResponsePayload {
    /// Result of capability probe.
    Capability {
        request_id: String,
        supported: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<ProbeFailureReason>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    /// Result of suspend execution.
    SuspendOutcome(SuspendOutcome),
    /// Explicit rejection or error before execution.
    Error { code: String, message: String },
}

/// Top-level frame for responses emitted by the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperResponseFrame {
    pub version: u32,
    pub payload: HelperResponsePayload,
    pub timestamp_ms: u64,
}

impl HelperResponseFrame {
    pub fn new(payload: HelperResponsePayload) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self {
            version: HELPER_PROTOCOL_VERSION,
            payload,
            timestamp_ms: now,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != HELPER_PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion {
                expected: HELPER_PROTOCOL_VERSION,
                got: self.version,
            });
        }
        match &self.payload {
            HelperResponsePayload::Capability { request_id, .. } => {
                validate_request_id(request_id)?;
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

/// Encode a message frame into length-prefixed bytes: [4 bytes u32 big-endian length][JSON payload].
pub fn encode_frame<T: Serialize>(val: &T) -> Result<Vec<u8>, ProtocolError> {
    let json_bytes = serde_json::to_vec(val)?;
    if json_bytes.len() > MAX_HELPER_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge(
            json_bytes.len(),
            MAX_HELPER_FRAME_BYTES,
        ));
    }
    if json_bytes.is_empty() {
        return Err(ProtocolError::EmptyFrame);
    }
    let len = json_bytes.len() as u32;
    let mut buf = Vec::with_capacity(4 + json_bytes.len());
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(&json_bytes);
    Ok(buf)
}

/// Decode a message frame from exact raw frame bytes [4 bytes u32 big-endian length][JSON payload].
pub fn decode_frame<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, ProtocolError> {
    if bytes.len() < 4 {
        return Err(ProtocolError::UnexpectedEofHeader);
    }
    let len = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if len > MAX_HELPER_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge(len, MAX_HELPER_FRAME_BYTES));
    }
    if len == 0 {
        return Err(ProtocolError::EmptyFrame);
    }
    if bytes.len() < 4 + len {
        return Err(ProtocolError::UnexpectedEofPayload);
    }
    if bytes.len() > 4 + len {
        return Err(ProtocolError::TrailingData(bytes.len() - (4 + len)));
    }
    let payload_slice = &bytes[4..4 + len];
    let val: T = serde_json::from_slice(payload_slice)?;
    Ok(val)
}

/// Async helper to read one length-prefixed frame from an AsyncRead stream.
pub async fn read_frame_async<R: tokio::io::AsyncReadExt + Unpin, T: for<'de> Deserialize<'de>>(
    reader: &mut R,
) -> Result<T, ProtocolError> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            ProtocolError::UnexpectedEofHeader
        } else {
            ProtocolError::IoError(e)
        }
    })?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_HELPER_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge(len, MAX_HELPER_FRAME_BYTES));
    }
    if len == 0 {
        return Err(ProtocolError::EmptyFrame);
    }
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            ProtocolError::UnexpectedEofPayload
        } else {
            ProtocolError::IoError(e)
        }
    })?;
    let val: T = serde_json::from_slice(&payload)?;
    Ok(val)
}

/// Async helper to write one length-prefixed frame to an AsyncWrite stream and flush.
pub async fn write_frame_async<W: tokio::io::AsyncWriteExt + Unpin, T: Serialize>(
    writer: &mut W,
    val: &T,
) -> Result<(), ProtocolError> {
    let bytes = encode_frame(val)?;
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}
