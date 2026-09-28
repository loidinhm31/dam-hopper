use serde::{Deserialize, Serialize};

/// Canonical v1 protocol version for agent status reporting.
pub const AGENT_STATUS_PROTOCOL_VERSION: u32 = 1;

/// Maximum integer value safely representable in IEEE-754 double precision (JavaScript Number).
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Default heartbeat interval expected from the reporter (5 seconds).
pub const DEFAULT_HEARTBEAT_MS: u64 = 5_000;

/// Default lease expiration duration without reports/heartbeats (15 seconds).
pub const DEFAULT_LEASE_MS: u64 = 15_000;

/// Maximum payload size for private reporter messages (4 KiB).
pub const MAX_PRIVATE_FRAME_BYTES: usize = 4_096;

/// Maximum length for opaque string identifiers.
pub const MAX_IDENTIFIER_LEN: usize = 128;

/// Validate that a numeric value is within the safe integer bounds.
pub fn validate_safe_integer(field: &'static str, value: u64) -> Result<(), AgentStatusError> {
    if value > MAX_SAFE_INTEGER {
        Err(AgentStatusError::SafeIntegerOverflow { field, value })
    } else {
        Ok(())
    }
}

/// Validate that an opaque string identifier is non-empty, within length limits, and ASCII graphic.
pub fn validate_opaque_id(field_name: &str, s: &str) -> Result<(), AgentStatusError> {
    if s.is_empty() {
        return Err(AgentStatusError::InvalidIdentifier(format!(
            "{field_name} cannot be empty"
        )));
    }
    if s.len() > MAX_IDENTIFIER_LEN {
        return Err(AgentStatusError::InvalidIdentifier(format!(
            "{field_name} exceeds max length of {MAX_IDENTIFIER_LEN} (got {})",
            s.len()
        )));
    }
    if !s.chars().all(|c| c.is_ascii_graphic()) {
        return Err(AgentStatusError::InvalidIdentifier(format!(
            "{field_name} contains invalid characters (must be ASCII graphic)"
        )));
    }
    Ok(())
}

/// Known agent kinds supported by the status reporting subsystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Omp,
}

/// Agent execution state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Unknown,
    Idle,
    Working,
    Blocked,
}

/// Closed reason codes for why an agent is blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockedReason {
    Approval,
    Question,
    Error,
}

/// Outcomes for explicit settled turn ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TurnOutcome {
    Ended,
    Interrupted,
    Error,
    Unknown,
}

/// Wire event types transmitted by the private reporter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReporterEventKind {
    Snapshot,
    TurnStarted,
    StateChanged,
    TurnEnded,
    SessionChanged,
    Heartbeat,
    Release,
}

/// High-level kinds of attention notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttentionKind {
    TurnEnded,
    NeedsAttention,
}

/// Public subsystem availability status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStatusAvailability {
    Ready,
    Unavailable,
    PlatformUnqualified,
}

// ── Private Reporter Protocol Types ───────────────────────────────────────────

/// Handshake message sent by reporter upon connecting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReporterHello {
    pub version: u32,
    pub agent_kind: AgentKind,
    pub reporter_id: String,
    pub agent_session_id: String,
    pub adapter_version: String,
}

/// Server acknowledgement upon admitting a reporter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReporterAccepted {
    pub kind: String,
    pub server_epoch: u64,
    pub reporter_epoch: u64,
    pub heartbeat_ms: u64,
    pub lease_ms: u64,
}

impl Default for ReporterAccepted {
    fn default() -> Self {
        Self {
            kind: "accepted".to_string(),
            server_epoch: 0,
            reporter_epoch: 0,
            heartbeat_ms: DEFAULT_HEARTBEAT_MS,
            lease_ms: DEFAULT_LEASE_MS,
        }
    }
}

/// Report payload sent from an admitted reporter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReporterReport {
    pub kind: String,
    pub seq: u64,
    pub event: ReporterEventKind,
    pub state: AgentState,
    pub agent_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<TurnOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<BlockedReason>,
}

/// Server acknowledgement for an accepted report sequence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReporterAck {
    pub kind: String,
    pub seq: u64,
}

impl ReporterAck {
    pub fn new(seq: u64) -> Self {
        Self {
            kind: "ack".to_string(),
            seq,
        }
    }
}

/// Server rejection payload for admission or report validation failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReporterRejected {
    pub kind: String,
    pub reason: String,
}

impl ReporterRejected {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            kind: "rejected".to_string(),
            reason: reason.into(),
        }
    }
}

// ── Public DTO Types ─────────────────────────────────────────────────────────

/// Public per-terminal agent status record.
/// Omits capabilities, connection handles, raw text, and session file paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgentStatusRow {
    pub id: String,
    pub incarnation: u64,
    pub agent_kind: AgentKind,
    pub agent_session_id: String,
    pub reporter_epoch: u64,
    pub state: AgentState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<BlockedReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub attention_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_outcome: Option<TurnOutcome>,
}

/// Attention event emitted when user action or notification is warranted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAttentionEvent {
    pub id: String,
    pub kind: AttentionKind,
    pub terminal_id: String,
    pub incarnation: u64,
    pub agent_kind: AgentKind,
    pub agent_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<BlockedReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<TurnOutcome>,
    pub attention_revision: u64,
    pub timestamp_ms: u64,
}

impl AgentAttentionEvent {
    /// Deterministic attention identifier scoped across server restarts and terminal incarnations.
    pub fn format_id(
        server_epoch: u64,
        terminal_id: &str,
        incarnation: u64,
        attention_revision: u64,
    ) -> String {
        format!("{server_epoch}:{terminal_id}:{incarnation}:{attention_revision}")
    }
}

/// Complete agent status snapshot returned by `GET /api/agent-status/v1/snapshot`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusSnapshotV1 {
    pub version: u32,
    pub server_epoch: u64,
    pub revision: u64,
    pub availability: AgentStatusAvailability,
    pub terminals: Vec<TerminalAgentStatusRow>,
}

/// Push notification sent when a terminal's agent status changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusChangedPayload {
    pub server_epoch: u64,
    pub revision: u64,
    pub row: TerminalAgentStatusRow,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attention: Option<AgentAttentionEvent>,
}

/// Push notification sent when a terminal's agent status is explicitly removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusRemovedPayload {
    pub server_epoch: u64,
    pub revision: u64,
    pub terminal_id: String,
    pub incarnation: u64,
}

/// Push notification sent when stream lag requires client to refetch snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusInvalidatedPayload {
    pub server_epoch: u64,
    pub revision: u64,
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AgentStatusError {
    #[error("protocol version mismatch: expected {expected}, got {actual}")]
    VersionMismatch { expected: u32, actual: u32 },

    #[error("value exceeds safe integer limit: {field} = {value}")]
    SafeIntegerOverflow { field: &'static str, value: u64 },

    #[error("invalid identifier: {0}")]
    InvalidIdentifier(String),

    #[error("stale terminal incarnation: expected {expected}, got {actual}")]
    StaleIncarnation { expected: u64, actual: u64 },

    #[error("stale reporter epoch: current {current}, got {got}")]
    StaleReporterEpoch { current: u64, got: u64 },

    #[error("reporter occupied by another live instance ({active})")]
    ReporterOccupied { active: String },

    #[error("stale report sequence: last accepted {last_accepted}, got {got}")]
    StaleSequence { last_accepted: u64, got: u64 },

    #[error("conflicting duplicate sequence {seq}")]
    ConflictingDuplicateSequence { seq: u64 },

    #[error("inconsistent event and state combination: event {event:?}, state {state:?}")]
    InconsistentEventState {
        event: ReporterEventKind,
        state: AgentState,
    },

    #[error("turn-ended event requires turn ID")]
    MissingTurnId,

    #[error("turn-started event requires turn ID")]
    MissingTurnStartId,

    #[error("turn-ended event requires outcome")]
    MissingTurnOutcome,

    #[error("outcome provided on non-turn-ended event: {0:?}")]
    UnexpectedTurnOutcome(ReporterEventKind),

    #[error("blocked reason provided on non-blocked state: {0:?}")]
    UnexpectedBlockedReason(AgentState),

    #[error("blocked state requires blocked reason")]
    MissingBlockedReason,

    #[error("reporter connection lease expired")]
    LeaseExpired,

    #[error("authority lost: {0}")]
    AuthorityLost(String),
}
