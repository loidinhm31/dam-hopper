use serde::{Deserialize, Serialize};

// Diagnostic error codes frozen in contracts.md section 5
pub const DIAG_INVALID_METADATA: &str = "INVALID_METADATA";
pub const DIAG_INVALID_DOCUMENT: &str = "INVALID_DOCUMENT";
pub const DIAG_FIELD_TOO_LARGE: &str = "FIELD_TOO_LARGE";
pub const DIAG_PHASE_INVENTORY_INVALID: &str = "PHASE_INVENTORY_INVALID";
pub const DIAG_PHASE_UNREPORTED: &str = "PHASE_UNREPORTED";
pub const DIAG_PHASE_UNMATCHED: &str = "PHASE_UNMATCHED";
pub const DIAG_STATUS_CONFLICT: &str = "STATUS_CONFLICT";
pub const DIAG_UNSUPPORTED_STATUS: &str = "UNSUPPORTED_STATUS";
pub const DIAG_PROGRESS_MISSING: &str = "PROGRESS_MISSING";
pub const DIAG_PROGRESS_UNREADABLE: &str = "PROGRESS_UNREADABLE";
pub const DIAG_DOCUMENT_TOO_LARGE: &str = "DOCUMENT_TOO_LARGE";
pub const DIAG_DOCUMENT_CHANGED: &str = "DOCUMENT_CHANGED";
pub const DIAG_LINK_REJECTED: &str = "LINK_REJECTED";
pub const DIAG_INVALID_DATE: &str = "INVALID_DATE";
pub const DIAG_DATE_CONFLICT: &str = "DATE_CONFLICT";
pub const DIAG_SCAN_LIMIT: &str = "SCAN_LIMIT";
pub const DIAG_DIAGNOSTICS_LIMIT: &str = "DIAGNOSTICS_LIMIT";

// Parser resource bounds from contracts.md section 3
pub const MAX_DOCUMENT_BYTES: usize = 64 * 1024; // 64 KiB
pub const MAX_DECISIVE_BYTES_PER_REQUEST: usize = 128 * 1024; // 128 KiB
pub const MAX_DECLARED_PHASE_ROWS: usize = 128;
pub const MAX_METADATA_STRING_BYTES: usize = 4 * 1024; // 4 KiB
pub const MAX_TITLE_TAG_BYTES: usize = 512;
pub const MAX_TAGS_COUNT: usize = 32;
pub const MAX_EVIDENCE_LINKS_PER_PLAN: usize = 64;
pub const MAX_DIAGNOSTICS_PER_PLAN: usize = 32;
pub const MAX_DIAGNOSTIC_RAW_TEXT_BYTES: usize = 1024; // 1 KiB
pub const MAX_YAML_NESTING_DEPTH: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
    Blocked,
    Unknown,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanAuthority {
    Plan,
    Progress,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub path: String,
    pub line_start: usize,
    pub line_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub path: Option<String>,
    pub line: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvidence {
    pub value: PlanStatus,
    pub raw: String,
    pub evidence: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedStatus {
    pub value: PlanStatus,
    pub authority: PlanAuthority,
    pub raw: Option<String>,
    pub evidence: Vec<SourceRef>,
    pub captured: Vec<StatusEvidence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanDocumentState {
    Absent,
    Readable,
    Unreadable,
    Oversize,
    Invalid,
    Changed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocument {
    pub path: String,
    pub state: PlanDocumentState,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatePrecision {
    Day,
    Instant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateEvidence {
    pub value: String,
    pub precision: DatePrecision,
    pub evidence: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlanPhase {
    pub id: String,
    pub number: Option<u32>,
    pub title: Option<String>,
    pub path: Option<String>,
    pub reported_status: ReportedStatus,
    pub evidence_links: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlanMetadata {
    pub priority: Option<String>,
    pub effort: Option<String>,
    pub issue: Option<String>,
    pub branch: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocuments {
    pub plan: PlanDocument,
    pub progress: PlanDocument,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCompletion {
    pub declared: Option<u32>,
    pub completed: u32,
    pub unknown: u32,
    pub conflicted: u32,
    pub fraction: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDates {
    pub created: Option<DateEvidence>,
    pub planned_start: Option<DateEvidence>,
    pub planned_end: Option<DateEvidence>,
    pub actual_start: Option<DateEvidence>,
    pub actual_end: Option<DateEvidence>,
    pub published: Option<DateEvidence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlan {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub metadata: FilePlanMetadata,
    pub documents: PlanDocuments,
    pub reported_status: ReportedStatus,
    pub phases: Vec<FilePlanPhase>,
    pub completion: PlanCompletion,
    pub dates: PlanDates,
    pub last_document_update: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTarget {
    pub project: String,
    pub worktree_path: Option<String>,
    pub target_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanFolderKind {
    Collection,
    Group,
    Plan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanFolderState {
    Present,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderListing {
    pub complete: bool,
    pub entries_visited: usize,
    pub limits_reached: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanFoldersResponse {
    pub target: PlanTarget,
    pub path: String,
    pub kind: PlanFolderKind,
    pub folder_state: PlanFolderState,
    pub folders: Vec<FolderEntry>,
    pub listing: FolderListing,
    pub watch_paths: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedPlanResponse {
    pub target: PlanTarget,
    pub plan: FilePlan,
    pub watch_paths: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Decisive document snapshot supplied to the parser.
#[derive(Debug, Clone)]
pub struct DocumentSnapshot<'a> {
    pub path: &'a str,
    pub state: PlanDocumentState,
    pub bytes: Option<&'a [u8]>,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
}

impl<'a> DocumentSnapshot<'a> {
    pub fn to_plan_document(&self) -> PlanDocument {
        PlanDocument {
            path: self.path.to_string(),
            state: self.state,
            size_bytes: self.size_bytes,
            modified_at: self.modified_at.clone(),
        }
    }
}
