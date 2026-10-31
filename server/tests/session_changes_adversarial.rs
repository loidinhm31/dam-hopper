use dam_hopper_server::session_changes::{
    capture::{capture_session_paths, probe_file_safely, register_session, ProbeResult},
    comparison::run_comparison_scan,
    root::{validate_project_root_preflight, PreflightBudget},
    store::{BoundTerminalTarget, SessionChangesKey, SessionChangesService},
    types::*,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tempfile::tempdir;

fn hash_file(path: &Path) -> Option<String> {
    if !path.exists() || !path.is_file() {
        return None;
    }
    let data = fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Some(hex::encode(hasher.finalize()))
}

#[tokio::test]
async fn test_adversarial_root_preflight_and_invariance() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();

    let tracked = root.join("main.rs");
    fs::write(&tracked, "fn main() { println!(\"hello\"); }\n").unwrap();
    let hash_before = hash_file(&tracked).unwrap();

    // 1. Root preflight
    let mut budget = PreflightBudget::default();
    let preflight = validate_project_root_preflight(&root, ".", None, &mut budget);
    assert!(preflight.is_ok());

    // Adversarial: parent directory traversal
    let bad_preflight = validate_project_root_preflight(&root, "../sneaky", None, &mut budget);
    assert!(bad_preflight.is_err());

    // 2. Baseline capture
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());
    service.bind_terminal_target(
        "term-adv",
        1,
        BoundTerminalTarget {
            project_name: Some("test-project".into()),
            worktree_path: None,
            launch_cwd: root.clone(),
        },
    );

    let reg = register_session(
        &service,
        "term-adv".into(),
        "1".into(),
        &root,
        RegisterRequest {
            version: 1,
            omp_session_id: "sess-adv".into(),
            root_id: ".".into(),
            cwd_hint: None,
        },
    )
    .await
    .unwrap();

    capture_session_paths(
        &service,
        "term-adv".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "sess-adv".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id.clone(),
            capture_id: "cap-1".into(),
            paths: vec!["main.rs".into()],
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();

    let key = SessionChangesKey {
        terminal_id: "term-adv".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "sess-adv".into(),
        root_id: ".".into(),
    };

    // 3. Compare revision
    let comp = run_comparison_scan(&service, &key, None)
        .await
        .unwrap();

    assert!(comp.counts_complete);
    assert_eq!(comp.changed_file_count, 0);

    // 4. Invariance verification: repository file content must NOT have been mutated
    let hash_after = hash_file(&tracked).unwrap();
    assert_eq!(
        hash_before, hash_after,
        "Repository file must remain unmodified by session changes operations"
    );
}

#[tokio::test]
async fn test_adversarial_symlink_and_deep_paths() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();

    // Create outside file
    let outside_dir = tmp.path().join("outside");
    fs::create_dir_all(&outside_dir).unwrap();
    let secret_file = outside_dir.join("secret.env");
    fs::write(&secret_file, "SECRET_KEY=123456\n").unwrap();

    // Symlink inside pointing outside
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let link_path = root.join("link_to_secret");
        let _ = symlink(&secret_file, &link_path);
        let probe = probe_file_safely(None, &root, "link_to_secret");
        match probe {
            ProbeResult::Unknown { reason } => assert_eq!(reason, CoverageReason::Symlink),
            _ => panic!("Expected symlink to be rejected"),
        }
    }

    // Path traversal in relative path
    let probe_traversal = probe_file_safely(None, &root, "../outside/secret.env");
    match probe_traversal {
        ProbeResult::Unknown { reason } => assert_eq!(reason, CoverageReason::PathLimit),
        _ => panic!("Expected traversal to be rejected"),
    }

    // Deep path exceeding MAX_PATH_DEPTH
    let mut deep_path = String::new();
    for i in 0..MAX_PATH_DEPTH + 5 {
        deep_path.push_str(&format!("dir_{}/", i));
    }
    deep_path.push_str("file.txt");
    let probe_deep = probe_file_safely(None, &root, &deep_path);
    match probe_deep {
        ProbeResult::Unknown { reason } => assert_eq!(reason, CoverageReason::PathLimit),
        _ => panic!("Expected deep path to exceed path depth limit"),
    }
}

#[test]
fn test_absence_proof_behavior() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn add() {}\n").unwrap();

    // Absent file under real directory
    let res = probe_file_safely(None, &root, "src/missing.ts");
    match res {
        ProbeResult::AbsentAtFirstTouch => {}
        _ => panic!("Expected AbsentAtFirstTouch"),
    }

    // Absent file under missing directory
    let res2 = probe_file_safely(None, &root, "nested/missing/dir/file.txt");
    match res2 {
        ProbeResult::AbsentAtFirstTouch => {}
        _ => panic!("Expected AbsentAtFirstTouch for non-existent hierarchy"),
    }
}
