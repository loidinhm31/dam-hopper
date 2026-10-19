use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
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
#[test]
fn test_binary_conflict_exact_side_staging_and_materialization() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);
    let base_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x01\x02\x03";
    let ours_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\xAA\xBB\xCC\xDD";
    let theirs_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x11\x22\x33\x44";
    fs::write(root.join("image.png"), base_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "base binary"], root);

    git(&["checkout", "-b", "branch-theirs"], root);
    fs::write(root.join("image.png"), theirs_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "theirs binary"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("image.png"), ours_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "ours binary"], root);

    let _ = git_try(&["merge", "branch-theirs"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "image.png").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    let ours_oid = snapshot.stages.ours.oid.clone().unwrap();
    let ours_mode = snapshot.stages.ours.mode;

    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::IndexSide {
            side: ResolveSide::Ours,
            stage: 2,
        },
        root: None,
        worktree_path: None,
    };

    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Applied { new_oid, stage0_mode, deleted } => {
            assert!(!deleted);
            assert_eq!(new_oid.unwrap(), ours_oid);
            assert_eq!(stage0_mode, Some(ours_mode));
        }
        other => panic!("Expected Applied, got {other:?}"),
    }

    let repo_after = git2::Repository::open(root).unwrap();
    let s0 = repo_after.index().unwrap().get_path(Path::new("image.png"), 0).unwrap();
    assert_eq!(s0.id.to_string(), ours_oid);
    assert_eq!(s0.mode, ours_mode);
    assert_eq!(fs::read(root.join("image.png")).unwrap(), ours_bytes);
    assert!(!repo_after.index().unwrap().has_conflicts());
}
#[test]
fn test_delete_modify_conflict_resolution() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);
    fs::write(root.join("del_mod.txt"), b"initial\n").unwrap();
    git(&["add", "del_mod.txt"], root);
    git(&["commit", "-m", "base"], root);
    git(&["checkout", "-b", "mod-branch"], root);
    fs::write(root.join("del_mod.txt"), b"modified\n").unwrap();
    git(&["add", "del_mod.txt"], root);
    git(&["commit", "-m", "mod"], root);

    git(&["checkout", "main"], root);
    git(&["rm", "del_mod.txt"], root);
    git(&["commit", "-m", "del"], root);

    let _ = git_try(&["merge", "mod-branch"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "del_mod.txt").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::Delete {},
        root: None,
        worktree_path: None,
    };

    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Applied { deleted, new_oid, stage0_mode } => {
            assert!(deleted);
            assert!(new_oid.is_none());
            assert!(stage0_mode.is_none());
        }
        other => panic!("Expected Applied, got {other:?}"),
    }

    let disk_file = root.join("del_mod.txt");
    assert!(!disk_file.exists());
    let repo_after = git2::Repository::open(root).unwrap();
    let index_after = repo_after.index().unwrap();
    assert!(!index_after.has_conflicts());
    assert!(index_after.get_path(Path::new("del_mod.txt"), 0).is_none());
    assert!(index_after.get_path(Path::new("del_mod.txt"), 1).is_none());
    assert!(index_after.get_path(Path::new("del_mod.txt"), 2).is_none());
    assert!(index_after.get_path(Path::new("del_mod.txt"), 3).is_none());
}

#[test]
fn test_injected_stage_failure_after_worktree_write() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    // Create a real merge conflict
    fs::write(root.join("conflict_file.txt"), b"base content\n").unwrap();
    git(&["add", "conflict_file.txt"], root);
    git(&["commit", "-m", "base"], root);

    git(&["checkout", "-b", "side-branch"], root);
    fs::write(root.join("conflict_file.txt"), b"side change\n").unwrap();
    git(&["add", "conflict_file.txt"], root);
    git(&["commit", "-m", "side"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("conflict_file.txt"), b"main change\n").unwrap();
    git(&["add", "conflict_file.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "side-branch"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "conflict_file.txt").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::ReviewedText {
            tokens: vec!["manually resolved text\n".into()],
            eol: ResolveEol::Preserve,
            executable: None,
        },
        root: None,
        worktree_path: None,
    };

    // On Unix, simulate stage failure after worktree write by making .git directory read-only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let git_dir = root.join(".git");
        fs::set_permissions(&git_dir, fs::Permissions::from_mode(0o555)).unwrap();

        let outcome = apply_conflict_resolution(root, &req).unwrap();

        // Restore permissions immediately
        fs::set_permissions(&git_dir, fs::Permissions::from_mode(0o755)).unwrap();

        // AC8 check: must report WorktreeChangedStageFailed with worktreeWritten=true, staged=false
        match outcome {
            ResolveOutcome::WorktreeChangedStageFailed {
                worktree_written,
                staged,
                error,
            } => {
                assert!(worktree_written);
                assert!(!staged);
                assert!(!error.is_empty());
            }
            other => panic!("Expected WorktreeChangedStageFailed, got {other:?}"),
        }

        // AC8 check: worktree must retain the written recovery text
        assert_eq!(
            fs::read_to_string(root.join("conflict_file.txt")).unwrap(),
            "manually resolved text\n"
        );

        // AC8 check: repository index still has conflicts (NO rollback)
        let repo_after = git2::Repository::open(root).unwrap();
        assert!(repo_after.index().unwrap().has_conflicts());
    }
}

#[test]
fn test_concurrent_mutation_coordination_blocks_competing_operation() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("file.txt"), b"initial\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "init"], root);

    let repo = git2::Repository::open(root).unwrap();
    let guard = dam_hopper_server::git::mutation_coordination::GLOBAL_MUTATION_COORDINATOR
        .try_acquire_for_repo(&repo, root);
    assert!(guard.is_ok(), "Initial acquisition must succeed");

    // Competing stage_files must fail with Unavailable while lock is held
    fs::write(root.join("file.txt"), b"new content\n").unwrap();
    let stage_res = stage_files(root, &["file.txt"]);
    match stage_res {
        Err(dam_hopper_server::error::AppError::Unavailable(msg)) => {
            assert!(msg.contains("Another Git mutation is in progress"));
        }
        other => panic!("Expected AppError::Unavailable, got {other:?}"),
    }

    drop(guard);

    // Now stage_files succeeds
    let stage_after = stage_files(root, &["file.txt"]);
    assert!(stage_after.is_ok(), "stage_files must succeed after lock is released");
}

use dam_hopper_server::git::conflict::{get_conflict_snapshot, get_conflicts_summary};
use dam_hopper_server::git::conflict_resolve::apply_conflict_resolution;
use dam_hopper_server::git::diff::stage_files;
use dam_hopper_server::git::types::{
    ResolveAction, ResolveEol, ResolveOutcome, ResolveRequest, ResolveSide,
};

#[test]
fn test_apply_conflict_resolution_reviewed_text_preserves_unrelated() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    // Base files
    fs::write(root.join("target.txt"), b"base target\n").unwrap();
    fs::write(root.join("unrelated_conflict.txt"), b"base unrelated\n").unwrap();
    fs::write(root.join("unrelated_clean.txt"), b"clean initial\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "base commit"], root);

    // Feature branch
    git(&["checkout", "-b", "feat"], root);
    fs::write(root.join("target.txt"), b"feat target\n").unwrap();
    fs::write(root.join("unrelated_conflict.txt"), b"feat unrelated\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "feat commit"], root);

    // Main branch
    git(&["checkout", "main"], root);
    fs::write(root.join("target.txt"), b"main target\n").unwrap();
    fs::write(root.join("unrelated_conflict.txt"), b"main unrelated\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "main commit"], root);

    // Trigger conflict
    let _ = git_try(&["merge", "feat"], root);

    // Add an unrelated staged modification
    fs::write(root.join("unrelated_clean.txt"), b"clean modified and staged\n").unwrap();
    git(&["add", "unrelated_clean.txt"], root);

    let repo = git2::Repository::open(root).unwrap();
    let index = repo.index().unwrap();
    assert!(index.has_conflicts());
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&index);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let target_entry = summary.entries.iter().find(|e| e.path == "target.txt").unwrap();
    let unrelated_entry = summary.entries.iter().find(|e| e.path == "unrelated_conflict.txt").unwrap();

    let target_snapshot = get_conflict_snapshot(root, &target_entry.conflict_id).unwrap();
    let unrelated_snapshot_before = get_conflict_snapshot(root, &unrelated_entry.conflict_id).unwrap();

    // Apply reviewed text resolution to target.txt
    let req = ResolveRequest {
        conflict_id: target_entry.conflict_id.clone(),
        snapshot_version: target_snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::ReviewedText {
            tokens: vec!["manually resolved line 1\n".into(), "line 2\n".into()],
            eol: ResolveEol::Preserve,
            executable: None,
        },
        root: None,
        worktree_path: None,
    };

    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Applied { new_oid, stage0_mode, deleted } => {
            assert!(!deleted);
            assert!(new_oid.is_some());
            assert_eq!(stage0_mode, Some(0o100644));
        }
        other => panic!("Expected Applied, got {other:?}"),
    }

    // Verify target.txt is resolved
    let repo_after = git2::Repository::open(root).unwrap();
    let index_after = repo_after.index().unwrap();
    assert!(index_after.get_path(Path::new("target.txt"), 0).is_some());
    assert!(index_after.get_path(Path::new("target.txt"), 1).is_none());
    assert!(index_after.get_path(Path::new("target.txt"), 2).is_none());
    assert!(index_after.get_path(Path::new("target.txt"), 3).is_none());
    assert_eq!(
        fs::read_to_string(root.join("target.txt")).unwrap(),
        "manually resolved line 1\nline 2\n"
    );

    // AC5 Verification: unrelated conflict must remain intact
    assert!(index_after.get_path(Path::new("unrelated_conflict.txt"), 1).is_some());
    assert!(index_after.get_path(Path::new("unrelated_conflict.txt"), 2).is_some());
    assert!(index_after.get_path(Path::new("unrelated_conflict.txt"), 3).is_some());
    let unrelated_snapshot_after = get_conflict_snapshot(root, &unrelated_entry.conflict_id).unwrap();
    assert_eq!(unrelated_snapshot_before.stages.ours.oid, unrelated_snapshot_after.stages.ours.oid);
    assert_eq!(unrelated_snapshot_before.stages.theirs.oid, unrelated_snapshot_after.stages.theirs.oid);

    // AC5 Verification: unrelated clean staged file must remain staged
    let clean_entry = index_after.get_path(Path::new("unrelated_clean.txt"), 0).unwrap();
    assert_ne!(clean_entry.file_size, 0);
    assert_eq!(
        fs::read_to_string(root.join("unrelated_clean.txt")).unwrap(),
        "clean modified and staged\n"
    );
}

#[test]
fn test_apply_conflict_resolution_index_side_binary() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    let base_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x01\x02\x03";
    let ours_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\xAA\xBB\xCC\xDD";
    let theirs_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x11\x22\x33\x44";
    fs::write(root.join("image.png"), base_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "base binary"], root);

    git(&["checkout", "-b", "branch-theirs"], root);
    fs::write(root.join("image.png"), theirs_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "theirs binary"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("image.png"), ours_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "ours binary"], root);

    let _ = git_try(&["merge", "branch-theirs"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "image.png").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    let theirs_oid = snapshot.stages.theirs.oid.clone().unwrap();

    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::IndexSide {
            side: ResolveSide::Theirs,
            stage: 3,
        },
        root: None,
        worktree_path: None,
    };

    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Applied { new_oid, stage0_mode, deleted } => {
            assert!(!deleted);
            assert_eq!(new_oid.unwrap(), theirs_oid);
            assert_eq!(stage0_mode, Some(snapshot.stages.theirs.mode));
        }
        other => panic!("Expected Applied, got {other:?}"),
    }

    // AC6 verification: stage 0 equals chosen stage and filesystem equals exact bytes
    let repo_after = git2::Repository::open(root).unwrap();
    let s0 = repo_after.index().unwrap().get_path(Path::new("image.png"), 0).unwrap();
    assert_eq!(s0.id.to_string(), theirs_oid);
    assert_eq!(fs::read(root.join("image.png")).unwrap(), theirs_bytes);
}

#[test]
fn test_apply_conflict_resolution_delete_action() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("del_file.txt"), b"initial content\n").unwrap();
    git(&["add", "del_file.txt"], root);
    git(&["commit", "-m", "base"], root);

    git(&["checkout", "-b", "mod-branch"], root);
    fs::write(root.join("del_file.txt"), b"modified content\n").unwrap();
    git(&["add", "del_file.txt"], root);
    git(&["commit", "-m", "mod"], root);

    git(&["checkout", "main"], root);
    git(&["rm", "del_file.txt"], root);
    git(&["commit", "-m", "del"], root);

    let _ = git_try(&["merge", "mod-branch"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "del_file.txt").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::Delete {},
        root: None,
        worktree_path: None,
    };

    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Applied { deleted, new_oid, stage0_mode } => {
            assert!(deleted);
            assert!(new_oid.is_none());
            assert!(stage0_mode.is_none());
        }
        other => panic!("Expected Applied, got {other:?}"),
    }

    // AC6 verification: file absent from disk and index
    assert!(!root.join("del_file.txt").exists());
    let repo_after = git2::Repository::open(root).unwrap();
    let idx = repo_after.index().unwrap();
    assert!(idx.get_path(Path::new("del_file.txt"), 0).is_none());
    assert!(idx.get_path(Path::new("del_file.txt"), 1).is_none());
    assert!(idx.get_path(Path::new("del_file.txt"), 2).is_none());
    assert!(idx.get_path(Path::new("del_file.txt"), 3).is_none());
}

#[test]
fn test_apply_conflict_resolution_stale_precondition_rejection() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("foo.txt"), b"base foo\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);

    git(&["checkout", "-b", "other"], root);
    fs::write(root.join("foo.txt"), b"other foo\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "other"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("foo.txt"), b"main foo\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "other"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "foo.txt").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    // External modification to worktree before resolve
    let external_edit = b"<<<<<<< HEAD\nmain foo\n=======\nother foo\n>>>>>>> other\nexternal typing";
    fs::write(root.join("foo.txt"), external_edit).unwrap();

    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version, // now stale!
        full_index_fingerprint: full_fp,
        action: ResolveAction::ReviewedText {
            tokens: vec!["stale attempted text\n".into()],
            eol: ResolveEol::Preserve,
            executable: None,
        },
        root: None,
        worktree_path: None,
    };

    // AC8 verification: must reject as Stale and ZERO mutation of worktree or index
    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Stale { required_refresh, reason } => {
            assert!(required_refresh);
            assert!(reason.contains("Snapshot version mismatch") || reason.contains("state changed"));
        }
        other => panic!("Expected Stale, got {other:?}"),
    }

    // Verify external edit was NOT overwritten
    assert_eq!(fs::read(root.join("foo.txt")).unwrap(), external_edit);
    let repo_after = git2::Repository::open(root).unwrap();
    assert!(repo_after.index().unwrap().has_conflicts());
}

#[test]
fn test_generic_stage_preflight_rejects_mixed_batch_cut1() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("conflict.txt"), b"base\n").unwrap();
    fs::write(root.join("clean.txt"), b"base clean\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);

    git(&["checkout", "-b", "feat"], root);
    fs::write(root.join("conflict.txt"), b"feat\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "feat"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("conflict.txt"), b"main\n").unwrap();
    git(&["add", "."], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "feat"], root);

    // Modify clean.txt in worktree
    fs::write(root.join("clean.txt"), b"modified clean\n").unwrap();

    // CUT1: Stage mixed batch ["clean.txt", "conflict.txt"] must fail BEFORE clean.txt stages
    let stage_res = stage_files(root, &["clean.txt", "conflict.txt"]);
    assert!(stage_res.is_err(), "Mixed batch staging must be rejected");

    // Check that clean.txt was NOT staged
    let repo = git2::Repository::open(root).unwrap();
    let index = repo.index().unwrap();
    let clean_entry = index.get_path(Path::new("clean.txt"), 0).unwrap();
    // In git, base clean was b"base clean\n" (len 11), while modified is len 15
    assert_eq!(
        clean_entry.file_size, 11,
        "clean.txt must remain at base size in index (NOT staged)"
    );

    // Clean-only batch staging still works
    let clean_res = stage_files(root, &["clean.txt"]);
    assert!(clean_res.is_ok(), "Clean-only batch staging must succeed");

    let repo_after = git2::Repository::open(root).unwrap();
    let index_after = repo_after.index().unwrap();
    let clean_entry_after = index_after.get_path(Path::new("clean.txt"), 0).unwrap();
    assert_eq!(clean_entry_after.file_size, 15, "clean.txt must now be staged");
}

#[test]
fn test_apply_conflict_resolution_reviewed_text_empty_and_executable() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("script.sh"), b"base script\n").unwrap();
    git(&["add", "script.sh"], root);
    git(&["commit", "-m", "base"], root);

    git(&["checkout", "-b", "side"], root);
    fs::write(root.join("script.sh"), b"side script\n").unwrap();
    git(&["add", "script.sh"], root);
    git(&["commit", "-m", "side"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("script.sh"), b"main script\n").unwrap();
    git(&["add", "script.sh"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "side"], root);

    let summary = get_conflicts_summary(root, None, None).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "script.sh").unwrap();
    let snapshot = get_conflict_snapshot(root, &entry.conflict_id).unwrap();
    let repo = git2::Repository::open(root).unwrap();
    let full_fp = dam_hopper_server::git::conflict::compute_full_index_fingerprint(&repo.index().unwrap());

    // AC6/AC7: Empty reviewed text with executable mode
    let req = ResolveRequest {
        conflict_id: entry.conflict_id.clone(),
        snapshot_version: snapshot.snapshot_version,
        full_index_fingerprint: full_fp,
        action: ResolveAction::ReviewedText {
            tokens: vec![], // valid empty text
            eol: ResolveEol::Preserve,
            executable: Some(true),
        },
        root: None,
        worktree_path: None,
    };

    let outcome = apply_conflict_resolution(root, &req).unwrap();
    match outcome {
        ResolveOutcome::Applied { stage0_mode, deleted, .. } => {
            assert!(!deleted);
            assert_eq!(stage0_mode, Some(0o100755));
        }
        other => panic!("Expected Applied, got {other:?}"),
    }

    assert_eq!(fs::read(root.join("script.sh")).unwrap(), b"");
    let repo_after = git2::Repository::open(root).unwrap();
    let s0 = repo_after.index().unwrap().get_path(Path::new("script.sh"), 0).unwrap();
    assert_eq!(s0.mode, 0o100755);
}
