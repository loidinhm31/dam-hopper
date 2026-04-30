pub mod bulk;
pub mod cli_fallback;
pub mod diff;
pub mod progress;
pub mod repository;
pub mod types;
pub mod worktree;

#[cfg(test)]
mod tests;

pub use bulk::BulkGitService;
pub use diff::{
    commit_files, discard_file, discard_hunk, get_conflicts, get_diff_files, get_file_diff,
    get_untracked_page, resolve_conflict, stage_files, unstage_files, get_commit_files,
    get_commit_file_diff,
};
pub use progress::ProgressSender;
pub use repository::{fetch, get_status, list_branches, pull, update_branch, get_log};
pub use types::{
    BranchInfo, BranchUpdateResult, ConflictFile, DiffFileEntry, DiffResponse, FileDiffContent,
    GitOperation, GitOperationResult, GitProgressEvent, GitProgressPhase, GitStatus, HunkInfo,
    GitLogEntry, Worktree, WorktreeAddOptions, UNTRACKED_PAGE_SIZE,
};
pub use worktree::{
    add as add_worktree, list as list_worktrees, prune as prune_worktrees,
    remove as remove_worktree,
};
