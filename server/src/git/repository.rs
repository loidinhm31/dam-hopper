/// git2-based repository operations: status, fetch (with progress), branch listing.
///
/// git2::Repository is !Sync — open a new handle per operation.
/// Network operations (fetch) use SSH agent + credential helper callbacks.
/// Push and pull delegate to cli_fallback for credential reliability.
use std::path::Path;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Instant;

use git2::{BranchType, Repository, StatusOptions};

use crate::error::AppError;
use crate::git::cli_fallback;
use crate::git::progress::{emit_completed, emit_failed, emit_progress, emit_started, ProgressSender};
use crate::git::types::{
    BranchInfo, BranchUpdateResult, GitOperation, GitOperationResult, GitStatus, LastCommit,
};
use crate::ssh::SshCredStore;

fn open_repo(path: &Path) -> Result<Repository, AppError> {
    Repository::open(path).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            AppError::GitNotFound(path.to_string_lossy().into_owned())
        } else {
            AppError::Git(e.message().to_string())
        }
    })
}

fn format_commit_time(time: &git2::Time) -> String {
    let secs = time.seconds();
    let offset_mins = time.offset_minutes();

    // Use chrono for reliable ISO formatting
    use chrono::{TimeZone, FixedOffset};
    let offset_secs = offset_mins * 60;
    match FixedOffset::east_opt(offset_secs) {
        Some(tz) => match tz.timestamp_opt(secs, 0) {
            chrono::LocalResult::Single(dt) => dt.to_rfc2822(),
            _ => secs.to_string(),
        },
        None => secs.to_string(),
    }
}

fn get_last_commit(repo: &Repository) -> LastCommit {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return LastCommit::default(),
    };
    let commit = match head.peel_to_commit() {
        Ok(c) => c,
        Err(_) => return LastCommit::default(),
    };

    LastCommit {
        hash: commit.id().to_string(),
        message: commit
            .summary()
            .unwrap_or("")
            .trim()
            .to_string(),
        date: format_commit_time(&commit.time()),
    }
}

fn get_ahead_behind(repo: &Repository) -> (usize, usize) {
    let head = match repo.head() {
        Ok(h) if !h.is_branch() => return (0, 0),
        Ok(h) => h,
        Err(_) => return (0, 0),
    };

    let branch_name = match head.shorthand() {
        Some(n) => n.to_string(),
        None => return (0, 0),
    };

    let local_oid = match head.peel_to_commit() {
        Ok(c) => c.id(),
        Err(_) => return (0, 0),
    };

    let config = match repo.config() {
        Ok(c) => c,
        Err(_) => return (0, 0),
    };

    let remote = config
        .get_string(&format!("branch.{branch_name}.remote"))
        .unwrap_or_default();
    let merge_ref = config
        .get_string(&format!("branch.{branch_name}.merge"))
        .unwrap_or_default();

    if remote.is_empty() || merge_ref.is_empty() {
        return (0, 0);
    }

    let remote_branch = merge_ref.replace("refs/heads/", "");
    let upstream_ref = format!("refs/remotes/{remote}/{remote_branch}");

    let upstream_oid = match repo
        .find_reference(&upstream_ref)
        .and_then(|r| r.peel_to_commit())
    {
        Ok(c) => c.id(),
        Err(_) => return (0, 0),
    };

    repo.graph_ahead_behind(local_oid, upstream_oid)
        .map(|(a, b)| (a, b))
        .unwrap_or((0, 0))
}

fn count_stash(repo: &mut Repository) -> usize {
    let count = Arc::new(AtomicUsize::new(0));
    let count_clone = Arc::clone(&count);
    let _ = repo.stash_foreach(move |_, _, _| {
        count_clone.fetch_add(1, Ordering::Relaxed);
        true
    });
    count.load(Ordering::Relaxed)
}

pub fn get_status(project_path: &Path, project_name: &str) -> Result<GitStatus, AppError> {
    if !project_path.exists() {
        return Ok(GitStatus::not_found(project_name));
    }

    let mut repo = open_repo(project_path)?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_ignored(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    let mut staged = 0usize;
    let mut modified = 0usize;
    let mut untracked = 0usize;

    for entry in statuses.iter() {
        let s = entry.status();
        if s.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            staged += 1;
        }
        if s.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_TYPECHANGE
                | git2::Status::WT_RENAMED,
        ) {
            modified += 1;
        }
        if s.contains(git2::Status::WT_NEW) {
            untracked += 1;
        }
    }
    // Drop Statuses to release the immutable borrow on `repo` before the mutable stash walk
    drop(statuses);

    let branch = match repo.head() {
        Ok(h) => h.shorthand().unwrap_or("HEAD").to_string(),
        Err(_) => "HEAD".to_string(),
    };

    let (ahead, behind) = get_ahead_behind(&repo);
    let last_commit = get_last_commit(&repo);
    let has_stash = count_stash(&mut repo) > 0;
    let is_clean = staged == 0 && modified == 0 && untracked == 0;

    Ok(GitStatus {
        project_name: project_name.to_string(),
        branch,
        is_clean,
        ahead,
        behind,
        staged,
        modified,
        untracked,
        has_stash,
        last_commit,
        path_exists: None,
        status_error: None,
    })
}

/// Build credential callbacks with attempt tracking to prevent infinite loops.
///
/// Credential priority:
/// 1. Explicit key + passphrase from `SshCredStore` (set via /api/ssh/keys/load)
/// 2. SSH agent (if running and has keys)
/// 3. Git credential helper
/// 4. Default (e.g. Kerberos/NTLM)
fn make_fetch_opts<F>(progress_fn: F, ssh_cred: Option<Arc<SshCredStore>>) -> git2::FetchOptions<'static>
where
    F: Fn(usize, usize) + Send + 'static,
{
    let mut callbacks = git2::RemoteCallbacks::new();

    let mut explicit_tried = false;
    let mut agent_tried = false;
    let mut cred_helper_tried = false;

    callbacks.credentials(move |url, username, allowed_types| {
        // Try the user-supplied key+passphrase first.
        if let Some(ref cred) = ssh_cred {
            if allowed_types.contains(git2::CredentialType::SSH_KEY) && !explicit_tried {
                explicit_tried = true;
                let user = username.unwrap_or("git");
                let pub_path = cred.public_key_path();
                let pub_opt = pub_path.as_deref();
                // Treat empty passphrase as None — libssh2 requires None (not "") for unencrypted keys
                let p = cred.passphrase();
                let passphrase_opt = if p.is_empty() { None } else { Some(p) };
                return git2::Cred::ssh_key(user, pub_opt, &cred.key_path, passphrase_opt);
            }
        }

        if allowed_types.contains(git2::CredentialType::SSH_KEY) && !agent_tried {
            agent_tried = true;
            let user = username.unwrap_or("git");
            return git2::Cred::ssh_key_from_agent(user);
        }
        if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
            && !cred_helper_tried
        {
            cred_helper_tried = true;
            if let Ok(cfg) = git2::Config::open_default() {
                return git2::Cred::credential_helper(&cfg, url, username);
            }
        }
        if allowed_types.contains(git2::CredentialType::DEFAULT) {
            return git2::Cred::default();
        }
        Err(git2::Error::from_str("no suitable credentials available"))
    });

    let progress_fn = Arc::new(progress_fn);
    callbacks.transfer_progress(move |stats| {
        if stats.total_objects() > 0 {
            progress_fn(stats.received_objects(), stats.total_objects());
        }
        true
    });

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    fetch_opts.prune(git2::FetchPrune::On);
    fetch_opts
}

pub async fn fetch(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> GitOperationResult {
    let start = Instant::now();
    emit_started(progress, project_name, "fetch", "Fetching...");

    let project_path = project_path.to_path_buf();
    let project_name = project_name.to_string();
    let project_name_ret = project_name.clone();
    let progress_clone = progress.clone();

    let result = tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&project_path)
            .map_err(|e| AppError::Git(e.message().to_string()))?;

        let remote_names = repo
            .remotes()
            .map_err(|e| AppError::Git(e.message().to_string()))?;

        if remote_names.is_empty() {
            return Ok(0usize);
        }

        let mut fetched = 0usize;
        for remote_name in remote_names.iter().flatten() {
            let mut remote = repo
                .find_remote(remote_name)
                .map_err(|e| AppError::Git(e.message().to_string()))?;

            let pn = project_name.clone();
            let pc = progress_clone.clone();
            let cred = ssh_cred.clone();

            let mut fetch_opts = make_fetch_opts(move |received, total| {
                let pct = (received * 100 / total).min(100) as u8;
                emit_progress(&pc, &pn, "fetch", &format!("Receiving objects: {received}/{total}"), Some(pct));
            }, cred);

            remote
                .fetch(&[] as &[&str], Some(&mut fetch_opts), None)
                .map_err(|e| AppError::Git(e.message().to_string()))?;

            fetched += 1;
        }

        Ok::<usize, AppError>(fetched)
    })
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(count)) => {
            emit_completed(progress, &project_name_ret, "fetch", "Fetch complete");
            GitOperationResult {
                project_name: project_name_ret,
                operation: GitOperation::Fetch,
                success: true,
                summary: Some(format!("Fetched {count} remote(s)")),
                error: None,
                duration_ms,
            }
        }
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit_failed(progress, &project_name_ret, "fetch", &msg);
            GitOperationResult {
                project_name: project_name_ret,
                operation: GitOperation::Fetch,
                success: false,
                summary: None,
                error: Some(msg),
                duration_ms,
            }
        }
        Err(e) => {
            let msg = format!("Task panic: {e}");
            emit_failed(progress, &project_name_ret, "fetch", &msg);
            GitOperationResult {
                project_name: project_name_ret,
                operation: GitOperation::Fetch,
                success: false,
                summary: None,
                error: Some(msg),
                duration_ms,
            }
        }
    }
}

pub async fn pull(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> GitOperationResult {
    // Fetch first via git2 (with progress), then attempt fast-forward merge.
    // Fall back to CLI pull --ff-only on merge failure.
    let fetch_result = fetch(project_path, project_name, progress, ssh_cred).await;
    if !fetch_result.success {
        // Fetch failed — reuse its error as pull error
        return GitOperationResult {
            operation: GitOperation::Pull,
            ..fetch_result
        };
    }

    let start = Instant::now();
    emit_started(progress, project_name, "pull", "Merging...");

    let project_path_buf = project_path.to_path_buf();
    let project_name_str = project_name.to_string();

    let merge_result = tokio::task::spawn_blocking(move || {
        try_fast_forward_merge(&project_path_buf, &project_name_str)
    })
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match merge_result {
        Ok(Ok(summary)) => {
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
        Ok(Err(_)) => {
            // Fast-forward not possible — fall back to CLI
            tracing::debug!("ff-merge failed for {project_name}, falling back to CLI pull");
            cli_fallback::pull_ff_only(project_path, project_name, progress).await
        }
        Err(e) => {
            let msg = format!("Task panic: {e}");
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

fn try_fast_forward_merge(project_path: &Path, _project_name: &str) -> Result<String, AppError> {
    let repo = open_repo(project_path)?;

    let head = repo
        .head()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| AppError::Git("Detached HEAD".to_string()))?
        .to_string();

    let config = repo
        .config()
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let remote = config
        .get_string(&format!("branch.{branch_name}.remote"))
        .unwrap_or_else(|_| "origin".to_string());
    let merge_ref = config
        .get_string(&format!("branch.{branch_name}.merge"))
        .unwrap_or_else(|_| format!("refs/heads/{branch_name}"));
    let remote_branch = merge_ref.replace("refs/heads/", "");

    let upstream_ref = format!("refs/remotes/{remote}/{remote_branch}");
    let upstream_commit = repo
        .find_reference(&upstream_ref)
        .and_then(|r| r.peel_to_commit())
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    let local_commit = head
        .peel_to_commit()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    let upstream_oid = upstream_commit.id();

    if local_commit.id() == upstream_oid {
        return Ok("Already up to date".to_string());
    }

    let annotated = repo
        .find_annotated_commit(upstream_oid)
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let (analysis, _) = repo
        .merge_analysis(&[&annotated])
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    if !analysis.is_fast_forward() {
        return Err(AppError::Git("non-fast-forward".to_string()));
    }
    let mut branch_ref = repo
        .find_reference(&format!("refs/heads/{branch_name}"))
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    branch_ref
        .set_target(upstream_oid, "fast-forward")
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    repo.set_head(&format!("refs/heads/{branch_name}"))
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    Ok("Fast-forward merge complete".to_string())
}

pub fn list_branches(project_path: &Path) -> Result<Vec<BranchInfo>, AppError> {
    let repo = open_repo(project_path)?;

    let mut branches = Vec::new();

    let current_head = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    // Local branches
    for branch_result in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| AppError::Git(e.message().to_string()))?
    {
        let (branch, _) = branch_result.map_err(|e| AppError::Git(e.message().to_string()))?;
        let name = branch
            .name()
            .map_err(|e| AppError::Git(e.message().to_string()))?
            .unwrap_or("")
            .to_string();

        let is_current = current_head.as_deref() == Some(&name);

        let last_commit = branch
            .get()
            .peel_to_commit()
            .map(|c| c.id().to_string())
            .unwrap_or_default();

        let (tracking_branch, ahead, behind) = resolve_tracking(&repo, &name);

        branches.push(BranchInfo {
            name,
            is_remote: false,
            is_current,
            tracking_branch,
            ahead,
            behind,
            last_commit,
        });
    }

    // Remote branches
    for branch_result in repo
        .branches(Some(BranchType::Remote))
        .map_err(|e| AppError::Git(e.message().to_string()))?
    {
        let (branch, _) = branch_result.map_err(|e| AppError::Git(e.message().to_string()))?;
        let name = branch
            .name()
            .map_err(|e| AppError::Git(e.message().to_string()))?
            .unwrap_or("")
            .to_string();

        if name.ends_with("/HEAD") {
            continue;
        }

        let last_commit = branch
            .get()
            .peel_to_commit()
            .map(|c| c.id().to_string())
            .unwrap_or_default();

        branches.push(BranchInfo {
            name,
            is_remote: true,
            is_current: false,
            tracking_branch: None,
            ahead: 0,
            behind: 0,
            last_commit,
        });
    }

    Ok(branches)
}

fn resolve_tracking(repo: &Repository, branch_name: &str) -> (Option<String>, usize, usize) {
    let config = match repo.config() {
        Ok(c) => c,
        Err(_) => return (None, 0, 0),
    };

    let remote = config
        .get_string(&format!("branch.{branch_name}.remote"))
        .unwrap_or_default();
    let merge_ref = config
        .get_string(&format!("branch.{branch_name}.merge"))
        .unwrap_or_default();

    if remote.is_empty() || merge_ref.is_empty() {
        return (None, 0, 0);
    }

    let remote_branch = merge_ref.replace("refs/heads/", "");
    let tracking = format!("{remote}/{remote_branch}");
    let upstream_ref = format!("refs/remotes/{tracking}");

    let local_oid = match repo
        .find_branch(branch_name, BranchType::Local)
        .and_then(|b| b.get().peel_to_commit())
    {
        Ok(c) => c.id(),
        Err(_) => return (Some(tracking), 0, 0),
    };

    let upstream_oid = match repo
        .find_reference(&upstream_ref)
        .and_then(|r| r.peel_to_commit())
    {
        Ok(c) => c.id(),
        Err(_) => return (Some(tracking), 0, 0),
    };

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0));

    (Some(tracking), ahead, behind)
}

/// Update a non-checked-out branch to its remote tracking ref.
pub fn update_branch(
    project_path: &Path,
    branch: &str,
    remote: &str,
) -> Result<BranchUpdateResult, AppError> {
    let repo = open_repo(project_path)?;

    // Cannot update the currently checked-out branch via fetch refspec
    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    if current.as_deref() == Some(branch) {
        return Ok(BranchUpdateResult {
            branch: branch.to_string(),
            success: false,
            reason: Some("checked-out — use pull instead".to_string()),
        });
    }

    // Attempt: git fetch <remote> <branch>:<branch>
    let mut git_remote = match repo.find_remote(remote) {
        Ok(r) => r,
        Err(e) => {
            return Ok(BranchUpdateResult {
                branch: branch.to_string(),
                success: false,
                reason: Some(e.message().to_string()),
            });
        }
    };

    let refspec = format!("+refs/heads/{branch}:refs/heads/{branch}");
    let mut opts = git2::FetchOptions::new();

    match git_remote.fetch(&[&refspec], Some(&mut opts), None) {
        Ok(_) => Ok(BranchUpdateResult {
            branch: branch.to_string(),
            success: true,
            reason: None,
        }),
        Err(e) => {
            let msg = e.message().to_lowercase();
            let reason = if msg.contains("non-fast-forward") || msg.contains("would clobber") {
                "non-fast-forward"
            } else if msg.contains("couldn't find remote ref") || msg.contains("not found") {
                "not-tracking"
            } else {
                e.message()
            };
            Ok(BranchUpdateResult {
                branch: branch.to_string(),
                success: false,
                reason: Some(reason.to_string()),
            })
        }
    }
}
