use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::git::conflict::compute_full_index_fingerprint;
use crate::git::mutation_coordination::GLOBAL_MUTATION_COORDINATOR;
use crate::git::types::{
    OperationAction, OperationActionRequest, OperationKind, OperationOutcome,
    OperationStatusResponse, OperationStoppedReason, StageRoleLabels, TerminalHandoffRequired,
};

const MAX_OUTPUT_DRAIN_BYTES: usize = 65_536; // 64 KB memory cap for diagnostics
const SUBPROCESS_TIMEOUT: Duration = Duration::from_secs(15);
const EDITOR_SENTINEL_TOKEN: &str = "DAM_HOPPER_EDITOR_REQUIRED";

fn check_path_exists_fail_closed(path: &Path) -> Result<bool, AppError> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(AppError::Git(format!(
            "Failed inspecting Git metadata at {}: {e}",
            path.display()
        ))),
    }
}

fn read_optional_metadata(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Git(format!(
            "Failed reading Git metadata at {}: {e}",
            path.display()
        ))),
    }
}

/// Unified authoritative detection of active Git operation and sequencer state.
pub fn active_operation_kind(repo: &git2::Repository) -> OperationKind {
    match detect_operation_kind_safe(repo) {
        Ok(op) => op,
        Err(_) => OperationKind::Unknown,
    }
}

fn detect_operation_kind_safe(repo: &git2::Repository) -> Result<OperationKind, AppError> {
    let git_dir = repo.path();

    let has_merge_head = check_path_exists_fail_closed(&git_dir.join("MERGE_HEAD"))?;
    let has_rebase_merge = check_path_exists_fail_closed(&git_dir.join("rebase-merge"))?;
    let has_rebase_apply = check_path_exists_fail_closed(&git_dir.join("rebase-apply"))?;
    let has_cherry_pick_head = check_path_exists_fail_closed(&git_dir.join("CHERRY_PICK_HEAD"))?;
    let has_revert_head = check_path_exists_fail_closed(&git_dir.join("REVERT_HEAD"))?;
    let has_bisect = check_path_exists_fail_closed(&git_dir.join("BISECT_LOG"))?
        || check_path_exists_fail_closed(&git_dir.join("BISECT_START"))?;

    // Check for contradictory or mutually exclusive markers
    let active_marker_count = [
        has_merge_head,
        has_rebase_merge || has_rebase_apply,
        has_cherry_pick_head,
        has_revert_head,
        has_bisect,
    ]
    .iter()
    .filter(|&&b| b)
    .count();

    if active_marker_count > 1 {
        // Contradictory metadata must fail closed as unsupported/unknown, not none
        return Ok(OperationKind::Unsupported);
    }

    if has_bisect {
        return Ok(OperationKind::Unsupported);
    }

    if has_rebase_merge {
        return Ok(OperationKind::Rebase);
    }

    if has_rebase_apply {
        // Distinguish git am vs git rebase --apply
        let rebasing = check_path_exists_fail_closed(&git_dir.join("rebase-apply/rebasing"))?;
        let applying = check_path_exists_fail_closed(&git_dir.join("rebase-apply/applying"))?;
        if rebasing {
            return Ok(OperationKind::Rebase);
        } else if applying {
            // git am mailbox processing is unsupported for conflict recovery
            return Ok(OperationKind::Unsupported);
        } else {
            return Ok(OperationKind::Unsupported);
        }
    }

    if has_merge_head {
        return Ok(OperationKind::Merge);
    }

    if has_cherry_pick_head {
        return Ok(OperationKind::CherryPick);
    }

    if has_revert_head {
        return Ok(OperationKind::Revert);
    }

    // Inspect sequencer/todo even when CHERRY_PICK_HEAD or REVERT_HEAD is absent between commits
    let sequencer_todo = git_dir.join("sequencer/todo");
    if check_path_exists_fail_closed(&sequencer_todo)? {
        match fs::read(&sequencer_todo) {
            Ok(bytes) => {
                let content = String::from_utf8_lossy(&bytes);
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if trimmed.starts_with("pick ") || trimmed.starts_with("p ") {
                        return Ok(OperationKind::CherryPick);
                    }
                    if trimmed.starts_with("revert ") {
                        return Ok(OperationKind::Revert);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::Git(format!("Failed to read sequencer/todo: {e}"))),
        }
    }

    // Fallback to git2 RepositoryState
    let op = match repo.state() {
        git2::RepositoryState::Merge => OperationKind::Merge,
        git2::RepositoryState::Rebase
        | git2::RepositoryState::RebaseInteractive
        | git2::RepositoryState::RebaseMerge => OperationKind::Rebase,
        git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
            OperationKind::CherryPick
        }
        git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => {
            OperationKind::Revert
        }
        git2::RepositoryState::ApplyMailbox | git2::RepositoryState::ApplyMailboxOrRebase => {
            OperationKind::Unsupported
        }
        git2::RepositoryState::Bisect => OperationKind::Unsupported,
        git2::RepositoryState::Clean => OperationKind::None,
    };
    Ok(op)
}

/// Computes a deterministic SHA-256 operation fingerprint bound to HEAD, target revision,
/// operation type, and exact sequencer / rebase / merge metadata contents.
pub fn compute_operation_fingerprint(
    repo: &git2::Repository,
    op: OperationKind,
    git_dir: &Path,
) -> Result<String, AppError> {
    let mut hasher = Sha256::new();
    hasher.update(op.as_str().as_bytes());
    hasher.update(b"\0");

    let (head_oid, head_name) = match repo.head() {
        Ok(h) => {
            let oid = h.target().map(|oid| oid.to_string()).unwrap_or_default();
            let name = h.name().map(|n| n.to_string()).unwrap_or_default();
            (oid, name)
        }
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch || e.code() == git2::ErrorCode::NotFound => {
            (String::new(), String::new())
        }
        Err(e) => return Err(AppError::Git(format!("Failed to read HEAD reference: {e}"))),
    };
    hasher.update(head_oid.as_bytes());
    hasher.update(b"\0");
    hasher.update(head_name.as_bytes());
    hasher.update(b"\0");

    match op {
        OperationKind::Merge => {
            if let Some(bytes) = read_optional_metadata(&git_dir.join("MERGE_HEAD"))? {
                hasher.update(b"MERGE_HEAD\0");
                hasher.update(&bytes);
                hasher.update(b"\0");
            }
            if let Some(bytes) = read_optional_metadata(&git_dir.join("MERGE_MSG"))? {
                hasher.update(b"MERGE_MSG\0");
                hasher.update(&bytes);
                hasher.update(b"\0");
            }
        }
        OperationKind::Rebase => {
            for file in &[
                "rebase-merge/stopped-sha",
                "rebase-merge/onto",
                "rebase-merge/head-name",
                "rebase-merge/done",
                "rebase-merge/git-rebase-todo",
                "rebase-apply/next",
                "REBASE_HEAD",
            ] {
                if let Some(bytes) = read_optional_metadata(&git_dir.join(file))? {
                    hasher.update(file.as_bytes());
                    hasher.update(b"\0");
                    hasher.update(&bytes);
                    hasher.update(b"\0");
                }
            }
        }
        OperationKind::CherryPick | OperationKind::Revert => {
            for file in &[
                "CHERRY_PICK_HEAD",
                "REVERT_HEAD",
                "sequencer/todo",
                "sequencer/head",
                "sequencer/abort-safety",
            ] {
                if let Some(bytes) = read_optional_metadata(&git_dir.join(file))? {
                    hasher.update(file.as_bytes());
                    hasher.update(b"\0");
                    hasher.update(&bytes);
                    hasher.update(b"\0");
                }
            }
        }
        OperationKind::None | OperationKind::Unsupported | OperationKind::Unknown => {}
    }

    Ok(hex::encode(hasher.finalize()))
}

/// Truthful stage role labels based on authoritative operation semantics.
pub fn get_stage_role_labels(op: OperationKind) -> StageRoleLabels {
    match op {
        OperationKind::Merge => StageRoleLabels {
            base: Some("Base (merge base)".to_string()),
            ours: "Current branch (HEAD)".to_string(),
            theirs: "Incoming change (MERGE_HEAD)".to_string(),
        },
        OperationKind::Rebase => StageRoleLabels {
            base: Some("Base".to_string()),
            ours: "Current (onto/rebased state)".to_string(),
            theirs: "Incoming (replayed commit)".to_string(),
        },
        OperationKind::CherryPick => StageRoleLabels {
            base: Some("Parent of cherry-picked commit".to_string()),
            ours: "Current branch (HEAD)".to_string(),
            theirs: "Cherry-picked change".to_string(),
        },
        OperationKind::Revert => StageRoleLabels {
            base: Some("Commit being reverted".to_string()),
            ours: "Current branch (HEAD)".to_string(),
            theirs: "Parent (reverting to)".to_string(),
        },
        OperationKind::None | OperationKind::Unsupported | OperationKind::Unknown => {
            StageRoleLabels {
                base: None,
                ours: "Current (ours)".to_string(),
                theirs: "Incoming (theirs)".to_string(),
            }
        }
    }
}

/// Obtains authoritative operation status for a worktree root.
pub fn get_authoritative_operation_status(
    worktree_root: &Path,
) -> Result<OperationStatusResponse, AppError> {
    let repo = git2::Repository::open(worktree_root)
        .map_err(|e| AppError::Git(format!("Failed to open repository: {e}")))?;

    let git_dir = repo.path().to_path_buf();
    let op = active_operation_kind(&repo);
    let index = repo
        .index()
        .map_err(|e| AppError::Git(format!("Failed to open index: {e}")))?;

    let full_index_fingerprint = compute_full_index_fingerprint(&index);
    let operation_fingerprint = compute_operation_fingerprint(&repo, op, &git_dir)?;
    let stage_role_labels = get_stage_role_labels(op);

    let has_conflicts = index.has_conflicts();
    let mut blockers = Vec::new();
    let (can_continue, can_abort, stopped_reason) = if op == OperationKind::Unsupported {
        blockers.push(
            "Active operation is unsupported or ambiguous (e.g. git am or bisect)".to_string(),
        );
        (false, false, Some(OperationStoppedReason::Unsupported))
    } else if op == OperationKind::Unknown {
        blockers.push("Operation state is unknown".to_string());
        (false, false, Some(OperationStoppedReason::Unknown))
    } else if has_conflicts {
        let abortable = matches!(
            op,
            OperationKind::Merge
                | OperationKind::Rebase
                | OperationKind::CherryPick
                | OperationKind::Revert
        );
        blockers.push("Unresolved merge conflicts remain in index".to_string());
        (false, abortable, Some(OperationStoppedReason::Conflicts))
    } else {
        match op {
            OperationKind::Merge => {
                // In a merge with all conflicts resolved, Git requires reviewing MERGE_MSG
                (
                    true,
                    true,
                    Some(OperationStoppedReason::MessageEditRequired),
                )
            }
            OperationKind::Rebase | OperationKind::CherryPick | OperationKind::Revert => {
                (true, true, None)
            }
            OperationKind::None => (false, false, None),
            OperationKind::Unsupported | OperationKind::Unknown => unreachable!(),
        }
    };

    let terminal_handoff_required =
        if stopped_reason == Some(OperationStoppedReason::MessageEditRequired) {
            Some(TerminalHandoffRequired {
                reason: "commitMessageEditor".to_string(),
                worktree_root: worktree_root.to_string_lossy().to_string(),
            })
        } else {
            None
        };

    Ok(OperationStatusResponse {
        operation: op,
        can_continue,
        can_abort,
        stopped_reason,
        operation_fingerprint,
        full_index_fingerprint,
        stage_role_labels: Some(stage_role_labels),
        terminal_handoff_required,
        blockers,
    })
}

pub(crate) struct RollingSentinelScanner {
    sentinel: &'static [u8],
    tail: Vec<u8>,
    detected: bool,
}

impl RollingSentinelScanner {
    pub(crate) fn new(sentinel: &'static str) -> Self {
        assert!(!sentinel.is_empty(), "sentinel must not be empty");
        Self {
            sentinel: sentinel.as_bytes(),
            tail: Vec::with_capacity(sentinel.len() * 2),
            detected: false,
        }
    }

    pub(crate) fn feed(&mut self, chunk: &[u8]) {
        if self.detected || chunk.is_empty() {
            return;
        }

        self.tail.extend_from_slice(chunk);
        if self.tail.windows(self.sentinel.len()).any(|w| w == self.sentinel) {
            self.detected = true;
            self.tail.clear();
            return;
        }

        let keep = self.sentinel.len().saturating_sub(1);
        if self.tail.len() > keep {
            let drain_count = self.tail.len() - keep;
            self.tail.drain(..drain_count);
        }
    }
    pub(crate) fn detected(&self) -> bool {
        self.detected
    }
}

async fn drain_bounded<R: tokio::io::AsyncRead + Unpin>(mut reader: R) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() < MAX_OUTPUT_DRAIN_BYTES {
                    let to_copy = (MAX_OUTPUT_DRAIN_BYTES - buf.len()).min(n);
                    buf.extend_from_slice(&chunk[..to_copy]);
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}

async fn drain_bounded_with_sentinel<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    scanner: &mut RollingSentinelScanner,
) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                let slice = &chunk[..n];
                scanner.feed(slice);
                if buf.len() < MAX_OUTPUT_DRAIN_BYTES {
                    let to_copy = (MAX_OUTPUT_DRAIN_BYTES - buf.len()).min(n);
                    buf.extend_from_slice(&chunk[..to_copy]);
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}

struct ProcessGroupGuard {
    #[cfg(unix)]
    pgid: Option<i32>,
    #[cfg(windows)]
    pid: Option<u32>,
    active: bool,
}

impl ProcessGroupGuard {
    fn new(child: &tokio::process::Child) -> Self {
        #[cfg(unix)]
        let pgid = child.id().map(|id| id as i32);
        #[cfg(windows)]
        let pid = child.id();

        Self {
            #[cfg(unix)]
            pgid,
            #[cfg(windows)]
            pid,
            active: true,
        }
    }

    fn disarm(&mut self) {
        self.active = false;
    }

    fn kill_group(&mut self) {
        if !self.active {
            return;
        }
        #[cfg(unix)]
        if let Some(pgid) = self.pgid {
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
                libc::kill(pgid, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        if let Some(pid) = self.pid {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
    }
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        if self.active {
            self.kill_group();
        }
    }
}

const MAX_DIAGNOSTIC_MESSAGE_BYTES: usize = 4096;

pub fn sanitize_git_diagnostic(raw_err: &str, worktree_root: &Path) -> String {
    let redacted = crate::diagnostics::redact_diagnostic_text(raw_err);
    let root_str = worktree_root.to_string_lossy();
    let stripped = if !root_str.is_empty() {
        redacted.replace(&*root_str, "[WORKTREE_ROOT]")
    } else {
        redacted
    };

    let trimmed = stripped.trim();
    if trimmed.len() <= MAX_DIAGNOSTIC_MESSAGE_BYTES {
        trimmed.to_string()
    } else {
        let mut end = MAX_DIAGNOSTIC_MESSAGE_BYTES;
        while !trimmed.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}... [truncated]", &trimmed[..end])
    }
}

/// Qualified bounded non-interactive subprocess runner with editor sentinel and process cleanup.
pub async fn run_bounded_git_command(
    args: &[&str],
    cwd: &Path,
) -> Result<(i32, String, String, bool), AppError> {
    #[cfg(unix)]
    let editor_cmd = format!("sh -c 'echo {EDITOR_SENTINEL_TOKEN} >&2; exit 42'");
    #[cfg(windows)]
    let editor_cmd = format!("cmd /c \"echo {EDITOR_SENTINEL_TOKEN} 1>&2 & exit 42\"");

    let mut cmd = Command::new("git");
    cmd.args(["-c", "safe.directory=*"])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", &editor_cmd)
        .kill_on_drop(true);

    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Git(format!("Failed to spawn git: {e}")))?;

    let mut group_guard = ProcessGroupGuard::new(&child);

    let stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Git("Failed to capture stdout".into()))?;
    let stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Git("Failed to capture stderr".into()))?;

    let mut stderr_scanner = RollingSentinelScanner::new(EDITOR_SENTINEL_TOKEN);

    let wait_fut = async {
        let (stdout_str, stderr_str) = tokio::join!(
            drain_bounded(stdout_pipe),
            drain_bounded_with_sentinel(stderr_pipe, &mut stderr_scanner),
        );
        let status = child
            .wait()
            .await
            .map_err(|e| AppError::Git(format!("Failed waiting for git process: {e}")))?;
        let code = status.code().unwrap_or(-1);
        let editor_invoked = stderr_scanner.detected();
        Ok::<_, AppError>((code, stdout_str, stderr_str, editor_invoked))
    };

    match tokio::time::timeout(SUBPROCESS_TIMEOUT, wait_fut).await {
        Ok(res) => {
            group_guard.disarm();
            res
        }
        Err(_) => {
            // Process timed out: perform process tree cleanup
            group_guard.kill_group();
            let _ = child.wait().await;
            group_guard.disarm();
            Err(AppError::Git(format!(
                "Git process exceeded deadline of {} seconds and was terminated",
                SUBPROCESS_TIMEOUT.as_secs()
            )))
        }
    }
}

/// Executes preconditioned continue or abort mutation under GitMutationCoordinator.
pub async fn execute_operation_action(
    worktree_root: &Path,
    req: &OperationActionRequest,
) -> Result<OperationOutcome, AppError> {
    let repo = git2::Repository::open(worktree_root)
        .map_err(|e| AppError::Git(format!("Failed to open repository: {e}")))?;

    // Acquire exclusive GitMutationCoordinator lock for both common gitdir and worktree
    let _guard = GLOBAL_MUTATION_COORDINATOR
        .try_acquire_for_repo(&repo, worktree_root)
        .map_err(|reason| AppError::Conflict(reason.to_string()))?;

    // 1. Authoritative re-validation of preconditions under the mutation lock
    let root_path = worktree_root.to_path_buf();
    let current_status = tokio::task::spawn_blocking(move || {
        get_authoritative_operation_status(&root_path)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;
    if current_status.operation_fingerprint != req.operation_precondition {
        return Ok(OperationOutcome::Stale {
            reason: "Operation state or target revision changed since status was captured"
                .to_string(),
            required_refresh: true,
        });
    }

    if current_status.full_index_fingerprint != req.full_index_fingerprint {
        return Ok(OperationOutcome::Stale {
            reason: "Index state or staged files changed since status was captured".to_string(),
            required_refresh: true,
        });
    }

    let op = current_status.operation;
    let (cmd_name, abort_arg, continue_arg) = match op {
        OperationKind::Merge => ("merge", "--abort", "--continue"),
        OperationKind::Rebase => ("rebase", "--abort", "--continue"),
        OperationKind::CherryPick => ("cherry-pick", "--abort", "--continue"),
        OperationKind::Revert => ("revert", "--abort", "--continue"),
        OperationKind::None | OperationKind::Unsupported | OperationKind::Unknown => {
            return Ok(OperationOutcome::Failed {
                error: format!("No continuable or abortable operation active ({:?})", op),
            });
        }
    };

    match req.action {
        OperationAction::Abort => {
            if !req.abort_confirmed {
                return Ok(OperationOutcome::Failed {
                    error: "Operation abort requires explicit user confirmation".to_string(),
                });
            }

            let args = [cmd_name, abort_arg];
            let result = run_bounded_git_command(&args, worktree_root).await;

            match result {
                Ok((0, _, _, _)) => {
                    let has_conflicts = repo.index().map(|idx| idx.has_conflicts()).unwrap_or(true);
                    let op_now = active_operation_kind(&repo);
                    let cleaned = !has_conflicts && op_now == OperationKind::None;
                    Ok(OperationOutcome::Aborted {
                        worktree_cleaned: cleaned,
                    })
                }
                Ok((_, stdout, stderr, _)) => {
                    let err = if !stderr.trim().is_empty() {
                        stderr.trim().to_string()
                    } else {
                        stdout.trim().to_string()
                    };
                    let sanitized = sanitize_git_diagnostic(&err, worktree_root);
                    Ok(OperationOutcome::Failed {
                        error: format!("Abort failed: {sanitized}"),
                    })
                }
                Err(e) => {
                    let sanitized = sanitize_git_diagnostic(&e.to_string(), worktree_root);
                    Ok(OperationOutcome::OutcomeUnknown {
                        error: sanitized,
                        required_refresh: true,
                    })
                }
            }
        }
        OperationAction::Continue => {
            if !current_status.can_continue {
                return Ok(OperationOutcome::Blocked {
                    reason: OperationStoppedReason::Conflicts,
                    terminal_handoff_required: false,
                });
            }

            let args = [cmd_name, continue_arg];
            let result = run_bounded_git_command(&args, worktree_root).await;

            match result {
                Ok((0, _, _, _)) => {
                    let root_path = worktree_root.to_path_buf();
                    let refresh_result = tokio::task::spawn_blocking(move || {
                        get_authoritative_operation_status(&root_path)
                    })
                    .await;

                    match refresh_result {
                        Ok(Ok(new_status)) => Ok(OperationOutcome::Continued { new_status }),
                        Ok(Err(e)) => Ok(OperationOutcome::OutcomeUnknown {
                            error: format!(
                                "Continue command succeeded but post-run status refresh failed: {e}"
                            ),
                            required_refresh: true,
                        }),
                        Err(e) => Ok(OperationOutcome::OutcomeUnknown {
                            error: format!(
                                "Continue command succeeded but post-run worker thread panicked: {e}"
                            ),
                            required_refresh: true,
                        }),
                    }
                }
                Ok((_code, stdout, stderr, editor_invoked)) => {
                    if editor_invoked {
                        // Safe detection: Git requested an interactive commit message editor
                        return Ok(OperationOutcome::Blocked {
                            reason: OperationStoppedReason::MessageEditRequired,
                            terminal_handoff_required: true,
                        });
                    }

                    let root_path = worktree_root.to_path_buf();
                    let post_status_res = tokio::task::spawn_blocking(move || {
                        get_authoritative_operation_status(&root_path)
                    })
                    .await;

                    let post_status = match post_status_res {
                        Ok(Ok(st)) => st,
                        Ok(Err(e)) => {
                            return Ok(OperationOutcome::OutcomeUnknown {
                                error: format!("Post-attempt status inspection failed: {e}"),
                                required_refresh: true,
                            });
                        }
                        Err(e) => {
                            return Ok(OperationOutcome::OutcomeUnknown {
                                error: format!("Post-attempt status inspection worker panicked: {e}"),
                                required_refresh: true,
                            });
                        }
                    };

                    // Check if re-queried state indicates new conflicts (e.g. repeated rebase stops)
                    if post_status.stopped_reason == Some(OperationStoppedReason::Conflicts) {
                        return Ok(OperationOutcome::Continued { new_status: post_status });
                    }

                    // Check for hook failure only when the operation is STILL ACTIVE in metadata,
                    // has no unmerged conflicts, and stderr specifically indicates a hook failure from git.
                    let is_still_active_op = matches!(
                        post_status.operation,
                        OperationKind::Merge
                            | OperationKind::Rebase
                            | OperationKind::CherryPick
                            | OperationKind::Revert
                    );
                    let no_conflicts = post_status.stopped_reason != Some(OperationStoppedReason::Conflicts);

                    let combined_lower = format!("{stdout}\n{stderr}").to_lowercase();
                    let is_hook_error = combined_lower.contains("hook failed")
                        || combined_lower.contains("hook declined")
                        || combined_lower.contains("pre-commit hook")
                        || combined_lower.contains("commit-msg hook");

                    if is_still_active_op && no_conflicts && is_hook_error {
                        return Ok(OperationOutcome::Blocked {
                            reason: OperationStoppedReason::HookBlocked,
                            terminal_handoff_required: false,
                        });
                    }

                    let err = if !stderr.trim().is_empty() {
                        stderr.trim().to_string()
                    } else {
                        stdout.trim().to_string()
                    };
                    let sanitized = sanitize_git_diagnostic(&err, worktree_root);
                    Ok(OperationOutcome::Failed {
                        error: format!("Continue failed: {sanitized}"),
                    })
                }
                Err(e) => {
                    let sanitized = sanitize_git_diagnostic(&e.to_string(), worktree_root);
                    Ok(OperationOutcome::OutcomeUnknown {
                        error: sanitized,
                        required_refresh: true,
                    })
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rolling_sentinel_scanner_single_chunk() {
        let mut scanner = RollingSentinelScanner::new("MY_TOKEN");
        assert!(!scanner.detected());
        scanner.feed(b"some prefix text ");
        assert!(!scanner.detected());
        scanner.feed(b"here is MY_TOKEN in chunk");
        assert!(scanner.detected());
    }

    #[test]
    fn test_rolling_sentinel_scanner_1_byte_chunks() {
        let mut scanner = RollingSentinelScanner::new("MY_TOKEN");
        for b in "prefix_MY_TOKEN_suffix".bytes() {
            scanner.feed(&[b]);
        }
        assert!(scanner.detected());
    }

    #[test]
    fn test_rolling_sentinel_scanner_arbitrary_short_chunks() {
        let mut scanner = RollingSentinelScanner::new("MY_TOKEN");
        scanner.feed(b"MY_");
        assert!(!scanner.detected());
        scanner.feed(b"TO");
        assert!(!scanner.detected());
        scanner.feed(b"KEN");
        assert!(scanner.detected());
    }

    #[test]
    fn test_rolling_sentinel_scanner_no_false_positives() {
        let mut scanner = RollingSentinelScanner::new("MY_TOKEN");
        scanner.feed(b"regular output line 1\n");
        scanner.feed(b"regular output line 2\n");
        assert!(!scanner.detected());
    }
}
