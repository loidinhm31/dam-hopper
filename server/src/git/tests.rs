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
    checkout_branch, cherry_pick, create_branch, delete_branch, get_log, get_status, list_branches,
    push, reset_to_commit, undo_last_commit, update_branch,
};
use crate::git::types::{
    CheckoutStrategy, GitProgressPhase, PublishPreview, PublishResultStatus, ResetMode,
    VcsRootKind, VcsRootMappingState,
};
use crate::git::{
    cherry_pick_commit_files, drop_commit, drop_commit_files, edit_commit_message,
    get_commit_message, revert_commit, revert_commit_files,
};
use crate::git::{
    discover_available_vcs_roots, discover_vcs_roots, resolve_git_path_root,
    resolve_git_request_root, resolve_vcs_root, staged_vcs_root_ids, BulkGitService,
    WorktreeAddOptions,
};
use crate::git::{prepare_leased_push, publish_leased_push};

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

fn configure_test_repo(dir: &Path) {
    git(&["config", "core.autocrlf", "false"], dir);
    git(&["config", "core.eol", "lf"], dir);
}

fn init_repo_with_commit(dir: &Path) {
    git(&["init", "-b", "main"], dir);
    configure_test_repo(dir);
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

fn make_parent_with_child_roots() -> TempDir {
    let repo = make_temp_repo();
    let path = repo.path();
    make_nested_repo(&path.join("modules/child"));
    make_nested_repo(&path.join("modules/sibling"));
    git(&["add", "modules/child", "modules/sibling"], path);
    git(&["commit", "-m", "add child roots"], path);
    repo
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
    git(&["symbolic-ref", "HEAD", "refs/heads/main"], remote.path());

    git(
        &[
            "clone",
            remote.path().to_str().unwrap(),
            clone.path().to_str().unwrap(),
        ],
        seed.path(),
    );
    configure_test_repo(clone.path());
    git(&["config", "user.email", "test@test.com"], clone.path());
    git(&["config", "user.name", "Test"], clone.path());
    (remote, seed, clone)
}

fn clone_repo(remote: &Path, dest: &Path) {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let cwd = dest.parent().filter(|p| p.exists()).unwrap_or(remote);
    git(
        &["clone", remote.to_str().unwrap(), dest.to_str().unwrap()],
        cwd,
    );
    configure_test_repo(dest);
    git(&["config", "user.email", "test@test.com"], dest);
    git(&["config", "user.name", "Test"], dest);
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

#[test]
fn vcs_root_resolution_rejects_aggregate_unknown_and_escaping_roots() {
    let repo = make_temp_repo();
    let path = repo.path();

    assert!(resolve_git_request_root(path, Some("*")).is_err());
    assert!(resolve_git_request_root(path, Some("modules/missing")).is_err());
    assert!(resolve_git_request_root(path, Some("../escape")).is_err());
    assert!(resolve_git_request_root(path, Some("/tmp")).is_err());
}

#[test]
fn plain_directory_root_resolution_is_typed_unavailable() {
    let directory = tempfile::tempdir().unwrap();
    let error = resolve_git_request_root(directory.path(), None).unwrap_err();
    assert!(matches!(error, crate::error::AppError::GitUnavailable));
}

#[cfg(unix)]
#[test]
fn dangling_git_marker_is_typed_unavailable() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    symlink(
        directory.path().join("missing-git-dir"),
        directory.path().join(concat!(".", "git")),
    )
    .unwrap();
    let error = resolve_git_request_root(directory.path(), None).unwrap_err();
    assert!(matches!(error, crate::error::AppError::GitUnavailable));
}

#[cfg(unix)]
#[test]
fn git_marker_metadata_errors_remain_generic_io_failures() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join(concat!(".", "git"));
    symlink(&marker, &marker).unwrap();

    let error = discover_available_vcs_roots(directory.path()).unwrap_err();
    assert!(matches!(error, crate::error::AppError::Io(_)));
}

// ---------------------------------------------------------------------------
// Branch tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn push_to_local_bare_remote_succeeds() {
    let (remote, _seed, clone) = make_remote_clone_repo();

    std::fs::write(clone.path().join("push.txt"), "push me\n").unwrap();
    git(&["add", "push.txt"], clone.path());
    git(&["commit", "-m", "push change"], clone.path());

    let result = push(clone.path(), "clone", &None, None).await;

    assert!(result.success, "{result:?}");
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], remote.path()),
        git_output(&["rev-parse", "HEAD"], clone.path())
    );
}

#[tokio::test]
async fn push_without_upstream_returns_clear_error() {
    let repo = make_temp_repo();

    std::fs::write(repo.path().join("local.txt"), "local only\n").unwrap();
    git(&["add", "local.txt"], repo.path());
    git(&["commit", "-m", "local change"], repo.path());

    let result = push(repo.path(), "local", &None, None).await;
    let error = result.error.clone().unwrap_or_default().to_lowercase();

    assert!(!result.success, "{result:?}");
    assert!(
        error.contains("no configured push destination")
            || error.contains("no configured upstream branch"),
        "unexpected error: {error}"
    );
}

#[tokio::test]
async fn push_selected_nested_root_only_updates_that_remote() {
    let parent = make_temp_repo();
    let child_remote = tempfile::tempdir().unwrap();
    let child_seed = tempfile::tempdir().unwrap();
    let child_path = parent.path().join("modules/child");

    git(&["init", "--bare"], child_remote.path());
    init_repo_with_commit(child_seed.path());
    git(
        &[
            "remote",
            "add",
            "origin",
            child_remote.path().to_str().unwrap(),
        ],
        child_seed.path(),
    );
    git(&["push", "-u", "origin", "main"], child_seed.path());
    clone_repo(child_remote.path(), &child_path);

    let parent_head_before = git_output(&["rev-parse", "HEAD"], parent.path());

    std::fs::write(child_path.join("nested.txt"), "nested push\n").unwrap();
    git(&["add", "nested.txt"], &child_path);
    git(&["commit", "-m", "nested change"], &child_path);

    let result = push(&child_path, "child", &None, None).await;

    assert!(result.success, "{result:?}");
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], child_remote.path()),
        git_output(&["rev-parse", "HEAD"], &child_path)
    );
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], parent.path()),
        parent_head_before
    );
}

#[tokio::test]
async fn push_rejects_non_fast_forward_remote_history() {
    let (remote, seed, clone) = make_remote_clone_repo();

    std::fs::write(clone.path().join("remote.txt"), "remote\n").unwrap();
    git(&["add", "remote.txt"], clone.path());
    git(&["commit", "-m", "remote commit"], clone.path());
    git(&["push"], clone.path());

    std::fs::write(seed.path().join("local.txt"), "local\n").unwrap();
    git(&["add", "local.txt"], seed.path());
    git(&["commit", "-m", "local rewrite"], seed.path());

    let regular_push = push(seed.path(), "seed", &None, None).await;
    assert!(!regular_push.success, "{regular_push:?}");
    assert_ne!(
        git_output(&["rev-parse", "HEAD"], remote.path()),
        git_output(&["rev-parse", "HEAD"], seed.path())
    );
}

#[tokio::test]
async fn leased_push_prepare_captures_snapshot_and_publishes_matching_lease() {
    let (remote, seed, clone) = make_remote_clone_repo();

    std::fs::write(clone.path().join("remote.txt"), "remote\n").unwrap();
    git(&["add", "remote.txt"], clone.path());
    git(&["commit", "-m", "remote commit"], clone.path());
    git(&["push"], clone.path());

    std::fs::write(seed.path().join("local.txt"), "local\n").unwrap();
    git(&["add", "local.txt"], seed.path());
    git(&["commit", "-m", "local rewrite"], seed.path());

    let preview = prepare_leased_push(seed.path(), seed.path(), None)
        .await
        .expect("prepare_leased_push should succeed");

    let snapshot = match preview {
        PublishPreview::Ready {
            snapshot,
            already_current,
        } => {
            assert!(!already_current);
            assert_eq!(snapshot.branch, "refs/heads/main");
            assert_eq!(snapshot.remote_name, "origin");
            assert_eq!(snapshot.destination_ref, "refs/heads/main");
            assert_eq!(
                snapshot.expected_remote_oid,
                git_output(&["rev-parse", "HEAD"], remote.path())
            );
            assert_eq!(
                snapshot.source_oid,
                git_output(&["rev-parse", "HEAD"], seed.path())
            );
            snapshot
        }
        PublishPreview::Blocked { reason, message } => {
            panic!("expected ready preview, got blocked {reason:?}: {message}");
        }
    };

    let pub_res = publish_leased_push(seed.path(), seed.path(), "seed", &snapshot, &None, None)
        .await
        .expect("publish_leased_push should succeed");

    assert_eq!(pub_res.status, PublishResultStatus::Published);
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], remote.path()),
        git_output(&["rev-parse", "HEAD"], seed.path())
    );
}

#[tokio::test]
async fn leased_push_rejects_stale_remote_when_remote_advances_after_preview() {
    let (remote, seed, clone) = make_remote_clone_repo();

    std::fs::write(seed.path().join("local.txt"), "local\n").unwrap();
    git(&["add", "local.txt"], seed.path());
    git(&["commit", "-m", "local commit"], seed.path());

    let preview = prepare_leased_push(seed.path(), seed.path(), None)
        .await
        .expect("prepare_leased_push should succeed");

    let snapshot = match preview {
        PublishPreview::Ready { snapshot, .. } => snapshot,
        PublishPreview::Blocked { reason, message } => {
            panic!("expected ready preview, got blocked {reason:?}: {message}");
        }
    };

    // Advance remote independently from clone
    std::fs::write(clone.path().join("concurrent.txt"), "concurrent\n").unwrap();
    git(&["add", "concurrent.txt"], clone.path());
    git(&["commit", "-m", "concurrent commit"], clone.path());
    git(&["push"], clone.path());
    let concurrent_head = git_output(&["rev-parse", "HEAD"], remote.path());

    let pub_res = publish_leased_push(seed.path(), seed.path(), "seed", &snapshot, &None, None)
        .await
        .expect("publish should return result without panic");

    assert_eq!(pub_res.status, PublishResultStatus::StaleRemote);
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], remote.path()),
        concurrent_head,
        "remote HEAD must be preserved and not overwritten on stale lease"
    );
}

#[tokio::test]
async fn leased_push_already_current_returns_no_op_without_push() {
    let (_remote, seed, _clone) = make_remote_clone_repo();

    let preview = prepare_leased_push(seed.path(), seed.path(), None)
        .await
        .expect("prepare should succeed");

    let snapshot = match preview {
        PublishPreview::Ready {
            snapshot,
            already_current,
        } => {
            assert!(already_current);
            snapshot
        }
        PublishPreview::Blocked { reason, message } => {
            panic!("expected ready preview, got blocked {reason:?}: {message}");
        }
    };

    let pub_res = publish_leased_push(seed.path(), seed.path(), "seed", &snapshot, &None, None)
        .await
        .expect("publish should return result");

    assert_eq!(pub_res.status, PublishResultStatus::AlreadyCurrent);
}

#[tokio::test]
async fn leased_push_rejects_stale_local_when_local_tip_changes_after_preview() {
    let (_remote, seed, _clone) = make_remote_clone_repo();

    std::fs::write(seed.path().join("local1.txt"), "local1\n").unwrap();
    git(&["add", "local1.txt"], seed.path());
    git(&["commit", "-m", "local 1"], seed.path());

    let preview = prepare_leased_push(seed.path(), seed.path(), None)
        .await
        .expect("prepare should succeed");

    let snapshot = match preview {
        PublishPreview::Ready { snapshot, .. } => snapshot,
        PublishPreview::Blocked { reason, message } => {
            panic!("expected ready preview, got blocked {reason:?}: {message}");
        }
    };

    // Advance local branch further
    std::fs::write(seed.path().join("local2.txt"), "local2\n").unwrap();
    git(&["add", "local2.txt"], seed.path());
    git(&["commit", "-m", "local 2"], seed.path());

    let pub_res = publish_leased_push(seed.path(), seed.path(), "seed", &snapshot, &None, None)
        .await
        .expect("publish should return result");

    assert_eq!(pub_res.status, PublishResultStatus::StaleLocal);
}
#[test]
fn leased_push_update_reference_records_rejection() {
    let remote_rejection = std::sync::Arc::new(parking_lot::Mutex::new(None));
    let err = crate::git::repository::handle_push_update_reference(
        &remote_rejection,
        "refs/heads/main",
        Some("pre-receive hook declined"),
    )
    .expect_err("remote rejection should be error");

    assert_eq!(
        remote_rejection.lock().as_deref(),
        Some("Remote rejected refs/heads/main: pre-receive hook declined")
    );
    assert_eq!(
        err.message(),
        "Remote rejected refs/heads/main: pre-receive hook declined"
    );
}

#[tokio::test]
async fn leased_push_negotiation_detects_mismatched_remote_oid() {
    let (remote, seed, _clone) = make_remote_clone_repo();

    std::fs::write(seed.path().join("file.txt"), "content\n").unwrap();
    git(&["add", "file.txt"], seed.path());
    git(&["commit", "-m", "commit"], seed.path());

    let preview = prepare_leased_push(seed.path(), seed.path(), None)
        .await
        .expect("prepare should succeed");

    let mut snapshot = match preview {
        PublishPreview::Ready { snapshot, .. } => snapshot,
        other => panic!("expected Ready preview, got {other:?}"),
    };

    // Mutate snapshot expected_remote_oid to a bogus OID
    snapshot.expected_remote_oid = "0123456789abcdef0123456789abcdef01234567".to_string();

    let remote_head_before = git_output(&["rev-parse", "HEAD"], remote.path());

    let pub_res = publish_leased_push(seed.path(), seed.path(), "seed", &snapshot, &None, None)
        .await
        .expect("publish should return result");

    assert_eq!(pub_res.status, PublishResultStatus::StaleRemote);
    let remote_head_after = git_output(&["rev-parse", "HEAD"], remote.path());
    assert_eq!(remote_head_before, remote_head_after);
}

#[test]
fn test_is_auth_error_matches_ssh_and_credential_patterns() {
    use crate::git::leased_push::is_auth_error;

    let auth_messages = [
        "Permission denied (publickey)",
        "Authentication failed for 'https://example.com/repo.git'",
        "Agent admitted failure to sign using the key",
        "Sign_and_send_pubkey: signing failed",
        "Could not open a connection to your authentication agent",
        "Credential helper unavailable",
        "no suitable credentials found",
    ];

    for msg in auth_messages {
        let err = git2::Error::from_str(msg);
        assert!(
            is_auth_error(&err),
            "message should match auth error: {msg}"
        );
    }

    let non_auth_messages = [
        "Repository not found",
        "Could not resolve host: github.com",
        "failed to lock ref",
        "cannot open file",
    ];

    for msg in non_auth_messages {
        let err = git2::Error::from_str(msg);
        assert!(
            !is_auth_error(&err),
            "message should not match auth error: {msg}"
        );
    }
}

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

#[tokio::test]
async fn delete_branch_removes_non_current_local_branch() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature/delete-me"], path);
    std::fs::write(path.join("delete-me.txt"), "delete me").unwrap();
    git(&["add", "."], path);
    git(&["commit", "-m", "delete me"], path);
    git(&["checkout", "main"], path);

    let result = delete_branch(path, "feature/delete-me").await.unwrap();
    let branches = list_branches(path).unwrap();

    assert!(result.ok, "{result:?}");
    assert_eq!(
        result.message.as_deref(),
        Some("Deleted branch feature/delete-me")
    );
    assert!(branches
        .iter()
        .all(|branch| branch.name != "feature/delete-me"));
}

#[tokio::test]
async fn delete_branch_blocks_checked_out_branch() {
    let repo = make_temp_repo();
    let path = repo.path();

    let result = delete_branch(path, "main").await.unwrap();

    assert!(!result.ok, "{result:?}");
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::CheckedOutBranch)
    );
    assert_eq!(
        result.message.as_deref(),
        Some("Cannot delete checked out branch main")
    );
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

    crate::git::remove_worktree(path, &wt.path, false)
        .await
        .unwrap();

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

    crate::git::remove_worktree(path, &wt.path, false)
        .await
        .unwrap();
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
fn submodule_vcs_root_diffs_keep_parent_gitlink_and_child_files_separate() {
    let repo = make_parent_with_child_roots();
    let path = repo.path();

    std::fs::write(path.join("modules/child/README.md"), "child dirty").unwrap();

    let parent_entries = get_diff_files(path).unwrap();
    assert!(parent_entries.entries.iter().any(|entry| {
        entry.path == "modules/child" && entry.submodule.is_some() && !entry.staged
    }));
    assert!(!parent_entries
        .entries
        .iter()
        .any(|entry| entry.path == "README.md"));

    let child_entries = get_diff_files(&path.join("modules/child")).unwrap();
    let child_readme = child_entries
        .entries
        .iter()
        .find(|entry| entry.path == "README.md" && !entry.staged)
        .expect("child root should show its own file diff");
    assert_eq!(child_readme.status, "modified");
    assert!(child_readme.submodule.is_none());
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
fn child_root_discard_does_not_mutate_sibling_root() {
    let repo = make_parent_with_child_roots();
    let path = repo.path();

    std::fs::write(path.join("modules/child/README.md"), "child dirty").unwrap();
    std::fs::write(path.join("modules/sibling/README.md"), "sibling dirty").unwrap();

    let (root, paths) = resolve_git_path_root(
        path,
        Some("modules/child"),
        &["modules/child/README.md".to_string()],
    )
    .unwrap();
    discard_file(&root.root_path, &paths[0]).unwrap();

    assert_eq!(
        std::fs::read_to_string(path.join("modules/child/README.md")).unwrap(),
        "# test"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("modules/sibling/README.md")).unwrap(),
        "sibling dirty"
    );
}

#[test]
fn child_root_commit_does_not_mutate_parent_or_sibling_roots() {
    let repo = make_parent_with_child_roots();
    let path = repo.path();

    std::fs::write(path.join("modules/child/child.txt"), "child").unwrap();
    std::fs::write(path.join("modules/sibling/sibling.txt"), "sibling").unwrap();

    let (root, paths) = resolve_git_path_root(
        path,
        Some("modules/child"),
        &["modules/child/child.txt".to_string()],
    )
    .unwrap();
    let refs: Vec<&str> = paths.iter().map(|path| path.as_str()).collect();
    stage_files(&root.root_path, &refs).unwrap();
    let hash = commit_files(&root.root_path, "child-only commit", false).unwrap();

    assert!(!hash.is_empty());
    assert_eq!(get_status(&root.root_path, "child").unwrap().staged, 0);
    assert_eq!(get_status(path, "parent").unwrap().staged, 0);
    assert_eq!(
        get_status(&path.join("modules/sibling"), "sibling")
            .unwrap()
            .untracked,
        1
    );
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
    assert!(!diff.line_changes.is_empty());
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
fn get_file_diff_line_changes_for_added_file() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("added.txt"), "one\ntwo\n").unwrap();

    let diff = get_file_diff(path, "added.txt").unwrap();
    assert_eq!(diff.line_changes.len(), 1);
    let change = &diff.line_changes[0];
    assert_eq!(change.kind, "added");
    assert_eq!(change.line, 1);
    assert_eq!(change.length, 2);
    assert_eq!(change.old_lines, 0);
    assert_eq!(change.new_start, 1);
    assert_eq!(change.new_lines, 2);
}

#[test]
fn get_file_diff_line_changes_for_modified_line() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("README.md"), "# changed").unwrap();

    let diff = get_file_diff(path, "README.md").unwrap();
    assert_eq!(diff.line_changes.len(), 1);
    let change = &diff.line_changes[0];
    assert_eq!(change.kind, "modified");
    assert_eq!(change.line, 1);
    assert_eq!(change.length, 1);
    assert_eq!(change.old_start, 1);
    assert_eq!(change.old_lines, 1);
    assert_eq!(change.new_start, 1);
    assert_eq!(change.new_lines, 1);
}

#[test]
fn get_file_diff_line_changes_for_deleted_line() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("lines.txt"), "a\nb\nc\n").unwrap();
    git(&["add", "lines.txt"], path);
    git(&["commit", "-m", "add lines"], path);

    std::fs::write(path.join("lines.txt"), "a\nc\n").unwrap();

    let diff = get_file_diff(path, "lines.txt").unwrap();
    assert_eq!(diff.line_changes.len(), 1);
    let change = &diff.line_changes[0];
    assert_eq!(change.kind, "deleted");
    assert_eq!(change.line, 2);
    assert_eq!(change.length, 1);
    assert_eq!(change.old_start, 2);
    assert_eq!(change.old_lines, 1);
    assert_eq!(change.new_start, 2);
    assert_eq!(change.new_lines, 0);
}

#[test]
fn get_file_diff_line_changes_for_mixed_hunk() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("mixed.txt"), "a\nb\nc\nd\n").unwrap();
    git(&["add", "mixed.txt"], path);
    git(&["commit", "-m", "add mixed"], path);

    std::fs::write(path.join("mixed.txt"), "a\nB\nc\nx\nd\n").unwrap();

    let diff = get_file_diff(path, "mixed.txt").unwrap();
    let kinds: Vec<&str> = diff
        .line_changes
        .iter()
        .map(|change| change.kind.as_str())
        .collect();
    assert_eq!(kinds, vec!["modified", "added"]);
    assert_eq!(diff.line_changes[0].line, 2);
    assert_eq!(diff.line_changes[1].line, 4);
}

#[test]
fn get_file_diff_line_changes_empty_for_binary_file() {
    let repo = make_temp_repo();
    let path = repo.path();

    std::fs::write(path.join("blob.bin"), b"\0one").unwrap();
    git(&["add", "blob.bin"], path);
    git(&["commit", "-m", "add binary"], path);
    std::fs::write(path.join("blob.bin"), b"\0two").unwrap();

    let diff = get_file_diff(path, "blob.bin").unwrap();
    assert!(diff.is_binary);
    assert!(diff.line_changes.is_empty());
}

#[test]
fn get_file_diff_line_changes_empty_for_clean_file() {
    let repo = make_temp_repo();

    let diff = get_file_diff(repo.path(), "README.md").unwrap();
    assert!(diff.line_changes.is_empty());
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
async fn child_root_checkout_affects_only_selected_root() {
    let repo = make_parent_with_child_roots();
    let path = repo.path();
    let child = path.join("modules/child");
    let sibling = path.join("modules/sibling");

    git(&["branch", "child-feature"], &child);
    git(&["branch", "sibling-feature"], &sibling);

    let result = checkout_branch(
        &child,
        "child-feature",
        None,
        false,
        CheckoutStrategy::Normal,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], &child),
        "child-feature"
    );
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], &sibling),
        "main"
    );
    assert_eq!(
        git_output(&["rev-parse", "--abbrev-ref", "HEAD"], path),
        "main"
    );
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
async fn edit_commit_message_amends_head_and_preserves_tree_and_author() {
    let repo = make_temp_repo();
    let path = repo.path();
    let old_hash = git_output(&["rev-parse", "HEAD"], path);
    let old_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);
    let old_author = git_output(&["log", "-1", "--format=%an <%ae>"], path);

    let snap = get_commit_message(path, &old_hash).unwrap();
    assert_eq!(snap.branch, "refs/heads/main");
    assert_eq!(snap.head_oid, old_hash);

    let result = edit_commit_message(
        path,
        &old_hash,
        "new subject\n\nnew body",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.no_op, Some(false));
    assert_eq!(result.rewritten_count, Some(1));
    assert_eq!(result.signatures_removed, Some(false));
    assert_eq!(result.old_target_oid.as_deref(), Some(old_hash.as_str()));
    assert_eq!(result.old_head_oid.as_deref(), Some(old_hash.as_str()));

    let new_hash = result.hash.as_deref().unwrap();
    assert_eq!(result.new_target_oid.as_deref(), Some(new_hash));
    assert_eq!(result.new_head_oid.as_deref(), Some(new_hash));
    assert_ne!(new_hash, old_hash);

    assert_eq!(git_output(&["rev-parse", "HEAD^{tree}"], path), old_tree);
    assert_eq!(
        git_output(&["log", "-1", "--format=%an <%ae>"], path),
        old_author
    );
    assert_eq!(
        get_commit_message(path, new_hash).unwrap().message,
        "new subject\n\nnew body\n"
    );
}

#[tokio::test]
async fn edit_commit_message_rewrites_older_commit_and_descendants() {
    let repo = make_temp_repo();
    let path = repo.path();
    let root_hash = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("child.txt"), "child\n").unwrap();
    git(&["add", "child.txt"], path);
    git(&["commit", "-m", "child"], path);
    let old_head = git_output(&["rev-parse", "HEAD"], path);
    let old_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);

    let snap = get_commit_message(path, &root_hash).unwrap();
    assert_eq!(snap.branch, "refs/heads/main");
    assert_eq!(snap.head_oid, old_head);

    let result = edit_commit_message(
        path,
        &root_hash,
        "edited root",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.no_op, Some(false));
    assert_eq!(result.rewritten_count, Some(2));
    assert_ne!(git_output(&["rev-parse", "HEAD"], path), old_head);
    assert_eq!(git_output(&["rev-parse", "HEAD^{tree}"], path), old_tree);
    assert_eq!(
        git_output(&["log", "--format=%s", "--reverse"], path),
        "edited root\nchild"
    );
    assert_eq!(git_output(&["branch", "--show-current"], path), "main");
}

#[tokio::test]
async fn edit_commit_message_allows_dirty_worktree_and_pushed_commit() {
    let repo = make_temp_repo();
    let path = repo.path();
    let hash = git_output(&["rev-parse", "HEAD"], path);

    // Staged change
    std::fs::write(path.join("staged.txt"), "staged content\n").unwrap();
    git(&["add", "staged.txt"], path);

    // Unstaged change
    std::fs::write(path.join("README.md"), "modified content\n").unwrap();

    // Untracked file
    std::fs::write(path.join("untracked.txt"), "untracked content\n").unwrap();

    let snap = get_commit_message(path, &hash).unwrap();
    let result = edit_commit_message(
        path,
        &hash,
        "new subject for dirty test",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.dirty, None);

    assert_eq!(
        std::fs::read_to_string(path.join("staged.txt")).unwrap(),
        "staged content\n"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("README.md")).unwrap(),
        "modified content\n"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("untracked.txt")).unwrap(),
        "untracked content\n"
    );
    assert_eq!(
        git_output(&["diff", "--cached", "--name-only"], path),
        "staged.txt"
    );
    assert_eq!(git_output(&["diff", "--name-only"], path), "README.md");

    // Test pushed commit
    let (_remote, seed, _clone) = make_remote_clone_repo();
    let pushed_hash = git_output(&["rev-parse", "HEAD"], seed.path());
    let remote_head_before = git_output(&["rev-parse", "HEAD"], _remote.path());
    let pushed_snap = get_commit_message(seed.path(), &pushed_hash).unwrap();

    let pushed_res = edit_commit_message(
        seed.path(),
        &pushed_hash,
        "edited pushed commit message",
        &pushed_snap.branch,
        &pushed_snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(pushed_res.ok);
    assert_ne!(git_output(&["rev-parse", "HEAD"], seed.path()), pushed_hash);
    let remote_head_after = git_output(&["rev-parse", "HEAD"], _remote.path());
    assert_eq!(remote_head_before, remote_head_after);
}

#[tokio::test]
async fn edit_commit_message_rejects_empty_active_op_detached_and_unreachable() {
    let repo = make_temp_repo();
    let path = repo.path();
    let hash = git_output(&["rev-parse", "HEAD"], path);
    let snap = get_commit_message(path, &hash).unwrap();

    // Empty message
    assert!(
        edit_commit_message(path, &hash, "   \n\t", &snap.branch, &snap.head_oid, false)
            .await
            .is_err()
    );

    // Active rebase
    std::fs::create_dir(path.join(".git/rebase-merge")).unwrap();
    let active = edit_commit_message(path, &hash, "new", &snap.branch, &snap.head_oid, false)
        .await
        .unwrap();
    assert_eq!(
        active.blocked_reason,
        Some(crate::git::GitBlockReason::ActiveOperation)
    );
    std::fs::remove_dir(path.join(".git/rebase-merge")).unwrap();

    // Unreachable commit on other branch
    git(&["checkout", "-b", "other"], path);
    std::fs::write(path.join("other.txt"), "other\n").unwrap();
    git(&["add", "other.txt"], path);
    git(&["commit", "-m", "other"], path);
    let other_hash = git_output(&["rev-parse", "HEAD"], path);
    git(&["checkout", "main"], path);

    let unreachable = edit_commit_message(
        path,
        &other_hash,
        "new",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();
    assert_eq!(
        unreachable.blocked_reason,
        Some(crate::git::GitBlockReason::UnreachableCommit)
    );

    // Detached HEAD
    git(&["checkout", "--detach", &hash], path);
    let detached = edit_commit_message(path, &hash, "new", &snap.branch, &snap.head_oid, false)
        .await
        .unwrap();
    assert_eq!(
        detached.blocked_reason,
        Some(crate::git::GitBlockReason::DetachedHead)
    );
}

#[tokio::test]
async fn edit_commit_message_preserves_merge_commit_tree_and_ordered_parents() {
    let repo = make_temp_repo();
    let path = repo.path();
    let root_hash = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "-b", "side"], path);
    std::fs::write(path.join("README.md"), "side\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "side change"], path);
    let side_head = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("README.md"), "main\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "main change"], path);

    let merge = Command::new("git")
        .args(["merge", "side"])
        .current_dir(path)
        .output()
        .expect("git merge failed to spawn");
    assert!(!merge.status.success(), "merge should conflict");
    std::fs::write(path.join("README.md"), "resolved\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "resolved merge"], path);

    let merge_hash = git_output(&["rev-parse", "HEAD"], path);
    let merge_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);
    let merge_parents_before = git_output(&["rev-parse", "HEAD^1", "HEAD^2"], path);

    let snap = get_commit_message(path, &root_hash).unwrap();
    let result = edit_commit_message(
        path,
        &root_hash,
        "edited root with merge preservation",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.conflict, None);
    assert!(result.recovery.is_none());

    let new_merge_hash = git_output(&["rev-parse", "HEAD"], path);
    assert_ne!(new_merge_hash, merge_hash);
    assert_eq!(git_output(&["rev-parse", "HEAD^{tree}"], path), merge_tree);

    let p1 = git_output(&["rev-parse", "HEAD^1"], path);
    let p2 = git_output(&["rev-parse", "HEAD^2"], path);
    assert_ne!(p1, merge_parents_before.lines().next().unwrap());
    assert_ne!(p2, side_head);

    assert_eq!(
        git_output(&["rev-parse", "refs/heads/side"], path),
        side_head
    );
}

#[tokio::test]
async fn edit_commit_message_exact_no_op() {
    let repo = make_temp_repo();
    let path = repo.path();
    let hash = git_output(&["rev-parse", "HEAD"], path);
    let snap = get_commit_message(path, &hash).unwrap();

    let reflog_before = git_output(&["reflog", "show", "main"], path);

    let result = edit_commit_message(
        path,
        &hash,
        &snap.message,
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.no_op, Some(true));
    assert_eq!(result.rewritten_count, Some(0));
    assert_eq!(result.hash.as_deref(), Some(hash.as_str()));
    assert_eq!(result.old_target_oid.as_deref(), Some(hash.as_str()));
    assert_eq!(result.new_target_oid.as_deref(), Some(hash.as_str()));

    let reflog_after = git_output(&["reflog", "show", "main"], path);
    assert_eq!(reflog_before, reflog_after);
}

#[tokio::test]
async fn edit_commit_message_stale_ref_detected_before_target_lookup() {
    let repo = make_temp_repo();
    let path = repo.path();
    let hash = git_output(&["rev-parse", "HEAD"], path);
    let snap = get_commit_message(path, &hash).unwrap();

    let stale_oid = "0000000000000000000000000000000000000000";
    let fake_target = "1111111111111111111111111111111111111111";

    let result = edit_commit_message(
        path,
        fake_target,
        "new message",
        &snap.branch,
        stale_oid,
        false,
    )
    .await
    .unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::StaleRef)
    );
}

#[tokio::test]
async fn edit_commit_message_signatures_and_mergetag_consent() {
    let repo_dir = make_temp_repo();
    let path = repo_dir.path();
    let head = git_output(&["rev-parse", "HEAD"], path);

    let repo = git2::Repository::open(path).unwrap();
    let odb = repo.odb().unwrap();
    let head_commit = repo
        .find_commit(git2::Oid::from_str(&head).unwrap())
        .unwrap();
    let tree_id = head_commit.tree_id();

    let raw_signed_commit = format!(
        "tree {tree_id}\nauthor Test <test@test.com> 1700000000 +0000\ncommitter Test <test@test.com> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n Version: GnuPG v2\n \n iQEcBAABCAAGBQJ...\n -----END PGP SIGNATURE-----\n\nsigned commit\n"
    );

    let signed_oid = odb
        .write(git2::ObjectType::Commit, raw_signed_commit.as_bytes())
        .unwrap();
    git(
        &["update-ref", "refs/heads/main", &signed_oid.to_string()],
        path,
    );

    let snap = get_commit_message(path, &signed_oid.to_string()).unwrap();

    let blocked = edit_commit_message(
        path,
        &signed_oid.to_string(),
        "edited message without consent",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(!blocked.ok);
    assert_eq!(
        blocked.blocked_reason,
        Some(crate::git::GitBlockReason::SignatureConsentRequired)
    );

    let allowed = edit_commit_message(
        path,
        &signed_oid.to_string(),
        "edited message with consent",
        &snap.branch,
        &snap.head_oid,
        true,
    )
    .await
    .unwrap();

    assert!(allowed.ok);
    assert_eq!(allowed.signatures_removed, Some(true));
    let new_head = allowed.new_head_oid.unwrap();
    let new_raw = odb.read(git2::Oid::from_str(&new_head).unwrap()).unwrap();
    let new_raw_str = String::from_utf8_lossy(new_raw.data());
    assert!(!new_raw_str.contains("gpgsig"));
    assert!(new_raw_str.contains("edited message with consent"));
}

#[tokio::test]
async fn edit_commit_message_non_utf8_encoding_rejected() {
    let repo_dir = make_temp_repo();
    let path = repo_dir.path();
    let repo = git2::Repository::open(path).unwrap();
    let odb = repo.odb().unwrap();
    let head = git_output(&["rev-parse", "HEAD"], path);
    let head_commit = repo
        .find_commit(git2::Oid::from_str(&head).unwrap())
        .unwrap();
    let tree_id = head_commit.tree_id();

    let raw_iso = format!(
        "tree {tree_id}\nauthor Test <test@test.com> 1700000000 +0000\ncommitter Test <test@test.com> 1700000000 +0000\nencoding ISO-8859-1\n\nmessage\n"
    );
    let iso_oid = odb
        .write(git2::ObjectType::Commit, raw_iso.as_bytes())
        .unwrap();
    git(
        &["update-ref", "refs/heads/main", &iso_oid.to_string()],
        path,
    );

    let snap_res = get_commit_message(path, &iso_oid.to_string());
    assert!(snap_res.is_err());

    let edit_res = edit_commit_message(
        path,
        &iso_oid.to_string(),
        "new message",
        "refs/heads/main",
        &iso_oid.to_string(),
        false,
    )
    .await
    .unwrap();

    assert!(!edit_res.ok);
    assert_eq!(
        edit_res.blocked_reason,
        Some(crate::git::GitBlockReason::UnsupportedHistory)
    );
}

#[tokio::test]
async fn edit_commit_message_linked_worktree_detection() {
    let repo = make_temp_repo();
    let path = repo.path();
    let wt_dir = tempfile::tempdir().unwrap();
    let wt_path = wt_dir.path();

    git(
        &[
            "worktree",
            "add",
            "-b",
            "feature",
            wt_path.to_str().unwrap(),
        ],
        path,
    );
    git(&["checkout", "--ignore-other-worktrees", "main"], wt_path);

    let head = git_output(&["rev-parse", "HEAD"], path);
    let snap = get_commit_message(path, &head).unwrap();

    let result = edit_commit_message(
        path,
        &head,
        "new message",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::CheckedOutBranch)
    );
}

#[tokio::test]
async fn edit_commit_message_inside_linked_worktree_succeeds() {
    let repo = make_temp_repo();
    let path = repo.path();
    let wt_dir = tempfile::tempdir().unwrap();
    let wt_path = wt_dir.path();

    git(
        &[
            "worktree",
            "add",
            "-b",
            "feature",
            wt_path.to_str().unwrap(),
        ],
        path,
    );

    let wt_head = git_output(&["rev-parse", "HEAD"], wt_path);
    let snap = get_commit_message(wt_path, &wt_head).unwrap();
    assert_eq!(snap.branch, "refs/heads/feature");
    assert_eq!(snap.head_oid, wt_head);

    let result = edit_commit_message(
        wt_path,
        &wt_head,
        "edited message in linked worktree",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.branch.as_deref(), Some("refs/heads/feature"));
    assert_eq!(
        get_commit_message(wt_path, result.hash.as_deref().unwrap())
            .unwrap()
            .message,
        "edited message in linked worktree\n"
    );
}

#[tokio::test]
async fn edit_commit_message_octopus_merge_preservation() {
    let repo = make_temp_repo();
    let path = repo.path();
    let _root = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "-b", "branch_b"], path);
    std::fs::write(path.join("b.txt"), "b\n").unwrap();
    git(&["add", "b.txt"], path);
    git(&["commit", "-m", "b change"], path);
    let b_head = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    git(&["checkout", "-b", "branch_c"], path);
    std::fs::write(path.join("c.txt"), "c\n").unwrap();
    git(&["add", "c.txt"], path);
    git(&["commit", "-m", "c change"], path);
    let c_head = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("a.txt"), "a\n").unwrap();
    git(&["add", "a.txt"], path);
    git(&["commit", "-m", "a change"], path);
    let a_head = git_output(&["rev-parse", "HEAD"], path);

    git(&["merge", "branch_b", "branch_c"], path);
    let oct_head = git_output(&["rev-parse", "HEAD"], path);
    let oct_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);
    let parents_before = git_output(&["rev-parse", "HEAD^1", "HEAD^2", "HEAD^3"], path);
    let parents_vec: Vec<&str> = parents_before.lines().collect();
    assert_eq!(parents_vec.len(), 3);
    assert_eq!(parents_vec[0], a_head);
    assert_eq!(parents_vec[1], b_head);
    assert_eq!(parents_vec[2], c_head);

    let snap = get_commit_message(path, &b_head).unwrap();
    let result = edit_commit_message(
        path,
        &b_head,
        "edited b commit",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(result.ok);
    assert_eq!(result.rewritten_count, Some(2)); // b_head and octopus merge
    let new_oct_head = git_output(&["rev-parse", "HEAD"], path);
    assert_ne!(new_oct_head, oct_head);
    assert_eq!(git_output(&["rev-parse", "HEAD^{tree}"], path), oct_tree);

    let parents_after = git_output(&["rev-parse", "HEAD^1", "HEAD^2", "HEAD^3"], path);
    let after_vec: Vec<&str> = parents_after.lines().collect();
    assert_eq!(after_vec.len(), 3);
    assert_eq!(after_vec[0], a_head); // unchanged parent
    assert_ne!(after_vec[1], b_head); // rewritten parent
    assert_eq!(after_vec[2], c_head); // unchanged parent
}

#[tokio::test]
async fn edit_commit_message_gpgsig_sha256_and_mergetag_retention() {
    let repo_dir = make_temp_repo();
    let path = repo_dir.path();
    let head = git_output(&["rev-parse", "HEAD"], path);
    let repo = git2::Repository::open(path).unwrap();
    let odb = repo.odb().unwrap();
    let head_commit = repo
        .find_commit(git2::Oid::from_str(&head).unwrap())
        .unwrap();
    let tree_id = head_commit.tree_id();

    // 1. Commit with gpgsig-sha256
    let raw_sha256_commit = format!(
        "tree {tree_id}\nauthor Test <test@test.com> 1700000000 +0000\ncommitter Test <test@test.com> 1700000000 +0000\ngpgsig-sha256 -----BEGIN PGP SIGNATURE-----\n Version: GnuPG v2\n \n iQEcBAABCAAGBQJ...\n -----END PGP SIGNATURE-----\n\nsha256 signed commit\n"
    );
    let sha256_oid = odb
        .write(git2::ObjectType::Commit, raw_sha256_commit.as_bytes())
        .unwrap();
    git(
        &["update-ref", "refs/heads/main", &sha256_oid.to_string()],
        path,
    );

    let snap = get_commit_message(path, &sha256_oid.to_string()).unwrap();
    let blocked = edit_commit_message(
        path,
        &sha256_oid.to_string(),
        "new message",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();
    assert_eq!(
        blocked.blocked_reason,
        Some(crate::git::GitBlockReason::SignatureConsentRequired)
    );

    // 2. Mergetag retention when referenced parent is unchanged
    // Create branch2
    git(&["checkout", "-b", "branch2"], path);
    std::fs::write(path.join("file2.txt"), "2\n").unwrap();
    git(&["add", "file2.txt"], path);
    git(&["commit", "-m", "parent 2"], path);
    let p2_oid = git_output(&["rev-parse", "HEAD"], path);

    git(&["checkout", "main"], path);
    std::fs::write(path.join("file1.txt"), "1\n").unwrap();
    git(&["add", "file1.txt"], path);
    git(&["commit", "-m", "parent 1"], path);
    let p1_oid = git_output(&["rev-parse", "HEAD"], path);

    // Craft merge commit with mergetag referencing p2_oid
    let merge_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);
    let raw_mergetag_commit = format!(
        "tree {merge_tree}\nparent {p1_oid}\nparent {p2_oid}\nauthor Test <test@test.com> 1700000000 +0000\ncommitter Test <test@test.com> 1700000000 +0000\nmergetag object {p2_oid}\n type commit\n tag test-tag\n tagger Test <test@test.com> 1700000000 +0000\n \n tag msg\n -----BEGIN PGP SIGNATURE-----\n ...\n -----END PGP SIGNATURE-----\n\nmerge with tag\n"
    );
    let merge_oid = odb
        .write(git2::ObjectType::Commit, raw_mergetag_commit.as_bytes())
        .unwrap();
    git(
        &["update-ref", "refs/heads/main", &merge_oid.to_string()],
        path,
    );

    // Now edit p1_oid (p2_oid is NOT affected)
    let snap_p1 = get_commit_message(path, &p1_oid).unwrap();
    let res = edit_commit_message(
        path,
        &p1_oid,
        "edited p1 only",
        &snap_p1.branch,
        &snap_p1.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(res.ok);
    assert_eq!(res.signatures_removed, Some(false));
    let new_merge_oid = res.new_head_oid.unwrap();
    let new_merge_raw = odb
        .read(git2::Oid::from_str(&new_merge_oid).unwrap())
        .unwrap();
    let new_merge_str = String::from_utf8_lossy(new_merge_raw.data());
    // Mergetag must be retained verbatim!
    assert!(new_merge_str.contains("mergetag object"));
    assert!(new_merge_str.contains(&p2_oid));
}

#[tokio::test]
async fn edit_commit_message_grafts_and_replace_refs_blocked() {
    let repo = make_temp_repo();
    let path = repo.path();
    let head = git_output(&["rev-parse", "HEAD"], path);
    let snap = get_commit_message(path, &head).unwrap();

    // 1. Grafts file
    let grafts_file = path.join(".git/info/grafts");
    std::fs::create_dir_all(path.join(".git/info")).unwrap();
    std::fs::write(
        &grafts_file,
        format!("{head} 0000000000000000000000000000000000000000\n"),
    )
    .unwrap();

    let blocked_graft = edit_commit_message(
        path,
        &head,
        "new message",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert_eq!(
        blocked_graft.blocked_reason,
        Some(crate::git::GitBlockReason::UnsupportedHistory)
    );
    std::fs::remove_file(&grafts_file).unwrap();

    // 2. Replace refs
    git(
        &["update-ref", &format!("refs/replace/{head}"), &head],
        path,
    );
    let blocked_replace = edit_commit_message(
        path,
        &head,
        "new message",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert_eq!(
        blocked_replace.blocked_reason,
        Some(crate::git::GitBlockReason::UnsupportedHistory)
    );
}

#[tokio::test]
async fn edit_commit_message_malformed_header_rejected() {
    let repo_dir = make_temp_repo();
    let path = repo_dir.path();
    let repo = git2::Repository::open(path).unwrap();
    let odb = repo.odb().unwrap();
    let head = git_output(&["rev-parse", "HEAD"], path);
    let head_commit = repo
        .find_commit(git2::Oid::from_str(&head).unwrap())
        .unwrap();
    let tree_id = head_commit.tree_id();

    // Malformed commit missing author and committer
    let bad_raw = format!("tree {tree_id}\n\nbad commit\n");
    let bad_oid = odb
        .write(git2::ObjectType::Commit, bad_raw.as_bytes())
        .unwrap();
    git(
        &["update-ref", "refs/heads/main", &bad_oid.to_string()],
        path,
    );

    let res = edit_commit_message(
        path,
        &bad_oid.to_string(),
        "new message",
        "refs/heads/main",
        &bad_oid.to_string(),
        false,
    )
    .await
    .unwrap();

    assert!(!res.ok);
    assert_eq!(
        res.blocked_reason,
        Some(crate::git::GitBlockReason::InvalidCommitMetadata)
    );
}

#[tokio::test]
async fn edit_commit_message_unborn_branch_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path();
    git(&["init", "-b", "main"], path);
    configure_test_repo(path);

    let res = edit_commit_message(
        path,
        "0000000000000000000000000000000000000000",
        "new message",
        "refs/heads/main",
        "0000000000000000000000000000000000000000",
        false,
    )
    .await
    .unwrap();

    assert!(!res.ok);
    assert_eq!(
        res.blocked_reason,
        Some(crate::git::GitBlockReason::DetachedHead)
    );
}
#[tokio::test]
async fn edit_commit_message_shallow_boundary_blocked() {
    let source = make_temp_repo();
    std::fs::write(source.path().join("c1.txt"), "c1\n").unwrap();
    git(&["add", "c1.txt"], source.path());
    git(&["commit", "-m", "commit 1"], source.path());
    std::fs::write(source.path().join("c2.txt"), "c2\n").unwrap();
    git(&["add", "c2.txt"], source.path());
    git(&["commit", "-m", "commit 2"], source.path());

    let shallow_clone = tempfile::tempdir().unwrap();
    let shallow_path = shallow_clone.path();
    let source_url = format!("file://{}", source.path().display());
    git(&["clone", "--depth", "1", &source_url, "."], shallow_path);
    configure_test_repo(shallow_path);

    let head = git_output(&["rev-parse", "HEAD"], shallow_path);
    let snap = get_commit_message(shallow_path, &head).unwrap();

    let res = edit_commit_message(
        shallow_path,
        &head,
        "shallow edit attempt",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(!res.ok);
    assert_eq!(
        res.blocked_reason,
        Some(crate::git::GitBlockReason::UnsupportedHistory)
    );
}

#[tokio::test]
async fn edit_commit_message_missing_parent_object_rejected() {
    let repo = make_temp_repo();
    let path = repo.path();
    std::fs::write(path.join("c1.txt"), "c1\n").unwrap();
    git(&["add", "c1.txt"], path);
    git(&["commit", "-m", "commit 1"], path);
    let c1_oid = git_output(&["rev-parse", "HEAD"], path);

    std::fs::write(path.join("c2.txt"), "c2\n").unwrap();
    git(&["add", "c2.txt"], path);
    git(&["commit", "-m", "commit 2"], path);
    let c2_oid = git_output(&["rev-parse", "HEAD"], path);

    let snap = get_commit_message(path, &c2_oid).unwrap();

    // Remove the loose object for c1 to simulate missing/corrupt ancestry
    let (prefix, suffix) = c1_oid.split_at(2);
    let obj_path = path.join(".git/objects").join(prefix).join(suffix);
    if obj_path.exists() {
        std::fs::remove_file(obj_path).unwrap();
    }

    let res = edit_commit_message(
        path,
        &c2_oid,
        "edited message",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(!res.ok);
    assert_eq!(
        res.blocked_reason,
        Some(crate::git::GitBlockReason::UnsupportedHistory)
    );
}

#[tokio::test]
async fn edit_commit_message_same_oid_different_branch_rejected() {
    let repo = make_temp_repo();
    let path = repo.path();
    let head = git_output(&["rev-parse", "HEAD"], path);

    // Create a new branch pointing to the exact same commit
    git(&["branch", "feature", &head], path);
    let snap = get_commit_message(path, &head).unwrap();
    assert_eq!(snap.branch, "refs/heads/main");

    // Switch HEAD to feature: tip OID is identical, but branch is different
    git(&["checkout", "feature"], path);

    let res = edit_commit_message(
        path,
        &head,
        "new message",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(!res.ok);
    assert_eq!(
        res.blocked_reason,
        Some(crate::git::GitBlockReason::StaleRef)
    );
    assert_eq!(res.branch, Some("refs/heads/feature".to_string()));
}

#[tokio::test]
async fn edit_commit_message_side_parent_of_merge_rewritten() {
    let repo = make_temp_repo();
    let path = repo.path();
    let _root = git_output(&["rev-parse", "HEAD"], path);

    // Create side branch feature with commit B
    git(&["checkout", "-b", "feature"], path);
    std::fs::write(path.join("b.txt"), "b\n").unwrap();
    git(&["add", "b.txt"], path);
    git(&["commit", "-m", "feature commit B"], path);
    let b_oid = git_output(&["rev-parse", "HEAD"], path);

    // Back to main, create commit A
    git(&["checkout", "main"], path);
    std::fs::write(path.join("a.txt"), "a\n").unwrap();
    git(&["add", "a.txt"], path);
    git(&["commit", "-m", "main commit A"], path);
    let a_oid = git_output(&["rev-parse", "HEAD"], path);

    // Merge feature into main with no fast forward
    git(
        &[
            "merge",
            "--no-ff",
            "-m",
            "merge feature into main",
            "feature",
        ],
        path,
    );
    let merge_oid = git_output(&["rev-parse", "HEAD"], path);
    let merge_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);
    let snap = get_commit_message(path, &b_oid).unwrap();

    // Edit commit B (the side parent)
    let res = edit_commit_message(
        path,
        &b_oid,
        "rewritten commit B",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap();

    assert!(res.ok, "edit should succeed: {res:?}");
    let new_b_oid = res.new_target_oid.unwrap();
    let new_merge_oid = res.new_head_oid.unwrap();
    assert_ne!(new_b_oid, b_oid);
    assert_ne!(new_merge_oid, merge_oid);

    // The merge commit's parents must be [A, new_B] in exact same order
    let parents_raw = git_output(&["log", "-1", "--format=%P", &new_merge_oid], path);
    let parents: Vec<&str> = parents_raw.split_whitespace().collect();
    assert_eq!(parents, vec![a_oid.as_str(), new_b_oid.as_str()]);

    // The merge commit's tree must be completely identical
    let new_merge_tree = git_output(&["rev-parse", &format!("{new_merge_oid}^{{tree}}")], path);
    assert_eq!(new_merge_tree, merge_tree);

    // A must remain unchanged
    let a_log = git_output(&["log", "-1", "--format=%H %s", &a_oid], path);
    assert!(a_log.contains("main commit A"));
}

#[tokio::test]
async fn edit_commit_message_whitespace_only_rejected() {
    let repo = make_temp_repo();
    let path = repo.path();
    let head = git_output(&["rev-parse", "HEAD"], path);
    let snap = get_commit_message(path, &head).unwrap();

    let err = edit_commit_message(
        path,
        &head,
        "   \n\t  \n  ",
        &snap.branch,
        &snap.head_oid,
        false,
    )
    .await
    .unwrap_err();

    match err {
        crate::error::AppError::InvalidInput(msg) => {
            assert!(msg.contains("cannot be empty"));
        }
        other => panic!("expected InvalidInput error, got: {other:?}"),
    }
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

    let messages: Vec<_> = get_log(path, 10, 0, None, None)
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

    let first_page: Vec<_> = get_log(path, 2, 0, None, None)
        .unwrap()
        .into_iter()
        .map(|entry| entry.message)
        .collect();
    let second_page: Vec<_> = get_log(path, 2, 2, None, None)
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

    let messages: Vec<_> = get_log(path, 10, 0, Some("feature"), None)
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

#[test]
fn get_log_search_case_insensitivity_and_body_matching() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "Feature ALPHA\n\nimplemented core logic",
        ],
        path,
    );
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "Fix bug in parsing\n\nDetailed context mentioning feature alpha in body",
        ],
        path,
    );
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "Unrelated update\n\nnothing special",
        ],
        path,
    );

    let head_before = git_output(&["rev-parse", "HEAD"], path);

    // Search for "alpha" lowercase: matches both "Feature ALPHA" (subject) and "Fix bug in parsing" (body)
    let entries = get_log(path, 10, 0, None, Some("alpha")).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].message, "Fix bug in parsing");
    assert_eq!(entries[1].message, "Feature ALPHA");

    // Verify HEAD and working directory are completely untouched
    let head_after = git_output(&["rev-parse", "HEAD"], path);
    assert_eq!(head_before, head_after);
    assert_eq!(git_output(&["status", "--porcelain"], path), "");
}

#[test]
fn get_log_search_literal_special_characters() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(
        &["commit", "--allow-empty", "-m", "chore: bump [release-1.0]"],
        path,
    );
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "feat: add .* regex support",
        ],
        path,
    );
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "docs: document --dry-run option",
        ],
        path,
    );
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "plain commit without symbols",
        ],
        path,
    );

    // ".*" must be treated as literal fixed string, NOT matching all commits
    let dot_star_entries = get_log(path, 10, 0, None, Some(".*")).unwrap();
    assert_eq!(dot_star_entries.len(), 1);
    assert_eq!(dot_star_entries[0].message, "feat: add .* regex support");

    // "[release-1.0]" must be matched literally, not as character class
    let bracket_entries = get_log(path, 10, 0, None, Some("[release-1.0]")).unwrap();
    assert_eq!(bracket_entries.len(), 1);
    assert_eq!(bracket_entries[0].message, "chore: bump [release-1.0]");

    // "--dry-run" must be matched literally, not parsed as CLI option
    let dash_entries = get_log(path, 10, 0, None, Some("--dry-run")).unwrap();
    assert_eq!(dash_entries.len(), 1);
    assert_eq!(dash_entries[0].message, "docs: document --dry-run option");
}

#[test]
fn get_log_search_unicode_literal_and_whitespace() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "feat: hỗ trợ tiếng Việt 🚀",
        ],
        path,
    );
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "docs: english documentation",
        ],
        path,
    );

    // Literal unicode matching
    let unicode_entries = get_log(path, 10, 0, None, Some("tiếng Việt")).unwrap();
    assert_eq!(unicode_entries.len(), 1);
    assert_eq!(unicode_entries[0].message, "feat: hỗ trợ tiếng Việt 🚀");

    // Query with surrounding whitespace should be trimmed
    let trimmed_entries = get_log(path, 10, 0, None, Some("  tiếng Việt   ")).unwrap();
    assert_eq!(trimmed_entries.len(), 1);
    assert_eq!(trimmed_entries[0].message, "feat: hỗ trợ tiếng Việt 🚀");

    // Whitespace-only query is treated as no query (returns all commits)
    let all_entries = get_log(path, 10, 0, None, Some("   \t  ")).unwrap();
    assert_eq!(all_entries.len(), 3); // init + 2 commits
}

#[test]
fn get_log_search_matching_pagination() {
    let repo = make_temp_repo();
    let path = repo.path();

    // Commit order (oldest to newest): init, match 1, filler A, match 2, filler B, match 3, match 4
    git(&["commit", "--allow-empty", "-m", "target match 1"], path);
    git(&["commit", "--allow-empty", "-m", "filler A"], path);
    git(&["commit", "--allow-empty", "-m", "target match 2"], path);
    git(&["commit", "--allow-empty", "-m", "filler B"], path);
    git(&["commit", "--allow-empty", "-m", "target match 3"], path);
    git(&["commit", "--allow-empty", "-m", "target match 4"], path);

    // First page of matches: limit 2, offset 0 -> newest matches: 4 and 3
    let page1 = get_log(path, 2, 0, None, Some("target match")).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(page1[0].message, "target match 4");
    assert_eq!(page1[1].message, "target match 3");

    // Second page of matches: limit 2, offset 2 -> next matches: 2 and 1
    let page2 = get_log(path, 2, 2, None, Some("target match")).unwrap();
    assert_eq!(page2.len(), 2);
    assert_eq!(page2[0].message, "target match 2");
    assert_eq!(page2[1].message, "target match 1");

    // Third page of matches: limit 2, offset 4 -> empty
    let page3 = get_log(path, 2, 4, None, Some("target match")).unwrap();
    assert!(page3.is_empty());
}

#[test]
fn get_log_search_beyond_default_page_boundary() {
    let repo = make_temp_repo();
    let path = repo.path();

    // Old commit before 205 filler commits
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "needle in haystack old commit",
        ],
        path,
    );

    for idx in 1..=205 {
        git(
            &[
                "commit",
                "--allow-empty",
                "-m",
                &format!("filler commit {idx}"),
            ],
            path,
        );
    }

    // Default limit is 100 or 200; with limit 100, finding the needle proves search selects before pagination
    let entries = get_log(path, 100, 0, None, Some("needle in haystack")).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].message, "needle in haystack old commit");
}

#[test]
fn get_log_search_branch_isolation_and_explicit_ref() {
    let repo = make_temp_repo();
    let path = repo.path();

    git(&["checkout", "-b", "feature"], path);
    git(
        &[
            "commit",
            "--allow-empty",
            "-m",
            "feature secret_marker commit",
        ],
        path,
    );

    git(&["checkout", "main"], path);
    git(
        &["commit", "--allow-empty", "-m", "main secret_marker commit"],
        path,
    );

    // On main, default ref searches current branch
    let main_entries = get_log(path, 10, 0, None, Some("secret_marker")).unwrap();
    assert_eq!(main_entries.len(), 1);
    assert_eq!(main_entries[0].message, "main secret_marker commit");

    // Explicit ref "feature" searches feature branch without checkout
    let feat_entries = get_log(path, 10, 0, Some("feature"), Some("secret_marker")).unwrap();
    assert_eq!(feat_entries.len(), 1);
    assert_eq!(feat_entries[0].message, "feature secret_marker commit");
}

#[test]
fn get_log_search_invalid_control_characters_rejected() {
    let repo = make_temp_repo();
    let path = repo.path();

    assert!(matches!(
        get_log(path, 10, 0, None, Some("test\nquery")).unwrap_err(),
        crate::error::AppError::InvalidInput(_)
    ));
    assert!(matches!(
        get_log(path, 10, 0, None, Some("test\rquery")).unwrap_err(),
        crate::error::AppError::InvalidInput(_)
    ));
    assert!(matches!(
        get_log(path, 10, 0, None, Some("test\0query")).unwrap_err(),
        crate::error::AppError::InvalidInput(_)
    ));
}

#[test]
fn get_log_search_no_match_returns_empty() {
    let repo = make_temp_repo();
    let path = repo.path();

    let entries = get_log(path, 10, 0, None, Some("completely_nonexistent_term_42")).unwrap();
    assert!(entries.is_empty());
}

// Raw squash fixtures deliberately use the real ODB and Git CLI as independent oracles.
fn squash_raw_commit(path: &Path, parents: &[String], extra: &str, message: &[u8]) -> String {
    let repo = git2::Repository::open(path).unwrap();
    let tree = repo.head().unwrap().peel_to_commit().unwrap().tree_id();
    let mut raw = format!("tree {tree}\n");
    for parent in parents {
        raw.push_str(&format!("parent {parent}\n"));
    }
    raw.push_str("author Old Author <author@example.com> 1700000000 +0530\ncommitter Old Committer <old@example.com> 1700000010 -0700\n");
    raw.push_str(extra);
    raw.push('\n');
    let mut bytes = raw.into_bytes();
    bytes.extend_from_slice(message);
    let odb = repo.odb().unwrap();
    odb.write(git2::ObjectType::Commit, &bytes)
        .unwrap()
        .to_string()
}

fn squash_chain(path: &Path, count: usize) -> Vec<String> {
    let mut hashes = vec![git_output(&["rev-parse", "HEAD"], path)];
    for i in 1..count {
        std::fs::write(path.join(format!("chain-{i}")), format!("content-{i}\n")).unwrap();
        git(&["add", "."], path);
        git(&["commit", "-m", &format!("commit {i}\n\nbody {i}")], path);
        hashes.push(git_output(&["rev-parse", "HEAD"], path));
    }
    hashes
}

fn squash_object_count(path: &Path) -> usize {
    let repo = git2::Repository::open(path).unwrap();
    let mut count = 0;
    repo.odb()
        .unwrap()
        .foreach(|_| {
            count += 1;
            true
        })
        .unwrap();
    count
}

fn squash_raw_bytes(path: &Path, oid: &str) -> Vec<u8> {
    let output = Command::new("git")
        .args(["cat-file", "commit", oid])
        .current_dir(path)
        .output()
        .unwrap();
    assert!(output.status.success());
    output.stdout
}

#[tokio::test]
async fn squash_commits_head_older_root_and_full_ranges_preserve_topology_and_dirty_state() {
    for (start, end) in [(1, 3), (1, 2), (0, 1), (0, 4), (3, 4)] {
        let dir = make_temp_repo();
        let path = dir.path();
        let hashes = squash_chain(path, 5);
        let old_head = hashes.last().unwrap();
        let old_tree = git_output(&["rev-parse", "HEAD^{tree}"], path);
        let author = git_output(
            &["show", "-s", "--format=%an <%ae> %at %ai", &hashes[start]],
            path,
        );
        git(&["branch", "untouched"], path);
        git(&["tag", "original"], path);
        git(&["config", "user.name", "Current Committer"], path);
        git(&["config", "user.email", "current@example.com"], path);
        std::fs::write(path.join("README.md"), "staged\n").unwrap();
        git(&["add", "README.md"], path);
        std::fs::write(path.join("README.md"), "unstaged\n").unwrap();
        std::fs::write(path.join("untracked"), "untracked\n").unwrap();
        let index_bytes = std::fs::read(path.join(".git/index")).unwrap();
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let result = crate::git::squash_commits(
            path,
            &hashes[start..=end],
            "  gộp\n\nbody\n\n",
            "refs/heads/main",
            old_head,
            false,
        )
        .await
        .unwrap();
        let after = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(result.ok, "{result:?}");
        assert_eq!(result.old_target_oid.as_ref(), Some(&hashes[end]));
        assert_eq!(result.old_head_oid.as_ref(), Some(old_head));
        assert_eq!(result.rewritten_count, Some(1 + 4 - end));
        assert_eq!(result.no_op, Some(false));
        assert_eq!(result.signatures_removed, Some(false));
        let target = result.new_target_oid.as_ref().unwrap();
        assert_eq!(result.hash.as_ref(), Some(target));
        assert_eq!(result.new_head_oid.as_ref() == Some(target), end == 4);
        assert_eq!(
            git_output(&["rev-parse", "HEAD"], path),
            *result.new_head_oid.as_ref().unwrap()
        );
        assert_eq!(git_output(&["rev-parse", "HEAD^{tree}"], path), old_tree);
        assert_eq!(
            git_output(&["rev-list", "--count", "HEAD"], path),
            (5 - (end - start)).to_string()
        );
        let parents = git_output(&["rev-list", "--parents", "-n", "1", target], path);
        let expected = if start == 0 {
            target.clone()
        } else {
            format!("{target} {}", hashes[start - 1])
        };
        assert_eq!(parents, expected);
        assert_eq!(
            git_output(&["rev-parse", &format!("{target}^{{tree}}")], path),
            git_output(&["rev-parse", &format!("{}^{{tree}}", hashes[end])], path)
        );
        assert_eq!(
            git_output(&["show", "-s", "--format=%an <%ae> %at %ai", target], path),
            author
        );
        assert_eq!(
            git_output(&["show", "-s", "--format=%cn <%ce>", target], path),
            "Current Committer <current@example.com>"
        );
        let seconds = git_output(&["show", "-s", "--format=%ct", target], path)
            .parse::<i64>()
            .unwrap();
        assert!((before..=after).contains(&seconds));
        let raw = squash_raw_bytes(path, target);
        let separator = raw.windows(2).position(|w| w == b"\n\n").unwrap();
        assert_eq!(&raw[separator + 2..], "  gộp\n\nbody\n\n".as_bytes());
        assert_eq!(std::fs::read(path.join(".git/index")).unwrap(), index_bytes);
        assert_eq!(
            std::fs::read(path.join("README.md")).unwrap(),
            b"unstaged\n"
        );
        assert_eq!(
            std::fs::read(path.join("untracked")).unwrap(),
            b"untracked\n"
        );
        assert_eq!(git_output(&["rev-parse", "untouched"], path), *old_head);
        assert_eq!(git_output(&["rev-parse", "original"], path), *old_head);
        // Strict descendants differ only in their parent header.
        let new_chain: Vec<_> = git_output(&["rev-list", "--reverse", "HEAD"], path)
            .lines()
            .map(str::to_owned)
            .collect();
        for old_index in end + 1..5 {
            let old = String::from_utf8(squash_raw_bytes(path, &hashes[old_index])).unwrap();
            let new = String::from_utf8(squash_raw_bytes(
                path,
                &new_chain[old_index - (end - start)],
            ))
            .unwrap();
            assert_eq!(
                old.lines()
                    .filter(|l| !l.starts_with("parent "))
                    .collect::<Vec<_>>(),
                new.lines()
                    .filter(|l| !l.starts_with("parent "))
                    .collect::<Vec<_>>()
            );
        }
    }
}

#[tokio::test]
async fn squash_commits_raw_descendants_and_predecessor_merge_are_preserved() {
    let dir = make_temp_repo();
    let path = dir.path();
    let root = git_output(&["rev-parse", "HEAD"], path);
    let side = squash_raw_commit(path, &[root.clone()], "", b"side\n");
    let merge = squash_raw_commit(path, &[root.clone(), side], "", b"untouched merge\n");
    let oldest = squash_raw_commit(
        path,
        &[merge.clone()],
        "encoding UTF-8\nx-extra preserve me\n",
        b"oldest\n",
    );
    let newest = squash_raw_commit(path, &[oldest.clone()], "", b"newest\n");
    let descendant = squash_raw_commit(
        path,
        &[newest.clone()],
        "encoding ISO-8859-1\nx-extra opaque\n",
        b"opaque \xff\n",
    );
    git(&["update-ref", "refs/heads/main", &descendant], path);
    let result = crate::git::squash_commits(
        path,
        &[oldest, newest],
        "final",
        "refs/heads/main",
        &descendant,
        false,
    )
    .await
    .unwrap();
    assert!(result.ok, "{result:?}");
    assert_eq!(result.rewritten_count, Some(2));
    let target = result.new_target_oid.unwrap();
    let target_raw = String::from_utf8(squash_raw_bytes(path, &target)).unwrap();
    assert!(target_raw.contains("author Old Author <author@example.com> 1700000000 +0530\n"));
    assert!(target_raw.contains("x-extra preserve me\n"));
    assert!(target_raw.ends_with("\n\nfinal\n"));
    assert_eq!(
        git_output(&["rev-parse", &format!("{target}^")], path),
        merge
    );
    let old_raw = squash_raw_bytes(path, &descendant);
    let new_raw = squash_raw_bytes(path, result.new_head_oid.as_ref().unwrap());
    let without_parent = |raw: &[u8]| {
        raw.split(|b| *b == b'\n')
            .filter(|line| !line.starts_with(b"parent "))
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>()
    };
    assert_eq!(without_parent(&old_raw), without_parent(&new_raw));
}

#[tokio::test]
async fn squash_commits_invalid_requests_ranges_and_stale_first_do_not_write() {
    use crate::git::GitBlockReason as Reason;
    let dir = make_temp_repo();
    let path = dir.path();
    let chain = squash_chain(path, 4);
    let tip = &chain[3];
    let before = squash_object_count(path);
    for selection in [
        vec![],
        vec![chain[0].clone()],
        vec![chain[0].clone(), chain[0].clone()],
        vec![chain[0].clone(), chain[0].to_uppercase()],
        vec!["HEAD".into(), chain[1].clone()],
        vec![chain[0][..7].to_string(), chain[1].clone()],
    ] {
        assert!(matches!(
            crate::git::squash_commits(path, &selection, "new", "refs/heads/main", tip, false)
                .await,
            Err(crate::error::AppError::InvalidInput(_))
        ));
    }
    for (message, branch, head) in [
        (" \n\t", "refs/heads/main", tip.as_str()),
        ("new", "main", tip.as_str()),
        ("new", "refs/heads/main", "HEAD"),
    ] {
        assert!(
            crate::git::squash_commits(path, &chain[..2], message, branch, head, false)
                .await
                .is_err()
        );
    }
    for selection in [
        vec![chain[2].clone(), chain[1].clone()],
        vec![chain[0].clone(), chain[2].clone()],
    ] {
        let result =
            crate::git::squash_commits(path, &selection, "new", "refs/heads/main", tip, false)
                .await
                .unwrap();
        assert_eq!(result.blocked_reason, Some(Reason::UnsupportedHistory));
        assert!(result.message.as_deref().unwrap().contains("oldest-first"));
    }
    let fake = vec![
        "1111111111111111111111111111111111111111".into(),
        "2222222222222222222222222222222222222222".into(),
    ];
    let result =
        crate::git::squash_commits(path, &fake, "new", "refs/heads/main", &chain[0], false)
            .await
            .unwrap();
    assert_eq!(result.blocked_reason, Some(Reason::StaleRef));
    let result = crate::git::squash_commits(path, &fake, "new", "refs/heads/main", tip, false)
        .await
        .unwrap();
    assert_eq!(result.blocked_reason, Some(Reason::UnreachableCommit));
    git(&["checkout", "-b", "same-tip"], path);
    let result = crate::git::squash_commits(path, &fake, "new", "refs/heads/main", tip, false)
        .await
        .unwrap();
    assert_eq!(result.blocked_reason, Some(Reason::StaleRef));
    assert_eq!(squash_object_count(path), before);
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), *tip);
}

#[tokio::test]
async fn squash_commits_selected_and_descendant_merges_block_before_signature_consent() {
    use crate::git::GitBlockReason as Reason;
    for parent_count in [2, 3] {
        let dir = make_temp_repo();
        let path = dir.path();
        let chain = squash_chain(path, 3);
        let side = squash_raw_commit(path, &[chain[0].clone()], "", b"side\n");
        let third = squash_raw_commit(path, &[chain[0].clone()], "", b"third\n");
        let mut parents = vec![chain[2].clone(), side];
        if parent_count == 3 {
            parents.push(third);
        }
        let merge = squash_raw_commit(path, &parents, "gpgsig signature\n", b"merge\n");
        git(&["update-ref", "refs/heads/main", &merge], path);
        let before = squash_object_count(path);
        for selected in [
            vec![chain[1].clone(), chain[2].clone()],
            vec![chain[2].clone(), merge.clone()],
            vec![chain[0].clone(), parents[1].clone()],
        ] {
            let result = crate::git::squash_commits(
                path,
                &selected,
                "new",
                "refs/heads/main",
                &merge,
                false,
            )
            .await
            .unwrap();
            assert_eq!(result.blocked_reason, Some(Reason::UnsupportedHistory));
            assert!(result.message.as_deref().unwrap().contains("linear"));
        }
        assert_eq!(squash_object_count(path), before);
        assert_eq!(git_output(&["rev-parse", "HEAD"], path), merge);
    }
}

#[tokio::test]
async fn squash_commits_signatures_cover_oldest_absorbed_newest_and_descendants() {
    for signed_at in 0..4 {
        for key in ["gpgsig", "gpgsig-sha256"] {
            let dir = make_temp_repo();
            let path = dir.path();
            let predecessor = git_output(&["rev-parse", "HEAD"], path);
            let mut chain = Vec::new();
            let mut parent = predecessor;
            for i in 0..4 {
                let extra = if i == signed_at {
                    format!("{key} -----BEGIN SIGNATURE-----\n opaque\n -----END SIGNATURE-----\n")
                } else {
                    String::new()
                };
                let oid =
                    squash_raw_commit(path, &[parent], &extra, format!("node {i}\n").as_bytes());
                chain.push(oid.clone());
                parent = oid;
            }
            git(&["update-ref", "refs/heads/main", &chain[3]], path);
            let before = squash_object_count(path);
            let refused = crate::git::squash_commits(
                path,
                &chain[..3],
                "new",
                "refs/heads/main",
                &chain[3],
                false,
            )
            .await
            .unwrap();
            assert_eq!(
                refused.blocked_reason,
                Some(crate::git::GitBlockReason::SignatureConsentRequired)
            );
            assert_eq!(squash_object_count(path), before);
            assert_eq!(git_output(&["rev-parse", "HEAD"], path), chain[3]);
            let allowed = crate::git::squash_commits(
                path,
                &chain[..3],
                "new",
                "refs/heads/main",
                &chain[3],
                true,
            )
            .await
            .unwrap();
            assert!(allowed.ok, "{allowed:?}");
            assert_eq!(allowed.signatures_removed, Some(true));
            for oid in [
                allowed.new_target_oid.unwrap(),
                allowed.new_head_oid.unwrap(),
            ] {
                assert!(!String::from_utf8_lossy(&squash_raw_bytes(path, &oid)).contains("gpgsig"));
            }
            assert!(
                String::from_utf8_lossy(&squash_raw_bytes(path, &chain[signed_at])).contains(key)
            );
        }
    }
}

#[tokio::test]
async fn squash_commits_mergetags_preserve_predecessor_and_require_consent_for_remapped_parents() {
    for at in 0..3 {
        let dir = make_temp_repo();
        let path = dir.path();
        let mut parent = git_output(&["rev-parse", "HEAD"], path);
        let mut chain = Vec::new();
        let mut tag = String::new();
        for i in 0..3 {
            let extra = if i == at {
                tag = format!("mergetag object {parent}\n type commit\n tag retained\n tagger Test <test@test.com> 1700000000 +0000\n \n tag body\n");
                tag.clone()
            } else {
                String::new()
            };
            let oid = squash_raw_commit(path, &[parent], &extra, format!("node {i}\n").as_bytes());
            chain.push(oid.clone());
            parent = oid;
        }
        git(&["update-ref", "refs/heads/main", &chain[2]], path);
        let refused = crate::git::squash_commits(
            path,
            &chain[..2],
            "new",
            "refs/heads/main",
            &chain[2],
            false,
        )
        .await
        .unwrap();
        if at == 0 {
            assert!(refused.ok, "{refused:?}");
            assert_eq!(refused.signatures_removed, Some(false));
            assert!(String::from_utf8_lossy(&squash_raw_bytes(
                path,
                refused.new_target_oid.as_ref().unwrap()
            ))
            .contains(&tag));
        } else {
            assert_eq!(
                refused.blocked_reason,
                Some(crate::git::GitBlockReason::SignatureConsentRequired)
            );
            let allowed = crate::git::squash_commits(
                path,
                &chain[..2],
                "new",
                "refs/heads/main",
                &chain[2],
                true,
            )
            .await
            .unwrap();
            assert!(allowed.ok, "{allowed:?}");
            assert_eq!(allowed.signatures_removed, Some(true));
            for oid in [
                allowed.new_target_oid.unwrap(),
                allowed.new_head_oid.unwrap(),
            ] {
                assert!(
                    !String::from_utf8_lossy(&squash_raw_bytes(path, &oid)).contains("mergetag")
                );
            }
        }
    }
}

#[tokio::test]
async fn squash_commits_malformed_metadata_and_selected_non_utf8_block_without_writes() {
    for extra in [
        "author Duplicate <duplicate@example.com> 1700000000 +0000\n",
        "committer Duplicate <duplicate@example.com> 1700000000 +0000\n",
        "encoding ISO-8859-1\n",
        "encoding \u{fffd}\n",
        "mergetag object 1111111111111111111111111111111111111111\n type commit\n",
        "mergetag object 1111111111111111111111111111111111111111\n type tree\n",
    ] {
        let dir = make_temp_repo();
        let path = dir.path();
        let root = git_output(&["rev-parse", "HEAD"], path);
        let oldest = squash_raw_commit(path, &[root], extra, b"oldest\n");
        let newest = squash_raw_commit(path, &[oldest.clone()], "", b"newest\n");
        git(&["update-ref", "refs/heads/main", &newest], path);
        let before = squash_object_count(path);
        let result = crate::git::squash_commits(
            path,
            &[oldest, newest.clone()],
            "new",
            "refs/heads/main",
            &newest,
            true,
        )
        .await
        .unwrap();
        assert!(!result.ok, "{extra}: {result:?}");
        assert!(matches!(
            result.blocked_reason,
            Some(
                crate::git::GitBlockReason::InvalidCommitMetadata
                    | crate::git::GitBlockReason::UnsupportedHistory
            )
        ));
        assert_eq!(git_output(&["rev-parse", "HEAD"], path), newest);
        assert_eq!(squash_object_count(path), before);
    }
    let dir = make_temp_repo();
    let path = dir.path();
    let root = git_output(&["rev-parse", "HEAD"], path);
    let bad = squash_raw_commit(path, &[root.clone()], "", b"bad \xff\n");
    git(&["update-ref", "refs/heads/main", &bad], path);
    let result = crate::git::squash_commits(
        path,
        &[root, bad.clone()],
        "new",
        "refs/heads/main",
        &bad,
        false,
    )
    .await
    .unwrap();
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::UnsupportedHistory)
    );
}

#[tokio::test]
async fn squash_commits_active_detached_unborn_and_worktree_guards() {
    use crate::git::GitBlockReason as Reason;
    let dir = make_temp_repo();
    let path = dir.path();
    let chain = squash_chain(path, 2);
    std::fs::create_dir(path.join(".git/rebase-merge")).unwrap();
    let blocked =
        crate::git::squash_commits(path, &chain, "new", "refs/heads/main", &chain[1], false)
            .await
            .unwrap();
    assert_eq!(blocked.blocked_reason, Some(Reason::ActiveOperation));
    assert!(blocked.recovery.is_some());
    std::fs::remove_dir(path.join(".git/rebase-merge")).unwrap();
    git(&["checkout", "--detach"], path);
    let blocked =
        crate::git::squash_commits(path, &chain, "new", "refs/heads/main", &chain[1], false)
            .await
            .unwrap();
    assert_eq!(blocked.blocked_reason, Some(Reason::DetachedHead));
    git(&["checkout", "main"], path);
    let wt_parent = tempfile::tempdir().unwrap();
    let wt = wt_parent.path().join("linked");
    git(
        &["worktree", "add", "-b", "linked", wt.to_str().unwrap()],
        path,
    );
    git(&["checkout", "--ignore-other-worktrees", "main"], &wt);
    let blocked =
        crate::git::squash_commits(path, &chain, "new", "refs/heads/main", &chain[1], false)
            .await
            .unwrap();
    assert_eq!(blocked.blocked_reason, Some(Reason::CheckedOutBranch));
    git(&["checkout", "linked"], &wt);
    let result =
        crate::git::squash_commits(&wt, &chain, "new", "refs/heads/linked", &chain[1], false)
            .await
            .unwrap();
    assert!(result.ok, "{result:?}");
    assert_eq!(git_output(&["rev-parse", "main"], path), chain[1]);
    let unborn = tempfile::tempdir().unwrap();
    git(&["init", "-b", "main"], unborn.path());
    let blocked = crate::git::squash_commits(
        unborn.path(),
        &chain,
        "new",
        "refs/heads/main",
        &chain[1],
        false,
    )
    .await
    .unwrap();
    assert_eq!(blocked.blocked_reason, Some(Reason::DetachedHead));
}

#[tokio::test]
async fn squash_commits_pending_revert_preserves_conflict_state_without_writes() {
    let dir = make_temp_repo();
    let path = dir.path();
    let root = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("README.md"), "second version\n").unwrap();
    git(&["commit", "-am", "second"], path);
    let second = git_output(&["rev-parse", "HEAD"], path);
    std::fs::write(path.join("README.md"), "third version\n").unwrap();
    git(&["commit", "-am", "third"], path);
    let tip = git_output(&["rev-parse", "HEAD"], path);
    let revert = Command::new("git")
        .args(["revert", "--no-edit", &second])
        .current_dir(path)
        .output()
        .unwrap();
    assert!(!revert.status.success());
    let repo = git2::Repository::open(path).unwrap();
    assert_eq!(repo.state(), git2::RepositoryState::Revert);
    let index = std::fs::read(repo.path().join("index")).unwrap();
    let worktree = std::fs::read(path.join("README.md")).unwrap();
    let revert_head = std::fs::read(repo.path().join("REVERT_HEAD")).unwrap();
    let objects = squash_object_count(path);
    let blocked =
        crate::git::squash_commits(path, &[root, second], "new", "refs/heads/main", &tip, false)
            .await
            .unwrap();
    assert_eq!(
        blocked.blocked_reason,
        Some(crate::git::GitBlockReason::ActiveOperation)
    );
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), tip);
    assert_eq!(std::fs::read(repo.path().join("index")).unwrap(), index);
    assert_eq!(std::fs::read(path.join("README.md")).unwrap(), worktree);
    assert_eq!(
        std::fs::read(repo.path().join("REVERT_HEAD")).unwrap(),
        revert_head
    );
    assert_eq!(squash_object_count(path), objects);
}

#[tokio::test]
async fn squash_commits_unsafe_history_and_guard_inspection_fail_closed() {
    for guard in [
        "replace",
        "grafts",
        "shallow",
        "unreadable-grafts",
        "missing-parent",
    ] {
        let dir = make_temp_repo();
        let path = dir.path();
        let chain = squash_chain(path, 3);
        match guard {
            "replace" => git(&["replace", &chain[0], &chain[1]], path),
            "grafts" => {
                std::fs::create_dir_all(path.join(".git/info")).unwrap();
                std::fs::write(path.join(".git/info/grafts"), format!("{}\n", chain[0])).unwrap();
            }
            "unreadable-grafts" => {
                std::fs::create_dir_all(path.join(".git/info/grafts")).unwrap();
            }
            "shallow" => {
                std::fs::write(path.join(".git/shallow"), format!("{}\n", chain[0])).unwrap();
            }
            "missing-parent" => {
                let hash = &chain[0];
                std::fs::remove_file(path.join(".git/objects").join(&hash[..2]).join(&hash[2..]))
                    .unwrap();
            }
            _ => unreachable!(),
        }
        let result = crate::git::squash_commits(
            path,
            &chain[1..],
            "new",
            "refs/heads/main",
            &chain[2],
            false,
        )
        .await;
        if guard == "unreadable-grafts" {
            assert!(result.is_err());
        } else {
            assert_eq!(
                result.unwrap().blocked_reason,
                Some(crate::git::GitBlockReason::UnsupportedHistory)
            );
        }
        assert_eq!(git_output(&["rev-parse", "HEAD"], path), chain[2]);
    }
}

#[test]
fn squash_commits_final_cas_rejects_independent_tip_and_head_writers() {
    use super::commit_message_rewrite::{publish_checked_ref, snapshot_branch, RewriteFailure};
    let dir = make_temp_repo();
    let path = dir.path();
    let chain = squash_chain(path, 3);
    let repo = git2::Repository::open(path).unwrap();
    let captured = snapshot_branch(&repo).unwrap();
    git(&["update-ref", "refs/heads/main", &chain[1]], path);
    let result = publish_checked_ref(
        &repo,
        &captured,
        git2::Oid::from_str(&chain[0]).unwrap(),
        "squash commits",
    );
    assert!(matches!(
        result,
        Err(RewriteFailure::Block(
            crate::git::GitBlockReason::StaleRef,
            _
        ))
    ));
    assert_eq!(git_output(&["rev-parse", "main"], path), chain[1]);
    let captured = snapshot_branch(&repo).unwrap();
    git(&["checkout", "-b", "independent"], path);
    let result = publish_checked_ref(
        &repo,
        &captured,
        git2::Oid::from_str(&chain[0]).unwrap(),
        "squash commits",
    );
    assert!(matches!(
        result,
        Err(RewriteFailure::Block(
            crate::git::GitBlockReason::StaleRef,
            _
        ))
    ));
    assert_eq!(
        git_output(&["symbolic-ref", "HEAD"], path),
        "refs/heads/independent"
    );
    assert_eq!(git_output(&["rev-parse", "main"], path), chain[1]);
}

#[tokio::test]
async fn squash_commits_missing_identity_cannot_be_satisfied_by_host_globals_or_write_objects() {
    let dir = make_temp_repo();
    let path = dir.path();
    let chain = squash_chain(path, 2);
    // Empty local values mask every lower-priority global/system identity without process env races.
    git(&["config", "user.name", ""], path);
    git(&["config", "user.email", ""], path);
    let before = squash_object_count(path);
    let index = std::fs::read(path.join(".git/index")).unwrap();
    let error =
        crate::git::squash_commits(path, &chain, "new", "refs/heads/main", &chain[1], false)
            .await
            .unwrap_err();
    assert!(error
        .to_string()
        .contains("git user not configured (set user.name and user.email)"));
    assert_eq!(squash_object_count(path), before);
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), chain[1]);
    assert_eq!(std::fs::read(path.join(".git/index")).unwrap(), index);
}

#[tokio::test]
async fn squash_commits_publication_uncertainty_does_not_claim_candidate_oids_installed() {
    let dir = make_temp_repo();
    let path = dir.path();
    let chain = squash_chain(path, 3);
    let index = std::fs::read(path.join(".git/index")).unwrap();
    // Explicit unit-only fault injection at transaction commit, after the real ODB writes/locks.
    super::commit_message_rewrite::inject_publication_failure();
    let result = crate::git::squash_commits(
        path,
        &chain[..2],
        "new",
        "refs/heads/main",
        &chain[2],
        false,
    )
    .await
    .unwrap();
    assert!(!result.ok);
    assert_eq!(
        result.blocked_reason,
        Some(crate::git::GitBlockReason::PublicationUncertain)
    );
    assert!(result.new_target_oid.is_none());
    assert!(result.new_head_oid.is_none());
    assert_eq!(result.old_target_oid.as_ref(), Some(&chain[1]));
    assert_eq!(result.old_head_oid.as_ref(), Some(&chain[2]));
    assert!(result
        .message
        .as_deref()
        .unwrap()
        .contains("candidate tip="));
    assert!(result
        .message
        .as_deref()
        .unwrap()
        .contains("candidate squash="));
    assert!(result
        .message
        .as_deref()
        .unwrap()
        .contains("observed HEAD="));
    assert_eq!(git_output(&["rev-parse", "HEAD"], path), chain[2]);
    assert_eq!(std::fs::read(path.join(".git/index")).unwrap(), index);
}
