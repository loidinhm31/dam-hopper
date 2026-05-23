/// git2-based repository operations: status, fetch/pull/push, and branch actions.
///
/// git2::Repository is !Sync — open a new handle per operation.
/// Network operations use a shared libgit2 credential callback stack.
/// Pull still falls back to CLI when fast-forward merge application fails.
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use git2::{BranchType, PackBuilderStage, PushOptions, Repository, StatusOptions};

use crate::error::AppError;
use crate::git::cli_fallback;
use crate::git::progress::{
    emit_completed, emit_failed, emit_progress, emit_started, ProgressSender,
};
use crate::git::types::{
    BranchInfo, BranchUpdateResult, CheckoutStrategy, GitActionResult, GitBlockReason,
    GitOperation, GitOperationResult, GitStatus, LastCommit, ResetMode,
};
use crate::ssh::SshCredStore;

pub(crate) fn open_repo(path: &Path) -> Result<Repository, AppError> {
    Repository::open(path).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            AppError::GitNotFound(path.to_string_lossy().into_owned())
        } else {
            AppError::Git(e.message().to_string())
        }
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CredentialAttempt {
    Explicit,
    Agent,
    Helper,
    Default,
}

#[derive(Default)]
struct CredentialAttemptTracker {
    explicit_tried: bool,
    agent_tried: bool,
    helper_tried: bool,
}

impl CredentialAttemptTracker {
    fn next(
        &mut self,
        allowed_types: git2::CredentialType,
        has_explicit_cred: bool,
    ) -> Option<CredentialAttempt> {
        if has_explicit_cred
            && allowed_types.contains(git2::CredentialType::SSH_KEY)
            && !self.explicit_tried
        {
            self.explicit_tried = true;
            return Some(CredentialAttempt::Explicit);
        }

        if allowed_types.contains(git2::CredentialType::SSH_KEY) && !self.agent_tried {
            self.agent_tried = true;
            return Some(CredentialAttempt::Agent);
        }

        if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT) && !self.helper_tried {
            self.helper_tried = true;
            return Some(CredentialAttempt::Helper);
        }

        if allowed_types.contains(git2::CredentialType::DEFAULT) {
            return Some(CredentialAttempt::Default);
        }

        None
    }
}

fn attach_credential_callbacks(
    callbacks: &mut git2::RemoteCallbacks<'static>,
    ssh_cred: Option<Arc<SshCredStore>>,
) {
    let mut attempts = CredentialAttemptTracker::default();

    callbacks.credentials(move |url, username, allowed_types| {
        match attempts.next(allowed_types, ssh_cred.is_some()) {
            Some(CredentialAttempt::Explicit) => {
                let cred = ssh_cred
                    .as_ref()
                    .expect("explicit credential attempt requires loaded SSH credential");
                let user = username.unwrap_or("git");
                let pub_path = cred.public_key_path();
                let pub_opt = pub_path.as_deref();
                let passphrase = cred.passphrase();
                let passphrase_opt = if passphrase.is_empty() {
                    None
                } else {
                    Some(passphrase)
                };
                git2::Cred::ssh_key(user, pub_opt, &cred.key_path, passphrase_opt)
            }
            Some(CredentialAttempt::Agent) => {
                let user = username.unwrap_or("git");
                git2::Cred::ssh_key_from_agent(user)
            }
            Some(CredentialAttempt::Helper) => {
                if let Ok(cfg) = git2::Config::open_default() {
                    git2::Cred::credential_helper(&cfg, url, username)
                } else if allowed_types.contains(git2::CredentialType::DEFAULT) {
                    git2::Cred::default()
                } else {
                    Err(git2::Error::from_str("credential helper unavailable"))
                }
            }
            Some(CredentialAttempt::Default) => git2::Cred::default(),
            None => Err(git2::Error::from_str("no suitable credentials available")),
        }
    });
}

fn format_commit_time(time: &git2::Time) -> String {
    let secs = time.seconds();
    let offset_mins = time.offset_minutes();

    // Use chrono for reliable ISO formatting
    use chrono::{FixedOffset, TimeZone};
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
        message: commit.summary().unwrap_or("").trim().to_string(),
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

fn upstream_oid(repo: &Repository) -> Option<git2::Oid> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }

    let branch_name = head.shorthand()?.to_string();
    let config = repo.config().ok()?;
    let remote = config
        .get_string(&format!("branch.{branch_name}.remote"))
        .ok()?;
    let merge_ref = config
        .get_string(&format!("branch.{branch_name}.merge"))
        .ok()?;
    if remote.is_empty() || merge_ref.is_empty() {
        return None;
    }

    let remote_branch = merge_ref.replace("refs/heads/", "");
    let upstream_ref = format!("refs/remotes/{remote}/{remote_branch}");
    repo.find_reference(&upstream_ref)
        .and_then(|r| r.peel_to_commit())
        .map(|c| c.id())
        .ok()
}

fn count_stash(repo: &mut Repository) -> usize {
    let mut count = 0usize;
    let _ = repo.stash_foreach(|_, _, _| {
        count += 1;
        true
    });
    count
}

fn validate_revision(repo: &Repository, spec: &str, label: &str) -> Result<(), AppError> {
    repo.revparse_single(spec)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput(format!("invalid {label}: {spec}")))
}

fn validate_commit_hash(repo: &Repository, hash: &str) -> Result<(), AppError> {
    let oid = git2::Oid::from_str(hash)
        .map_err(|_| AppError::InvalidInput(format!("invalid commit hash: {hash}")))?;
    repo.find_commit(oid)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput(format!("unknown commit hash: {hash}")))
}

fn branch_exists(repo: &Repository, branch: &str, kind: BranchType) -> bool {
    repo.find_branch(branch, kind).is_ok()
}

fn derive_local_branch_name(remote_branch: &str) -> Option<String> {
    let (_, name) = remote_branch.split_once('/')?;
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

fn is_dirty_checkout_error(stderr: &str) -> bool {
    let msg = stderr.to_lowercase();
    msg.contains("your local changes")
        || msg.contains("would be overwritten by checkout")
        || msg.contains("please commit your changes or stash them")
}

fn is_conflict_error(stderr: &str) -> bool {
    let msg = stderr.to_lowercase();
    msg.contains("conflict") || msg.contains("after resolving the conflicts")
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

fn make_fetch_opts<F>(
    progress_fn: F,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> git2::FetchOptions<'static>
where
    F: Fn(usize, usize) + Send + 'static,
{
    let mut callbacks = git2::RemoteCallbacks::new();
    attach_credential_callbacks(&mut callbacks, ssh_cred);

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

pub(crate) struct PushTarget {
    branch_name: String,
    remote_name: String,
    merge_ref: String,
    summary: String,
}

pub(crate) fn resolve_push_target(repo: &Repository) -> Result<PushTarget, AppError> {
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

    let remote_name = config
        .get_string(&format!("branch.{branch_name}.remote"))
        .map_err(|_| {
            AppError::Git(format!(
                "Current branch '{branch_name}' has no configured push destination (missing branch.{branch_name}.remote)"
            ))
        })?;

    if remote_name.trim().is_empty() {
        return Err(AppError::Git(format!(
            "Current branch '{branch_name}' has no configured push destination (branch.{branch_name}.remote is empty)"
        )));
    }

    let merge_ref = config
        .get_string(&format!("branch.{branch_name}.merge"))
        .map_err(|_| {
            AppError::Git(format!(
                "Current branch '{branch_name}' has no configured upstream branch (missing branch.{branch_name}.merge)"
            ))
        })?;

    if merge_ref.trim().is_empty() {
        return Err(AppError::Git(format!(
            "Current branch '{branch_name}' has no configured upstream branch (branch.{branch_name}.merge is empty)"
        )));
    }

    let remote_branch = merge_ref.strip_prefix("refs/heads/").unwrap_or(&merge_ref);

    Ok(PushTarget {
        branch_name: branch_name.clone(),
        remote_name: remote_name.clone(),
        merge_ref: merge_ref.clone(),
        summary: format!("Pushed {branch_name} to {remote_name}/{remote_branch}"),
    })
}

fn make_push_opts(
    project_name: String,
    progress: Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
    remote_rejection: Arc<Mutex<Option<String>>>,
) -> PushOptions<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();
    attach_credential_callbacks(&mut callbacks, ssh_cred);

    let push_progress_project = project_name.clone();
    let push_progress_sender = progress.clone();
    callbacks.push_transfer_progress(move |current, total, bytes| {
        if total > 0 {
            let pct = (current * 100 / total).min(100) as u8;
            emit_progress(
                &push_progress_sender,
                &push_progress_project,
                "push",
                &format!("Uploading objects: {current}/{total} ({bytes} bytes)"),
                Some(pct),
            );
        }
    });

    let pack_progress_project = project_name.clone();
    let pack_progress_sender = progress.clone();
    callbacks.pack_progress(move |stage, current, total| {
        if total > 0 {
            let pct = (current * 100 / total).min(100) as u8;
            emit_progress(
                &pack_progress_sender,
                &pack_progress_project,
                "push",
                &format!(
                    "Packing objects ({}) {current}/{total}",
                    format_pack_stage(stage)
                ),
                Some(pct),
            );
        }
    });

    callbacks.push_update_reference(move |refname, status| {
        handle_push_update_reference(&remote_rejection, refname, status)
    });

    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(callbacks);
    push_opts
}

fn format_pack_stage(stage: PackBuilderStage) -> &'static str {
    match stage {
        PackBuilderStage::AddingObjects => "adding",
        PackBuilderStage::Deltafication => "deltafication",
    }
}

fn handle_push_update_reference(
    remote_rejection: &Arc<Mutex<Option<String>>>,
    refname: &str,
    status: Option<&str>,
) -> Result<(), git2::Error> {
    if let Some(status) = status {
        let message = format!("Remote rejected {refname}: {status}");
        *remote_rejection
            .lock()
            .expect("push rejection mutex poisoned") = Some(message.clone());
        return Err(git2::Error::from_str(&message));
    }

    Ok(())
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
        let repo =
            Repository::open(&project_path).map_err(|e| AppError::Git(e.message().to_string()))?;

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

            let mut fetch_opts = make_fetch_opts(
                move |received, total| {
                    let pct = (received * 100 / total).min(100) as u8;
                    emit_progress(
                        &pc,
                        &pn,
                        "fetch",
                        &format!("Receiving objects: {received}/{total}"),
                        Some(pct),
                    );
                },
                cred,
            );

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

async fn push_with_mode(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
    force: bool,
) -> GitOperationResult {
    let start = Instant::now();
    emit_started(progress, project_name, "push", "Pushing...");

    let project_path = project_path.to_path_buf();
    let project_name = project_name.to_string();
    let project_name_ret = project_name.clone();
    let progress_clone = progress.clone();

    let result = tokio::task::spawn_blocking(move || {
        let repo = open_repo(&project_path)?;
        let target = resolve_push_target(&repo)?;
        let refspec = if force {
            format!("+refs/heads/{}:{}", target.branch_name, target.merge_ref)
        } else {
            format!("refs/heads/{}:{}", target.branch_name, target.merge_ref)
        };

        let mut remote = repo
            .find_remote(&target.remote_name)
            .map_err(|e| AppError::Git(e.message().to_string()))?;

        let remote_rejection = Arc::new(Mutex::new(None::<String>));
        let mut push_opts = make_push_opts(
            project_name.clone(),
            progress_clone,
            ssh_cred,
            Arc::clone(&remote_rejection),
        );

        remote.push(&[refspec], Some(&mut push_opts)).map_err(|e| {
            remote_rejection
                .lock()
                .expect("push rejection mutex poisoned")
                .clone()
                .map(AppError::Git)
                .unwrap_or_else(|| AppError::Git(e.message().to_string()))
        })?;

        Ok::<String, AppError>(target.summary)
    })
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(summary)) => {
            emit_completed(progress, &project_name_ret, "push", &summary);
            GitOperationResult {
                project_name: project_name_ret,
                operation: GitOperation::Push,
                success: true,
                summary: Some(summary),
                error: None,
                duration_ms,
            }
        }
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit_failed(progress, &project_name_ret, "push", &msg);
            GitOperationResult {
                project_name: project_name_ret,
                operation: GitOperation::Push,
                success: false,
                summary: None,
                error: Some(msg),
                duration_ms,
            }
        }
        Err(e) => {
            let msg = format!("Task panic: {e}");
            emit_failed(progress, &project_name_ret, "push", &msg);
            GitOperationResult {
                project_name: project_name_ret,
                operation: GitOperation::Push,
                success: false,
                summary: None,
                error: Some(msg),
                duration_ms,
            }
        }
    }
}

pub async fn push(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> GitOperationResult {
    push_with_mode(project_path, project_name, progress, ssh_cred, false).await
}

pub(crate) async fn force_push(
    project_path: &Path,
    project_name: &str,
    progress: &Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> GitOperationResult {
    push_with_mode(project_path, project_name, progress, ssh_cred, true).await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_attempt_tracker_tries_loaded_key_before_agent_and_helper() {
        let mut tracker = CredentialAttemptTracker::default();
        let allowed = git2::CredentialType::SSH_KEY
            | git2::CredentialType::USER_PASS_PLAINTEXT
            | git2::CredentialType::DEFAULT;

        assert_eq!(
            tracker.next(allowed, true),
            Some(CredentialAttempt::Explicit)
        );
        assert_eq!(tracker.next(allowed, true), Some(CredentialAttempt::Agent));
        assert_eq!(tracker.next(allowed, true), Some(CredentialAttempt::Helper));
    }

    #[test]
    fn push_update_reference_reports_remote_rejection_message() {
        let remote_rejection = Arc::new(Mutex::new(None));

        let error = handle_push_update_reference(
            &remote_rejection,
            "refs/heads/main",
            Some("hook declined"),
        )
        .expect_err("remote rejection should become an error");

        assert_eq!(
            remote_rejection
                .lock()
                .expect("push rejection mutex poisoned")
                .as_deref(),
            Some("Remote rejected refs/heads/main: hook declined")
        );
        assert_eq!(
            error.message(),
            "Remote rejected refs/heads/main: hook declined"
        );
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
    cli_fallback::validate_branch_name(branch)?;
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

pub async fn create_branch(
    project_path: &Path,
    name: &str,
    start_point: Option<&str>,
    checkout: bool,
) -> Result<GitActionResult, AppError> {
    cli_fallback::validate_branch_name(name)?;

    {
        let repo = open_repo(project_path)?;
        if branch_exists(&repo, name, BranchType::Local) {
            return Err(AppError::InvalidInput(format!(
                "branch already exists: {name}"
            )));
        }
        if let Some(spec) = start_point {
            validate_revision(&repo, spec, "start point")?;
        }
    }

    let mut args = vec!["branch".to_string(), name.to_string()];
    if let Some(spec) = start_point {
        args.push(spec.to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli_fallback::run_git(&arg_refs, project_path).await?;

    if checkout {
        let mut result =
            checkout_branch(project_path, name, None, false, CheckoutStrategy::Normal).await?;
        result.branch = Some(name.to_string());
        if result.message.is_none() {
            result.message = Some(format!("Created and checked out {name}"));
        }
        return Ok(result);
    }

    let mut result = GitActionResult::ok(format!("Created branch {name}"));
    result.branch = Some(name.to_string());
    Ok(result)
}

pub async fn checkout_branch(
    project_path: &Path,
    branch: &str,
    start_point: Option<&str>,
    create: bool,
    strategy: CheckoutStrategy,
) -> Result<GitActionResult, AppError> {
    let repo = open_repo(project_path)?;
    cli_fallback::validate_branch_name(branch)?;
    if start_point.is_some() && !create {
        return Err(AppError::InvalidInput(
            "startPoint requires create=true".to_string(),
        ));
    }
    let status = get_status(project_path, branch)?;
    let has_dirty_worktree = !status.is_clean;

    let target_branch = if create {
        cli_fallback::validate_branch_name(branch)?;
        if branch_exists(&repo, branch, BranchType::Local) {
            return Err(AppError::InvalidInput(format!(
                "branch already exists: {branch}"
            )));
        }
        if let Some(spec) = start_point {
            validate_revision(&repo, spec, "start point")?;
        }
        branch.to_string()
    } else if branch_exists(&repo, branch, BranchType::Local) {
        branch.to_string()
    } else if branch_exists(&repo, branch, BranchType::Remote) {
        let local_branch = derive_local_branch_name(branch)
            .ok_or_else(|| AppError::InvalidInput(format!("invalid remote branch: {branch}")))?;
        cli_fallback::validate_branch_name(&local_branch)?;
        local_branch
    } else {
        return Err(AppError::InvalidInput(format!(
            "branch not found: {branch}"
        )));
    };

    if has_dirty_worktree && strategy == CheckoutStrategy::Normal {
        return Ok(GitActionResult {
            ok: false,
            message: Some("Working tree has local changes".to_string()),
            branch: Some(target_branch),
            hash: None,
            stashed: Some(false),
            conflict: Some(false),
            dirty: Some(true),
            destructive: Some(false),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        });
    }

    let mut stashed = false;
    if has_dirty_worktree && strategy == CheckoutStrategy::Stash {
        let stash_before = cli_fallback::run_git(&["stash", "list"], project_path)
            .await?
            .lines()
            .count();
        cli_fallback::run_git(
            &[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                "dam-hopper checkout",
            ],
            project_path,
        )
        .await?;
        let stash_after = cli_fallback::run_git(&["stash", "list"], project_path)
            .await?
            .lines()
            .count();
        stashed = stash_after > stash_before;
    }

    let mut args = vec!["checkout".to_string()];
    if strategy == CheckoutStrategy::Force {
        args.push("-f".to_string());
    }
    if create {
        args.push("-b".to_string());
        args.push(target_branch.clone());
        if let Some(spec) = start_point {
            args.push(spec.to_string());
        }
    } else if target_branch != branch {
        args.push("-b".to_string());
        args.push(target_branch.clone());
        args.push("--track".to_string());
        args.push(branch.to_string());
    } else {
        args.push(target_branch.clone());
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match cli_fallback::run_git(&arg_refs, project_path).await {
        Ok(_) => Ok(GitActionResult {
            ok: true,
            message: Some(format!("Checked out {target_branch}")),
            branch: Some(target_branch),
            hash: None,
            stashed: Some(stashed),
            conflict: Some(false),
            dirty: Some(false),
            destructive: Some(strategy == CheckoutStrategy::Force),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        }),
        Err(AppError::Git(stderr)) if is_dirty_checkout_error(&stderr) => Ok(GitActionResult {
            ok: false,
            message: Some(stderr),
            branch: Some(target_branch),
            hash: None,
            stashed: Some(stashed),
            conflict: Some(false),
            dirty: Some(true),
            destructive: Some(strategy == CheckoutStrategy::Force),
            recovery: None,
            blocked_reason: None,
            recommendation: None,
        }),
        Err(err) => Err(err),
    }
}

pub async fn cherry_pick(project_path: &Path, hash: &str) -> Result<GitActionResult, AppError> {
    {
        let repo = open_repo(project_path)?;
        validate_commit_hash(&repo, hash)?;
    }

    match cli_fallback::run_git(&["cherry-pick", hash], project_path).await {
        Ok(_) => Ok(GitActionResult {
            ok: true,
            message: Some(format!("Cherry-picked {hash}")),
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
        Err(AppError::Git(stderr)) if is_conflict_error(&stderr) => Ok(GitActionResult {
            ok: false,
            message: Some(stderr),
            branch: None,
            hash: Some(hash.to_string()),
            stashed: None,
            conflict: Some(true),
            dirty: Some(true),
            destructive: Some(false),
            recovery: crate::git::cli_fallback::active_git_operation(project_path)
                .await
                .ok()
                .flatten(),
            blocked_reason: None,
            recommendation: Some(
                "Resolve conflicts, then continue or abort the cherry-pick".to_string(),
            ),
        }),
        Err(err) => Err(err),
    }
}

pub async fn reset_to_commit(
    project_path: &Path,
    hash: &str,
    mode: ResetMode,
) -> Result<GitActionResult, AppError> {
    {
        let repo = open_repo(project_path)?;
        validate_commit_hash(&repo, hash)?;
    }

    let mode_flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
        ResetMode::Keep => "--keep",
    };
    cli_fallback::run_git(&["reset", mode_flag, hash], project_path).await?;

    Ok(GitActionResult {
        ok: true,
        message: Some(format!("Reset {mode_flag} to {hash}")),
        branch: None,
        hash: Some(hash.to_string()),
        stashed: None,
        conflict: Some(false),
        dirty: Some(false),
        destructive: Some(mode == ResetMode::Hard),
        recovery: None,
        blocked_reason: None,
        recommendation: None,
    })
}

pub async fn undo_last_commit(project_path: &Path) -> Result<GitActionResult, AppError> {
    let (head_hash, parent_count) = {
        let repo = open_repo(project_path)?;
        let head = repo
            .head()
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let commit = head
            .peel_to_commit()
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        (commit.id().to_string(), commit.parent_count())
    };
    let head_is_pushed = cli_fallback::is_commit_pushed(project_path, &head_hash).await?;

    if parent_count == 0 {
        let mut blocked = GitActionResult::blocked(
            GitBlockReason::RootCommit,
            "undo last commit is not supported for the root commit",
            "create a new commit or use reset from the command line if you need to rewrite the root commit",
        );
        blocked.hash = Some(head_hash);
        return Ok(blocked);
    }

    if let Some(recovery) = cli_fallback::active_git_operation(project_path).await? {
        let mut blocked = GitActionResult::blocked(
            GitBlockReason::ActiveOperation,
            "another Git operation is already in progress",
            "finish or abort the in-progress operation before undoing the last commit",
        );
        blocked.hash = Some(head_hash);
        blocked.recovery = Some(recovery);
        return Ok(blocked);
    }

    if head_is_pushed {
        let mut blocked = GitActionResult::blocked(
            GitBlockReason::PushedCommit,
            "undo last commit is only available for commits not pushed upstream",
            "use revert for pushed/shared history",
        );
        blocked.hash = Some(head_hash);
        return Ok(blocked);
    }

    cli_fallback::run_git(&["reset", "--mixed", "HEAD~1"], project_path).await?;

    Ok(GitActionResult {
        ok: true,
        message: Some(format!("Undid last commit {}", &head_hash[..7])),
        branch: None,
        hash: Some(head_hash),
        stashed: None,
        conflict: Some(false),
        dirty: Some(true),
        destructive: Some(true),
        recovery: None,
        blocked_reason: None,
        recommendation: Some("changes from the undone commit are now unstaged".to_string()),
    })
}

pub fn get_log(
    project_path: &Path,
    limit: usize,
    offset: usize,
    git_ref: Option<&str>,
) -> Result<Vec<crate::git::types::GitLogEntry>, AppError> {
    use std::process::Command;

    let repo = open_repo(project_path)?;
    if let Some(git_ref) = git_ref {
        validate_revision(&repo, git_ref, "git ref")?;
    }
    let upstream = upstream_oid(&repo);

    let mut command = Command::new("git");
    command
        .current_dir(project_path)
        .arg("log")
        .arg("--date-order")
        .arg(format!("--skip={}", offset))
        .arg(format!("-n {}", limit))
        .arg("--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s%x00%D");

    if let Some(git_ref) = git_ref {
        command.arg(git_ref);
    }

    let output = command
        .output()
        .map_err(|e| AppError::Git(format!("Failed to execute git log: {}", e)))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git log error: {}", err)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('\0').collect();
        if parts.len() < 7 {
            continue; // Malformed line
        }

        let hash = parts[0].to_string();
        let parents = parts[1].split_whitespace().map(|s| s.to_string()).collect();
        let author_name = parts[2].to_string();
        let author_email = parts[3].to_string();
        let timestamp = parts[4].parse::<i64>().unwrap_or(0);
        let message = parts[5].to_string();

        // Parse refs like "HEAD -> main, origin/main, tag: v1.0"
        let refs: Vec<String> = parts[6]
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let is_pushed = upstream
            .and_then(|upstream_oid| {
                git2::Oid::from_str(&hash)
                    .ok()
                    .map(|oid| (upstream_oid, oid))
            })
            .and_then(|(upstream_oid, oid)| repo.graph_descendant_of(upstream_oid, oid).ok())
            .unwrap_or(false);

        entries.push(crate::git::types::GitLogEntry {
            hash,
            parents,
            author_name,
            author_email,
            timestamp,
            message,
            refs,
            is_pushed,
        });
    }

    Ok(entries)
}
