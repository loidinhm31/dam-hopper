use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::router::build_router,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, ServerConfig,
        WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;

mod common;

fn git(args: &[&str], cwd: &Path) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {args:?} failed in {}: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output(args: &[&str], cwd: &Path) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {args:?} failed in {}: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git output not utf-8")
        .trim()
        .to_string()
}

struct TestApp {
    router: axum::Router,
    _temp_dir: TempDir,
    project_path: std::path::PathBuf,
    remote_bare_path: std::path::PathBuf,
}

fn setup_test_app() -> TestApp {
    let temp_dir = tempfile::tempdir().unwrap();
    let root_path = temp_dir.path().to_path_buf();
    // 1. Bare remote
    let remote_bare = root_path.join("remote.git");
    std::fs::create_dir_all(&remote_bare).unwrap();
    git(&["init", "--bare", "-b", "main"], &remote_bare);

    // 2. Local repo clone
    let project_dir = root_path.join("test-repo");
    git(
        &["clone", remote_bare.to_str().unwrap(), project_dir.to_str().unwrap()],
        &root_path,
    );
    git(&["config", "user.email", "test@example.com"], &project_dir);
    git(&["config", "user.name", "Test User"], &project_dir);

    // Initial commit and push
    std::fs::write(project_dir.join("README.md"), "hello\n").unwrap();
    git(&["add", "README.md"], &project_dir);
    git(&["commit", "-m", "initial commit"], &project_dir);
    git(&["push", "-u", "origin", "main"], &project_dir);

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: root_path.display().to_string(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![ProjectConfig {
            name: "test-repo".into(),
            path: project_dir.display().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 5,
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
        true, // no-auth
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("Failed to create AppState");

    let router = build_router(app_state);

    TestApp {
        router,
        _temp_dir: temp_dir,
        project_path: project_dir,
        remote_bare_path: remote_bare,
    }
}

#[tokio::test]
async fn test_api_legacy_force_push_rejected() {
    let app = setup_test_app();

    // Passing legacy "force": true must be rejected by deny_unknown_fields
    let body = json!({
        "project": "test-repo",
        "force": true
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/push")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    // axum serde rejection returns 422 Unprocessable Entity
    assert!(
        res.status() == StatusCode::UNPROCESSABLE_ENTITY || res.status() == StatusCode::BAD_REQUEST,
        "expected 422 or 400 for legacy force push, got {}",
        res.status()
    );
}

#[tokio::test]
async fn test_api_leased_push_prepare_and_publish_flow() {
    let app = setup_test_app();

    // Create a new local commit
    std::fs::write(app.project_path.join("new_file.txt"), "content\n").unwrap();
    git(&["add", "new_file.txt"], &app.project_path);
    git(&["commit", "-m", "local commit for push"], &app.project_path);
    let local_head = git_output(&["rev-parse", "HEAD"], &app.project_path);
    let remote_head_before = git_output(&["rev-parse", "refs/heads/main"], &app.remote_bare_path);
    assert_ne!(local_head, remote_head_before);

    // 1. POST /api/git/test-repo/push/prepare
    let prep_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/prepare")
        .header("Content-Type", "application/json")
        .body(Body::from(b"{}" as &[u8]))
        .unwrap();

    let prep_res = app.router.clone().oneshot(prep_req).await.unwrap();
    assert_eq!(prep_res.status(), StatusCode::OK);

    let prep_bytes = axum::body::to_bytes(prep_res.into_body(), usize::MAX).await.unwrap();
    let prep_json: Value = serde_json::from_slice(&prep_bytes).unwrap();
    assert_eq!(prep_json["status"], "ready");
    assert_eq!(prep_json["alreadyCurrent"], false);

    let snapshot = &prep_json["snapshot"];
    assert_eq!(snapshot["branch"], "refs/heads/main");
    assert_eq!(snapshot["sourceOid"], local_head);
    assert_eq!(snapshot["expectedRemoteOid"], remote_head_before);

    // 2. POST /api/git/test-repo/push/publish
    let pub_body = json!({
        "snapshot": snapshot
    });

    let pub_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/publish")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&pub_body).unwrap()))
        .unwrap();

    let pub_res = app.router.clone().oneshot(pub_req).await.unwrap();
    assert_eq!(pub_res.status(), StatusCode::OK);

    let pub_bytes = axum::body::to_bytes(pub_res.into_body(), usize::MAX).await.unwrap();
    let pub_json: Value = serde_json::from_slice(&pub_bytes).unwrap();
    assert_eq!(pub_json["status"], "published");

    // Independent oracle check: remote bare repo must have moved to local_head
    let remote_head_after = git_output(&["rev-parse", "refs/heads/main"], &app.remote_bare_path);
    assert_eq!(remote_head_after, local_head);
}

#[tokio::test]
async fn test_api_leased_push_already_current() {
    let app = setup_test_app();
    let current_head = git_output(&["rev-parse", "HEAD"], &app.project_path);

    // Prepare when local and remote are identical
    let prep_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/prepare")
        .header("Content-Type", "application/json")
        .body(Body::from(b"{}" as &[u8]))
        .unwrap();

    let prep_res = app.router.clone().oneshot(prep_req).await.unwrap();
    let prep_bytes = axum::body::to_bytes(prep_res.into_body(), usize::MAX).await.unwrap();
    let prep_json: Value = serde_json::from_slice(&prep_bytes).unwrap();

    assert_eq!(prep_json["status"], "ready");
    assert_eq!(prep_json["alreadyCurrent"], true);

    // Publishing already-current snapshot returns already-current status
    let pub_body = json!({
        "snapshot": prep_json["snapshot"]
    });

    let pub_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/publish")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&pub_body).unwrap()))
        .unwrap();

    let pub_res = app.router.clone().oneshot(pub_req).await.unwrap();
    let pub_bytes = axum::body::to_bytes(pub_res.into_body(), usize::MAX).await.unwrap();
    let pub_json: Value = serde_json::from_slice(&pub_bytes).unwrap();
    assert_eq!(pub_json["status"], "already-current");

    let remote_head = git_output(&["rev-parse", "refs/heads/main"], &app.remote_bare_path);
    assert_eq!(remote_head, current_head);
}

#[tokio::test]
async fn test_api_leased_push_stale_remote_rejected() {
    let app = setup_test_app();

    // Local commit
    std::fs::write(app.project_path.join("local.txt"), "local\n").unwrap();
    git(&["add", "local.txt"], &app.project_path);
    git(&["commit", "-m", "local commit"], &app.project_path);

    // Prepare snapshot
    let prep_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/prepare")
        .header("Content-Type", "application/json")
        .body(Body::from(b"{}" as &[u8]))
        .unwrap();

    let prep_res = app.router.clone().oneshot(prep_req).await.unwrap();
    let prep_bytes = axum::body::to_bytes(prep_res.into_body(), usize::MAX).await.unwrap();
    let prep_json: Value = serde_json::from_slice(&prep_bytes).unwrap();
    let snapshot = &prep_json["snapshot"];

    // Simulate an independent writer advancing the remote directly
    let other_clone = tempfile::tempdir().unwrap();
    git(
        &["clone", app.remote_bare_path.to_str().unwrap(), other_clone.path().to_str().unwrap()],
        other_clone.path(),
    );
    git(&["config", "user.email", "other@example.com"], other_clone.path());
    git(&["config", "user.name", "Other User"], other_clone.path());
    std::fs::write(other_clone.path().join("other.txt"), "other\n").unwrap();
    git(&["add", "other.txt"], other_clone.path());
    git(&["commit", "-m", "remote advanced independently"], other_clone.path());
    git(&["push"], other_clone.path());
    let remote_advanced_oid = git_output(&["rev-parse", "refs/heads/main"], &app.remote_bare_path);

    // Publish with the prepared (now stale) snapshot
    let pub_body = json!({
        "snapshot": snapshot
    });

    let pub_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/publish")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&pub_body).unwrap()))
        .unwrap();

    let pub_res = app.router.clone().oneshot(pub_req).await.unwrap();
    let pub_bytes = axum::body::to_bytes(pub_res.into_body(), usize::MAX).await.unwrap();
    let pub_json: Value = serde_json::from_slice(&pub_bytes).unwrap();
    assert_eq!(pub_json["status"], "stale-remote");

    // The remote must still be at remote_advanced_oid (not overwritten)
    let remote_head = git_output(&["rev-parse", "refs/heads/main"], &app.remote_bare_path);
    assert_eq!(remote_head, remote_advanced_oid);
}

#[tokio::test]
async fn test_api_leased_push_stale_local_rejected() {
    let app = setup_test_app();

    // Local commit 1
    std::fs::write(app.project_path.join("local1.txt"), "local1\n").unwrap();
    git(&["add", "local1.txt"], &app.project_path);
    git(&["commit", "-m", "local commit 1"], &app.project_path);

    // Prepare snapshot
    let prep_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/prepare")
        .header("Content-Type", "application/json")
        .body(Body::from(b"{}" as &[u8]))
        .unwrap();

    let prep_res = app.router.clone().oneshot(prep_req).await.unwrap();
    let prep_bytes = axum::body::to_bytes(prep_res.into_body(), usize::MAX).await.unwrap();
    let prep_json: Value = serde_json::from_slice(&prep_bytes).unwrap();
    let snapshot = &prep_json["snapshot"];

    // Local commit 2 advances local tip after prepare
    std::fs::write(app.project_path.join("local2.txt"), "local2\n").unwrap();
    git(&["add", "local2.txt"], &app.project_path);
    git(&["commit", "-m", "local commit 2"], &app.project_path);

    // Publish with the prepared (now stale local) snapshot
    let pub_body = json!({
        "snapshot": snapshot
    });

    let pub_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/push/publish")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&pub_body).unwrap()))
        .unwrap();

    let pub_res = app.router.clone().oneshot(pub_req).await.unwrap();
    let pub_bytes = axum::body::to_bytes(pub_res.into_body(), usize::MAX).await.unwrap();
    let pub_json: Value = serde_json::from_slice(&pub_bytes).unwrap();
    assert_eq!(pub_json["status"], "stale-local");
}
