use std::path::{Component, Path};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::git::cli_fallback;
use crate::git::types::{GitActionResult, GitBlockReason};

fn validate_rel_path(path: &str) -> Result<(), AppError> {
    if path.is_empty() || path.starts_with('/') || path.starts_with('\\') {
        return Err(AppError::InvalidInput(format!("invalid path: {path}")));
    }
    if Path::new(path)
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err(AppError::InvalidInput(format!(
            "path traversal rejected: {path}"
        )));
    }
    Ok(())
}

fn validate_paths(paths: &[String]) -> Result<Vec<&str>, AppError> {
    if paths.is_empty() {
        return Err(AppError::InvalidInput("paths cannot be empty".to_string()));
    }
    for path in paths {
        validate_rel_path(path)?;
    }
    Ok(paths.iter().map(String::as_str).collect())
}

fn validate_commit<'repo>(
    repo: &'repo git2::Repository,
    hash: &str,
) -> Result<git2::Commit<'repo>, AppError> {
    let oid = git2::Oid::from_str(hash)
        .map_err(|_| AppError::InvalidInput(format!("invalid commit hash: {hash}")))?;
    repo.find_commit(oid)
        .map_err(|_| AppError::InvalidInput(format!("unknown commit hash: {hash}")))
}

fn first_parent_or_empty_tree(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
) -> Result<String, AppError> {
    if commit.parent_count() > 0 {
        return Ok(commit
            .parent(0)
            .map_err(|e| AppError::Git(e.message().to_string()))?
            .id()
            .to_string());
    }
    let tree_id = repo
        .treebuilder(None)
        .and_then(|builder| builder.write())
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    Ok(tree_id.to_string())
}

async fn git_output(args: &[&str], cwd: &Path) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("Failed to spawn git: {e}")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(AppError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

async fn git_status(args: &[&str], cwd: &Path) -> Result<bool, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("Failed to spawn git: {e}")))?;
    Ok(output.status.success())
}

async fn selected_patch(
    project_path: &Path,
    parent: &str,
    hash: &str,
    paths: &[&str],
) -> Result<String, AppError> {
    let mut output = Command::new("git");
    output
        .current_dir(project_path)
        .args(["diff", "--binary", parent, hash, "--"])
        .args(paths);
    let output = output
        .output()
        .await
        .map_err(|e| AppError::Git(format!("Failed to spawn git diff: {e}")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(AppError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

async fn apply_patch(
    project_path: &Path,
    patch: &str,
    reverse: bool,
    index: bool,
) -> Result<(), AppError> {
    let mut command = Command::new("git");
    command
        .current_dir(project_path)
        .arg("apply")
        .arg("--3way")
        .arg("--quiet")
        .stdin(Stdio::piped());
    if reverse {
        command.arg("--reverse");
    }
    if index {
        command.arg("--index");
    }

    let mut child = command
        .spawn()
        .map_err(|e| AppError::Git(format!("Failed to spawn git apply: {e}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Git("failed to open git apply stdin".to_string()))?;
    stdin
        .write_all(patch.as_bytes())
        .await
        .map_err(AppError::Io)?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Git(format!("Failed to wait for git apply: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

async fn preflight_history_rewrite(
    project_path: &Path,
    hash: &str,
    root_message: &str,
) -> Result<Option<GitActionResult>, AppError> {
    let parent_count = {
        let repo = git2::Repository::open(project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let commit = validate_commit(&repo, hash)?;
        commit.parent_count()
    };

    if let Some(recovery) = cli_fallback::active_git_operation(project_path).await? {
        let mut blocked = GitActionResult::blocked(
            GitBlockReason::ActiveOperation,
            "another Git operation is already in progress",
            "finish or abort the in-progress operation before starting a destructive action",
        );
        blocked.recovery = Some(recovery);
        return Ok(Some(blocked));
    }
    if !cli_fallback::is_clean_worktree(project_path).await? {
        return Ok(Some(GitActionResult::blocked(
            GitBlockReason::DirtyWorktree,
            "working tree must be clean before rewriting history",
            "commit, stash, or discard local changes first",
        )));
    }
    if !cli_fallback::is_commit_reachable_from_head(project_path, hash).await? {
        return Ok(Some(GitActionResult::blocked(
            GitBlockReason::UnreachableCommit,
            format!("commit {hash} is not reachable from HEAD"),
            "check out the branch that contains this commit first",
        )));
    }
    if cli_fallback::is_commit_pushed(project_path, hash).await? {
        return Ok(Some(GitActionResult::blocked(
            GitBlockReason::PushedCommit,
            format!("commit {hash} is already reachable from upstream"),
            "use revert for pushed/shared history",
        )));
    }
    if parent_count == 0 {
        return Ok(Some(GitActionResult::blocked(
            GitBlockReason::RootCommit,
            root_message,
            "create a new replacement commit instead of rewriting the root commit",
        )));
    }
    Ok(None)
}

pub async fn cherry_pick_commit_files(
    project_path: &Path,
    hash: &str,
    paths: &[String],
) -> Result<GitActionResult, AppError> {
    let path_refs = validate_paths(paths)?;
    let parent = {
        let repo = git2::Repository::open(project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let commit = validate_commit(&repo, hash)?;
        first_parent_or_empty_tree(&repo, &commit)?
    };
    let patch = selected_patch(project_path, &parent, hash, &path_refs).await?;
    if patch.trim().is_empty() {
        return Ok(GitActionResult::ok("No selected changes to cherry-pick"));
    }

    match apply_patch(project_path, &patch, false, false).await {
        Ok(()) => Ok(GitActionResult {
            ok: true,
            message: Some(format!(
                "Cherry-picked {} selected file change(s)",
                paths.len()
            )),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(false),
            dirty: Some(true),
            destructive: Some(false),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        }),
        Err(AppError::Git(stderr)) => Ok(GitActionResult {
            ok: false,
            message: Some(stderr),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(true),
            dirty: Some(true),
            destructive: Some(false),
            recovery: cli_fallback::active_git_operation(project_path)
                .await
                .ok()
                .flatten(),
            blocked_reason: None,
            recommendation: Some("resolve conflicts before continuing".to_string()),
        }),
        Err(err) => Err(err),
    }
}

pub async fn drop_commit_files(
    project_path: &Path,
    hash: &str,
    paths: &[String],
) -> Result<GitActionResult, AppError> {
    let path_refs = validate_paths(paths)?;
    if let Some(mut blocked) = preflight_history_rewrite(
        project_path,
        hash,
        "drop selected changes is not supported for root commits",
    )
    .await?
    {
        blocked.hash = Some(hash.to_string());
        return Ok(blocked);
    }

    let (parent, branch, head) = {
        let repo = git2::Repository::open(project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let commit = validate_commit(&repo, hash)?;
        let head_ref = repo
            .head()
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let branch = head_ref
            .shorthand()
            .filter(|_| head_ref.is_branch())
            .ok_or_else(|| {
                AppError::InvalidInput("drop requires a checked-out branch".to_string())
            })?
            .to_string();
        let head = head_ref
            .peel_to_commit()
            .map_err(|e| AppError::Git(e.message().to_string()))?
            .id()
            .to_string();
        (first_parent_or_empty_tree(&repo, &commit)?, branch, head)
    };

    let patch = selected_patch(project_path, &parent, hash, &path_refs).await?;
    if patch.trim().is_empty() {
        return Ok(GitActionResult::ok("No selected changes to drop"));
    }

    cli_fallback::run_git(&["checkout", "--detach", hash], project_path).await?;
    if let Err(err) = apply_patch(project_path, &patch, true, true).await {
        let _ = cli_fallback::run_git(&["checkout", &branch], project_path).await;
        return match err {
            AppError::Git(stderr) => Ok(GitActionResult {
                ok: false,
                message: Some(stderr),
                branch: Some(branch),
                hash: Some(hash.to_string()),
                stashed: None,
                conflict: Some(true),
                dirty: Some(true),
                destructive: Some(true),
                recovery: cli_fallback::active_git_operation(project_path)
                    .await
                    .ok()
                    .flatten(),
                blocked_reason: None,
                recommendation: Some(
                    "abort the in-progress operation, then retry selected-file drop".to_string(),
                ),
            }),
            other => Err(other),
        };
    }

    let new_base = if git_status(&["diff", "--cached", "--quiet", &parent], project_path).await? {
        parent
    } else {
        cli_fallback::run_git(&["commit", "--amend", "--no-edit"], project_path).await?;
        git_output(&["rev-parse", "HEAD"], project_path).await?
    };

    if head == hash {
        cli_fallback::run_git(&["branch", "-f", &branch, &new_base], project_path).await?;
        cli_fallback::run_git(&["checkout", &branch], project_path).await?;
    } else {
        cli_fallback::run_git(&["checkout", &branch], project_path).await?;
        match cli_fallback::run_git(
            &["rebase", "--onto", &new_base, hash, &branch],
            project_path,
        )
        .await
        {
            Ok(_) => {}
            Err(AppError::Git(stderr)) => {
                return Ok(GitActionResult {
                    ok: false,
                    message: Some(stderr),
                    branch: Some(branch),
                    hash: Some(hash.to_string()),
                    stashed: None,
                    conflict: Some(true),
                    dirty: Some(true),
                    destructive: Some(true),
                    recovery: cli_fallback::active_git_operation(project_path)
                        .await
                        .ok()
                        .flatten(),
                    blocked_reason: None,
                    recommendation: Some(
                        "resolve rebase conflicts, then continue or abort".to_string(),
                    ),
                });
            }
            Err(err) => return Err(err),
        }
    }

    Ok(GitActionResult {
        ok: true,
        message: Some(format!("Dropped {} selected file change(s)", paths.len())),
        branch: Some(branch),
        hash: Some(hash.to_string()),
        stashed: None,
        conflict: Some(false),
        dirty: Some(false),
        destructive: Some(true),
        recovery: None,
        blocked_reason: None,
        recommendation: None,
    })
}

pub async fn drop_commit(project_path: &Path, hash: &str) -> Result<GitActionResult, AppError> {
    {
        let repo = git2::Repository::open(project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        validate_commit(&repo, hash)?;
    }
    if let Some(mut blocked) = preflight_history_rewrite(
        project_path,
        hash,
        "drop commit is not supported for root commits",
    )
    .await?
    {
        blocked.hash = Some(hash.to_string());
        return Ok(blocked);
    }

    let branch = match cli_fallback::current_branch(project_path).await {
        Ok(branch) => branch,
        Err(_) => {
            let mut blocked = GitActionResult::blocked(
                GitBlockReason::DetachedHead,
                "drop requires a checked-out branch",
                "check out a branch before dropping commits",
            );
            blocked.hash = Some(hash.to_string());
            return Ok(blocked);
        }
    };
    let head = cli_fallback::head_hash(project_path).await?;
    let parent = cli_fallback::first_parent(project_path, hash).await?;

    let result = if head == hash {
        cli_fallback::run_git(&["reset", "--hard", &parent], project_path).await
    } else {
        cli_fallback::run_git(&["rebase", "--onto", &parent, hash, &branch], project_path).await
    };

    match result {
        Ok(_) => Ok(GitActionResult {
            ok: true,
            message: Some(format!("Dropped commit {hash}")),
            branch: Some(branch),
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(false),
            dirty: Some(false),
            destructive: Some(true),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        }),
        Err(AppError::Git(stderr)) => Ok(GitActionResult {
            ok: false,
            message: Some(stderr),
            branch: Some(branch),
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(true),
            dirty: Some(true),
            destructive: Some(true),
            recovery: cli_fallback::active_git_operation(project_path)
                .await
                .ok()
                .flatten(),
            blocked_reason: None,
            recommendation: Some("resolve rebase conflicts, then continue or abort".to_string()),
        }),
        Err(err) => Err(err),
    }
}

pub async fn revert_commit(project_path: &Path, hash: &str) -> Result<GitActionResult, AppError> {
    {
        let repo = git2::Repository::open(project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        validate_commit(&repo, hash)?;
    }
    if let Some(recovery) = cli_fallback::active_git_operation(project_path).await? {
        let mut blocked = GitActionResult::blocked(
            GitBlockReason::ActiveOperation,
            "another Git operation is already in progress",
            "finish or abort the in-progress operation before reverting",
        );
        blocked.hash = Some(hash.to_string());
        blocked.recovery = Some(recovery);
        return Ok(blocked);
    }

    match cli_fallback::run_git(&["revert", hash], project_path).await {
        Ok(_) => Ok(GitActionResult {
            ok: true,
            message: Some(format!("Reverted commit {hash}")),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(false),
            dirty: Some(false),
            destructive: Some(false),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        }),
        Err(AppError::Git(stderr)) => Ok(GitActionResult {
            ok: false,
            message: Some(stderr),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(true),
            dirty: Some(true),
            destructive: Some(false),
            recovery: cli_fallback::active_git_operation(project_path)
                .await
                .ok()
                .flatten(),
            blocked_reason: None,
            recommendation: Some("resolve revert conflicts, then continue or abort".to_string()),
        }),
        Err(err) => Err(err),
    }
}

pub async fn revert_commit_files(
    project_path: &Path,
    hash: &str,
    paths: &[String],
) -> Result<GitActionResult, AppError> {
    let path_refs = validate_paths(paths)?;
    let parent = {
        let repo = git2::Repository::open(project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let commit = validate_commit(&repo, hash)?;
        first_parent_or_empty_tree(&repo, &commit)?
    };
    let patch = selected_patch(project_path, &parent, hash, &path_refs).await?;
    if patch.trim().is_empty() {
        return Ok(GitActionResult::ok("No selected changes to revert"));
    }

    match apply_patch(project_path, &patch, true, false).await {
        Ok(()) => Ok(GitActionResult {
            ok: true,
            message: Some(format!("Reverted {} selected file change(s)", paths.len())),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(false),
            dirty: Some(true),
            destructive: Some(false),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        }),
        Err(AppError::Git(stderr)) => Ok(GitActionResult {
            ok: false,
            message: Some(stderr),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(true),
            dirty: Some(true),
            destructive: Some(false),
            recovery: cli_fallback::active_git_operation(project_path)
                .await
                .ok()
                .flatten(),
            blocked_reason: None,
            recommendation: Some("resolve conflicts before continuing".to_string()),
        }),
        Err(err) => Err(err),
    }
}
