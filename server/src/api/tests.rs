use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use crate::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::{now_ms, DiagnosticEvent, DiagnosticStore},
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
    telemetry::{
        load_or_create_hmac_key, normalize_command,
        worker::{TelemetryControl, TelemetryHandle},
        CaptureQuality, CommandEvent, CommandEventId, CommandOutcome, ShellKind, TelemetryCmd,
        TelemetryKeyRing, TelemetryStore, TerminalRunEvent, TerminalRunId,
        TELEMETRY_SCHEMA_VERSION,
    },
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};

use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

fn test_opaque_setup() -> ServerSetup<DamHopperOpaqueSuite> {
    ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng)
}

fn make_tunnel_manager(event_sink: &BroadcastEventSink) -> TunnelSessionManager {
    TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver))
}

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN: &str = "test-token-12345";

fn make_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();

    // Create a minimal config file so config_path.exists() returns true (required by
    // /api/workspace/status `ready` field).
    let config_file = workspace_dir.join("dam-hopper.toml");
    std::fs::write(&config_file, "[workspace]\nname = \"test-workspace\"\n").ok();

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
    let fs = FsSubsystem::new(vec![]);
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
        None,
        test_opaque_setup(),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
        crate::telemetry::TelemetryRuntime::with_paths(
            tmp.path().join("telemetry-key"),
            tmp.path().join("collector-token"),
        ),
    )
    .expect("make_state failed")
    .with_codex_exporter(
        crate::telemetry::codex_otlp::CodexExporterManager::with_paths(
            tmp.path().join(".codex/config.toml"),
            tmp.path().join("collector-token"),
        ),
    )
}

fn test_jwt() -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    #[derive(serde::Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    let claims = Claims {
        sub: "test-user".to_string(),
        exp: (chrono::Utc::now().timestamp() as usize) + 3600,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_TOKEN.as_bytes()),
    )
    .unwrap()
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

async fn get_without_auth(state: AppState, path: &str) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder().uri(path).body(Body::empty()).unwrap();
    router.oneshot(req).await.unwrap()
}

async fn post_json(
    state: AppState,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
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

async fn put_json(
    state: AppState,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .method("PUT")
        .uri(path)
        .header("Content-Type", "application/json")
        .header("Cookie", auth_cookie())
        .body(Body::from(body.to_string()))
        .unwrap();
    router.oneshot(req).await.unwrap()
}

async fn patch_json(
    state: AppState,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .method("PATCH")
        .uri(path)
        .header("Content-Type", "application/json")
        .header("Cookie", auth_cookie())
        .body(Body::from(body.to_string()))
        .unwrap();
    router.oneshot(req).await.unwrap()
}

async fn post_json_without_auth(
    state: AppState,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    router.oneshot(req).await.unwrap()
}

async fn delete_json(
    state: AppState,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let router = build_router(state, vec![]);
    let req = Request::builder()
        .method("DELETE")
        .uri(path)
        .header("Content-Type", "application/json")
        .header("Cookie", auth_cookie())
        .body(Body::from(body.to_string()))
        .unwrap();
    router.oneshot(req).await.unwrap()
}

fn wait_for(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if predicate() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

fn git(args: &[&str], cwd: &Path) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
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
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo_with_commit(dir: &Path) {
    git(&["init", "-b", "main"], dir);
    git(&["config", "user.email", "test@test.com"], dir);
    git(&["config", "user.name", "Test"], dir);
    std::fs::write(dir.join("README.md"), "# test").unwrap();
    git(&["add", "."], dir);
    git(&["commit", "-m", "init"], dir);
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
async fn system_metrics_requires_auth() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let resp = get_without_auth(state, "/api/system/metrics").await;

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn system_metrics_returns_sane_json() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let resp = get(state, "/api/system/metrics").await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert!(json["sampledAt"].as_u64().unwrap() > 0);
    assert!(json["uptimeSeconds"].as_u64().is_some());
    assert!(json["cpu"]["usagePercent"].as_f64().unwrap() >= 0.0);
    assert!(json["cpu"]["logicalCoreCount"].as_u64().unwrap() > 0);
    assert!(json["memory"]["totalBytes"].as_u64().unwrap() > 0);
    assert!(json["memory"]["usagePercent"].as_f64().unwrap() >= 0.0);
    assert!(json["disk"]["mountPoint"].as_str().is_some());
    assert!(json["disk"]["usagePercent"].as_f64().unwrap() >= 0.0);
    assert!(json["disks"].as_array().is_some());
    assert!(json["temperatures"].as_array().is_some());
}

#[tokio::test]
async fn diagnostics_export_requires_auth() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let resp =
        post_json_without_auth(state, "/api/diagnostics/export", serde_json::json!({})).await;

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn diagnostics_export_returns_bundle_and_redacts_backend_events() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    state.diagnostics.record_event(DiagnosticEvent {
        timestamp_ms: now_ms(),
        level: "WARN".to_string(),
        source: "test".to_string(),
        message: "failed with Bearer super-secret-token".to_string(),
        fields: BTreeMap::from([("api_key".to_string(), "abc123".to_string())]),
    });

    let resp = post_json(
        state,
        "/api/diagnostics/export",
        serde_json::json!({
            "windowMinutes": 60,
            "frontendSnapshot": {
                "logs": [{ "message": "client-side context" }]
            }
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_text = String::from_utf8(body.to_vec()).unwrap();
    assert!(!body_text.contains("super-secret-token"));
    assert!(!body_text.contains("abc123"));

    let json: serde_json::Value = serde_json::from_str(&body_text).unwrap();
    assert_eq!(json["diagnosticSchemaVersion"], 1);
    assert_eq!(json["scope"]["windowMinutes"], 60);
    assert_eq!(
        json["frontend"]["logs"][0]["message"],
        "client-side context"
    );
    assert!(json["backend"]["events"].as_array().unwrap().len() >= 1);
    assert!(json["system"]["sampledAt"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn diagnostics_export_reports_effective_clamped_window() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let resp = post_json(
        state,
        "/api/diagnostics/export",
        serde_json::json!({ "windowMinutes": 120 }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["scope"]["windowMinutes"], 60);
    assert_eq!(json["manifest"]["retentionMinutes"], 60);
}

#[tokio::test]
async fn diagnostics_export_includes_live_terminal_tail() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    state
        .pty_manager
        .create(crate::pty::manager::PtyCreateOpts {
            id: "shell:diag-export".to_string(),
            command: "printf 'token=secret123\\n'; sleep 5".to_string(),
            cwd: tmp.path().display().to_string(),
            env: std::collections::HashMap::new(),
            runtime_otlp_run_marker: None,
            runtime_codex_correlation: None,
            cols: 80,
            rows: 24,
            project: Some("demo".to_string()),
            restart_policy: crate::config::schema::RestartPolicy::Never,
            restart_max_retries: 0,
        })
        .unwrap();

    assert!(wait_for(Duration::from_secs(3), || {
        state
            .pty_manager
            .get_buffer("shell:diag-export")
            .map(|buffer| buffer.contains("secret123"))
            .unwrap_or(false)
    }));

    let resp = post_json(
        state,
        "/api/diagnostics/export",
        serde_json::json!({
            "terminalIds": ["shell:diag-export"],
            "terminalTailBytes": 4096,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let sessions = json["terminals"]["sessions"].as_array().unwrap();
    let tails = json["terminals"]["tails"].as_array().unwrap();

    assert!(sessions.iter().any(|session| {
        session["id"] == "shell:diag-export"
            && session["alive"] == true
            && session["buffer_bytes"].is_number()
    }));
    assert!(tails.iter().any(|tail| {
        tail["sessionId"] == "shell:diag-export"
            && tail["source"] == "live"
            && tail["tail"]
                .as_str()
                .is_some_and(|value| value.contains("[REDACTED]"))
            && tail["tail"]
                .as_str()
                .is_some_and(|value| !value.contains("secret123"))
    }));
}

#[tokio::test]
async fn diagnostics_export_scopes_sessions_to_terminal_ids() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    state.diagnostics.record_event(DiagnosticEvent {
        timestamp_ms: now_ms(),
        level: "INFO".to_string(),
        source: "pty".to_string(),
        message: "terminal.a".to_string(),
        fields: BTreeMap::from([("sessionId".to_string(), "shell:diag-a".to_string())]),
    });
    state.diagnostics.record_event(DiagnosticEvent {
        timestamp_ms: now_ms(),
        level: "INFO".to_string(),
        source: "pty".to_string(),
        message: "terminal.b".to_string(),
        fields: BTreeMap::from([("sessionId".to_string(), "shell:diag-b".to_string())]),
    });
    state.diagnostics.record_event(DiagnosticEvent {
        timestamp_ms: now_ms(),
        level: "INFO".to_string(),
        source: "system".to_string(),
        message: "global".to_string(),
        fields: BTreeMap::new(),
    });

    for id in ["shell:diag-a", "shell:diag-b"] {
        state
            .pty_manager
            .create(crate::pty::manager::PtyCreateOpts {
                id: id.to_string(),
                command: "sleep 5".to_string(),
                cwd: tmp.path().display().to_string(),
                env: std::collections::HashMap::new(),
                runtime_otlp_run_marker: None,
                runtime_codex_correlation: None,
                cols: 80,
                rows: 24,
                project: Some("demo".to_string()),
                restart_policy: crate::config::schema::RestartPolicy::Never,
                restart_max_retries: 0,
            })
            .unwrap();
    }

    assert!(wait_for(Duration::from_secs(2), || {
        let sessions = state.pty_manager.list_detailed();
        sessions.iter().any(|s| s.meta.id == "shell:diag-a")
            && sessions.iter().any(|s| s.meta.id == "shell:diag-b")
    }));

    let resp = post_json(
        state.clone(),
        "/api/diagnostics/export",
        serde_json::json!({
            "terminalIds": ["shell:diag-a"],
            "includeTerminalOutput": false,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let backend_events = json["backend"]["events"].as_array().unwrap();
    let sessions = json["terminals"]["sessions"].as_array().unwrap();
    assert_eq!(
        json["manifest"]["backendEventCount"].as_u64(),
        Some(backend_events.len() as u64)
    );
    assert_eq!(json["manifest"]["terminalSessionCount"], 1);
    assert!(backend_events
        .iter()
        .any(|event| event["message"] == "terminal.a"));
    assert!(backend_events
        .iter()
        .any(|event| event["message"] == "global"));
    assert!(!backend_events
        .iter()
        .any(|event| event["message"] == "terminal.b"));
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], "shell:diag-a");

    let resp = post_json(
        state.clone(),
        "/api/diagnostics/export",
        serde_json::json!({
            "terminalIds": [],
            "includeTerminalOutput": true,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let backend_events = json["backend"]["events"].as_array().unwrap();
    assert_eq!(json["scope"]["terminalIds"].as_array().unwrap().len(), 0);
    assert_eq!(json["terminals"]["sessions"].as_array().unwrap().len(), 0);
    assert_eq!(json["terminals"]["tails"].as_array().unwrap().len(), 0);
    assert!(backend_events
        .iter()
        .any(|event| event["message"] == "global"));
    assert!(!backend_events
        .iter()
        .any(|event| event["message"] == "terminal.a"));

    state.pty_manager.kill("shell:diag-a").unwrap();
    state.pty_manager.kill("shell:diag-b").unwrap();
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

#[tokio::test]
async fn git_push_route_uses_selected_root_when_provided() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let parent = tmp.path().join("project");
    std::fs::create_dir_all(parent.join("modules")).unwrap();
    init_repo_with_commit(&parent);

    let remote = tmp.path().join("child-remote.git");
    let child_seed = tmp.path().join("child-seed");
    let child = parent.join("modules/child");

    std::fs::create_dir_all(&remote).unwrap();
    std::fs::create_dir_all(&child_seed).unwrap();

    git(&["init", "--bare"], &remote);
    init_repo_with_commit(&child_seed);
    git(
        &["remote", "add", "origin", remote.to_str().unwrap()],
        &child_seed,
    );
    git(&["push", "-u", "origin", "main"], &child_seed);
    git(
        &["clone", remote.to_str().unwrap(), child.to_str().unwrap()],
        tmp.path(),
    );
    git(&["config", "user.email", "test@test.com"], &child);
    git(&["config", "user.name", "Test"], &child);
    std::fs::write(child.join("nested.txt"), "ahead\n").unwrap();
    git(&["add", "nested.txt"], &child);
    git(&["commit", "-m", "child change"], &child);

    {
        let mut cfg = state.config.write().await;
        cfg.projects.push(ProjectConfig {
            name: "project".into(),
            path: parent.to_string_lossy().into_owned(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: crate::config::RestartPolicy::Never,
            restart_max_retries: 5,
            health_check_url: None,
        });
    }

    let without_root = post_json(
        state.clone(),
        "/api/git/push",
        serde_json::json!({ "project": "project" }),
    )
    .await;
    assert_eq!(without_root.status(), StatusCode::OK);
    let without_root_body = axum::body::to_bytes(without_root.into_body(), usize::MAX)
        .await
        .unwrap();
    let without_root_json: serde_json::Value = serde_json::from_slice(&without_root_body).unwrap();
    assert_eq!(without_root_json["success"], false);
    let without_root_error = without_root_json["error"]
        .as_str()
        .unwrap_or_default()
        .to_lowercase();
    assert!(
        without_root_error.contains("no configured push destination")
            || without_root_error.contains("has no upstream branch"),
        "unexpected push failure for omitted root: {without_root_json}"
    );

    let with_root = post_json(
        state,
        "/api/git/push",
        serde_json::json!({ "project": "project", "root": "modules/child" }),
    )
    .await;
    assert_eq!(with_root.status(), StatusCode::OK);
    let with_root_body = axum::body::to_bytes(with_root.into_body(), usize::MAX)
        .await
        .unwrap();
    let with_root_json: serde_json::Value = serde_json::from_slice(&with_root_body).unwrap();
    assert_eq!(with_root_json["success"], true);

    let remote_head = git_output(&["rev-parse", "HEAD"], &remote);
    let child_head = git_output(&["rev-parse", "HEAD"], &child);
    assert_eq!(remote_head, child_head);
}

#[tokio::test]
async fn git_push_route_force_pushes_when_explicitly_requested() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let project = tmp.path().join("project");
    let remote = tmp.path().join("project-remote.git");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&remote).unwrap();

    init_repo_with_commit(&project);
    git(&["init", "--bare"], &remote);
    git(
        &["remote", "add", "origin", remote.to_str().unwrap()],
        &project,
    );
    git(&["push", "-u", "origin", "main"], &project);
    git(&["symbolic-ref", "HEAD", "refs/heads/main"], &remote);

    let clone = tmp.path().join("clone");
    git(
        &["clone", remote.to_str().unwrap(), clone.to_str().unwrap()],
        tmp.path(),
    );
    git(&["config", "user.email", "test@test.com"], &clone);
    git(&["config", "user.name", "Test"], &clone);

    std::fs::write(clone.join("remote.txt"), "remote\n").unwrap();
    git(&["add", "remote.txt"], &clone);
    git(&["commit", "-m", "remote commit"], &clone);
    git(&["push"], &clone);

    std::fs::write(project.join("local.txt"), "local\n").unwrap();
    git(&["add", "local.txt"], &project);
    git(&["commit", "-m", "local rewrite"], &project);

    {
        let mut cfg = state.config.write().await;
        cfg.projects.push(ProjectConfig {
            name: "project".into(),
            path: project.to_string_lossy().into_owned(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: crate::config::RestartPolicy::Never,
            restart_max_retries: 5,
            health_check_url: None,
        });
    }

    let resp = post_json(
        state.clone(),
        "/api/git/push",
        serde_json::json!({ "project": "project" }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let raw = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(json["success"], false);

    let resp = post_json(
        state,
        "/api/git/push",
        serde_json::json!({ "project": "project", "force": true }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let raw = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(json["success"], true);
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], &remote),
        git_output(&["rev-parse", "HEAD"], &project)
    );
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["ready"], true);
    assert_eq!(json["name"], "test-workspace");
    assert_eq!(json["projectCount"], 0);
    assert_eq!(
        json["configPath"],
        tmp.path()
            .join("dam-hopper.toml")
            .to_string_lossy()
            .to_string()
    );
}

#[tokio::test]
async fn workspace_get_includes_config_path_and_legacy_root() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/workspace").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["name"], "test-workspace");
    assert_eq!(json["root"], tmp.path().to_string_lossy().to_string());
    assert_eq!(
        json["configPath"],
        tmp.path()
            .join("dam-hopper.toml")
            .to_string_lossy()
            .to_string()
    );
}

#[tokio::test]
async fn workspace_switch_accepts_direct_config_file_path() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let switched = tempfile::tempdir().unwrap();
    let switched_cfg = switched.path().join("dam-hopper.toml");
    std::fs::write(
        &switched_cfg,
        r#"
[workspace]
name = "switched"
root = "."
"#,
    )
    .unwrap();

    let resp = post_json(
        state.clone(),
        "/api/workspace/switch",
        serde_json::json!({ "path": switched_cfg.to_string_lossy().to_string() }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = get(state.clone(), "/api/workspace/status").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["name"], "switched");
    assert_eq!(
        json["configPath"],
        switched_cfg
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string()
    );

    let resp = get(state, "/api/workspace").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["root"], switched.path().to_string_lossy().to_string());
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["workspace"]["name"], "test-workspace");
}

#[tokio::test]
async fn config_update_persists_camel_case_project_fields_as_toml_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let resp = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({
            "workspace": { "name": "test-workspace", "root": "." },
            "projects": [{
                "name": "test-project",
                "path": ".",
                "type": "cargo",
                "envFile": ".env",
                "services": [{
                    "name": "default",
                    "buildCommand": "cargo build",
                    "runCommand": "cargo run"
                }],
                "restartPolicy": "on-failure",
                "restartMaxRetries": 7,
                "healthCheckUrl": "http://localhost:4800/health"
            }]
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let written = std::fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap();
    assert!(written.contains("env_file = \".env\""));
    assert!(written.contains("build_command = \"cargo build\""));
    assert!(written.contains("run_command = \"cargo run\""));
    assert!(written.contains("restart = \"on-failure\""));
    assert!(written.contains("restart_max_retries = 7"));
    assert!(written.contains("health_check_url = \"http://localhost:4800/health\""));
    assert!(!written.contains("envFile"));
    assert!(!written.contains("buildCommand"));
    assert!(!written.contains("restartPolicy"));

    let resp = get(state, "/api/config").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["projects"][0]["envFile"], ".env");
    assert_eq!(
        json["projects"][0]["services"][0]["runCommand"],
        "cargo run"
    );
}

#[tokio::test]
async fn config_update_reloads_from_current_config_path_not_workspace_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let unrelated = tempfile::tempdir().unwrap();
    *state.workspace_dir.write().await = unrelated.path().to_path_buf();

    let resp = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({
            "workspace": { "name": "updated-via-config-path", "root": "." },
            "projects": []
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let cfg = state.config.read().await;
    assert_eq!(cfg.workspace.name, "updated-via-config-path");
}

#[tokio::test]
async fn config_update_reinitializes_sandbox_from_new_project_roots() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let project_dir = tmp.path().join("alpha");
    std::fs::create_dir_all(&project_dir).unwrap();
    std::fs::write(project_dir.join("hello.txt"), "hello").unwrap();

    let resp = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({
            "workspace": { "name": "test-workspace", "root": "." },
            "projects": [{
                "name": "alpha",
                "path": "alpha",
                "type": "custom"
            }]
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let read_resp = get(state, "/api/fs/read?project=alpha&path=hello.txt").await;
    assert_eq!(read_resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(read_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&body[..], b"hello");
}

#[tokio::test]
async fn config_update_formats_mixed_absolute_project_paths_for_toml() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let inside_dir = tmp.path().join("inside-project");
    std::fs::create_dir_all(&inside_dir).unwrap();

    let outside = tempfile::tempdir().unwrap();
    let outside_dir = outside.path().join("outside-project");
    std::fs::create_dir_all(&outside_dir).unwrap();

    let resp = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({
            "workspace": { "name": "test-workspace", "root": "." },
            "projects": [
                {
                    "name": "inside",
                    "path": inside_dir.to_string_lossy().to_string(),
                    "type": "cargo"
                },
                {
                    "name": "outside",
                    "path": outside_dir.to_string_lossy().to_string(),
                    "type": "cargo"
                }
            ]
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let written = std::fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap();
    let parsed: toml::Value = toml::from_str(&written).unwrap();
    let projects = parsed["projects"].as_array().unwrap();
    let inside_path = projects[0]["path"].as_str().unwrap();
    let outside_path = projects[1]["path"].as_str().unwrap();

    assert_eq!(inside_path, "inside-project");
    assert!(!inside_path.contains('\\'));
    assert_eq!(outside_path, outside_dir.to_string_lossy());
    assert!(std::path::Path::new(outside_path).is_absolute());

    let resp = get(state, "/api/config").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["projects"][0]["path"],
        inside_dir.to_string_lossy().to_string()
    );
    assert_eq!(
        json["projects"][1]["path"],
        outside_dir.to_string_lossy().to_string()
    );
}

#[tokio::test]
async fn config_patch_project_persists_camel_case_project_fields_as_toml_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    std::fs::write(
        tmp.path().join("dam-hopper.toml"),
        r#"
[workspace]
name = "test-workspace"

[[projects]]
name = "test-project"
path = "."
type = "cargo"
envFile = "ignored.env"
restartPolicy = "never"
"#,
    )
    .unwrap();

    let resp = patch_json(
        state.clone(),
        "/api/config/projects/test-project",
        serde_json::json!({
            "envFile": ".env",
            "services": [{
                "name": "default",
                "runCommand": "cargo run"
            }],
            "restartPolicy": "always"
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let written = std::fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap();
    assert!(written.contains("env_file = \".env\""));
    assert!(written.contains("run_command = \"cargo run\""));
    assert!(written.contains("restart = \"always\""));
    assert!(!written.contains("envFile"));
    assert!(!written.contains("restartPolicy"));

    let resp = get(state, "/api/config").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["projects"][0]["envFile"], ".env");
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn commands_list_by_type_returns_maven() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/commands?projectType=maven").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn commands_list_unknown_type_returns_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let resp = get(state, "/api/commands?projectType=unknown-type").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
        projects: vec![test_project_config(&workspace_dir)],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![("test-project".into(), workspace_dir.clone())]);
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
        None,
        test_opaque_setup(),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
        crate::telemetry::TelemetryRuntime::new(),
    )
    .expect("make_state_with_project failed")
}

fn make_state_with_project_roots(tmp: &TempDir, roots: Vec<(&str, &Path)>) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let projects: Vec<ProjectConfig> = roots
        .iter()
        .map(|(name, path)| ProjectConfig {
            name: (*name).into(),
            path: path.to_string_lossy().into_owned(),
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
        })
        .collect();
    let sandbox_roots = projects
        .iter()
        .map(|project| {
            (
                project.name.clone(),
                std::path::PathBuf::from(&project.path),
            )
        })
        .collect();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: crate::config::ServerConfig::default(),
        projects,
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(sandbox_roots);
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
        None,
        test_opaque_setup(),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
        crate::telemetry::TelemetryRuntime::new(),
    )
    .expect("make_state_with_project_roots failed")
}

#[tokio::test]
async fn fs_rest_validates_against_selected_project_root() {
    let registry_tmp = tempfile::tempdir().unwrap();
    let projects_tmp = tempfile::tempdir().unwrap();
    let alpha = projects_tmp.path().join("alpha");
    let beta = projects_tmp.path().join("beta");
    std::fs::create_dir_all(&alpha).unwrap();
    std::fs::create_dir_all(&beta).unwrap();
    std::fs::write(alpha.join("owned.txt"), "alpha").unwrap();
    std::fs::write(beta.join("owned.txt"), "beta").unwrap();

    let state = make_state_with_project_roots(
        &registry_tmp,
        vec![("alpha", alpha.as_path()), ("beta", beta.as_path())],
    );

    let alpha_resp = get(state.clone(), "/api/fs/read?project=alpha&path=owned.txt").await;
    assert_eq!(alpha_resp.status(), StatusCode::OK);
    let alpha_body = axum::body::to_bytes(alpha_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&alpha_body[..], b"alpha");

    let beta_resp = get(state.clone(), "/api/fs/read?project=beta&path=owned.txt").await;
    assert_eq!(beta_resp.status(), StatusCode::OK);
    let beta_body = axum::body::to_bytes(beta_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&beta_body[..], b"beta");

    let escape_resp = get(
        state.clone(),
        "/api/fs/read?project=alpha&path=../beta/owned.txt",
    )
    .await;
    assert_eq!(escape_resp.status(), StatusCode::FORBIDDEN);

    let missing_resp = get(state, "/api/fs/read?project=missing&path=owned.txt").await;
    assert_eq!(missing_resp.status(), StatusCode::NOT_FOUND);
}

fn make_state_with_project_env_file(tmp: &TempDir, env_file: Option<&str>) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let mut project = test_project_config(&workspace_dir);
    project.env_file = env_file.map(str::to_string);

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: crate::config::ServerConfig::default(),
        projects: vec![project],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![("test-project".into(), workspace_dir.clone())]);
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
        None,
        test_opaque_setup(),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
        crate::telemetry::TelemetryRuntime::new(),
    )
    .expect("make_state_with_project_env_file failed")
}

#[test]
fn merge_global_ui_config_rejects_non_object_payloads() {
    let err = crate::api::config::merge_global_ui_config(
        Some(crate::config::schema::UiConfig::default()),
        &serde_json::json!(true),
    )
    .unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
}

// ---------------------------------------------------------------------------
// Usage analytics (aggregate-only)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn usage_summary_requires_auth_and_never_exposes_event_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);

    let unauthorized = get_without_auth(state.clone(), "/api/usage/summary").await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let response = get(state, "/api/usage/summary?window=24h").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(value["terminal"]["commandCount"].is_number());
    assert!(value["codex"].is_null());
    let text = String::from_utf8(body.to_vec()).unwrap();
    for forbidden in [
        "fingerprint",
        "command_events",
        "conversation",
        "cwd",
        "path",
        "modelEvent",
    ] {
        assert!(!text.contains(forbidden), "response leaked {forbidden}");
    }
}

#[tokio::test]
async fn usage_summary_rejects_unknown_projects_and_injection_like_filters() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);

    let unknown = get(state.clone(), "/api/usage/summary?project=missing").await;
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    let injection = get(state, "/api/usage/summary?category=x%27%20OR%201%3D1").await;
    assert_eq!(injection.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn usage_summary_returns_filled_aggregate_series_and_detail_metrics() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let timestamp = i64::try_from(now_ms())
        .unwrap()
        .saturating_sub(30 * 60 * 1_000);
    write_usage_command(&state, &tmp, timestamp, 1, "git status", 100);
    write_usage_command(&state, &tmp, timestamp + 1_000, 2, "git status", 300);

    let response = get(state, "/api/usage/summary?window=24h&bucket=hour").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let series = value["timeSeries"].as_array().unwrap();
    assert_eq!(
        series.len(),
        25,
        "24h window includes its current UTC bucket"
    );
    assert_eq!(
        series
            .iter()
            .map(|bucket| bucket["terminal"]["commandCount"].as_u64().unwrap())
            .sum::<u64>(),
        2
    );
    assert_eq!(value["categories"][0]["name"], "git");
    assert_eq!(value["projects"][0]["name"], "unassigned");
    assert_eq!(value["detailMetrics"]["durationP50Ms"], 100);
    assert_eq!(value["detailMetrics"]["durationP95Ms"], 300);
    assert_eq!(value["detailMetrics"]["repeatedCommandCount"], 1);
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(!text.contains("fingerprint"));
    assert!(!text.contains("git status"));
}

#[tokio::test]
async fn usage_settings_apply_pause_atomically_and_delete_requires_confirmation() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);

    let updated = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({
            "paused": true,
            "excludedProjects": ["private"]
        }),
    )
    .await;
    assert_eq!(updated.status(), StatusCode::OK);
    let telemetry = state.telemetry.read().unwrap().clone();
    assert!(!telemetry.control.is_enabled());
    assert!(std::fs::read_to_string(tmp.path().join("dam-hopper.toml"))
        .unwrap()
        .contains("paused = true"));

    let rejected = delete_json(
        state.clone(),
        "/api/usage",
        serde_json::json!({"confirmation": "no"}),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let deleted = delete_json(
        state,
        "/api/usage",
        serde_json::json!({"confirmation": "delete-usage-data"}),
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::OK);
}

#[tokio::test]
async fn usage_settings_persist_terminal_correlation_opt_in() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let updated = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"terminalCorrelationEnabled": true}),
    )
    .await;
    assert_eq!(updated.status(), StatusCode::OK);
    let body = axum::body::to_bytes(updated.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["terminalCorrelationEnabled"], true);
    assert!(state
        .config
        .read()
        .await
        .server
        .telemetry
        .terminal_correlation_enabled);
    assert!(std::fs::read_to_string(tmp.path().join("dam-hopper.toml"))
        .unwrap()
        .contains("terminal_correlation_enabled = true"));
}

#[tokio::test]
async fn usage_setup_status_is_opaque_to_the_browser() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let response = get(state, "/api/usage/setup").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(text.contains("collectorEnabled"));
    assert!(text.contains("codexExporter"));
    assert!(!text.contains("127.0.0.1"));
    assert!(!text.contains("endpoint"));
    assert!(!text.contains("config.toml"));
}

#[tokio::test]
async fn usage_settings_enable_and_disable_apply_the_runtime_without_a_server_restart() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let enabled = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"enabled": true}),
    )
    .await;
    assert_eq!(enabled.status(), StatusCode::OK);
    let body = axum::body::to_bytes(enabled.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["runtime"]["active"], true);
    assert_eq!(value["runtime"]["collectorError"], serde_json::Value::Null);
    assert!(state.telemetry.read().unwrap().store.is_some());

    let disabled = post_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"enabled": false}),
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::OK);
    assert!(state.telemetry.read().unwrap().store.is_none());
    assert!(!state.config.read().await.server.telemetry.enabled);
}

#[tokio::test]
async fn usage_settings_manages_codex_exporter_without_returning_its_bearer_secret() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();

    let enabled = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({
            "enabled": true,
            "collector": {"enabled": true, "host": "127.0.0.1", "port": port},
            "codexExporter": true
        }),
    )
    .await;
    assert_eq!(enabled.status(), StatusCode::OK);
    let body = axum::body::to_bytes(enabled.into_body(), usize::MAX)
        .await
        .unwrap();
    let response = String::from_utf8(body.to_vec()).unwrap();
    assert!(response.contains("\"codexExporter\":\"managed\""));
    assert!(!response.contains("authorization"));
    let token = std::fs::read_to_string(tmp.path().join("collector-token")).unwrap();
    assert!(!response.contains(&token));

    let codex_config = std::fs::read_to_string(tmp.path().join(".codex/config.toml")).unwrap();
    assert!(codex_config.contains("log_user_prompt = false"));
    assert!(codex_config.contains(&format!("http://127.0.0.1:{port}/v1/logs")));

    let disabled = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"enabled": false}),
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::OK);
    assert!(
        std::fs::read_to_string(tmp.path().join(".codex/config.toml"))
            .unwrap()
            .contains("exporter = \"none\"")
    );
    state.telemetry_runtime.shutdown().await;
}

#[tokio::test]
async fn usage_settings_restores_codex_config_when_dam_hopper_config_persist_fails() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let blocker = tmp.path().join("not-a-directory");
    std::fs::write(&blocker, "blocker").unwrap();
    state.config.write().await.config_path = blocker.join("dam-hopper.toml");
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();

    let response = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({
            "enabled": true,
            "collector": {"enabled": true, "host": "127.0.0.1", "port": port},
            "codexExporter": true
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(!tmp.path().join(".codex/config.toml").exists());
    assert!(!state.telemetry_runtime.status().active);
}

#[tokio::test]
async fn usage_retention_update_and_delete_are_serialized_while_runtime_is_live() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let enabled = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"enabled": true}),
    )
    .await;
    assert_eq!(enabled.status(), StatusCode::OK);

    let (retention, deletion) = tokio::join!(
        patch_json(
            state.clone(),
            "/api/usage/settings",
            serde_json::json!({"detailRetentionDays": 30}),
        ),
        delete_json(
            state.clone(),
            "/api/usage",
            serde_json::json!({"confirmation": "delete-usage-data"}),
        )
    );
    assert_eq!(retention.status(), StatusCode::OK);
    assert_eq!(deletion.status(), StatusCode::OK);
    state.telemetry_runtime.shutdown().await;
}

fn activate_telemetry(state: &AppState, tmp: &TempDir) {
    let store = Arc::new(TelemetryStore::open(&tmp.path().join("telemetry.db")).unwrap());
    let control = Arc::new(TelemetryControl::new(true, Vec::<String>::new()));
    let keys =
        Arc::new(TelemetryKeyRing::load_or_create(tmp.path().join("telemetry-key")).unwrap());
    state.set_telemetry(TelemetryHandle::active(control, store, None).with_hmac_keys(keys));
}

fn write_usage_command(
    state: &AppState,
    tmp: &TempDir,
    timestamp: i64,
    sequence: u64,
    command: &str,
    duration_ms: u64,
) {
    let key = load_or_create_hmac_key(&tmp.path().join("usage-test-key")).unwrap();
    let normalized = normalize_command(command, &key);
    let run_id = TerminalRunId(Uuid::new_v4());
    let store = state
        .telemetry
        .read()
        .unwrap()
        .store
        .as_ref()
        .unwrap()
        .clone();
    store
        .write_batch(vec![
            TelemetryCmd::TerminalRun(TerminalRunEvent {
                schema_version: TELEMETRY_SCHEMA_VERSION,
                run_id,
                project: None,
                shell: ShellKind::Bash,
                started_at_utc_ms: timestamp,
                ended_at_utc_ms: None,
                capture_quality: CaptureQuality::Rich,
            }),
            TelemetryCmd::Command(CommandEvent {
                schema_version: TELEMETRY_SCHEMA_VERSION,
                id: CommandEventId { run_id, sequence },
                occurred_at_utc_ms: timestamp,
                duration_ms: Some(duration_ms),
                exit_code: Some(0),
                outcome: CommandOutcome::Succeeded,
                category: normalized.category,
                executable: normalized.executable,
                argument_count: normalized.argument_count,
                fingerprint: normalized.fingerprint,
                capture_quality: CaptureQuality::Rich,
            }),
        ])
        .unwrap();
}

#[test]
fn merge_global_ui_config_rejects_invalid_notification_sound_pattern() {
    let err = crate::api::config::merge_global_ui_config(
        Some(crate::config::schema::UiConfig::default()),
        &serde_json::json!({
            "terminalCodexNotificationSoundPattern": "bell",
        }),
    )
    .unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
}

#[tokio::test]
async fn update_global_ui_at_path_persists_partial_merge_and_updates_state() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationsEnabled": true,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(&gc_path).unwrap();
    assert!(written.contains("terminal_codex_notifications_enabled = true"));
    assert!(!written.contains("terminal_agent_notifications_enabled"));

    let ui = state.global_config.read().await.ui.clone().unwrap();
    assert!(ui.terminal_codex_notifications_enabled);
}

#[tokio::test]
async fn update_global_ui_at_path_persists_terminal_notification_sound_settings() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationSoundEnabled": false,
            "terminalCodexNotificationSoundVolume": 45,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(&gc_path).unwrap();
    assert!(written.contains("terminal_codex_notification_sound_enabled = false"));
    assert!(written.contains("terminal_codex_notification_sound_volume = 45"));

    let ui = state.global_config.read().await.ui.clone().unwrap();
    assert!(!ui.terminal_codex_notification_sound_enabled);
    assert_eq!(ui.terminal_codex_notification_sound_volume, 45);
}

#[tokio::test]
async fn update_global_ui_at_path_persists_notification_delivery_and_pattern_settings() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationToastEnabled": false,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();
    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexBrowserNotificationsEnabled": false,
            "terminalCodexNotificationSoundPattern": "soft",
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(&gc_path).unwrap();
    assert!(written.contains("terminal_codex_notification_toast_enabled = false"));
    assert!(written.contains("terminal_codex_browser_notifications_enabled = false"));
    assert!(written.contains("terminal_codex_notification_sound_pattern = \"soft\""));

    let ui = state.global_config.read().await.ui.clone().unwrap();
    assert!(!ui.terminal_codex_notification_toast_enabled);
    assert!(!ui.terminal_codex_browser_notifications_enabled);
    assert_eq!(
        ui.terminal_codex_notification_sound_pattern,
        crate::config::schema::TerminalCodexNotificationSoundPattern::Soft
    );
}

#[tokio::test]
async fn update_global_ui_at_path_rejects_invalid_pattern_without_mutating_config() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationToastEnabled": false,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();
    let before = std::fs::read_to_string(&gc_path).unwrap();

    let err = crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationSoundPattern": "bell",
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap_err();

    assert!(matches!(err, crate::error::AppError::InvalidInput(_)));
    assert_eq!(std::fs::read_to_string(&gc_path).unwrap(), before);
}

#[tokio::test]
async fn update_global_ui_at_path_does_not_sync_codex_tui_for_child_settings() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");
    let codex_dir = tmp.path().join(".codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    let codex_config_path = codex_dir.join("config.toml");
    let original_codex_config = "[tui]\nnotifications = false\n";
    std::fs::write(&codex_config_path, original_codex_config).unwrap();

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationToastEnabled": false,
            "terminalCodexBrowserNotificationsEnabled": false,
            "terminalCodexNotificationSoundPattern": "urgent",
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(codex_config_path).unwrap(),
        original_codex_config
    );
}

#[tokio::test]
async fn update_global_ui_at_path_creates_codex_tui_config_when_enabled() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationsEnabled": true,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(tmp.path().join(".codex").join("config.toml")).unwrap();
    assert!(written.contains("[tui]"));
    assert!(written.contains("notifications = true"));
    assert!(written.contains("notification_method = \"osc9\""));
    assert!(written.contains("notification_condition = \"always\""));

    let ui = state.global_config.read().await.ui.clone().unwrap();
    assert!(ui.terminal_codex_notifications_enabled);
}

#[tokio::test]
async fn update_global_ui_at_path_merges_existing_codex_tui_config() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");
    let codex_dir = tmp.path().join(".codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    std::fs::write(
        codex_dir.join("config.toml"),
        "[model]\nname = \"gpt-5\"\n\n[tui]\nnotifications = false\n",
    )
    .unwrap();

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationsEnabled": true,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(codex_dir.join("config.toml")).unwrap();
    assert!(written.contains("[model]"));
    assert!(written.contains("name = \"gpt-5\""));
    assert!(written.contains("[tui]"));
    assert!(written.contains("notifications = true"));
    assert!(written.contains("notification_method = \"osc9\""));
    assert!(written.contains("notification_condition = \"always\""));
}

#[tokio::test]
async fn update_global_ui_at_path_disables_existing_codex_tui_notifications() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let gc_path = tmp.path().join("dam-hopper").join("config.toml");
    let codex_dir = tmp.path().join(".codex");
    std::fs::create_dir_all(&codex_dir).unwrap();
    std::fs::write(
        codex_dir.join("config.toml"),
        "[tui]\nnotifications = true\nnotification_method = \"osc9\"\nnotification_condition = \"always\"\n",
    )
    .unwrap();

    crate::api::config::update_global_ui_at_path_with_codex_home(
        &state,
        &gc_path,
        Some(&serde_json::json!({
            "terminalCodexNotificationsEnabled": false,
        })),
        Some(tmp.path()),
    )
    .await
    .unwrap();

    let written = std::fs::read_to_string(codex_dir.join("config.toml")).unwrap();
    assert!(written.contains("notifications = false"));
    assert!(written.contains("notification_method = \"osc9\""));
    assert!(written.contains("notification_condition = \"always\""));
}

fn test_project_config(workspace_dir: &std::path::Path) -> ProjectConfig {
    ProjectConfig {
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
    }
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
    let raw = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let meta: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(meta["id"], "test-echo-session");

    // Session appears in list
    let list_resp = get(state, "/api/terminal").await;
    assert_eq!(list_resp.status(), StatusCode::OK);
    let list_raw = axum::body::to_bytes(list_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list: Vec<serde_json::Value> = serde_json::from_slice(&list_raw).unwrap();
    assert!(list.iter().any(|s| s["id"] == "test-echo-session"));
}

#[tokio::test]
async fn terminal_create_preserves_otel_conflict_and_reports_health() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    {
        let mut config = state.config.write().await;
        config.server.telemetry.terminal_correlation_enabled = true;
        config.server.telemetry.collector.enabled = true;
    }
    let response = post_json(
        state.clone(),
        "/api/terminal",
        serde_json::json!({
            "id": "terminal:otel-conflict",
            "command": "cat",
            "cwd": tmp.path().to_str().unwrap(),
            "env": {"OTEL_RESOURCE_ATTRIBUTES": "user.attribute=preserved"}
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let store = state.telemetry.read().unwrap().store.clone().unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline
        && crate::telemetry::queries::health_value(&store, "codex_correlation_env_conflicts")
            .unwrap()
            == 0
    {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        crate::telemetry::queries::health_value(&store, "codex_correlation_env_conflicts")
            .unwrap(),
        1
    );
    let health = get(state.clone(), "/api/usage/health").await;
    let body = axum::body::to_bytes(health.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["correlationEnvConflicts"], 1);
    state.pty_manager.remove("terminal:otel-conflict").unwrap();
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
    let buf_raw = axum::body::to_bytes(buf_resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.is_array());
}

#[tokio::test]
async fn terminal_create_loads_project_env_file_for_terminal_sessions() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".env"), "MONGODB_DATABASE=gleanOak\n").unwrap();
    let state = make_state_with_project_env_file(&tmp, Some(".env"));

    let body = serde_json::json!({
        "id": "env-file-session",
        "command": "printf '%s\n' \"$MONGODB_DATABASE\"; cat",
        "cwd": tmp.path().to_str().unwrap(),
        "project": "test-project"
    });
    let resp = post_json(state.clone(), "/api/terminal", body).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let ok = wait_for(Duration::from_secs(2), || {
        state
            .pty_manager
            .get_buffer("env-file-session")
            .map(|buf| buf.contains("gleanOak"))
            .unwrap_or(false)
    });
    assert!(ok, "terminal should receive project env_file values");
}

#[tokio::test]
async fn terminal_create_defaults_project_cwd_to_project_root() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state_with_project_env_file(&tmp, None);

    let body = serde_json::json!({
        "id": "project-default-cwd-session",
        "command": "printf '%s' \"$PWD\"; cat",
        "project": "test-project"
    });
    let resp = post_json(state.clone(), "/api/terminal", body).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let ok = wait_for(Duration::from_secs(2), || {
        state
            .pty_manager
            .get_buffer("project-default-cwd-session")
            .map(|buf| buf.contains(&tmp.path().to_string_lossy().to_string()))
            .unwrap_or(false)
    });
    assert!(
        ok,
        "terminal should start in project root when cwd is omitted"
    );
}

#[tokio::test]
async fn terminal_create_rejects_project_cwd_escape() {
    let tmp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let state = make_state_with_project_env_file(&tmp, None);

    let body = serde_json::json!({
        "id": "project-cwd-escape-session",
        "command": "echo should-not-run",
        "cwd": outside.path().to_str().unwrap(),
        "project": "test-project"
    });
    let resp = post_json(state, "/api/terminal", body).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn terminal_create_request_env_overrides_project_env_file() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".env"), "MONGODB_DATABASE=gleanOak\n").unwrap();
    let state = make_state_with_project_env_file(&tmp, Some(".env"));

    let body = serde_json::json!({
        "id": "env-override-session",
        "command": "printf '%s\n' \"$MONGODB_DATABASE\"; cat",
        "cwd": tmp.path().to_str().unwrap(),
        "project": "test-project",
        "env": {
            "MONGODB_DATABASE": "overrideDb"
        }
    });
    let resp = post_json(state.clone(), "/api/terminal", body).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let ok = wait_for(Duration::from_secs(2), || {
        state
            .pty_manager
            .get_buffer("env-override-session")
            .map(|buf| buf.contains("overrideDb"))
            .unwrap_or(false)
    });
    assert!(ok, "request env should override project env_file values");
}

#[tokio::test]
async fn terminal_create_rejects_malformed_project_env_file() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join(".env"), "NOT VALID\n").unwrap();
    let state = make_state_with_project_env_file(&tmp, Some(".env"));

    let body = serde_json::json!({
        "id": "bad-env-file-session",
        "command": "echo should-not-run",
        "cwd": tmp.path().to_str().unwrap(),
        "project": "test-project"
    });
    let resp = post_json(state, "/api/terminal", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let raw = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert!(
        json["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Invalid env_file"),
        "unexpected error: {json}"
    );
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
    let ship_raw = axum::body::to_bytes(ship_resp.into_body(), usize::MAX)
        .await
        .unwrap();
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
        &axum::body::to_bytes(unship_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
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
    )
    .await
    .unwrap();

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
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.is_object());
}

// ---------------------------------------------------------------------------
// Git API endpoints
// ---------------------------------------------------------------------------

fn init_git_repo(path: &std::path::Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "test@test.com"], path);
    git(&["config", "user.name", "Test"], path);
    std::fs::write(path.join("README.md"), "# test repo").unwrap();
    git(&["add", "README.md"], path);
    git(&["commit", "-m", "init"], path);
}

#[tokio::test]
async fn git_branches_returns_list_for_valid_project() {
    let tmp = tempfile::tempdir().unwrap();
    init_git_repo(tmp.path());
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/branches").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Should have at least the initial branch (main/master)
    assert!(
        json.as_array().map(|a| !a.is_empty()).unwrap_or(false),
        "expected non-empty branch list, got: {json}"
    );
}

#[tokio::test]
async fn git_worktrees_returns_list_for_valid_project() {
    let tmp = tempfile::tempdir().unwrap();
    init_git_repo(tmp.path());
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/worktrees").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Main worktree is always present in an initialized repo
    assert!(
        json.as_array().map(|a| !a.is_empty()).unwrap_or(false),
        "expected non-empty worktree list, got: {json}"
    );
}

#[tokio::test]
async fn git_roots_returns_primary_root_for_valid_project() {
    let tmp = tempfile::tempdir().unwrap();
    init_git_repo(tmp.path());
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/roots").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let roots = json.as_array().expect("roots response should be an array");
    assert!(roots.iter().any(|root| {
        root["rootId"] == "." && root["kind"] == "primary" && root["status"].is_object()
    }));
}

#[tokio::test]
async fn git_roots_returns_typed_unavailable_for_plain_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/roots").await;
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "GIT_NOT_INITIALIZED");
    assert_eq!(json["error"], "Git is not initialized for this project");
}

#[tokio::test]
async fn git_branches_returns_typed_unavailable_for_plain_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/branches").await;
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "GIT_NOT_INITIALIZED");
}

#[tokio::test]
async fn git_diff_returns_typed_unavailable_for_plain_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state_with_project(&tmp);

    let resp = get(state, "/api/git/test-project/diff?root=*").await;
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "GIT_NOT_INITIALIZED");
}

#[tokio::test]
async fn git_roots_accepts_nested_repository_in_plain_project() {
    let tmp = tempfile::tempdir().unwrap();
    let nested = tmp.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    init_git_repo(&nested);
    let state = make_state_with_project(&tmp);

    let resp = get(state.clone(), "/api/git/test-project/roots").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let roots: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(roots.as_array().unwrap().len(), 1);
    assert_eq!(roots[0]["rootId"], "nested");

    let branches = get(state, "/api/git/test-project/branches?root=nested").await;
    assert_eq!(branches.status(), StatusCode::OK);
}

#[tokio::test]
async fn git_branches_unknown_project_returns_404() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp); // no projects
    let resp = get(state, "/api/git/no-such-project/branches").await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn git_delete_branch_blocks_checked_out_branch() {
    let tmp = tempfile::tempdir().unwrap();
    init_git_repo(tmp.path());
    git(&["checkout", "-b", "feature/delete-me"], tmp.path());
    git(&["checkout", "main"], tmp.path());
    let state = make_state_with_project(&tmp);

    let resp = delete_json(
        state,
        "/api/git/test-project/branches",
        serde_json::json!({ "name": "main" }),
    )
    .await;

    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["ok"], false);
    assert_eq!(json["blockedReason"], "checked-out-branch");
}
