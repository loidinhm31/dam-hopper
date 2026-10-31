use super::capture::*;
use super::store::{SessionChangesKey, SessionChangesService};
use super::types::*;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

fn setup_test_repo() -> (tempfile::TempDir, std::path::PathBuf) {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();

    // Create .git marker
    fs::create_dir_all(root.join(".git")).unwrap();

    // Create tracked and untracked files
    fs::write(root.join("hello.txt"), "hello world\n").unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn add() {}\n").unwrap();

    (tmp, root)
}

#[tokio::test]
async fn test_prepare_activate_receipt_lifecycle() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new().unwrap());

    let req = PrepareRequest {
        version: 1,
        registration_id: "reg-1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    };

    let outcome = prepare_session_capture(
        &service,
        "term-1".into(),
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

    assert_eq!(prepared.baseline_coverage.state, CoverageState::Complete);
    assert_eq!(prepared.baseline_coverage.captured_entries, 2);

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    // Before activation, state is initializing and acknowledgment is pending
    let status_init = service.build_status(&key);
    assert_eq!(status_init.state, StatusState::Initializing);
    assert_eq!(status_init.acknowledgment, Acknowledgment::Pending);
    status_init.validate_invariants().unwrap();

    // Activate
    let act_req = ActivationRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        registration_id: "reg-1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        baseline_id: prepared.baseline_id.clone(),
        activation_nonce: prepared.activation_nonce.clone(),
    };
    let act_receipt = activate_session_baseline(&service, &key, &act_req).unwrap();
    assert!(act_receipt.activated);

    // State is still initializing until live receipt received
    let status_after_act = service.build_status(&key);
    assert_eq!(status_after_act.state, StatusState::Initializing);
    assert_eq!(status_after_act.acknowledgment, Acknowledgment::Pending);

    // Receive receipt
    let rcpt_req = ReceiptRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        registration_id: "reg-1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        baseline_id: prepared.baseline_id.clone(),
        activation_nonce: prepared.activation_nonce.clone(),
        activation_receipt_id: act_receipt.activation_receipt_id,
    };
    let rcpt_res = receive_session_receipt(&service, &key, &rcpt_req).unwrap();
    assert!(rcpt_res.accepted);

    // Now state is ready and acknowledgment is received!
    let status_ready = service.build_status(&key);
    assert_eq!(status_ready.state, StatusState::Ready);
    assert_eq!(status_ready.acknowledgment, Acknowledgment::Received);
    status_ready.validate_invariants().unwrap();
}

#[tokio::test]
async fn test_fail_capture_latches_original_unavailable() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new().unwrap());

    let req = PrepareRequest {
        version: 1,
        registration_id: "reg-1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    };

    prepare_session_capture(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        req,
    )
    .await
    .unwrap();

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    let fail_req = FailureRequest {
        version: 1,
        omp_session_id: "session-1".into(),
        registration_id: "reg-1".into(),
        server_epoch: Some(service.server_epoch.clone()),
        baseline_id: None,
        reason: FailureReason::CaptureFailed,
    };

    fail_session_capture(&service, &key, &fail_req).unwrap();

    let status_failed = service.build_status(&key);
    assert_eq!(status_failed.state, StatusState::Unavailable);
    assert_eq!(status_failed.acknowledgment, Acknowledgment::Pending);
    status_failed.validate_invariants().unwrap();

    // Subsequent prepare for original attempt is refused
    let req2 = PrepareRequest {
        version: 1,
        registration_id: "reg-2".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    };
    let err = prepare_session_capture(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        req2,
    )
    .await;

    assert_eq!(err.unwrap_err(), ErrorCode::OriginalUnavailable);
}
