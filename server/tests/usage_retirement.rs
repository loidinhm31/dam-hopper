use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::router::build_router,
    config::{read_config, DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    utils::db_paths::ensure_distinct_database_paths,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tempfile::TempDir;
use tower::ServiceExt;

#[path = "common/mod.rs"]
mod common;

fn make_test_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let config_file = workspace_dir.join("dam-hopper.toml");
    std::fs::write(&config_file, "[workspace]\nname = \"test-workspace\"\n").ok();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_dir.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: config_file,
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(dam_hopper_server::pty::NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);

    AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        "test-token".to_string(),
        fs,
        None,
        true, // no-auth dev mode
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
    )
    .expect("make_test_state failed")
}

#[tokio::test]
async fn usage_routes_all_return_404() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let router = build_router(state);

    let endpoints = [
        ("GET", "/api/usage/summary"),
        ("GET", "/api/usage/sessions"),
        ("GET", "/api/usage/sessions/session-123"),
        ("GET", "/api/usage/health"),
        ("GET", "/api/usage/settings"),
        ("POST", "/api/usage/settings"),
        ("PATCH", "/api/usage/settings"),
        ("GET", "/api/usage/setup"),
        ("PATCH", "/api/usage/setup"),
        ("DELETE", "/api/usage"),
    ];

    for (method, uri) in endpoints {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("Content-Type", "application/json")
            .body(Body::from("{}"))
            .unwrap();

        let resp = router.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "{method} {uri} must return 404 after usage retirement"
        );
    }
}

#[tokio::test]
async fn legacy_server_telemetry_toml_and_put_config_tolerated() {
    let tmp = tempfile::tempdir().unwrap();
    let config_path = tmp.path().join("dam-hopper.toml");
    std::fs::write(
        &config_path,
        r#"
[workspace]
name = "legacy-telemetry"

[server]
session_db_path = "sessions.db"

[server.telemetry]
enabled = true
db_path = "/tmp/legacy.db"
detail_retention_days = 30
aggregate_retention_days = 730

[server.telemetry.collector]
enabled = true
host = "127.0.0.1"
port = 4811
"#,
    )
    .unwrap();

    let config = read_config(&config_path).expect("legacy telemetry TOML must parse without error");
    assert_eq!(config.workspace.name, "legacy-telemetry");

    // Also test PUT /api/config with legacy server.telemetry payload
    let state = make_test_state(&tmp);
    let router = build_router(state);

    let put_body = serde_json::json!({
        "workspace": { "name": "legacy-telemetry" },
        "server": {
            "sessionDbPath": "sessions.db",
            "telemetry": {
                "enabled": true,
                "dbPath": "/tmp/legacy.db",
                "detailRetentionDays": 30
            }
        }
    });

    let req = Request::builder()
        .method("PUT")
        .uri("/api/config")
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&put_body).unwrap()))
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "PUT /api/config with legacy server.telemetry must be accepted without error"
    );
}

#[tokio::test]
async fn non_usage_routes_and_system_metrics_retained() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let router = build_router(state);

    let req = Request::builder()
        .method("GET")
        .uri("/api/system/metrics")
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "Retained system host metrics must return 200 OK"
    );
}

#[test]
fn neutral_db_paths_prevent_aliasing() {
    let tmp = tempfile::tempdir().unwrap();
    let session = tmp.path().join("sessions.db");
    let other = tmp.path().join("other.db");

    std::fs::write(&session, b"session-db").unwrap();
    std::fs::write(&other, b"other-db").unwrap();

    assert!(ensure_distinct_database_paths(&session, &other).is_ok());
    assert!(ensure_distinct_database_paths(&session, &session).is_err());

    #[cfg(unix)]
    {
        let symlink = tmp.path().join("session-symlink.db");
        std::os::unix::fs::symlink(&session, &symlink).unwrap();
        assert!(ensure_distinct_database_paths(&session, &symlink).is_err());

        let hardlink = tmp.path().join("session-hardlink.db");
        std::fs::hard_link(&session, &hardlink).unwrap();
        assert!(ensure_distinct_database_paths(&session, &hardlink).is_err());
    }
}

#[tokio::test]
async fn startup_never_creates_telemetry_files_or_codex_exporter() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let _router = build_router(state);

    // Verify no telemetry databases or exporter artifacts were created in temp dir
    assert!(!tmp.path().join("telemetry.db").exists());
    assert!(!tmp.path().join("telemetry-key").exists());
    assert!(!tmp.path().join("collector-token").exists());
    assert!(!tmp.path().join(".codex").exists());
}
