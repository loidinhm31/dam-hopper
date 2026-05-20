use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use crate::git::bulk::ProjectRef;
use crate::git::cli_fallback::list_worktrees;
use crate::git::diff::{
    commit_files, discard_file, discard_hunk, get_conflicts, get_diff_files, get_file_diff,
    stage_files, unstage_files,
};
use crate::git::repository::{
    checkout_branch, cherry_pick, create_branch, get_log, get_status, list_branches,
    reset_to_commit, undo_last_commit, update_branch,
};
use crate::git::types::{
    CheckoutStrategy, GitProgressPhase, ResetMode, VcsRootKind, VcsRootMappingState,
};
use crate::git::{
    cherry_pick_commit_files, drop_commit, drop_commit_files, revert_commit, revert_commit_files,
};
use crate::git::{
    discover_vcs_roots, resolve_git_path_root, resolve_vcs_root, staged_vcs_root_ids,
    BulkGitService, WorktreeAddOptions,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn git(args: &[&str], cwd: &Path) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        status.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&status.stderr)
    );
}

fn git_output(args: &[&str], cwd: &Path) -> String {
    let output = Command::new("git")
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
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo_with_commit(dir: &Path) {
    git(&["init", "-b", "main"], dir);
    git(&["config", "user.email", "test@test.com"], dir);
    git(&["config", "user.name", "Test"], dir);

    std::fs::write(dir.join("README.md"), "# test").unwrap();
    git(&["add", "."], dir);
    git(&["commit", "-m", "init"], dir);
}

fn make_temp_repo() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    init_repo_with_commit(dir.path());
    dir
}

fn make_nested_repo(path: &Path) -> String {
    std::fs::create_dir_all(path).unwrap();
    init_repo_with_commit(path);
    git_output(&["rev-parse", "HEAD"], path)
}

fn make_remote_clone_repo() -> (TempDir, TempDir, TempDir) {
    let remote = tempfile::tempdir().unwrap();
    let seed = tempfile::tempdir().unwrap();
    let clone = tempfile::tempdir().unwrap();

    git(&["init", "--bare"], remote.path());
    init_repo_with_commit(seed.path());
    git(
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
        seed.path(),
    );
    git(&["push", "-u", "origin", "main"], seed.path());

    git(
        &[
            "clone",
            remote.path().to_str().unwrap(),
            clone.path().to_str().unwrap(),
        ],
        Path::new("/tmp"),
    );
    git(&["config", "user.email", "test@test.com"], clone.path());
    git(&["config", "user.name", "Test"], clone.path());

    (remote, seed, clone)
}

// ---------------------------------------------------------------------------
// Status tests
// ---------------------------------------------------------------------------

#[test]
fn status_clean_repo() {
    let repo = make_temp_repo();
    let status = get_status(repo.path(), "test-project").unwrap();

    assert_eq!(status.project_name, "test-project");
    assert_eq!(status.branch, "main");
    assert!(status.is_clean);
    assert_eq!(status.staged, 0);
    assert_eq!(status.modified, 0);
    assert_eq!(status.untracked, 0);
    assert!(!status.has_stash);
    assert!(!status.last_commit.hash.is_empty());
    assert_eq!(status.last_commit.message, "init");
}

#[test]
fn status_with_modifications() {
    let repo = make_temp_repo();
    let path = repo.path();

    // staged file
    std::fs::write(path.join("staged.txt"), "staged").unwrap();
    git(&["add", "staged.txt"], path);

    // modified file
    std::fs::write(path.join("README.md"), "modified").unwrap();

    // untracked file
    std::fs::write(path.join("untracked.txt"), "untracked").unwrap();

    let status = get_status(path, "proj").unwrap();
    assert_eq!(status.staged, 1);
    assert_eq!(status.modified, 1);
    assert_eq!(status.untracked, 1);
    assert!(!status.is_clean);
}

#[test]
fn status_nonexistent_path_returns_not_found() {
    let status = get_status(Path::new("/tmp/nonexistent-dam-hopper-test-xyz"), "ghost").unwrap();
    assert_eq!(status.path_exists, Some(false));
    assert!(status.is_clean);
}

#[test]
fn status_has_stash() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "stashable change").unwrap();
    git(&["stash"], path);

    let status = get_status(path, "stash-test").unwrap();
    assert!(status.has_stash);
}

// ---------------------------------------------------------------------------
// VCS root discovery tests
// ---------------------------------------------------------------------------

#[test]
fn vcs_roots_discovers_gitlinks_when_gitmodules_is_invalid() {
    let repo = make_temp_repo();
    let path = repo.path();
    let child_oid = make_nested_repo(&path.join("libs/mapped"));

    git(&["add", "libs/mapped"], path);
    std::fs::write(path.join(".gitmodules"), "not valid git config = [").unwrap();
    git(
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            "160000",
            &child_oid,
            "libs/missing",
        ],
        path,
    );

    let roots = discover_vcs_roots(path).unwrap();
    let mapped = roots
        .iter()
        .find(|root| root.root_id == "libs/mapped")
        .unwrap();
    let missing = roots
        .iter()
        .find(|root| root.root_id == "libs/missing")
        .unwrap();
    let primary = roots.iter().find(|root| root.root_id == ".").unwrap();

    assert_eq!(mapped.kind, VcsRootKind::Submodule);
    assert_eq!(mapped.mapping_state, Some(VcsRootMappingState::Unmapped));
    assert!(mapped.status.is_some());
    assert_eq!(missing.mapping_state, Some(VcsRootMappingState::Missing));
    assert!(primary
        .warnings
        .iter()
        .any(|warning| warning.contains("invalid .gitmodules")));
}

#[test]
fn vcs_roots_classifies_mapped_uninitialized_and_plain_nested_roots() {
    let repo = make_temp_repo();
    let path = repo.path();
    let child_oid = make_nested_repo(&path.join("modules/child"));
    make_nested_repo(&path.join("tools/plain"));
    std::fs::create_dir_all(path.join("modules/uninitialized")).unwrap();

    std::fs::write(
        path.join(".gitmodules"),
        "[submodule \"child\"]\n\tpath = modules/child\n\turl = ../child.git\n",
    )
    .unwrap();
    git(&["add", ".gitmodules", "modules/child"], path);
    git(
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            "160000",
            &child_oid,
            "modules/uninitialized",
        ],
        path,
    );

    let roots = discover_vcs_roots(path).unwrap();
    let child = roots
        .iter()
        .find(|root| root.root_id == "modules/child")
        .unwrap();
    let uninitialized = roots
        .iter()
        .find(|root| root.root_id == "modules/uninitialized")
        .unwrap();
    let plain = roots
        .iter()
        .find(|root| root.root_id == "tools/plain")
        .unwrap();

    assert_eq!(child.kind, VcsRootKind::Submodule);
    assert_eq!(child.mapping_state, Some(VcsRootMappingState::Mapped));
    assert_eq!(
        child.gitlink.as_ref().and_then(|info| info.url.as_deref()),
        Some("../child.git")
    );
    assert_eq!(
        uninitialized.mapping_state,
        Some(VcsRootMappingState::Uninitialized)
    );
    assert_eq!(plain.kind, VcsRootKind::NestedRepo);
    assert_eq!(
        resolve_vcs_root(path, "tools/plain").unwrap(),
        dunce::canonicalize(path.join("tools/plain")).unwrap()
    );
    assert!(resolve_vcs_root(path, "../escape").is_err());
}

#[test]
fn root_path_resolution_prefers_deepest_vcs_root_for_path_operations() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);

    let (root, paths) =
        resolve_git_path_root(path, None, &["modules/child/README.md".to_string()]).unwrap();

    assert_eq!(root.root_id, "modules/child");
    assert_eq!(paths, vec!["README.md"]);
}

#[test]
fn explicit_root_path_resolution_accepts_project_relative_child_paths() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);

    let (root, paths) = resolve_git_path_root(
        path,
        Some("modules/child"),
        &["modules/child/README.md".to_string()],
    )
    .unwrap();

    assert_eq!(root.root_id, "modules/child");
    assert_eq!(paths, vec!["README.md"]);
}

#[test]
fn explicit_root_path_resolution_accepts_root_relative_child_paths() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);

    let (root, paths) =
        resolve_git_path_root(path, Some("modules/child"), &["README.md".to_string()]).unwrap();

    assert_eq!(root.root_id, "modules/child");
    assert_eq!(paths, vec!["README.md"]);
}

#[test]
fn root_path_resolution_blocks_mixed_root_path_operations() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);

    let result = resolve_git_path_root(
        path,
        None,
        &[
            "README.md".to_string(),
            "modules/child/README.md".to_string(),
        ],
    );

    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// Branch tests
// ---------------------------------------------------------------------------

#[test]
fn list_branches_single_main() {
    let repo = make_temp_repo();
    let branches = list_branches(repo.path()).unwrap();

    assert!(!branches.is_empty());
    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert!(main.is_current);
    assert!(!main.is_remote);
    assert!(!main.last_commit.is_empty());
}

#[test]
fn list_branches_multiple_local() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/foo"], path);
    std::fs::write(path.join("foo.txt"), "foo").unwrap();
    git(&["add", "."], path);
    git(&["commit", "-m", "add foo"], path);
    git(&["checkout", "main"], path);

    let branches = list_branches(path).unwrap();
    let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    assert!(names.contains(&"main"));
    assert!(names.contains(&"feature/foo"));

    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert!(main.is_current);

    let feat = branches.iter().find(|b| b.name == "feature/foo").unwrap();
    assert!(!feat.is_current);
}

// ---------------------------------------------------------------------------
// Worktree tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_worktrees_shows_main() {
    let repo = make_temp_repo();
    let wts = list_worktrees(repo.path()).await.unwrap();

    assert_eq!(wts.len(), 1);
    assert!(wts[0].is_main);
    assert_eq!(wts[0].branch, "main");
    assert!(!wts[0].commit_hash.is_empty());
}

#[tokio::test]
async fn add_and_remove_worktree() {
    let repo = make_temp_repo();
    let path = repo.path();

    // Create another branch to check out in worktree
    git(&["branch", "wt-branch"], path);

    let wt = crate::git::add_worktree(
        path,
        WorktreeAddOptions {
            branch: "wt-branch".to_string(),
            path: None,
            create_branch: false,
            base_branch: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(wt.branch, "wt-branch");
    assert!(!wt.is_main);

    let wts = list_worktrees(path).await.unwrap();
    assert_eq!(wts.len(), 2);

    crate::git::remove_worktree(path, &wt.path).await.unwrap();

    let wts_after = list_worktrees(path).await.unwrap();
    assert_eq!(wts_after.len(), 1);
}

#[tokio::test]
async fn add_worktree_create_branch() {
    let repo = make_temp_repo();
    let path = repo.path();

    let wt = crate::git::add_worktree(
        path,
        WorktreeAddOptions {
            branch: "new-branch".to_string(),
            path: None,
            create_branch: true,
            base_branch: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(wt.branch, "new-branch");

    crate::git::remove_worktree(path, &wt.path).await.unwrap();
}

// ---------------------------------------------------------------------------
// BulkGitService tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn bulk_status_all() {
    let r1 = make_temp_repo();
    let r2 = make_temp_repo();

    let bulk = BulkGitService::default();
    let projects = vec![
        ProjectRef {
            name: "repo1",
            path: r1.path(),
        },
        ProjectRef {
            name: "repo2",
            path: r2.path(),
        },
    ];

    let statuses = bulk.status_all(&projects).await;
    assert_eq!(statuses.len(), 2);

    for s in &statuses {
        assert!(s.is_clean);
        assert!(!s.last_commit.hash.is_empty());
    }
}

#[tokio::test]
async fn bulk_status_handles_missing_path() {
    let bulk = BulkGitService::default();
    let projects = vec![ProjectRef {
        name: "ghost",
        path: Path::new("/tmp/nonexistent-bulk-test-xyz"),
    }];

    let statuses = bulk.status_all(&projects).await;
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].path_exists, Some(false));
}

#[tokio::test]
async fn bulk_respects_concurrency() {
    // Create 6 repos, concurrency=2 — should still complete all
    let repos: Vec<TempDir> = (0..6).map(|_| make_temp_repo()).collect();
    let bulk = BulkGitService::new(2);

    let projects: Vec<ProjectRef> = repos
        .iter()
        .enumerate()
        .map(|(i, r)| ProjectRef {
            name: Box::leak(format!("repo{i}").into_boxed_str()),
            path: r.path(),
        })
        .collect();

    let statuses = bulk.status_all(&projects).await;
    assert_eq!(statuses.len(), 6);
}

// ---------------------------------------------------------------------------
// Progress channel tests
// ---------------------------------------------------------------------------

#[test]
fn progress_channel_emit_receive() {
    use crate::git::progress::{create_progress_channel, emit_started};

    let tx = create_progress_channel();
    let mut rx = tx.subscribe();

    let tx_opt = Some(tx);
    emit_started(&tx_opt, "proj", "fetch", "Fetching...");

    let event = rx.try_recv().unwrap();
    assert_eq!(event.project_name, "proj");
    assert_eq!(event.operation, "fetch");
    assert!(matches!(event.phase, GitProgressPhase::Started));
    assert_eq!(event.message, "Fetching...");
}

#[test]
fn progress_channel_no_receiver_no_panic() {
    use crate::git::progress::{create_progress_channel, emit_completed};

    let tx = create_progress_channel();
    // No subscriber — should not panic
    let tx_opt = Some(tx);
    emit_completed(&tx_opt, "proj", "fetch", "Done");
}

// ---------------------------------------------------------------------------
// Diff tests
// ---------------------------------------------------------------------------

#[test]
fn diff_clean_repo_returns_empty() {
    let repo = make_temp_repo();
    let entries = get_diff_files(repo.path()).unwrap();
    assert!(entries.entries.is_empty());
}

#[test]
fn diff_unstaged_modified_file() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "modified content").unwrap();

    let entries = get_diff_files(path).unwrap();
    assert!(!entries.entries.is_empty());
    let entry = entries
        .entries
        .iter()
        .find(|e| e.path == "README.md" && !e.staged)
        .unwrap();
    assert_eq!(entry.status, "modified");
    assert!(!entry.staged);
}

#[test]
fn diff_staged_new_file() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("new.txt"), "hello").unwrap();
    git(&["add", "new.txt"], path);

    let entries = get_diff_files(path).unwrap();
    let staged = entries
        .entries
        .iter()
        .find(|e| e.path == "new.txt" && e.staged)
        .unwrap();
    assert_eq!(staged.status, "added");
    assert!(staged.staged);
}

#[test]
fn diff_includes_parent_gitlink_entry_for_dirty_submodule() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);
    git(&["commit", "-m", "add child submodule"], path);

    std::fs::write(path.join("modules/child/README.md"), "child dirty").unwrap();

    let entries = get_diff_files(path).unwrap();
    let submodule = entries
        .entries
        .iter()
        .find(|entry| entry.path == "modules/child" && !entry.staged)
        .expect("dirty submodule should appear in parent diff");

    assert_eq!(submodule.status, "modified");
    assert_eq!(
        submodule.submodule.as_ref().map(|info| info.path.as_str()),
        Some("modules/child")
    );
}

#[test]
fn child_root_stage_does_not_stage_parent_repo() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);
    git(&["commit", "-m", "add child submodule"], path);

    std::fs::write(path.join("modules/child/README.md"), "child staged").unwrap();
    let (root, paths) =
        resolve_git_path_root(path, None, &["modules/child/README.md".to_string()]).unwrap();
    let refs: Vec<&str> = paths.iter().map(|path| path.as_str()).collect();

    stage_files(&root.root_path, &refs).unwrap();

    assert_eq!(get_status(&root.root_path, "child").unwrap().staged, 1);
    assert_eq!(get_status(path, "parent").unwrap().staged, 0);
}

#[test]
fn staged_vcs_root_ids_detects_mixed_root_staged_state() {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    git(&["add", "modules/child"], path);
    git(&["commit", "-m", "add child submodule"], path);

    std::fs::write(path.join("parent.txt"), "parent").unwrap();
    stage_files(path, &["parent.txt"]).unwrap();

    std::fs::write(path.join("modules/child/child.txt"), "child").unwrap();
    stage_files(&path.join("modules/child"), &["child.txt"]).unwrap();

    let mut roots = staged_vcs_root_ids(path).unwrap();
    roots.sort();

    assert_eq!(roots, vec![".", "modules/child"]);
}

#[test]
fn get_file_diff_returns_original_and_modified() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "new content\n").unwrap();

    let diff = get_file_diff(path, "README.md").unwrap();
    assert_eq!(diff.path, "README.md");
    assert!(diff.original.is_some());
    assert_eq!(diff.original.as_deref(), Some("# test"));
    assert_eq!(diff.modified.as_deref(), Some("new content\n"));
    assert!(!diff.is_binary);
    assert!(!diff.hunks.is_empty());
}

#[test]
fn get_file_diff_new_file_has_no_original() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("brand-new.txt"), "content").unwrap();

    let diff = get_file_diff(path, "brand-new.txt").unwrap();
    assert!(diff.original.is_none());
    assert!(diff.modified.is_some());
}

#[test]
fn stage_and_unstage_file() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "changed").unwrap();

    stage_files(path, &["README.md"]).unwrap();

    let entries = get_diff_files(path).unwrap();
    let staged_entry = entries
        .entries
        .iter()
        .find(|e| e.path == "README.md" && e.staged);
    assert!(staged_entry.is_some(), "file should be staged");

    unstage_files(path, &["README.md"]).unwrap();

    let entries2 = get_diff_files(path).unwrap();
    let still_staged = entries2
        .entries
        .iter()
        .any(|e| e.path == "README.md" && e.staged);
    assert!(!still_staged, "file should be unstaged");
}

#[test]
fn discard_file_restores_content() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "changed content").unwrap();
    let before = std::fs::read_to_string(path.join("README.md")).unwrap();
    assert_eq!(before, "changed content");

    discard_file(path, "README.md").unwrap();

    let after = std::fs::read_to_string(path.join("README.md")).unwrap();
    assert_eq!(after, "# test");
}

#[test]
fn discard_hunk_reverts_specific_lines() {
    let repo = make_temp_repo();
    let path = repo.path();

    // Write a multi-line file and commit it
    std::fs::write(path.join("multi.txt"), "line1\nline2\nline3\nline4\n").unwrap();
    git(&["add", "multi.txt"], path);
    git(&["commit", "-m", "add multi"], path);

    // Modify only line2
    std::fs::write(path.join("multi.txt"), "line1\nMODIFIED\nline3\nline4\n").unwrap();

    let entries = get_diff_files(path).unwrap();
    assert!(entries
        .entries
        .iter()
        .any(|e| e.path == "multi.txt" && !e.staged));

    // Discard hunk 0
    discard_hunk(path, "multi.txt", 0).unwrap();

    let after = std::fs::read_to_string(path.join("multi.txt")).unwrap();
    assert!(after.contains("line2"), "line2 should be restored");
    assert!(!after.contains("MODIFIED"));
}

#[test]
fn safe_path_rejects_traversal() {
    let repo = make_temp_repo();
    let path = repo.path();

    let result = get_file_diff(path, "../etc/passwd");
    assert!(result.is_err());

    let result2 = stage_files(path, &["../../outside"]);
    assert!(result2.is_err());
}

#[test]
fn conflicts_empty_when_no_merge() {
    let repo = make_temp_repo();
    let conflicts = get_conflicts(repo.path()).unwrap();
    assert!(conflicts.is_empty());
}

#[tokio::test]
async fn create_branch_without_checkout_keeps_head() {
    let repo = make_temp_repo();
    let result = create_branch(repo.path(), "feature/test", None, false)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(result.branch.as_deref(), Some("feature/test"));
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], repo.path()),
        "main"
    );
    assert_eq!(
        git_output(&["branch", "--list", "feature/test"], repo.path()),
        "feature/test"
    );
}

#[tokio::test]
async fn create_branch_with_checkout_switches_head() {
    let repo = make_temp_repo();

    let result = create_branch(repo.path(), "feature/checked-out", None, true)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(result.branch.as_deref(), Some("feature/checked-out"));
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], repo.path()),
        "feature/checked-out"
    );
}

#[tokio::test]
async fn checkout_branch_normal_returns_dirty_result() {
    let repo = make_temp_repo();
    let path = repo.path();
    git(&["branch", "feature/test"], path);
    std::fs::write(path.join("README.md"), "dirty").unwrap();

    let result = checkout_branch(path, "feature/test", None, false, CheckoutStrategy::Normal)
        .await
        .unwrap();

    assert!(!result.ok);
    assert_eq!(result.dirty, Some(true));
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], path),
        "main"
    );
}

#[tokio::test]
async fn checkout_branch_stash_switches_and_reports_stash() {
    let repo = make_temp_repo();
    let path = repo.path();
    git(&["branch", "feature/test"], path);
    std::fs::write(path.join("README.md"), "dirty").unwrap();

    let result = checkout_branch(path, "feature/test", None, false, CheckoutStrategy::Stash)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(result.branch.as_deref(), Some("feature/test"));
    assert_eq!(result.stashed, Some(true));
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], path),
        "feature/test"
    );
    assert_eq!(git_output(&["stash", "list"], path).lines().count(), 1);
}

#[tokio::test]
async fn checkout_branch_force_discards_local_changes() {
    let repo = make_temp_repo();
    let path = repo.path();
    git(&["branch", "feature/test"], path);
    std::fs::write(path.join("README.md"), "dirty").unwrap();

    let result = checkout_branch(path, "feature/test", None, false, CheckoutStrategy::Force)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(result.destructive, Some(true));
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], path),
        "feature/test"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("README.md")).unwrap(),
        "# test"
    );
}

#[tokio::test]
async fn checkout_branch_invalid_name_rejected() {
    let repo = make_temp_repo();
    let err = checkout_branch(
        repo.path(),
        "bad branch",
        None,
        false,
        CheckoutStrategy::Normal,
    )
    .await
    .unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
}

#[tokio::test]
async fn checkout_remote_branch_creates_tracking_local_branch() {
    let (_remote, seed, clone) = make_remote_clone_repo();

    git(&["checkout", "-b", "feature/remote"], seed.path());
    std::fs::write(seed.path().join("remote.txt"), "remote branch").unwrap();
    git(&["add", "remote.txt"], seed.path());
    git(&["commit", "-m", "remote branch"], seed.path());
    git(&["push", "-u", "origin", "feature/remote"], seed.path());

    git(&["fetch", "origin"], clone.path());

    let result = checkout_branch(
        clone.path(),
        "origin/feature/remote",
        None,
        false,
        CheckoutStrategy::Normal,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.branch.as_deref(), Some("feature/remote"));
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], clone.path()),
        "feature/remote"
    );
}

#[tokio::test]
async fn cherry_pick_conflict_returns_structured_result() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/conflict"], path);
    std::fs::write(path.join("README.md"), "feature change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "feature change"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("README.md"), "main change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "main change"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "feature/conflict"], path);

    let result = cherry_pick(path, &target_hash).await.unwrap();
    assert!(!result.ok);
    assert_eq!(result.conflict, Some(true));
}

#[tokio::test]
async fn cherry_pick_success_returns_hash() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/success"], path);
    std::fs::write(path.join("feature.txt"), "feature change\n").unwrap();
    git(&["add", "feature.txt"], path);
    git(&["commit", "-m", "feature change"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    let result = cherry_pick(path, &target_hash).await.unwrap();

    assert!(result.ok);
    assert_eq!(result.hash.as_deref(), Some(target_hash.as_str()));
    assert_eq!(
        std::fs::read_to_string(path.join("feature.txt")).unwrap(),
        "feature change\n"
    );
}

#[tokio::test]
async fn cherry_pick_commit_files_applies_only_selected_paths() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/files"], path);
    std::fs::write(path.join("one.txt"), "one\n").unwrap();
    std::fs::write(path.join("two.txt"), "two\n").unwrap();
    git(&["add", "one.txt", "two.txt"], path);
    git(&["commit", "-m", "two files"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    let result = cherry_pick_commit_files(path, &target_hash, &["one.txt".to_string()])
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(
        std::fs::read_to_string(path.join("one.txt")).unwrap(),
        "one\n"
    );
    assert!(!path.join("two.txt").exists());
    assert_eq!(
        git_output(&["rev-list", "--count", "HEAD"], path),
        "1",
        "selected file cherry-pick should leave changes uncommitted"
    );
}

#[tokio::test]
async fn cherry_pick_invalid_hash_rejected() {
    let repo = make_temp_repo();
    let err = cherry_pick(repo.path(), "not-a-hash").await.unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
}

#[tokio::test]
async fn drop_commit_files_removes_selected_path_from_head_commit() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("one.txt"), "one\n").unwrap();
    std::fs::write(path.join("two.txt"), "two\n").unwrap();
    git(&["add", "one.txt", "two.txt"], path);
    git(&["commit", "-m", "two files"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    let result = drop_commit_files(path, &target_hash, &["one.txt".to_string()])
        .await
        .unwrap();

    assert!(result.ok);
    assert!(!path.join("one.txt").exists());
    assert_eq!(
        std::fs::read_to_string(path.join("two.txt")).unwrap(),
        "two\n"
    );
    assert_eq!(git_output(&["log", "-1", "--pretty=%s"], path), "two files");
    assert_eq!(git_output(&["status", "--porcelain"], path), "");
}

#[tokio::test]
async fn drop_commit_files_rejects_pushed_commit() {
    let (_remote, seed, _clone) = make_remote_clone_repo();
    let path = seed.path();
    let pushed_hash = git_output(&["rev-parse", "HEAD"], path);

    let result = drop_commit_files(path, &pushed_hash, &["README.md".to_string()])
        .await
        .unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::PushedCommit)
    );
    assert_eq!(result.destructive, Some(false));
    assert!(result
        .recommendation
        .as_deref()
        .unwrap_or_default()
        .contains("revert"));
}

#[tokio::test]
async fn drop_commit_blocks_root_commit_with_structured_reason() {
    let repo = make_temp_repo();
    let path = repo.path();
    let root_hash = git_output(&["rev-list", "--max-parents=0", "HEAD"], path);

    let result = drop_commit(path, &root_hash).await.unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::RootCommit)
    );
    assert_eq!(result.hash.as_deref(), Some(root_hash.as_str()));
    assert!(result
        .recommendation
        .as_deref()
        .unwrap_or_default()
        .contains("replacement commit"));
}

#[tokio::test]
async fn drop_commit_removes_head_commit_with_reset() {
    let repo = make_temp_repo();
    let path = repo.path();
    let initial = git_output(&["rev-parse", "HEAD"], path);

    std::fs::write(path.join("head.txt"), "head\n").unwrap();
    git(&["add", "head.txt"], path);
    git(&["commit", "-m", "head commit"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    let result = drop_commit(path, &target_hash).await.unwrap();

    assert!(result.ok);
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), initial);
    assert!(!path.join("head.txt").exists());
    assert_eq!(git_output(&["status", "--porcelain"], path), "");
}

#[tokio::test]
async fn drop_commit_removes_non_head_commit_and_replays_descendants() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("drop.txt"), "drop\n").unwrap();
    git(&["add", "drop.txt"], path);
    git(&["commit", "-m", "drop me"], path);
    let dropped_hash = git_output(&["rev-parse", "HEAD"], path);

    std::fs::write(path.join("keep.txt"), "keep\n").unwrap();
    git(&["add", "keep.txt"], path);
    git(&["commit", "-m", "keep me"], path);

    let result = drop_commit(path, &dropped_hash).await.unwrap();

    assert!(result.ok);
    assert!(!path.join("drop.txt").exists());
    assert_eq!(
        std::fs::read_to_string(path.join("keep.txt")).unwrap(),
        "keep\n"
    );
    assert_eq!(git_output(&["rev-list", "--count", "HEAD"], path), "2");
    assert_eq!(git_output(&["log", "-1", "--pretty=%s"], path), "keep me");
}

#[tokio::test]
async fn drop_commit_blocks_when_rebase_is_active() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/rebase-block"], path);
    std::fs::write(path.join("README.md"), "feature change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "feature change"], path);
    let feature_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("README.md"), "main change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "main change"], path);

    git(&["checkout", "feature/rebase-block"], path);
    let output = Command::new("git")
        .args(["rebase", "main"])
        .current_dir(path)
        .output()
        .expect("git rebase failed to spawn");
    assert!(!output.status.success(), "rebase should conflict");

    let result = drop_commit(path, &feature_hash).await.unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::ActiveOperation)
    );
    assert_eq!(
        result.recovery.as_ref().map(|r| &r.operation),
        Some(&crate::git::GitRecoveryOperation::Rebase)
    );
}

#[tokio::test]
async fn drop_commit_blocks_when_cherry_pick_is_active() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/cherry-pick-block"], path);
    std::fs::write(path.join("README.md"), "feature change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "feature change"], path);
    let feature_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("README.md"), "main change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "main change"], path);
    let main_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "feature/cherry-pick-block"], path);
    let output = Command::new("git")
        .args(["cherry-pick", &main_hash])
        .current_dir(path)
        .output()
        .expect("git cherry-pick failed to spawn");
    assert!(!output.status.success(), "cherry-pick should conflict");

    let result = drop_commit(path, &feature_hash).await.unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::ActiveOperation)
    );
    assert_eq!(
        result.recovery.as_ref().map(|r| &r.operation),
        Some(&crate::git::GitRecoveryOperation::CherryPick)
    );
}

#[tokio::test]
async fn drop_commit_conflict_returns_recoverable_rebase_state() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "drop base\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "drop base"], path);
    let dropped_hash = git_output(&["rev-parse", "HEAD"], path);

    std::fs::write(path.join("README.md"), "descendant\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "descendant"], path);

    let result = drop_commit(path, &dropped_hash).await.unwrap();

    assert!(!result.ok);
    assert_eq!(result.conflict, Some(true));
    assert_eq!(
        result.recovery.as_ref().map(|r| &r.operation),
        Some(&crate::git::GitRecoveryOperation::Rebase)
    );
}

#[tokio::test]
async fn revert_commit_creates_inverse_commit_for_shared_history() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("shared.txt"), "shared\n").unwrap();
    git(&["add", "shared.txt"], path);
    git(&["commit", "-m", "shared commit"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    let result = revert_commit(path, &target_hash).await.unwrap();

    assert!(result.ok);
    assert!(!path.join("shared.txt").exists());
    assert!(git_output(&["log", "-1", "--pretty=%s"], path).contains("Revert"));
}

#[tokio::test]
async fn revert_commit_files_changes_only_selected_path_in_worktree() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("one.txt"), "one\n").unwrap();
    std::fs::write(path.join("two.txt"), "two\n").unwrap();
    git(&["add", "one.txt", "two.txt"], path);
    git(&["commit", "-m", "two files"], path);
    let target_hash = git_output(&["rev-parse", "HEAD"], path);

    let result = revert_commit_files(path, &target_hash, &["one.txt".to_string()])
        .await
        .unwrap();

    assert!(result.ok);
    assert!(!path.join("one.txt").exists());
    assert_eq!(
        std::fs::read_to_string(path.join("two.txt")).unwrap(),
        "two\n"
    );
    let status = git_output(&["status", "--porcelain"], path);
    assert!(status.contains("one.txt"));
    assert!(!status.contains("two.txt"));
}

#[tokio::test]
async fn reset_to_commit_soft_moves_head() {
    let repo = make_temp_repo();
    let path = repo.path();
    let initial = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("next.txt"), "next").unwrap();
    git(&["add", "next.txt"], path);
    git(&["commit", "-m", "next"], path);

    let result = reset_to_commit(path, &initial, ResetMode::Soft)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), initial);
    assert_eq!(
        git_output(&["diff", "--cached", "--name-only"], path),
        "next.txt"
    );
}

#[tokio::test]
async fn undo_last_commit_moves_changes_to_unstaged_worktree() {
    let repo = make_temp_repo();
    let path = repo.path();
    let initial = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("undo.txt"), "undo\n").unwrap();
    git(&["add", "undo.txt"], path);
    git(&["commit", "-m", "undo me"], path);
    let undone = git_output(&["rev-parse", "HEAD"], path);

    let result = undo_last_commit(path).await.unwrap();

    assert!(result.ok);
    assert_eq!(result.hash.as_deref(), Some(undone.as_str()));
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), initial);
    assert_eq!(git_output(&["status", "--porcelain"], path), "?? undo.txt");
    assert_eq!(git_output(&["diff", "--cached", "--name-only"], path), "");
}

#[tokio::test]
async fn undo_last_commit_blocks_root_commit() {
    let repo = make_temp_repo();
    let path = repo.path();

    let result = undo_last_commit(path).await.unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::RootCommit)
    );
}

#[tokio::test]
async fn undo_last_commit_blocks_pushed_head_commit() {
    let (_remote, seed, _clone) = make_remote_clone_repo();
    let path = seed.path();
    std::fs::write(path.join("pushed.txt"), "pushed\n").unwrap();
    git(&["add", "pushed.txt"], path);
    git(&["commit", "-m", "pushed head"], path);
    git(&["push"], path);
    let pushed_hash = git_output(&["rev-parse", "HEAD"], path);

    let result = undo_last_commit(path).await.unwrap();

    assert!(!result.ok);
    assert_eq!(result.hash.as_deref(), Some(pushed_hash.as_str()));
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::PushedCommit)
    );
    assert!(result
        .recommendation
        .as_deref()
        .unwrap_or_default()
        .contains("revert"));
}

#[tokio::test]
async fn undo_last_commit_blocks_when_rebase_is_active() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/undo-rebase-block"], path);
    std::fs::write(path.join("README.md"), "feature change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "feature change"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("README.md"), "main change\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "main change"], path);

    git(&["checkout", "feature/undo-rebase-block"], path);
    let output = Command::new("git")
        .args(["rebase", "main"])
        .current_dir(path)
        .output()
        .expect("git rebase failed to spawn");
    assert!(!output.status.success(), "rebase should conflict");

    let result = undo_last_commit(path).await.unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::ActiveOperation)
    );
    assert_eq!(
        result.recovery.as_ref().map(|r| &r.operation),
        Some(&crate::git::GitRecoveryOperation::Rebase)
    );
}

#[tokio::test]
async fn reset_to_commit_hard_discards_worktree_changes() {
    let repo = make_temp_repo();
    let path = repo.path();
    let initial = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("README.md"), "changed").unwrap();

    let result = reset_to_commit(path, &initial, ResetMode::Hard)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(result.destructive, Some(true));
    assert_eq!(
        std::fs::read_to_string(path.join("README.md")).unwrap(),
        "# test"
    );
}

#[tokio::test]
async fn reset_to_commit_keep_preserves_worktree_changes() {
    let repo = make_temp_repo();
    let path = repo.path();
    let initial = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("next.txt"), "next").unwrap();
    git(&["add", "next.txt"], path);
    git(&["commit", "-m", "next"], path);
    std::fs::write(path.join("local.txt"), "local change").unwrap();

    let result = reset_to_commit(path, &initial, ResetMode::Keep)
        .await
        .unwrap();

    assert!(result.ok);
    assert_eq!(result.destructive, Some(false));
    assert_eq!(
        std::fs::read_to_string(path.join("local.txt")).unwrap(),
        "local change"
    );
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), initial);
}

#[tokio::test]
async fn reset_to_commit_invalid_hash_rejected() {
    let repo = make_temp_repo();
    let err = reset_to_commit(repo.path(), "bad-hash", ResetMode::Hard)
        .await
        .unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
}

#[test]
fn commit_files_supports_amend() {
    let repo = make_temp_repo();
    let path = repo.path();
    let original = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("before.txt"), "before").unwrap();
    git(&["add", "before.txt"], path);
    git(&["commit", "-m", "before amend"], path);

    std::fs::write(path.join("README.md"), "amended").unwrap();
    git(&["add", "README.md"], path);

    let amended = commit_files(path, "amended commit", true).unwrap();

    assert_ne!(amended, original);
    assert_eq!(
        git_output(&["log", "-1", "--pretty=%s"], path),
        "amended commit"
    );
    assert_eq!(git_output(&["rev-list", "--count", "HEAD"], path), "2");
}

#[test]
fn get_log_shows_current_branch_history_only() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature"], path);
    std::fs::write(path.join("feature.txt"), "feature").unwrap();
    git(&["add", "feature.txt"], path);
    git(&["commit", "-m", "feature only"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("main.txt"), "main").unwrap();
    git(&["add", "main.txt"], path);
    git(&["commit", "-m", "main only"], path);

    let messages: Vec<_> = get_log(path, 10, 0, None)
        .unwrap()
        .into_iter()
        .map(|entry| entry.message)
        .collect();

    assert!(messages.iter().any(|message| message == "main only"));
    assert!(messages.iter().any(|message| message == "init"));
    assert!(!messages.iter().any(|message| message == "feature only"));
}

#[test]
fn get_log_supports_offset_pagination() {
    let repo = make_temp_repo();
    let path = repo.path();

    for idx in 1..=3 {
        let file_name = format!("commit-{idx}.txt");
        let message = format!("commit {idx}");
        std::fs::write(path.join(&file_name), message.as_bytes()).unwrap();
        git(&["add", &file_name], path);
        git(&["commit", "-m", &message], path);
    }

    let first_page: Vec<_> = get_log(path, 2, 0, None)
        .unwrap()
        .into_iter()
        .map(|entry| entry.message)
        .collect();
    let second_page: Vec<_> = get_log(path, 2, 2, None)
        .unwrap()
        .into_iter()
        .map(|entry| entry.message)
        .collect();

    assert_eq!(first_page, vec!["commit 3", "commit 2"]);
    assert_eq!(second_page, vec!["commit 1", "init"]);
}

#[test]
fn get_log_can_read_an_explicit_branch_without_checkout() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature"], path);
    std::fs::write(path.join("feature.txt"), "feature").unwrap();
    git(&["add", "feature.txt"], path);
    git(&["commit", "-m", "feature only"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("main.txt"), "main").unwrap();
    git(&["add", "main.txt"], path);
    git(&["commit", "-m", "main only"], path);

    let messages: Vec<_> = get_log(path, 10, 0, Some("feature"))
        .unwrap()
        .into_iter()
        .map(|entry| entry.message)
        .collect();

    assert!(messages.iter().any(|message| message == "feature only"));
    assert!(messages.iter().any(|message| message == "init"));
    assert!(!messages.iter().any(|message| message == "main only"));
}

#[test]
fn update_branch_invalid_name_rejected() {
    let repo = make_temp_repo();
    let err = update_branch(repo.path(), "bad branch", "origin").unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
}
