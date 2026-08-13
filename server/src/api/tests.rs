use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use tower::ServiceExt;

use crate::{
    agent_store::AgentStoreService,
    api::{build_router, router::build_router_with_web_dir},
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::{now_ms, DiagnosticEvent, DiagnosticStore},
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
    system::alerts::{
        AlertSeverity, ResourceAlertEvidence, ResourceAlertIncident, ResourceAlertKind,
        ResourceAlertState, ResourceAlertSummary,
    },
    telemetry::{
        worker::{TelemetryControl, TelemetryHandle},
        CodexModel, CodexUsageEvent, CodexVersion, SafeIdentifier, SourceQuality, TelemetryCmd,
        TelemetryKeyRing, TelemetryStore, TokenCounterSemantic, TokenQuality,
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

use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
};

use once_cell::sync::Lazy;

static MEDIA_COOKIES: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
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
    std::fs::write(&config_file, "[workspace]\nname = \"test-workspace\"\n").ok();

    let mut config = DamHopperConfig {
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
    // Runtime-enable tests must not race through the user's default telemetry
    // database when lib tests run concurrently.
    config.server.telemetry.db_path = tmp.path().join("telemetry.db").display().to_string();

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

fn resource_disk_alert(incident_id: &str) -> ResourceAlertSummary {
    ResourceAlertSummary {
        kind: ResourceAlertKind::Disk,
        key: "disk:/data".into(),
        state: ResourceAlertState::DiskFull,
        severity: AlertSeverity::Critical,
        incident_id: incident_id.into(),
        opened_at: 10,
        updated_at: 20,
        duration_seconds: 10,
        scope: "disk:/data".into(),
        evidence: ResourceAlertEvidence {
            temperature_source: None,
            temperature_label: None,
            temperature_celsius: None,
            disk_mount_point: Some("/data".into()),
            disk_name: Some("data".into()),
            disk_usage_percent: Some(95.0),
        },
        threshold: "usage>=95%".into(),
        next_action: "Free space.".into(),
    }
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
    let router = build_router(state);
    let req = Request::builder()
        .uri(path)
        .header("Cookie", auth_cookie())
        .body(Body::empty())
        .unwrap();
    router.oneshot(req).await.unwrap()
}

async fn get_without_auth(state: AppState, path: &str) -> axum::response::Response {
    let router = build_router(state);
    let req = Request::builder().uri(path).body(Body::empty()).unwrap();
    router.oneshot(req).await.unwrap()
}

async fn post_json(
    state: AppState,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let router = build_router(state);
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
    let router = build_router(state);
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
    let router = build_router(state);
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
    let router = build_router(state);
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
    let router = build_router(state);
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
    let router = build_router(state);
    let req = Request::builder()
        .uri("/api/health")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn backend_emits_no_cors_headers_or_preflight_behavior() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state);

    let origin_request = Request::builder()
        .uri("/api/health")
        .header("Origin", "https://other.example")
        .body(Body::empty())
        .unwrap();
    let origin_response = router.clone().oneshot(origin_request).await.unwrap();
    assert_eq!(origin_response.status(), StatusCode::OK);
    assert!(origin_response
        .headers()
        .keys()
        .all(|name| !name.as_str().starts_with("access-control-")));

    let preflight = Request::builder()
        .method("OPTIONS")
        .uri("/api/health")
        .header("Origin", "https://other.example")
        .header("Access-Control-Request-Method", "GET")
        .body(Body::empty())
        .unwrap();
    let preflight_response = router.oneshot(preflight).await.unwrap();
    assert_eq!(preflight_response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

#[tokio::test]
async fn protected_route_without_cookie_returns_401() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state);
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
    let router = build_router(state);
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
async fn host_action_capabilities_are_protected_and_fail_closed_without_reauth() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let unauthorized = get_without_auth(state.clone(), "/api/system/actions/v1/capabilities").await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let available = get(state, "/api/system/actions/v1/capabilities").await;
    assert_eq!(available.status(), StatusCode::OK);
    let body = axum::body::to_bytes(available.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["available"], false);
    assert_eq!(json["reason"], "reauthUnavailable");
}

#[tokio::test]
async fn host_action_cookie_mutations_require_a_same_origin_json_request() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state);
    let req = Request::builder()
        .method("POST")
        .uri("/api/system/actions/v1/intents")
        .header("Content-Type", "application/json")
        .header("Cookie", auth_cookie())
        .body(Body::from(
            serde_json::json!({
                "action": {"kind": "dropCleanCaches"},
                "sampleId": "sample"
            })
            .to_string(),
        ))
        .unwrap();
    let response = router.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
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
async fn legacy_metrics_remain_cached_when_deep_snapshot_is_unavailable() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let snapshot = get(state.clone(), "/api/system/resources/v1/snapshot").await;
    assert_eq!(snapshot.status(), StatusCode::OK);
    let snapshot = axum::body::to_bytes(snapshot.into_body(), usize::MAX)
        .await
        .unwrap();
    let snapshot: serde_json::Value = serde_json::from_slice(&snapshot).unwrap();
    assert_eq!(
        snapshot["capabilities"]["linuxDeepMetrics"]["state"],
        "temporarilyUnavailable"
    );

    let first = get(state.clone(), "/api/system/metrics").await;
    let second = get(state, "/api/system/metrics").await;
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(second.status(), StatusCode::OK);
    let first = axum::body::to_bytes(first.into_body(), usize::MAX)
        .await
        .unwrap();
    let second = axum::body::to_bytes(second.into_body(), usize::MAX)
        .await
        .unwrap();
    let first: serde_json::Value = serde_json::from_slice(&first).unwrap();
    let second: serde_json::Value = serde_json::from_slice(&second).unwrap();
    assert_eq!(
        first, second,
        "legacy endpoint must project the monitor cache"
    );
    assert!(first["cpu"]["usagePercent"].is_number());
    assert!(first["memory"]["availableBytes"].is_number());
    assert!(first["disk"]["usagePercent"].is_number());
}

#[tokio::test]
async fn package_router_serves_spa_without_masking_unknown_api_routes() {
    let tmp = tempfile::tempdir().unwrap();
    let web_dir = tempfile::tempdir().unwrap();
    std::fs::write(web_dir.path().join("index.html"), "<h1>DamHopper</h1>").unwrap();
    let router = build_router_with_web_dir(make_state(&tmp), web_dir.path().into());

    let index = router
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(index.status(), StatusCode::OK);
    let index = axum::body::to_bytes(index.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(index.as_ref(), b"<h1>DamHopper</h1>");

    for path in ["/api", "/api/", "/api/not-a-real-route"] {
        let api_miss = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(api_miss.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn resource_snapshot_and_alerts_are_protected_and_bounded() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    state
        .host_resource_monitor
        .seed_resource_alerts_for_test(
            vec![resource_disk_alert("host-resource-active")],
            vec![ResourceAlertIncident {
                summary: resource_disk_alert("host-resource-resolved"),
                resolved_at: Some(30),
            }],
        )
        .await;

    let unauthorized = get_without_auth(state.clone(), "/api/system/resources/v1/snapshot").await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let unauthorized_alerts =
        get_without_auth(state.clone(), "/api/system/resources/v1/alerts").await;
    assert_eq!(unauthorized_alerts.status(), StatusCode::UNAUTHORIZED);

    let snapshot = get(state.clone(), "/api/system/resources/v1/snapshot").await;
    assert_eq!(snapshot.status(), StatusCode::OK);
    let body = axum::body::to_bytes(snapshot.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(body.len() <= 256 * 1024);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert!(json["battery"].is_object());
    assert!(json["battery"]["count"].is_number());
    assert!(json["battery"]["availability"]["state"].is_string());
    assert!(json["battery"].get("remainingEnergyWh").is_some());
    assert!(json["battery"].get("instantaneousPowerW").is_some());
    assert!(json["alert"].is_object());
    assert_eq!(json["alert"]["scope"], "host");
    assert_eq!(
        json["currentAlerts"].as_array().map(|items| items.len()),
        Some(1)
    );
    let current = &json["currentAlerts"][0];
    assert_eq!(current["kind"], "disk");
    assert_eq!(current["key"], "disk:/data");
    assert_eq!(current["state"], "diskFull");
    assert_eq!(current["severity"], "critical");
    assert_eq!(current["incidentId"], "host-resource-active");
    assert_eq!(current["openedAt"], 10);
    assert_eq!(current["updatedAt"], 20);
    assert_eq!(current["durationSeconds"], 10);
    assert_eq!(current["scope"], "disk:/data");
    assert_eq!(
        current["evidence"],
        serde_json::json!({
            "diskMountPoint": "/data",
            "diskName": "data",
            "diskUsagePercent": 95.0,
        })
    );
    assert_eq!(current["threshold"], "usage>=95%");
    assert_eq!(current["nextAction"], "Free space.");
    assert!(current["resolvedAt"].is_null());

    let alerts = get(state, "/api/system/resources/v1/alerts?limit=999").await;
    assert_eq!(alerts.status(), StatusCode::OK);
    let body = axum::body::to_bytes(alerts.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let history = json.as_array().expect("alerts response is an array");
    assert!(history.len() <= 50);
    assert_eq!(history.len(), 1);
    let resolved = &history[0];
    assert_eq!(resolved["kind"], "disk");
    assert_eq!(resolved["state"], "diskFull");
    assert_eq!(resolved["severity"], "critical");
    assert_eq!(resolved["incidentId"], "host-resource-resolved");
    assert_eq!(resolved["openedAt"], 10);
    assert_eq!(resolved["updatedAt"], 20);
    assert_eq!(resolved["durationSeconds"], 10);
    assert_eq!(resolved["scope"], "disk:/data");
    assert_eq!(resolved["evidence"]["diskMountPoint"], "/data");
    assert_eq!(resolved["evidence"]["diskUsagePercent"], 95.0);
    assert_eq!(resolved["resolvedAt"], 30);
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
    let router = build_router(state);
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
    let router = build_router(state);
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
// Bearer token authentication
// ---------------------------------------------------------------------------

#[tokio::test]
async fn protected_route_with_bearer_token_returns_200() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let router = build_router(state);
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
    let router = build_router(state);
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
    let router = build_router(state);
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
    let router = build_router(state);
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

#[tokio::test]
async fn language_files_returns_normalized_contract_and_enforces_project_boundary() {
    let registry_tmp = tempfile::tempdir().unwrap();
    let projects_tmp = tempfile::tempdir().unwrap();
    let alpha = projects_tmp.path().join("alpha");
    let beta = projects_tmp.path().join("beta");
    std::fs::create_dir_all(alpha.join("src")).unwrap();
    std::fs::create_dir_all(&beta).unwrap();
    std::fs::write(alpha.join("src/main.RS"), "fn main() {}\n").unwrap();
    std::fs::write(alpha.join("notes.txt"), "not source\n").unwrap();

    let state = make_state_with_project_roots(
        &registry_tmp,
        vec![("alpha", alpha.as_path()), ("beta", beta.as_path())],
    );

    let response = get(state.clone(), "/api/fs/language-files?project=alpha").await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["limit"], crate::fs::ops::MAX_LANGUAGE_SCAN_FILES);
    assert_eq!(json["truncated"], false);
    assert_eq!(json["files"].as_array().unwrap().len(), 1);
    assert_eq!(json["files"][0]["path"], "src/main.RS");
    assert_eq!(json["files"][0]["language"], "rust");
    assert!(json["files"][0]["size"].is_u64());
    assert!(json["files"][0]["mtime"].is_i64());
    assert!(!bytes
        .windows(alpha.to_string_lossy().len())
        .any(|window| { window == alpha.to_string_lossy().as_bytes() }));

    let empty = get(state.clone(), "/api/fs/language-files?project=beta").await;
    assert_eq!(empty.status(), StatusCode::OK);
    let empty_json: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(empty.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(empty_json["files"], serde_json::json!([]));

    let missing = get(state.clone(), "/api/fs/language-files?project=missing").await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let malformed = get(state.clone(), "/api/fs/language-files").await;
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
    let unauthenticated = get_without_auth(state, "/api/fs/language-files?project=alpha").await;
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
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
    assert!(value["codex"].is_null());
    assert!(!value.as_object().unwrap().contains_key("terminal"));
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
async fn usage_summary_rejects_removed_filters_and_injection_like_keys() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);

    let unknown = get(state.clone(), "/api/usage/summary?project=missing").await;
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    let injection = get(state, "/api/usage/summary?category=x%27%20OR%201%3D1").await;
    assert_eq!(injection.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn usage_summary_rejects_ranges_that_fill_over_1000_buckets() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);

    let response = get(state, "/api/usage/summary?from=0&to=86400000001&bucket=day").await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn usage_summary_returns_filled_codex_series_without_event_fields() {
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
            .filter_map(|bucket| bucket["codex"]["responseCount"].as_u64())
            .sum::<u64>(),
        2
    );
    assert!(!value.as_object().unwrap().contains_key("terminal"));
    assert!(!value.as_object().unwrap().contains_key("detailMetrics"));
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(!text.contains("fingerprint"));
    assert!(!text.contains("git status"));
}

#[tokio::test]
async fn usage_sessions_are_protected_reconcile_and_exclude_private_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let timestamp = i64::try_from(now_ms()).unwrap().saturating_sub(1_000);
    let session_id = write_usage_session(
        &state,
        b"raw-provider-session",
        Some("test-project"),
        timestamp,
        [Some(11), Some(13), Some(17), Some(19)],
    );

    let unauthorized = get_without_auth(state.clone(), "/api/usage/sessions").await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    state.telemetry.read().unwrap().control.set_enabled(false);
    let list = get(
        state.clone(),
        &format!(
            "/api/usage/sessions?from={}&to={}",
            timestamp - 1,
            timestamp + 1
        ),
    )
    .await;
    assert_eq!(list.status(), StatusCode::OK);
    let list_body = axum::body::to_bytes(list.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_value: serde_json::Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_value["paused"], true);
    assert_eq!(list_value["sessions"][0]["id"], session_id);
    assert_eq!(list_value["sessions"][0]["model"], "gpt-5.6-sol");
    assert_eq!(list_value["sessions"][0]["tokens"]["responseCount"], 1);
    assert_eq!(
        list_value["sessions"][0]["models"][0]["model"],
        "gpt-5.6-sol"
    );
    assert_eq!(list_value["sessions"][0]["models"][0]["responseCount"], 1);
    assert!(!list_value["sessions"][0]
        .as_object()
        .unwrap()
        .contains_key("terminals"));
    assert!(!list_value["sessions"][0]
        .as_object()
        .unwrap()
        .contains_key("lineage"));
    let serialized = String::from_utf8(list_body.to_vec()).unwrap();
    for forbidden in [
        "raw-provider-session",
        "provider",
        "sourceVersion",
        "fingerprint",
        "counterSemantic",
        "status",
        "command",
        "prompt",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "response leaked {forbidden}"
        );
    }

    let detail = get(state.clone(), &format!("/api/usage/sessions/{session_id}")).await;
    assert_eq!(detail.status(), StatusCode::OK);
    let detail_body = axum::body::to_bytes(detail.into_body(), usize::MAX)
        .await
        .unwrap();
    let detail_value: serde_json::Value = serde_json::from_slice(&detail_body).unwrap();
    assert_eq!(detail_value["session"]["id"], session_id);
    assert_eq!(detail_value["session"]["model"], "gpt-5.6-sol");
    assert!(!detail_value.as_object().unwrap().contains_key("nodes"));
    let detail_serialized = String::from_utf8(detail_body.to_vec()).unwrap();
    for forbidden in [
        "provider",
        "sourceVersion",
        "fingerprint",
        "command",
        "prompt",
    ] {
        assert!(
            !detail_serialized.contains(forbidden),
            "detail response leaked {forbidden}"
        );
    }

    let summary = get(state, "/api/usage/summary?window=24h").await;
    assert_eq!(summary.status(), StatusCode::OK);
    let summary_body = axum::body::to_bytes(summary.into_body(), usize::MAX)
        .await
        .unwrap();
    let summary_value: serde_json::Value = serde_json::from_slice(&summary_body).unwrap();
    assert_eq!(list_value["sessions"][0]["tokens"], summary_value["codex"]);
}

#[tokio::test]
async fn usage_session_cursor_preserves_active_null_end() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let store = state
        .telemetry
        .read()
        .unwrap()
        .store
        .as_ref()
        .unwrap()
        .clone();
    let timestamp = i64::try_from(now_ms()).unwrap().saturating_sub(1_000);
    let mut connection = rusqlite::Connection::open(store.path_for_tests()).unwrap();
    let transaction = connection.transaction().unwrap();
    for (id, started_at, ended_at) in [
        ("c".repeat(64), timestamp + 2, Some(timestamp + 2)),
        ("b".repeat(64), timestamp + 1, None),
        ("a".repeat(64), timestamp, Some(timestamp)),
    ] {
        transaction
            .execute(
                "INSERT INTO codex_sessions(session_fingerprint, model, source_version, source_quality, started_at_utc_ms, ended_at_utc_ms, status, counter_semantic, token_quality, response_count, duration_ms_sum, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, updated_at_utc_ms) VALUES (?1, 'gpt-5.6-sol', '0.146.0', 'verified', ?2, ?3, 'completed', 'delta', 'exact', 0, NULL, NULL, NULL, NULL, NULL, ?2)",
                rusqlite::params![id, started_at, ended_at],
            )
            .unwrap();
    }
    transaction.commit().unwrap();

    let first = get(
        state.clone(),
        &format!(
            "/api/usage/sessions?from={}&to={}&limit=2",
            timestamp - 1,
            timestamp + 3
        ),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = axum::body::to_bytes(first.into_body(), usize::MAX)
        .await
        .unwrap();
    let first_value: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let first_sessions = first_value["sessions"].as_array().unwrap();
    assert_eq!(first_sessions.len(), 2);
    assert_eq!(first_sessions[1]["id"], "b".repeat(64));
    assert!(first_sessions[1]
        .as_object()
        .unwrap()
        .contains_key("endedAtUtcMs"));
    assert!(first_sessions[1]["endedAtUtcMs"].is_null());
    let cursor = first_value["nextCursor"].as_str().unwrap();

    let second = get(
        state,
        &format!(
            "/api/usage/sessions?from={}&to={}&limit=2&cursor={cursor}",
            timestamp - 1,
            timestamp + 3
        ),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = axum::body::to_bytes(second.into_body(), usize::MAX)
        .await
        .unwrap();
    let second_value: serde_json::Value = serde_json::from_slice(&second_body).unwrap();
    assert_eq!(second_value["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(second_value["sessions"][0]["id"], "a".repeat(64));
    assert!(second_value["nextCursor"].is_null());
}

#[tokio::test]
async fn usage_session_cursor_bounds_and_ids_are_strict() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let timestamp = i64::try_from(now_ms()).unwrap().saturating_sub(10_000);
    for (offset, conversation) in [b"session-a", b"session-b", b"session-c"]
        .into_iter()
        .enumerate()
    {
        write_usage_session(
            &state,
            conversation,
            None,
            timestamp + offset as i64,
            [Some(1), Some(2), Some(3), Some(4)],
        );
    }

    let first = get(
        state.clone(),
        &format!(
            "/api/usage/sessions?from={}&to={}&limit=2",
            timestamp - 1,
            timestamp + 10
        ),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = axum::body::to_bytes(first.into_body(), usize::MAX)
        .await
        .unwrap();
    let first_value: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let first_ids = first_value["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|session| session["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    let cursor = first_value["nextCursor"].as_str().unwrap();
    let second = get(
        state.clone(),
        &format!(
            "/api/usage/sessions?from={}&to={}&limit=2&cursor={cursor}",
            timestamp - 1,
            timestamp + 10
        ),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = axum::body::to_bytes(second.into_body(), usize::MAX)
        .await
        .unwrap();
    let second_value: serde_json::Value = serde_json::from_slice(&second_body).unwrap();
    assert_eq!(second_value["sessions"].as_array().unwrap().len(), 1);
    assert!(!first_ids.contains(
        &second_value["sessions"][0]["id"]
            .as_str()
            .unwrap()
            .to_string()
    ));
    let changed_scope = get(
        state.clone(),
        &format!(
            "/api/usage/sessions?from={}&to={}&limit=2&cursor={cursor}",
            timestamp,
            timestamp + 10
        ),
    )
    .await;
    assert_eq!(changed_scope.status(), StatusCode::BAD_REQUEST);

    let default_first = get(state.clone(), "/api/usage/sessions?limit=2").await;
    assert_eq!(default_first.status(), StatusCode::OK);
    let default_first_body = axum::body::to_bytes(default_first.into_body(), usize::MAX)
        .await
        .unwrap();
    let default_first_value: serde_json::Value =
        serde_json::from_slice(&default_first_body).unwrap();
    let default_cursor = default_first_value["nextCursor"].as_str().unwrap();
    tokio::time::sleep(Duration::from_millis(2)).await;
    let default_second = get(
        state.clone(),
        &format!("/api/usage/sessions?limit=2&cursor={default_cursor}"),
    )
    .await;
    assert_eq!(default_second.status(), StatusCode::OK);
    let default_second_body = axum::body::to_bytes(default_second.into_body(), usize::MAX)
        .await
        .unwrap();
    let default_second_value: serde_json::Value =
        serde_json::from_slice(&default_second_body).unwrap();
    assert_eq!(default_second_value["range"], default_first_value["range"]);

    for path in [
        "/api/usage/sessions?limit=0",
        "/api/usage/sessions?limit=101",
        "/api/usage/sessions?cursor=not-base64!",
        "/api/usage/sessions?model=https%3A%2F%2Fsecret",
        "/api/usage/sessions?terminal=short",
        "/api/usage/sessions?from=20&to=10",
        "/api/usage/sessions/not-a-derived-id",
    ] {
        assert_eq!(
            get(state.clone(), path).await.status(),
            StatusCode::BAD_REQUEST
        );
    }
    let missing_id = "0".repeat(64);
    assert_eq!(
        get(state, &format!("/api/usage/sessions/{missing_id}"))
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn usage_session_detail_stays_bounded_for_large_codex_store() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let store = state
        .telemetry
        .read()
        .unwrap()
        .store
        .as_ref()
        .unwrap()
        .clone();
    let timestamp = i64::try_from(now_ms()).unwrap().saturating_sub(1_000);
    let root_id = "c".repeat(64);
    let mut connection = rusqlite::Connection::open(store.path_for_tests()).unwrap();
    let transaction = connection.transaction().unwrap();
    transaction
        .execute(
            "INSERT INTO codex_sessions(session_fingerprint, model, source_version, source_quality, started_at_utc_ms, ended_at_utc_ms, status, counter_semantic, token_quality, response_count, duration_ms_sum, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, updated_at_utc_ms) VALUES (?1, 'gpt-5.6-sol', '0.146.0', 'verified', ?2, ?2, 'completed', 'delta', 'exact', 1, 1, 1, 1, 1, 1, ?2)",
            rusqlite::params![root_id, timestamp],
        )
        .unwrap();
    {
        let mut insert = transaction
            .prepare("INSERT INTO codex_sessions(session_fingerprint, model, source_version, source_quality, started_at_utc_ms, ended_at_utc_ms, status, counter_semantic, token_quality, response_count, duration_ms_sum, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, updated_at_utc_ms) VALUES (?1, 'gpt-5.6-terra', '0.146.0', 'verified', ?2, ?2, 'completed', 'delta', 'exact', 1, 1, 1, 1, 1, 1, ?2)")
            .unwrap();
        // Codex sessions are flat. A large unrelated store proves detail lookup
        // remains bounded without reconstructing a terminal or agent tree.
        for index in 1..=100_000_u64 {
            insert
                .execute(rusqlite::params![
                    format!("d{index:063x}"),
                    timestamp + index as i64
                ])
                .unwrap();
        }
    }
    transaction.commit().unwrap();

    let plan = connection
        .prepare(
            "EXPLAIN QUERY PLAN SELECT session_fingerprint FROM codex_sessions WHERE session_fingerprint = ?1",
        )
        .unwrap()
        .query_map(rusqlite::params![root_id], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join(" ");
    assert!(
        plan.contains("codex_sessions") && plan.contains("INDEX"),
        "query plan: {plan}"
    );

    let root_digest: crate::telemetry::privacy::HmacDigest = root_id.clone().try_into().unwrap();
    let request = format!("/api/usage/sessions/{}", String::from(root_digest));
    const SAMPLE_COUNT: usize = 5;
    let mut durations = Vec::with_capacity(SAMPLE_COUNT);
    let mut response_body = None;
    for _ in 0..SAMPLE_COUNT {
        let started = Instant::now();
        let response = get(state.clone(), &request).await;
        assert_eq!(response.status(), StatusCode::OK);
        response_body = Some(
            axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        );
        durations.push(started.elapsed());
    }
    durations.sort_unstable();
    eprintln!(
        "large Codex-store detail API max: {:?}",
        durations[SAMPLE_COUNT - 1]
    );
    assert!(
        durations[SAMPLE_COUNT - 1] < Duration::from_millis(200),
        "large Codex-store detail API exceeded its work budget: {durations:?}"
    );
    let response: serde_json::Value = serde_json::from_slice(&response_body.unwrap()).unwrap();
    assert_eq!(response["session"]["id"], root_id);
    assert_eq!(response["session"]["model"], "gpt-5.6-sol");
    assert!(!response.as_object().unwrap().contains_key("nodes"));
    assert!(!response.as_object().unwrap().contains_key("truncated"));
}

#[tokio::test]
async fn usage_session_detail_is_flat_and_caps_model_summaries() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let store = state
        .telemetry
        .read()
        .unwrap()
        .store
        .as_ref()
        .unwrap()
        .clone();
    let timestamp = i64::try_from(now_ms()).unwrap().saturating_sub(1_000);
    let root_id = "a".repeat(64);
    let telemetry = state.telemetry.read().unwrap().clone();
    let keys = telemetry.hmac_keys.as_ref().unwrap();
    let session_id: crate::telemetry::privacy::HmacDigest = root_id.clone().try_into().unwrap();
    let mut events = Vec::with_capacity(301);
    for index in 0..301_u64 {
        let index_bytes = index.to_be_bytes();
        events.push(TelemetryCmd::CodexUsage(CodexUsageEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: keys.digest(b"codex-detail-event", &[&index_bytes]),
            occurred_at_utc_ms: timestamp + index as i64,
            session_fingerprint: Some(session_id.clone()),
            model: Some(CodexModel::new(format!("model-{index}")).unwrap()),
            source_version: CodexVersion::new("0.146.0").unwrap(),
            source_quality: SourceQuality::Verified,
            status: SafeIdentifier::new("completed").unwrap(),
            counter_semantic: TokenCounterSemantic::Delta,
            duration_ms: Some(1),
            token_quality: TokenQuality::Exact,
            input_tokens: Some(1),
            cached_input_tokens: Some(1),
            output_tokens: Some(1),
            reasoning_tokens: Some(1),
        }));
    }
    store.write_batch(events).unwrap();

    let response = get(state.clone(), &format!("/api/usage/sessions/{root_id}")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(!value.as_object().unwrap().contains_key("nodes"));
    assert!(!value.as_object().unwrap().contains_key("truncated"));
    assert_eq!(value["session"]["tokens"]["inputTokens"], 301);
    assert_eq!(value["session"]["tokens"]["responseCount"], 301);
    let models = value["session"]["models"].as_array().unwrap();
    assert_eq!(models.len(), 32);
    assert_eq!(models[0]["model"], "model-0");
    assert_eq!(models[31]["model"], "model-126");
    let filtered = get(
        state,
        &format!(
            "/api/usage/sessions?from={}&to={}",
            timestamp - 1,
            timestamp + 400
        ),
    )
    .await;
    assert_eq!(filtered.status(), StatusCode::OK);
    let filtered_body = axum::body::to_bytes(filtered.into_body(), usize::MAX)
        .await
        .unwrap();
    let filtered_value: serde_json::Value = serde_json::from_slice(&filtered_body).unwrap();
    assert_eq!(filtered_value["sessions"].as_array().unwrap().len(), 1);
    assert!(!filtered_value["sessions"][0]
        .as_object()
        .unwrap()
        .contains_key("terminals"));
}

#[tokio::test]
async fn usage_session_api_lists_100k_codex_sessions_under_200ms() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let store = state
        .telemetry
        .read()
        .unwrap()
        .store
        .as_ref()
        .unwrap()
        .clone();
    let timestamp = i64::try_from(now_ms()).unwrap().saturating_sub(1_000);
    let mut connection = rusqlite::Connection::open(store.path_for_tests()).unwrap();
    let transaction = connection.transaction().unwrap();
    {
        let mut insert = transaction
            .prepare("INSERT INTO codex_sessions(session_fingerprint, model, source_version, source_quality, started_at_utc_ms, ended_at_utc_ms, status, counter_semantic, token_quality, response_count, duration_ms_sum, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, updated_at_utc_ms) VALUES (?1, 'gpt-5.6-sol', '0.146.0', 'verified', ?2, ?2, 'completed', 'delta', 'exact', 1, 4, 1, 2, 3, 4, ?2)")
            .unwrap();
        for index in 0..100_000_u64 {
            insert
                .execute(rusqlite::params![format!("{index:064x}"), timestamp])
                .unwrap();
        }
    }
    transaction.commit().unwrap();

    let request = format!(
        "/api/usage/sessions?from={}&to={}&limit=100",
        timestamp - 1,
        timestamp + 1
    );
    let mut durations = Vec::new();
    for _ in 0..5 {
        let started = std::time::Instant::now();
        let response = get(state.clone(), &request).await;
        assert_eq!(response.status(), StatusCode::OK);
        durations.push(started.elapsed());
    }
    durations.sort_unstable();
    eprintln!("100k root-list API p95: {:?}", durations[4]);
    assert!(
        durations[4] < Duration::from_millis(200),
        "100k root-list API p95 took {:?}; durations: {durations:?}",
        durations[4]
    );
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
            "paused": true
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
async fn usage_delete_all_removes_summaries_before_rotating_hmac_key() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let telemetry = state.telemetry.read().unwrap().clone();
    let keys = telemetry.hmac_keys.as_ref().unwrap();
    let before = keys.digest(b"rotation-proof", &[b"stable"]);
    let event = CodexUsageEvent {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        id: keys.digest(b"event", &[b"delete-all"]),
        occurred_at_utc_ms: 10,
        session_fingerprint: Some(keys.digest(b"codex-conversation:v1", &[b"delete-all"])),
        model: Some(CodexModel::new("gpt-5.6-sol").unwrap()),
        source_version: CodexVersion::new("0.146.0").unwrap(),
        source_quality: SourceQuality::Verified,
        status: SafeIdentifier::new("completed").unwrap(),
        counter_semantic: TokenCounterSemantic::Delta,
        duration_ms: None,
        token_quality: TokenQuality::Exact,
        input_tokens: Some(2),
        cached_input_tokens: Some(3),
        output_tokens: Some(5),
        reasoning_tokens: Some(7),
    };
    let store = telemetry.store.as_ref().unwrap();
    store
        .write_batch(vec![TelemetryCmd::CodexUsage(event)])
        .unwrap();
    assert_eq!(
        store
            .open_read()
            .unwrap()
            .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );

    let deleted = delete_json(
        state,
        "/api/usage",
        serde_json::json!({"confirmation": "delete-usage-data"}),
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::OK);
    let connection = store.open_read().unwrap();
    for table in [
        "codex_usage_events",
        "codex_sessions",
        "codex_daily_rollups",
        "telemetry_health",
    ] {
        let count = connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table} must be empty before successful response");
    }
    assert_ne!(keys.digest(b"rotation-proof", &[b"stable"]), before);
}

#[tokio::test]
async fn usage_delete_all_restores_capture_when_hmac_rotation_fails() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let telemetry = state.telemetry.read().unwrap().clone();
    let store = telemetry.store.as_ref().unwrap();
    store.increment_health("delete-proof", 1, 10).unwrap();

    let key_path = tmp.path().join("telemetry-key");
    std::fs::remove_file(&key_path).unwrap();
    std::fs::create_dir(&key_path).unwrap();
    let response = delete_json(
        state,
        "/api/usage",
        serde_json::json!({"confirmation": "delete-usage-data"}),
    )
    .await;

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(telemetry.control.is_enabled());
    assert_eq!(
        store
            .open_read()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_health", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0,
        "deletion must commit before the forced rotation failure"
    );
}

#[tokio::test]
async fn usage_delete_all_preserves_disabled_unpaused_admission_state() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    activate_telemetry(&state, &tmp);
    let telemetry = state.telemetry.read().unwrap().clone();
    telemetry.control.set_enabled(false);
    assert!(!state.config.read().await.server.telemetry.paused);

    let response = delete_json(
        state,
        "/api/usage",
        serde_json::json!({"confirmation": "delete-usage-data"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!telemetry.control.is_enabled());
}

#[tokio::test]
async fn usage_delete_rejects_unknown_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let response = delete_json(
        state,
        "/api/usage",
        serde_json::json!({
            "confirmation": "delete-usage-data",
            "terminal": "legacy"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn usage_settings_reject_removed_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let correlation = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"terminalCorrelationEnabled": true}),
    )
    .await;
    assert_eq!(correlation.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let projects = patch_json(
        state,
        "/api/usage/settings",
        serde_json::json!({"excludedProjects": ["private"]}),
    )
    .await;
    assert_eq!(projects.status(), StatusCode::UNPROCESSABLE_ENTITY);
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
async fn usage_health_requires_auth_and_exposes_only_numeric_drop_counters() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);

    let unauthorized = get_without_auth(state.clone(), "/api/usage/health").await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

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
            "collector": {"enabled": true, "host": "127.0.0.1", "port": port}
        }),
    )
    .await;
    assert_eq!(enabled.status(), StatusCode::OK);
    let token = std::fs::read_to_string(tmp.path().join("collector-token")).unwrap();
    let ingest = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/v1/logs"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/x-protobuf")
        .body(
            include_bytes!(
                "../telemetry/codex_otlp/fixtures/codex-cli-0.146.1-response-completed.bin"
            )
            .to_vec(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(ingest.status(), reqwest::StatusCode::ACCEPTED);

    let response = get(state.clone(), "/api/usage/health").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let text = String::from_utf8(body.to_vec()).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    let collector = &value["collector"];
    for field in [
        "droppedMissingIdentity",
        "droppedInvalidTimestamp",
        "droppedPaused",
        "droppedQueueFull",
        "droppedWorkerUnavailable",
    ] {
        assert!(collector[field].is_u64(), "{field} must be numeric");
    }
    assert_eq!(collector["queued"], 1);
    assert_eq!(collector["unverifiedVersion"], 1);
    assert_eq!(collector["dropped"], 0);
    assert_eq!(collector["droppedMissingIdentity"], 0);
    assert_eq!(collector["droppedInvalidTimestamp"], 0);
    assert_eq!(collector["droppedPaused"], 0);
    assert_eq!(collector["droppedQueueFull"], 0);
    assert_eq!(collector["droppedWorkerUnavailable"], 0);
    for forbidden in [
        "authorization",
        "Bearer",
        "prompt",
        "response",
        "tool.content",
        "0.146.1",
        "\"version\"",
        "\"identity\"",
    ] {
        assert!(!text.contains(forbidden), "health leaked {forbidden}");
    }
    assert!(!text.contains(&token));
    state.telemetry_runtime.shutdown().await;
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
async fn usage_settings_retry_collector_failure_restores_previous_runtime_and_config_state() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let enabled = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({
            "enabled": true,
            "collector": {"enabled": true, "host": "127.0.0.1", "port": port}
        }),
    )
    .await;
    assert_eq!(enabled.status(), StatusCode::OK);

    let previous_config = state.config.read().await.server.telemetry.clone();
    let previous_file = std::fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap();
    let previous_runtime = state.telemetry_runtime.status();
    assert!(previous_runtime.active);
    assert!(!previous_runtime.collector.running);
    assert!(state.telemetry.read().unwrap().control.is_enabled());

    let retry = patch_json(
        state.clone(),
        "/api/usage/settings",
        serde_json::json!({"paused": true, "retryCollector": true}),
    )
    .await;
    assert_eq!(retry.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(state.config.read().await.server.telemetry, previous_config);
    assert_eq!(
        std::fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap(),
        previous_file
    );
    let restored_runtime = state.telemetry_runtime.status();
    assert!(restored_runtime.active);
    assert!(!restored_runtime.collector.running);
    assert_eq!(
        restored_runtime.collector_error,
        previous_runtime.collector_error
    );
    assert!(state.telemetry.read().unwrap().control.is_enabled());

    drop(listener);
    state.telemetry_runtime.shutdown().await;
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
    let control = Arc::new(TelemetryControl::new(true));
    let keys =
        Arc::new(TelemetryKeyRing::load_or_create(tmp.path().join("telemetry-key")).unwrap());
    state.set_telemetry(TelemetryHandle::active(control, store, None).with_hmac_keys(keys));
}

fn write_usage_session(
    state: &AppState,
    conversation: &[u8],
    _project: Option<&str>,
    timestamp: i64,
    tokens: [Option<u64>; 4],
) -> String {
    let telemetry = state.telemetry.read().unwrap().clone();
    let keys = telemetry.hmac_keys.as_ref().unwrap();
    let session_id = keys.digest(b"codex-conversation:v1", &[conversation]);
    let timestamp_bytes = timestamp.to_be_bytes();
    let event_id = keys.digest(b"codex-usage:v1", &[conversation, &timestamp_bytes]);
    let token_quality = match tokens.iter().filter(|value| value.is_some()).count() {
        0 => TokenQuality::Unavailable,
        4 => TokenQuality::Exact,
        _ => TokenQuality::Partial,
    };
    telemetry
        .store
        .as_ref()
        .unwrap()
        .write_batch(vec![TelemetryCmd::CodexUsage(CodexUsageEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: event_id,
            occurred_at_utc_ms: timestamp,
            session_fingerprint: Some(session_id.clone()),
            model: Some(CodexModel::new("gpt-5.6-sol").unwrap()),
            source_version: CodexVersion::new("0.146.0").unwrap(),
            source_quality: SourceQuality::Verified,
            status: SafeIdentifier::new("completed").unwrap(),
            counter_semantic: TokenCounterSemantic::Delta,
            duration_ms: None,
            token_quality,
            input_tokens: tokens[0],
            cached_input_tokens: tokens[1],
            output_tokens: tokens[2],
            reasoning_tokens: tokens[3],
        })])
        .unwrap();
    String::from(session_id)
}

fn write_usage_command(
    state: &AppState,
    _tmp: &TempDir,
    timestamp: i64,
    sequence: u64,
    _command: &str,
    duration_ms: u64,
) {
    let telemetry = state.telemetry.read().unwrap().clone();
    let keys = telemetry.hmac_keys.as_ref().unwrap();
    let timestamp_bytes = timestamp.to_be_bytes();
    let sequence_bytes = sequence.to_be_bytes();
    telemetry
        .store
        .as_ref()
        .unwrap()
        .write_batch(vec![TelemetryCmd::CodexUsage(CodexUsageEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: keys.digest(b"codex-usage:v1", &[&timestamp_bytes, &sequence_bytes]),
            occurred_at_utc_ms: timestamp,
            session_fingerprint: None,
            model: Some(CodexModel::new("gpt-5.6-sol").unwrap()),
            source_version: CodexVersion::new("0.146.0").unwrap(),
            source_quality: SourceQuality::Verified,
            status: SafeIdentifier::new("completed").unwrap(),
            counter_semantic: TokenCounterSemantic::Delta,
            duration_ms: Some(duration_ms),
            token_quality: TokenQuality::Exact,
            input_tokens: Some(1),
            cached_input_tokens: Some(1),
            output_tokens: Some(1),
            reasoning_tokens: Some(1),
        })])
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

#[test]
fn merge_global_ui_config_rejects_invalid_explorer_language_filter() {
    let err = crate::api::config::merge_global_ui_config(
        Some(crate::config::schema::UiConfig::default()),
        &serde_json::json!({
            "explorerLanguageFilter": "python",
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
async fn terminal_create_preserves_explicit_otel_attributes_without_usage_work() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_state(&tmp);
    let response = post_json(
        state.clone(),
        "/api/terminal",
        serde_json::json!({
            "id": "terminal:otel-conflict",
            "command": "printf '%s\\n' \"$OTEL_RESOURCE_ATTRIBUTES\"; sleep 2",
            "cwd": tmp.path().to_str().unwrap(),
            "env": {"OTEL_RESOURCE_ATTRIBUTES": "user.attribute=preserved"}
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(wait_for(Duration::from_secs(3), || {
        state
            .pty_manager
            .get_buffer("terminal:otel-conflict")
            .is_ok_and(|buffer| buffer.contains("user.attribute=preserved"))
    }));
    assert!(!state
        .pty_manager
        .get_buffer("terminal:otel-conflict")
        .unwrap()
        .contains("dam_hopper.run_id="));
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
    let router = build_router(state);
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

// ---------------------------------------------------------------------------
// Purpose-bound video ticket API
// ---------------------------------------------------------------------------

#[tokio::test]
async fn video_tickets_are_opaque_purpose_bound_and_independently_revocable() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("clip.WEBM"),
        b"not media, only metadata is needed",
    )
    .unwrap();
    let state = make_state_with_project(&tmp);

    let playback = post_json(
        state.clone(),
        "/api/fs/video/tickets",
        serde_json::json!({
            "project": "test-project",
            "path": "clip.WEBM",
            "purpose": "playback"
        }),
    )
    .await;
    assert_eq!(playback.status(), StatusCode::CREATED);
    assert_eq!(playback.headers()["cache-control"], "no-store");
    let playback: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(playback.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let playback_ticket = playback["ticket"].as_str().unwrap().to_owned();
    assert_eq!(playback["purpose"], "playback");
    assert_eq!(playback["authorizationMode"], "session-cookie-v1");
    assert_eq!(
        playback["streamPath"],
        format!("/api/fs/video/stream/{playback_ticket}")
    );
    assert!(!playback.to_string().contains("test-project"));
    assert!(!playback.to_string().contains("clip.WEBM"));

    let download = post_json(
        state.clone(),
        "/api/fs/video/tickets",
        serde_json::json!({
            "project": "test-project",
            "path": "clip.WEBM",
            "purpose": "download"
        }),
    )
    .await;
    assert_eq!(download.status(), StatusCode::CREATED);
    let download: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(download.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let download_ticket = download["ticket"].as_str().unwrap();
    assert_ne!(playback_ticket, download_ticket);
    assert_eq!(download["purpose"], "download");
    assert_eq!(download["authorizationMode"], "session-cookie-v1");

    let revoked = delete_json(
        state.clone(),
        "/api/fs/video/tickets",
        serde_json::json!({ "ticket": playback_ticket }),
    )
    .await;
    assert_eq!(revoked.status(), StatusCode::NO_CONTENT);
    // Scoped revoke requires the issuing session cookie; a guessed ticket alone is inert.

    let revoked_again = delete_json(
        state,
        "/api/fs/video/tickets",
        serde_json::json!({ "ticket": playback_ticket }),
    )
    .await;
    assert_eq!(revoked_again.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn video_ticket_issuance_requires_auth_and_rejects_non_video_or_unsafe_paths() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("document.txt"), "text").unwrap();
    std::fs::create_dir(tmp.path().join("folder.mov")).unwrap();
    let state = make_state_with_project(&tmp);
    let body = serde_json::json!({
        "project": "test-project",
        "path": "document.txt",
        "purpose": "playback"
    });

    assert_eq!(
        post_json_without_auth(state.clone(), "/api/fs/video/tickets", body.clone())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post_json(state.clone(), "/api/fs/video/tickets", body)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post_json(
            state.clone(),
            "/api/fs/video/tickets",
            serde_json::json!({
                "project": "test-project",
                "path": "folder.mov",
                "purpose": "download"
            }),
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        post_json(
            state.clone(),
            "/api/fs/video/tickets",
            serde_json::json!({
                "project": "test-project",
                "path": "../escape.webm",
                "purpose": "playback"
            }),
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post_json(
            state,
            "/api/fs/video/tickets",
            serde_json::json!({
                "project": "test-project",
                "path": "document.txt",
                "purpose": "preview"
            }),
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn video_ticket_capacity_returns_retryable_structured_error() {
    let tmp = tempfile::tempdir().unwrap();
    let video = tmp.path().join("clip.webm");
    std::fs::write(&video, b"metadata-only").unwrap();
    let state = make_state_with_project(&tmp);
    let canonical = std::fs::canonicalize(&video).unwrap();
    let metadata = std::fs::metadata(&canonical).unwrap();

    for _ in 0..crate::fs::video_ticket::MAX_VIDEO_TICKETS {
        let record = crate::fs::VideoTicketRecord {
            purpose: crate::fs::VideoTicketPurpose::Playback,
            project: "test-project".into(),
            project_relative_path: "clip.webm".into(),
            file: crate::fs::VideoFileVersion::from_metadata(canonical.clone(), &metadata).unwrap(),
            mime: "video/webm".into(),
            filename: "clip.webm".into(),
        };
        assert!(matches!(
            state
                .video_stream_tickets
                .issue(state.video_stream_tickets.generation(), record),
            crate::fs::video_ticket::VideoTicketIssue::Issued(_)
        ));
    }

    let response = post_json(
        state,
        "/api/fs/video/tickets",
        serde_json::json!({
            "project": "test-project",
            "path": "clip.webm",
            "purpose": "download"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()["retry-after"], "1");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "VIDEO_TICKET_CAPACITY");
}

#[tokio::test]
async fn workspace_reinitialization_revokes_every_media_ticket() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"metadata-only").unwrap();
    std::fs::write(tmp.path().join("cover.png"), b"metadata-only").unwrap();
    let state = make_state_with_project(&tmp);
    let issued = post_json(
        state.clone(),
        "/api/fs/video/tickets",
        serde_json::json!({
            "project": "test-project",
            "path": "clip.webm",
            "purpose": "playback"
        }),
    )
    .await;
    let issued: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(issued.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let ticket = issued["ticket"].as_str().unwrap().to_owned();
    let image_ticket = issue_image_stream_ticket(state.clone(), "cover.png").await;

    let reinitialized = super::workspace::init_workspace(
        axum::extract::State(state.clone()),
        axum::Json(super::workspace::PathBody {
            path: tmp.path().display().to_string(),
        }),
    )
    .await;
    assert!(reinitialized.is_ok());

    assert!(state
        .video_stream_tickets
        .lookup_and_touch(&ticket)
        .is_none());
    assert!(state
        .image_stream_tickets
        .lookup_and_touch(&image_ticket)
        .is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn video_ticket_issuance_rejects_fifo_before_opening_it() {
    let tmp = tempfile::tempdir().unwrap();
    let fifo = tmp.path().join("trap.mp4");
    let status = Command::new("mkfifo").arg(&fifo).status().unwrap();
    assert!(status.success());
    let state = make_state_with_project(&tmp);

    let response = post_json(
        state,
        "/api/fs/video/tickets",
        serde_json::json!({
            "project": "test-project",
            "path": "trap.mp4",
            "purpose": "playback"
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

async fn issue_video_stream_ticket(state: AppState, path: &str, purpose: &str) -> String {
    let response = post_json(
        state,
        "/api/fs/video/tickets",
        serde_json::json!({
            "project": "test-project",
            "path": path,
            "purpose": purpose,
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let cookie = response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let ticket = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["ticket"]
        .as_str()
        .unwrap()
        .to_owned();
    MEDIA_COOKIES.lock().unwrap().insert(ticket.clone(), cookie);
    ticket
}

async fn stream_video(
    state: AppState,
    ticket: &str,
    method: &str,
    headers: &[(&str, &str)],
) -> axum::response::Response {
    let router = build_router(state);
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/api/fs/video/stream/{ticket}"))
        .body(Body::empty())
        .unwrap();
    for (name, value) in headers {
        request.headers_mut().append(
            name.parse::<axum::http::HeaderName>().unwrap(),
            value.parse().unwrap(),
        );
    }
    if let Some(cookie) = MEDIA_COOKIES.lock().unwrap().get(ticket).cloned() {
        request
            .headers_mut()
            .insert(header::COOKIE, cookie.parse().unwrap());
    }
    router.oneshot(request).await.unwrap()
}

#[tokio::test]
async fn video_stream_requires_its_own_media_session_and_logout_revokes_it() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"media").unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;
    let owning_cookie = MEDIA_COOKIES.lock().unwrap().remove(&ticket).unwrap();

    let mut missing_get_headers = None;
    for method in ["GET", "HEAD"] {
        let response = stream_video(state.clone(), &ticket, method, &[]).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
        if method == "GET" {
            missing_get_headers = Some(response.headers().clone());
        }
        assert!(axum::body::to_bytes(response.into_body(), 1)
            .await
            .unwrap()
            .is_empty());
    }

    let foreign_ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;
    let foreign_cookie = MEDIA_COOKIES
        .lock()
        .unwrap()
        .remove(&foreign_ticket)
        .unwrap();
    MEDIA_COOKIES
        .lock()
        .unwrap()
        .insert(ticket.clone(), foreign_cookie);
    let foreign = stream_video(state.clone(), &ticket, "GET", &[]).await;
    assert_eq!(foreign.status(), StatusCode::NOT_FOUND);
    assert_eq!(foreign.headers(), missing_get_headers.as_ref().unwrap());
    assert!(axum::body::to_bytes(foreign.into_body(), 1)
        .await
        .unwrap()
        .is_empty());
    MEDIA_COOKIES
        .lock()
        .unwrap()
        .insert(ticket.clone(), owning_cookie.clone());

    let router = build_router(state.clone());
    let response = router
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/fs/media-session")
                .header(
                    header::COOKIE,
                    format!("{}; {owning_cookie}", auth_cookie()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    assert_eq!(
        stream_video(state, &ticket, "GET", &[]).await.status(),
        StatusCode::NOT_FOUND
    );
    MEDIA_COOKIES.lock().unwrap().remove(&ticket);
}

#[tokio::test]
async fn video_stream_uses_one_range_core_for_inline_and_attachment_purposes() {
    let tmp = tempfile::tempdir().unwrap();
    let filename = "clip space.webm";
    std::fs::write(tmp.path().join(filename), b"0123456789").unwrap();
    let state = make_state_with_project(&tmp);
    let playback = issue_video_stream_ticket(state.clone(), filename, "playback").await;
    let download = issue_video_stream_ticket(state.clone(), filename, "download").await;

    let (playback, download) = tokio::join!(
        stream_video(state.clone(), &playback, "GET", &[("range", "bytes=2-4")]),
        stream_video(state, &download, "GET", &[("range", "bytes=2-4")]),
    );
    assert_eq!(playback.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(playback.headers()["content-range"], "bytes 2-4/10");
    assert_eq!(playback.headers()["content-length"], "3");
    assert_eq!(playback.headers()["content-disposition"], "inline");
    assert_eq!(
        axum::body::to_bytes(playback.into_body(), usize::MAX)
            .await
            .unwrap(),
        "234"
    );
    assert_eq!(download.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        download.headers()["content-disposition"],
        "attachment; filename=\"clip_space.webm\"; filename*=UTF-8''clip%20space.webm"
    );
    assert_eq!(
        axum::body::to_bytes(download.into_body(), usize::MAX)
            .await
            .unwrap(),
        "234"
    );
}

#[tokio::test]
async fn video_stream_head_ignores_range_and_if_range_mismatch_falls_back_to_full_body() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"0123456789").unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;

    let head = stream_video(
        state.clone(),
        &ticket,
        "HEAD",
        &[("range", "bytes=2-4"), ("if-range", "not-a-validator")],
    )
    .await;
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()["content-length"], "10");
    assert!(head.headers().get("content-range").is_none());
    assert_eq!(
        axum::body::to_bytes(head.into_body(), usize::MAX)
            .await
            .unwrap()
            .len(),
        0
    );

    let full = stream_video(
        state,
        &ticket,
        "GET",
        &[("range", "bytes=2-4"), ("if-range", "not-a-validator")],
    )
    .await;
    assert_eq!(full.status(), StatusCode::OK);
    assert_eq!(full.headers()["content-length"], "10");
    assert_eq!(
        axum::body::to_bytes(full.into_body(), usize::MAX)
            .await
            .unwrap(),
        "0123456789"
    );
}

#[tokio::test]
async fn video_stream_serves_zero_byte_files_but_rejects_zero_byte_ranges() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::File::create(tmp.path().join("empty.webm")).unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_video_stream_ticket(state.clone(), "empty.webm", "playback").await;

    let full = stream_video(state.clone(), &ticket, "GET", &[]).await;
    assert_eq!(full.status(), StatusCode::OK);
    assert_eq!(full.headers()["content-length"], "0");
    assert!(axum::body::to_bytes(full.into_body(), 1)
        .await
        .unwrap()
        .is_empty());

    let range = stream_video(state, &ticket, "GET", &[("range", "bytes=0-0")]).await;
    assert_eq!(range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(range.headers()["content-range"], "bytes */0");
}

#[tokio::test]
async fn video_stream_rejects_invalid_ranges_without_disclosing_filename_or_type() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"0123456789").unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "download").await;

    for headers in [
        vec![("range", "bytes=-0")],
        vec![("range", "bytes=0-1,2-3")],
        vec![("range", "bytes=0-1"), ("range", "bytes=2-3")],
    ] {
        let response = stream_video(state.clone(), &ticket, "GET", &headers).await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(response.headers()["content-length"], "0");
        assert_eq!(response.headers()["content-range"], "bytes */10");
        assert!(response.headers().get("content-type").is_none());
        assert!(response.headers().get("content-disposition").is_none());
    }
}

#[tokio::test]
async fn video_stream_revokes_stale_files_and_handles_sparse_ranges_without_full_buffering() {
    let tmp = tempfile::tempdir().unwrap();
    let stale = tmp.path().join("stale.webm");
    std::fs::write(&stale, b"old").unwrap();
    let state = make_state_with_project(&tmp);
    let stale_ticket = issue_video_stream_ticket(state.clone(), "stale.webm", "playback").await;
    std::fs::write(stale, b"replacement").unwrap();
    let stale = stream_video(state.clone(), &stale_ticket, "GET", &[]).await;
    assert_eq!(stale.status(), StatusCode::GONE);
    for name in [
        axum::http::header::ACCEPT_RANGES,
        axum::http::header::CONTENT_TYPE,
        axum::http::header::CONTENT_RANGE,
        axum::http::header::CONTENT_DISPOSITION,
        axum::http::header::ETAG,
        axum::http::header::LAST_MODIFIED,
    ] {
        assert!(stale.headers().get(name).is_none());
    }
    assert_eq!(stale.headers()[axum::http::header::CONTENT_LENGTH], "0");
    assert!(axum::body::to_bytes(stale.into_body(), 1)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        stream_video(state.clone(), &stale_ticket, "GET", &[])
            .await
            .status(),
        StatusCode::NOT_FOUND
    );

    let sparse_size = 3_u64 * 1024 * 1024 * 1024;
    let sparse = tmp.path().join("large.webm");
    std::fs::File::create(&sparse)
        .unwrap()
        .set_len(sparse_size)
        .unwrap();
    let sparse_ticket = issue_video_stream_ticket(state.clone(), "large.webm", "playback").await;
    let response = stream_video(
        state,
        &sparse_ticket,
        "GET",
        &[("range", "bytes=3221225471-3221225471")],
    )
    .await;
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-length"], "1");
    let bytes = axum::body::to_bytes(response.into_body(), 2).await.unwrap();
    assert_eq!(bytes.as_ref(), &[0]);
}

#[tokio::test]
async fn video_stream_is_session_bound_and_serves_media() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"x").unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;
    let response = stream_video(
        state.clone(),
        &ticket,
        "GET",
        &[("origin", "https://browser.example")],
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        stream_video(state, "unknown", "GET", &[]).await.status(),
        StatusCode::NOT_FOUND
    );
}

// ---------------------------------------------------------------------------
// Session-bound image preview API
// ---------------------------------------------------------------------------

#[tokio::test]
async fn image_tickets_use_a_closed_allowlist_and_fixed_preview_contract() {
    let tmp = tempfile::tempdir().unwrap();
    for extension in ["png", "JPG", "jpeg", "gif", "WEBP"] {
        std::fs::write(
            tmp.path().join(format!("preview.{extension}")),
            b"image bytes",
        )
        .unwrap();
    }
    let state = make_state_with_project(&tmp);

    for extension in ["png", "JPG", "jpeg", "gif", "WEBP"] {
        let path = format!("preview.{extension}");
        let response = post_json(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "project": "test-project", "path": path.clone() }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let ticket = json["ticket"].as_str().unwrap();
        assert_eq!(json["purpose"], "preview");
        assert_eq!(json["authorizationMode"], "session-cookie-v1");
        assert_eq!(json["streamPath"], format!("/api/fs/image/stream/{ticket}"));
        assert!(!json.to_string().contains("test-project"));
        assert!(!json.to_string().contains(&path));
    }
}

#[tokio::test]
async fn image_ticket_capacity_is_shared_and_has_image_specific_error_text() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("preview.png"), b"image bytes").unwrap();
    let state = make_state_with_project(&tmp);
    let mut cookie = None;
    for _ in 0..crate::fs::media_ticket::MAX_MEDIA_TICKETS_PER_SESSION {
        let router = build_router(state.clone());
        let request = Request::builder()
            .method("POST")
            .uri("/api/fs/image/tickets")
            .header("Content-Type", "application/json")
            .header(
                "Cookie",
                format!(
                    "{}{}",
                    auth_cookie(),
                    cookie
                        .as_ref()
                        .map(|value: &String| format!("; {value}"))
                        .unwrap_or_default()
                ),
            )
            .body(Body::from(
                serde_json::json!({ "project": "test-project", "path": "preview.png" }).to_string(),
            ))
            .unwrap();
        let response = router.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        if let Some(value) = response.headers().get(header::SET_COOKIE) {
            cookie = Some(
                value
                    .to_str()
                    .unwrap()
                    .split(';')
                    .next()
                    .unwrap()
                    .to_owned(),
            );
        }
    }

    let router = build_router(state);
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/fs/image/tickets")
                .header("Content-Type", "application/json")
                .header("Cookie", format!("{}; {}", auth_cookie(), cookie.unwrap()))
                .body(Body::from(
                    serde_json::json!({ "project": "test-project", "path": "preview.png" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()["retry-after"], "1");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "IMAGE_TICKET_CAPACITY");
    assert_eq!(json["error"], "image ticket capacity reached");
}

#[tokio::test]
async fn image_ticket_issuance_requires_auth_and_rejects_unsafe_inputs() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("document.svg"), b"svg").unwrap();
    std::fs::write(tmp.path().join("document.avif"), b"avif").unwrap();
    std::fs::create_dir(tmp.path().join("folder.png")).unwrap();
    let state = make_state_with_project(&tmp);

    let body = serde_json::json!({ "project": "test-project", "path": "document.svg" });
    assert_eq!(
        post_json_without_auth(state.clone(), "/api/fs/image/tickets", body.clone())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    for path in ["document.svg", "document.avif", "folder.png"] {
        let response = post_json(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "project": "test-project", "path": path }),
        )
        .await;
        assert_eq!(
            response.status(),
            if path == "folder.png" {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            }
        );
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(path));
    }
    let traversal = post_json(
        state,
        "/api/fs/image/tickets",
        serde_json::json!({ "project": "test-project", "path": "../outside.png" }),
    )
    .await;
    assert_eq!(traversal.status(), StatusCode::FORBIDDEN);
    assert!(!String::from_utf8_lossy(
        &axum::body::to_bytes(traversal.into_body(), usize::MAX)
            .await
            .unwrap()
    )
    .contains("outside.png"));
}

#[cfg(unix)]
#[tokio::test]
async fn image_ticket_issuance_rejects_symlinks_and_fifos() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("real.png"), b"png").unwrap();
    std::os::unix::fs::symlink(tmp.path().join("real.png"), tmp.path().join("link.png")).unwrap();
    let real_dir = tmp.path().join("real-dir");
    std::fs::create_dir(&real_dir).unwrap();
    std::fs::write(real_dir.join("nested.png"), b"png").unwrap();
    std::os::unix::fs::symlink(&real_dir, tmp.path().join("link-dir")).unwrap();
    let fifo = tmp.path().join("trap.gif");
    assert!(Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    let state = make_state_with_project(&tmp);

    for path in ["link.png", "link-dir/nested.png", "trap.gif"] {
        let response = post_json(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "project": "test-project", "path": path }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

async fn issue_image_stream_ticket(state: AppState, path: &str) -> String {
    let response = post_json(
        state,
        "/api/fs/image/tickets",
        serde_json::json!({ "project": "test-project", "path": path }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let cookie = response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let ticket = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["ticket"]
        .as_str()
        .unwrap()
        .to_owned();
    MEDIA_COOKIES.lock().unwrap().insert(ticket.clone(), cookie);
    ticket
}

async fn stream_image(
    state: AppState,
    ticket: &str,
    method: &str,
    headers: &[(&str, &str)],
) -> axum::response::Response {
    let router = build_router(state);
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/api/fs/image/stream/{ticket}"))
        .body(Body::empty())
        .unwrap();
    for (name, value) in headers {
        request.headers_mut().append(
            name.parse::<axum::http::HeaderName>().unwrap(),
            value.parse().unwrap(),
        );
    }
    if let Some(cookie) = MEDIA_COOKIES.lock().unwrap().get(ticket).cloned() {
        request
            .headers_mut()
            .insert(header::COOKIE, cookie.parse().unwrap());
    }
    router.oneshot(request).await.unwrap()
}

#[tokio::test]
async fn image_stream_requires_its_own_media_session_and_logout_revokes_it() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("cover.png"), b"image").unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_image_stream_ticket(state.clone(), "cover.png").await;
    let owning_cookie = MEDIA_COOKIES.lock().unwrap().remove(&ticket).unwrap();

    let mut missing_get_headers = None;
    for method in ["GET", "HEAD"] {
        let response = stream_image(state.clone(), &ticket, method, &[]).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
        if method == "GET" {
            missing_get_headers = Some(response.headers().clone());
        }
        assert!(axum::body::to_bytes(response.into_body(), 1)
            .await
            .unwrap()
            .is_empty());
    }

    let foreign_ticket = issue_image_stream_ticket(state.clone(), "cover.png").await;
    let foreign_cookie = MEDIA_COOKIES
        .lock()
        .unwrap()
        .remove(&foreign_ticket)
        .unwrap();
    MEDIA_COOKIES
        .lock()
        .unwrap()
        .insert(ticket.clone(), foreign_cookie);
    let foreign = stream_image(state.clone(), &ticket, "GET", &[]).await;
    assert_eq!(foreign.status(), StatusCode::NOT_FOUND);
    assert_eq!(foreign.headers(), missing_get_headers.as_ref().unwrap());
    assert!(axum::body::to_bytes(foreign.into_body(), 1)
        .await
        .unwrap()
        .is_empty());

    let unauthenticated = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/fs/media-session")
                .header(header::COOKIE, &owning_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/fs/media-session")
                .header(
                    header::COOKIE,
                    format!("{}; {owning_cookie}", auth_cookie()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        stream_image(state, &ticket, "GET", &[]).await.status(),
        StatusCode::NOT_FOUND
    );
    MEDIA_COOKIES.lock().unwrap().remove(&ticket);
}

#[tokio::test]
async fn image_stream_is_session_bound_inline_mime_typed_and_rangeable() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("cover.WEBP"), b"0123456789").unwrap();
    let state = make_state_with_project(&tmp);
    let ticket = issue_image_stream_ticket(state.clone(), "cover.WEBP").await;

    let response = stream_image(
        state.clone(),
        &ticket,
        "GET",
        &[
            ("range", "bytes=2-4"),
            ("origin", "https://browser.example"),
        ],
    )
    .await;
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-type"], "image/webp");
    assert_eq!(response.headers()["content-disposition"], "inline");
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert_eq!(response.headers()["content-range"], "bytes 2-4/10");
    assert_eq!(
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
        "234"
    );

    let head = stream_image(
        state.clone(),
        &ticket,
        "HEAD",
        &[("range", "bytes=2-4"), ("if-range", "not-a-validator")],
    )
    .await;
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()["content-length"], "10");
    assert!(head.headers().get("content-range").is_none());
    assert!(axum::body::to_bytes(head.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());

    let invalid = stream_image(state, &ticket, "GET", &[("range", "bytes=0-1,2-3")]).await;
    assert_eq!(invalid.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert!(invalid.headers().get("content-type").is_none());
    assert!(invalid.headers().get("content-disposition").is_none());
}

#[tokio::test]
async fn image_stream_rejects_video_kind_revokes_and_fails_closed_on_stale_files() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("cover.png"), b"png").unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"webm").unwrap();
    let state = make_state_with_project(&tmp);
    let image_ticket = issue_image_stream_ticket(state.clone(), "cover.png").await;
    let video_ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;

    assert_eq!(
        stream_image(state.clone(), &video_ticket, "GET", &[])
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        stream_video(state.clone(), &image_ticket, "GET", &[])
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        delete_json(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "ticket": video_ticket.clone() }),
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        stream_video(state.clone(), &video_ticket, "GET", &[])
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        delete_json(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "ticket": image_ticket.clone() }),
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        delete_json(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "ticket": image_ticket.clone() }),
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    // Bare protected DELETE cannot revoke a bound ticket without its media cookie.
    assert_eq!(
        stream_image(state.clone(), &image_ticket, "GET", &[])
            .await
            .status(),
        StatusCode::OK
    );

    let stale_ticket = issue_image_stream_ticket(state.clone(), "cover.png").await;
    std::fs::write(tmp.path().join("cover.png"), b"replacement image").unwrap();
    let stale = stream_image(state.clone(), &stale_ticket, "GET", &[]).await;
    assert_eq!(stale.status(), StatusCode::GONE);
    assert_eq!(
        stream_image(state, &stale_ticket, "GET", &[])
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn image_revoke_requires_auth_and_context_reload_revokes_both_media_kinds() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("cover.png"), b"png").unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"webm").unwrap();
    let state = make_state_with_project(&tmp);
    let image_ticket = issue_image_stream_ticket(state.clone(), "cover.png").await;
    let video_ticket = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;

    assert_eq!(
        post_json_without_auth(
            state.clone(),
            "/api/fs/image/tickets",
            serde_json::json!({ "project": "test-project", "path": "cover.png" }),
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    let revoke_without_auth = Request::builder()
        .method("DELETE")
        .uri("/api/fs/image/tickets")
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::json!({ "ticket": image_ticket }).to_string(),
        ))
        .unwrap();
    let response = build_router(state.clone())
        .oneshot(revoke_without_auth)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    state.media_tickets.revoke_all();
    assert!(state
        .image_stream_tickets
        .lookup_and_touch(&image_ticket)
        .is_none());
    assert!(state
        .video_stream_tickets
        .lookup_and_touch(&video_ticket)
        .is_none());
}

#[tokio::test]
async fn config_and_settings_reload_revoke_shared_media_tickets() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("cover.png"), b"png").unwrap();
    std::fs::write(tmp.path().join("clip.webm"), b"webm").unwrap();
    let state = make_state_with_project(&tmp);

    let config_image = issue_image_stream_ticket(state.clone(), "cover.png").await;
    let config_video = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;
    let config_response = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({
            "workspace": { "name": "reloaded", "root": "." },
            "projects": [{ "name": "test-project", "path": ".", "type": "custom" }]
        }),
    )
    .await;
    assert_eq!(config_response.status(), StatusCode::OK);
    assert!(state
        .image_stream_tickets
        .lookup_and_touch(&config_image)
        .is_none());
    assert!(state
        .video_stream_tickets
        .lookup_and_touch(&config_video)
        .is_none());

    let settings_image = issue_image_stream_ticket(state.clone(), "cover.png").await;
    let settings_video = issue_video_stream_ticket(state.clone(), "clip.webm", "playback").await;
    let settings_response = post_json(
        state.clone(),
        "/api/settings/cache-clear",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(settings_response.status(), StatusCode::OK);
    assert!(state
        .image_stream_tickets
        .lookup_and_touch(&settings_image)
        .is_none());
    assert!(state
        .video_stream_tickets
        .lookup_and_touch(&settings_video)
        .is_none());
}
