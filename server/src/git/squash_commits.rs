use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::Path;

use super::commit_message_rewrite::{
    affected_closure, collect_parent_first, exact_oid, mutation_preflight, normalize_message,
    parse_raw_commit, publish_checked_ref, rewrite_bytes, signature_removals,
    validate_expected_snapshot, validate_utf8_message, CapturedBranch, RawCommit, RewriteFailure,
};
use super::{GitActionResult, GitBlockReason};
use crate::error::AppError;
use crate::git::cli_fallback;

/// Collapses an exact oldest-first linear range, changing only the captured local branch.
/// oldTargetOid is the newest selection; rewrittenCount counts one squash plus descendants.
pub async fn squash_commits(
    project_path: &Path,
    hashes: &[String],
    message: &str,
    expected_branch: &str,
    expected_head_oid: &str,
    allow_signature_removal: bool,
) -> Result<GitActionResult, AppError> {
    if hashes.len() < 2 {
        return Err(AppError::InvalidInput(
            "squash requires at least two commits".into(),
        ));
    }
    let mut selected = Vec::with_capacity(hashes.len());
    let mut unique = HashSet::with_capacity(hashes.len());
    for hash in hashes {
        let oid = exact_oid(hash, "hashes entry")?;
        if !unique.insert(oid) {
            return Err(AppError::InvalidInput(
                "squash hashes must be unique".into(),
            ));
        }
        selected.push(oid);
    }
    let message = normalize_message(message)?;
    let expected_tip = validate_expected_snapshot(expected_branch, expected_head_oid)?;
    let target = *selected.last().unwrap();
    let captured = match mutation_preflight(project_path, expected_branch, expected_tip).await? {
        Ok(captured) => captured,
        Err(mut action) => {
            action.hash = Some(target.to_string());
            return Ok(action);
        }
    };

    let current_root = dunce::canonicalize(project_path)?;
    for wt in cli_fallback::list_worktrees(project_path).await? {
        let branch_matches = wt.branch == captured.branch
            || Some(wt.branch.as_str()) == captured.branch.strip_prefix("refs/heads/");
        if branch_matches && dunce::canonicalize(&wt.path)? != current_root {
            let mut action = GitActionResult::blocked(
                GitBlockReason::CheckedOutBranch,
                format!(
                    "branch {} is checked out in another worktree at {}",
                    captured.branch, wt.path
                ),
                "switch branches in the other worktree first",
            );
            action.branch = Some(captured.branch);
            action.hash = Some(target.to_string());
            action.old_target_oid = Some(target.to_string());
            action.old_head_oid = Some(captured.old_tip.to_string());
            return Ok(action);
        }
    }

    let path = project_path.to_path_buf();
    #[cfg(test)]
    let fail_publication = super::commit_message_rewrite::take_publication_failure();
    tokio::task::spawn_blocking(move || {
        #[cfg(test)]
        if fail_publication {
            super::commit_message_rewrite::inject_publication_failure();
        }
        match squash_objects(&path, &selected, &unique, &message, &captured, allow_signature_removal) {
            Ok(action) => Ok(action),
            Err(RewriteFailure::Error(error)) => Err(error),
            Err(RewriteFailure::Block(reason, message)) => {
                let recommendation = match &reason {
                    GitBlockReason::SignatureConsentRequired =>
                        "set allowSignatureRemoval=true only after confirming removal of invalidated signatures",
                    GitBlockReason::UnreachableCommit => "select or check out the branch containing every selected commit",
                    GitBlockReason::PublicationUncertain =>
                        "refresh and reconcile the observed branch before any further mutation; do not blindly retry",
                    _ => "refresh history and review the blocked range before trying again",
                };
                let mut action = GitActionResult::blocked(reason, message, recommendation);
                action.hash = Some(target.to_string());
                action.branch = Some(captured.branch);
                action.old_target_oid = Some(target.to_string());
                action.old_head_oid = Some(captured.old_tip.to_string());
                Ok(action)
            }
        }
    }).await.map_err(|e| AppError::Internal(format!("blocking git squash task failed: {e}")))?
}

fn squash_objects(
    path: &Path,
    selected: &[git2::Oid],
    selected_set: &HashSet<git2::Oid>,
    message: &[u8],
    captured: &CapturedBranch,
    consent: bool,
) -> Result<GitActionResult, RewriteFailure> {
    let repo = git2::Repository::open(path)?;
    let odb = repo.odb()?;
    let nodes = collect_parent_first(&repo, &odb, captured.old_tip)?;
    let index: HashMap<_, _> = nodes.iter().map(|node| (node.oid, node)).collect();
    for oid in selected {
        if !index.contains_key(oid) {
            return Err(RewriteFailure::Block(
                GitBlockReason::UnreachableCommit,
                format!("commit {oid} is not reachable from the captured branch tip"),
            ));
        }
    }
    let oldest = index[&selected[0]];
    let newest = index[selected.last().unwrap()];
    let affected = affected_closure(&nodes, oldest.oid);
    for node in nodes.iter().filter(|node| affected.contains(&node.oid)) {
        if node.parents.len() > 1 {
            return Err(RewriteFailure::Block(GitBlockReason::UnsupportedHistory,
                format!("squash requires linear history: selected or rewritten descendant {} is a merge", node.oid)));
        }
    }
    for pair in selected.windows(2) {
        if index[&pair[1]].parents.as_slice() != [pair[0]] {
            return Err(RewriteFailure::Block(GitBlockReason::UnsupportedHistory,
                "select consecutive commits in exact oldest-first order; gaps and reversed ranges cannot be squashed".into()));
        }
    }
    if !affected.contains(&captured.old_tip) {
        return Err(RewriteFailure::Block(
            GitBlockReason::UnsupportedHistory,
            "selected range does not lead to the captured branch tip".into(),
        ));
    }
    for oid in selected {
        validate_utf8_message(&parse_raw_commit(index[oid].raw_object.data())?)?;
    }
    validate_template(&parse_raw_commit(oldest.raw_object.data())?)?;
    let removals = signature_removals(&nodes, &affected)?;
    let signatures_removed = !removals.is_empty();
    if signatures_removed && !consent {
        return Err(RewriteFailure::Block(GitBlockReason::SignatureConsentRequired,
            "squash invalidates signatures in selected commits (including absorbed commits) or descendants; explicitly allow signature removal".into()));
    }
    // Resolve configured identity before the first object write. Never reuse an old committer.
    let signature = repo.signature().map_err(|e| {
        RewriteFailure::Error(AppError::Git(format!(
            "git user not configured (set user.name and user.email): {}",
            e.message()
        )))
    })?;
    let committer = committer_header(&signature)?;
    let removable = |oid| removals.get(&oid).map(Vec::as_slice).unwrap_or(&[]);
    let payload = rewrite_bytes(
        oldest,
        &oldest.parents,
        Some(message),
        removable(oldest.oid),
        Some(newest.tree_oid),
        Some(&committer),
    )?;
    let squash_oid = odb.write(git2::ObjectType::Commit, &payload)?;
    let squash = repo.find_commit(squash_oid)?;
    if squash.tree_id() != newest.tree_oid
        || squash.parent_count() != oldest.parents.len()
        || (oldest
            .parents
            .first()
            .is_some_and(|p| squash.parent_id(0).ok() != Some(*p)))
    {
        return Err(
            AppError::Git("synthesized squash topology/tree invariant failed".into()).into(),
        );
    }
    let mut mapped = HashMap::with_capacity(affected.len());
    for oid in selected {
        mapped.insert(*oid, squash_oid);
    }
    let mut rewritten_count = 1;
    for node in nodes
        .iter()
        .filter(|node| affected.contains(&node.oid) && !selected_set.contains(&node.oid))
    {
        let parent = node
            .parents
            .first()
            .and_then(|p| mapped.get(p))
            .copied()
            .ok_or_else(|| AppError::Git("linear descendant has no rewritten parent".into()))?;
        let payload = rewrite_bytes(node, &[parent], None, removable(node.oid), None, None)?;
        let oid = odb.write(git2::ObjectType::Commit, &payload)?;
        mapped.insert(node.oid, oid);
        rewritten_count += 1;
    }
    let tip = mapped[&captured.old_tip];
    if repo.find_commit(tip)?.tree_id() != index[&captured.old_tip].tree_oid {
        return Err(
            AppError::Git("rewritten tip tree differs from captured tip tree".into()).into(),
        );
    }
    if let Err(error) = publish_checked_ref(&repo, captured, tip, "squash commits") {
        return Err(match error {
            RewriteFailure::Block(GitBlockReason::PublicationUncertain, diagnostic) =>
                RewriteFailure::Block(GitBlockReason::PublicationUncertain, format!(
                    "{diagnostic}; original target={} candidate squash={squash_oid}; refresh and reconcile before further mutation",
                    newest.oid)),
            other => other,
        });
    }
    let mut action = GitActionResult::ok(format!("Squashed {} commits", selected.len()));
    action.hash = Some(squash_oid.to_string());
    action.branch = Some(captured.branch.clone());
    action.old_target_oid = Some(newest.oid.to_string());
    action.new_target_oid = Some(squash_oid.to_string());
    action.old_head_oid = Some(captured.old_tip.to_string());
    action.new_head_oid = Some(tip.to_string());
    action.rewritten_count = Some(rewritten_count);
    action.no_op = Some(false);
    action.signatures_removed = Some(signatures_removed);
    Ok(action)
}

fn validate_template(parsed: &RawCommit<'_>) -> Result<(), RewriteFailure> {
    for key in [b"author".as_slice(), b"committer".as_slice()] {
        let mut blocks = parsed.headers.iter().filter(|block| block.key == key);
        let valid = blocks
            .next()
            .is_some_and(|block| valid_identity_header(block.raw, key.len() + 1));
        if !valid || blocks.next().is_some() {
            return Err(RewriteFailure::Block(
                GitBlockReason::InvalidCommitMetadata,
                "oldest commit requires exactly one valid author and committer header".into(),
            ));
        }
    }
    Ok(())
}

fn valid_identity_header(raw: &[u8], prefix: usize) -> bool {
    let Some(value) = raw.get(prefix..).and_then(|v| v.strip_suffix(b"\n")) else {
        return false;
    };
    if value.iter().any(|b| matches!(b, b'\n' | b'\r' | 0)) {
        return false;
    }
    let Some(open) = value.iter().position(|b| *b == b'<') else {
        return false;
    };
    let Some(close) = value.iter().position(|b| *b == b'>') else {
        return false;
    };
    if open == 0 || close <= open + 1 || value[open + 1..close].contains(&b'<') {
        return false;
    }
    let Ok(tail) = std::str::from_utf8(&value[close + 1..]) else {
        return false;
    };
    let mut fields = tail.split_ascii_whitespace();
    let seconds = fields.next().is_some_and(|s| s.parse::<i64>().is_ok());
    let zone = fields.next().is_some_and(|z| {
        z.len() == 5
            && matches!(z.as_bytes()[0], b'+' | b'-')
            && z.as_bytes()[1..].iter().all(u8::is_ascii_digit)
            && z[1..3].parse::<u8>().is_ok_and(|h| h <= 23)
            && z[3..].parse::<u8>().is_ok_and(|m| m <= 59)
    });
    seconds && zone && fields.next().is_none()
}

fn committer_header(signature: &git2::Signature<'_>) -> Result<Vec<u8>, RewriteFailure> {
    let name = signature.name_bytes();
    let email = signature.email_bytes();
    let offset = signature.when().offset_minutes();
    if name.is_empty()
        || email.is_empty()
        || offset.unsigned_abs() >= 24 * 60
        || name
            .iter()
            .chain(email)
            .any(|b| matches!(b, 0 | b'\n' | b'\r' | b'<' | b'>'))
    {
        return Err(AppError::Git(
            "git user not configured (set user.name and user.email): invalid committer identity"
                .into(),
        )
        .into());
    }
    let mut header = Vec::with_capacity(name.len() + email.len() + 48);
    header.extend_from_slice(b"committer ");
    header.extend_from_slice(name);
    header.extend_from_slice(b" <");
    header.extend_from_slice(email);
    let _ = writeln!(
        header,
        "> {} {}{:02}{:02}",
        signature.when().seconds(),
        if offset < 0 { '-' } else { '+' },
        offset.unsigned_abs() / 60,
        offset.unsigned_abs() % 60
    );
    Ok(header)
}

#[cfg(test)]
mod tests {
    use super::committer_header;

    #[test]
    fn squash_commits_committer_serialization_retains_timestamp_and_signed_offset() {
        for (minutes, zone) in [(330, "+0530"), (-420, "-0700"), (0, "+0000")] {
            let signature = git2::Signature::new(
                "Current ✓",
                "current@example.com",
                &git2::Time::new(1780000000, minutes),
            )
            .unwrap();
            assert_eq!(
                committer_header(&signature).unwrap(),
                format!("committer Current ✓ <current@example.com> 1780000000 {zone}\n").as_bytes()
            );
        }
    }
}
