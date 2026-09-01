use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::router::build_router,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
        WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    persistence::SessionStore,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    workflow::store::WorkflowStore,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tempfile::NamedTempFile;
use tower::ServiceExt;

mod common;

static ENV_LOCK: Mutex<()> = Mutex::new(());
const TOKEN_CAPACITY: usize = 512;

struct TestContext {
    _app_state: AppState,
    _temp_db: NamedTempFile,
    _temp_dir: tempfile::TempDir,
}

fn setup_test_app(no_auth: bool) -> (TestContext, axum::Router) {
    let temp_dir = tempfile::tempdir().unwrap();
    let root_path = temp_dir.path().to_path_buf();
    let project_dir = root_path.join("test-proj");
    std::fs::create_dir_all(&project_dir).unwrap();

    let temp_db = NamedTempFile::new().unwrap();
    let session_store = SessionStore::open(temp_db.path()).unwrap();
    let workflow_store = WorkflowStore::new(session_store.connection());

    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: root_path.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "test-proj".into(),
            path: project_dir.display().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 0,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: root_path.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = root_path.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-jwt-key".to_string();
    let fs = FsSubsystem::new(vec![]);

    let _guard = ENV_LOCK.lock().unwrap();
    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(root_path.join("diagnostics.jsonl"));
    let app_state = AppState::new(
        root_path.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None,
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("Failed to create AppState in test")
    .with_workflow_store(Some(workflow_store));

    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }

    let router = build_router(app_state.clone());
    (
        TestContext {
            _app_state: app_state,
            _temp_db: temp_db,
            _temp_dir: temp_dir,
        },
        router,
    )
}

async fn json_response(response: axum::response::Response) -> Value {
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body_bytes).unwrap_or_else(|_| {
        panic!(
            "Failed to parse JSON response: {}",
            String::from_utf8_lossy(&body_bytes)
        )
    })
}

#[tokio::test]
async fn test_workflow_auth_enforcement() {
    let (_ctx, router) = setup_test_app(false); // Normal auth required

    let req = Request::builder()
        .uri("/api/workflow/overview")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = router.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_workflow_overview_empty() {
    let (_ctx, router) = setup_test_app(true);

    let req = Request::builder()
        .uri("/api/workflow/overview")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = router.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    assert_eq!(json["workspace"]["name"], "test-workspace");
    assert!(json["plans"].as_array().unwrap().is_empty());
    assert!(json["standaloneTasks"].as_array().unwrap().is_empty());
    assert!(json["runningSessions"].as_array().unwrap().is_empty());
    assert!(json["recentEvents"].as_array().unwrap().is_empty());
    assert_eq!(json["truncated"], false);
}

#[tokio::test]
async fn test_workflow_item_hierarchy_and_plan_first() {
    let (_ctx, router) = setup_test_app(true);

    let plan_req_id = uuid::Uuid::new_v4().to_string();
    let phase_req_id = uuid::Uuid::new_v4().to_string();
    let task_req_id = uuid::Uuid::new_v4().to_string();
    let standalone_req_id = uuid::Uuid::new_v4().to_string();

    // 1. Create a Plan (valid: parent_id = None)
    let plan_body = json!({
        "requestId": plan_req_id,
        "target": { "project": "test-proj" },
        "kind": "plan",
        "title": "Main Project Plan",
        "summary": "High level plan",
        "status": "in_progress"
    });

    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&plan_body).unwrap()))
        .unwrap();

    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let plan_res = json_response(res).await;
    let plan_id = plan_res["resource"]["id"].as_str().unwrap().to_string();
    assert_eq!(plan_res["replayed"], false);
    assert_eq!(plan_res["resource"]["kind"], "plan");
    assert_eq!(plan_res["resource"]["title"], "Main Project Plan");

    // 2. Create a Phase under Plan (valid: parent_id = plan_id)
    let phase_body = json!({
        "requestId": phase_req_id,
        "target": { "project": "test-proj" },
        "parentId": plan_id,
        "kind": "phase",
        "title": "Phase 01: Setup",
        "status": "in_progress"
    });

    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&phase_body).unwrap()))
        .unwrap();

    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let phase_res = json_response(res).await;
    let phase_id = phase_res["resource"]["id"].as_str().unwrap().to_string();

    // 3. Create a Task under Phase (valid)
    let task_body = json!({
        "requestId": task_req_id,
        "target": { "project": "test-proj" },
        "parentId": phase_id,
        "kind": "task",
        "title": "Task 1.1: Init DB",
        "status": "backlog"
    });

    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&task_body).unwrap()))
        .unwrap();

    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 4. Create a Standalone Task (valid: parent_id = None)
    let standalone_body = json!({
        "requestId": standalone_req_id,
        "target": { "project": "test-proj" },
        "kind": "task",
        "title": "Quick Standalone Bugfix",
        "status": "backlog"
    });

    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&standalone_body).unwrap()))
        .unwrap();

    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 5. Invalid: Phase without parent -> 400
    let invalid_phase = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "target": { "project": "test-proj" },
        "kind": "phase",
        "title": "Orphan Phase"
    });
    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&invalid_phase).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 6. Invalid: Plan with parent -> 400
    let invalid_plan = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "target": { "project": "test-proj" },
        "parentId": plan_id,
        "kind": "plan",
        "title": "Nested Plan"
    });
    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&invalid_plan).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 7. Verify Overview returns nested hierarchy
    let req = Request::builder()
        .uri("/api/workflow/overview")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let overview_json = json_response(res).await;

    let plans = overview_json["plans"].as_array().unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0]["item"]["title"], "Main Project Plan");
    let phases = plans[0]["children"].as_array().unwrap();
    assert_eq!(phases.len(), 1);
    assert_eq!(phases[0]["item"]["title"], "Phase 01: Setup");
    let tasks = phases[0]["children"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["item"]["title"], "Task 1.1: Init DB");

    let standalone = overview_json["standaloneTasks"].as_array().unwrap();
    assert_eq!(standalone.len(), 1);
    assert_eq!(standalone[0]["item"]["title"], "Quick Standalone Bugfix");
}

#[tokio::test]
async fn test_item_replay_and_cas_concurrency() {
    let (_ctx, router) = setup_test_app(true);

    let req_id = uuid::Uuid::new_v4().to_string();
    let item_body = json!({
        "requestId": req_id,
        "target": { "project": "test-proj" },
        "kind": "plan",
        "title": "Idempotent Plan",
        "status": "backlog"
    });

    // 1. Initial create
    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&item_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res1 = json_response(res).await;
    assert_eq!(res1["replayed"], false);
    let item_id = res1["resource"]["id"].as_str().unwrap().to_string();
    let initial_updated_at = res1["resource"]["updatedAt"].as_str().unwrap().to_string();

    // 2. Replay same request_id -> returns replayed: true and same resource
    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&item_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res2 = json_response(res).await;
    assert_eq!(res2["replayed"], true);
    assert_eq!(res2["resource"]["id"], item_id);

    // 3. Patch item with wrong updated_at -> 409 Conflict
    let patch_stale = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "updatedAt": "2020-01-01T00:00:00.000Z",
        "title": "Updated Title",
        "status": "in_progress"
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/items/{item_id}"))
        .method("PATCH")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&patch_stale).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);

    // 4. Patch item with valid updated_at -> Success
    let patch_req_id = uuid::Uuid::new_v4().to_string();
    let patch_valid = json!({
        "requestId": patch_req_id,
        "updatedAt": initial_updated_at,
        "title": "Updated Title",
        "status": "in_progress"
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/items/{item_id}"))
        .method("PATCH")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&patch_valid).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let patched_res = json_response(res).await;
    assert_eq!(patched_res["replayed"], false);
    assert_eq!(patched_res["resource"]["title"], "Updated Title");
    assert_eq!(patched_res["resource"]["status"], "in_progress");
    let patched_updated_at = patched_res["resource"]["updatedAt"].as_str().unwrap().to_string();

    // 5. Delete item with CAS -> Success
    let delete_req_id = uuid::Uuid::new_v4().to_string();
    let delete_body = json!({
        "requestId": delete_req_id,
        "updatedAt": patched_updated_at
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/items/{item_id}"))
        .method("DELETE")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&delete_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let delete_res = json_response(res).await;
    assert_eq!(delete_res["replayed"], false);
    assert_eq!(delete_res["resource"]["resourceType"], "item");
    assert_eq!(delete_res["resource"]["id"], item_id);

    // 6. Delete replay
    let req = Request::builder()
        .uri(format!("/api/workflow/items/{item_id}"))
        .method("DELETE")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&delete_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let delete_replay_res = json_response(res).await;
    assert_eq!(delete_replay_res["replayed"], true);
}

#[tokio::test]
async fn test_session_lifecycle_and_notes() {
    let (_ctx, router) = setup_test_app(true);

    // 1. Start a session
    let start_req_id = uuid::Uuid::new_v4().to_string();
    let session_body = json!({
        "requestId": start_req_id,
        "target": { "project": "test-proj" },
        "startedAt": "2026-09-02T10:00:00.000Z"
    });

    let req = Request::builder()
        .uri("/api/workflow/sessions")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&session_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let session_res = json_response(res).await;
    let session_id = session_res["resource"]["id"].as_str().unwrap().to_string();
    assert_eq!(session_res["resource"]["status"], "running");

    // 2. Link agent resource
    let link_req_id = uuid::Uuid::new_v4().to_string();
    let link_body = json!({
        "requestId": link_req_id,
        "resourceType": "agent",
        "externalId": "agent-runner-1",
        "harnessLabel": "harness-v1",
        "runId": "run-xyz-999"
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/sessions/{session_id}/links"))
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&link_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let link_res = json_response(res).await;
    assert_eq!(link_res["resource"]["externalId"], "agent-runner-1");
    assert_eq!(link_res["resource"]["harnessLabel"], "harness-v1");

    // 3. Add note to session
    let note_req_id = uuid::Uuid::new_v4().to_string();
    let note_body = json!({
        "requestId": note_req_id,
        "sessionId": session_id,
        "body": "Debugging performance regression"
    });
    let req = Request::builder()
        .uri("/api/workflow/notes")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&note_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let note_res = json_response(res).await;
    let note_id = note_res["resource"]["id"].as_str().unwrap().to_string();
    let note_updated_at = note_res["resource"]["updatedAt"].as_str().unwrap().to_string();

    // 4. Delete note with CAS
    let delete_note_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "updatedAt": note_updated_at
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/notes/{note_id}"))
        .method("DELETE")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&delete_note_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 5. End session with invalid end time (< startedAt) -> 400
    let invalid_end_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "endedAt": "2026-09-02T09:00:00.000Z"
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/sessions/{session_id}/end"))
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&invalid_end_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 6. End session with valid end time -> 200 OK
    let end_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "endedAt": "2026-09-02T11:00:00.000Z"
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/sessions/{session_id}/end"))
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&end_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let ended_res = json_response(res).await;
    assert_eq!(ended_res["resource"]["status"], "ended");
    assert_eq!(ended_res["resource"]["endedAt"], "2026-09-02T11:00:00.000Z");
}

#[tokio::test]
async fn test_events_pagination_and_history_purge() {
    let (_ctx, router) = setup_test_app(true);

    // Create 3 items to generate 3 events
    for i in 1..=3 {
        let item_body = json!({
            "requestId": uuid::Uuid::new_v4().to_string(),
            "target": { "project": "test-proj" },
            "kind": "task",
            "title": format!("Event Test Task {i}")
        });
        let req = Request::builder()
            .uri("/api/workflow/items")
            .method("POST")
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_vec(&item_body).unwrap()))
            .unwrap();
        let res = router.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    // Query events with limit = 2
    let req = Request::builder()
        .uri("/api/workflow/events?limit=2")
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let events_res = json_response(res).await;
    assert_eq!(events_res["events"].as_array().unwrap().len(), 2);
    assert!(events_res["nextCursor"].is_string());

    let next_cursor = events_res["nextCursor"].as_str().unwrap();

    // Query next page with cursor
    let req = Request::builder()
        .uri(format!("/api/workflow/events?cursor={next_cursor}&limit=2"))
        .method("GET")
        .body(Body::empty())
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let page2_res = json_response(res).await;
    assert_eq!(page2_res["events"].as_array().unwrap().len(), 1);

    // Purge history with before in future -> purges all 3 events
    let future_time = "2099-01-01T00:00:00.000Z";
    let req = Request::builder()
        .uri(format!("/api/workflow/history?before={future_time}"))
        .method("DELETE")
        .body(Body::empty())
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let purge_res = json_response(res).await;
    assert_eq!(purge_res["eventsDeleted"].as_u64().unwrap(), 3);
}

#[tokio::test]
async fn test_session_abandon_and_invalid_transition() {
    let (_ctx, router) = setup_test_app(true);

    let session_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "target": { "project": "test-proj" },
        "startedAt": "2026-09-02T10:00:00.000Z"
    });
    let req = Request::builder()
        .uri("/api/workflow/sessions")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&session_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let session_id = json_response(res).await["resource"]["id"].as_str().unwrap().to_string();

    // Abandon session
    let abandon_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string()
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/sessions/{session_id}/abandon"))
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&abandon_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let abandon_res = json_response(res).await;
    assert_eq!(abandon_res["resource"]["status"], "abandoned");

    // Trying to end an already abandoned session -> 409 Invalid Transition
    let end_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "endedAt": "2026-09-02T12:00:00.000Z"
    });
    let req = Request::builder()
        .uri(format!("/api/workflow/sessions/{session_id}/end"))
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&end_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_validation_limits_and_unknown_project() {
    let (_ctx, router) = setup_test_app(true);

    // 1. Unknown project -> 404 Not Found
    let unknown_proj_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "target": { "project": "non-existent-project" },
        "kind": "plan",
        "title": "Valid Title"
    });
    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&unknown_proj_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 2. Overlong title (> 200 chars) -> 400 Bad Request
    let long_title_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "target": { "project": "test-proj" },
        "kind": "plan",
        "title": "a".repeat(201)
    });
    let req = Request::builder()
        .uri("/api/workflow/items")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&long_title_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Overlong note body (> 8192 bytes) -> 400 Bad Request
    let long_note_body = json!({
        "requestId": uuid::Uuid::new_v4().to_string(),
        "itemId": uuid::Uuid::new_v4().to_string(),
        "body": "a".repeat(8193)
    });
    let req = Request::builder()
        .uri("/api/workflow/notes")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&long_note_body).unwrap()))
        .unwrap();
    let res = router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}
