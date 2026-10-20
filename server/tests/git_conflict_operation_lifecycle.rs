use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

use dam_hopper_server::git::operation::{
    active_operation_kind, execute_operation_action, get_authoritative_operation_status,
};
use dam_hopper_server::git::types::{
    OperationAction, OperationActionRequest, OperationKind, OperationOutcome,
    OperationStoppedReason,
};

fn git(args: &[&str], cwd: &Path) -> Vec<u8> {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn git_try(args: &[&str], cwd: &Path) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn init_repo(cwd: &Path) {
    git(&["init", "-b", "main"], cwd);
    git(&["config", "user.name", "Tester"], cwd);
    git(&["config", "user.email", "tester@example.com"], cwd);
    git(&["config", "commit.gpgsign", "false"], cwd);
    git(&["config", "core.autocrlf", "false"], cwd);
}

#[tokio::test]
async fn test_authoritative_operation_detection_and_roles() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    // Initial clean repo
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::None);
    assert!(!status.can_continue);
    assert!(!status.can_abort);
    assert!(status.stopped_reason.is_none());

    fs::write(root.join("file.txt"), b"line 1\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 1"], root);

    git(&["checkout", "-b", "branch-a"], root);
    fs::write(root.join("file.txt"), b"line 1 A\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 2 A"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("file.txt"), b"line 1 B\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 2 B"], root);

    // 1. Merge conflict
    let _ = git_try(&["merge", "branch-a"], root);
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::Merge);
    assert!(!status.can_continue); // has conflicts
    assert!(status.can_abort);
    assert_eq!(
        status.stopped_reason,
        Some(OperationStoppedReason::Conflicts)
    );
    let roles = status.stage_role_labels.unwrap();
    assert_eq!(roles.ours, "Current branch (HEAD)");
    assert_eq!(roles.theirs, "Incoming change (MERGE_HEAD)");
    assert_eq!(roles.base, Some("Base (merge base)".to_string()));

    git(&["merge", "--abort"], root);
    let status_after_abort = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status_after_abort.operation, OperationKind::None);

    // 2. Rebase conflict
    let _ = git_try(&["rebase", "branch-a"], root);
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::Rebase);
    assert!(!status.can_continue);
    assert!(status.can_abort);
    assert_eq!(
        status.stopped_reason,
        Some(OperationStoppedReason::Conflicts)
    );
    let roles = status.stage_role_labels.unwrap();
    assert_eq!(roles.ours, "Current (onto/rebased state)");
    assert_eq!(roles.theirs, "Incoming (replayed commit)");

    git(&["rebase", "--abort"], root);
    assert_eq!(
        get_authoritative_operation_status(root).unwrap().operation,
        OperationKind::None
    );

    // 3. Cherry-pick conflict
    let commit_a = String::from_utf8(git(&["rev-parse", "branch-a"], root))
        .unwrap()
        .trim()
        .to_string();
    let _ = git_try(&["cherry-pick", &commit_a], root);
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::CherryPick);
    assert!(!status.can_continue);
    assert!(status.can_abort);
    let roles = status.stage_role_labels.unwrap();
    assert_eq!(roles.ours, "Current branch (HEAD)");
    assert_eq!(roles.theirs, "Cherry-picked change");

    git(&["cherry-pick", "--abort"], root);
    assert_eq!(
        get_authoritative_operation_status(root).unwrap().operation,
        OperationKind::None
    );

    // 4. Revert conflict
    fs::write(root.join("file.txt"), b"line 1 target\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 3 target"], root);
    fs::write(root.join("file.txt"), b"line 1 conflicting\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 4 conflicting"], root);

    let _ = git_try(&["revert", "HEAD~1"], root);
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::Revert);
    assert!(!status.can_continue);
    assert!(status.can_abort);
    let roles = status.stage_role_labels.unwrap();
    assert_eq!(roles.ours, "Current branch (HEAD)");
    assert_eq!(roles.theirs, "Parent (reverting to)");
    assert_eq!(roles.base, Some("Commit being reverted".to_string()));

    git(&["revert", "--abort"], root);
    assert_eq!(
        get_authoritative_operation_status(root).unwrap().operation,
        OperationKind::None
    );
}

#[test]
fn test_git_am_mailbox_detected_as_unsupported() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    let git_dir = root.join(".git");
    let rebase_apply = git_dir.join("rebase-apply");
    fs::create_dir_all(&rebase_apply).unwrap();
    fs::write(rebase_apply.join("applying"), b"1\n").unwrap();

    let repo = git2::Repository::open(root).unwrap();
    let op = active_operation_kind(&repo);
    assert_eq!(
        op,
        OperationKind::Unsupported,
        "git am mailbox applying state must be classified as Unsupported"
    );
}

#[test]
fn test_contradictory_markers_detected_as_unsupported() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    let git_dir = root.join(".git");
    fs::write(git_dir.join("MERGE_HEAD"), b"dummy_oid\n").unwrap();
    fs::create_dir_all(git_dir.join("rebase-merge")).unwrap();

    let repo = git2::Repository::open(root).unwrap();
    let op = active_operation_kind(&repo);
    assert_eq!(
        op,
        OperationKind::Unsupported,
        "Contradictory operation markers must fail closed as Unsupported"
    );
}

#[test]
fn test_sequencer_todo_active_without_head_marker() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    let sequencer_dir = root.join(".git/sequencer");
    fs::create_dir_all(&sequencer_dir).unwrap();
    fs::write(
        sequencer_dir.join("todo"),
        b"# comment line\npick 1234567890abcdef commit summary\n",
    )
    .unwrap();

    let repo = git2::Repository::open(root).unwrap();
    let op = active_operation_kind(&repo);
    assert_eq!(
        op,
        OperationKind::CherryPick,
        "Active sequencer with pick instruction must be detected as CherryPick"
    );

    fs::write(
        sequencer_dir.join("todo"),
        b"revert 1234567890abcdef commit summary\n",
    )
    .unwrap();
    let op = active_operation_kind(&repo);
    assert_eq!(
        op,
        OperationKind::Revert,
        "Active sequencer with revert instruction must be detected as Revert"
    );
}

#[tokio::test]
async fn test_preconditioned_operation_continue_and_abort() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("file.txt"), b"initial\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "feature"], root);
    fs::write(root.join("file.txt"), b"feature content\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "feature edit"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("file.txt"), b"main content\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "main edit"], root);

    // Trigger merge conflict
    let _ = git_try(&["merge", "feature"], root);
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::Merge);
    assert!(!status.can_continue);

    // 1. Try continue while conflicts remain
    let req_blocked = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status.operation_fingerprint.clone(),
        full_index_fingerprint: status.full_index_fingerprint.clone(),
        action: OperationAction::Continue,
        abort_confirmed: false,
    };
    let outcome = execute_operation_action(root, &req_blocked).await.unwrap();
    match outcome {
        OperationOutcome::Blocked {
            reason,
            terminal_handoff_required,
        } => {
            assert_eq!(reason, OperationStoppedReason::Conflicts);
            assert!(!terminal_handoff_required);
        }
        other => panic!("Expected Blocked(Conflicts), got {:?}", other),
    }

    // 2. Resolve conflict by staging resolved file
    fs::write(root.join("file.txt"), b"resolved content\n").unwrap();
    git(&["add", "file.txt"], root);

    // 3. Try continue with stale index fingerprint (from before staging)
    let outcome_stale = execute_operation_action(root, &req_blocked).await.unwrap();
    match outcome_stale {
        OperationOutcome::Stale {
            required_refresh, ..
        } => {
            assert!(required_refresh);
        }
        other => panic!("Expected Stale, got {:?}", other),
    }

    // 4. Try continue with refreshed preconditions -> editor sentinel triggers!
    let fresh_status = get_authoritative_operation_status(root).unwrap();
    assert!(fresh_status.can_continue);
    let req_continue = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: fresh_status.operation_fingerprint.clone(),
        full_index_fingerprint: fresh_status.full_index_fingerprint.clone(),
        action: OperationAction::Continue,
        abort_confirmed: false,
    };

    let outcome_continue = execute_operation_action(root, &req_continue).await.unwrap();
    match outcome_continue {
        OperationOutcome::Blocked {
            reason,
            terminal_handoff_required,
        } => {
            assert_eq!(reason, OperationStoppedReason::MessageEditRequired);
            assert!(
                terminal_handoff_required,
                "Must require terminal handoff for editor"
            );
        }
        other => panic!("Expected Blocked(MessageEditRequired), got {:?}", other),
    }

    // 5. Try abort without confirmation -> rejected
    let req_abort_unconfirmed = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: fresh_status.operation_fingerprint.clone(),
        full_index_fingerprint: fresh_status.full_index_fingerprint.clone(),
        action: OperationAction::Abort,
        abort_confirmed: false,
    };
    let outcome_unconfirmed = execute_operation_action(root, &req_abort_unconfirmed)
        .await
        .unwrap();
    match outcome_unconfirmed {
        OperationOutcome::Failed { error } => {
            assert!(error.contains("explicit user confirmation"));
        }
        other => panic!("Expected Failed without confirmation, got {:?}", other),
    }

    // 6. Abort with confirmation -> Aborted, worktree clean
    let req_abort = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: fresh_status.operation_fingerprint.clone(),
        full_index_fingerprint: fresh_status.full_index_fingerprint.clone(),
        action: OperationAction::Abort,
        abort_confirmed: true,
    };
    let outcome_abort = execute_operation_action(root, &req_abort).await.unwrap();
    match outcome_abort {
        OperationOutcome::Aborted { worktree_cleaned } => {
            assert!(worktree_cleaned, "Worktree should be clean after abort");
        }
        other => panic!("Expected Aborted, got {:?}", other),
    }

    // Status is now None
    let final_status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(final_status.operation, OperationKind::None);
}

#[tokio::test]
async fn test_failing_pre_commit_hook_blocks_continue() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("file.txt"), b"initial\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "feature"], root);
    fs::write(root.join("file.txt"), b"feature\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "feature"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("file.txt"), b"main\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "feature"], root);
    fs::write(root.join("file.txt"), b"resolved\n").unwrap();
    git(&["add", "file.txt"], root);

    // Install failing pre-commit hook
    let hooks_dir = root.join(".git/hooks");
    fs::create_dir_all(&hooks_dir).unwrap();
    let hook_path = hooks_dir.join("pre-commit");
    fs::write(
        &hook_path,
        b"#!/bin/sh\necho 'pre-commit hook failed' >&2\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&hook_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&hook_path, perms).unwrap();
    }

    let status = get_authoritative_operation_status(root).unwrap();
    let req = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status.operation_fingerprint.clone(),
        full_index_fingerprint: status.full_index_fingerprint.clone(),
        action: OperationAction::Continue,
        abort_confirmed: false,
    };

    let outcome = execute_operation_action(root, &req).await.unwrap();
    match outcome {
        OperationOutcome::Blocked {
            reason,
            terminal_handoff_required,
        } => {
            assert_eq!(reason, OperationStoppedReason::HookBlocked);
            assert!(!terminal_handoff_required);
        }
        other => panic!("Expected Blocked(HookBlocked), got {:?}", other),
    }
}

#[tokio::test]
async fn test_rebase_repeated_stop_outcome() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    // Base commit
    fs::write(root.join("file.txt"), b"base line\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "base commit"], root);

    // Feature branch with 2 commits modifying file.txt
    git(&["checkout", "-b", "feature-multi"], root);
    fs::write(root.join("file.txt"), b"feature commit 1\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "feature commit 1"], root);

    fs::write(root.join("file.txt"), b"feature commit 2\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "feature commit 2"], root);

    // Main branch with conflicting commit
    git(&["checkout", "main"], root);
    fs::write(root.join("file.txt"), b"main conflicting line\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "main commit"], root);

    // Rebase feature-multi onto main -> conflicts on commit 1
    git(&["checkout", "feature-multi"], root);
    let _ = git_try(&["rebase", "main"], root);

    let status1 = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status1.operation, OperationKind::Rebase);
    assert_eq!(
        status1.stopped_reason,
        Some(OperationStoppedReason::Conflicts)
    );

    // Resolve first conflict and stage
    fs::write(root.join("file.txt"), b"resolved commit 1\n").unwrap();
    git(&["add", "file.txt"], root);

    let status1_staged = get_authoritative_operation_status(root).unwrap();
    assert!(status1_staged.can_continue);

    let req_continue = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status1_staged.operation_fingerprint.clone(),
        full_index_fingerprint: status1_staged.full_index_fingerprint.clone(),
        action: OperationAction::Continue,
        abort_confirmed: false,
    };

    let outcome = execute_operation_action(root, &req_continue).await.unwrap();
    match outcome {
        OperationOutcome::Blocked {
            reason,
            terminal_handoff_required,
        } => {
            // First stop requires commit message editor -> hands off to terminal
            assert_eq!(reason, OperationStoppedReason::MessageEditRequired);
            assert!(terminal_handoff_required);
        }
        other => panic!("Expected Blocked(MessageEditRequired), got {:?}", other),
    }

    // Simulate user in terminal running configured editor and completing the commit
    let _ = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_EDITOR", "cat")
        .args(["rebase", "--continue"])
        .current_dir(root)
        .output()
        .expect("git rebase --continue failed in terminal");

    // After terminal return, requery authoritative status:
    // Rebase moved forward to the next stop and encountered commit 2 conflict!
    let status_after_terminal = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status_after_terminal.operation, OperationKind::Rebase);
    assert_eq!(
        status_after_terminal.stopped_reason,
        Some(OperationStoppedReason::Conflicts),
        "Repeated stop after terminal return should present next conflict"
    );

    git(&["rebase", "--abort"], root);
}

#[tokio::test]
async fn test_staged_index_oracle_rejects_unrelated_modification() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("file.txt"), b"initial\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "feature"], root);
    fs::write(root.join("file.txt"), b"feature\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "feat"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("file.txt"), b"main\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "feature"], root);
    fs::write(root.join("file.txt"), b"resolved\n").unwrap();
    git(&["add", "file.txt"], root);

    // Status captured after resolving file.txt
    let status_before = get_authoritative_operation_status(root).unwrap();
    assert!(status_before.can_continue);
    let merge_head_before = fs::read_to_string(root.join(".git/MERGE_HEAD")).unwrap();

    // An unrelated file is modified and staged before Continue is submitted
    fs::write(root.join("unrelated.txt"), b"unrelated new content\n").unwrap();
    git(&["add", "unrelated.txt"], root);

    // Submit with status_before preconditions
    let req = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status_before.operation_fingerprint.clone(),
        full_index_fingerprint: status_before.full_index_fingerprint.clone(),
        action: OperationAction::Continue,
        abort_confirmed: false,
    };

    let outcome = execute_operation_action(root, &req).await.unwrap();
    match outcome {
        OperationOutcome::Stale {
            reason,
            required_refresh,
        } => {
            assert!(required_refresh);
            assert!(reason.contains("Index state or staged files changed"));
        }
        other => panic!("Expected Stale outcome, got {:?}", other),
    }

    // Verify that NO git command executed: MERGE_HEAD must still exist and be identical
    let merge_head_after = fs::read_to_string(root.join(".git/MERGE_HEAD")).unwrap();
    assert_eq!(merge_head_before, merge_head_after);
    let status_after = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status_after.operation, OperationKind::Merge);

    git(&["merge", "--abort"], root);
}

#[tokio::test]
async fn test_linked_worktree_operation_isolation() {
    let dir = TempDir::new().unwrap();
    let main_root = dir.path().join("main_repo");
    fs::create_dir_all(&main_root).unwrap();
    init_repo(&main_root);

    fs::write(main_root.join("file.txt"), b"initial\n").unwrap();
    git(&["add", "file.txt"], &main_root);
    git(&["commit", "-m", "init"], &main_root);

    git(&["checkout", "-b", "feature"], &main_root);
    fs::write(main_root.join("file.txt"), b"feature\n").unwrap();
    git(&["add", "file.txt"], &main_root);
    git(&["commit", "-m", "feat"], &main_root);

    git(&["checkout", "main"], &main_root);
    fs::write(main_root.join("file.txt"), b"main\n").unwrap();
    git(&["add", "file.txt"], &main_root);
    git(&["commit", "-m", "main"], &main_root);

    // Create linked worktree
    let wt_path = dir.path().join("linked_wt");
    git(
        &[
            "worktree",
            "add",
            wt_path.to_str().unwrap(),
            "-b",
            "wt-branch",
        ],
        &main_root,
    );

    // Start merge conflict in main repo
    let _ = git_try(&["merge", "feature"], &main_root);

    let main_status = get_authoritative_operation_status(&main_root).unwrap();
    assert_eq!(main_status.operation, OperationKind::Merge);
    assert_eq!(
        main_status.stopped_reason,
        Some(OperationStoppedReason::Conflicts)
    );

    // Linked worktree must be Clean / None
    let wt_status = get_authoritative_operation_status(&wt_path).unwrap();
    assert_eq!(wt_status.operation, OperationKind::None);
    assert!(!wt_status.can_continue);
    assert!(!wt_status.can_abort);
    assert!(wt_status.stopped_reason.is_none());

    git(&["merge", "--abort"], &main_root);
}

#[tokio::test]
async fn test_cherry_pick_and_revert_action_lifecycle() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("f.txt"), b"base\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "pick-branch"], root);
    fs::write(root.join("f.txt"), b"pick change\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "pick commit"], root);
    let pick_oid = String::from_utf8(git(&["rev-parse", "HEAD"], root))
        .unwrap()
        .trim()
        .to_string();

    git(&["checkout", "main"], root);
    fs::write(root.join("f.txt"), b"main change\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "main commit"], root);

    // Trigger cherry-pick conflict
    let _ = git_try(&["cherry-pick", &pick_oid], root);
    let status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(status.operation, OperationKind::CherryPick);

    // Abort via execute_operation_action
    let req_abort = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status.operation_fingerprint,
        full_index_fingerprint: status.full_index_fingerprint,
        action: OperationAction::Abort,
        abort_confirmed: true,
    };
    let outcome = execute_operation_action(root, &req_abort).await.unwrap();
    match outcome {
        OperationOutcome::Aborted { worktree_cleaned } => {
            assert!(worktree_cleaned);
        }
        other => panic!("Expected Aborted, got {:?}", other),
    }
    assert_eq!(
        get_authoritative_operation_status(root).unwrap().operation,
        OperationKind::None
    );

    // Now trigger cherry-pick conflict again and test Continue path (exit 0)
    let _ = git_try(&["cherry-pick", &pick_oid], root);
    fs::write(root.join("f.txt"), b"resolved cherry pick\n").unwrap();
    git(&["add", "f.txt"], root);

    let status_staged = get_authoritative_operation_status(root).unwrap();
    assert!(status_staged.can_continue);
    let req_continue = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status_staged.operation_fingerprint,
        full_index_fingerprint: status_staged.full_index_fingerprint,
        action: OperationAction::Continue,
        abort_confirmed: false,
    };

    let outcome_continue = execute_operation_action(root, &req_continue).await.unwrap();
    match outcome_continue {
        OperationOutcome::Continued { new_status } => {
            assert_eq!(new_status.operation, OperationKind::None);
            assert!(!new_status.can_continue);
            assert!(!new_status.can_abort);
        }
        other => panic!("Expected Continued outcome, got {:?}", other),
    }

    // Now trigger revert conflict and test both abort and continue paths
    fs::write(root.join("f.txt"), b"revert target\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "target commit"], root);
    fs::write(root.join("f.txt"), b"revert conflict\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "conflicting commit"], root);

    let _ = git_try(&["revert", "HEAD~1"], root);
    let revert_status = get_authoritative_operation_status(root).unwrap();
    assert_eq!(revert_status.operation, OperationKind::Revert);

    // Revert abort
    let req_revert_abort = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: revert_status.operation_fingerprint,
        full_index_fingerprint: revert_status.full_index_fingerprint,
        action: OperationAction::Abort,
        abort_confirmed: true,
    };
    let revert_abort_outcome = execute_operation_action(root, &req_revert_abort).await.unwrap();
    assert!(matches!(revert_abort_outcome, OperationOutcome::Aborted { .. }));
    assert_eq!(get_authoritative_operation_status(root).unwrap().operation, OperationKind::None);

    // Trigger revert conflict again and test continue
    let _ = git_try(&["revert", "HEAD~1"], root);
    fs::write(root.join("f.txt"), b"revert resolved\n").unwrap();
    git(&["add", "f.txt"], root);
    let revert_staged = get_authoritative_operation_status(root).unwrap();
    let req_revert_continue = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: revert_staged.operation_fingerprint,
        full_index_fingerprint: revert_staged.full_index_fingerprint,
        action: OperationAction::Continue,
        abort_confirmed: false,
    };
    let revert_continue_outcome = execute_operation_action(root, &req_revert_continue).await.unwrap();
    assert!(matches!(revert_continue_outcome, OperationOutcome::Continued { .. }));
    assert_eq!(get_authoritative_operation_status(root).unwrap().operation, OperationKind::None);
}

#[tokio::test]
async fn test_active_git_operation_blocks_on_unsupported_mailbox() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    // Simulate git am
    let rebase_apply = root.join(".git/rebase-apply");
    fs::create_dir_all(&rebase_apply).unwrap();
    fs::write(rebase_apply.join("applying"), b"1\n").unwrap();

    let recovery = dam_hopper_server::git::active_git_operation(root)
        .await
        .unwrap();
    assert!(
        recovery.is_some(),
        "Active git operation must return Some for git am to block mutations"
    );
    let r = recovery.unwrap();
    assert_eq!(
        r.operation,
        dam_hopper_server::git::types::GitRecoveryOperation::Unsupported
    );
    assert!(!r.can_continue);
    assert!(!r.can_abort);
}
