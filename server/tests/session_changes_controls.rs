use axum::http::{header, Request, StatusCode};
use dam_hopper_server::agent_status::runtime::AgentStatusRuntime;
use dam_hopper_server::agent_status::types::AgentStatusAvailability;
use dam_hopper_server::session_changes::control::private_session_changes_router;
use dam_hopper_server::session_changes::store::{BoundTerminalTarget, SessionChangesService};
use dam_hopper_server::session_changes::types::*;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;
use tower::ServiceExt; // for oneshot()

fn setup_test_environment() -> (
    tempfile::TempDir,
    PathBuf,
    Arc<SessionChangesService>,
    AgentStatusRuntime,
    String,
) {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::write(root.join("sample.txt"), "hello world\n").unwrap();

    let service = Arc::new(SessionChangesService::new().unwrap());
    let runtime = AgentStatusRuntime::new(
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".into()),
    );
    runtime.set_session_changes(Arc::clone(&service));

    // Reserve and activate a credential for terminal "term-1", incarnation 1
    let reservation = runtime.reserve_credential("term-1", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();

    // Bind terminal target in session_changes service
    service.bind_terminal_target(
        "term-1",
        1,
        BoundTerminalTarget {
            project_name: Some("test-project".into()),
            worktree_path: None,
            launch_cwd: root.clone(),
        },
    );

    (tmp, root, service, runtime, token)
}

#[tokio::test]
async fn test_private_controls_http_lifecycle() {
    let (_tmp, _root, service, runtime, token) = setup_test_environment();
    let app = private_session_changes_router(runtime.clone(), Some(Arc::clone(&service)));

    // 1. Prepare without token -> 401 Unauthorized
    let prep_body = serde_json::to_vec(&PrepareRequest {
        version: 1,
        registration_id: "reg-1".into(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
        expires_at_ms: 2000000000000,
        mode: PrepareMode::Capture,
        lifecycle: PrepareLifecycle::InitialFresh,
    })
    .unwrap();

    let req_unauth = Request::builder()
        .method("POST")
        .uri("/prepare")
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(prep_body.clone()))
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. Prepare with valid token -> 200 OK PreparedReceipt
    let req_prepare = Request::builder()
        .method("POST")
        .uri("/prepare")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(prep_body))
        .unwrap();

    let resp_prepare = app.clone().oneshot(req_prepare).await.unwrap();
    assert_eq!(resp_prepare.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp_prepare.into_body(), 16384)
        .await
        .unwrap();
    let prepared: PreparedReceipt = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(prepared.kind, "prepared");
    assert_eq!(prepared.baseline_coverage.captured_entries, 1);

    // 3. Activate -> 200 OK ActivationReceipt
    let act_body = serde_json::to_vec(&ActivationRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        registration_id: "reg-1".into(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        baseline_id: prepared.baseline_id.clone(),
        activation_nonce: prepared.activation_nonce.clone(),
    })
    .unwrap();

    let req_activate = Request::builder()
        .method("POST")
        .uri("/activate")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(act_body))
        .unwrap();

    let resp_activate = app.clone().oneshot(req_activate).await.unwrap();
    assert_eq!(resp_activate.status(), StatusCode::OK);
    let act_bytes = axum::body::to_bytes(resp_activate.into_body(), 16384)
        .await
        .unwrap();
    let act_receipt: ActivationReceipt = serde_json::from_slice(&act_bytes).unwrap();
    assert!(act_receipt.activated);

    // 4. Receipt -> 200 OK ReceiptResponse
    let rcpt_body = serde_json::to_vec(&ReceiptRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        registration_id: "reg-1".into(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        baseline_id: prepared.baseline_id.clone(),
        activation_nonce: prepared.activation_nonce.clone(),
        activation_receipt_id: act_receipt.activation_receipt_id,
    })
    .unwrap();

    let req_receipt = Request::builder()
        .method("POST")
        .uri("/receipt")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(rcpt_body))
        .unwrap();

    let resp_receipt = app.clone().oneshot(req_receipt).await.unwrap();
    assert_eq!(resp_receipt.status(), StatusCode::OK);

    // 5. Lookup -> 200 OK LookupResult::Active
    let lookup_body = serde_json::to_vec(&LookupRequest {
        version: 1,
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        known_server_epoch: None,
        known_baseline_id: None,
    })
    .unwrap();

    let req_lookup = Request::builder()
        .method("POST")
        .uri("/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(lookup_body))
        .unwrap();

    let resp_lookup = app.clone().oneshot(req_lookup).await.unwrap();
    assert_eq!(resp_lookup.status(), StatusCode::OK);
    let lookup_bytes = axum::body::to_bytes(resp_lookup.into_body(), 16384)
        .await
        .unwrap();
    let lookup_result: LookupResult = serde_json::from_slice(&lookup_bytes).unwrap();
    match lookup_result {
        LookupResult::Active { status, .. } => {
            assert_eq!(status.state, StatusState::Ready);
            assert_eq!(status.acknowledgment, Acknowledgment::Received);
        }
        _ => panic!("Expected LookupResult::Active"),
    }

    // 6. Settled -> 200 OK SettledResponse (first call duplicate: false, second call duplicate: true)
    let settled_body = serde_json::to_vec(&SettledRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        baseline_id: prepared.baseline_id.clone(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        origin: Origin::SessionStart,
        turn_id: "turn-abc".into(),
        outcome: SettledOutcome::Completed,
    })
    .unwrap();

    let req_settled1 = Request::builder()
        .method("POST")
        .uri("/settled")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(settled_body.clone()))
        .unwrap();

    let resp_settled1 = app.clone().oneshot(req_settled1).await.unwrap();
    assert_eq!(resp_settled1.status(), StatusCode::OK);
    let s_bytes1 = axum::body::to_bytes(resp_settled1.into_body(), 16384)
        .await
        .unwrap();
    let s_res1: SettledResponse = serde_json::from_slice(&s_bytes1).unwrap();
    assert_eq!(s_res1.duplicate, false);

    // Resend same turn ID
    let req_settled2 = Request::builder()
        .method("POST")
        .uri("/settled")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(settled_body))
        .unwrap();

    let resp_settled2 = app.clone().oneshot(req_settled2).await.unwrap();
    assert_eq!(resp_settled2.status(), StatusCode::OK);
    let s_bytes2 = axum::body::to_bytes(resp_settled2.into_body(), 16384)
        .await
        .unwrap();
    let s_res2: SettledResponse = serde_json::from_slice(&s_bytes2).unwrap();
    assert_eq!(s_res2.duplicate, true);
}
