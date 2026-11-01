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
use tower::ServiceExt;

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

    let service = Arc::new(SessionChangesService::new_enabled().unwrap());
    let runtime = AgentStatusRuntime::new(
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".into()),
    );
    runtime.set_session_changes(Arc::clone(&service));

    let reservation = runtime.reserve_credential("term-1", 1).unwrap();
    let token = reservation.token().to_string();
    reservation.activate();

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

    // 1. Register without token -> 401 Unauthorized
    let reg_body = serde_json::to_vec(&RegisterRequest {
        version: 1,
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
    })
    .unwrap();

    let req_unauth = Request::builder()
        .method("POST")
        .uri("/register")
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(reg_body.clone()))
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. Register with valid token -> 200 OK RegisterResponse
    let req_register = Request::builder()
        .method("POST")
        .uri("/register")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(reg_body))
        .unwrap();

    let resp_register = app.clone().oneshot(req_register).await.unwrap();
    assert_eq!(resp_register.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp_register.into_body(), 16384)
        .await
        .unwrap();
    let registered: RegisterResponse = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(registered.omp_session_id, "sess-1");

    // 3. Capture -> 200 OK CaptureResponse
    let cap_body = serde_json::to_vec(&CaptureRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation: "1".into(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        baseline_id: registered.baseline_id.clone(),
        capture_id: "cap-1".into(),
        paths: vec!["sample.txt".into()],
        mode: CaptureMode::PreEdit,
    })
    .unwrap();

    let req_capture = Request::builder()
        .method("POST")
        .uri("/capture")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(cap_body))
        .unwrap();

    let resp_capture = app.clone().oneshot(req_capture).await.unwrap();
    assert_eq!(resp_capture.status(), StatusCode::OK);
    let cap_bytes = axum::body::to_bytes(resp_capture.into_body(), 16384)
        .await
        .unwrap();
    let cap_res: CaptureResponse = serde_json::from_slice(&cap_bytes).unwrap();
    assert_eq!(cap_res.results.len(), 1);
    assert_eq!(cap_res.results[0].status, PathCaptureStatus::Captured);

    // 4. Lookup -> 200 OK LookupResult::Active
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
            assert_eq!(status.origin, Some(Origin::ToolObserved));
            assert_eq!(status.acknowledgment, Acknowledgment::NotApplicable);
        }
        _ => panic!("Expected LookupResult::Active"),
    }

    // 5. Settled -> 200 OK SettledResponse (first call duplicate: false, second call duplicate: true)
    let settled_body = serde_json::to_vec(&SettledRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation: Some("1".into()),
        baseline_id: registered.baseline_id.clone(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        origin: Some(Origin::ToolObserved),
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
    assert!(!s_res1.duplicate);

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
    assert!(s_res2.duplicate);
}
