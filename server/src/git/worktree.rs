/// Worktree operations delegating to cli_fallback (CLI is more complete than git2 worktree API).
use std::path::Path;

use crate::error::AppError;
use crate::git::cli_fallback;
use crate::git::types::{Worktree, WorktreeAddOptions};

pub async fn list(project_path: &Path) -> Result<Vec<Worktree>, AppError> {
    cli_fallback::list_worktrees(project_path).await
}

pub async fn add(project_path: &Path, options: WorktreeAddOptions) -> Result<Worktree, AppError> {
    cli_fallback::add_worktree(project_path, &options).await
}

pub async fn remove(project_path: &Path, worktree_path: &str) -> Result<(), AppError> {
    cli_fallback::remove_worktree(project_path, worktree_path).await
}

pub async fn prune(project_path: &Path) -> Result<(), AppError> {
    cli_fallback::prune_worktrees(project_path).await
}
