use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
    fs::{mutate, FsSubsystem},
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    workspace_target::{FileIdentity, FilesystemTargetRef, ProjectTargetRef, ResolvedFilesystemTarget},
};
use opaque_ke::ServerSetup;
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::Value;
use tower::ServiceExt;

#[path = "common/mod.rs"]
mod common;

static ENV_LOCK: Mutex<()> = Mutex::new(());
const TOKEN_CAPACITY: usize = 512;

struct TestContext {
    app_state: AppState,
    _temp_dir: tempfile::TempDir,
    root_path: PathBuf,
    project_dir: PathBuf,
}

fn setup_test_app() -> (TestContext, axum::Router) {
    let temp_dir = tempfile::tempdir().unwrap();
    let root_path = dunce::canonicalize(temp_dir.path()).unwrap();
    let project_dir = root_path.join("test-proj");
    fs::create_dir_all(&project_dir).unwrap();

    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config_path = root_path.join("config.toml");
    let toml_content = format!(
        r#"[workspace]
name = "test-workspace"
root = "{}"

[server]
session_changes_enabled = false

[[projects]]
name = "test-proj"
path = "test-proj"
type = "custom"
"#,
        root_path.display()
    );
    fs::write(&config_path, toml_content).unwrap();

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
        ui: None,
        workspaces: None,
        config_path: config_path.clone(),
    };

    let global_config = GlobalConfig::default();
    let store_path = root_path.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-jwt-key".to_string();
    let fs = FsSubsystem::new_with_workspace(
        vec![("test-proj".into(), project_dir.clone())],
        Some(root_path.clone()),
    );

    let _guard = ENV_LOCK.lock();
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
        true, // no_auth for testing
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
    )
    .expect("Failed to create AppState in test");

    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }

    let router = build_router(app_state.clone());
    (
        TestContext {
            app_state,
            _temp_dir: temp_dir,
            root_path,
            project_dir,
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
            "Failed to parse body as JSON: {}",
            String::from_utf8_lossy(&body_bytes)
        )
    })
}

// ─────────────────────────────────────────────────────────────
// 1. REST /api/fs Target Discrimination & Rejections
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_rest_fs_target_discrimination_and_rejections() {
    let (ctx, app) = setup_test_app();
    fs::write(ctx.root_path.join("ws_file.txt"), "workspace root content").unwrap();
    fs::write(ctx.project_dir.join("proj_file.txt"), "project content").unwrap();

    // 1. targetType=workspace succeeds
    let req = Request::builder()
        .uri("/api/fs/list?targetType=workspace&path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    let entries = json["entries"].as_array().expect("entries array");
    assert!(entries.iter().any(|e| e["name"] == "ws_file.txt"));

    // 2. targetType=project succeeds
    let req = Request::builder()
        .uri("/api/fs/list?targetType=project&project=test-proj&path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    let entries = json["entries"].as_array().expect("entries array");
    assert!(entries.iter().any(|e| e["name"] == "proj_file.txt"));

    // 3. Conflicting targets: targetType=workspace carrying project field is rejected (400 INVALID_FS_TARGET)
    let req = Request::builder()
        .uri("/api/fs/list?targetType=workspace&project=test-proj&path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "INVALID_FS_TARGET");

    // 4. Incomplete target: targetType=project missing project param is rejected (400 INVALID_FS_TARGET)
    let req = Request::builder()
        .uri("/api/fs/list?targetType=project&path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "INVALID_FS_TARGET");

    // 5. Missing target: neither targetType nor project provided is rejected (never falls back to workspace)
    let req = Request::builder()
        .uri("/api/fs/list?path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "INVALID_FS_TARGET");

    // 6. Unknown targetType is rejected (400 INVALID_FS_TARGET)
    let req = Request::builder()
        .uri("/api/fs/list?targetType=foo&path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "INVALID_FS_TARGET");

    // 7. Backward compatibility: legacy caller passing project without targetType works
    let req = Request::builder()
        .uri("/api/fs/list?project=test-proj&path=")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

// ─────────────────────────────────────────────────────────────
// 2. Canonical FileIdentity Producer in Read & Stat
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_rest_fs_read_and_stat_file_identity() {
    let (ctx, app) = setup_test_app();
    let file_path = ctx.root_path.join("identity_test.txt");
    fs::write(&file_path, "canonical identity verification bytes").unwrap();

    // 1. GET /api/fs/stat returns fileIdentity in json
    let req = Request::builder()
        .uri("/api/fs/stat?targetType=workspace&path=identity_test.txt")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    let identity = &json["fileIdentity"];
    assert_eq!(identity["workspaceId"], "test-workspace");
    let expected_epoch = identity["workspaceEpoch"].as_u64().unwrap();
    assert!(expected_epoch > 0);
    let canonical = identity["canonicalPath"].as_str().unwrap();
    assert!(canonical.ends_with("identity_test.txt"));

    // 2. GET /api/fs/read returns x-file-identity header
    let req = Request::builder()
        .uri("/api/fs/read?targetType=workspace&path=identity_test.txt")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let identity_header = res.headers().get("x-file-identity").expect("x-file-identity header");
    let parsed_identity: FileIdentity = serde_json::from_str(identity_header.to_str().unwrap()).unwrap();
    assert_eq!(parsed_identity.workspace_id, "test-workspace");
    assert_eq!(parsed_identity.workspace_epoch, expected_epoch);
    assert_eq!(parsed_identity.canonical_path, canonical);
}

// ─────────────────────────────────────────────────────────────
// 3. Search & Search Paths Direct Workspace Traversal
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_search_scope_authorization_and_traversal() {
    let (ctx, app) = setup_test_app();
    fs::write(ctx.root_path.join("ws_search.txt"), "needle in workspace root").unwrap();
    fs::write(ctx.project_dir.join("proj_search.txt"), "needle in project root").unwrap();

    // 1. targetType=workspace directly searches workspace root
    let req = Request::builder()
        .uri("/api/fs/search?targetType=workspace&q=needle")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    let matches = json["matches"].as_array().unwrap();
    assert!(matches.iter().any(|m| m["path"].as_str().unwrap().contains("ws_search.txt")));

    // 2. Project target with scope=workspace is refused (cannot elevate authority)
    let req = Request::builder()
        .uri("/api/fs/search?targetType=project&project=test-proj&q=needle&scope=workspace")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let json = json_response(res).await;
    assert_eq!(json["code"], "INVALID_FS_TARGET");

    // 3. Search paths for workspace target
    let req = Request::builder()
        .uri("/api/fs/search-paths?targetType=workspace&q=ws_search")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    let matches = json["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 1);
}

// ─────────────────────────────────────────────────────────────
// 4. Root Protection in FS Mutations
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_root_protection_in_mutations() {
    let (ctx, _app) = setup_test_app();
    let ws_root = ctx.root_path.clone();
    let proj_root = ctx.project_dir.clone();
    let protected = vec![proj_root.clone()];

    // 1. Cannot mutate workspace root
    let err = mutate::assert_safe_mutation_against_roots(&ws_root, Some(&ws_root), &protected, false);
    assert!(err.is_err());

    // 2. Cannot mutate marked project root
    let err = mutate::assert_safe_mutation_against_roots(&proj_root, Some(&ws_root), &protected, false);
    assert!(err.is_err());

    // 3. Cannot mutate containing ancestor of project root
    // Suppose /workspace/nested/app is a project root; mutating /workspace/nested must be refused.
    let nested_dir = ws_root.join("nested");
    let nested_proj = nested_dir.join("app");
    fs::create_dir_all(&nested_proj).unwrap();
    let protected_nested = vec![nested_proj.clone()];
    let err = mutate::assert_safe_mutation_against_roots(&nested_dir, Some(&ws_root), &protected_nested, false);
    assert!(err.is_err(), "mutating containing ancestor of project root must be refused");

    // 4. Ordinary file beneath root is allowed
    let regular_file = ws_root.join("regular.txt");
    let ok = mutate::assert_safe_mutation_against_roots(&regular_file, Some(&ws_root), &protected, false);
    assert!(ok.is_ok());

    // 5. .git write without force_git is refused
    let git_file = ws_root.join(".git").join("config");
    let err = mutate::assert_safe_mutation_against_roots(&git_file, Some(&ws_root), &protected, false);
    assert!(err.is_err());
    let ok_force = mutate::assert_safe_mutation_against_roots(&git_file, Some(&ws_root), &protected, true);
    assert!(ok_force.is_ok());
}

// ─────────────────────────────────────────────────────────────
// 5. Project Mark / Unmark Endpoints
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_project_mark_and_unmark_lifecycle() {
    let (ctx, app) = setup_test_app();
    let subfolder = ctx.root_path.join("services").join("api");
    fs::create_dir_all(&subfolder).unwrap();

    // 1. POST /api/config/projects marks subfolder as new project
    let body = serde_json::json!({
        "name": "services-api",
        "target": { "type": "workspace" },
        "path": "services/api",
        "projectType": "custom",
        "tags": ["backend"]
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/config/projects")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let json = json_response(res).await;
    assert_eq!(status, StatusCode::OK, "res json: {:?}", json);
    assert_eq!(json["ok"], true);
    assert_eq!(json["name"], "services-api");

    // Verify project appears in config and TOML
    let toml_disk = fs::read_to_string(ctx.root_path.join("config.toml")).unwrap();
    assert!(toml_disk.contains("services-api"));

    // 2. Reject duplicate project name (409 Conflict)
    let dup_req = Request::builder()
        .method("POST")
        .uri("/api/config/projects")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(dup_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let json = json_response(res).await;
    assert_eq!(json["code"], "DUPLICATE_PROJECT_NAME");

    // 3. Reject duplicate canonical root with different name (409 Conflict)
    let dup_root_body = serde_json::json!({
        "name": "alias-api",
        "target": { "type": "workspace" },
        "path": "services/api",
    });
    let dup_root_req = Request::builder()
        .method("POST")
        .uri("/api/config/projects")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&dup_root_body).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(dup_root_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let json = json_response(res).await;
    assert_eq!(json["code"], "DUPLICATE_PROJECT_ROOT");

    // 4. Distinct nested roots are allowed
    let nested_sub = subfolder.join("nested");
    fs::create_dir_all(&nested_sub).unwrap();
    let nested_body = serde_json::json!({
        "name": "nested-api",
        "target": { "type": "workspace" },
        "path": "services/api/nested",
    });
    let nested_req = Request::builder()
        .method("POST")
        .uri("/api/config/projects")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&nested_body).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(nested_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 5. DELETE /api/config/projects/:name unmarks the project
    let del_req = Request::builder()
        .method("DELETE")
        .uri("/api/config/projects/services-api")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Verify project removed from TOML
    let toml_disk_after = fs::read_to_string(ctx.root_path.join("config.toml")).unwrap();
    assert!(!toml_disk_after.contains("services-api"));
    // Disk files are untouched
    assert!(subfolder.exists(), "unmark must not delete disk files");

    // 6. Unmark unknown project returns 404 UNKNOWN_PROJECT
    let del_unknown = Request::builder()
        .method("DELETE")
        .uri("/api/config/projects/nonexistent")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(del_unknown).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let json = json_response(res).await;
    assert_eq!(json["code"], "UNKNOWN_PROJECT");
}
#[tokio::test]
async fn test_project_mark_without_initial_projects_array() {
    let (ctx, app) = setup_test_app();
    // Rewrite config.toml on disk so it has NO projects section at all
    let toml_clean = format!(
        r#"[workspace]
name = "test-workspace"
root = "{}"

[server]
session_changes_enabled = false
"#,
        ctx.root_path.display()
    );
    fs::write(ctx.root_path.join("config.toml"), toml_clean).unwrap();
    // Verify DELETE on missing project returns UNKNOWN_PROJECT (404)
    let req_unmark = Request::builder()
        .method("DELETE")
        .uri("/api/config/projects/missing-proj")
        .body(Body::empty())
        .unwrap();
    let res_unmark = app.clone().oneshot(req_unmark).await.unwrap();
    assert_eq!(res_unmark.status(), StatusCode::NOT_FOUND);
    let json_unmark = json_response(res_unmark).await;
    assert_eq!(json_unmark["code"], "UNKNOWN_PROJECT");

    // Verify PATCH on missing project returns UNKNOWN_PROJECT (404)
    let req_patch = Request::builder()
        .method("PATCH")
        .uri("/api/config/projects/missing-proj")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&serde_json::json!({"tags": ["test"]})).unwrap()))
        .unwrap();
    let res_patch = app.clone().oneshot(req_patch).await.unwrap();
    assert_eq!(res_patch.status(), StatusCode::NOT_FOUND);
    let json_patch = json_response(res_patch).await;
    assert_eq!(json_patch["code"], "UNKNOWN_PROJECT");


    let sub = ctx.root_path.join("fresh-folder");
    fs::create_dir_all(&sub).unwrap();

    let body = serde_json::json!({
        "name": "fresh-folder-proj",
        "target": { "type": "workspace" },
        "path": "fresh-folder",
        "projectType": "custom",
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/config/projects")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    assert_eq!(json["ok"], true);
    assert_eq!(json["name"], "fresh-folder-proj");

    let disk_content = fs::read_to_string(ctx.root_path.join("config.toml")).unwrap();
    assert!(disk_content.contains("fresh-folder-proj"));
}

// ─────────────────────────────────────────────────────────────
// 6. Folder Terminal Launch Validation
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_folder_terminal_launch_validation() {
    let (ctx, app) = setup_test_app();
    let subfolder = ctx.root_path.join("terminal_folder");
    fs::create_dir_all(&subfolder).unwrap();

    // 1. Workspace target without cwd is rejected
    let no_cwd = serde_json::json!({
        "id": "term-1",
        "command": "bash",
        "target": { "type": "workspace" },
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/terminal")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&no_cwd).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 2. Workspace target with mixed project field is rejected
    let mixed = serde_json::json!({
        "id": "term-2",
        "command": "bash",
        "target": { "type": "workspace" },
        "project": "test-proj",
        "cwd": "terminal_folder",
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/terminal")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&mixed).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Workspace target with cwd outside root fails closed without HOME fallback
    let escaped = serde_json::json!({
        "id": "term-3",
        "command": "bash",
        "target": { "type": "workspace" },
        "cwd": "/etc",
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/terminal")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&escaped).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ─────────────────────────────────────────────────────────────
// 7. Git Direct API Gating (UNKNOWN_PROJECT)
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_git_direct_api_gating() {
    let (_ctx, app) = setup_test_app();

    // 1. Direct Git request for unknown project returns 404 UNKNOWN_PROJECT
    let req = Request::builder()
        .uri("/api/git/unknown-project/worktrees")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let json = json_response(res).await;
    assert_eq!(json["code"], "UNKNOWN_PROJECT");

    // 2. Direct Git roots request for unknown project returns 404 UNKNOWN_PROJECT
    let req = Request::builder()
        .uri("/api/git/unknown-project/roots")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let json = json_response(res).await;
    assert_eq!(json["code"], "UNKNOWN_PROJECT");

    // 3. Direct Git diff request for unknown project returns 404 UNKNOWN_PROJECT
    let req = Request::builder()
        .uri("/api/git/unknown-project/diff")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let json = json_response(res).await;
    assert_eq!(json["code"], "UNKNOWN_PROJECT");

    // 4. Git fetch with workspace target is rejected with UNKNOWN_PROJECT
    let ws_git = serde_json::json!({
        "target": { "type": "workspace" }
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/git/fetch")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&ws_git).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let json = json_response(res).await;
    assert_eq!(json["code"], "UNKNOWN_PROJECT");

    // 5. Git push with workspace target is rejected with UNKNOWN_PROJECT
    let req = Request::builder()
        .method("POST")
        .uri("/api/git/push")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&ws_git).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let json = json_response(res).await;
    assert_eq!(json["code"], "UNKNOWN_PROJECT");
}
