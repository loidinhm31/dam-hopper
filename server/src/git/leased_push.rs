use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use git2::Repository;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::git::progress::{
    emit_completed, emit_failed, emit_progress, emit_started, ProgressSender,
};
use crate::git::repository::{
    attach_credential_callbacks, format_pack_stage, handle_push_update_reference, open_repo,
};
use crate::ssh::SshCredStore;
use crate::git::types::{
    PublishBlockReason, PublishPreview, PublishResult, PublishResultStatus, PublishSnapshot,
};

pub fn compute_repository_identity(repo: &Repository, root_path: &Path) -> String {
    let gitdir = std::fs::canonicalize(repo.path()).unwrap_or_else(|_| repo.path().to_path_buf());
    let commondir_file = gitdir.join("commondir");
    let commondir = if commondir_file.is_file() {
        if let Ok(content) = std::fs::read_to_string(&commondir_file) {
            let trimmed = content.trim();
            let target = gitdir.join(trimmed);
            std::fs::canonicalize(&target).unwrap_or(target)
        } else {
            gitdir.clone()
        }
    } else {
        gitdir.clone()
    };
    let root = std::fs::canonicalize(root_path).unwrap_or_else(|_| root_path.to_path_buf());

    let g_str = gitdir.to_string_lossy();
    let c_str = commondir.to_string_lossy();
    let r_str = root.to_string_lossy();

    let mut hasher = Sha256::new();
    hasher.update(
        format!(
            "{}:{}:{}:{}:{}:{}",
            g_str.len(),
            g_str,
            c_str.len(),
            c_str,
            r_str.len(),
            r_str
        )
        .as_bytes(),
    );
    format!("{:x}", hasher.finalize())
}

/// Computes SHA-256 hex digest of effective push URL bytes.
pub fn compute_remote_identity(effective_push_url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(effective_push_url.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Checks whether a libgit2 error represents an SSH or transport authentication error.
pub fn is_auth_error(err: &git2::Error) -> bool {
    if err.class() == git2::ErrorClass::Ssh || err.code() == git2::ErrorCode::Auth {
        return true;
    }
    let msg = err.message().to_lowercase();
    msg.contains("authentication failed")
        || msg.contains("permission denied")
        || msg.contains("publickey")
        || msg.contains("no suitable credentials")
        || msg.contains("agent admitted failure to sign")
        || msg.contains("sign_and_send_pubkey")
        || msg.contains("could not open a connection to your authentication agent")
        || msg.contains("credential helper unavailable")
}

fn make_result(
    status: PublishResultStatus,
    snapshot: &PublishSnapshot,
    actual_remote_oid: Option<String>,
    message: impl Into<String>,
) -> PublishResult {
    PublishResult {
        status,
        branch: snapshot.branch.clone(),
        remote_name: snapshot.remote_name.clone(),
        destination_ref: snapshot.destination_ref.clone(),
        source_oid: snapshot.source_oid.clone(),
        expected_remote_oid: snapshot.expected_remote_oid.clone(),
        actual_remote_oid,
        message: message.into(),
    }
}

/// Prepares a leased push preview for the current attached branch and configured upstream.
/// Does not mutate remote or local repository state.
pub async fn prepare_leased_push(
    project_path: &Path,
    root_path: &Path,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> Result<PublishPreview, AppError> {
    let _project_path = project_path.to_path_buf();
    let root_path = root_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&root_path)?;

        if repo.head_detached().unwrap_or(true) {
            return Ok(PublishPreview::blocked(
                PublishBlockReason::DetachedHead,
                "HEAD is detached; leased publication requires a checked-out local branch under refs/heads/",
            ));
        }

        let head = match repo.head() {
            Ok(h) => h,
            Err(e) => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::DetachedHead,
                    format!("Cannot inspect HEAD reference: {}", e.message()),
                ));
            }
        };

        let branch_ref = match head.name() {
            Some(name) if name.starts_with("refs/heads/") => name.to_string(),
            _ => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::DetachedHead,
                    "HEAD does not point to a local branch under refs/heads/",
                ));
            }
        };
        let branch_name = match head.shorthand() {
            Some(s) => s.to_string(),
            None => branch_ref.strip_prefix("refs/heads/").unwrap().to_string(),
        };

        let source_oid = match head.target() {
            Some(oid) => oid.to_string(),
            None => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::DetachedHead,
                    format!("Branch reference {branch_ref} has no target commit OID"),
                ));
            }
        };

        let config = match repo.config() {
            Ok(c) => c,
            Err(e) => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::MissingUpstream,
                    format!("Failed to read repository config: {}", e.message()),
                ));
            }
        };

        let remote_name = match config.get_string(&format!("branch.{branch_name}.remote")) {
            Ok(r) if !r.trim().is_empty() => r.trim().to_string(),
            _ => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::MissingUpstream,
                    format!("Current branch '{branch_name}' has no configured push destination (missing branch.{branch_name}.remote)"),
                ));
            }
        };

        let merge_ref = match config.get_string(&format!("branch.{branch_name}.merge")) {
            Ok(m) if !m.trim().is_empty() => m.trim().to_string(),
            _ => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::MissingUpstream,
                    format!("Current branch '{branch_name}' has no configured upstream branch (missing branch.{branch_name}.merge)"),
                ));
            }
        };

        if !merge_ref.starts_with("refs/heads/") {
            return Ok(PublishPreview::blocked(
                PublishBlockReason::AmbiguousDestination,
                format!("Configured upstream branch '{merge_ref}' must be a full ref under refs/heads/"),
            ));
        }

        if let Ok(mirror) = config.get_bool(&format!("remote.{remote_name}.mirror")) {
            if mirror {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::AmbiguousDestination,
                    format!("Remote '{remote_name}' has mirror mode enabled; leased publication refuses mirror push"),
                ));
            }
        }

        let mut push_refspecs = Vec::new();
        if let Ok(entries) =
            config.entries(Some(&format!(r"^remote\.{}\.push$", regex::escape(&remote_name))))
        {
            let _ = entries.for_each(|entry| {
                if let Some(val) = entry.value() {
                    push_refspecs.push(val.to_string());
                }
            });
        }
        for spec in &push_refspecs {
            if spec.contains('*') {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::AmbiguousDestination,
                    format!("Remote '{remote_name}' has wildcard push refspec '{spec}'"),
                ));
            }
        }
        if push_refspecs.len() > 1 {
            return Ok(PublishPreview::blocked(
                PublishBlockReason::AmbiguousDestination,
                format!("Remote '{remote_name}' has multiple push refspecs configured"),
            ));
        }

        let mut push_urls = Vec::new();
        if let Ok(entries) = config.entries(Some(&format!(
            r"^remote\.{}\.pushurl$",
            regex::escape(&remote_name)
        ))) {
            let _ = entries.for_each(|entry| {
                if let Some(val) = entry.value() {
                    push_urls.push(val.to_string());
                }
            });
        }
        if push_urls.len() > 1 {
            return Ok(PublishPreview::blocked(
                PublishBlockReason::AmbiguousDestination,
                format!("Remote '{remote_name}' has multiple push URLs configured"),
            ));
        }

        let mut remote = match repo.find_remote(&remote_name) {
            Ok(r) => r,
            Err(e) => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::RemoteUnavailable,
                    format!("Remote '{remote_name}' not found: {}", e.message()),
                ));
            }
        };

        let effective_url = match remote.pushurl().or_else(|| remote.url()) {
            Some(u) if !u.trim().is_empty() => u.trim().to_string(),
            _ => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::AmbiguousDestination,
                    format!("Cannot resolve effective push URL for remote '{remote_name}'"),
                ));
            }
        };

        let mut callbacks = git2::RemoteCallbacks::new();
        attach_credential_callbacks(&mut callbacks, ssh_cred);

        let connection = match remote.connect_auth(git2::Direction::Push, Some(callbacks), None) {
            Ok(c) => c,
            Err(e) => {
                let msg = e.message().to_string();
                if is_auth_error(&e) {
                    return Ok(PublishPreview::blocked(
                        PublishBlockReason::AuthRequired,
                        format!("Authentication required for remote '{remote_name}': {msg}"),
                    ));
                } else {
                    return Ok(PublishPreview::blocked(
                        PublishBlockReason::RemoteUnavailable,
                        format!("Cannot connect to remote '{remote_name}': {msg}"),
                    ));
                }
            }
        };

        let heads = match connection.list() {
            Ok(h) => h,
            Err(e) => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::RemoteUnavailable,
                    format!("Cannot list references from remote '{remote_name}': {}", e.message()),
                ));
            }
        };

        let mut expected_remote_oid = None;
        for head in heads {
            if head.name() == merge_ref {
                expected_remote_oid = Some(head.oid().to_string());
                break;
            }
        }

        let expected_remote_oid = match expected_remote_oid {
            Some(oid) => oid,
            None => {
                return Ok(PublishPreview::blocked(
                    PublishBlockReason::MissingDestination,
                    format!("Destination ref '{merge_ref}' does not exist on remote '{remote_name}'"),
                ));
            }
        };

        let remote_identity = compute_remote_identity(&effective_url);
        let repository_identity = compute_repository_identity(&repo, &root_path);
        let already_current = expected_remote_oid == source_oid;

        let snapshot = PublishSnapshot {
            branch: branch_ref,
            source_oid,
            remote_name,
            destination_ref: merge_ref,
            expected_remote_oid,
            remote_identity,
            repository_identity,
        };

        Ok(PublishPreview::ready(snapshot, already_current))
    })
    .await
    .map_err(|e| AppError::Internal(format!("Tokio spawn failure in prepare_leased_push: {e}")))?
}

struct NegotiationState {
    aborted_status: Option<PublishResultStatus>,
    aborted_message: Option<String>,
    actual_remote_oid: Option<String>,
    negotiated: bool,
}

/// Publishes a previously confirmed leased push snapshot.
/// Enforces exact-OID single-ref negotiation check.
pub async fn publish_leased_push(
    project_path: &Path,
    root_path: &Path,
    project_name: &str,
    snapshot: &PublishSnapshot,
    progress: &Option<ProgressSender>,
    ssh_cred: Option<Arc<SshCredStore>>,
) -> Result<PublishResult, AppError> {
    let start = Instant::now();
    emit_started(progress, project_name, "push", "Publishing leased push...");

    let _project_path = project_path.to_path_buf();
    let root_path = root_path.to_path_buf();
    let project_name_ret = project_name.to_string();
    let project_name_task = project_name.to_string();
    let snapshot = snapshot.clone();
    let progress_clone = progress.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<PublishResult, AppError> {
        // 1. Validate snapshot syntax
        if !snapshot.branch.starts_with("refs/heads/")
            || !snapshot.destination_ref.starts_with("refs/heads/")
            || git2::Oid::from_str(&snapshot.source_oid).is_err()
            || git2::Oid::from_str(&snapshot.expected_remote_oid).is_err()
            || snapshot.remote_identity.len() != 64
            || snapshot.repository_identity.len() != 64
        {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                "Invalid snapshot syntax or malformed reference/OID fields",
            ));
        }

        let repo = match open_repo(&root_path) {
            Ok(r) => r,
            Err(e) => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    format!("Cannot open repository: {e}"),
                ));
            }
        };

        // 2. Validate repository identity
        let current_repo_id = compute_repository_identity(&repo, &root_path);
        if current_repo_id != snapshot.repository_identity {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                "Repository or selected root identity changed since preview",
            ));
        }

        // 3. Validate attached branch
        if repo.head_detached().unwrap_or(true) {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                "HEAD is detached",
            ));
        }
        let head = match repo.head() {
            Ok(h) => h,
            Err(e) => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    format!("Cannot inspect HEAD: {}", e.message()),
                ));
            }
        };
        let current_branch_ref = match head.name() {
            Some(name) => name.to_string(),
            None => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    "HEAD is detached",
                ));
            }
        };
        if current_branch_ref != snapshot.branch {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                format!(
                    "Checked-out branch changed from {} to {}",
                    snapshot.branch, current_branch_ref
                ),
            ));
        }

        // 4. Validate source OID against current branch tip
        let current_source_oid = match head.target() {
            Some(oid) => oid.to_string(),
            None => {
                return Ok(make_result(
                    PublishResultStatus::StaleLocal,
                    &snapshot,
                    None,
                    "Branch has no target commit OID",
                ));
            }
        };
        if current_source_oid != snapshot.source_oid {
            return Ok(make_result(
                PublishResultStatus::StaleLocal,
                &snapshot,
                None,
                format!(
                    "Local branch tip changed from {} to {}",
                    snapshot.source_oid, current_source_oid
                ),
            ));
        }

        // 5. Re-resolve config and check remote identity
        let config = match repo.config() {
            Ok(c) => c,
            Err(e) => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    format!("Cannot read config: {}", e.message()),
                ));
            }
        };
        let branch_name = current_branch_ref.strip_prefix("refs/heads/").unwrap();
        let remote_name = match config.get_string(&format!("branch.{branch_name}.remote")) {
            Ok(r) => r.trim().to_string(),
            Err(_) => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    format!("Missing branch.{branch_name}.remote configuration"),
                ));
            }
        };
        if remote_name != snapshot.remote_name {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                format!(
                    "Configured remote changed from {} to {}",
                    snapshot.remote_name, remote_name
                ),
            ));
        }
        let merge_ref = match config.get_string(&format!("branch.{branch_name}.merge")) {
            Ok(m) => m.trim().to_string(),
            Err(_) => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    format!("Missing branch.{branch_name}.merge configuration"),
                ));
            }
        };
        if merge_ref != snapshot.destination_ref {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                format!(
                    "Configured destination ref changed from {} to {}",
                    snapshot.destination_ref, merge_ref
                ),
            ));
        }

        let mut push_urls = Vec::new();
        if let Ok(entries) = config.entries(Some(&format!(
            r"^remote\.{}\.pushurl$",
            regex::escape(&remote_name)
        ))) {
            let _ = entries.for_each(|entry| {
                if let Some(val) = entry.value() {
                    push_urls.push(val.to_string());
                }
            });
        }
        if push_urls.len() > 1 {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                format!("Remote '{remote_name}' has multiple push URLs configured"),
            ));
        }

        let mut remote = match repo.find_remote(&remote_name) {
            Ok(r) => r,
            Err(e) => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    format!("Remote '{remote_name}' not found: {}", e.message()),
                ));
            }
        };
        let effective_url = match remote.pushurl().or_else(|| remote.url()) {
            Some(u) if !u.trim().is_empty() => u.trim().to_string(),
            _ => {
                return Ok(make_result(
                    PublishResultStatus::StaleConfig,
                    &snapshot,
                    None,
                    "Cannot resolve effective push URL",
                ));
            }
        };
        let remote_identity = compute_remote_identity(&effective_url);
        if remote_identity != snapshot.remote_identity {
            return Ok(make_result(
                PublishResultStatus::StaleConfig,
                &snapshot,
                None,
                "Remote push URL identity changed since preview",
            ));
        }

        // 6. If snapshot was already current, re-advertise without pushing
        if snapshot.expected_remote_oid == snapshot.source_oid {
            let mut callbacks = git2::RemoteCallbacks::new();
            attach_credential_callbacks(&mut callbacks, ssh_cred.clone());
            let connection = match remote.connect_auth(git2::Direction::Push, Some(callbacks), None) {
                Ok(c) => c,
                Err(e) => {
                    let is_auth = is_auth_error(&e);
                    return Ok(make_result(
                        if is_auth {
                            PublishResultStatus::AuthRequired
                        } else {
                            PublishResultStatus::Unknown
                        },
                        &snapshot,
                        None,
                        format!("Connection error during re-advertisement: {}", e.message()),
                    ));
                }
            };
            let heads = match connection.list() {
                Ok(h) => h,
                Err(e) => {
                    return Ok(make_result(
                        PublishResultStatus::Unknown,
                        &snapshot,
                        None,
                        format!("Failed to list references: {}", e.message()),
                    ));
                }
            };

            let mut advertised_oid = None;
            for head in heads {
                if head.name() == snapshot.destination_ref {
                    advertised_oid = Some(head.oid().to_string());
                    break;
                }
            }

            match advertised_oid {
                Some(actual_oid) if actual_oid == snapshot.source_oid => {
                    return Ok(make_result(
                        PublishResultStatus::AlreadyCurrent,
                        &snapshot,
                        Some(actual_oid),
                        "Branch is already up to date on remote",
                    ));
                }
                Some(actual_oid) => {
                    return Ok(make_result(
                        PublishResultStatus::StaleRemote,
                        &snapshot,
                        Some(actual_oid.clone()),
                        format!(
                            "Remote ref has moved from {} to {}",
                            snapshot.expected_remote_oid, actual_oid
                        ),
                    ));
                }
                None => {
                    return Ok(make_result(
                        PublishResultStatus::StaleRemote,
                        &snapshot,
                        None,
                        format!(
                            "Destination ref '{}' no longer exists on remote '{}'",
                            snapshot.destination_ref, snapshot.remote_name
                        ),
                    ));
                }
            }
        }

        // 7. Execute leased push with negotiation callback
        let refspec = format!("+{}:{}", snapshot.source_oid, snapshot.destination_ref);
        let remote_rejection = Arc::new(Mutex::new(None::<String>));
        let negotiation_state = Arc::new(Mutex::new(NegotiationState {
            aborted_status: None,
            aborted_message: None,
            actual_remote_oid: None,
            negotiated: false,
        }));

        let mut callbacks = git2::RemoteCallbacks::new();
        attach_credential_callbacks(&mut callbacks, ssh_cred);

        let push_progress_project = project_name_task.clone();
        let push_progress_sender = progress_clone.clone();
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

        let pack_progress_project = project_name_task.clone();
        let pack_progress_sender = progress_clone.clone();
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

        let rejection_clone = Arc::clone(&remote_rejection);
        callbacks.push_update_reference(move |refname, status| {
            handle_push_update_reference(&rejection_clone, refname, status)
        });

        let neg_state_clone = Arc::clone(&negotiation_state);
        let expected_dest_ref = snapshot.destination_ref.clone();
        let expected_remote_oid = snapshot.expected_remote_oid.clone();
        let expected_source_oid = snapshot.source_oid.clone();

        callbacks.push_negotiation(move |updates| {
            let mut state = neg_state_clone.lock();
            state.negotiated = true;

            if updates.len() != 1 {
                state.aborted_status = Some(PublishResultStatus::StaleConfig);
                state.aborted_message = Some(format!(
                    "Unexpected push negotiation updates count: {}",
                    updates.len()
                ));
                return Err(git2::Error::from_str("unexpected-updates"));
            }

            let u = &updates[0];
            let dst_refname = u.dst_refname().unwrap_or("");
            if dst_refname != expected_dest_ref {
                state.aborted_status = Some(PublishResultStatus::StaleConfig);
                state.aborted_message = Some(format!(
                    "Negotiated ref '{}' does not match expected destination '{}'",
                    dst_refname, expected_dest_ref
                ));
                return Err(git2::Error::from_str("unexpected-ref"));
            }

            // In git2 0.19: u.src() is remote OLD OID, u.dst() is local NEW OID
            let src_oid = u.src().to_string();
            state.actual_remote_oid = Some(src_oid.clone());

            if src_oid != expected_remote_oid {
                state.aborted_status = Some(PublishResultStatus::StaleRemote);
                state.aborted_message = Some(format!(
                    "Remote ref has moved from {} to {}",
                    expected_remote_oid, src_oid
                ));
                return Err(git2::Error::from_str("stale-remote"));
            }

            let dst_oid = u.dst().to_string();
            if dst_oid != expected_source_oid {
                state.aborted_status = Some(PublishResultStatus::StaleLocal);
                state.aborted_message = Some(format!(
                    "Local OID during negotiation was {}, expected {}",
                    dst_oid, expected_source_oid
                ));
                return Err(git2::Error::from_str("stale-local"));
            }

            Ok(())
        });

        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);

        let push_res = remote.push(&[&refspec], Some(&mut push_opts));

        let neg_guard = negotiation_state.lock();
        let was_negotiated = neg_guard.negotiated;
        let aborted_status = neg_guard.aborted_status;
        let aborted_msg = neg_guard.aborted_message.clone();
        let actual_oid = neg_guard.actual_remote_oid.clone();
        drop(neg_guard);

        let rejection_msg = remote_rejection.lock().clone();

        if let Some(rej) = rejection_msg {
            return Ok(make_result(
                PublishResultStatus::Rejected,
                &snapshot,
                actual_oid,
                rej,
            ));
        }

        if let Some(status) = aborted_status {
            return Ok(make_result(
                status,
                &snapshot,
                actual_oid,
                aborted_msg.unwrap_or_else(|| "Push negotiation aborted".to_string()),
            ));
        }

        match push_res {
            Ok(()) => Ok(make_result(
                PublishResultStatus::Published,
                &snapshot,
                Some(snapshot.source_oid.clone()),
                format!(
                    "Successfully published {} to {}/{}",
                    snapshot.branch, snapshot.remote_name, snapshot.destination_ref
                ),
            )),
            Err(e) => {
                let msg = e.message().to_string();
                if !was_negotiated && is_auth_error(&e) {
                    Ok(make_result(
                        PublishResultStatus::AuthRequired,
                        &snapshot,
                        actual_oid,
                        format!("Authentication required: {msg}"),
                    ))
                } else {
                    Ok(make_result(
                        PublishResultStatus::Unknown,
                        &snapshot,
                        actual_oid,
                        format!("Push failed: {msg}"),
                    ))
                }
            }
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("Tokio spawn failure in publish_leased_push: {e}")))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    match &result {
        Ok(pub_res) if pub_res.status == PublishResultStatus::Published => {
            emit_completed(progress, &project_name_ret, "push", &pub_res.message);
        }
        Ok(pub_res) => {
            emit_failed(progress, &project_name_ret, "push", &pub_res.message);
        }
        Err(e) => {
            emit_failed(progress, &project_name_ret, "push", &e.to_string());
        }
    }
    let _ = duration_ms;

    result
}
