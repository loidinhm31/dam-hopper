use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
};
use opaque_ke::ServerSetup;
use std::sync::Arc;
use tempfile::TempDir;
use tower::ServiceExt;

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::GlobalConfig,
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
    telemetry::TelemetryRuntime,
};
mod common;

const TEST_TOKEN: &str = "test-token-settings";

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

fn make_test_state(tmp: &TempDir, initial_toml: &str) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let config_file = workspace_dir.join("dam-hopper.toml");
    std::fs::write(&config_file, initial_toml).expect("write initial toml");
    let config = dam_hopper_server::config::read_config(&config_file)
        .expect("read initial config");
    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
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
        TEST_TOKEN.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut rand::rngs::OsRng),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
        TelemetryRuntime::new(),
    )
    .expect("make_test_state failed")
}

#[tokio::test]
async fn test_export_workspace_settings_preserves_comments_and_formatting() {
    let tmp = tempfile::tempdir().unwrap();
    let initial_toml = r#"# This is a leading comment
[workspace]
name = "my-workspace" # inline comment
root = "."

# Projects section
projects = []
"#;
    let state = make_test_state(&tmp, initial_toml);
    let router = build_router(state);

    let req = Request::builder()
        .uri("/api/settings/export/workspace.toml")
        .header("Cookie", auth_cookie())
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/toml; charset=utf-8"
    );
    assert_eq!(
        resp.headers().get(header::CONTENT_DISPOSITION).unwrap(),
        "attachment; filename=\"dam-hopper.toml\""
    );
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let exported_text = std::str::from_utf8(&body).unwrap();
    assert_eq!(exported_text, initial_toml);
}

#[tokio::test]
async fn test_import_workspace_settings_success_and_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let initial_toml = r#"[workspace]
name = "original-workspace"
root = "."
projects = []
"#;
    let state = make_test_state(&tmp, initial_toml);
    let router = build_router(state.clone());

    let candidate_toml = r#"# New configuration with comments
[workspace]
name = "imported-workspace"
root = "."
projects = []
"#;

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/settings/import/workspace.toml")
        .header("Cookie", auth_cookie())
        .header(header::CONTENT_TYPE, "application/toml; charset=utf-8")
        .body(Body::from(candidate_toml))
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["imported"], true);
    assert_eq!(json["fileName"], "dam-hopper.toml");
    assert_eq!(json["workspaceName"], "imported-workspace");

    let backup_file_name = json["backupFileName"].as_str().unwrap();
    assert!(backup_file_name.starts_with("dam-hopper.toml.bak."));

    // Check disk content was updated byte-for-byte
    let config_file = tmp.path().join("dam-hopper.toml");
    let current_disk = std::fs::read_to_string(&config_file).unwrap();
    assert_eq!(current_disk, candidate_toml);

    // Check backup contains exact previous bytes
    let backup_path = tmp.path().join(backup_file_name);
    assert!(backup_path.exists());
    let backup_content = std::fs::read_to_string(&backup_path).unwrap();
    assert_eq!(backup_content, initial_toml);

    // Check runtime config was reloaded
    let runtime_cfg = state.config.read().await;
    assert_eq!(runtime_cfg.workspace.name, "imported-workspace");
}

#[tokio::test]
async fn test_import_rejects_unsupported_content_type() {
    let tmp = tempfile::tempdir().unwrap();
    let initial_toml = "[workspace]\nname = \"ws\"\nroot = \".\"\nprojects = []\n";
    let state = make_test_state(&tmp, initial_toml);
    let router = build_router(state);

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/settings/import/workspace.toml")
        .header("Cookie", auth_cookie())
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"workspace":{"name":"ws"}}"#))
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn test_import_rejects_malformed_toml() {
    let tmp = tempfile::tempdir().unwrap();
    let initial_toml = "[workspace]\nname = \"ws\"\nroot = \".\"\nprojects = []\n";
    let state = make_test_state(&tmp, initial_toml);
    let router = build_router(state);

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/settings/import/workspace.toml")
        .header("Cookie", auth_cookie())
        .header(header::CONTENT_TYPE, "application/toml")
        .body(Body::from("this is [not valid toml"))
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Ensure disk and state untouched
    let current_disk = std::fs::read_to_string(tmp.path().join("dam-hopper.toml")).unwrap();
    assert_eq!(current_disk, initial_toml);
}

#[tokio::test]
async fn test_import_prunes_backups_retaining_five() {
    let tmp = tempfile::tempdir().unwrap();
    let initial_toml = "[workspace]\nname = \"ws\"\nroot = \".\"\nprojects = []\n";
    let state = make_test_state(&tmp, initial_toml);

    // Create a manual user backup that must NOT be pruned
    let manual_backup = tmp.path().join("dam-hopper.toml.bak.manual_backup_by_user");
    std::fs::write(&manual_backup, "custom backup").unwrap();

    for i in 1..=7 {
        let router = build_router(state.clone());
        let candidate = format!("[workspace]\nname = \"ws-{i}\"\nroot = \".\"\nprojects = []\n");
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/settings/import/workspace.toml")
            .header("Cookie", auth_cookie())
            .header(header::CONTENT_TYPE, "application/toml")
            .body(Body::from(candidate))
            .unwrap();

        let resp = router.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        // Small delay to ensure timestamp difference
        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    }

    // Count backups in directory
    let mut backup_count = 0;
    for entry in std::fs::read_dir(tmp.path()).unwrap().flatten() {
        if entry.file_name().to_string_lossy().starts_with("dam-hopper.toml.bak.") {
            backup_count += 1;
        }
    }
    // 5 automated backups + 1 manual user backup = 6 files with backup prefix
    assert_eq!(backup_count, 6);
    assert!(manual_backup.exists(), "User backup must be preserved");
}

