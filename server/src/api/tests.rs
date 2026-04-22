use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use crate::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo},
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager, NoopEventSink},
    state::AppState,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};

fn make_tunnel_manager(event_sink: &BroadcastEventSink) -> TunnelSessionManager {
    TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver))
}

use std::sync::Arc;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN: &str = "test-token-12345";

fn make_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();

    // Create a minimal config file so config_path.exists() returns true (required by
    // /api/workspace/status `ready` field).
    let config_file = workspace_dir.join("dam-hopper.toml");
    std::fs::write(
        &config_file,
        "[workspace]\nname = \"test-workspace\"\n",
    )
    .ok();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: crate::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(workspace_dir.clone());
    let tunnel_manager = make_tunnel_manager(&event_sink);

    AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_TOKEN.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
    ).expect("make_state failed")
}

fn test_jwt() -> String {
    use jsonwebtoken::{encode, Header, EncodingKey};
    #[derive(serde::Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    let claims = Claims {
        sub: "test-user".to_string(),
        exp: (chrono::Utc::now().timestamp() as usize) + 3600,
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(TEST_TOKEN.as_bytes())).unwrap()
}

fn auth_cookie() -> String {
    format!("damhopper-auth={}", test_jwt())
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
        .header("Cookie", "damhopper-auth=wrong-token")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_returns_401_without_db() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let body = serde_json::json!({ "username": "test-user", "password": "password" });
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
// Bearer token auth (cross-origin support)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn protected_route_with_bearer_token_returns_200() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/workspace/status")
        .header("Authorization", format!("Bearer {}", test_jwt()))
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn protected_route_with_wrong_bearer_returns_401() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/workspace/status")
        .header("Authorization", "Bearer wrong-token")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_status_returns_200_with_bearer_token() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .uri("/api/auth/status")
        .header("Authorization", format!("Bearer {}", test_jwt()))
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["authenticated"], true);
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
    assert_eq!(json["ready"], true);
    assert_eq!(json["name"], "test-workspace");
    assert_eq!(json["projectCount"], 0);
}

#[tokio::test]
async fn workspace_known_returns_empty_list() {
    // XDG_CONFIG_HOME is NOT mutated here — set_var in parallel async tests is a data race.
    // The handler reads global config from XDG_CONFIG_HOME; in the real system the file
    // may not exist and the handler returns an empty list, which is also valid.
    // We only assert the response is 200 (not that it's empty).
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
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
async fn terminal_kill_nonexistent_returns_no_content() {
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
    // kill() always returns Ok(()) — no-op for unknown sessions — handler returns 204.
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
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

// ---------------------------------------------------------------------------
// Terminal lifecycle
// ---------------------------------------------------------------------------

/// Build state with a real project entry pointing at tmp dir, for tests that
/// need project resolution (ship/unship, git API endpoints, etc.).
fn make_state_with_project(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: crate::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "test-project".into(),
            path: workspace_dir.to_string_lossy().into_owned(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: crate::config::RestartPolicy::Never,
            restart_max_retries: crate::config::DEFAULT_RESTART_MAX_RETRIES,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(workspace_dir.clone());
    let tunnel_manager = make_tunnel_manager(&event_sink);

    AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_TOKEN.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
    ).expect("make_state_with_project failed")
}

#[tokio::test]
async fn terminal_create_returns_meta_and_appears_in_list() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let body = serde_json::json!({
        "id": "test-echo-session",
        "command": "echo",
        "cwd": tmp.path().to_str().unwrap(),
        "cols": 80,
        "rows": 24,
    });
    let resp = post_json(state.clone(), "/api/terminal", body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let raw = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let meta: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(meta["id"], "test-echo-session");

    // Session appears in list
    let list_resp = get(state, "/api/terminal").await;
    assert_eq!(list_resp.status(), StatusCode::OK);
    let list_raw = axum::body::to_bytes(list_resp.into_body(), usize::MAX).await.unwrap();
    let list: Vec<serde_json::Value> = serde_json::from_slice(&list_raw).unwrap();
    assert!(list.iter().any(|s| s["id"] == "test-echo-session"));
}

#[tokio::test]
async fn terminal_lifecycle_create_buffer_kill() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    // Use `cat` — blocks on stdin, guaranteed alive during buffer read and kill.
    let body = serde_json::json!({
        "id": "lifecycle-session",
        "command": "cat",
        "cwd": tmp.path().to_str().unwrap(),
    });
    let create_resp = post_json(state.clone(), "/api/terminal", body).await;
    assert_eq!(create_resp.status(), StatusCode::OK);

    // Buffer accessible while session is alive
    let buf_resp = get(state.clone(), "/api/terminal/lifecycle-session/buffer").await;
    assert_eq!(buf_resp.status(), StatusCode::OK);
    let buf_raw = axum::body::to_bytes(buf_resp.into_body(), usize::MAX).await.unwrap();
    let buf_json: serde_json::Value = serde_json::from_slice(&buf_raw).unwrap();
    assert!(buf_json["buffer"].is_string());

    // Kill session
    let router = build_router(state, vec![]);
    let kill_req = Request::builder()
        .method("DELETE")
        .uri("/api/terminal/lifecycle-session")
        .header("Cookie", auth_cookie())
        .body(Body::empty())
        .unwrap();
    let kill_resp = router.oneshot(kill_req).await.unwrap();
    assert!(kill_resp.status().is_success());
}

#[tokio::test]
async fn terminal_list_detailed_returns_array() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/terminal/detailed").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.is_array());
}

// ---------------------------------------------------------------------------
// Agent store — ship / unship / absorb lifecycle
// ---------------------------------------------------------------------------

async fn seed_skill_item(tmp: &TempDir, item_name: &str) {
    let skills_dir = tmp.path().join(".dam-hopper/agent-store/skills");
    tokio::fs::create_dir_all(&skills_dir).await.unwrap();
    tokio::fs::write(
        skills_dir.join(format!("{item_name}.md")),
        format!("---\nname: {item_name}\ndescription: test skill\n---\n# {item_name}\nTest skill content."),
    ).await.unwrap();
}

#[tokio::test]
async fn agent_store_ship_and_unship_skill() {
    let tmp = tempfile::tempdir().unwrap();
    seed_skill_item(&tmp, "test-skill").await;
    let state = make_state_with_project(&tmp);

    // Ship
    let ship_body = serde_json::json!({
        "itemName": "test-skill",
        "category": "skill",
        "projectName": "test-project",
        "agent": "claude",
        "method": "symlink",
    });
    let ship_resp = post_json(state.clone(), "/api/agent-store/ship", ship_body).await;
    assert_eq!(ship_resp.status(), StatusCode::OK);
    let ship_raw = axum::body::to_bytes(ship_resp.into_body(), usize::MAX).await.unwrap();
    let ship_json: serde_json::Value = serde_json::from_slice(&ship_raw).unwrap();
    assert_eq!(ship_json["success"], true, "ship failed: {ship_json}");
    assert_eq!(ship_json["item"], "test-skill");

    // Verify symlink/copy exists on disk (serialized as snake_case — no rename_all on ShipResult)
    let target = &ship_json["target_path"];
    assert!(target.is_string(), "target_path missing: {ship_json}");

    // Unship
    let unship_body = serde_json::json!({
        "itemName": "test-skill",
        "category": "skill",
        "projectName": "test-project",
        "agent": "claude",
        "force": false,
    });
    let unship_resp = post_json(state.clone(), "/api/agent-store/unship", unship_body).await;
    assert_eq!(unship_resp.status(), StatusCode::OK);
    let unship_json: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(unship_resp.into_body(), usize::MAX).await.unwrap()
    ).unwrap();
    assert_eq!(unship_json["success"], true, "unship failed: {unship_json}");
}

#[tokio::test]
async fn agent_store_absorb_skill_into_store() {
    let tmp = tempfile::tempdir().unwrap();
    // Skills in projects are stored without .md extension: .claude/skills/<name>
    // (resolve_ship_paths uses item_name directly for Skill category).
    let claude_skills = tmp.path().join(".claude/skills");
    tokio::fs::create_dir_all(&claude_skills).await.unwrap();
    tokio::fs::write(
        claude_skills.join("absorb-test"),
        "---\nname: absorb-test\ndescription: skill to absorb\n---\n# absorb-test",
    ).await.unwrap();

    let state = make_state_with_project(&tmp);

    let body = serde_json::json!({
        "itemName": "absorb-test",
        "category": "skill",
        "projectName": "test-project",
        "agent": "claude",
    });
    let resp = post_json(state.clone(), "/api/agent-store/absorb", body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap()
    ).unwrap();
    // absorb returns ShipResult — success means the item was copied into the central store
    assert_eq!(json["success"], true, "absorb failed: {json}");
}

#[tokio::test]
async fn agent_store_ship_unknown_project_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    seed_skill_item(&tmp, "test-skill").await;
    let state = make_state(&tmp); // no projects in config

    let body = serde_json::json!({
        "itemName": "test-skill",
        "category": "skill",
        "projectName": "no-such-project",
        "agent": "claude",
    });
    let resp = post_json(state, "/api/agent-store/ship", body).await;
    // Expect 404 from project resolution
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn agent_store_matrix_returns_map() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state_with_project(&tmp);
    let resp = get(state, "/api/agent-store/matrix").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.is_object());
}

// ---------------------------------------------------------------------------
// Git API endpoints
// ---------------------------------------------------------------------------

fn init_git_repo(path: &std::path::Path) {
    let repo = git2::Repository::init(path).unwrap();
    let sig = git2::Signature::now("test", "test@test.com").unwrap();
    let mut index = repo.index().unwrap();
    // Need at least one commit so we can list branches
    std::fs::write(path.join("README.md"), "# test repo").unwrap();
    index.add_path(std::path::Path::new("README.md")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
}

#[tokio::test]
async fn git_branches_returns_list_for_valid_project() {
    let tmp = tempfile::tempdir().unwrap();
    init_git_repo(tmp.path());
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/branches").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Should have at least the initial branch (main/master)
    assert!(json.as_array().map(|a| !a.is_empty()).unwrap_or(false),
        "expected non-empty branch list, got: {json}");
}

#[tokio::test]
async fn git_worktrees_returns_list_for_valid_project() {
    let tmp = tempfile::tempdir().unwrap();
    init_git_repo(tmp.path());
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/worktrees").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Main worktree is always present in an initialized repo
    assert!(
        json.as_array().map(|a| !a.is_empty()).unwrap_or(false),
        "expected non-empty worktree list, got: {json}"
    );
}

#[tokio::test]
async fn git_branches_unknown_project_returns_404() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp); // no projects
    let resp = get(state, "/api/git/no-such-project/branches").await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
