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
    resolve_conflict, stage_files, unstage_files,
};
pub use progress::ProgressSender;
pub use repository::{fetch, get_status, list_branches, pull, update_branch};
pub use types::{
    BranchInfo, BranchUpdateResult, ConflictFile, DiffFileEntry, FileDiffContent, GitOperation,
    GitOperationResult, GitProgressEvent, GitProgressPhase, GitStatus, HunkInfo, Worktree,
    WorktreeAddOptions,
};
pub use worktree::{
    add as add_worktree, list as list_worktrees, prune as prune_worktrees,
    remove as remove_worktree,
};
