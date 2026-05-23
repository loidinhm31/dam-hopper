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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub is_binary: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub commit_hash: String,
    pub is_main: bool,
    pub is_locked: bool,
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
