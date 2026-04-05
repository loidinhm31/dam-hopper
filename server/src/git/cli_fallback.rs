/// CLI fallback operations via tokio::process::Command.
///
/// Used for operations where git2 is insufficient or unreliable:
/// - push (credential handling: SSH agent, keychain, helper chains)
/// - pull (when ff-only merge fails, user may need to rebase/merge interactively)
/// - worktree add/remove (git2 worktree API is incomplete)
use std::path::Path;
use std::time::Instant;
use tokio::process::Command;

use crate::error::AppError;
use crate::git::types::{GitOperation, GitOperationResult, Worktree, WorktreeAddOptions};
use crate::git::progress::{ProgressSender, emit_started, emit_completed, emit_failed};

/// Validates branch names per git ref spec rules (git-check-ref-format).
/// Rejects: leading dash, path traversal, null bytes, whitespace,
/// and git-special chars (~, ^, :, @{, \, *).
fn validate_branch_name(branch: &str) -> Result<(), AppError> {
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
        return Err(AppError::InvalidInput(format!("Invalid branch name: {branch}")));
    }
    Ok(())
}

async fn run_git(args: &[&str], cwd: &Path) -> Result<String, AppError> {
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

pub async fn push(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
) -> GitOperationResult {
    let start = Instant::now();
    emit_started(progress, project_name, "push", "Pushing...");

    match run_git(&["push"], project_path).await {
        Ok(_) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            emit_completed(progress, project_name, "push", "Push complete");
            GitOperationResult {
                project_name: project_name.to_string(),
                operation: GitOperation::Push,
                success: true,
                summary: Some("Pushed to remote".to_string()),
                error: None,
                duration_ms,
            }
        }
        Err(e) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let msg = e.to_string();
            emit_failed(progress, project_name, "push", &msg);
            GitOperationResult {
                project_name: project_name.to_string(),
                operation: GitOperation::Push,
                success: false,
                summary: None,
                error: Some(msg),
                duration_ms,
            }
        }
    }
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
    Ok(parse_worktree_porcelain(&output))
}

pub async fn add_worktree(
    project_path: &Path,
    options: &WorktreeAddOptions,
) -> Result<Worktree, AppError> {
    validate_branch_name(&options.branch)?;
    if let Some(base) = &options.base_branch {
        validate_branch_name(base)?;
    }

    let worktree_path = match &options.path {
        Some(p) => p.clone(),
        None => {
            let parent = project_path
                .parent()
                .ok_or_else(|| AppError::Git("Cannot determine parent directory".to_string()))?;
            let project_name = project_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project");
            parent
                .join(format!("{}-{}", project_name, options.branch))
                .to_string_lossy()
                .into_owned()
        }
    };

    let mut args = vec!["worktree", "add"];
    if options.create_branch {
        args.push("-b");
        args.push(&options.branch);
    }
    args.push(&worktree_path);
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
    worktrees
        .into_iter()
        .find(|w| w.path == worktree_path)
        .ok_or_else(|| {
            AppError::Git(format!(
                "Worktree created at {worktree_path} but not found in list"
            ))
        })
}

pub async fn remove_worktree(project_path: &Path, worktree_path: &str) -> Result<(), AppError> {
    run_git(&["worktree", "remove", worktree_path], project_path).await?;
    Ok(())
}

pub async fn prune_worktrees(project_path: &Path) -> Result<(), AppError> {
    run_git(&["worktree", "prune"], project_path).await?;
    Ok(())
}

fn parse_worktree_porcelain(output: &str) -> Vec<Worktree> {
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

        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                path = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                commit_hash = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                branch = rest.replace("refs/heads/", "");
            } else if line == "bare" {
                branch = "(bare)".to_string();
            } else if line == "detached" {
                branch = "(detached)".to_string();
            } else if line.starts_with("locked") {
                is_locked = true;
            }
        }

        if path.is_empty() {
            continue;
        }

        let is_main = worktrees.is_empty();
        worktrees.push(Worktree {
            path,
            branch,
            commit_hash,
            is_main,
            is_locked,
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
        let wts = parse_worktree_porcelain(output);
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
        let wts = parse_worktree_porcelain(output);
        assert_eq!(wts.len(), 2);
        assert!(wts[0].is_main);
        assert!(!wts[1].is_main);
        assert!(wts[1].is_locked);
    }

    #[test]
    fn parse_worktree_porcelain_detached() {
        let output = "worktree /home/user/project\nHEAD abc123\ndetached\n\n";
        let wts = parse_worktree_porcelain(output);
        assert_eq!(wts[0].branch, "(detached)");
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
            assert!(validate_branch_name(bad).is_err(), "expected error for: {bad}");
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
