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

fn init_git_repo(path: &Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "alice@example.com"], path);
    git(&["config", "user.name", "Alice Engineer"], path);
    std::fs::write(
        path.join("app.rs"),
        "fn main() {\n    println!(\"v1\");\n}\n",
    )
    .unwrap();
    git(&["add", "app.rs"], path);
    git(
        &["commit", "-m", "feat: initial commit\n\nFull body explanation.\nSecond paragraph."],
        path,
    );
}

struct TestApp {
    router: axum::Router,
    state: AppState,
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
        true, // no-auth dev mode
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("Failed to create AppState");

    let router = build_router(app_state.clone());

    TestApp {
        router,
        state: app_state,
        _temp_dir: temp_dir,
        project_path: project_dir,
    }
}

#[tokio::test]
async fn test_api_blame_happy_path_with_dirty_buffer() {
    let app = setup_test_app();
    let head_oid = git_output(&["rev-parse", "HEAD"], &app.project_path);
    let disk_content_before = std::fs::read_to_string(app.project_path.join("app.rs")).unwrap();

    let payload = json!({
        "path": "app.rs",
        "content": "fn main() {\n    println!(\"v2 modified\");\n}\n",
        "snapshotId": "snap-http-1",
        "modelVersion": 42
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json_resp["snapshotId"], "snap-http-1");
    assert_eq!(json_resp["modelVersion"], 42);
    assert_eq!(json_resp["rootId"], ".");
    assert_eq!(json_resp["rootRelativePath"], "app.rs");
    assert_eq!(json_resp["baseCommitOid"], head_oid);
    assert_eq!(json_resp["status"], "ready");
    assert_eq!(json_resp["bufferLineCount"], 4);

    let commits = json_resp["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0]["hash"], head_oid);
    assert_eq!(commits[0]["authorName"], "Alice Engineer");
    assert_eq!(commits[0]["subject"], "feat: initial commit");

    let ranges = json_resp["ranges"].as_array().unwrap();
    assert_eq!(ranges.len(), 4);
    // Line 1: committed (index 0)
    assert_eq!(ranges[0]["startLine"], 1);
    assert_eq!(ranges[0]["lineCount"], 1);
    assert_eq!(ranges[0]["commitIndex"], 0);
    // Line 2: uncommitted (null)
    assert_eq!(ranges[1]["startLine"], 2);
    assert_eq!(ranges[1]["lineCount"], 1);
    assert!(ranges[1]["commitIndex"].is_null());
    // Line 3: committed (index 0)
    assert_eq!(ranges[2]["startLine"], 3);
    assert_eq!(ranges[2]["lineCount"], 1);
    assert_eq!(ranges[2]["commitIndex"], 0);
    // Line 4: trailing empty row uncommitted (null)
    assert_eq!(ranges[3]["startLine"], 4);
    assert_eq!(ranges[3]["lineCount"], 1);
    assert!(ranges[3]["commitIndex"].is_null());

    // Invariant: disk, index, HEAD must remain strictly unchanged!
    let disk_content_after = std::fs::read_to_string(app.project_path.join("app.rs")).unwrap();
    assert_eq!(disk_content_before, disk_content_after);
    let head_oid_after = git_output(&["rev-parse", "HEAD"], &app.project_path);
    assert_eq!(head_oid, head_oid_after);
}

#[tokio::test]
async fn test_api_blame_crlf_normalization() {
    let app = setup_test_app();
    let head_oid = git_output(&["rev-parse", "HEAD"], &app.project_path);

    let payload = json!({
        "path": "app.rs",
        "content": "fn main() {\r\n    println!(\"v1\");\r\n}\r\n",
        "snapshotId": "snap-crlf",
        "modelVersion": 1
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json_resp["status"], "ready");
    assert_eq!(json_resp["bufferLineCount"], 4);
    let ranges = json_resp["ranges"].as_array().unwrap();
    assert_eq!(json_resp["commits"][0]["hash"], head_oid);
    // Lines 1-3 committed to head_oid
    assert_eq!(ranges[0]["startLine"], 1);
    assert_eq!(ranges[0]["lineCount"], 3);
    assert_eq!(ranges[0]["commitIndex"], 0);
    // Line 4 trailing empty display row
    assert_eq!(ranges[1]["startLine"], 4);
    assert!(ranges[1]["commitIndex"].is_null());
}

#[tokio::test]
async fn test_api_blame_empty_buffer_short_circuit() {
    let app = setup_test_app();

    let payload = json!({
        "path": "app.rs",
        "content": "",
        "snapshotId": "snap-empty",
        "modelVersion": 2
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json_resp["status"], "empty");
    assert_eq!(json_resp["bufferLineCount"], 1);
    assert!(json_resp["ranges"].as_array().unwrap().is_empty());
    assert!(json_resp["commits"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn test_api_commit_details_happy_path() {
    let app = setup_test_app();
    let head_oid = git_output(&["rev-parse", "HEAD"], &app.project_path);

    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/git/test-repo/commit/{head_oid}/details"))
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json_resp["hash"], head_oid);
    assert_eq!(json_resp["authorName"], "Alice Engineer");
    assert_eq!(json_resp["subject"], "feat: initial commit");
    assert!(json_resp["fullMessage"]
        .as_str()
        .unwrap()
        .contains("Full body explanation."));
    assert!(json_resp["authorTimestamp"].as_i64().unwrap() > 0);
}

#[tokio::test]
async fn test_api_commit_details_not_found() {
    let app = setup_test_app();
    let non_existent = "0123456789abcdef0123456789abcdef01234567";

    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/git/test-repo/commit/{non_existent}/details"))
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_resp["code"], "GIT_COMMIT_NOT_FOUND");
}

#[tokio::test]
async fn test_api_blame_path_traversal_rejected() {
    let app = setup_test_app();

    let payload = json!({
        "path": "../etc/passwd",
        "content": "test",
        "snapshotId": "snap",
        "modelVersion": 1
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_resp["code"], "GIT_BLAME_INVALID_INPUT");
}

#[tokio::test]
async fn test_api_blame_binary_rejected() {
    let app = setup_test_app();

    let payload = json!({
        "path": "app.rs",
        "content": "hello\u{0000}world",
        "snapshotId": "snap",
        "modelVersion": 1
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_resp["code"], "GIT_BLAME_UNSUPPORTED_FILE");
}

#[tokio::test]
async fn test_api_blame_concurrency_busy_status() {
    let app = setup_test_app();

    // Acquire both permits from the shared semaphore
    let _permit1 = app.state.git_blame_semaphore.clone().try_acquire_owned().unwrap();
    let _permit2 = app.state.git_blame_semaphore.clone().try_acquire_owned().unwrap();

    // Both permits occupied: 3rd request must receive 503 GIT_BLAME_BUSY immediately!
    let payload = json!({
        "path": "app.rs",
        "content": "fn main() {}\n",
        "snapshotId": "snap-busy",
        "modelVersion": 1
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_resp["code"], "GIT_BLAME_BUSY");
}

#[tokio::test]
async fn test_api_blame_body_limit_allows_over_10mb_payload() {
    let app = setup_test_app();

    // Create a 12 MB JSON payload (which exceeds the global 10 MB limit).
    // The route-local limit is 32 MB, so the HTTP layer accepts the body!
    // The decoded content is > 5 MB, so it fails at the domain limit with 413 GIT_BLAME_TOO_LARGE,
    // NOT axum's generic body limit rejection.
    let large_string = "a".repeat(11 * 1024 * 1024);
    let payload = json!({
        "path": "app.rs",
        "content": large_string,
        "snapshotId": "snap-large",
        "modelVersion": 1
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/git/test-repo/blame")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_resp: Value = serde_json::from_slice(&body_bytes).unwrap();
    // Confirms domain-level typed 413 GIT_BLAME_TOO_LARGE was returned because the 32MB layer accepted the HTTP body!
    assert_eq!(json_resp["code"], "GIT_BLAME_TOO_LARGE");
}
