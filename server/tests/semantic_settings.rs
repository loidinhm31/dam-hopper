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

use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::http::{header, StatusCode};
use reqwest::Client;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole},
    auth::{AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS},
    config::{
        global_config_path, DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig,
        ProjectType, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    semantic::protocol::ConnectionId,
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

static TEST_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const TEST_SECRET: &str = "test-semantic-settings-jwt-secret-xyz";

struct TestEnvGuard {
    lock: Option<tokio::sync::MutexGuard<'static, ()>>,
    prev_xdg: Option<std::ffi::OsString>,
}

impl Drop for TestEnvGuard {
    fn drop(&mut self) {
        match &self.prev_xdg {
            Some(prev) => std::env::set_var("XDG_CONFIG_HOME", prev),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        drop(self.lock.take());
    }
}

async fn acquire_test_env() -> TestEnvGuard {
    let lock = TEST_ENV_LOCK.lock().await;
    let prev_xdg = std::env::var_os("XDG_CONFIG_HOME");
    TestEnvGuard {
        lock: Some(lock),
        prev_xdg,
    }
}

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

async fn make_auth_service(
    tmp: &TempDir,
    username: &str,
    role: UserRole,
) -> (
    dam_hopper_server::auth::AuthService,
    String,
    std::path::PathBuf,
) {
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

    let db_path = tmp.path().join(format!("auth-{username}.db"));
    let store = dam_hopper_server::auth::AuthStore::open_sqlite(&db_path)
        .await
        .unwrap();
    store.create_user(user).await.unwrap();
    store.create_session(session).await.unwrap();
    let service = dam_hopper_server::auth::AuthService::with_system_clock(Some(store), None);
    let token = make_jwt(username, &sid);
    (service, token, db_path)
}

async fn create_test_app(
    tmp: &TempDir,
    no_auth: bool,
    role: UserRole,
) -> (
    AppState,
    SocketAddr,
    String,
    common::semantic_fixtures::TestToolchain,
) {
    let (state, addr, token, toolchain, _) = create_test_app_full(tmp, no_auth, role).await;
    (state, addr, token, toolchain)
}

async fn create_test_app_full(
    tmp: &TempDir,
    no_auth: bool,
    role: UserRole,
) -> (
    AppState,
    SocketAddr,
    String,
    common::semantic_fixtures::TestToolchain,
    std::path::PathBuf,
) {
    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let (state, addr, token, db_path) =
        create_test_app_with_toolchain(tmp, no_auth, role, &toolchain).await;
    (state, addr, token, toolchain, db_path)
}

async fn create_test_app_with_toolchain(
    tmp: &TempDir,
    no_auth: bool,
    role: UserRole,
    toolchain: &common::semantic_fixtures::TestToolchain,
) -> (AppState, SocketAddr, String, std::path::PathBuf) {
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
    dam_hopper_server::config::write_config(&config.config_path, &config)
        .expect("persist active workspace config");

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));

    let (auth_service, token, db_path) = make_auth_service(
        tmp,
        if no_auth {
            "dev-user"
        } else if role == UserRole::Admin {
            "admin-user"
        } else {
            "regular-user"
        },
        role,
    )
    .await;

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

    (state, addr, token, db_path)
}

#[ignore = "Subprocess-only SQLite lock fixture, exercised by timeout matrix"]
#[test]
fn sqlite_wal_reader_lock_helper() {
    let Some(db_path) = std::env::var_os("SEMANTIC_AUTH_WAL_LOCK_DB") else {
        return;
    };
    let socket_path = std::env::var_os("SEMANTIC_AUTH_WAL_LOCK_CONTROL").unwrap();
    let mut control = std::os::unix::net::UnixStream::connect(socket_path).unwrap();
    control
        .set_read_timeout(Some(Duration::from_secs(30)))
        .unwrap();
    let mut shm_path = std::path::PathBuf::from(db_path);
    shm_path.as_mut_os_string().push("-shm");
    let shm = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(shm_path)
        .unwrap();
    let mut lock: libc::flock = unsafe { std::mem::zeroed() };
    lock.l_type = libc::F_WRLCK as _;
    lock.l_whence = libc::SEEK_SET as _;
    lock.l_start = 123;
    lock.l_len = 5;
    assert_eq!(
        unsafe { libc::fcntl(shm.as_raw_fd(), libc::F_SETLK, &lock) },
        0,
        "Failed to acquire SQLite WAL reader slots: {}",
        std::io::Error::last_os_error()
    );
    control.write_all(&[1]).unwrap();
    let mut release = [0];
    control
        .read_exact(&mut release)
        .expect("Parent must release WAL lock within bounded watchdog");
    drop(shm);
}

struct SqliteReadBlocker {
    child: Option<std::process::Child>,
    control: tokio::net::UnixStream,
}

impl SqliteReadBlocker {
    async fn acquire(db_path: &std::path::Path, tmp_dir: &std::path::Path) -> Self {
        use tokio::io::AsyncReadExt;
        let control_path = tmp_dir.join("wal-read-lock.sock");
        let listener = tokio::net::UnixListener::bind(&control_path).unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "sqlite_wal_reader_lock_helper",
                "--nocapture",
            ])
            .env("SEMANTIC_AUTH_WAL_LOCK_DB", db_path)
            .env("SEMANTIC_AUTH_WAL_LOCK_CONTROL", &control_path)
            .spawn()
            .unwrap();
        let (temporary, peer) = tokio::net::UnixStream::pair().unwrap();
        drop(peer);
        let mut blocker = Self {
            child: Some(child),
            control: temporary,
        };
        let (control, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .expect("WAL helper did not connect")
            .unwrap();
        blocker.control = control;
        let mut ready = [0];
        tokio::time::timeout(
            Duration::from_secs(5),
            blocker.control.read_exact(&mut ready),
        )
        .await
        .expect("WAL helper did not acquire all reader locks")
        .unwrap();
        assert_eq!(ready, [1]);
        blocker
    }

    async fn release(mut self) {
        use tokio::io::AsyncWriteExt;
        let _ = self.control.write_all(&[1]).await;
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(status) = self.child.as_mut().unwrap().try_wait().unwrap() {
                    assert!(status.success(), "WAL reader lock helper failed");
                    self.child = None;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("WAL lock helper did not exit");
    }
}

impl Drop for SqliteReadBlocker {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn stage_barrier_cli(toolchain: &common::semantic_fixtures::TestToolchain) {
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");
    let original =
        std::fs::read_to_string(common::semantic_fixtures::fixture_server_script()).unwrap();
    let custom = original.replace(
        "if (msg.method === \"shutdown\") {",
        r#"if (msg.method === "shutdown") {
    if (fs.existsSync("./barrier_enabled")) {
      fs.writeFileSync("./teardown_started", "1");
      const deadline = Date.now() + 10000;
      while (!fs.existsSync("./teardown_resume") && Date.now() < deadline) {
        const start = Date.now();
        while (Date.now() - start < 10) {}
      }
    }"#,
    );
    std::fs::write(&cli_path, custom).expect("write barrier cli.mjs");
}

#[tokio::test]
async fn test_get_semantic_settings_default_off() {
    let _env_guard = acquire_test_env().await;
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
    assert!(body["toolchainReady"].is_boolean());
    assert_eq!(
        body["tupleIdentifier"],
        "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64"
    );
    assert_eq!(body["activeTrees"], 0);
    assert_eq!(body["openDocuments"], 0);
    assert_eq!(body["canMutate"], true);
}

#[tokio::test]
async fn test_patch_semantic_settings_requires_admin() {
    let _env_guard = acquire_test_env().await;
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
    let (_state_dev, addr_dev, _dev_token, _tc_dev) =
        create_test_app(&tmp, true, UserRole::User).await;
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
    let _env_guard = acquire_test_env().await;
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
    let _env_guard = acquire_test_env().await;
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
        .body(
            serde_json::to_vec(&json!({
                "defaults": {
                    "workspace": "/tmp/custom-workspace"
                }
            }))
            .unwrap(),
        )
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
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/ws" },
                "semantic": { "enabled": false }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp_rejected.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_raw_fs_mutation_refuses_global_config_tampering() {
    let _env_guard = acquire_test_env().await;
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
    assert!(matches!(
        err,
        dam_hopper_server::fs::FsError::MutationRefused(_)
    ));

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
        assert!(matches!(
            err_write,
            dam_hopper_server::fs::FsError::MutationRefused(_)
        ));
    }
}

#[tokio::test]
async fn test_safe_disabled_mismatch_and_admin_recovery() {
    let _env_guard = acquire_test_env().await;
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
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (_state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let resp = client
        .put(format!("http://{addr}/api/config"))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "workspace": { "name": "ws-tamper", "root": "." },
                "semantic": { "enabled": true }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dropped_toggle_request_still_completes_durable_off() {
    use axum::{extract::State, Extension, Json};
    use dam_hopper_server::api::auth::{
        AuthenticatedActor, CredentialMechanism, VerifiedAuthClaims,
    };
    use dam_hopper_server::api::semantic_settings::{patch_settings, PatchSemanticSettingsRequest};
    use std::future::Future;
    use std::task::Poll;

    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let response = Client::new()
        .patch(format!("http://{addr}/api/semantic/settings"))
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "enabled": true }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let claims = AuthClaims::decode(&token, TEST_SECRET).unwrap();
    let actor = AuthenticatedActor::with_session(
        claims.sub.clone(),
        Some(claims.exp),
        claims.sid.clone(),
        claims.auth_version,
        claims.credential_version,
        chrono::Utc::now() + chrono::Duration::days(1),
        UserRole::Admin,
    );
    let guard = state.global_config_mutation_lock.lock().await;
    let mut request = Box::pin(patch_settings(
        State(state.clone()),
        Some(Extension(actor)),
        Some(Extension(CredentialMechanism::Bearer)),
        Some(Extension(VerifiedAuthClaims(claims))),
        Json(PatchSemanticSettingsRequest { enabled: false }),
    ));
    // Poll exactly through transaction creation, then abandon the HTTP future.
    std::future::poll_fn(|cx| match request.as_mut().poll(cx) {
        Poll::Pending => Poll::Ready(()),
        Poll::Ready(_) => panic!("transaction bypassed held mutation lock"),
    })
    .await;
    drop(request);
    drop(guard);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let global = state.global_config.read().await;
            if global
                .semantic
                .as_ref()
                .is_some_and(|semantic| !semantic.enabled)
                && !state.semantic_supervisor.is_effective_enabled()
            {
                break;
            }
            drop(global);
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("detached OFF transaction did not finish");
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(!durable.semantic.unwrap().enabled);
    assert_eq!(
        state
            .semantic_supervisor
            .get_aggregate_status()
            .await
            .active_trees,
        0
    );
}

#[tokio::test]
async fn real_store_demotion_denies_stale_admin_without_policy_effects() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    // Role-only demotion leaves the signed session valid. Current store authority wins.
    let connection = rusqlite::Connection::open(tmp.path().join("auth-admin-user.db")).unwrap();
    connection
        .execute(
            "UPDATE auth_users SET role = 'user' WHERE username = ?1",
            ["admin-user"],
        )
        .unwrap();
    let before = state.semantic_supervisor.runtime_epoch();
    let response = Client::new()
        .patch(format!("http://{addr}/api/semantic/settings"))
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "enabled": true }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(state.semantic_supervisor.runtime_epoch(), before);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(!global_config_path().exists());
}

#[tokio::test]
async fn protected_config_aliases_reject_atomic_and_encrypted_sinks() {
    use dam_hopper_server::fs::{ops, secure_path, FsError};
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let config_dir = tmp.path().join(".config/dam-hopper");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::env::set_var("XDG_CONFIG_HOME", tmp.path().join(".config"));
    let global = global_config_path();
    let original = b"[semantic]\nenabled = false\n";
    std::fs::write(&global, original).unwrap();
    let alias = tmp.path().join("alias.toml");
    std::fs::hard_link(&global, &alias).unwrap();
    for path in [&global, &alias] {
        assert!(matches!(
            ops::atomic_write_with_check(path, 0, b"tampered", false).await,
            Err(FsError::MutationRefused(_))
        ));
        let temp = tempfile::NamedTempFile::new_in(tmp.path()).unwrap();
        assert!(matches!(
            ops::atomic_persist_with_check(path, 0, temp, false).await,
            Err(FsError::MutationRefused(_))
        ));
        assert!(matches!(
            dam_hopper_server::fs::decrypt_and_write(
                b"not-an-encrypted-blob",
                &[0; 32],
                path.to_path_buf()
            ),
            Err(FsError::MutationRefused(_))
        ));
        let temp = tempfile::NamedTempFile::new_in(tmp.path()).unwrap();
        assert!(matches!(
            secure_path::persist_temp_sync(
                path.parent().unwrap(),
                std::path::Path::new(path.file_name().unwrap()),
                temp,
                None,
                None,
                false,
            ),
            Err(FsError::MutationRefused(_))
        ));
    }
    assert_eq!(std::fs::read(global).unwrap(), original);
    assert_eq!(std::fs::read(alias).unwrap(), original);
}

#[tokio::test]
async fn missing_engine_fails_on_without_disclosing_release_paths() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, token, toolchain) = create_test_app(&tmp, false, UserRole::Admin).await;
    std::fs::remove_file(toolchain.root.join("lib/semantic-engine/node")).unwrap();
    let before = state.semantic_supervisor.runtime_epoch();
    let response = Client::new()
        .patch(format!("http://{addr}/api/semantic/settings"))
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "enabled": true }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response.text().await.unwrap();
    assert!(!body.contains(toolchain.root.to_str().unwrap()));
    assert!(!body.contains(tmp.path().to_str().unwrap()));
    assert_eq!(state.semantic_supervisor.runtime_epoch(), before);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(!global_config_path().exists());
    assert_eq!(
        state
            .semantic_supervisor
            .get_aggregate_status()
            .await
            .active_trees,
        0
    );
}

#[tokio::test]
async fn off_persistence_failure_retains_durable_intent_and_safe_disabled_runtime() {
    use std::os::unix::fs::PermissionsExt;
    struct RestorePermissions(std::path::PathBuf, std::fs::Permissions);
    impl Drop for RestorePermissions {
        fn drop(&mut self) {
            std::fs::set_permissions(&self.0, self.1.clone()).unwrap();
        }
    }
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();
    let url = format!("http://{addr}/api/semantic/settings");
    let enabled = client
        .patch(&url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "enabled": true }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(enabled.status(), StatusCode::OK);
    let path = global_config_path();
    let parent = path.parent().unwrap();
    let restore = RestorePermissions(
        parent.to_path_buf(),
        std::fs::metadata(parent).unwrap().permissions(),
    );
    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o500)).unwrap();
    let response = client
        .patch(&url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "enabled": false }).to_string())
        .send()
        .await
        .unwrap();
    drop(restore);
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let durable = dam_hopper_server::config::read_global_config_at(&path)
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(state.semantic_supervisor.is_safe_disabled());
    let status: Value = serde_json::from_str(
        &client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(status["configuredEnabled"], true);
    assert_eq!(status["runtimeEnabled"], false);
    let safe_status = serde_json::to_string(&status).unwrap();
    assert!(!safe_status.contains(tmp.path().to_str().unwrap()));
    assert!(status["transitionError"].is_string());
    let recovered = client
        .patch(&url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "enabled": true }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(recovered.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());
}

#[tokio::test]
async fn worktree_routes_revoke_only_removed_semantic_target() {
    use dam_hopper_server::config::schema::{ProjectConfig, ProjectType};
    use dam_hopper_server::semantic::{protocol::ConnectionId, session::SessionError};
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repository");
    let removed = tmp.path().join("removed-worktree");
    let added = tmp.path().join("added-worktree");
    std::fs::create_dir(&repo).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "fixture git command failed");
    };
    git(&["init", "-b", "main"]);
    git(&["config", "user.email", "semantic@example.invalid"]);
    git(&["config", "user.name", "Semantic Fixture"]);
    std::fs::write(repo.join("main.ts"), "export const value = 1;\n").unwrap();
    git(&["add", "main.ts"]);
    git(&["commit", "-m", "fixture"]);
    git(&[
        "worktree",
        "add",
        "-b",
        "removed",
        removed.to_str().unwrap(),
    ]);
    let (state, addr, token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    state.config.write().await.projects.push(ProjectConfig {
        name: "fixture".into(),
        path: repo.to_str().unwrap().into(),
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
    });
    let supervisor = &state.semantic_supervisor;
    supervisor.set_enabled(true).await;
    let root_connection = ConnectionId("root".into());
    let worktree_connection = ConnectionId("worktree".into());
    let root_epoch = supervisor.register_connection(&root_connection).await;
    let worktree_epoch = supervisor.register_connection(&worktree_connection).await;
    let root = supervisor
        .get_or_create_session(root_connection, "fixture", None, repo.clone(), root_epoch)
        .await
        .unwrap();
    let worktree = supervisor
        .get_or_create_session(
            worktree_connection,
            "fixture",
            Some(removed.to_str().unwrap().into()),
            removed.clone(),
            worktree_epoch,
        )
        .await
        .unwrap();
    root.initialize().await.unwrap();
    worktree.initialize().await.unwrap();
    let root_uri = url::Url::from_file_path(repo.join("main.ts"))
        .unwrap()
        .to_string();
    let worktree_uri = url::Url::from_file_path(removed.join("main.ts"))
        .unwrap()
        .to_string();
    root.did_open(
        root_uri.clone(),
        "typescript".into(),
        1,
        "export const root = 1;".into(),
    )
    .await
    .unwrap();
    worktree
        .did_open(
            worktree_uri.clone(),
            "typescript".into(),
            1,
            "export const worktree = 2;".into(),
        )
        .await
        .unwrap();
    let root_pid = root.get_pgid().await;
    let worktree_pid = worktree.get_pgid().await;
    assert!(root_pid.is_some());
    assert!(worktree_pid.is_some());
    let client = Client::new();
    let url = format!("http://{addr}/api/git/fixture/worktrees");
    let response = client
        .post(&url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "branch": "added", "path": added, "createBranch": true }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(root.get_pgid().await, root_pid);
    assert_eq!(worktree.get_pgid().await, worktree_pid);
    assert_eq!(root.get_overlay_stats().await.0, 1);
    assert_eq!(worktree.get_overlay_stats().await.0, 1);

    let response = client
        .delete(&url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "path": removed, "force": false }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(matches!(
        worktree
            .did_open(worktree_uri, "typescript".into(), 2, "retired".into())
            .await,
        Err(SessionError::Invalidated)
    ));
    assert_eq!(root.get_pgid().await, root_pid);
    assert_eq!(root.get_overlay_stats().await.0, 1);
    root.did_close(root_uri).await.unwrap();
    supervisor.prepare_disable().await.unwrap();
}

#[tokio::test]
async fn test_patch_semantic_settings_timeout_denied() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, token, _tc, db_path) =
        create_test_app_full(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let before_epoch = state.semantic_supervisor.runtime_epoch();
    let blocker = SqliteReadBlocker::acquire(&db_path, tmp.path()).await;

    let start_time = std::time::Instant::now();
    let resp = tokio::time::timeout(
        Duration::from_secs(5),
        client
            .patch(format!("http://{addr}/api/semantic/settings"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
            .send(),
    )
    .await
    .expect("HTTP request timed out waiting on server")
    .unwrap();

    let elapsed = start_time.elapsed();
    assert!(
        elapsed >= Duration::from_millis(1900),
        "Request returned too quickly ({elapsed:?}) — did not reach AUTH_STORE_LOOKUP_TIMEOUT (2s)"
    );

    blocker.release().await;

    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body: Value = serde_json::from_slice(&resp.bytes().await.unwrap()).unwrap();
    assert_eq!(body["code"], "AUTH_UNAVAILABLE");
    let recovered = client
        .get(format!("http://{addr}/api/semantic/settings"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(recovered.status(), StatusCode::OK);

    // Observable actual durable/runtime/admission unchanged
    assert_eq!(state.semantic_supervisor.runtime_epoch(), before_epoch);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(!global_config_path().exists());
    assert_eq!(
        state
            .semantic_supervisor
            .get_aggregate_status()
            .await
            .active_trees,
        0
    );
}

#[tokio::test]
async fn test_patch_semantic_settings_backend_error_denied() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, token, _tc, db_path) =
        create_test_app_full(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    // Drop auth_sessions table to produce an authentic database query failure
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute("DROP TABLE auth_sessions", []).unwrap();
    drop(conn);

    let before_epoch = state.semantic_supervisor.runtime_epoch();

    let resp = client
        .patch(format!("http://{addr}/api/semantic/settings"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    // Observable actual durable/runtime/admission unchanged
    assert_eq!(state.semantic_supervisor.runtime_epoch(), before_epoch);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(!global_config_path().exists());
    assert_eq!(
        state
            .semantic_supervisor
            .get_aggregate_status()
            .await
            .active_trees,
        0
    );
}

#[tokio::test]
async fn test_patch_semantic_settings_strict_payload_rejection() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();
    let url = format!("http://{addr}/api/semantic/settings");

    let before_epoch = state.semantic_supervisor.runtime_epoch();

    // 1. Forged role field
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true, "role": "admin" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 2. Forged role alternate field
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true, "forgedRole": "root" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 3. Unknown field
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true, "extra": "unrecognized" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 4. Missing enabled field
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({})).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 5. Type mismatch
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": "true" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 6. Malformed non-JSON syntax
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(b"not a valid json".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Assert actual durable/runtime/admission unchanged across all rejections
    assert_eq!(state.semantic_supervisor.runtime_epoch(), before_epoch);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(!global_config_path().exists());
    assert_eq!(
        state
            .semantic_supervisor
            .get_aggregate_status()
            .await
            .active_trees,
        0
    );
}

#[tokio::test]
async fn test_raw_global_ui_and_defaults_mutation_preserves_policy_from_disabled_and_enabled() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let defaults_url = format!("http://{addr}/api/global-config/defaults");
    let ui_url = format!("http://{addr}/api/global-config/ui");
    let raw_global_url = format!("http://{addr}/api/global-config");
    let settings_url = format!("http://{addr}/api/semantic/settings");

    // ==========================================
    // Phase A: Starting from Semantic DISABLED (default OFF)
    // ==========================================
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 1. Defaults omission: empty object
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({})).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path()).unwrap();
    assert!(durable.as_ref().and_then(|d| d.semantic.as_ref()).is_none());

    // 2. UI omission: empty object
    let resp = client
        .post(&ui_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({})).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 3. Defaults valid update / reset
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/disabled-ws" }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert_eq!(
        durable
            .defaults
            .as_ref()
            .and_then(|d| d.workspace.as_deref()),
        Some("/tmp/disabled-ws")
    );
    assert!(durable.semantic.is_none());

    // 4. Direct semantic injection attempt in defaults
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/ws-tamper" },
                "semantic": { "enabled": true }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 5. Direct semantic injection attempt in UI
    let resp = client
        .post(&ui_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "ui": { "theme": "dark" },
                "semantic": { "enabled": true }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 6. Nested unknown field attempt in defaults: GlobalDefaults deserialization ignores it
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/ws-nested", "semantic": { "enabled": true } }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.is_none());

    // 7. No full replacement route on /api/global-config
    let resp_put = client
        .put(&raw_global_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "semantic": { "enabled": true } })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_put.status(), StatusCode::METHOD_NOT_ALLOWED);

    let resp_patch = client
        .patch(&raw_global_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "semantic": { "enabled": true } })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_patch.status(), StatusCode::METHOD_NOT_ALLOWED);

    // ==========================================
    // Phase B: Starting from Semantic ENABLED (Admin ON)
    // ==========================================
    let resp_on = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_on.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());
    let epoch_enabled = state.semantic_supervisor.runtime_epoch();

    // 8. Defaults update preserves semantic ON
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/enabled-ws" }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());
    assert_eq!(state.semantic_supervisor.runtime_epoch(), epoch_enabled);
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert_eq!(
        durable
            .defaults
            .as_ref()
            .and_then(|d| d.workspace.as_deref()),
        Some("/tmp/enabled-ws")
    );
    assert!(durable.semantic.unwrap().enabled);

    // 9. Direct injection attempt to disable semantic via defaults is rejected
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/ws" },
                "semantic": { "enabled": false }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);

    // 10. Direct injection attempt to disable semantic via UI is rejected
    let resp = client
        .post(&ui_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "ui": { "theme": "dark" },
                "semantic": { "enabled": false }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);

    // 11. Nested unknown field attempt in defaults does not alter semantic policy
    let resp = client
        .post(&defaults_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "defaults": { "workspace": "/tmp/ws-nested2", "semantic": { "enabled": false } }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);

    // 12. No full replacement route on /api/global-config while enabled
    let resp_put = client
        .put(&raw_global_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "semantic": { "enabled": false } })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_put.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert!(state.semantic_supervisor.is_effective_enabled());
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
}

#[tokio::test]
async fn test_workspace_and_settings_writes_preserve_global_semantic_policy() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let config_url = format!("http://{addr}/api/config");
    let import_url = format!("http://{addr}/api/settings/import/workspace.toml");
    let cache_clear_url = format!("http://{addr}/api/settings/cache-clear");
    let reset_url = format!("http://{addr}/api/settings/reset");
    let known_url = format!("http://{addr}/api/workspace/known");
    let settings_url = format!("http://{addr}/api/semantic/settings");

    // ==========================================
    // Phase A: Semantic DISABLED (default OFF)
    // ==========================================
    // 1. Workspace PUT with root semantic -> 400
    let resp = client
        .put(&config_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "workspace": { "name": "ws-tamper", "root": "." },
                "semantic": { "enabled": true }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 2. Workspace PUT with server.semantic -> 400
    let resp = client
        .put(&config_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "workspace": { "name": "ws-tamper", "root": "." },
                "server": { "semantic": { "enabled": true } }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 3. Settings import with [semantic] -> 400
    let resp = client
        .post(&import_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/toml")
        .body("[workspace]\nname = \"imported\"\nroot = \".\"\n\n[semantic]\nenabled = true\n")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 4. Settings import with [server.semantic] -> 400
    let resp = client
        .post(&import_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/toml")
        .body(
            "[workspace]\nname = \"imported\"\nroot = \".\"\n\n[server.semantic]\nenabled = true\n",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 5. Valid settings import preserves disabled semantic policy
    let resp = client
        .post(&import_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/toml")
        .body("[workspace]\nname = \"valid-import\"\nroot = \".\"\n")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 6. Cache clear preserves disabled semantic policy
    let resp = client
        .post(&cache_clear_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 7. Settings reset preserves disabled semantic policy
    let resp = client
        .post(&reset_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 8. Workspace known add/remove preserves disabled semantic policy
    let resp = client
        .post(&known_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "path": "/tmp/known-1", "name": "k1" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    let resp = client
        .delete(&known_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "path": "/tmp/known-1" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // ==========================================
    // Phase B: Semantic ENABLED (Admin ON)
    // ==========================================
    let resp_on = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_on.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 9. Workspace PUT injection attempt -> 400, policy preserved ON
    let resp = client
        .put(&config_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "workspace": { "name": "ws-tamper", "root": "." },
                "semantic": { "enabled": false }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 10. Settings import injection attempt -> 400, policy preserved ON
    let resp = client
        .post(&import_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/toml")
        .body("[workspace]\nname = \"imported\"\nroot = \".\"\n\n[semantic]\nenabled = false\n")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 11. Valid settings import preserves global semantic policy ON
    let resp = client
        .post(&import_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/toml")
        .body("[workspace]\nname = \"valid-import-on\"\nroot = \".\"\n")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 12. Cache clear preserves global semantic policy ON
    let resp = client
        .post(&cache_clear_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 13. Settings reset preserves global semantic policy ON
    let resp = client
        .post(&reset_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 14. Workspace known add/remove preserves global semantic policy ON
    let resp = client
        .post(&known_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "path": "/tmp/known-2", "name": "k2" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
    assert!(state.semantic_supervisor.is_effective_enabled());

    let resp = client
        .delete(&known_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "path": "/tmp/known-2" })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);
    assert!(state.semantic_supervisor.is_effective_enabled());
}

#[tokio::test]
async fn test_final_off_demotion_failure_barrier_safe_disabled_and_recovery() {
    struct BarrierGuard(std::path::PathBuf);
    impl Drop for BarrierGuard {
        fn drop(&mut self) {
            let _ = std::fs::write(&self.0, b"1");
        }
    }

    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    stage_barrier_cli(&toolchain);

    let (state, addr, admin_token, db_path) =
        create_test_app_with_toolchain(&tmp, false, UserRole::Admin, &toolchain).await;
    let client = Client::new();
    let settings_url = format!("http://{addr}/api/semantic/settings");

    // 1. Admin turns ON
    let resp_on = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_on.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());

    // 2. Set up project repository and active session
    let repo = tmp.path().join("barrier-repo");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "fixture git command failed");
    };
    git(&["init", "-b", "main"]);
    git(&["config", "user.email", "barrier@example.invalid"]);
    git(&["config", "user.name", "Barrier Fixture"]);
    std::fs::write(repo.join("main.ts"), "export const a = 100;\n").unwrap();
    git(&["add", "main.ts"]);
    git(&["commit", "-m", "barrier initial commit"]);

    state.config.write().await.projects.push(ProjectConfig {
        name: "barrier-proj".into(),
        path: repo.to_str().unwrap().into(),
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
    });

    let supervisor = &state.semantic_supervisor;
    supervisor.set_enabled(true).await;
    let connection_id = ConnectionId("barrier-conn".into());
    let conn_epoch = supervisor.register_connection(&connection_id).await;
    let session = supervisor
        .get_or_create_session(
            connection_id,
            "barrier-proj",
            None,
            repo.clone(),
            conn_epoch,
        )
        .await
        .unwrap();
    session.initialize().await.unwrap();
    let doc_uri = url::Url::from_file_path(repo.join("main.ts"))
        .unwrap()
        .to_string();
    session
        .did_open(
            doc_uri.clone(),
            "typescript".into(),
            1,
            "export const a = 100;".into(),
        )
        .await
        .unwrap();

    let child_pid = session.get_pgid().await;
    assert!(child_pid.is_some());
    let pid = child_pid.unwrap();
    assert!(
        std::path::Path::new(&format!("/proc/{pid}")).exists(),
        "Child process must exist before teardown"
    );

    let agg_before = supervisor.get_aggregate_status().await;
    assert_eq!(agg_before.active_trees, 1);
    assert_eq!(agg_before.open_documents, 1);

    // 3. Arm the barrier in the child process working directory (repo) with drop cleanup
    std::fs::write(repo.join("barrier_enabled"), b"1").unwrap();
    let _barrier_guard = BarrierGuard(repo.join("teardown_resume"));

    // 4. Initiate Admin OFF transition in background task
    let client_bg = client.clone();
    let url_bg = settings_url.clone();
    let token_bg = admin_token.clone();
    let patch_handle = tokio::spawn(async move {
        client_bg
            .patch(&url_bg)
            .header(header::AUTHORIZATION, format!("Bearer {token_bg}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&json!({ "enabled": false })).unwrap())
            .send()
            .await
            .unwrap()
    });

    // 5. Wait for child process teardown to reach the barrier
    let started_file = repo.join("teardown_started");
    let reached = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if started_file.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert!(
        reached.is_ok(),
        "Child process teardown did not reach barrier in time"
    );

    // 6. Demote admin in SQLite store while teardown is in progress (before durable commit)
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute(
        "UPDATE auth_users SET role = 'user' WHERE username = ?1",
        ["admin-user"],
    )
    .unwrap();
    drop(conn);

    // 7. Release child process to complete teardown
    std::fs::write(repo.join("teardown_resume"), b"1").unwrap();

    // 8. Observe HTTP response from transition
    let patch_resp = tokio::time::timeout(Duration::from_secs(10), patch_handle)
        .await
        .expect("transition patch future timed out")
        .unwrap();
    assert_eq!(patch_resp.status(), StatusCode::FORBIDDEN);

    // 9. Assert exact post-teardown demotion invariant:
    // - Durable intent remains enabled (true)
    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);

    // - Runtime admission is denied and entered safe-disabled mismatch
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(state.semantic_supervisor.is_safe_disabled());

    // - Child trees are reaped and overlays are gone (never resurrected)
    let agg_after = supervisor.get_aggregate_status().await;
    assert_eq!(agg_after.active_trees, 0);
    assert_eq!(agg_after.open_documents, 0);
    assert_eq!(agg_after.total_overlay_bytes, 0);

    // - Verify physical OS process termination and reaping from /proc
    assert!(
        !std::path::Path::new(&format!("/proc/{pid}")).exists(),
        "Child process {pid} must be physically terminated and reaped from /proc"
    );

    // - Status endpoint reports truthful mismatch
    let status_resp = client
        .get(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    let status_body: Value = serde_json::from_str(&status_resp.text().await.unwrap()).unwrap();
    assert_eq!(status_body["configuredEnabled"], true);
    assert_eq!(status_body["runtimeEnabled"], false);
    assert_eq!(status_body["runtimeState"], "safe-disabled");
    assert_eq!(status_body["canMutate"], false); // demoted admin cannot mutate

    // 10. Demoted user attempts recovery -> 403 Forbidden
    let recovery_denied = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(recovery_denied.status(), StatusCode::FORBIDDEN);

    // 11. Re-promote admin in SQLite
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute(
        "UPDATE auth_users SET role = 'admin' WHERE username = ?1",
        ["admin-user"],
    )
    .unwrap();
    drop(conn);

    // 12. Fresh authorized admin performs recovery toggle: PATCH { enabled: true }
    let recovery_resp = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(recovery_resp.status(), StatusCode::OK);
    assert!(!state.semantic_supervisor.is_safe_disabled());
    assert!(state.semantic_supervisor.is_effective_enabled());

    let agg_recovered = supervisor.get_aggregate_status().await;
    assert_eq!(agg_recovered.active_trees, 0); // 0 child processes spawned on ON
    assert_eq!(agg_recovered.open_documents, 0); // old documents NOT resurrected

    // 13. Admin cleanly turns OFF
    let clean_off = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": false })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(clean_off.status(), StatusCode::OK);
    let durable_off = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(!durable_off.semantic.unwrap().enabled);
    assert!(!state.semantic_supervisor.is_effective_enabled());
}

#[tokio::test]
async fn test_off_retry_from_safe_disabled_with_failed_resources() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();
    let url = format!("http://{addr}/api/semantic/settings");

    // 1. Enable semantic
    let resp = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 2. Set up real project repository and active session
    let repo = tmp.path().join("retry-repo");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "fixture git command failed");
    };
    git(&["init", "-b", "main"]);
    git(&["config", "user.email", "retry@example.invalid"]);
    git(&["config", "user.name", "Retry Fixture"]);
    std::fs::write(repo.join("main.ts"), "export const val = 42;\n").unwrap();
    git(&["add", "main.ts"]);
    git(&["commit", "-m", "retry fixture commit"]);

    state.config.write().await.projects.push(ProjectConfig {
        name: "retry-proj".into(),
        path: repo.to_str().unwrap().into(),
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
    });

    let supervisor = &state.semantic_supervisor;
    supervisor.set_enabled(true).await;
    let conn_id = ConnectionId("retry-conn".into());
    let conn_epoch = supervisor.register_connection(&conn_id).await;
    let session = supervisor
        .get_or_create_session(conn_id, "retry-proj", None, repo.clone(), conn_epoch)
        .await
        .unwrap();
    session.initialize().await.unwrap();
    let doc_uri = url::Url::from_file_path(repo.join("main.ts"))
        .unwrap()
        .to_string();
    session
        .did_open(
            doc_uri.clone(),
            "typescript".into(),
            1,
            "export const val = 42;".into(),
        )
        .await
        .unwrap();

    let child_pid = session.get_pgid().await;
    assert!(child_pid.is_some());
    let pid = child_pid.unwrap();
    assert!(
        std::path::Path::new(&format!("/proc/{pid}")).exists(),
        "Child process must exist before failure injection"
    );

    // 3. Simulate prior disable failure entering safe-disabled
    state
        .semantic_supervisor
        .record_disable_failure("Prior teardown failure simulated".to_string())
        .await;

    assert!(state.semantic_supervisor.is_safe_disabled());
    assert!(!state.semantic_supervisor.is_effective_enabled());

    // 4. Admin retries OFF from safe-disabled state: must NOT skip cleanup as a no-op;
    // must reap all active/retained child processes
    let resp_retry_off = client
        .patch(&url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": false })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp_retry_off.status(), StatusCode::OK);

    // 5. Verify safe-disabled cleared, durable intent set to false, child tree physically terminated
    assert!(!state.semantic_supervisor.is_safe_disabled());
    assert!(!state.semantic_supervisor.is_effective_enabled());
    assert!(
        !std::path::Path::new(&format!("/proc/{pid}")).exists(),
        "Child process {pid} must be physically terminated and reaped from /proc"
    );

    let agg = supervisor.get_aggregate_status().await;
    assert_eq!(agg.active_trees, 0);
    assert_eq!(agg.open_documents, 0);

    let durable = dam_hopper_server::config::read_global_config_at(&global_config_path())
        .unwrap()
        .unwrap();
    assert!(!durable.semantic.unwrap().enabled);

    let status: Value = serde_json::from_str(
        &client
            .get(&url)
            .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(status["configuredEnabled"], false);
    assert_eq!(status["runtimeEnabled"], false);
    assert_eq!(status["runtimeState"], "disabled");
    assert!(status["transitionError"].is_null());
}

#[tokio::test]
async fn test_malformed_unrelated_raw_ui_mutation_preserves_semantic_policy() {
    let _env_guard = acquire_test_env().await;
    let tmp = TempDir::new().unwrap();
    let (state, addr, admin_token, _tc) = create_test_app(&tmp, false, UserRole::Admin).await;
    let client = Client::new();

    let settings_url = format!("http://{addr}/api/semantic/settings");
    let ui_url = format!("http://{addr}/api/global-config/ui");

    // 1. Admin turns ON semantic navigation
    let resp = client
        .patch(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(&json!({ "enabled": true })).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(state.semantic_supervisor.is_effective_enabled());
    let epoch_before = state.semantic_supervisor.runtime_epoch();

    // Verify durable file has semantic enabled
    let path = global_config_path();
    let durable = dam_hopper_server::config::read_global_config_at(&path)
        .unwrap()
        .unwrap();
    assert!(durable.semantic.unwrap().enabled);

    // 2. Corrupt the file on disk with malformed unrelated UI syntax so read_global_config_at returns Ok(None)
    std::fs::write(
        &path,
        "[semantic]\nenabled = true\n\n[ui]\ntheme = [unclosed syntax\n",
    )
    .unwrap();
    assert!(dam_hopper_server::config::read_global_config_at(&path)
        .unwrap()
        .is_none());

    // 3. Perform a UI update via POST /api/global-config/ui
    let resp_ui = client
        .post(&ui_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&json!({
                "ui": { "editorFontSize": 16 }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp_ui.status(), StatusCode::OK);

    // 4. Assert that semantic policy was NOT wiped:
    // Durable config on disk now retains semantic.enabled = true!
    let updated_durable = dam_hopper_server::config::read_global_config_at(&path)
        .unwrap()
        .unwrap();
    assert!(updated_durable.semantic.unwrap().enabled);
    assert_eq!(
        updated_durable.ui.as_ref().map(|u| u.editor_font_size),
        Some(16)
    );

    // In-memory runtime supervisor remains effective enabled, generation preserved
    assert!(state.semantic_supervisor.is_effective_enabled());
    assert_eq!(state.semantic_supervisor.runtime_epoch(), epoch_before);

    // Inspect GET /api/semantic/settings: truthful enabled state
    let get_resp = client
        .get(&settings_url)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);
    let body: Value = serde_json::from_str(&get_resp.text().await.unwrap()).unwrap();
    assert_eq!(body["configuredEnabled"], true);
    assert_eq!(body["runtimeEnabled"], true);
}
