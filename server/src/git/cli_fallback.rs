/// CLI fallback operations via tokio::process::Command.
///
/// Used for operations where git2 is insufficient or unreliable:
/// - pull (when ff-only merge fails, user may need to rebase/merge interactively)
/// - worktree add/remove (git2 worktree API is incomplete)
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::process::Command;

use crate::error::AppError;
use crate::git::progress::{emit_completed, emit_failed, emit_started, ProgressSender};
use crate::git::types::{
    GitOperation, GitOperationResult, GitRecoveryOperation, GitRecoveryState, Worktree,
    WorktreeAddOptions,
};

/// Validates branch names per git ref spec rules (git-check-ref-format).
/// Rejects: leading dash, path traversal, null bytes, whitespace,
/// and git-special chars (~, ^, :, @{, \, *).
pub(crate) fn validate_branch_name(branch: &str) -> Result<(), AppError> {
    let invalid = branch.is_empty()
        || branch.starts_with('-')
        || branch.starts_with('.')
        || branch.ends_with('.')
        || branch.starts_with('/')
        || branch.ends_with('/')
        || branch.ends_with(".lock")
        || branch.contains("..")
        || branch.contains("@{")
        || branch.contains(['~', '^', ':', '\\', '*', '\x00', '\n', ' ', '\t']);

    if invalid {
        return Err(AppError::InvalidInput(format!(
            "Invalid branch name: {branch}"
        )));
    }
    Ok(())
}

pub(crate) async fn run_git(args: &[&str], cwd: &Path) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("Failed to spawn git: {e}")))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(AppError::Git(stderr.trim().to_string()))
    }
}

pub(crate) async fn repository_root(cwd: &Path) -> Result<PathBuf, AppError> {
    let root = match run_git(&["rev-parse", "--show-toplevel"], cwd).await {
        Ok(output) => PathBuf::from(output.trim()),
        Err(AppError::Git(message))
            if message
                .to_ascii_lowercase()
                .contains("must be run in a work tree") =>
        {
            let git_dir = run_git(&["rev-parse", "--git-dir"], cwd).await?;
            let git_dir = PathBuf::from(git_dir.trim());
            if git_dir.is_absolute() {
                git_dir
            } else {
                cwd.join(git_dir)
            }
        }
        Err(error) => return Err(error),
    };
    if root.as_os_str().is_empty() {
        return Err(AppError::Git("Git repository root is empty".to_string()));
    }
    Ok(root)
}

pub(crate) async fn current_branch(cwd: &Path) -> Result<String, AppError> {
    let branch = run_git(&["branch", "--show-current"], cwd)
        .await?
        .trim()
        .to_string();
    if branch.is_empty() {
        return Err(AppError::InvalidInput(
            "operation requires a checked-out branch".to_string(),
        ));
    }
    Ok(branch)
}

pub(crate) async fn head_hash(cwd: &Path) -> Result<String, AppError> {
    Ok(run_git(&["rev-parse", "HEAD"], cwd)
        .await?
        .trim()
        .to_string())
}

pub(crate) async fn first_parent(cwd: &Path, hash: &str) -> Result<String, AppError> {
    Ok(run_git(&["rev-parse", &format!("{hash}^")], cwd)
        .await?
        .trim()
        .to_string())
}

pub(crate) async fn is_clean_worktree(cwd: &Path) -> Result<bool, AppError> {
    Ok(run_git(&["status", "--porcelain"], cwd)
        .await?
        .trim()
        .is_empty())
}

pub(crate) async fn active_git_operation(cwd: &Path) -> Result<Option<GitRecoveryState>, AppError> {
    if git_path_exists(cwd, "rebase-merge").await? || git_path_exists(cwd, "rebase-apply").await? {
        return Ok(Some(GitRecoveryState {
            operation: GitRecoveryOperation::Rebase,
            can_abort: true,
            can_continue: true,
        }));
    }
    if git_path_exists(cwd, "MERGE_HEAD").await? {
        return Ok(Some(GitRecoveryState {
            operation: GitRecoveryOperation::Merge,
            can_abort: true,
            can_continue: false,
        }));
    }
    if git_path_exists(cwd, "CHERRY_PICK_HEAD").await? {
        return Ok(Some(GitRecoveryState {
            operation: GitRecoveryOperation::CherryPick,
            can_abort: true,
            can_continue: true,
        }));
    }
    Ok(None)
}

pub(crate) async fn is_commit_reachable_from_head(
    cwd: &Path,
    hash: &str,
) -> Result<bool, AppError> {
    git_status(&["merge-base", "--is-ancestor", hash, "HEAD"], cwd).await
}

pub(crate) async fn is_commit_pushed(cwd: &Path, hash: &str) -> Result<bool, AppError> {
    let upstream = match run_git(
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        cwd,
    )
    .await
    {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => return Ok(false),
    };
    git_status(&["merge-base", "--is-ancestor", hash, &upstream], cwd).await
}

pub(crate) async fn git_status(args: &[&str], cwd: &Path) -> Result<bool, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("Failed to spawn git: {e}")))?;
    Ok(output.status.success())
}

async fn git_path_exists(cwd: &Path, git_path: &str) -> Result<bool, AppError> {
    let resolved = run_git(&["rev-parse", "--git-path", git_path], cwd)
        .await?
        .trim()
        .to_string();
    Ok(cwd.join(resolved).exists())
}

pub async fn pull_ff_only(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
) -> GitOperationResult {
    let start = Instant::now();
    emit_started(progress, project_name, "pull", "Pulling...");

    match run_git(&["pull", "--ff-only"], project_path).await {
        Ok(stdout) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let summary = if stdout.contains("Already up to date") {
                "Already up to date".to_string()
            } else {
                "Pull complete".to_string()
            };
            emit_completed(progress, project_name, "pull", &summary);
            GitOperationResult {
                project_name: project_name.to_string(),
                operation: GitOperation::Pull,
                success: true,
                summary: Some(summary),
                error: None,
                duration_ms,
            }
        }
        Err(e) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let msg = e.to_string();
            emit_failed(progress, project_name, "pull", &msg);
            GitOperationResult {
                project_name: project_name.to_string(),
                operation: GitOperation::Pull,
                success: false,
                summary: None,
                error: Some(msg),
                duration_ms,
            }
        }
    }
}

pub async fn list_worktrees(project_path: &Path) -> Result<Vec<Worktree>, AppError> {
    let output = run_git(&["worktree", "list", "--porcelain"], project_path).await?;
    let configured_root = repository_root(project_path).await.ok();
    let identity_root = configured_root
        .map(PathBuf::from)
        .or_else(|| Some(project_path.to_path_buf()));
    tokio::task::spawn_blocking(move || parse_worktree_porcelain(&output, identity_root.as_deref()))
        .await
        .map_err(|error| AppError::Internal(format!("worktree parser task failed: {error}")))
}

pub async fn add_worktree(
    project_path: &Path,
    options: &WorktreeAddOptions,
) -> Result<Worktree, AppError> {
    validate_branch_name(&options.branch)?;
    if let Some(base) = &options.base_branch {
        validate_branch_name(base)?;
    }

    let project_root =
        dunce::canonicalize(project_path).unwrap_or_else(|_| project_path.to_path_buf());
    let worktree_path = match &options.path {
        Some(path) => {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                path
            } else {
                project_root.join(path)
            }
        }
        None => {
            let parent = project_root
                .parent()
                .ok_or_else(|| AppError::Git("Cannot determine parent directory".to_string()))?;
            let project_name = project_root
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project");
            parent.join(format!("{}-{}", project_name, options.branch))
        }
    };
    let worktree_path_string = worktree_path.to_string_lossy().into_owned();

    let mut args = vec!["worktree", "add"];
    if options.create_branch {
        args.push("-b");
        args.push(&options.branch);
    }
    args.push(&worktree_path_string);
    if !options.create_branch {
        args.push(&options.branch);
    }
    let base_ref;
    if let Some(base) = &options.base_branch {
        base_ref = base.as_str();
        args.push(base_ref);
    }

    run_git(&args, project_path).await?;

    let worktrees = list_worktrees(project_path).await?;
    let expected_path = dunce::canonicalize(&worktree_path).unwrap_or(worktree_path.clone());
    worktrees
        .into_iter()
        .find(|worktree| {
            dunce::canonicalize(&worktree.path).unwrap_or_else(|_| PathBuf::from(&worktree.path))
                == expected_path
        })
        .ok_or_else(|| {
            AppError::Git(format!(
                "Worktree created at {worktree_path_string} but not found in list"
            ))
        })
}

pub async fn remove_worktree(
    project_path: &Path,
    worktree_path: &str,
    force: bool,
) -> Result<(), AppError> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    run_git(&args, project_path).await?;
    Ok(())
}

pub async fn prune_worktrees(project_path: &Path) -> Result<(), AppError> {
    run_git(&["worktree", "prune"], project_path).await?;
    Ok(())
}

fn parse_worktree_porcelain(output: &str, configured_root: Option<&Path>) -> Vec<Worktree> {
    let mut worktrees = Vec::new();
    let blocks = output.trim().split("\n\n");

    for block in blocks {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let mut path = String::new();
        let mut commit_hash = String::new();
        let mut branch = String::new();
        let mut is_locked = false;
        let mut is_detached = false;
        let mut is_bare = false;
        let mut is_prunable = false;

        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                path = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                commit_hash = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                branch = rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string();
            } else if line == "bare" {
                branch = "(bare)".to_string();
                is_bare = true;
            } else if line == "detached" {
                branch = "(detached)".to_string();
                is_detached = true;
            } else if line == "locked" || line.starts_with("locked ") {
                is_locked = true;
            } else if line == "prunable" || line.starts_with("prunable ") {
                is_prunable = true;
            }
        }

        if path.is_empty() {
            continue;
        }

        let is_main = configured_root.is_some_and(|root| {
            match (dunce::canonicalize(root), dunce::canonicalize(&path)) {
                (Ok(root), Ok(path)) => root == path,
                _ => root == Path::new(&path),
            }
        });
        let is_available = !is_bare
            && !is_prunable
            && std::fs::symlink_metadata(&path)
                .map(|metadata| {
                    let file_type = metadata.file_type();
                    file_type.is_dir() && !file_type.is_symlink()
                })
                .unwrap_or(false);
        worktrees.push(Worktree {
            path,
            branch,
            commit_hash,
            is_main,
            is_locked,
            is_detached,
            is_bare,
            is_prunable,
            is_available,
        });
    }

    worktrees
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_worktree_porcelain_single() {
        let output = "worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n";
        let wts = parse_worktree_porcelain(output, Some(Path::new("/home/user/project")));
        assert_eq!(wts.len(), 1);
        assert_eq!(wts[0].branch, "main");
        assert_eq!(wts[0].commit_hash, "abc123");
        assert!(wts[0].is_main);
        assert!(!wts[0].is_locked);
    }

    #[test]
    fn parse_worktree_porcelain_multiple() {
        let output = "worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n\
                      worktree /home/user/project-feat\nHEAD def456\nbranch refs/heads/feat\nlocked reason\n\n";
        let wts = parse_worktree_porcelain(output, Some(Path::new("/home/user/project")));
        assert_eq!(wts.len(), 2);
        assert!(wts[0].is_main);
        assert!(!wts[1].is_main);
        assert!(wts[1].is_locked);
    }

    #[test]
    fn parse_worktree_porcelain_detached() {
        let output = "worktree /home/user/project\nHEAD abc123\ndetached\n\n";
        let wts = parse_worktree_porcelain(output, Some(Path::new("/home/user/project")));
        assert_eq!(wts[0].branch, "(detached)");
        assert!(wts[0].is_detached);
    }

    #[test]
    fn parse_worktree_porcelain_preserves_states_and_root_identity_when_reordered() {
        let output = "worktree /home/user/project-feature\nHEAD def456\nbranch refs/heads/feature\nlocked reason\n\n\
                      worktree /home/user/project\nHEAD abc123\ndetached\nprunable stale\n\n\
                      worktree /home/user/project-bare\nHEAD fedcba\nbare\n\n";
        let wts = parse_worktree_porcelain(output, Some(Path::new("/home/user/project")));

        assert_eq!(wts.len(), 3);
        assert!(!wts[0].is_main);
        assert!(wts[0].is_locked);
        assert!(!wts[0].is_detached);
        assert!(wts[1].is_main);
        assert!(wts[1].is_detached);
        assert!(wts[1].is_prunable);
        assert!(!wts[1].is_available);
        assert!(wts[2].is_bare);
    }

    #[test]
    fn validate_branch_rejects_leading_dash() {
        assert!(validate_branch_name("-bad").is_err());
    }

    #[test]
    fn validate_branch_rejects_dotdot() {
        assert!(validate_branch_name("a..b").is_err());
    }

    #[test]
    fn validate_branch_rejects_git_special_chars() {
        for bad in &["a~b", "a^b", "a:b", "a@{b", "a\\b", "a*b", "a b", "a\tb"] {
            assert!(
                validate_branch_name(bad).is_err(),
                "expected error for: {bad}"
            );
        }
    }

    #[test]
    fn validate_branch_rejects_leading_trailing_dot_slash() {
        assert!(validate_branch_name(".hidden").is_err());
        assert!(validate_branch_name("ends.").is_err());
        assert!(validate_branch_name("/abs").is_err());
        assert!(validate_branch_name("trailing/").is_err());
        assert!(validate_branch_name("locked.lock").is_err());
        assert!(validate_branch_name("").is_err());
    }

    #[test]
    fn validate_branch_accepts_valid() {
        assert!(validate_branch_name("feat/my-feature").is_ok());
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("release/1.0.0").is_ok());
        assert!(validate_branch_name("fix-123").is_ok());
        assert!(validate_branch_name("user/alice/patch-1").is_ok());
    }
}
