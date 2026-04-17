/// Integration tests for no-auth (dev mode) authentication bypass.
///
/// Tests that --no-auth flag successfully bypasses MongoDB authentication
/// and generates dev tokens for local development.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    config::{DamHopperConfig, GlobalConfig, WorkspaceInfo, FeaturesConfig},
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tower::ServiceExt;

// Global lock for tests that modify environment variables (prevents race conditions)
static ENV_LOCK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN_CAPACITY: usize = 512;

/// Create AppState with no_auth enabled (dev mode)
fn create_no_auth_state(workspace_root: PathBuf) -> AppState {
    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
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
    let fs = FsSubsystem::new(workspace_root.clone());
    
    // Acquire lock for env var access
    let _guard = ENV_LOCK.lock().unwrap();
    
    // Temporarily clear production flags for test
    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");
    
    let state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None, // no MongoDB
        true, // no_auth = true
    ).expect("Failed to create no-auth AppState in test");
    
    // Restore environment variables
    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }
    
    state
}

/// Create AppState with normal auth (no_auth = false)
fn create_normal_auth_state(workspace_root: PathBuf) -> AppState {
    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
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
    let fs = FsSubsystem::new(workspace_root.clone());
    
    AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None, // no MongoDB
        false, // no_auth = false
    ).expect("Failed to create normal auth AppState in test")
}

// ---------------------------------------------------------------------------
// No-auth mode tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_no_auth_login_returns_dev_token() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_no_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);

    // POST /api/auth/login with empty body (no credentials needed in dev mode)
    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    
    assert_eq!(response.status(), StatusCode::OK, "Login should succeed in no-auth mode");
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(json["ok"], true, "Response should indicate success");
    assert!(json["token"].is_string(), "Should return a token");
    assert_eq!(json["dev_mode"], true, "Should indicate dev mode is active");
}

#[tokio::test]
async fn test_no_auth_status_shows_dev_mode() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_no_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);

    // GET /api/auth/status without any token
    let request = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    
    assert_eq!(response.status(), StatusCode::OK, "Status should be OK in no-auth mode");
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(json["authenticated"], true, "Should be authenticated in dev mode");
    assert_eq!(json["dev_mode"], true, "Should indicate dev mode");
    assert_eq!(json["user"], "dev-user", "Should show dev-user");
}

#[tokio::test]
async fn test_no_auth_bypasses_middleware() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_no_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);

    // GET /api/workspace without any authorization header
    // This is a protected route that normally requires auth
    let request = Request::builder()
        .method("GET")
        .uri("/api/workspace")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    
    // Should NOT be 401 Unauthorized - should process the request
    // (may be 200 or other status depending on workspace state, but not 401)
    assert_ne!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "Protected routes should be accessible in no-auth mode"
    );
}

// ---------------------------------------------------------------------------
// Normal auth mode tests (regression check)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_normal_auth_requires_credentials() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_normal_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);

    // POST /api/auth/login with empty credentials
    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    
    // Should fail because no MongoDB is configured and credentials are missing
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "Login should fail without valid credentials in normal mode"
    );
}

#[tokio::test]
async fn test_normal_auth_protects_routes() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_normal_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);

    // GET /api/workspace without authorization
    let request = Request::builder()
        .method("GET")
        .uri("/api/workspace")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "Protected routes should require auth in normal mode"
    );
}

#[tokio::test]
async fn test_normal_auth_status_without_token() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_normal_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);

    // GET /api/auth/status without token
    let request = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "Status should be unauthorized without valid token in normal mode"
    );
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(json["authenticated"], false, "Should not be authenticated");
}

// ---------------------------------------------------------------------------
// Production safety guard tests (integration tests)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_no_auth_with_mongodb_fails() {
    // Real integration test: AppState::new() should return Err with MongoDB + no_auth
    let tmp = tempfile::tempdir().unwrap();
    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
    let pty_manager = PtySessionManager::new(std::sync::Arc::new(event_sink.clone()));
    let workspace_root = tmp.path().to_path_buf();
    
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        server: dam_hopper_server::config::ServerConfig::default(),
        agent_store: None,
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    
    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-key".to_string();
    let fs = FsSubsystem::new(workspace_root.clone());
    
    // Create a mock MongoDB database (simulating MONGODB_URI being set)
    let mongodb_client = mongodb::Client::with_uri_str("mongodb://fake").await.unwrap();
    let mock_db = Some(mongodb_client.database("test"));
    
    let result = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        mock_db,
        true, // no_auth = true + MongoDB = ERROR
    );
    
    assert!(result.is_err(), "AppState::new() should fail with no_auth + MongoDB");
    if let Err(e) = result {
        let err_msg = e.to_string();
        assert!(
            err_msg.contains("no-auth cannot be used when MongoDB is configured"),
            "Error message should mention MongoDB conflict. Got: {}", err_msg
        );
    }
}

#[tokio::test]
async fn test_no_auth_in_production_env_fails() {
    // Acquire lock to prevent other tests from interfering with env vars
    let _guard = ENV_LOCK.lock().unwrap();
    
    // Set production environment variable
    std::env::set_var("RUST_ENV", "production");
    
    let tmp = tempfile::tempdir().unwrap();
    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
    let pty_manager = PtySessionManager::new(std::sync::Arc::new(event_sink.clone()));
    let workspace_root = tmp.path().to_path_buf();
    
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        server: dam_hopper_server::config::ServerConfig::default(),
        agent_store: None,
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    
    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-key".to_string();
    let fs = FsSubsystem::new(workspace_root.clone());
    
    let result = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None,
        true, // no_auth = true in production = ERROR
    );
    
    // Clean up environment variable
    std::env::remove_var("RUST_ENV");
    
    assert!(result.is_err(), "AppState::new() should fail with no_auth in production");
    if let Err(e) = result {
        let err_msg = e.to_string();
        assert!(
            err_msg.contains("not allowed in production"),
            "Error message should mention production environment. Got: {}", err_msg
        );
    }
}

// ---------------------------------------------------------------------------
// Response structure validation tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_no_auth_login_response_structure() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_no_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);
    
    // POST /api/auth/login in dev mode
    let login_body = serde_json::json!({
        "username": "any-user",
        "password": "any-password"
    });
    
    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    
    // Validate response structure
    assert!(json.get("ok").is_some(), "Response should have 'ok' field");
    assert_eq!(json["ok"], true, "'ok' should be true");
    
    assert!(json.get("token").is_some(), "Response should have 'token' field");
    assert!(json["token"].is_string(), "'token' should be a string");
    assert!(!json["token"].as_str().unwrap().is_empty(), "'token' should not be empty");
    
    assert!(json.get("dev_mode").is_some(), "Response should have 'dev_mode' field in no-auth mode");
    assert_eq!(json["dev_mode"], true, "'dev_mode' should be true");
}

#[tokio::test]
async fn test_no_auth_status_response_structure() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_no_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);
    
    let request = Request::builder()
        .uri("/api/auth/status")
        .body(Body::empty())
        .unwrap();
    
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    
    // Validate response structure
    assert!(json.get("authenticated").is_some(), "Response should have 'authenticated' field");
    assert_eq!(json["authenticated"], true, "Should be authenticated in dev mode");
    
    assert!(json.get("dev_mode").is_some(), "Response should have 'dev_mode' field");
    assert_eq!(json["dev_mode"], true, "'dev_mode' should be true");
    
    assert!(json.get("user").is_some(), "Response should have 'user' field");
    assert_eq!(json["user"], "dev-user", "'user' should be 'dev-user'");
}

#[tokio::test]
async fn test_normal_auth_login_error_response_structure() {
    let tmp = tempfile::tempdir().unwrap();
    let state = create_normal_auth_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state, vec![]);
    
    // POST /api/auth/login without credentials (should return error response)
    let login_body = serde_json::json!({});
    
    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "Should return 401 for invalid credentials");
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    
    // Validate error response structure
    assert!(json.get("error").is_some(), "Response should have 'error' field");
    
    // In normal mode error response, dev_mode field should not be present
    assert!(json.get("dev_mode").is_none(), "'dev_mode' should not be present in error responses");
}
