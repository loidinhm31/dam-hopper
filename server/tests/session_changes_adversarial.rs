use dam_hopper_server::session_changes::{
    absence::{AbsenceTrie, EntryKind},
    capture::{activate_session_baseline, prepare_session_capture, receive_session_receipt, PrepareOutcome},
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
    let service = Arc::new(SessionChangesService::new().unwrap());
    service.bind_terminal_target(
        "term-adv",
        1,
        BoundTerminalTarget {
            project_name: Some("test-project".into()),
            worktree_path: None,
            launch_cwd: root.clone(),
        },
    );

    let req = PrepareRequest {
        version: 1,
        registration_id: "reg-adv".into(),
        omp_session_id: "sess-adv".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    };

    let outcome = prepare_session_capture(
        &service,
        "term-adv".into(),
        "1".into(),
        &root,
        req,
    )
    .await
    .unwrap();

    let prepared = match outcome {
        PrepareOutcome::Prepared(p) => p,
        _ => panic!("Expected PrepareOutcome::Prepared"),
    };
    assert_eq!(prepared.baseline_coverage.captured_entries, 1);

    let key = SessionChangesKey {
        terminal_id: "term-adv".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "sess-adv".into(),
        root_id: ".".into(),
    };

    // Activate & acknowledge receipt
    let act = activate_session_baseline(
        &service,
        &key,
        &ActivationRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            registration_id: "reg-adv".into(),
            omp_session_id: "sess-adv".into(),
            root_id: ".".into(),
            baseline_id: prepared.baseline_id.clone(),
            activation_nonce: prepared.activation_nonce.clone(),
        },
    )
    .unwrap();

    receive_session_receipt(
        &service,
        &key,
        &ReceiptRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            registration_id: "reg-adv".into(),
            omp_session_id: "sess-adv".into(),
            root_id: ".".into(),
            baseline_id: prepared.baseline_id.clone(),
            activation_nonce: prepared.activation_nonce.clone(),
            activation_receipt_id: act.activation_receipt_id,
        },
    )
    .unwrap();

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
    }

    let service = Arc::new(SessionChangesService::new().unwrap());
    service.bind_terminal_target(
        "term-sym",
        1,
        BoundTerminalTarget {
            project_name: Some("test-project".into()),
            worktree_path: None,
            launch_cwd: root.clone(),
        },
    );

    let req = PrepareRequest {
        version: 1,
        registration_id: "reg-sym".into(),
        omp_session_id: "sess-sym".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    };

    let outcome = prepare_session_capture(
        &service,
        "term-sym".into(),
        "1".into(),
        &root,
        req,
    )
    .await
    .unwrap();

    let prepared = match outcome {
        PrepareOutcome::Prepared(p) => p,
        _ => panic!("Expected PrepareOutcome::Prepared"),
    };

    let key = SessionChangesKey {
        terminal_id: "term-sym".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "sess-sym".into(),
        root_id: ".".into(),
    };

    let act = activate_session_baseline(
        &service,
        &key,
        &ActivationRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            registration_id: "reg-sym".into(),
            omp_session_id: "sess-sym".into(),
            root_id: ".".into(),
            baseline_id: prepared.baseline_id.clone(),
            activation_nonce: prepared.activation_nonce.clone(),
        },
    )
    .unwrap();

    receive_session_receipt(
        &service,
        &key,
        &ReceiptRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            registration_id: "reg-sym".into(),
            omp_session_id: "sess-sym".into(),
            root_id: ".".into(),
            baseline_id: prepared.baseline_id.clone(),
            activation_nonce: prepared.activation_nonce.clone(),
            activation_receipt_id: act.activation_receipt_id,
        },
    )
    .unwrap();

    // Deep path limits
    let mut deep_dir = root.clone();
    for i in 0..MAX_PATH_DEPTH + 5 {
        deep_dir = deep_dir.join(format!("d_{}", i));
    }
    let _ = fs::create_dir_all(&deep_dir);
    let deep_file = deep_dir.join("nested.txt");
    let _ = fs::write(&deep_file, "nested");

    let diff = run_comparison_scan(&service, &key, None).await;
    // Handled safely without panicking
    assert!(diff.is_ok());
}

#[test]
fn test_absence_proof_adversarial_tampering() {
    let mut trie = AbsenceTrie::new();

    trie.record_directory(
        Path::new(""),
        true,
        &[("src".into(), EntryKind::Dir, false)],
    );

    // Record directory without the file -> absent
    trie.record_directory(
        Path::new("src"),
        true,
        &[("other.ts".into(), EntryKind::File, false)],
    );
    let res = trie.prove_path(Path::new("src/missing.ts"));
    assert_eq!(res.presence, Presence::Absent);
    assert_eq!(res.provenance, Provenance::AbsentInVerifiedDirectory);

    // Truncated directory -> remains unknown, cannot certify absence
    let mut trunc_trie = AbsenceTrie::new();
    trunc_trie.record_directory(
        Path::new(""),
        true,
        &[("src".into(), EntryKind::Dir, false)],
    );
    trunc_trie.record_directory(
        Path::new("src"),
        false, // complete = false (truncated)
        &[("other.ts".into(), EntryKind::File, false)],
    );
    let res_trunc = trunc_trie.prove_path(Path::new("src/missing.ts"));
    assert_eq!(
        res_trunc.presence,
        Presence::Unknown,
        "Truncated proof cannot certify absence"
    );
}
