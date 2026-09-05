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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        who: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        why: Option<String>,
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

/// Protocol version for privileged helper IPC.
pub const HELPER_PROTOCOL_VERSION: u32 = 1;

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
}

/// Validates request ID bounds: non-empty, max 64 chars, alphanumeric + '-' + '_'.
pub fn validate_request_id(id: &str) -> Result<(), ProtocolError> {
    if id.is_empty() || id.len() > 64 {
        return Err(ProtocolError::InvalidRequestId(format!(
            "Length must be between 1 and 64 characters, got {}",
            id.len()
        )));
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(ProtocolError::InvalidRequestId(
            "Only ASCII alphanumeric characters, hyphens, and underscores are allowed".to_string(),
        ));
    }
    Ok(())
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
    ProbeCapability,
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
    pub fn new_probe() -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self {
            version: HELPER_PROTOCOL_VERSION,
            payload: HelperRequestPayload::ProbeCapability,
            timestamp_ms: now,
        }
    }

    pub fn new_suspend(req: SuspendWithRtcWakeRequest) -> Result<Self, ProtocolError> {
        validate_request_id(&req.request_id)?;
        if req.wake_after_seconds < crate::config::MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS
            || req.wake_after_seconds > crate::config::MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS
        {
            return Err(ProtocolError::InvalidWakeSeconds(req.wake_after_seconds));
        }
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
            HelperRequestPayload::ProbeCapability => Ok(()),
            HelperRequestPayload::SuspendWithRtcWake(req) => {
                validate_request_id(&req.request_id)?;
                if req.wake_after_seconds < crate::config::MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS
                    || req.wake_after_seconds > crate::config::MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS
                {
                    return Err(ProtocolError::InvalidWakeSeconds(req.wake_after_seconds));
                }
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
        supported: bool,
        detail: String,
    },
    /// Result of suspend execution.
    SuspendOutcome(SuspendOutcome),
    /// Explicit rejection or error before execution.
    Error {
        code: String,
        message: String,
    },
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
        Ok(())
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
