use super::capture::*;
use super::comparison::*;
use super::store::{SessionChangesKey, SessionChangesService};
use super::types::*;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

fn setup_repo_for_comparison() -> (tempfile::TempDir, std::path::PathBuf) {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();

    // Create .git marker
    fs::create_dir_all(root.join(".git")).unwrap();

    // Initial files
    fs::write(root.join("hello.txt"), "hello\nworld\n").unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn test() {}\n").unwrap();

    (tmp, root)
}

#[tokio::test]
async fn test_comparison_flow_modified_added_deleted() {
    let (_tmp, root) = setup_repo_for_comparison();
    let service = Arc::new(SessionChangesService::new().unwrap());

    let prep_req = PrepareRequest {
        version: 1,
        registration_id: "reg-1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    };

    let outcome = prepare_session_capture(&service, "term-1".into(), "1".into(), &root, prep_req)
        .await
        .unwrap();

    let prepared = match outcome {
        PrepareOutcome::Prepared(p) => p,
        _ => panic!("Expected Prepared"),
    };

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    // Activate & receive receipt
    let act_receipt = activate_session_baseline(
        &service,
        &key,
        &ActivationRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            registration_id: "reg-1".into(),
            omp_session_id: "session-1".into(),
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
            registration_id: "reg-1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: prepared.baseline_id.clone(),
            activation_nonce: prepared.activation_nonce.clone(),
            activation_receipt_id: act_receipt.activation_receipt_id,
        },
    )
    .unwrap();

    // Now edit files in repo:
    // 1. Modify hello.txt: add a line
    fs::write(root.join("hello.txt"), "hello\nbeautiful\nworld\n").unwrap();
    // 2. Add new file: src/new.rs (certified absence under src)
    fs::write(root.join("src/new.rs"), "fn new_func() {}\n").unwrap();
    // 3. Delete src/lib.rs
    fs::remove_file(root.join("src/lib.rs")).unwrap();

    // Run comparison scan
    let comp = run_comparison_scan(&service, &key, Some("turn-1".into()))
        .await
        .unwrap();

    assert_eq!(comp.changed_file_count, 3);
    assert_eq!(comp.comparison_revision, "1");
    assert!(comp.counts_complete);

    // List changed files
    let page = list_changed_files(&service, &key, "1", None, None).unwrap();
    assert_eq!(page.files.len(), 3);

    let hello_row = page.files.iter().find(|f| f.path == "hello.txt").unwrap();
    assert_eq!(hello_row.change, FileChangeKind::Modified);
    assert_eq!(hello_row.additions, Some(1));
    assert_eq!(hello_row.deletions, Some(0));

    let new_row = page.files.iter().find(|f| f.path == "src/new.rs").unwrap();
    assert_eq!(new_row.change, FileChangeKind::Added);
    assert_eq!(new_row.original_presence, Presence::Absent);
    assert_eq!(new_row.original_provenance, Provenance::AbsentInVerifiedDirectory);
    assert_eq!(new_row.additions, Some(1));

    let del_row = page.files.iter().find(|f| f.path == "src/lib.rs").unwrap();
    assert_eq!(del_row.change, FileChangeKind::Deleted);
    assert_eq!(del_row.current_presence, Presence::Absent);

    // Get detail of hello.txt
    let detail = get_file_detail(&service, &key, "1", &hello_row.file_id).unwrap();
    assert_eq!(detail.original.content.as_deref(), Some("hello\nworld\n"));
    assert_eq!(
        detail.current.content.as_deref(),
        Some("hello\nbeautiful\nworld\n")
    );
    assert!(detail.renderable);

    // Refresh required error on stale revision
    let stale_err = list_changed_files(&service, &key, "999", None, None);
    assert_eq!(stale_err.unwrap_err(), ErrorCode::RefreshRequired);
}
