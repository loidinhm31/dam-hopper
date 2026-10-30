use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use dam_hopper_server::agent_status::runtime::AgentStatusRuntime;
use dam_hopper_server::agent_status::types::AgentStatusAvailability;
use dam_hopper_server::session_changes::control::private_session_changes_router;
use dam_hopper_server::session_changes::store::{BoundTerminalTarget, SessionChangesService};
use dam_hopper_server::session_changes::types::*;
use serde_json::Value;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn test_full_protocol_barrier_and_lifecycle() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::write(root.join("file.txt"), "hello initial\n").unwrap();

    let service = Arc::new(SessionChangesService::new().unwrap());
    let runtime = AgentStatusRuntime::new(
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".into()),
    );
    runtime.set_session_changes(Arc::clone(&service));

    service.bind_terminal_target(
        "term-1",
        1,
        BoundTerminalTarget {
            project_name: Some("test-project".into()),
            worktree_path: None,
            launch_cwd: root.clone(),
        },
    );

    let reservation = runtime.reserve_credential("term-1", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();
    let app = private_session_changes_router(runtime.clone(), Some(Arc::clone(&service)));

    // 1. Prepare request
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

    let req = Request::builder()
        .uri("/prepare")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::from(prep_body))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 16384).await.unwrap();
    let prepared: PreparedReceipt = serde_json::from_slice(&body).unwrap();
    assert_eq!(prepared.kind, "prepared");

    // 2. Activate request
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

    let req = Request::builder()
        .uri("/activate")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::from(act_body))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 16384).await.unwrap();
    let act_receipt: ActivationReceipt = serde_json::from_slice(&body).unwrap();
    assert_eq!(act_receipt.activated, true);

    // 3. Receipt confirmation request
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

    let req = Request::builder()
        .uri("/receipt")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::from(rcpt_body))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 4. Lookup request
    let lookup_body = serde_json::to_vec(&LookupRequest {
        version: 1,
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        known_server_epoch: None,
        known_baseline_id: None,
    })
    .unwrap();

    let req = Request::builder()
        .uri("/lookup")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::from(lookup_body))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 16384).await.unwrap();
    let val: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val["kind"], "active");
    assert_eq!(val["status"]["state"], "ready");
    assert_eq!(val["status"]["acknowledgment"], "received");

    // 5. Settled request
    let settled_body = serde_json::to_vec(&SettledRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        baseline_id: prepared.baseline_id.clone(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        origin: Origin::SessionStart,
        turn_id: "turn-1".into(),
        outcome: SettledOutcome::Completed,
    })
    .unwrap();

    let req = Request::builder()
        .uri("/settled")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::from(settled_body.clone()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 16384).await.unwrap();
    let settled_res: SettledResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(settled_res.duplicate, false);

    // 6. Settled duplicate request
    let req_dup = Request::builder()
        .uri("/settled")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::from(settled_body))
        .unwrap();

    let resp_dup = app.clone().oneshot(req_dup).await.unwrap();
    assert_eq!(resp_dup.status(), StatusCode::OK);
    let body_dup = axum::body::to_bytes(resp_dup.into_body(), 16384).await.unwrap();
    let settled_dup: SettledResponse = serde_json::from_slice(&body_dup).unwrap();
    assert_eq!(settled_dup.duplicate, true);
}
