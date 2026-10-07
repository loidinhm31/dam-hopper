//! Lite-mode integration: the selected SQLite `AuthStore` is the only authority
//! for registration, administrator checks, re-authentication, sensitive-action
//! admission and startup guards. File-backed, no MongoDB needed.
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use dam_hopper_server::api::auth::{
    get_user_role, is_enabled_user, verify_actor_credentials, AuthenticatedActor,
    CredentialVerificationError,
};
use dam_hopper_server::api::build_router;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::{AuthStore, UserRole};
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ServerConfig, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::telemetry::TelemetryRuntime;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::{Mutex, MutexGuard};
use tower::ServiceExt;

mod common;

const JWT_SECRET: &str = "test-jwt-secret-key-32-bytes-long!";

/// `AppState::new` reads RUST_ENV/ENVIRONMENT/DAM_HOPPER_MFA_KEY_FILE, so every
/// test that builds state serializes on this lock.
static ENV_LOCK: Mutex<()> = Mutex::const_new(());

/// Scoped environment variable that restores the previous value on drop.
struct EnvVar(&'static str, Option<std::ffi::OsString>);

impl EnvVar {
    fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self(key, previous)
    }
}

impl Drop for EnvVar {
    fn drop(&mut self) {
        match &self.1 {
            Some(value) => std::env::set_var(self.0, value),
            None => std::env::remove_var(self.0),
        }
    }
}

fn new_state(tmp: &TempDir, store: Option<AuthStore>, no_auth: bool) -> anyhow::Result<AppState> {
    let root = tmp.path().to_path_buf();
    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "lite".into(),
            root: root.display().to_string(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: root.join("dam-hopper.toml"),
    };
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    AppState::new(
        root.clone(),
        config,
        GlobalConfig::default(),
        pty_manager,
        dam_hopper_server::agent_store::AgentStoreService::new(
            root.join(".dam-hopper/agent-store"),
        ),
        event_sink,
        JWT_SECRET.to_string(),
        FsSubsystem::new(vec![]),
        store,
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(root.join("diagnostics.jsonl")),
        TelemetryRuntime::new(),
    )
}

struct Lite {
    app: axum::Router,
    state: AppState,
    store: AuthStore,
    db_path: PathBuf,
    tmp: TempDir,
    _env: MutexGuard<'static, ()>,
}

async fn lite() -> Lite {
    let env = ENV_LOCK.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("state").join("auth.db");
    let store = AuthStore::open_sqlite(&db_path)
        .await
        .expect("open sqlite store");
    // Normal production construction: AppState builds the AuthService from the selected store.
    let state = new_state(&tmp, Some(store.clone()), false).expect("lite AppState");
    Lite {
        app: build_router(state.clone()),
        state,
        store,
        db_path,
        tmp,
        _env: env,
    }
}

/// Independent connection standing in for the operator's local `sqlite3`.
fn operator(db_path: &Path) -> rusqlite::Connection {
    let connection = rusqlite::Connection::open(db_path).unwrap();
    connection
        .busy_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    connection
}

async fn register(app: &axum::Router, username: &str, password: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "username": username, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Active full-access session for `username` (registered users have authVersion 0).
async fn bearer_for(lite: &Lite, username: &str) -> String {
    let now = Utc::now();
    let expires = now + ChronoDuration::days(30);
    let session = AuthSession {
        id: format!("sess-{}", uuid::Uuid::new_v4().simple()),
        username: username.to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(expires),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
    };
    lite.store.create_session(session.clone()).await.unwrap();
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: username.to_string(),
        sid: session.id,
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: expires.timestamp() as usize,
    };
    claims.encode(JWT_SECRET).unwrap()
}

async fn get(app: &axum::Router, uri: &str, bearer: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn register_stores_a_disabled_user_and_rejects_duplicates() {
    let lite = lite().await;

    let (status, body) = register(&lite.app, "alice", "correct horse").await;
    assert_eq!((status, &body), (StatusCode::OK, &json!({ "ok": true })));

    let user = lite
        .store
        .get_user("alice")
        .await
        .unwrap()
        .expect("persisted");
    assert!(!user.is_enabled, "registration never self-approves");
    assert_eq!(user.role, dam_hopper_server::auth::UserRole::User);
    assert_eq!(user.auth_version, 0);
    assert!(user.mfa.is_none());
    assert!(bcrypt::verify("correct horse", &user.password_hash).unwrap());
    assert_ne!(user.password_hash, "correct horse");

    let (status, body) = register(&lite.app, "alice", "another").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "User already exists");
    let still = lite.store.get_user("alice").await.unwrap().unwrap();
    assert_eq!(
        still.password_hash, user.password_hash,
        "duplicate never overwrites"
    );
}

#[tokio::test]
async fn register_never_reports_success_when_storage_fails_or_is_absent() {
    let lite = lite().await;
    operator(&lite.db_path)
        .execute_batch("DROP TABLE auth_users")
        .expect("operator drops table");
    let (status, body) = register(&lite.app, "bob", "pw").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_ne!(body, json!({ "ok": true }));

    let no_store = new_state(&lite.tmp, None, false).unwrap();
    let (status, body) = register(&build_router(no_store), "bob", "pw").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_ne!(body, json!({ "ok": true }));
}

#[tokio::test]
async fn administrator_gate_follows_the_selected_store() {
    let lite = lite().await;
    for name in ["root", "member", "pending"] {
        assert_eq!(register(&lite.app, name, "pw").await.0, StatusCode::OK);
    }
    let root = bearer_for(&lite, "root").await;
    let member = bearer_for(&lite, "member").await;
    let pending = bearer_for(&lite, "pending").await;

    // Operator approval + role assignment: local SQL on an independent connection.
    operator(&lite.db_path)
        .execute_batch(
            "UPDATE auth_users SET is_enabled = 1 WHERE username IN ('member','root');
             UPDATE auth_users SET role = 'admin' WHERE username = 'root';",
        )
        .unwrap();

    let (status, body) = get(&lite.app, "/api/advisor/status", &member).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "AdminRoleRequired");

    let (status, _) = get(&lite.app, "/api/advisor/status", &pending).await;
    assert!(
        matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN),
        "unapproved account denied, got {status}"
    );

    let (status, body) = get(&lite.app, "/api/advisor/status", &root).await;
    assert_ne!(body["code"], "AdminRoleRequired", "admin passes the gate");
    assert!(
        status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
        "admin reaches the handler, got {status}"
    );

    // Demotion and disablement take effect on the next request.
    operator(&lite.db_path)
        .execute_batch("UPDATE auth_users SET role = 'user' WHERE username = 'root'")
        .unwrap();
    let (status, body) = get(&lite.app, "/api/advisor/status", &root).await;
    assert_eq!(
        (status, &body["code"]),
        (StatusCode::FORBIDDEN, &json!("AdminRoleRequired"))
    );
}

#[tokio::test]
async fn reauthentication_verifies_same_subject_password_against_sqlite() {
    let lite = lite().await;
    assert_eq!(
        register(&lite.app, "carol", "s3cret").await.0,
        StatusCode::OK
    );
    let actor = AuthenticatedActor::new("carol", None);

    async fn attempt(
        state: &AppState,
        actor: &AuthenticatedActor,
        username: &str,
        password: &str,
    ) -> (Result<(), CredentialVerificationError>, String) {
        let mut password = password.to_string();
        let result = verify_actor_credentials(state, actor, username, &mut password).await;
        (result, password)
    }

    // Disabled until the operator approves, even with the right password.
    let (result, wiped) = attempt(&lite.state, &actor, "carol", "s3cret").await;
    assert_eq!(result, Err(CredentialVerificationError::AccountDisabled));
    assert!(wiped.is_empty(), "password zeroized");

    operator(&lite.db_path)
        .execute_batch("UPDATE auth_users SET is_enabled = 1 WHERE username = 'carol'")
        .unwrap();

    let (result, wiped) = attempt(&lite.state, &actor, "carol", "s3cret").await;
    assert_eq!(result, Ok(()));
    assert!(wiped.is_empty());
    assert_eq!(
        attempt(&lite.state, &actor, "carol", "wrong").await.0,
        Err(CredentialVerificationError::InvalidCredentials)
    );
    assert_eq!(
        attempt(&lite.state, &actor, "mallory", "s3cret").await.0,
        Err(CredentialVerificationError::ActorMismatch)
    );
    let missing = AuthenticatedActor::new("nobody", None);
    assert_eq!(
        attempt(&lite.state, &missing, "nobody", "s3cret").await.0,
        Err(CredentialVerificationError::InvalidCredentials)
    );

    let no_store = new_state(&lite.tmp, None, false).unwrap();
    assert_eq!(
        attempt(&no_store, &actor, "carol", "s3cret").await.0,
        Err(CredentialVerificationError::AuthenticationUnavailable)
    );
}

#[tokio::test]
async fn host_action_availability_is_derived_from_the_selected_store() {
    let lite = lite().await;
    assert_eq!(register(&lite.app, "dave", "pw").await.0, StatusCode::OK);
    let token = bearer_for(&lite, "dave").await;
    operator(&lite.db_path)
        .execute_batch("UPDATE auth_users SET is_enabled = 1 WHERE username = 'dave'")
        .unwrap();
    let (status, body) = get(&lite.app, "/api/system/actions/v1/capabilities", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["reason"], "helperNotEnrolled",
        "store present: only helper missing"
    );

    // Same router wiring without a store must report auth unavailable, never a default account.
    let no_store = new_state(&lite.tmp, None, false).unwrap();
    assert_eq!(
        no_store
            .host_actions
            .capabilities(false, no_store.auth_service.store().is_some())
            .reason,
        "reauthUnavailable"
    );
    let (status, _) = get(
        &build_router(no_store),
        "/api/system/actions/v1/capabilities",
        &token,
    )
    .await;
    assert!(
        matches!(
            status,
            StatusCode::UNAUTHORIZED | StatusCode::SERVICE_UNAVAILABLE
        ),
        "no store means no authenticated access, got {status}"
    );
}

#[tokio::test]
async fn startup_guards_apply_to_the_selected_store() {
    let _env = ENV_LOCK.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    let store = AuthStore::open_sqlite(tmp.path().join("auth.db"))
        .await
        .unwrap();

    // --no-auth + any active store is refused (SQLite included).
    let error = new_state(&tmp, Some(store.clone()), true)
        .err()
        .expect("no-auth + sqlite");
    assert!(
        error
            .to_string()
            .contains("authentication store is configured"),
        "{error}"
    );

    let _production = EnvVar::set("RUST_ENV", "production");

    // Production without a store fails, whichever backend would have provided it.
    let error = new_state(&tmp, None, false)
        .err()
        .expect("production without store");
    assert!(
        error
            .to_string()
            .contains("authentication store is required in production"),
        "{error}"
    );

    // Production with SQLite but no MFA key fails.
    let error = new_state(&tmp, Some(store.clone()), false)
        .err()
        .expect("production without key");
    assert!(
        error
            .to_string()
            .contains("DAM_HOPPER_MFA_KEY_FILE is required"),
        "{error}"
    );

    // Production with SQLite and a valid owner-only key file succeeds.
    let key_path = tmp.path().join("mfa.key");
    std::fs::write(&key_path, "6b".repeat(32)).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let _key = EnvVar::set("DAM_HOPPER_MFA_KEY_FILE", &key_path);
    let state = new_state(&tmp, Some(store), false).expect("production lite with key");
    assert!(state.auth_service.store().is_some());
    assert!(state.auth_service.mfa_key().is_some());

    // Production --no-auth stays forbidden.
    let error = new_state(&tmp, None, true)
        .err()
        .expect("production no-auth");
    assert!(
        error.to_string().contains("not allowed in production"),
        "{error}"
    );
}

async fn post_bearer(
    app: &axum::Router,
    uri: &str,
    bearer: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ORIGIN, "http://127.0.0.1:4801")
                .header(header::HOST, "127.0.0.1:4801")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn routed_sensitive_action_is_denied_once_the_same_session_account_is_disabled() {
    let lite = lite().await;
    assert_eq!(register(&lite.app, "erin", "pw").await.0, StatusCode::OK);
    let token = bearer_for(&lite, "erin").await;
    let uri = "/api/system/idle-suspend/v1/force-suspend";
    let body = json!({ "wakeAfterSeconds": 0, "force": false });

    // Pending approval: the session is not even authenticated.
    let (status, _) = post_bearer(&lite.app, uri, &token, body.clone()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    operator(&lite.db_path)
        .execute_batch("UPDATE auth_users SET is_enabled = 1 WHERE username = 'erin'")
        .unwrap();
    let (status, response) = post_bearer(&lite.app, uri, &token, body.clone()).await;
    // Authenticated and past the enabled-actor gate; the stopped coordinator is the only refusal.
    assert_eq!(
        (status, &response["code"]),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            &json!("idleSuspendTimingUnavailable")
        )
    );

    // The same session loses access as soon as the operator disables the account.
    operator(&lite.db_path)
        .execute_batch("UPDATE auth_users SET is_enabled = 0 WHERE username = 'erin'")
        .unwrap();
    let (status, response) = post_bearer(&lite.app, uri, &token, body).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_ne!(response["code"], "idleSuspendTimingUnavailable");
}

#[tokio::test]
async fn storage_failure_denies_admin_actor_and_reauthentication_consumers() {
    let lite = lite().await;
    assert_eq!(register(&lite.app, "root", "pw").await.0, StatusCode::OK);
    operator(&lite.db_path)
        .execute_batch(
            "UPDATE auth_users SET is_enabled = 1, role = 'admin' WHERE username = 'root'",
        )
        .unwrap();
    let token = bearer_for(&lite, "root").await;
    let actor = AuthenticatedActor::new("root", None);
    let admin_route = "/api/advisor/status";

    // Controls: every consumer admits the healthy administrator.
    let (status, _) = get(&lite.app, admin_route, &token).await;
    assert!(
        status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
        "{status}"
    );
    assert_eq!(
        get_user_role(lite.state.auth_service.store(), "root").await,
        Some(UserRole::Admin)
    );
    assert!(is_enabled_user(lite.state.auth_service.store(), "root").await);
    let mut password = "pw".to_string();
    assert_eq!(
        verify_actor_credentials(&lite.state, &actor, "root", &mut password).await,
        Ok(())
    );

    // Genuine storage error (not a missing or disabled account): the accounts table vanishes.
    operator(&lite.db_path)
        .execute_batch("DROP TABLE auth_users")
        .unwrap();

    // Session evaluation fails closed before `require_admin` runs, so the route is denied.
    let (status, _) = get(&lite.app, admin_route, &token).await;
    assert!(
        !status.is_success(),
        "storage failure must deny, got {status}"
    );
    assert_ne!(status, StatusCode::NOT_FOUND);

    // The lookups behind `require_admin`, the actor gates and re-authentication deny directly.
    let store = lite.state.auth_service.store();
    assert!(
        lite.store.get_user("root").await.is_err(),
        "fault is a real error"
    );
    assert_eq!(get_user_role(store, "root").await, None);
    assert!(!is_enabled_user(store, "root").await);
    let mut password = "pw".to_string();
    assert_eq!(
        verify_actor_credentials(&lite.state, &actor, "root", &mut password).await,
        Err(CredentialVerificationError::InvalidCredentials)
    );
    assert!(password.is_empty(), "password zeroized on the failure path");
}
