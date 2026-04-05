pub mod bulk;
pub mod cli_fallback;
pub mod progress;
pub mod repository;
pub mod types;
pub mod worktree;

#[cfg(test)]
mod tests;

pub use bulk::BulkGitService;
pub use progress::ProgressSender;
pub use repository::{fetch, get_status, list_branches, pull, update_branch};
pub use types::{
    BranchInfo, BranchUpdateResult, GitOperation, GitOperationResult, GitProgressEvent,
    GitProgressPhase, GitStatus, Worktree, WorktreeAddOptions,
};
pub use worktree::{
    add as add_worktree, list as list_worktrees, prune as prune_worktrees,
    remove as remove_worktree,
};
