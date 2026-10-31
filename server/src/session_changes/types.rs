use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Resource limits and constants (contracts.md S8)
// ---------------------------------------------------------------------------

pub const MAX_RETAINED_IDENTITIES: usize = 32;
pub const MAX_METADATA_NODES: usize = 10_000;
pub const MAX_METADATA_BYTES: usize = 8 * 1024 * 1024; // 8 MiB
pub const MAX_PATH_BYTES: usize = 4096;
pub const MAX_PATH_DEPTH: usize = 64;
pub const MAX_FILE_RAW_BYTES: usize = 2 * 1024 * 1024; // 2 MiB
pub const MAX_BASELINE_RAW_BYTES: usize = 128 * 1024 * 1024; // 128 MiB
pub const MAX_CURRENT_CANDIDATE_RAW_BYTES: usize = 128 * 1024 * 1024; // 128 MiB
pub const MAX_GLOBAL_STORAGE_BYTES: usize = 512 * 1024 * 1024; // 512 MiB
pub const MAX_PER_RECORD_METADATA_BYTES: usize = 16 * 1024 * 1024; // 16 MiB
pub const MAX_BLOCKING_PERMITS: usize = 2;
pub const MAX_PREPARE_CAPTURE_DURATION_SECS: u64 = 10;
pub const MAX_ADAPTER_BARRIER_DURATION_SECS: u64 = 12;
pub const PREPARATION_TTL_SECS: u64 = 15;
pub const MAX_COMPARISON_DURATION_SECS: u64 = 5;
pub const MAX_PER_FILE_DIFF_MS: u64 = 50;
pub const MAX_LINE_COMPARISON_UNITS: usize = 1_000_000;
pub const MAX_TEXT_RENDER_BYTES: usize = 1024 * 1024; // 1 MiB
pub const MAX_TEXT_RENDER_LINES: usize = 20_000;
pub const MAX_TEXT_LINE_BYTES: usize = 16 * 1024; // 16 KiB
pub const DEFAULT_PAGE_LIMIT: usize = 100;
pub const MAX_PAGE_LIMIT: usize = 200;
pub const MAX_PAGE_SERIALIZED_BYTES: usize = 512 * 1024; // 512 KiB
pub const MAX_DETAIL_TEXT_BYTES: usize = 2 * 1024 * 1024; // 2 MiB
pub const MAX_DETAIL_SERIALIZED_BYTES: usize = 12 * 1024 * 1024; // 12 MiB
pub const MAX_CONCURRENT_DETAIL_RESPONSES: usize = 2;
pub const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024; // 16 KiB
pub const MAX_RETAINED_SELECTOR_BYTES: usize = 32 * 1024; // 32 KiB
pub const MAX_ERROR_BODY_BYTES: usize = 1024; // 1 KiB
pub const MAX_CONTROL_IN_FLIGHT: usize = 8;
pub const RATE_LIMIT_PER_BEARER_BURST: u32 = 8;
pub const ROOT_PREFLIGHT_MAX_METADATA_OPS: usize = 128;
pub const ROOT_PREFLIGHT_MAX_SCRATCH_BYTES: usize = 64 * 1024; // 64 KiB
pub const ROOT_PREFLIGHT_MAX_DURATION_SECS: u64 = 1;
pub const ROOT_PREFLIGHT_MAX_CANDIDATES: usize = 128;
pub const ROOT_PREFLIGHT_MAX_INPUT_PATH_BYTES: usize = 512 * 1024; // 512 KiB

// Helper to validate canonical unsigned decimal strings (e.g. incarnation, revision)
pub fn is_valid_canonical_decimal_string(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    if s.len() > 1 && s.starts_with('0') {
        return false;
    }
    s.chars().all(|c| c.is_ascii_digit())
}

// ---------------------------------------------------------------------------
// Common Enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrepareMode {
    Capture,
    Lookup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrepareLifecycle {
    InitialFresh,
    New,
    Fork,
    Resume,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    Timeout,
    Aborted,
    Protocol,
    CaptureFailed,
    IdentityChanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettledOutcome {
    Completed,
    Blocked,
    Error,
    Aborted,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverageReason {
    AbsenceUnknown,
    ProvenanceLimit,
    RootLimit,
    InventoryLimit,
    PathLimit,
    ByteLimit,
    FileTooLarge,
    Binary,
    NonUtf8,
    Unreadable,
    Unstable,
    Symlink,
    Gitlink,
    NestedRoot,
    SpecialFile,
    Deadline,
    Capacity,
    TextLimit,
    DiffLimit,
    TargetUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverageState {
    Complete,
    Incomplete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusState {
    Initializing,
    Ready,
    Incomplete,
    Unavailable,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    SessionStart,
    FromNow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Acknowledgment {
    Pending,
    Received,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Added,
    Deleted,
    Modified,
    ModeOnly,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Presence {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provenance {
    Captured,
    AbsentInVerifiedDirectory,
    ExcludedAtCapture,
    Unproven,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileContentKind {
    Text,
    Binary,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidRequest,
    Unauthorized,
    TerminalMissing,
    IncarnationMismatch,
    SessionMismatch,
    RootMismatch,
    TargetUnavailable,
    BaselineMissing,
    ServerRestarted,
    OriginalUnavailable,
    RegistrationExpired,
    RegistrationFailed,
    AcknowledgmentPending,
    Capacity,
    Busy,
    Deadline,
    RefreshRequired,
    FileMissing,
    ResponseLimit,
}

// ---------------------------------------------------------------------------
// Coverage and Comparison DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub state: CoverageState,
    pub inventory_complete: bool,
    pub absence_proof_complete: bool,
    pub provenance_entries: u64,
    pub eligible_entries: u64,
    pub captured_entries: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omitted_entries: Option<u64>,
    pub raw_bytes: u64,
    pub reasons: Vec<CoverageReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub server_epoch: String,
    pub baseline_id: String,
    pub comparison_revision: String,
    pub compared_at_ms: u64,
    pub current_coverage: Coverage,
    pub changed_file_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    pub counts_complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settled_turn_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Status DTO and Invariants Validation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub version: u32,
    pub server_epoch: String,
    pub terminal_incarnation: String,
    pub omp_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    pub state: StatusState,
    pub acknowledgment: Acknowledgment,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_coverage: Option<Coverage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison: Option<Comparison>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<ErrorCode>,
    pub shared_writers: bool,
}

impl Status {
    pub fn validate_invariants(&self) -> Result<(), &'static str> {
        if self.version != 1 {
            return Err("Invalid version: must be 1");
        }
        if !self.shared_writers {
            return Err("sharedWriters must be true");
        }
        if !is_valid_canonical_decimal_string(&self.terminal_incarnation) {
            return Err("terminalIncarnation must be a canonical unsigned decimal string");
        }
        if let Some(comp) = &self.comparison {
            if !is_valid_canonical_decimal_string(&comp.comparison_revision) {
                return Err("comparisonRevision must be a canonical unsigned decimal string");
            }
        }

        match (self.origin, self.state, self.acknowledgment) {
            // sessionStart initializing requires pending acknowledgment
            (Some(Origin::SessionStart), StatusState::Initializing, Acknowledgment::Pending) => {
                // may have null baseline/coverage or exact prepared ID, never source-ready
                Ok(())
            }
            // sessionStart ready/incomplete requires received acknowledgment
            (Some(Origin::SessionStart), StatusState::Ready, Acknowledgment::Received) => {
                if self.baseline_id.is_none() || self.captured_at_ms.is_none() {
                    return Err("sessionStart ready requires baselineId and capturedAtMs");
                }
                match &self.baseline_coverage {
                    Some(c) if c.state == CoverageState::Complete => Ok(()),
                    _ => Err("sessionStart ready requires complete baselineCoverage"),
                }
            }
            (Some(Origin::SessionStart), StatusState::Incomplete, Acknowledgment::Received) => {
                if self.baseline_id.is_none() || self.captured_at_ms.is_none() {
                    return Err("sessionStart incomplete requires baselineId and capturedAtMs");
                }
                match &self.baseline_coverage {
                    Some(c) if c.state == CoverageState::Incomplete => Ok(()),
                    _ => Err("sessionStart incomplete requires incomplete baselineCoverage"),
                }
            }
            // sessionStart unavailable allows pending or received
            (Some(Origin::SessionStart), StatusState::Unavailable, Acknowledgment::Pending)
            | (Some(Origin::SessionStart), StatusState::Unavailable, Acknowledgment::Received) => {
                Ok(())
            }

            // fromNow initializing requires notApplicable
            (Some(Origin::FromNow), StatusState::Initializing, Acknowledgment::NotApplicable) => {
                Ok(())
            }
            // fromNow ready/incomplete requires notApplicable
            (Some(Origin::FromNow), StatusState::Ready, Acknowledgment::NotApplicable) => {
                if self.baseline_id.is_none() || self.captured_at_ms.is_none() {
                    return Err("fromNow ready requires baselineId and capturedAtMs");
                }
                match &self.baseline_coverage {
                    Some(c) if c.state == CoverageState::Complete => Ok(()),
                    _ => Err("fromNow ready requires complete baselineCoverage"),
                }
            }
            (Some(Origin::FromNow), StatusState::Incomplete, Acknowledgment::NotApplicable) => {
                if self.baseline_id.is_none() || self.captured_at_ms.is_none() {
                    return Err("fromNow incomplete requires baselineId and capturedAtMs");
                }
                match &self.baseline_coverage {
                    Some(c) if c.state == CoverageState::Incomplete => Ok(()),
                    _ => Err("fromNow incomplete requires incomplete baselineCoverage"),
                }
            }
            // fromNow unavailable requires notApplicable
            (Some(Origin::FromNow), StatusState::Unavailable, Acknowledgment::NotApplicable) => {
                Ok(())
            }

            // null origin missing/unavailable requires notApplicable
            (None, StatusState::Missing, Acknowledgment::NotApplicable) => {
                if self.baseline_id.is_some() || self.baseline_coverage.is_some() {
                    return Err("null origin missing must not have baselineId or baselineCoverage");
                }
                Ok(())
            }
            (None, StatusState::Unavailable, Acknowledgment::NotApplicable) => {
                if self.baseline_id.is_some() || self.baseline_coverage.is_some() {
                    return Err("null origin unavailable must not have baselineId or baselineCoverage");
                }
                Ok(())
            }

            // All other combinations are invalid!
            _ => Err("Invalid origin/state/acknowledgment combination"),
        }
    }
}

// ---------------------------------------------------------------------------
// Producer Protocol Wire DTOs (contracts.md S2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub version: u32,
    pub registration_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd_hint: Option<String>,
    pub expires_at_ms: u64,
    pub mode: PrepareMode,
    pub lifecycle: PrepareLifecycle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedReceipt {
    pub version: u32,
    pub kind: String, // "prepared"
    pub server_epoch: String,
    pub terminal_incarnation: String,
    pub registration_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub baseline_id: String,
    pub activation_nonce: String,
    pub captured_at_ms: u64,
    pub prepared_ttl_ms: u64,
    pub baseline_coverage: Coverage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingReceipt {
    pub version: u32,
    pub kind: String, // "existing"
    pub status: Status,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationRequest {
    pub version: u32,
    pub server_epoch: String,
    pub registration_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub baseline_id: String,
    pub activation_nonce: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationReceipt {
    pub version: u32,
    pub server_epoch: String,
    pub registration_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub baseline_id: String,
    pub activation_nonce: String,
    pub activated: bool,
    pub activation_receipt_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRequest {
    pub version: u32,
    pub server_epoch: String,
    pub registration_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub baseline_id: String,
    pub activation_nonce: String,
    pub activation_receipt_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptResponse {
    pub version: u32,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureRequest {
    pub version: u32,
    pub omp_session_id: String,
    pub registration_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_epoch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_id: Option<String>,
    pub reason: FailureReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureResponse {
    pub version: u32,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupRequest {
    pub version: u32,
    pub omp_session_id: String,
    pub root_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_server_epoch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_baseline_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LookupResult {
    #[serde(rename_all = "camelCase")]
    Active {
        version: u32,
        status: Status,
    },
    #[serde(rename_all = "camelCase")]
    Missing {
        version: u32,
        server_epoch: String,
        terminal_incarnation: String,
        omp_session_id: String,
        root_id: String,
        reason: ErrorCode,
    },
    #[serde(rename_all = "camelCase")]
    Unavailable {
        version: u32,
        server_epoch: String,
        terminal_incarnation: String,
        omp_session_id: String,
        root_id: String,
        reason: ErrorCode,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettledRequest {
    pub version: u32,
    pub server_epoch: String,
    pub baseline_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub origin: Origin,
    pub turn_id: String,
    pub outcome: SettledOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettledResponse {
    pub version: u32,
    pub accepted: bool,
    pub duplicate: bool,
}

// ---------------------------------------------------------------------------
// File Page and File Detail DTOs (contracts.md S3)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub file_id: String,
    pub path: String,
    pub change: FileChangeKind,
    pub original_presence: Presence,
    pub original_provenance: Provenance,
    pub current_presence: Presence,
    pub original_kind: FileContentKind,
    pub current_kind: FileContentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_mode: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_mode: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    pub reasons: Vec<CoverageReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePage {
    pub version: u32,
    pub comparison: Comparison,
    pub files: Vec<FileRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSide {
    pub presence: Presence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetail {
    pub version: u32,
    pub server_epoch: String,
    pub baseline_id: String,
    pub comparison_revision: String,
    pub file: FileRow,
    pub original: ContentSide,
    pub current: ContentSide,
    pub renderable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub version: u32,
    pub code: ErrorCode,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainedSessionEntry {
    pub omp_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    pub state: StatusState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainedSessionList {
    pub version: u32,
    pub server_epoch: String,
    pub terminal_incarnation: String,
    pub sessions: Vec<RetainedSessionEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FromNowRequest {
    pub version: u32,
    pub terminal_incarnation: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_server_epoch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub version: u32,
    pub terminal_incarnation: String,
    pub omp_session_id: String,
    pub server_epoch: String,
    pub baseline_id: String,
    pub request_id: String,
}
