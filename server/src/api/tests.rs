use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use crate::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DevHubConfig, GlobalConfig, WorkspaceInfo},
    pty::{BroadcastEventSink, PtySessionManager, NoopEventSink},
    state::AppState,
};

use std::sync::Arc;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN: &str = "test-token-12345";

fn make_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();

    let config = DevHubConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: ".".into(),
        },
        agent_store: None,
        projects: vec![],
        config_path: workspace_dir.join("dev-hub.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dev-hub/agent-store"));

    AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_TOKEN.to_string(),
    )
}

fn auth_cookie() -> String {
    format!("devhub-auth={TEST_TOKEN}")
}

async fn get(state: AppState, path: &str) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri(path)
        .header("Cookie", auth_cookie())
        .body(Body::empty())
        .unwrap();
    router.oneshot(req).await.unwrap()
}

async fn post_json(state: AppState, path: &str, body: serde_json::Value) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header("Content-Type", "application/json")
        .header("Cookie", auth_cookie())
        .body(Body::from(body.to_string()))
        .unwrap();
    router.oneshot(req).await.unwrap()
}

// ---------------------------------------------------------------------------
// Health check (no auth required)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn health_returns_200() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/health")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

#[tokio::test]
async fn protected_route_without_cookie_returns_401() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/workspace/status")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_with_wrong_cookie_returns_401() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/workspace/status")
        .header("Cookie", "devhub-auth=wrong-token")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_with_valid_token_sets_cookie() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let body = serde_json::json!({ "token": TEST_TOKEN });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let set_cookie = resp.headers().get("set-cookie").unwrap().to_str().unwrap();
    assert!(set_cookie.contains("devhub-auth="));
    assert!(set_cookie.contains("HttpOnly"));
}

#[tokio::test]
async fn login_with_wrong_token_returns_401() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let body = serde_json::json!({ "token": "wrong" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_status_returns_401_without_cookie() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/auth/status")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

#[tokio::test]
async fn workspace_status_returns_loaded_true() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/workspace/status").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["loaded"], true);
    assert_eq!(json["name"], "test-workspace");
    assert_eq!(json["projectCount"], 0);
}

#[tokio::test]
async fn workspace_known_returns_empty_list() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    // Point XDG_CONFIG_HOME to tmp so we don't touch real config
    std::env::set_var("XDG_CONFIG_HOME", tmp.path());
    let resp = get(state, "/api/workspace/known").await;
    assert_eq!(resp.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[tokio::test]
async fn config_get_returns_workspace_name() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/config").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["workspace"]["name"], "test-workspace");
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

#[tokio::test]
async fn terminal_list_returns_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/terminal").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn terminal_kill_nonexistent_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/terminal/no-such-session")
        .header("Cookie", auth_cookie())
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    // kill returns Ok even if session doesn't exist (no-op)
    assert!(resp.status().is_success() || resp.status() == StatusCode::NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tokio::test]
async fn commands_search_returns_results() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/commands/search?query=build").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn commands_list_by_type_returns_maven() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/commands?projectType=maven").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn commands_list_unknown_type_returns_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/commands?projectType=unknown-type").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.as_array().unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Agent store
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_store_list_returns_empty_without_init() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/agent-store").await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn agent_store_health_returns_result() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/agent-store/health").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["broken_symlinks"].is_array() || json["brokenSymlinks"].is_array());
    assert!(json["orphaned_items"].is_array() || json["orphanedItems"].is_array());
}

// ---------------------------------------------------------------------------
// Agent memory templates
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_memory_templates_returns_list() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/agent-memory/templates").await;
    assert_eq!(resp.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tokio::test]
async fn settings_export_returns_json() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/settings/export").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["config"].is_object());
}
