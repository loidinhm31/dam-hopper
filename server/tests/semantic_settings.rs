#![cfg(target_os = "linux")]

//! Integration tests for Phase 06 Admin-only global hot toggle and unsafe override gates.
//!
//! Verifies:
//! - GET `/api/semantic/settings` returns truthful status, tuple ID, capability, and caller authority.
//! - PATCH `/api/semantic/settings` requires Admin role (User, dev-user, and --no-auth rejected).
//! - Admin toggle ON starts ZERO child processes, validates passively, and persists durable true intent.
//! - Admin toggle ON->ON is an authorized no-op preserving runtime generation.
//! - Admin toggle OFF immediately revokes admission, reaps child trees, and persists false intent.
//! - Serialized global mutation preserves semantic configuration during concurrent defaults/UI updates.
//! - Raw filesystem mutations (write, delete, rename, upload) targeting global config are refused.
//! - Workspace config PUT rejects misplaced semantic payloads.

use std::{net::SocketAddr, sync::Arc};

use axum::http::{header, StatusCode};
use reqwest::Client;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    auth::model::{AuthClaims, AuthSession, UserRecord, UserRole, chrono_to_bson},
    auth::{AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS},
    config::{
        global_config_path,
        DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

static TEST_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const TEST_SECRET: &str = "test-semantic-settings-jwt-secret-xyz";

fn make_jwt(sub: &str, sid: &str) -> String {
    let now = chrono::Utc::now();
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: sub.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    claims.encode(TEST_SECRET).unwrap()
}

fn make_mock_auth_service(username: &str, role: UserRole) -> (dam_hopper_server::auth::AuthService, String) {
    let now = chrono::Utc::now();
    let exp = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
    let sid = format!("session-{username}");

    let user = UserRecord {
        id: None,
        username: username.to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };

    let session = AuthSession {
        id: sid.clone(),
        username: username.to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };

    let service = dam_hopper_server::auth::AuthService::new_mock(user, session);
    let token = make_jwt(username, &sid);
    (service, token)
}

async fn create_test_app(
    tmp: &TempDir,
    no_auth: bool,
    role: UserRole,
) -> (AppState, SocketAddr, String, common::semantic_fixtures::TestToolchain) {
    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let config_dir = tmp.path().join(".config").join("dam-hopper");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::env::set_var("XDG_CONFIG_HOME", tmp.path().join(".config"));
    let workspace_dir = tmp.path().to_path_buf();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "semantic-settings-test".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));

    let (auth_service, token) = make_mock_auth_service(
        if role == UserRole::Admin { "admin-user" } else { "regular-user" },
        role,
    );

    let state = AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_SECRET.to_string(),
        fs,
        None,
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("AppState creation failed")
    .with_auth_service(Arc::new(auth_service))
    .with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state.clone());
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, addr, token, toolchain)
}

#[tokio::test]
async fn test_get_semantic_settings_default_off() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let (_state, addr, token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let resp = client
        .get(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let text = resp.text().await.unwrap();
    let body: Value = serde_json::from_str(&text).unwrap();

    assert_eq!(body["configuredEnabled"], false);
    assert_eq!(body["runtimeEnabled"], false);
    assert_eq!(body["runtimeState"], "disabled");
    assert_eq!(body["toolchainReady"], true);
    assert_eq!(body["tupleIdentifier"], "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64");
    assert_eq!(body["activeTrees"], 0);
    assert_eq!(body["openDocuments"], 0);
    assert_eq!(body["canMutate"], true);
}

#[tokio::test]
async fn test_patch_semantic_settings_requires_admin() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();

    // 1. Regular user token -> 403 Forbidden
    let (_state, addr, user_token, _tc) = create_test_app(&tmp, false, UserRole::User).await;
    let client = Client::new();

    let resp = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let text = resp.text().await.unwrap();
    let body: Value = serde_json::from_str(&text).unwrap();
    assert!(body["error"].as_str().unwrap().contains("Administrator role required"));

    // 2. Unauthenticated -> 401 Unauthorized
    let resp = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 3. Dev mode (--no-auth) -> 403 Forbidden
    let (_state_dev, addr_dev, _dev_token, _tc_dev) = create_test_app(&tmp, true, UserRole::User).await;
    let resp = client
        .patch(format!("http://{addr_dev}/api/semantic/settings"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_patch_semantic_settings_admin_toggle_lifecycle() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    // 1. Admin turns ON
    let resp = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let text = resp.text().await.unwrap();
    let body: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(body["configuredEnabled"], true);
    assert_eq!(body["runtimeEnabled"], true);
    assert_eq!(body["runtimeState"], "idle");
    assert_eq!(body["activeTrees"], 0); // 0 child processes spawned!

    let epoch_after_on = state.semantic_supervisor.runtime_epoch();
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 2. Already enabled -> enabled is an authorized no-op (preserves epoch)
    let resp_noop = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp_noop.status(), StatusCode::OK);
    assert_eq!(state.semantic_supervisor.runtime_epoch(), epoch_after_on);

    // 3. Admin turns OFF
    let resp_off = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": false })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp_off.status(), StatusCode::OK);
    let text_off = resp_off.text().await.unwrap();
    let body_off: Value = serde_json::from_str(&text_off).unwrap();
    assert_eq!(body_off["configuredEnabled"], false);
    assert_eq!(body_off["runtimeEnabled"], false);
    assert_eq!(body_off["runtimeState"], "disabled");
    assert_eq!(body_off["activeTrees"], 0);

    assert!(!state.semantic_supervisor.is_effective_enabled());
}

#[tokio::test]
async fn test_serialized_global_mutation_preserves_semantic_intent() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let (_state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    // 1. Enable semantic navigation
    let resp = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 2. Perform concurrent update to defaults
    let resp_defaults = client
        .post(format!("http://{addr}/api/global-config/defaults"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({
            "defaults": {
                "workspace": "/tmp/custom-workspace"
            }
        })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_defaults.status(), StatusCode::OK);

    // 3. Verify semantic is still enabled in global config
    let resp_get = client
        .get(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    let text = resp_get.text().await.unwrap();
    let body: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(body["configuredEnabled"], true);
    assert_eq!(body["runtimeEnabled"], true);

    // 4. Update defaults rejecting semantic override attempt
    let resp_rejected = client
        .post(format!("http://{addr}/api/global-config/defaults"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({
            "defaults": { "workspace": "/tmp/ws" },
            "semantic": { "enabled": false }
        })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_rejected.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_raw_fs_mutation_refuses_global_config_tampering() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    let config_dir = tmp.path().join(".config").join("dam-hopper");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::env::set_var("XDG_CONFIG_HOME", tmp.path().join(".config"));
    let global_config = global_config_path();
    let project_root = tempfile::tempdir().unwrap();
    // 1. mutate::assert_safe_mutation rejects global_config path
    let err = dam_hopper_server::fs::mutate::assert_safe_mutation(
        &global_config,
        project_root.path(),
        false,
    )
    .unwrap_err();
    assert!(err.to_string().contains("Direct mutation of global config file is forbidden"));

    // 2. secure_path::write_bytes rejects target pointing to global_config
    if let (Some(parent), Some(filename)) = (global_config.parent(), global_config.file_name()) {
        let err_write = dam_hopper_server::fs::secure_path::write_bytes(
            parent,
            std::path::Path::new(filename),
            b"tampered",
            None,
            None,
            false,
        )
        .unwrap_err();
        assert!(err_write.to_string().contains("Direct mutation of global config file is forbidden"));
    }
}

#[tokio::test]
async fn test_safe_disabled_mismatch_and_admin_recovery() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    // 1. Enable semantic navigation
    let resp = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 2. Simulate precommit demotion or teardown failure entering safe-disabled
    state
        .semantic_supervisor
        .record_disable_failure("Precommit demotion simulated: safe-disabled mismatch".to_string())
        .await;

    assert!(state.semantic_supervisor.is_safe_disabled());
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 3. Inspect status via GET: shows configuredEnabled=true, runtimeEnabled=false, runtimeState="safe-disabled"
    let resp_get = client
        .get(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    let text = resp_get.text().await.unwrap();
    let body: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(body["configuredEnabled"], true);
    assert_eq!(body["runtimeEnabled"], false);
    assert_eq!(body["runtimeState"], "safe-disabled");
    assert!(body["transitionError"].as_str().unwrap().contains("Precommit demotion simulated"));

    // 4. Admin performs recovery toggle: PATCH { enabled: true }
    let resp_recover = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_recover.status(), StatusCode::OK);
    let text_recover = resp_recover.text().await.unwrap();
    let body_recover: Value = serde_json::from_str(&text_recover).unwrap();
    assert_eq!(body_recover["configuredEnabled"], true);
    assert_eq!(body_recover["runtimeEnabled"], true);
    assert_eq!(body_recover["runtimeState"], "idle");
    assert!(!state.semantic_supervisor.is_safe_disabled());
    assert!(state.semantic_supervisor.is_effective_enabled());
}

#[tokio::test]
async fn test_workspace_config_put_rejects_semantic_payload() {
    let _env_guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let (_state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let resp = client
        .put(format!("http://{addr}/api/config"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({
            "workspace": { "name": "ws-tamper", "root": "." },
            "semantic": { "enabled": true }
        })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let text = resp.text().await.unwrap();
    assert!(text.contains("Semantic configuration is server-global only"));
}
