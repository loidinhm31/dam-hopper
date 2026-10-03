use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::git::cli_fallback;
use crate::git::types::{GitActionResult, GitBlockReason};
use serde::{Deserialize, Serialize};

/// Snapshot returned by `get_commit_message`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMessageSnapshot {
    pub message: String,
    pub branch: String,
    pub head_oid: String,
}

#[derive(Debug, Clone)]
pub(super) struct CapturedBranch {
    pub(super) branch: String,
    pub(super) old_tip: git2::Oid,
}

#[derive(Debug)]
pub(super) enum RewriteFailure {
    Block(GitBlockReason, String),
    Error(AppError),
}

impl From<AppError> for RewriteFailure {
    fn from(err: AppError) -> Self {
        RewriteFailure::Error(err)
    }
}

impl From<git2::Error> for RewriteFailure {
    fn from(err: git2::Error) -> Self {
        RewriteFailure::Error(AppError::Git(err.message().to_string()))
    }
}

pub(super) struct CommitNode<'odb> {
    pub(super) oid: git2::Oid,
    pub(super) tree_oid: git2::Oid,
    pub(super) parents: Vec<git2::Oid>,
    pub(super) raw_object: git2::OdbObject<'odb>,
}

#[derive(Debug)]
pub(super) struct RawHeaderBlock<'a> {
    pub(super) key: &'a [u8],
    pub(super) raw: &'a [u8],
}

#[derive(Debug)]
pub(super) struct RawCommit<'a> {
    tree_oid: git2::Oid,
    parents: Vec<git2::Oid>,
    pub(super) headers: Vec<RawHeaderBlock<'a>>,
    pub(super) message: &'a [u8],
}

struct RewritePlan {
    affected_set: HashSet<git2::Oid>,
    _target_oid: git2::Oid,
    normalized_message: Vec<u8>,
    removable_headers: HashMap<git2::Oid, Vec<usize>>,
    no_op: bool,
}

#[derive(Debug)]
struct MergetagInfo {
    object_oid: git2::Oid,
}

pub(super) fn exact_oid(value: &str, field: &str) -> Result<git2::Oid, AppError> {
    if value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::InvalidInput(format!(
            "{field} must be a full 40-hex commit OID"
        )));
    }
    git2::Oid::from_str(value).map_err(|e| AppError::InvalidInput(format!("invalid {field}: {e}")))
}

pub(super) fn validate_expected_snapshot(branch: &str, head: &str) -> Result<git2::Oid, AppError> {
    if !branch.starts_with("refs/heads/") || !git2::Reference::is_valid_name(branch) {
        return Err(AppError::InvalidInput(format!(
            "invalid expectedBranch '{branch}'"
        )));
    }
    exact_oid(head, "expectedHeadOid")
}

pub(super) fn normalize_message(message: &str) -> Result<Vec<u8>, AppError> {
    if message.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "commit message cannot be empty".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(message.len() + usize::from(!message.ends_with('\n')));
    bytes.extend_from_slice(message.as_bytes());
    if !bytes.ends_with(b"\n") {
        bytes.push(b'\n');
    }
    Ok(bytes)
}

/// Shared stale-first gates. An inspection failure is an error, never evidence of safety.
pub(super) async fn mutation_preflight(
    path: &Path,
    expected_branch: &str,
    expected_tip: git2::Oid,
) -> Result<Result<CapturedBranch, GitActionResult>, AppError> {
    // Do not retain libgit2 handles across awaits.
    let captured = {
        let repo = git2::Repository::open(path).map_err(|e| AppError::Git(e.message().into()))?;
        match snapshot_branch(&repo) {
            Ok(captured) => captured,
            Err(RewriteFailure::Error(error)) => return Err(error),
            Err(RewriteFailure::Block(reason, message)) => {
                let mut action =
                    GitActionResult::blocked(reason, message, "check out a local branch");
                action.branch = Some(expected_branch.to_string());
                return Ok(Err(action));
            }
        }
    };
    let block = |reason, message: String, recommendation: &str| {
        let mut action = GitActionResult::blocked(reason, message, recommendation);
        action.branch = Some(captured.branch.clone());
        Ok(Err(action))
    };
    if captured.branch != expected_branch || captured.old_tip != expected_tip {
        return block(
            GitBlockReason::StaleRef,
            format!("expected branch/head ({expected_branch} at {expected_tip}) differs from current ({} at {})", captured.branch, captured.old_tip),
            "refresh branch history and review the selection again",
        );
    }
    if let Some(recovery) = cli_fallback::active_git_operation(path).await? {
        let mut action = GitActionResult::blocked(
            GitBlockReason::ActiveOperation,
            "another Git operation is already in progress",
            "finish or abort the in-progress operation before rewriting history",
        );
        action.recovery = Some(recovery);
        action.branch = Some(captured.branch);
        return Ok(Err(action));
    }
    let current_root = dunce::canonicalize(path)?;
    for wt in cli_fallback::list_worktrees(path).await? {
        let branch_matches = wt.branch == captured.branch
            || Some(wt.branch.as_str()) == captured.branch.strip_prefix("refs/heads/");
        if branch_matches && dunce::canonicalize(&wt.path)? != current_root {
            return block(
                GitBlockReason::CheckedOutBranch,
                format!(
                    "branch {} is checked out in another worktree at {}",
                    captured.branch, wt.path
                ),
                "switch branches in the other worktree first",
            );
        }
    }
    // Resolve before reopening libgit2: async handlers must remain Send.
    let graft_path =
        cli_fallback::run_git(&["rev-parse", "--git-path", "info/grafts"], path).await?;
    let shallow = cli_fallback::run_git(&["rev-parse", "--is-shallow-repository"], path).await?;
    if !matches!(shallow.trim(), "true" | "false") {
        return Err(AppError::Git(
            "could not establish whether repository history is shallow".into(),
        ));
    }
    let repo = git2::Repository::open(path).map_err(|e| AppError::Git(e.message().into()))?;
    // CLI recovery metadata covers only a subset of sequencer states. Revert,
    // bisect and other pending operations must still block object-only rewrites.
    let operation_state = repo.state();
    if operation_state != git2::RepositoryState::Clean {
        return block(
            GitBlockReason::ActiveOperation,
            format!("another Git operation is in progress: {operation_state:?}"),
            "finish or abort the active Git operation before rewriting history",
        );
    }
    let mut refs = repo
        .references_glob("refs/replace/*")
        .map_err(|e| AppError::Git(e.message().into()))?;
    if let Some(reference) = refs.next() {
        reference.map_err(|e| AppError::Git(e.message().into()))?;
        return block(
            GitBlockReason::UnsupportedHistory,
            "git replace refs are active".into(),
            "remove replace refs before rewriting history",
        );
    }
    let graft_path = path.join(graft_path.trim());
    match std::fs::read(&graft_path) {
        Ok(bytes) if bytes.iter().any(|b| !b.is_ascii_whitespace()) => {
            return block(
                GitBlockReason::UnsupportedHistory,
                "git grafts file is present".into(),
                "convert grafts to proper commits before rewriting history",
            );
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    if shallow.trim() == "true" {
        return block(
            GitBlockReason::UnsupportedHistory,
            "shallow history cannot be rewritten".into(),
            "unshallow the repository before rewriting history",
        );
    }
    Ok(Ok(captured))
}

pub(super) fn validate_utf8_message<'a>(parsed: &RawCommit<'a>) -> Result<&'a str, RewriteFailure> {
    for block in &parsed.headers {
        if block.key == b"encoding"
            && !std::str::from_utf8(block.raw.strip_prefix(b"encoding ").unwrap_or(&[]))
                .is_ok_and(|encoding| encoding.trim().eq_ignore_ascii_case("UTF-8"))
        {
            return Err(RewriteFailure::Block(
                GitBlockReason::UnsupportedHistory,
                "selected commit declares a non-UTF-8 or malformed encoding".into(),
            ));
        }
    }
    std::str::from_utf8(parsed.message).map_err(|_| {
        RewriteFailure::Block(
            GitBlockReason::UnsupportedHistory,
            "selected commit message is not valid UTF-8".into(),
        )
    })
}

pub(super) fn affected_closure(nodes: &[CommitNode<'_>], anchor: git2::Oid) -> HashSet<git2::Oid> {
    let mut affected = HashSet::new();
    for node in nodes {
        if node.oid == anchor || node.parents.iter().any(|p| affected.contains(p)) {
            affected.insert(node.oid);
        }
    }
    affected
}

pub(super) fn signature_removals(
    nodes: &[CommitNode<'_>],
    affected: &HashSet<git2::Oid>,
) -> Result<HashMap<git2::Oid, Vec<usize>>, RewriteFailure> {
    let mut removals = HashMap::new();
    for node in nodes.iter().filter(|node| affected.contains(&node.oid)) {
        let parsed = parse_raw_commit(node.raw_object.data())?;
        let mut indices = Vec::new();
        for (index, block) in parsed.headers.iter().enumerate() {
            if block.key == b"gpgsig" || block.key == b"gpgsig-sha256" {
                indices.push(index);
            } else if block.key == b"mergetag" {
                let tag = parse_mergetag_block(block.raw)?;
                if !node.parents.contains(&tag.object_oid) {
                    return Err(RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        format!(
                            "mergetag object {} is not a parent of {}",
                            tag.object_oid, node.oid
                        ),
                    ));
                }
                if affected.contains(&tag.object_oid) {
                    indices.push(index);
                }
            }
        }
        if !indices.is_empty() {
            removals.insert(node.oid, indices);
        }
    }
    Ok(removals)
}

/// Retrieves the raw UTF-8 commit message along with the current symbolic branch and tip OID.
/// Reads immutable commit data against a lock-free branch snapshot; mutations revalidate under locks.
pub fn get_commit_message(
    project_path: &Path,
    hash: &str,
) -> Result<CommitMessageSnapshot, AppError> {
    let repo = git2::Repository::open(project_path)
        .map_err(|e| AppError::Git(format!("failed to open repository: {}", e.message())))?;

    let target_oid = git2::Oid::from_str(hash)
        .map_err(|e| AppError::InvalidInput(format!("invalid commit hash '{hash}': {e}")))?;

    // Readers must not contend for write locks: squash loads multiple messages concurrently.
    let head = repo.head().map_err(|e| {
        AppError::Git(format!(
            "cannot inspect checked-out branch: {}",
            e.message()
        ))
    })?;
    let branch = head
        .name()
        .filter(|name| head.is_branch() && name.starts_with("refs/heads/"))
        .ok_or_else(|| {
            AppError::Git("commit messages require a checked-out local branch".into())
        })?;
    let old_tip = head
        .target()
        .ok_or_else(|| AppError::Git("checked-out branch has no direct tip OID".into()))?;
    let captured = CapturedBranch {
        branch: branch.to_string(),
        old_tip,
    };

    let odb = repo.odb().map_err(|e| AppError::Git(e.message().into()))?;
    let raw_object = odb
        .read(target_oid)
        .map_err(|e| AppError::Git(format!("target commit {hash} not found: {}", e.message())))?;
    if raw_object.kind() != git2::ObjectType::Commit {
        return Err(AppError::Git(format!("target {hash} is not a commit")));
    }

    let is_reachable = if captured.old_tip == target_oid {
        true
    } else {
        repo.graph_descendant_of(captured.old_tip, target_oid)
            .unwrap_or(false)
    };

    if !is_reachable {
        return Err(AppError::Git(format!(
            "target commit {hash} is not reachable from branch tip {}",
            captured.old_tip
        )));
    }

    let read_error = |failure| match failure {
        RewriteFailure::Error(error) => error,
        RewriteFailure::Block(_, message) => AppError::Git(message),
    };
    let parsed = parse_raw_commit(raw_object.data()).map_err(read_error)?;
    // libgit2's message getters prettify leading LF and use NUL-terminated strings.
    // The object body is the source of truth for the editable full-message draft.
    let message_str = validate_utf8_message(&parsed).map_err(read_error)?;

    let observed = repo
        .find_reference("HEAD")
        .map_err(|e| AppError::Git(e.message().into()))?;
    let observed_tip = repo
        .find_reference(&captured.branch)
        .map_err(|e| AppError::Git(e.message().into()))?
        .target();
    if observed.symbolic_target() != Some(captured.branch.as_str())
        || observed_tip != Some(captured.old_tip)
    {
        return Err(AppError::Git(
            "branch changed while reading commit message; refresh history".into(),
        ));
    }

    Ok(CommitMessageSnapshot {
        message: message_str.to_string(),
        branch: captured.branch,
        head_oid: captured.old_tip.to_string(),
    })
}

/// Rewrites a commit message locally using raw object plumbing without touching worktree or index.
pub async fn edit_commit_message(
    project_path: &Path,
    hash: &str,
    message: &str,
    expected_branch: &str,
    expected_head_oid: &str,
    allow_signature_removal: bool,
) -> Result<GitActionResult, AppError> {
    let normalized_message = normalize_message(message)?;
    let expected_tip = validate_expected_snapshot(expected_branch, expected_head_oid)?;

    let target_oid = git2::Oid::from_str(hash)
        .map_err(|e| AppError::InvalidInput(format!("invalid target commit hash '{hash}': {e}")))?;

    let captured = match mutation_preflight(project_path, expected_branch, expected_tip).await? {
        Ok(captured) => captured,
        Err(mut action) => {
            action.hash = Some(hash.to_string());
            return Ok(action);
        }
    };

    let project_path_buf = project_path.to_path_buf();
    let hash_string = hash.to_string();
    let captured_clone = captured.clone();

    enum SyncRewriteOutcome {
        Action(GitActionResult),
        Done {
            new_target_oid: git2::Oid,
            new_tip_oid: git2::Oid,
            rewritten_count: usize,
            signatures_removed: bool,
        },
    }

    let outcome = tokio::task::spawn_blocking(move || -> Result<SyncRewriteOutcome, AppError> {
        let repo = git2::Repository::open(&project_path_buf)
            .map_err(|e| AppError::Git(e.message().to_string()))?;
        let odb = repo
            .odb()
            .map_err(|e| AppError::Git(e.message().to_string()))?;

        // Collect all commits reachable from tip in parent-first order
        let nodes = match collect_parent_first(&repo, &odb, captured_clone.old_tip) {
            Ok(nodes) => nodes,
            Err(RewriteFailure::Block(reason, msg)) => {
                let mut res = GitActionResult::blocked(reason, msg, "");
                res.hash = Some(hash_string);
                res.branch = Some(captured_clone.branch);
                return Ok(SyncRewriteOutcome::Action(res));
            }
            Err(RewriteFailure::Error(err)) => return Err(err),
        };

        // Ensure target is in reachable nodes
        if !nodes.iter().any(|n| n.oid == target_oid) {
            let mut res = GitActionResult::blocked(
                GitBlockReason::UnreachableCommit,
                format!("commit {target_oid} is not reachable from HEAD"),
                "check out the branch that contains this commit first",
            );
            res.hash = Some(hash_string);
            res.branch = Some(captured_clone.branch);
            return Ok(SyncRewriteOutcome::Action(res));
        }

        // Plan rewrite
        let plan = match plan_rewrite(&nodes, target_oid, normalized_message) {
            Ok(p) => p,
            Err(RewriteFailure::Block(reason, msg)) => {
                let mut res = GitActionResult::blocked(reason, msg, "");
                res.hash = Some(hash_string);
                res.branch = Some(captured_clone.branch);
                return Ok(SyncRewriteOutcome::Action(res));
            }
            Err(RewriteFailure::Error(err)) => return Err(err),
        };

        // No-op check
        if plan.no_op {
            let mut res = GitActionResult::ok(format!(
                "Commit message unchanged for {}",
                &hash_string[..7.min(hash_string.len())]
            ));
            res.hash = Some(target_oid.to_string());
            res.branch = Some(captured_clone.branch);
            res.old_target_oid = Some(target_oid.to_string());
            res.new_target_oid = Some(target_oid.to_string());
            res.old_head_oid = Some(captured_clone.old_tip.to_string());
            res.new_head_oid = Some(captured_clone.old_tip.to_string());
            res.rewritten_count = Some(0);
            res.no_op = Some(true);
            res.signatures_removed = Some(false);
            return Ok(SyncRewriteOutcome::Action(res));
        }

        // Consent check before writing any objects
        let signatures_need_removal = required_removals(&plan);
        if signatures_need_removal && !allow_signature_removal {
            let mut res = GitActionResult::blocked(
                GitBlockReason::SignatureConsentRequired,
                "rewriting this commit invalidates cryptographic signatures; consent required to remove them",
                "set allowSignatureRemoval=true to confirm removal of invalidated signatures",
            );
            res.hash = Some(hash_string);
            res.branch = Some(captured_clone.branch);
            return Ok(SyncRewriteOutcome::Action(res));
        }

        // Write replacement commit objects in parent-first order
        let mut changed_map: HashMap<git2::Oid, git2::Oid> = HashMap::new();
        for node in &nodes {
            if !plan.affected_set.contains(&node.oid) {
                continue;
            }

            let mapped_parents: Vec<git2::Oid> = node
                .parents
                .iter()
                .map(|p| changed_map.get(p).copied().unwrap_or(*p))
                .collect();

            let new_msg = if node.oid == target_oid {
                Some(plan.normalized_message.as_slice())
            } else {
                None
            };

            let removable = plan
                .removable_headers
                .get(&node.oid)
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

            let payload = match rewrite_bytes(node, &mapped_parents, new_msg, removable, None, None) {
                Ok(bytes) => bytes,
                Err(RewriteFailure::Block(reason, msg)) => {
                    let mut res = GitActionResult::blocked(reason, msg, "");
                    res.hash = Some(hash_string);
                    res.branch = Some(captured_clone.branch);
                    return Ok(SyncRewriteOutcome::Action(res));
                }
                Err(RewriteFailure::Error(err)) => return Err(err),
            };

            let new_oid = odb
                .write(git2::ObjectType::Commit, &payload)
                .map_err(|e| AppError::Git(format!("failed to write commit object to ODB: {e}")))?;

            changed_map.insert(node.oid, new_oid);
        }

        let new_target_oid = match changed_map.get(&target_oid) {
            Some(&oid) => oid,
            None => {
                return Err(AppError::Git(
                    "target commit was not rewritten in changed_map".to_string(),
                ));
            }
        };

        let new_tip_oid = match changed_map.get(&captured_clone.old_tip) {
            Some(&oid) => oid,
            None => {
                return Err(AppError::Git(
                    "tip commit was not rewritten in changed_map".to_string(),
                ));
            }
        };

        // Verify that the new tip commit tree matches the captured tip commit tree
        let old_tip_commit = repo.find_commit(captured_clone.old_tip).map_err(|e| {
            AppError::Git(format!("failed to find old tip commit: {e}"))
        })?;
        let new_tip_commit = repo.find_commit(new_tip_oid).map_err(|e| {
            AppError::Git(format!("failed to find rewritten tip commit: {e}"))
        })?;

        if old_tip_commit.tree_id() != new_tip_commit.tree_id() {
            return Err(AppError::Git(format!(
                "rewritten tip tree {} does not match captured tip tree {}",
                new_tip_commit.tree_id(),
                old_tip_commit.tree_id(),
            )));
        }

        // Publish checked ref using git2 transaction
        match publish_checked_ref(&repo, &captured_clone, new_tip_oid, "edit commit message") {
            Ok(()) => {}
            Err(RewriteFailure::Block(reason, msg)) => {
                let mut res = GitActionResult::blocked(reason, msg, "");
                res.hash = Some(hash_string);
                res.branch = Some(captured_clone.branch);
                return Ok(SyncRewriteOutcome::Action(res));
            }
            Err(RewriteFailure::Error(err)) => return Err(err),
        }

        Ok(SyncRewriteOutcome::Done {
            new_target_oid,
            new_tip_oid,
            rewritten_count: changed_map.len(),
            signatures_removed: signatures_need_removal,
        })
    })
    .await
    .map_err(|join_err| AppError::Internal(format!("blocking git rewrite task failed: {join_err}")))?;

    let (new_target_oid, new_tip_oid, rewritten_count, signatures_removed) = match outcome? {
        SyncRewriteOutcome::Action(res) => return Ok(res),
        SyncRewriteOutcome::Done {
            new_target_oid,
            new_tip_oid,
            rewritten_count,
            signatures_removed,
        } => (
            new_target_oid,
            new_tip_oid,
            rewritten_count,
            signatures_removed,
        ),
    };

    let mut res = GitActionResult::ok(format!(
        "Edited commit message for {}",
        &hash[..7.min(hash.len())]
    ));
    res.hash = Some(new_target_oid.to_string());
    res.branch = Some(captured.branch);
    res.old_target_oid = Some(target_oid.to_string());
    res.new_target_oid = Some(new_target_oid.to_string());
    res.old_head_oid = Some(captured.old_tip.to_string());
    res.new_head_oid = Some(new_tip_oid.to_string());
    res.rewritten_count = Some(rewritten_count);
    res.no_op = Some(false);
    res.signatures_removed = Some(signatures_removed);
    Ok(res)
}

/// Takes a snapshot of the current symbolic branch and its direct tip OID under git2 transaction locks.
pub(super) fn snapshot_branch(repo: &git2::Repository) -> Result<CapturedBranch, RewriteFailure> {
    let mut tx = repo.transaction().map_err(|e| {
        RewriteFailure::Error(AppError::Git(format!(
            "failed to create git transaction: {e}"
        )))
    })?;

    let head = repo.find_reference("HEAD").map_err(|e| {
        RewriteFailure::Block(
            GitBlockReason::DetachedHead,
            format!("cannot inspect HEAD reference: {}", e.message()),
        )
    })?;

    let branch_name = match head.symbolic_target() {
        Some(name) if name.starts_with("refs/heads/") => name.to_string(),
        _ => {
            return Err(RewriteFailure::Block(
                GitBlockReason::DetachedHead,
                "history rewrite requires a checked-out local branch under refs/heads/".to_string(),
            ));
        }
    };

    tx.lock_ref("HEAD")
        .map_err(|e| RewriteFailure::Error(AppError::Git(format!("failed to lock HEAD: {e}"))))?;
    tx.lock_ref(&branch_name).map_err(|e| {
        RewriteFailure::Error(AppError::Git(format!(
            "failed to lock branch {branch_name}: {e}"
        )))
    })?;

    let head_under_lock = repo.find_reference("HEAD")?;
    if head_under_lock.symbolic_target() != Some(&branch_name) {
        return Err(RewriteFailure::Block(
            GitBlockReason::StaleRef,
            format!(
                "symbolic HEAD target changed during snapshot lock acquisition (expected {branch_name}, observed {:?})",
                head_under_lock.symbolic_target()
            ),
        ));
    }

    let branch_ref = repo.find_reference(&branch_name).map_err(|e| {
        RewriteFailure::Block(
            GitBlockReason::DetachedHead,
            format!(
                "cannot inspect branch reference {branch_name}: {}",
                e.message()
            ),
        )
    })?;

    let old_tip = branch_ref.target().ok_or_else(|| {
        RewriteFailure::Block(
            GitBlockReason::DetachedHead,
            format!("branch {branch_name} has no direct target OID (unborn branch)"),
        )
    })?;

    // Transaction is dropped here without commit, releasing locks safely.
    Ok(CapturedBranch {
        branch: branch_name,
        old_tip,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DfsState {
    Visiting,
    Visited,
}

/// Performs iterative DFS from tip following all parent OIDs in order, returning nodes in parent-first order.
pub(super) fn collect_parent_first<'odb>(
    repo: &git2::Repository,
    odb: &'odb git2::Odb<'_>,
    tip: git2::Oid,
) -> Result<Vec<CommitNode<'odb>>, RewriteFailure> {
    let mut visit_state: HashMap<git2::Oid, DfsState> = HashMap::new();
    let mut node_map: HashMap<git2::Oid, (git2::Oid, Vec<git2::Oid>, git2::OdbObject<'odb>)> =
        HashMap::new();
    let mut post_order: Vec<git2::Oid> = Vec::new();

    // Stack holds (oid, parents, next_parent_index)
    let mut stack: Vec<(git2::Oid, Vec<git2::Oid>, usize)> = Vec::new();

    let tip_obj = match odb.read(tip) {
        Ok(obj) => obj,
        Err(_) => {
            return Err(RewriteFailure::Block(
                GitBlockReason::UnsupportedHistory,
                format!("missing object or shallow boundary at tip {tip}"),
            ));
        }
    };
    if tip_obj.kind() != git2::ObjectType::Commit {
        return Err(RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            format!("object {tip} is not a commit"),
        ));
    }
    let tip_parsed = parse_raw_commit(tip_obj.data())?;
    cross_check_commit_node(repo, tip, tip_parsed.tree_oid, &tip_parsed.parents)?;

    let tip_parents = tip_parsed.parents.clone();
    let tip_tree = tip_parsed.tree_oid;
    node_map.insert(tip, (tip_tree, tip_parents.clone(), tip_obj));
    visit_state.insert(tip, DfsState::Visiting);
    stack.push((tip, tip_parents, 0));

    while let Some((_curr_oid, parents, next_idx)) = stack.last_mut() {
        if *next_idx < parents.len() {
            let parent_oid = parents[*next_idx];
            *next_idx += 1;

            match visit_state.get(&parent_oid) {
                Some(DfsState::Visiting) => {
                    return Err(RewriteFailure::Block(
                        GitBlockReason::UnsupportedHistory,
                        format!("cycle detected in commit graph at {parent_oid}"),
                    ));
                }
                Some(DfsState::Visited) => {
                    // Already processed
                    continue;
                }
                None => {
                    let parent_obj = match odb.read(parent_oid) {
                        Ok(obj) => obj,
                        Err(_) => {
                            return Err(RewriteFailure::Block(
                                GitBlockReason::UnsupportedHistory,
                                format!(
                                    "missing object or shallow boundary at parent {parent_oid}"
                                ),
                            ));
                        }
                    };
                    if parent_obj.kind() != git2::ObjectType::Commit {
                        return Err(RewriteFailure::Block(
                            GitBlockReason::InvalidCommitMetadata,
                            format!("object {parent_oid} is not a commit"),
                        ));
                    }
                    let parent_parsed = parse_raw_commit(parent_obj.data())?;
                    cross_check_commit_node(
                        repo,
                        parent_oid,
                        parent_parsed.tree_oid,
                        &parent_parsed.parents,
                    )?;

                    let p_parents = parent_parsed.parents.clone();
                    let p_tree = parent_parsed.tree_oid;
                    node_map.insert(parent_oid, (p_tree, p_parents.clone(), parent_obj));
                    visit_state.insert(parent_oid, DfsState::Visiting);
                    stack.push((parent_oid, p_parents, 0));
                }
            }
        } else {
            let (finished_oid, _, _) = stack.pop().unwrap();
            visit_state.insert(finished_oid, DfsState::Visited);
            post_order.push(finished_oid);
        }
    }

    let mut result = Vec::with_capacity(post_order.len());
    for oid in post_order {
        if let Some((tree_oid, parents, raw_object)) = node_map.remove(&oid) {
            result.push(CommitNode {
                oid,
                tree_oid,
                parents,
                raw_object,
            });
        }
    }

    Ok(result)
}

fn cross_check_commit_node(
    repo: &git2::Repository,
    oid: git2::Oid,
    tree_oid: git2::Oid,
    parents: &[git2::Oid],
) -> Result<(), RewriteFailure> {
    let commit = repo.find_commit(oid).map_err(|e| {
        RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            format!(
                "cannot inspect commit {oid} through libgit2: {}",
                e.message()
            ),
        )
    })?;

    if commit.tree_id() != tree_oid {
        return Err(RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            format!(
                "raw tree OID {tree_oid} does not match parsed libgit2 tree OID {}",
                commit.tree_id()
            ),
        ));
    }

    if commit.parent_count() != parents.len() {
        return Err(RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            format!(
                "raw parent count {} does not match parsed libgit2 parent count {}",
                parents.len(),
                commit.parent_count()
            ),
        ));
    }

    for (idx, &expected_p) in parents.iter().enumerate() {
        let actual_p = commit.parent_id(idx).map_err(|e| {
            RewriteFailure::Block(
                GitBlockReason::InvalidCommitMetadata,
                format!("failed to read parent {idx} of {oid}: {}", e.message()),
            )
        })?;
        if actual_p != expected_p {
            return Err(RewriteFailure::Block(
                GitBlockReason::InvalidCommitMetadata,
                format!(
                    "parent mismatch at position {idx} in {oid}: raw={expected_p}, libgit2={actual_p}"
                ),
            ));
        }
    }

    Ok(())
}

/// Parses the raw commit object up to the first `\n\n` into logical header blocks and message payload.
pub(super) fn parse_raw_commit(raw: &[u8]) -> Result<RawCommit<'_>, RewriteFailure> {
    let sep_idx = match raw.windows(2).position(|w| w == b"\n\n") {
        Some(pos) => pos,
        None => {
            return Err(RewriteFailure::Block(
                GitBlockReason::InvalidCommitMetadata,
                "malformed commit object: missing header/body separator".to_string(),
            ));
        }
    };

    let header_bytes = &raw[..sep_idx + 1]; // includes last header line's trailing LF
    let message_bytes = &raw[sep_idx + 2..];

    let mut headers = Vec::new();
    let mut current_block_start = 0;
    let mut current_key: Option<&[u8]> = None;
    let mut cursor = 0;

    while cursor < header_bytes.len() {
        let next_nl = match header_bytes[cursor..].iter().position(|&b| b == b'\n') {
            Some(pos) => cursor + pos,
            None => header_bytes.len(),
        };
        let line = &header_bytes[cursor..next_nl];
        if line.starts_with(b" ") {
            if current_key.is_none() {
                return Err(RewriteFailure::Block(
                    GitBlockReason::InvalidCommitMetadata,
                    "malformed commit header: orphan continuation line".to_string(),
                ));
            }
        } else {
            if let Some(key) = current_key {
                headers.push(RawHeaderBlock {
                    key,
                    raw: &header_bytes[current_block_start..cursor],
                });
            }
            current_block_start = cursor;
            let space_pos = match line.iter().position(|&b| b == b' ') {
                Some(pos) => pos,
                None => {
                    return Err(RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        "malformed commit header: line missing key/value space separator"
                            .to_string(),
                    ));
                }
            };
            current_key = Some(&line[..space_pos]);
        }
        cursor = next_nl + 1;
    }
    if let Some(key) = current_key {
        headers.push(RawHeaderBlock {
            key,
            raw: &header_bytes[current_block_start..header_bytes.len()],
        });
    }

    if headers.is_empty() || headers[0].key != b"tree" {
        return Err(RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            "malformed commit header: first header block must be 'tree'".to_string(),
        ));
    }

    let mut tree_count = 0;
    let mut tree_oid_opt = None;
    let mut parents = Vec::new();
    let mut has_author = false;
    let mut has_committer = false;

    for block in &headers {
        match block.key {
            b"tree" => {
                tree_count += 1;
                if tree_count > 1 {
                    return Err(RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        "malformed commit header: duplicate tree headers".to_string(),
                    ));
                }
                let line_str = std::str::from_utf8(block.raw).map_err(|_| {
                    RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        "tree header is not valid ASCII/UTF-8".to_string(),
                    )
                })?;
                let val = line_str.trim_start_matches("tree").trim();
                let oid = git2::Oid::from_str(val).map_err(|e| {
                    RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        format!("invalid tree OID in commit header '{val}': {e}"),
                    )
                })?;
                tree_oid_opt = Some(oid);
            }
            b"parent" => {
                let line_str = std::str::from_utf8(block.raw).map_err(|_| {
                    RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        "parent header is not valid ASCII/UTF-8".to_string(),
                    )
                })?;
                let val = line_str.trim_start_matches("parent").trim();
                let oid = git2::Oid::from_str(val).map_err(|e| {
                    RewriteFailure::Block(
                        GitBlockReason::InvalidCommitMetadata,
                        format!("invalid parent OID in commit header '{val}': {e}"),
                    )
                })?;
                parents.push(oid);
            }
            b"author" => has_author = true,
            b"committer" => has_committer = true,
            _ => {}
        }
    }

    if !has_author || !has_committer {
        return Err(RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            "malformed commit header: missing mandatory author or committer".to_string(),
        ));
    }

    let tree_oid = tree_oid_opt.ok_or_else(|| {
        RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            "missing tree header in commit".to_string(),
        )
    })?;

    Ok(RawCommit {
        tree_oid,
        parents,
        headers,
        message: message_bytes,
    })
}

/// Extracts embedded tag payload from mergetag block and validates referenced object OID.
fn parse_mergetag_block(raw: &[u8]) -> Result<MergetagInfo, RewriteFailure> {
    let mut payload = Vec::new();
    for (i, line) in raw.split(|&b| b == b'\n').enumerate() {
        if line.is_empty() {
            continue;
        }
        if i == 0 {
            if line.starts_with(b"mergetag ") {
                payload.extend_from_slice(&line[9..]);
                payload.push(b'\n');
            } else if line == b"mergetag" {
                // empty first line
            } else {
                return Err(RewriteFailure::Block(
                    GitBlockReason::InvalidCommitMetadata,
                    "malformed mergetag header block".to_string(),
                ));
            }
        } else {
            if line.starts_with(b" ") {
                payload.extend_from_slice(&line[1..]);
                payload.push(b'\n');
            } else {
                return Err(RewriteFailure::Block(
                    GitBlockReason::InvalidCommitMetadata,
                    "malformed mergetag continuation line: missing leading space".to_string(),
                ));
            }
        }
    }

    // Parse tag headers up to first \n\n in tag payload
    let sep = payload
        .windows(2)
        .position(|w| w == b"\n\n")
        .unwrap_or(payload.len());
    let tag_header_bytes = &payload[..sep];

    let mut object_oid_opt = None;
    let mut type_count = 0;
    let mut is_commit_type = false;

    for line in tag_header_bytes.split(|&b| b == b'\n') {
        if line.starts_with(b"object ") {
            if object_oid_opt.is_some() {
                return Err(RewriteFailure::Block(
                    GitBlockReason::InvalidCommitMetadata,
                    "mergetag has duplicate object headers".into(),
                ));
            }
            let oid_str = std::str::from_utf8(&line[7..]).map_err(|_| {
                RewriteFailure::Block(
                    GitBlockReason::InvalidCommitMetadata,
                    "mergetag object field is not valid UTF-8".to_string(),
                )
            })?;
            let oid = exact_oid(oid_str.trim(), "mergetag object").map_err(|e| {
                RewriteFailure::Block(GitBlockReason::InvalidCommitMetadata, e.to_string())
            })?;
            object_oid_opt = Some(oid);
        } else if line.starts_with(b"type ") {
            type_count += 1;
            let type_str = std::str::from_utf8(&line[5..]).unwrap_or("").trim();
            if type_str == "commit" {
                is_commit_type = true;
            }
        }
    }

    let object_oid = object_oid_opt.ok_or_else(|| {
        RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            "mergetag missing 'object <OID>' header".to_string(),
        )
    })?;

    if !is_commit_type || type_count != 1 {
        return Err(RewriteFailure::Block(
            GitBlockReason::InvalidCommitMetadata,
            "mergetag does not specify 'type commit'".to_string(),
        ));
    }

    Ok(MergetagInfo { object_oid })
}

/// Identifies the affected commit closure, validates target encoding, checks no-op, and precomputes removable headers.
fn plan_rewrite(
    nodes: &[CommitNode<'_>],
    target: git2::Oid,
    normalized_message: Vec<u8>,
) -> Result<RewritePlan, RewriteFailure> {
    let target_node = nodes.iter().find(|n| n.oid == target).ok_or_else(|| {
        RewriteFailure::Block(
            GitBlockReason::UnreachableCommit,
            format!("target commit {target} not found in nodes"),
        )
    })?;

    let target_parsed = parse_raw_commit(target_node.raw_object.data())?;

    validate_utf8_message(&target_parsed)?;

    if target_parsed.message == normalized_message.as_slice() {
        return Ok(RewritePlan {
            affected_set: HashSet::new(),
            _target_oid: target,
            normalized_message,
            removable_headers: HashMap::new(),
            no_op: true,
        });
    }

    let affected_set = affected_closure(nodes, target);
    let removable_headers = signature_removals(nodes, &affected_set)?;

    Ok(RewritePlan {
        affected_set,
        _target_oid: target,
        normalized_message,
        removable_headers,
        no_op: false,
    })
}

fn required_removals(plan: &RewritePlan) -> bool {
    !plan.removable_headers.is_empty()
}

/// Constructs the raw commit object bytes for an affected node with mapped parents and updated message.
pub(super) fn rewrite_bytes(
    node: &CommitNode<'_>,
    mapped_parents: &[git2::Oid],
    new_message: Option<&[u8]>,
    removable_header_indices: &[usize],
    new_tree: Option<git2::Oid>,
    new_committer: Option<&[u8]>,
) -> Result<Vec<u8>, RewriteFailure> {
    let parsed = parse_raw_commit(node.raw_object.data())?;
    let header_len: usize = parsed
        .headers
        .iter()
        .enumerate()
        .filter(|(index, _)| !removable_header_indices.contains(index))
        .map(|(_, block)| match block.key {
            b"parent" => 48,
            b"tree" if new_tree.is_some() => 46,
            b"committer" if new_committer.is_some() => new_committer.unwrap().len(),
            _ => block.raw.len(),
        })
        .sum();
    let mut out = Vec::with_capacity(header_len + 1 + new_message.unwrap_or(parsed.message).len());
    let mut parent_idx = 0;

    for (i, block) in parsed.headers.iter().enumerate() {
        if removable_header_indices.contains(&i) {
            continue;
        }

        if block.key == b"parent" {
            if parent_idx >= mapped_parents.len() {
                return Err(RewriteFailure::Block(
                    GitBlockReason::InvalidCommitMetadata,
                    "parent index out of bounds during serialization".to_string(),
                ));
            }
            let new_parent = mapped_parents[parent_idx];
            parent_idx += 1;
            let _ = write!(&mut out, "parent {new_parent}\n");
        } else if block.key == b"tree" && new_tree.is_some() {
            let _ = writeln!(&mut out, "tree {}", new_tree.unwrap());
        } else if block.key == b"committer" && new_committer.is_some() {
            out.extend_from_slice(new_committer.unwrap());
        } else {
            out.extend_from_slice(block.raw);
        }
    }

    out.extend_from_slice(b"\n");

    match new_message {
        Some(msg) => out.extend_from_slice(msg),
        None => out.extend_from_slice(parsed.message),
    }

    Ok(out)
}

// Fault injection is thread-local and compiled only in unit tests. Production always commits.
#[cfg(test)]
thread_local! {
    static FAIL_PUBLICATION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
pub(super) fn inject_publication_failure() {
    FAIL_PUBLICATION.with(|flag| flag.set(true));
}

#[cfg(test)]
pub(super) fn take_publication_failure() -> bool {
    FAIL_PUBLICATION.with(|flag| flag.replace(false))
}

struct IndexLockGuard {
    path: PathBuf,
    _file: File,
}

impl IndexLockGuard {
    fn acquire(repo: &git2::Repository) -> Result<Self, RewriteFailure> {
        let path = repo.path().join("index.lock");
        let file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(RewriteFailure::Block(
                    GitBlockReason::ActiveOperation,
                    "repository index is locked by another Git operation".into(),
                ));
            }
            Err(error) => {
                return Err(RewriteFailure::Error(AppError::Git(format!(
                    "failed to lock repository index {}: {error}",
                    path.display()
                ))));
            }
        };
        Ok(Self { path, _file: file })
    }
}

impl Drop for IndexLockGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn commit_transaction(tx: git2::Transaction<'_>) -> Result<(), git2::Error> {
    #[cfg(test)]
    if take_publication_failure() {
        return Err(git2::Error::from_str("injected transaction commit failure"));
    }
    tx.commit()
}

/// Publishes the rewritten tip to the captured branch ref using git2's two-lock/one-ref-write transaction.
pub(super) fn publish_checked_ref(
    repo: &git2::Repository,
    captured: &CapturedBranch,
    new_tip: git2::Oid,
    reflog_message: &str,
) -> Result<(), RewriteFailure> {
    // Git worktree mutations conventionally take index.lock before updating refs.
    // Hold it through the final CAS so an external sequencer cannot enter between
    // the earlier preflight and publication while HEAD/branch still look unchanged.
    let _index_lock = IndexLockGuard::acquire(repo)?;
    let mut tx = repo.transaction().map_err(|e| {
        RewriteFailure::Error(AppError::Git(format!(
            "failed to create git transaction: {e}"
        )))
    })?;

    tx.lock_ref("HEAD")
        .map_err(|e| RewriteFailure::Error(AppError::Git(format!("failed to lock HEAD: {e}"))))?;
    tx.lock_ref(&captured.branch).map_err(|e| {
        RewriteFailure::Error(AppError::Git(format!(
            "failed to lock branch {}: {e}",
            captured.branch
        )))
    })?;

    let operation_state = repo.state();
    if operation_state != git2::RepositoryState::Clean {
        return Err(RewriteFailure::Block(
            GitBlockReason::ActiveOperation,
            format!("another Git operation started before publication: {operation_state:?}"),
        ));
    }

    let head = repo
        .find_reference("HEAD")
        .map_err(|e| RewriteFailure::Error(AppError::Git(format!("failed to find HEAD: {e}"))))?;
    if head.symbolic_target() != Some(&captured.branch) {
        return Err(RewriteFailure::Block(
            GitBlockReason::StaleRef,
            "symbolic HEAD target changed before ref write".to_string(),
        ));
    }

    let branch = repo.find_reference(&captured.branch).map_err(|e| {
        RewriteFailure::Error(AppError::Git(format!(
            "failed to find branch {}: {e}",
            captured.branch
        )))
    })?;
    if branch.target() != Some(captured.old_tip) {
        return Err(RewriteFailure::Block(
            GitBlockReason::StaleRef,
            "branch tip changed before ref write".to_string(),
        ));
    }

    tx.set_target(&captured.branch, new_tip, None, reflog_message)
        .map_err(|e| {
            RewriteFailure::Error(AppError::Git(format!(
                "failed to set target on {}: {e}",
                captured.branch
            )))
        })?;

    match commit_transaction(tx) {
        Ok(()) => Ok(()),
        Err(e) => {
            let head_obs = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(|s| s.to_string()));
            let branch_obs = repo
                .find_reference(&captured.branch)
                .ok()
                .and_then(|r| r.target().map(|o| o.to_string()));
            Err(RewriteFailure::Block(
                GitBlockReason::PublicationUncertain,
                format!(
                    "git transaction commit failed: {e}; original branch={} original tip={} candidate tip={new_tip}; observed HEAD={head_obs:?}, branch={branch_obs:?}",
                    captured.branch, captured.old_tip
                ),
            ))
        }
    }
}
