use super::root::*;
use std::fs;
use std::time::Duration;
use tempfile::tempdir;

#[test]
fn test_root_id_syntax_validation() {
    assert!(validate_root_id_syntax(".").is_ok());
    assert!(validate_root_id_syntax("subproject").is_ok());
    assert!(validate_root_id_syntax("packages/ui").is_ok());

    // Prohibited cases
    assert!(validate_root_id_syntax("").is_err());
    assert!(validate_root_id_syntax("/absolute/path").is_err());
    assert!(validate_root_id_syntax("../escaped").is_err());
    assert!(validate_root_id_syntax("nested/../escaped").is_err());
    assert!(validate_root_id_syntax("with\0null").is_err());
    assert!(validate_root_id_syntax("*").is_err());
    assert!(validate_root_id_syntax("sub/*").is_err());

    // Depth > 64
    let deep_path = (0..65).map(|_| "a").collect::<Vec<_>>().join("/");
    assert!(validate_root_id_syntax(&deep_path).is_err());

    // Length > 4096
    let long_component = "a".repeat(4097);
    assert!(validate_root_id_syntax(&long_component).is_err());
}

#[test]
fn test_project_root_preflight_success() {
    let tmp = tempdir().unwrap();
    let project_path = tmp.path().join("my-project");
    fs::create_dir_all(&project_path).unwrap();

    // Create .git directory
    fs::create_dir_all(project_path.join(".git")).unwrap();

    let mut budget = PreflightBudget::default();
    let res = validate_project_root_preflight(&project_path, ".", None, &mut budget);
    assert!(res.is_ok());
    let validated = res.unwrap();
    assert_eq!(validated.root_id, ".");
    assert!(validated.canonical_root.exists());
}

#[test]
fn test_sub_root_preflight_success() {
    let tmp = tempdir().unwrap();
    let project_path = tmp.path().join("my-project");
    let sub_path = project_path.join("packages/sub");
    fs::create_dir_all(&sub_path).unwrap();

    // Create .git file (like a worktree or submodule)
    fs::write(sub_path.join(".git"), "gitdir: ../../.git/worktrees/sub\n").unwrap();

    let mut budget = PreflightBudget::default();
    let res = validate_project_root_preflight(&project_path, "packages/sub", None, &mut budget);
    assert!(res.is_ok());
    let validated = res.unwrap();
    assert_eq!(validated.root_id, "packages/sub");
}

#[test]
fn test_missing_git_marker_fails() {
    let tmp = tempdir().unwrap();
    let project_path = tmp.path().join("no-git-project");
    fs::create_dir_all(&project_path).unwrap();

    let mut budget = PreflightBudget::default();
    let res = validate_project_root_preflight(&project_path, ".", None, &mut budget);
    assert_eq!(res.unwrap_err(), RootPreflightError::GitMarkerMissing);
}

#[test]
fn test_budget_exhaustion_ops() {
    let tmp = tempdir().unwrap();
    let project_path = tmp.path().join("my-project");
    fs::create_dir_all(&project_path).unwrap();
    fs::create_dir_all(project_path.join(".git")).unwrap();

    // Limit ops to 1
    let mut budget = PreflightBudget::new_with_limits(1, 100_000, Duration::from_secs(10));
    let res = validate_project_root_preflight(&project_path, ".", None, &mut budget);
    match res {
        Err(RootPreflightError::BudgetExhausted(msg)) => {
            assert!(msg.contains("metadata operations"));
        }
        _ => panic!("Expected BudgetExhausted error, got {res:?}"),
    }
}

#[test]
fn test_untargeted_matching() {
    let tmp = tempdir().unwrap();
    let p1 = tmp.path().join("proj1");
    let p2 = tmp.path().join("proj2");
    fs::create_dir_all(&p1).unwrap();
    fs::create_dir_all(&p2).unwrap();

    let canon_p1 = dunce::canonicalize(&p1).unwrap();
    let canon_p2 = dunce::canonicalize(&p2).unwrap();

    let inside_p1 = p1.join("src/lib");
    fs::create_dir_all(&inside_p1).unwrap();
    let canon_inside_p1 = dunce::canonicalize(&inside_p1).unwrap();

    let mut budget = PreflightBudget::default();

    // 1 match -> ok
    let matched = match_untargeted_cwd_to_project_root(
        &canon_inside_p1,
        &[canon_p1.clone(), canon_p2.clone()],
        &mut budget,
    )
    .unwrap();
    assert_eq!(matched, canon_p1);

    // 0 match -> TargetUnavailable
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let canon_outside = dunce::canonicalize(&outside).unwrap();
    let err0 = match_untargeted_cwd_to_project_root(
        &canon_outside,
        &[canon_p1.clone(), canon_p2.clone()],
        &mut budget,
    );
    assert_eq!(err0.unwrap_err(), RootPreflightError::TargetUnavailable);

    // Ambiguous (nested projects: outer and inner)
    let inner_proj = p1.join("nested_proj");
    fs::create_dir_all(&inner_proj).unwrap();
    let canon_inner = dunce::canonicalize(&inner_proj).unwrap();
    let deep_in_nested = inner_proj.join("src");
    fs::create_dir_all(&deep_in_nested).unwrap();
    let canon_deep = dunce::canonicalize(&deep_in_nested).unwrap();

    let err_ambig = match_untargeted_cwd_to_project_root(
        &canon_deep,
        &[canon_p1, canon_inner],
        &mut budget,
    );
    assert_eq!(err_ambig.unwrap_err(), RootPreflightError::TargetUnavailable);
}
