use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use crate::git::cli_fallback::list_worktrees;
use crate::git::diff::{
    discard_file, discard_hunk, get_conflicts, get_diff_files, get_file_diff,
    stage_files, unstage_files,
};
use crate::git::repository::{get_status, list_branches};
use crate::git::types::GitProgressPhase;
use crate::git::{BulkGitService, WorktreeAddOptions};
use crate::git::bulk::ProjectRef;

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
    let status = get_status(Path::new("/tmp/nonexistent-dev-hub-test-xyz"), "ghost").unwrap();
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
        ProjectRef { name: "repo1", path: r1.path() },
        ProjectRef { name: "repo2", path: r2.path() },
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
    let entry = entries.entries.iter().find(|e| e.path == "README.md" && !e.staged).unwrap();
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
    let staged = entries.entries.iter().find(|e| e.path == "new.txt" && e.staged).unwrap();
    assert_eq!(staged.status, "added");
    assert!(staged.staged);
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
    let staged_entry = entries.entries.iter().find(|e| e.path == "README.md" && e.staged);
    assert!(staged_entry.is_some(), "file should be staged");

    unstage_files(path, &["README.md"]).unwrap();

    let entries2 = get_diff_files(path).unwrap();
    let still_staged = entries2.entries.iter().any(|e| e.path == "README.md" && e.staged);
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
    assert!(entries.entries.iter().any(|e| e.path == "multi.txt" && !e.staged));

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
