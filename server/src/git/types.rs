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
    Revert,
    Unsupported,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictStatus {
    BothModified,
    ModifyDelete,
    DeleteModify,
    BothAdded,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSummaryEntry {
    pub conflict_id: String,
    pub path: String,
    pub status: ConflictStatus,
    pub is_binary: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSummaryResponse {
    pub target_revision: String,
    pub entries: Vec<ConflictSummaryEntry>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StageKind {
    Text,
    Binary,
    Missing,
    InvalidEncoding,
    Unsupported,
    ReadError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDescriptor {
    pub stage: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oid: Option<String>,
    pub mode: u32,
    pub byte_size: u64,
    pub kind: StageKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_tokens: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeKind {
    Regular,
    Symlink,
    Directory,
    Gitlink,
    Unreadable,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDescriptor {
    pub exists: bool,
    pub kind: WorktreeKind,
    pub mode: u32,
    pub byte_length: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_tokens: Option<Vec<String>>,
    pub has_conflict_markers: bool,
    pub is_dirty_vs_stages: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveAttributes {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    pub ident: bool,
    pub filter_qualified: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub core_autocrlf: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub core_eol: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictStages {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<StageDescriptor>,
    pub ours: StageDescriptor,
    pub theirs: StageDescriptor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSnapshot {
    pub conflict_id: String,
    pub path: String,
    pub repository_root: String,
    pub worktree_root: String,
    pub snapshot_version: String,
    pub full_index_fingerprint: String,
    pub status: ConflictStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<String>,
    pub stages: ConflictStages,
    pub worktree: WorktreeDescriptor,
    pub effective_attributes: EffectiveAttributes,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolveEol {
    Lf,
    Crlf,
    Preserve,
}

fn default_eol_preserve() -> ResolveEol {
    ResolveEol::Preserve
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolveSide {
    Ours,
    Theirs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type",
    deny_unknown_fields
)]
pub enum ResolveAction {
    #[serde(rename = "reviewedText")]
    ReviewedText {
        tokens: Vec<String>,
        #[serde(default = "default_eol_preserve")]
        eol: ResolveEol,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        executable: Option<bool>,
    },
    #[serde(rename = "indexSide")]
    IndexSide { side: ResolveSide, stage: u16 },
    #[serde(rename = "delete")]
    Delete {},
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveRequest {
    pub conflict_id: String,
    pub snapshot_version: String,
    pub full_index_fingerprint: String,
    pub action: ResolveAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "outcome"
)]
pub enum ResolveOutcome {
    #[serde(rename = "applied")]
    Applied {
        #[serde(skip_serializing_if = "Option::is_none")]
        new_oid: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stage0_mode: Option<u32>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        deleted: bool,
    },
    #[serde(rename = "stale")]
    Stale {
        reason: String,
        required_refresh: bool,
    },
    #[serde(rename = "unsupported")]
    Unsupported { reason: String },
    #[serde(rename = "busy")]
    Busy { reason: String },
    #[serde(rename = "failedBeforeWrite")]
    FailedBeforeWrite { error: String },
    #[serde(rename = "worktreeChangedStageFailed")]
    WorktreeChangedStageFailed {
        error: String,
        worktree_written: bool,
        staged: bool,
    },
    #[serde(rename = "outcomeUnknown")]
    OutcomeUnknown {
        error: String,
        required_refresh: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OperationKind {
    None,
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Unsupported,
    Unknown,
}

impl OperationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            OperationKind::None => "none",
            OperationKind::Merge => "merge",
            OperationKind::Rebase => "rebase",
            OperationKind::CherryPick => "cherry-pick",
            OperationKind::Revert => "revert",
            OperationKind::Unsupported => "unsupported",
            OperationKind::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationStoppedReason {
    Conflicts,
    MessageEditRequired,
    HookBlocked,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageRoleLabels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    pub ours: String,
    pub theirs: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHandoffRequired {
    pub reason: String,
    pub worktree_root: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationStatusResponse {
    pub operation: OperationKind,
    pub can_continue: bool,
    pub can_abort: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped_reason: Option<OperationStoppedReason>,
    pub operation_fingerprint: String,
    pub full_index_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_role_labels: Option<StageRoleLabels>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_handoff_required: Option<TerminalHandoffRequired>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationAction {
    Continue,
    Abort,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationActionRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    pub operation_precondition: String,
    pub full_index_fingerprint: String,
    pub action: OperationAction,
    #[serde(default)]
    pub abort_confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "outcome"
)]
pub enum OperationOutcome {
    #[serde(rename = "continued")]
    Continued { new_status: OperationStatusResponse },
    #[serde(rename = "aborted")]
    Aborted { worktree_cleaned: bool },
    #[serde(rename = "blocked")]
    Blocked {
        reason: OperationStoppedReason,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        terminal_handoff_required: bool,
    },
    #[serde(rename = "stale")]
    Stale {
        reason: String,
        required_refresh: bool,
    },
    #[serde(rename = "failed")]
    Failed { error: String },
    #[serde(rename = "outcomeUnknown")]
    OutcomeUnknown {
        error: String,
        required_refresh: bool,
    },
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
    pub author_email: String,
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
    pub author_email: String,
    pub author_timestamp: i64,
    pub author_timezone_offset_minutes: i32,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_timestamp: i64,
    pub committer_timezone_offset_minutes: i32,
    pub subject: String,
    pub full_message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetailsQuery {
    pub root: Option<String>,
    pub worktree_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_outcome_and_attributes_camel_case_json() {
        let attrs = EffectiveAttributes {
            eol: Some("lf".into()),
            encoding: None,
            ident: false,
            filter_qualified: true,
            text: Some("auto".into()),
            core_autocrlf: Some("false".into()),
            core_eol: Some("lf".into()),
        };
        let json = serde_json::to_string(&attrs).unwrap();
        assert!(json.contains("\"filterQualified\":true"));
        assert!(json.contains("\"coreAutocrlf\":\"false\""));
        assert!(json.contains("\"coreEol\":\"lf\""));

        let outcome_stale = ResolveOutcome::Stale {
            reason: "state changed".into(),
            required_refresh: true,
        };
        let json_stale = serde_json::to_string(&outcome_stale).unwrap();
        assert!(json_stale.contains("\"requiredRefresh\":true"));

        let outcome_applied = ResolveOutcome::Applied {
            new_oid: Some("abc123".into()),
            stage0_mode: Some(0o100644),
            deleted: false,
        };
        let json_applied = serde_json::to_string(&outcome_applied).unwrap();
        assert!(json_applied.contains("\"newOid\":\"abc123\""));
        assert!(json_applied.contains("\"stage0Mode\":33188"));

        let outcome_failed = ResolveOutcome::WorktreeChangedStageFailed {
            error: "lock err".into(),
            worktree_written: true,
            staged: false,
        };
        let json_failed = serde_json::to_string(&outcome_failed).unwrap();
        assert!(json_failed.contains("\"worktreeWritten\":true"));
        assert!(json_failed.contains("\"staged\":false"));
    }

    #[test]
    fn test_resolve_request_rejects_unknown_fields() {
        let json = r#"{
            "conflictId": "cid_123",
            "snapshotVersion": "snap1",
            "fullIndexFingerprint": "fp1",
            "action": {
                "type": "delete"
            },
            "unknownProperty": 42
        }"#;
        let res: Result<ResolveRequest, _> = serde_json::from_str(json);
        assert!(res.is_err(), "Must reject unknown fields on request");

        let json_delete_extra = r#"{
            "conflictId": "cid_123",
            "snapshotVersion": "snap1",
            "fullIndexFingerprint": "fp1",
            "action": {
                "type": "delete",
                "extraField": 123
            }
        }"#;
        let res2: Result<ResolveRequest, _> = serde_json::from_str(json_delete_extra);
        assert!(res2.is_err(), "Must reject unknown fields on delete action");
    }

    #[test]
    fn test_resolve_request_parses_delete_action_successfully() {
        let json_delete = r#"{
            "conflictId": "cid_123",
            "snapshotVersion": "snap1",
            "fullIndexFingerprint": "fp1",
            "action": {
                "type": "delete"
            }
        }"#;
        let res: Result<ResolveRequest, _> = serde_json::from_str(json_delete);
        assert!(res.is_ok(), "Must accept valid delete action");
        assert!(matches!(res.unwrap().action, ResolveAction::Delete {}));
    }
}
