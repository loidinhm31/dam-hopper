use std::path::Path;
use std::process::Command;

use dam_hopper_server::{
    error::AppError,
    workspace_target::{ProjectTargetRef, WorkspaceTargetError, WorkspaceTargetResolver},
};

fn git(args: &[&str], cwd: &Path) -> std::process::Output {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command should spawn");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn run_git(args: &[&str], cwd: &Path) -> std::process::Output {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command should spawn")
}

fn init_repo(path: &Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "test@example.com"], path);
    git(&["config", "user.name", "Test User"], path);
    std::fs::write(path.join("README.md"), "root\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "init"], path);
}

fn target(project: &str, path: &Path) -> ProjectTargetRef {
    ProjectTargetRef {
        project: project.to_string(),
        worktree_path: Some(path.to_string_lossy().into_owned()),
    }
}

async fn add_worktree(repo: &Path, name: &str) -> tempfile::TempDir {
    let parent = tempfile::tempdir().unwrap();
    let path = parent.path().join(name);
    let branch = format!("feature/{name}");
    git(&["branch", &branch], repo);
    let path_text = path.to_string_lossy().into_owned();
    git(&["worktree", "add", &path_text, &branch], repo);
    parent
}

#[tokio::test]
async fn add_list_select_remove_lifecycle_stays_on_configured_repository() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let worktree_parent = add_worktree(repo.path(), "feature-one").await;
    let worktree = worktree_parent.path().join("feature-one");
    let resolver = WorkspaceTargetResolver::new();

    let listed = resolver
        .refresh_project_worktrees(repo.path())
        .await
        .unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed.iter().any(|candidate| candidate.is_main));
    assert!(listed.iter().any(|candidate| candidate.path == worktree));

    let selected = resolver
        .resolve(&target("demo", &worktree), repo.path())
        .await
        .unwrap();
    assert_eq!(
        selected.target_path(),
        dunce::canonicalize(&worktree).unwrap().as_path()
    );
    assert_eq!(
        selected.worktree().unwrap().repository_path,
        worktree.to_string_lossy().as_ref()
    );

    let worktree_text = worktree.to_string_lossy().into_owned();
    git(&["worktree", "remove", &worktree_text], repo.path());
    resolver.invalidate(repo.path()).await;
    let refreshed = resolver
        .refresh_project_worktrees(repo.path())
        .await
        .unwrap();
    assert_eq!(refreshed.len(), 1);
    assert!(refreshed[0].is_main);
    assert!(resolver
        .resolve(
            &ProjectTargetRef {
                project: "demo".into(),
                worktree_path: None
            },
            repo.path()
        )
        .await
        .unwrap()
        .is_root());
}

#[tokio::test]
async fn dirty_worktree_requires_explicit_force_removal() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let worktree_parent = add_worktree(repo.path(), "dirty").await;
    let worktree = worktree_parent.path().join("dirty");
    std::fs::write(worktree.join("README.md"), "changed\n").unwrap();
    std::fs::write(worktree.join("untracked.txt"), "untracked\n").unwrap();

    let path_text = worktree.to_string_lossy().into_owned();
    let rejected = run_git(&["worktree", "remove", &path_text], repo.path());
    assert!(!rejected.status.success());
    assert!(worktree.exists());

    git(&["worktree", "remove", "--force", &path_text], repo.path());
    assert!(!worktree.exists());
}

#[tokio::test]
async fn external_disappearance_is_unavailable_until_pruned() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let worktree_parent = add_worktree(repo.path(), "gone").await;
    let worktree = worktree_parent.path().join("gone");
    let resolver = WorkspaceTargetResolver::new();

    std::fs::remove_dir_all(&worktree).unwrap();
    let listed = resolver
        .refresh_project_worktrees(repo.path())
        .await
        .unwrap();
    let stale = listed
        .iter()
        .find(|candidate| candidate.path == worktree)
        .unwrap();
    assert!(stale.is_prunable);
    assert!(!stale.is_available);

    let error = resolver
        .resolve(&target("demo", &worktree), repo.path())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        AppError::WorkspaceTarget(WorkspaceTargetError::UnavailableTarget)
    ));

    git(&["worktree", "prune"], repo.path());
    resolver.invalidate(repo.path()).await;
    let pruned = resolver
        .refresh_project_worktrees(repo.path())
        .await
        .unwrap();
    assert!(pruned.iter().all(|candidate| candidate.path != worktree));
}

#[tokio::test]
async fn concurrent_repository_discovery_does_not_cross_authorize_targets() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    init_repo(first.path());
    init_repo(second.path());
    let first_parent = add_worktree(first.path(), "first-feature").await;
    let second_parent = add_worktree(second.path(), "second-feature").await;
    let first_target = first_parent.path().join("first-feature");
    let second_target = second_parent.path().join("second-feature");
    let resolver = WorkspaceTargetResolver::new();

    let (first_list, second_list) = tokio::join!(
        resolver.refresh_project_worktrees(first.path()),
        resolver.refresh_project_worktrees(second.path()),
    );
    assert_eq!(first_list.unwrap().len(), 2);
    assert_eq!(second_list.unwrap().len(), 2);
    assert!(resolver
        .resolve(&target("first", &first_target), first.path())
        .await
        .is_ok());

    let foreign = resolver
        .resolve(&target("first", &second_target), first.path())
        .await
        .unwrap_err();
    assert!(matches!(
        foreign,
        AppError::WorkspaceTarget(WorkspaceTargetError::UnregisteredTarget)
    ));
}
