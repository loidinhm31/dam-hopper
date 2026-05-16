use std::path::{Component, Path};
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::git::cli_fallback;
use crate::git::types::GitActionResult;

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

async fn ensure_clean(project_path: &Path) -> Result<(), AppError> {
    let status = git_output(&["status", "--porcelain"], project_path).await?;
    if status.is_empty() {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "working tree must be clean before dropping selected changes".to_string(),
        ))
    }
}

async fn ensure_unpushed(project_path: &Path, hash: &str) -> Result<(), AppError> {
    let upstream = match git_output(
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        project_path,
    )
    .await
    {
        Ok(value) if !value.is_empty() => value,
        _ => return Ok(()),
    };
    if git_status(
        &["merge-base", "--is-ancestor", hash, &upstream],
        project_path,
    )
    .await?
    {
        return Err(AppError::InvalidInput(format!(
            "commit {hash} is already reachable from {upstream}"
        )));
    }
    Ok(())
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
    ensure_clean(project_path).await?;
    ensure_unpushed(project_path, hash).await?;

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
        let head_oid = git2::Oid::from_str(&head).unwrap();
        if head_oid != commit.id()
            && !repo
                .graph_descendant_of(head_oid, commit.id())
                .unwrap_or(false)
        {
            return Err(AppError::InvalidInput(format!(
                "commit {hash} is not reachable from HEAD"
            )));
        }
        if commit.parent_count() == 0 {
            return Err(AppError::InvalidInput(
                "drop selected changes is not supported for root commits".to_string(),
            ));
        }
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
    })
}
