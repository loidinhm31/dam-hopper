use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    session_changes::store::BoundTerminalTarget,
    session_changes::types::*,
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;
use tower::ServiceExt;

fn create_test_state(workspace_root: PathBuf, repo_root: PathBuf) -> AppState {
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(std::sync::Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_root.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-key".to_string();
    let fs = FsSubsystem::new(vec![]);

    let opaque_server_setup =
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng);

    let state = AppState::new(
        workspace_root.clone(),
        config,
        global_config,
        pty_manager.clone(),
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None, // no auth store
        true, // no_auth mode for direct API testing
        dam_hopper_server::tunnel::TunnelSessionManager::new(
            Arc::new(dam_hopper_server::pty::BroadcastEventSink::new(512).0),
            Arc::new(dam_hopper_server::tunnel::CloudflaredDriver),
        ),
        None,
        opaque_server_setup,
        DiagnosticStore::new(workspace_root.join("diag.jsonl")),
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();

    // Bind terminal target
    state.session_changes.bind_terminal_target(
        "term-1",
        1,
        BoundTerminalTarget {
            project_name: Some("test-project".into()),
            worktree_path: None,
            launch_cwd: repo_root,
        },
    );

    state
}

#[tokio::test]
async fn test_session_changes_public_api_flow() {
    let tmp = tempdir().unwrap();
    let repo = tmp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::write(repo.join("file1.txt"), "hello\n").unwrap();

    let state = create_test_state(tmp.path().to_path_buf(), repo.clone());
    let app = build_router(state.clone());

    // 1. Initial Status query -> state is missing
    let req_status = Request::builder()
        .method("GET")
        .uri("/api/terminal/term-1/session-changes/v1/status?terminalIncarnation=1&ompSessionId=sess-1")
        .body(Body::empty())
        .unwrap();

    let resp_status = app.clone().oneshot(req_status).await.unwrap();
    assert_eq!(resp_status.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp_status.into_body(), usize::MAX)
        .await
        .unwrap();
    let status: Status = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status.state, StatusState::Missing);

    // 2. Start from-now tracking
    let from_now_body = serde_json::to_vec(&FromNowRequest {
        version: 1,
        terminal_incarnation: "1".into(),
        omp_session_id: "sess-1".into(),
        root_id: ".".into(),
        request_id: "req-from-now".into(),
        expected_server_epoch: None,
    })
    .unwrap();

    let req_from_now = Request::builder()
        .method("POST")
        .uri("/api/terminal/term-1/session-changes/v1/from-now")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(from_now_body))
        .unwrap();

    let resp_from_now = app.clone().oneshot(req_from_now).await.unwrap();
    assert_eq!(resp_from_now.status(), StatusCode::OK);
    let fn_bytes = axum::body::to_bytes(resp_from_now.into_body(), usize::MAX)
        .await
        .unwrap();
    let fn_status: Status = serde_json::from_slice(&fn_bytes).unwrap();
    assert_eq!(fn_status.origin, Some(Origin::FromNow));
    assert_eq!(fn_status.acknowledgment, Acknowledgment::NotApplicable);
    assert_eq!(fn_status.state, StatusState::Ready);
    let baseline_id = fn_status.baseline_id.unwrap();

    // 3. Edit file in repo
    fs::write(repo.join("file1.txt"), "hello\nworld\n").unwrap();

    // 4. Refresh comparison
    let refresh_body = serde_json::to_vec(&RefreshRequest {
        version: 1,
        terminal_incarnation: "1".into(),
        omp_session_id: "sess-1".into(),
        server_epoch: state.session_changes.server_epoch.clone(),
        baseline_id: baseline_id.clone(),
        request_id: "req-ref".into(),
    })
    .unwrap();

    let req_refresh = Request::builder()
        .method("POST")
        .uri("/api/terminal/term-1/session-changes/v1/refresh")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(refresh_body))
        .unwrap();

    let resp_refresh = app.clone().oneshot(req_refresh).await.unwrap();
    assert_eq!(resp_refresh.status(), StatusCode::OK);
    let ref_bytes = axum::body::to_bytes(resp_refresh.into_body(), usize::MAX)
        .await
        .unwrap();
    let comp: Comparison = serde_json::from_slice(&ref_bytes).unwrap();
    assert_eq!(comp.changed_file_count, 1);
    assert_eq!(comp.comparison_revision, "1");

    // 5. Query changed files list
    let req_files = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/terminal/term-1/session-changes/v1/files?terminalIncarnation=1&ompSessionId=sess-1&serverEpoch={}&baselineId={}&comparisonRevision=1",
            state.session_changes.server_epoch, baseline_id
        ))
        .body(Body::empty())
        .unwrap();

    let resp_files = app.clone().oneshot(req_files).await.unwrap();
    assert_eq!(resp_files.status(), StatusCode::OK);
    let files_bytes = axum::body::to_bytes(resp_files.into_body(), usize::MAX)
        .await
        .unwrap();
    let page: FilePage = serde_json::from_slice(&files_bytes).unwrap();
    assert_eq!(page.files.len(), 1);
    let file_id = page.files[0].file_id.clone();
    assert_eq!(page.files[0].path, "file1.txt");

    // 6. Query file detail
    let req_detail = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/terminal/term-1/session-changes/v1/files/{}?terminalIncarnation=1&ompSessionId=sess-1&serverEpoch={}&baselineId={}&comparisonRevision=1",
            file_id, state.session_changes.server_epoch, baseline_id
        ))
        .body(Body::empty())
        .unwrap();

    let resp_detail = app.clone().oneshot(req_detail).await.unwrap();
    assert_eq!(resp_detail.status(), StatusCode::OK);
    let detail_bytes = axum::body::to_bytes(resp_detail.into_body(), usize::MAX)
        .await
        .unwrap();
    let detail: FileDetail = serde_json::from_slice(&detail_bytes).unwrap();
    assert_eq!(detail.original.content.as_deref(), Some("hello\n"));
    assert_eq!(detail.current.content.as_deref(), Some("hello\nworld\n"));

    // 7. Stale revision returns 409 Conflict with RefreshRequired
    let req_stale = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/terminal/term-1/session-changes/v1/files?terminalIncarnation=1&ompSessionId=sess-1&serverEpoch={}&baselineId={}&comparisonRevision=99",
            state.session_changes.server_epoch, baseline_id
        ))
        .body(Body::empty())
        .unwrap();

    let resp_stale = app.clone().oneshot(req_stale).await.unwrap();
    assert_eq!(resp_stale.status(), StatusCode::CONFLICT);
    let stale_bytes = axum::body::to_bytes(resp_stale.into_body(), usize::MAX)
        .await
        .unwrap();
    let stale_err: ErrorBody = serde_json::from_slice(&stale_bytes).unwrap();
    assert_eq!(stale_err.code, ErrorCode::RefreshRequired);

    // 8. Server epoch mismatch returns 410 Gone with ServerRestarted
    let req_epoch_mismatch = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/terminal/term-1/session-changes/v1/files?terminalIncarnation=1&ompSessionId=sess-1&serverEpoch=wrong-epoch&baselineId={}&comparisonRevision=1",
            baseline_id
        ))
        .body(Body::empty())
        .unwrap();

    let resp_epoch_mismatch = app.clone().oneshot(req_epoch_mismatch).await.unwrap();
    assert_eq!(resp_epoch_mismatch.status(), StatusCode::GONE);
    let epoch_bytes = axum::body::to_bytes(resp_epoch_mismatch.into_body(), usize::MAX)
        .await
        .unwrap();
    let epoch_err: ErrorBody = serde_json::from_slice(&epoch_bytes).unwrap();
    assert_eq!(epoch_err.code, ErrorCode::ServerRestarted);
}
