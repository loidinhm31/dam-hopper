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
    git::types::{
        OperationAction, OperationActionRequest, OperationKind, OperationOutcome,
        OperationStatusResponse,
    },
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

mod common;

fn git(args: &[&str], cwd: &Path) {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
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

fn git_try(args: &[&str], cwd: &Path) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn init_git_repo(path: &Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "tester@example.com"], path);
    git(&["config", "user.name", "Tester"], path);
    git(&["config", "commit.gpgsign", "false"], path);
    git(&["config", "core.autocrlf", "false"], path);
}

struct TestApp {
    router: axum::Router,
    _temp_dir: TempDir,
    project_path: std::path::PathBuf,
}

fn setup_test_app() -> TestApp {
    let temp_dir = tempfile::tempdir().unwrap();
    let root_path = temp_dir.path().to_path_buf();
    let project_dir = root_path.join("test-repo");
    std::fs::create_dir_all(&project_dir).unwrap();
    init_git_repo(&project_dir);

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
    }
}

#[tokio::test]
async fn test_get_operation_status_clean_repo() {
    let app = setup_test_app();

    let req = Request::builder()
        .method("GET")
        .uri("/api/git/test-repo/operation")
        .body(Body::empty())
        .unwrap();

    let resp = app.router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: OperationStatusResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(json.operation, OperationKind::None);
    assert!(!json.can_continue);
    assert!(!json.can_abort);
    assert!(json.stopped_reason.is_none());
    assert!(!json.operation_fingerprint.is_empty());
    assert!(!json.full_index_fingerprint.is_empty());
}

#[tokio::test]
async fn test_get_operation_status_during_merge_conflict() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::fs::write(root.join("f.txt"), b"line 1\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "feature"], root);
    std::fs::write(root.join("f.txt"), b"feature\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "feat"], root);

    git(&["checkout", "main"], root);
    std::fs::write(root.join("f.txt"), b"main\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "feature"], root);

    let req = Request::builder()
        .method("GET")
        .uri("/api/git/test-repo/operation")
        .body(Body::empty())
        .unwrap();

    let resp = app.router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: OperationStatusResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(json.operation, OperationKind::Merge);
    assert!(!json.can_continue);
    assert!(json.can_abort);
    assert_eq!(
        json.stopped_reason,
        Some(dam_hopper_server::git::types::OperationStoppedReason::Conflicts)
    );
    let roles = json.stage_role_labels.unwrap();
    assert_eq!(roles.ours, "Current branch (HEAD)");
    assert_eq!(roles.theirs, "Incoming change (MERGE_HEAD)");
}

#[tokio::test]
async fn test_post_operation_legacy_payload_fails_closed() {
    let app = setup_test_app();

    // Legacy or missing precondition payload
    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/operation")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "action": "continue"
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp = app.router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "LEGACY_PAYLOAD_REJECTED");
}

#[tokio::test]
async fn test_post_operation_stale_precondition_rejection() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::fs::write(root.join("f.txt"), b"line 1\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "feature"], root);
    std::fs::write(root.join("f.txt"), b"feature\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "feat"], root);

    git(&["checkout", "main"], root);
    std::fs::write(root.join("f.txt"), b"main\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "feature"], root);

    let req_body = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: "stale_fingerprint_hash".to_string(),
        full_index_fingerprint: "stale_index_hash".to_string(),
        action: OperationAction::Continue,
        abort_confirmed: false,
    };

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/operation")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&req_body).unwrap()))
        .unwrap();

    let resp = app.router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let outcome: OperationOutcome = serde_json::from_slice(&body).unwrap();
    match outcome {
        OperationOutcome::Stale {
            required_refresh, ..
        } => {
            assert!(required_refresh);
        }
        other => panic!("Expected Stale outcome, got {:?}", other),
    }
}

#[tokio::test]
async fn test_post_operation_abort_lifecycle_via_api() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::fs::write(root.join("f.txt"), b"line 1\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "init"], root);

    git(&["checkout", "-b", "feature"], root);
    std::fs::write(root.join("f.txt"), b"feature\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "feat"], root);

    git(&["checkout", "main"], root);
    std::fs::write(root.join("f.txt"), b"main\n").unwrap();
    git(&["add", "f.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "feature"], root);

    // 1. Fetch current status
    let get_req = Request::builder()
        .method("GET")
        .uri("/api/git/test-repo/operation")
        .body(Body::empty())
        .unwrap();

    let get_resp = app.router.clone().oneshot(get_req).await.unwrap();
    let get_body = axum::body::to_bytes(get_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let status: OperationStatusResponse = serde_json::from_slice(&get_body).unwrap();

    // 2. Abort with confirmation
    let abort_body = OperationActionRequest {
        project: None,
        worktree_path: None,
        root: None,
        operation_precondition: status.operation_fingerprint,
        full_index_fingerprint: status.full_index_fingerprint,
        action: OperationAction::Abort,
        abort_confirmed: true,
    };

    let post_req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/operation")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&abort_body).unwrap()))
        .unwrap();

    let post_resp = app.router.clone().oneshot(post_req).await.unwrap();
    assert_eq!(post_resp.status(), StatusCode::OK);

    let post_bytes = axum::body::to_bytes(post_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let outcome: OperationOutcome = serde_json::from_slice(&post_bytes).unwrap();
    match outcome {
        OperationOutcome::Aborted { worktree_cleaned } => {
            assert!(worktree_cleaned);
        }
        other => panic!("Expected Aborted outcome, got {:?}", other),
    }

    // 3. Confirm operation is None now
    let final_req = Request::builder()
        .method("GET")
        .uri("/api/git/test-repo/operation")
        .body(Body::empty())
        .unwrap();

    let final_resp = app.router.oneshot(final_req).await.unwrap();
    let final_bytes = axum::body::to_bytes(final_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let final_status: OperationStatusResponse = serde_json::from_slice(&final_bytes).unwrap();
    assert_eq!(final_status.operation, OperationKind::None);
}
