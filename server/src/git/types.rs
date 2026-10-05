use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastCommit {
    pub hash: String,
    pub message: String,
    pub date: String,
}

impl Default for LastCommit {
    fn default() -> Self {
        Self {
            hash: String::new(),
            message: String::new(),
            date: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub project_name: String,
    pub branch: String,
    pub is_clean: bool,
    pub ahead: usize,
    pub behind: usize,
    pub staged: usize,
    pub modified: usize,
    pub untracked: usize,
    pub has_stash: bool,
    pub last_commit: LastCommit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_exists: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsRoot {
    pub root_id: String,
    pub path: String,
    pub absolute_path: String,
    pub kind: VcsRootKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_state: Option<VcsRootMappingState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gitlink: Option<SubmoduleGitlinkInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<GitStatus>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VcsRootKind {
    Primary,
    Submodule,
    NestedRepo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VcsRootMappingState {
    Mapped,
    Unmapped,
    Missing,
    Uninitialized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleGitlinkInfo {
    pub path: String,
    pub object_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl GitStatus {
    pub fn not_found(project_name: impl Into<String>) -> Self {
        Self {
            project_name: project_name.into(),
            branch: String::new(),
            is_clean: true,
            ahead: 0,
            behind: 0,
            staged: 0,
            modified: 0,
            untracked: 0,
            has_stash: false,
            last_commit: LastCommit::default(),
            path_exists: Some(false),
            status_error: None,
        }
    }

    pub fn error(project_name: impl Into<String>, err: impl Into<String>) -> Self {
        Self {
            project_name: project_name.into(),
            branch: String::new(),
            is_clean: true,
            ahead: 0,
            behind: 0,
            staged: 0,
            modified: 0,
            untracked: 0,
            has_stash: false,
            last_commit: LastCommit::default(),
            path_exists: Some(true),
            status_error: Some(err.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    pub project_name: String,
    pub operation: GitOperation,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitOperation {
    Fetch,
    Pull,
    Push,
}

impl std::fmt::Display for GitOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitOperation::Fetch => write!(f, "fetch"),
            GitOperation::Pull => write!(f, "pull"),
            GitOperation::Push => write!(f, "push"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchUpdateResult {
    pub branch: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckoutStrategy {
    Normal,
    Stash,
    Force,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
    Keep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRecoveryState {
    pub operation: GitRecoveryOperation,
    pub can_abort: bool,
    pub can_continue: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GitRecoveryOperation {
    Merge,
    Rebase,
    CherryPick,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GitBlockReason {
    ActiveOperation,
    CheckedOutBranch,
    DirtyWorktree,
    DetachedHead,
    PushedCommit,
    UnreachableCommit,
    RootCommit,
    MixedVcsRoots,
    StaleRef,
    UnsupportedHistory,
    InvalidCommitMetadata,
    SignatureConsentRequired,
    PublicationUncertain,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stashed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<GitRecoveryState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<GitBlockReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    /// Squash: newest selected original OID (not the oldest template).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_target_oid: Option<String>,
    /// Confirmed replacement target; squash commit for squash. Absent on uncertainty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_target_oid: Option<String>,
    /// Captured branch tip before local rewrite.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_head_oid: Option<String>,
    /// Confirmed installed branch tip, possibly a rewritten descendant of the target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_head_oid: Option<String>,
    /// Replacement objects written: squash counts one synthesized commit + strict descendants.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewritten_count: Option<usize>,
    /// Squash is always false; message editing may return an exact-message no-op.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_op: Option<bool>,
    /// Any invalidated cryptographic header removed, including absorbed selected commits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signatures_removed: Option<bool>,
}

impl GitActionResult {
    pub fn ok(message: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: Some(message.into()),
            branch: None,
            hash: None,
            stashed: None,
            conflict: None,
            dirty: None,
            destructive: None,
            recovery: None,
            blocked_reason: None,
            recommendation: None,
            old_target_oid: None,
            new_target_oid: None,
            old_head_oid: None,
            new_head_oid: None,
            rewritten_count: None,
            no_op: None,
            signatures_removed: None,
        }
    }

    pub fn blocked(
        reason: GitBlockReason,
        message: impl Into<String>,
        recommendation: impl Into<String>,
    ) -> Self {
        Self {
            ok: false,
            message: Some(message.into()),
            branch: None,
            hash: None,
            stashed: None,
            conflict: Some(false),
            dirty: None,
            destructive: Some(false),
            recovery: None,
            blocked_reason: Some(reason),
            recommendation: Some(recommendation.into()),
            old_target_oid: None,
            new_target_oid: None,
            old_head_oid: None,
            new_head_oid: None,
            rewritten_count: None,
            no_op: None,
            signatures_removed: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Git Log Graph types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub hash: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub message: String,
    pub refs: Vec<String>,
    pub is_pushed: bool,
}

// ---------------------------------------------------------------------------
// Diff / change management types
// ---------------------------------------------------------------------------

/// Maximum untracked entries returned in the main diff response.
/// Above this threshold entries are truncated and pagination is required.
pub const UNTRACKED_PAGE_SIZE: usize = 500;

/// Response envelope for the diff listing endpoint.
///
/// Staged/unstaged tracked changes are always returned in full.
/// Untracked files are capped at `UNTRACKED_PAGE_SIZE` per request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub entries: Vec<DiffFileEntry>,
    /// True when the untracked count exceeded `UNTRACKED_PAGE_SIZE`.
    pub untracked_truncated: bool,
    /// Total untracked count (exact if ≤ cap, capped at a scan limit otherwise).
    pub untracked_total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileEntry {
    pub path: String,
    /// "modified" | "added" | "deleted" | "renamed" | "copied" | "conflicted"
    pub status: String,
    pub staged: bool,
    pub additions: usize,
    pub deletions: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submodule: Option<SubmoduleGitlinkInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffContent {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    pub language: String,
    pub hunks: Vec<HunkInfo>,
    pub line_changes: Vec<GitLineChange>,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLineChange {
    /// "added" | "modified" | "deleted"
    pub kind: String,
    /// 1-based line in the modified file where the marker should render.
    pub line: u32,
    /// Number of modified-side lines covered; deleted blocks use 1 for a visible marker.
    pub length: u32,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkInfo {
    pub index: usize,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ancestor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ours: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theirs: Option<String>,
}

// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub commit_hash: String,
    pub is_main: bool,
    pub is_locked: bool,
    pub is_detached: bool,
    pub is_bare: bool,
    pub is_prunable: bool,
    pub is_available: bool,
}

pub struct WorktreeAddOptions {
    pub branch: String,
    pub path: Option<String>,
    pub create_branch: bool,
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProgressEvent {
    pub project_name: String,
    pub operation: String,
    pub phase: GitProgressPhase,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitProgressPhase {
    Started,
    Progress,
    Completed,
    Failed,
}

// ---------------------------------------------------------------------------
// Leased Push types (Phase 02)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishSnapshot {
    pub branch: String,
    pub source_oid: String,
    pub remote_name: String,
    pub destination_ref: String,
    pub expected_remote_oid: String,
    pub remote_identity: String,
    pub repository_identity: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublishBlockReason {
    DetachedHead,
    MissingUpstream,
    AmbiguousDestination,
    MissingDestination,
    RemoteUnavailable,
    AuthRequired,
    StalePreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PublishPreview {
    Ready {
        snapshot: PublishSnapshot,
        already_current: bool,
    },
    Blocked {
        reason: PublishBlockReason,
        message: String,
    },
}

impl PublishPreview {
    pub fn ready(snapshot: PublishSnapshot, already_current: bool) -> Self {
        Self::Ready {
            snapshot,
            already_current,
        }
    }

    pub fn blocked(reason: PublishBlockReason, message: impl Into<String>) -> Self {
        Self::Blocked {
            reason,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublishResultStatus {
    Published,
    AlreadyCurrent,
    StaleRemote,
    StaleLocal,
    StaleConfig,
    Rejected,
    AuthRequired,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub status: PublishResultStatus,
    pub branch: String,
    pub remote_name: String,
    pub destination_ref: String,
    pub source_oid: String,
    pub expected_remote_oid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_remote_oid: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameInput {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    pub content: String,
    pub snapshot_id: String,
    pub model_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameCommit {
    pub hash: String,
    pub author_name: String,
    pub author_timestamp: i64,
    pub author_timezone_offset_minutes: i32,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameRange {
    pub start_line: usize,
    pub line_count: usize,
    pub commit_index: Option<usize>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitBlameStatus {
    Ready,
    Uncommitted,
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameResponse {
    pub snapshot_id: String,
    pub model_version: i64,
    pub root_id: String,
    pub root_relative_path: String,
    pub base_commit_oid: Option<String>,
    pub buffer_line_count: usize,
    pub status: GitBlameStatus,
    pub ranges: Vec<GitBlameRange>,
    pub commits: Vec<GitBlameCommit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetails {
    pub hash: String,
    pub author_name: String,
    pub author_timestamp: i64,
    pub author_timezone_offset_minutes: i32,
    pub subject: String,
    pub full_message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetailsQuery {
    pub root: Option<String>,
    pub worktree_path: Option<String>,
}
