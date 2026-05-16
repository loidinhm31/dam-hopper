pub mod bulk;
pub mod cli_fallback;
pub mod commit_file_ops;
pub mod diff;
pub mod progress;
pub mod repository;
pub mod types;
pub mod worktree;

#[cfg(test)]
mod tests;

pub use bulk::BulkGitService;
pub use commit_file_ops::{cherry_pick_commit_files, drop_commit_files};
pub use diff::{
    commit_files, discard_file, discard_hunk, get_commit_file_diff, get_commit_files,
    get_conflicts, get_diff_files, get_file_diff, get_untracked_page, resolve_conflict,
    stage_files, unstage_files,
};
pub use progress::ProgressSender;
pub use repository::{
    checkout_branch, cherry_pick, create_branch, fetch, get_log, get_status, list_branches, pull,
    reset_to_commit, update_branch,
};
pub use types::{
    BranchInfo, BranchUpdateResult, CheckoutStrategy, ConflictFile, DiffFileEntry, DiffResponse,
    FileDiffContent, GitActionResult, GitLogEntry, GitOperation, GitOperationResult,
    GitProgressEvent, GitProgressPhase, GitStatus, HunkInfo, ResetMode, Worktree,
    WorktreeAddOptions, UNTRACKED_PAGE_SIZE,
};
pub use worktree::{
    add as add_worktree, list as list_worktrees, prune as prune_worktrees,
    remove as remove_worktree,
};
