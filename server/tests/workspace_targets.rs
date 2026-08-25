use std::path::Path;
use std::process::Command;

use dam_hopper_server::{
    error::AppError,
    workspace_target::{ProjectTargetRef, WorkspaceTargetError, WorkspaceTargetResolver},
};

fn git(args: &[&str], cwd: &Path) {
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
}

fn init_repo(path: &Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "test@example.com"], path);
    git(&["config", "user.name", "Test User"], path);
    std::fs::write(path.join("README.md"), "root\n").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "init"], path);
}

fn target(project: &str, path: Option<&Path>) -> ProjectTargetRef {
    ProjectTargetRef {
        project: project.to_string(),
        worktree_path: path.map(|path| path.to_string_lossy().into_owned()),
    }
}

fn target_error(error: AppError, expected: WorkspaceTargetError) {
    assert_eq!(
        error.to_string(),
        AppError::WorkspaceTarget(expected.clone()).to_string()
    );
    assert!(matches!(
        error,
        AppError::WorkspaceTarget(actual) if actual == expected
    ));
}

#[test]
fn target_errors_expose_stable_codes() {
    let cases = [
        (
            WorkspaceTargetError::UnknownProject,
            "WORKSPACE_PROJECT_NOT_FOUND",
        ),
        (
            WorkspaceTargetError::UnregisteredTarget,
            "WORKSPACE_TARGET_UNREGISTERED",
        ),
        (
            WorkspaceTargetError::UnavailableTarget,
            "WORKSPACE_TARGET_UNAVAILABLE",
        ),
        (
            WorkspaceTargetError::InvalidPath,
            "WORKSPACE_TARGET_INVALID_PATH",
        ),
    ];
    for (error, code) in cases {
        assert_eq!(AppError::WorkspaceTarget(error).api_code(), Some(code));
    }
}

#[tokio::test]
async fn resolver_accepts_root_worktree_spaces_and_symlink_aliases() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(&["branch", "feature"], repo.path());

    let worktree_path = repo.path().join("feature worktree");
    let worktree_string = worktree_path.to_string_lossy().into_owned();
    git(
        &["worktree", "add", &worktree_string, "feature"],
        repo.path(),
    );

    let alias_parent = tempfile::tempdir().unwrap();
    let alias = alias_parent.path().join("worktree-link");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&worktree_path, &alias).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&worktree_path, &alias).unwrap();

    let resolver = WorkspaceTargetResolver::new();
    let root = resolver
        .resolve(&target("demo", None), repo.path())
        .await
        .unwrap();
    assert!(root.is_root());
    assert_eq!(
        root.target_path(),
        dunce::canonicalize(repo.path()).unwrap().as_path()
    );
    assert_eq!(root.target_key(), "root");

    let explicit_root = resolver
        .resolve(&target("demo", Some(repo.path())), repo.path())
        .await
        .unwrap();
    assert!(!explicit_root.is_root());
    assert!(explicit_root.worktree().unwrap().is_main);
    assert_eq!(
        explicit_root.worktree().unwrap().repository_path,
        repo.path().to_string_lossy().as_ref()
    );

    let resolved = resolver
        .resolve(&target("demo", Some(&alias)), repo.path())
        .await
        .unwrap();
    assert!(!resolved.is_root());
    assert!(resolved.available());
    assert_eq!(
        resolved.target_path(),
        dunce::canonicalize(&worktree_path).unwrap().as_path()
    );
    assert_eq!(resolved.worktree().unwrap().branch, "feature");
}

#[tokio::test]
async fn resolver_maps_nested_project_to_the_same_subdirectory_in_each_worktree() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let nested = repo.path().join("packages").join("app");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("package.json"), "{}\n").unwrap();
    git(&["add", "packages/app/package.json"], repo.path());
    git(&["commit", "-m", "nested app"], repo.path());
    git(&["branch", "feature"], repo.path());

    let worktree_root = repo.path().join("feature-root");
    let worktree_string = worktree_root.to_string_lossy().into_owned();
    git(
        &["worktree", "add", &worktree_string, "feature"],
        repo.path(),
    );

    let resolver = WorkspaceTargetResolver::new();
    let selected_path = worktree_root.join("packages").join("app");
    let resolved = resolver
        .resolve(&target("nested", Some(&selected_path)), &nested)
        .await
        .unwrap();

    assert_eq!(
        resolved.target_path(),
        dunce::canonicalize(&selected_path).unwrap().as_path()
    );
    let listed = resolver.refresh_project_worktrees(&nested).await.unwrap();
    let listed_feature = listed
        .iter()
        .find(|worktree| worktree.repository_path == worktree_string)
        .unwrap();
    assert_eq!(
        listed_feature.path,
        selected_path.to_string_lossy().as_ref()
    );
    let error = resolver
        .resolve(&target("nested", Some(&worktree_root)), &nested)
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);
}

#[tokio::test]
async fn resolver_rejects_arbitrary_and_foreign_paths() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let sibling = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    init_repo(foreign.path());

    let resolver = WorkspaceTargetResolver::new();
    let error = resolver
        .resolve(&target("demo", Some(sibling.path())), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);

    let error = resolver
        .resolve(&target("demo", Some(foreign.path())), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);

    let error = resolver
        .resolve(
            &ProjectTargetRef {
                project: "demo".into(),
                worktree_path: Some("relative/worktree".into()),
            },
            repo.path(),
        )
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::InvalidPath);
}

#[tokio::test]
async fn resolver_maps_explicit_target_on_non_git_project_to_unregistered() {
    let project = tempfile::tempdir().unwrap();
    let target_path = tempfile::tempdir().unwrap();
    let resolver = WorkspaceTargetResolver::new();

    let error = resolver
        .resolve(&target("plain", Some(target_path.path())), project.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);

    let error = resolver
        .resolve(&target("plain", Some(project.path())), project.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);
}

#[tokio::test]
async fn resolver_reports_bare_repository_as_unavailable() {
    let repo = tempfile::tempdir().unwrap();
    git(&["init", "--bare"], repo.path());

    let resolver = WorkspaceTargetResolver::new();
    let listed = resolver
        .refresh_project_worktrees(repo.path())
        .await
        .unwrap();

    assert_eq!(listed.len(), 1);
    assert!(listed[0].is_bare);
    assert!(!listed[0].is_available);

    let error = resolver
        .resolve(&target("bare", Some(repo.path())), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnavailableTarget);
}

#[tokio::test]
async fn resolver_rejects_missing_registered_worktree_as_unavailable() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(&["branch", "gone"], repo.path());
    let missing = repo.path().join("missing worktree");
    let missing_string = missing.to_string_lossy().into_owned();
    git(&["worktree", "add", &missing_string, "gone"], repo.path());
    std::fs::remove_dir_all(&missing).unwrap();

    let resolver = WorkspaceTargetResolver::new();
    let error = resolver
        .resolve(&target("demo", Some(&missing)), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnavailableTarget);
}

#[tokio::test]
#[cfg(unix)]
async fn resolver_rejects_a_registered_path_replaced_by_a_symlink() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(&["branch", "feature"], repo.path());
    let worktree_path = repo.path().join("feature-worktree");
    let worktree_string = worktree_path.to_string_lossy().into_owned();
    git(
        &["worktree", "add", &worktree_string, "feature"],
        repo.path(),
    );

    let resolver = WorkspaceTargetResolver::new();
    resolver
        .resolve(&target("demo", Some(&worktree_path)), repo.path())
        .await
        .unwrap();

    let outside = tempfile::tempdir().unwrap();
    std::fs::remove_dir_all(&worktree_path).unwrap();
    std::os::unix::fs::symlink(outside.path(), &worktree_path).unwrap();

    let error = resolver
        .resolve(&target("demo", Some(&worktree_path)), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnavailableTarget);
}

#[tokio::test]
async fn resolver_does_not_authorize_a_removed_worktree_recreated_as_a_directory() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(&["branch", "feature"], repo.path());
    let worktree_path = repo.path().join("feature-worktree");
    let worktree_string = worktree_path.to_string_lossy().into_owned();
    git(
        &["worktree", "add", &worktree_string, "feature"],
        repo.path(),
    );

    let resolver = WorkspaceTargetResolver::new();
    resolver
        .resolve(&target("demo", Some(&worktree_path)), repo.path())
        .await
        .unwrap();

    git(
        &["worktree", "remove", "--force", &worktree_string],
        repo.path(),
    );
    std::fs::create_dir_all(&worktree_path).unwrap();
    let error = resolver
        .resolve(&target("demo", Some(&worktree_path)), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);
}

#[tokio::test]
#[cfg(unix)]
async fn resolver_does_not_treat_a_worktree_symlink_to_root_as_the_root_target() {
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(&["branch", "feature"], repo.path());
    let worktree_path = repo.path().join("feature-worktree");
    let worktree_string = worktree_path.to_string_lossy().into_owned();
    git(
        &["worktree", "add", &worktree_string, "feature"],
        repo.path(),
    );

    let resolver = WorkspaceTargetResolver::new();
    resolver
        .resolve(&target("demo", Some(&worktree_path)), repo.path())
        .await
        .unwrap();
    git(
        &["worktree", "remove", "--force", &worktree_string],
        repo.path(),
    );
    std::os::unix::fs::symlink(repo.path(), &worktree_path).unwrap();

    let error = resolver
        .resolve(&target("demo", Some(&worktree_path)), repo.path())
        .await
        .unwrap_err();
    target_error(error, WorkspaceTargetError::UnregisteredTarget);
}
