use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, ORIGIN};
use axum::http::{HeaderValue, Request, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tower::ServiceExt;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::browser_host::global_session_registry;
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::cdp::{CdpClient, NativeTargetInfo};
use dam_hopper_server::browser_host::config::{BrowserBudgetsConfig, BrowserHostConfig};
use dam_hopper_server::browser_host::manager::NativeTargetEvent;
use dam_hopper_server::browser_host::media::{get_producer, GLOBAL_PRODUCERS};
use dam_hopper_server::browser_host::network_policy::NetworkPolicy;
use dam_hopper_server::browser_host::process::{
    find_browser_executable, BrowserLaunchConfig, BrowserProcess,
};
use dam_hopper_server::browser_host::protocol::TargetGeometry;
use dam_hopper_server::browser_host::screencast::ScreencastProducer;
use dam_hopper_server::browser_host::session::IDEMPOTENCY_TTL;
use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use opaque_ke::ServerSetup;

static ENV_LOCK: Mutex<()> = Mutex::new(());

const JWT_SECRET: &str = "test-jwt-secret-key-1234567890";

fn create_test_state(workspace_root: PathBuf, no_auth: bool) -> AppState {
    build_state(workspace_root, no_auth, None)
}

/// `browser: None` builds the mock-handle state used by admission tests; `Some(config)` builds a
/// state whose manager launches a real Chromium.
fn build_state(
    workspace_root: PathBuf,
    no_auth: bool,
    browser: Option<BrowserHostConfig>,
) -> AppState {
    let _guard = ENV_LOCK.lock();

    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let mut server_config = dam_hopper_server::config::ServerConfig::default();
    match &browser {
        Some(browser) => server_config.browser = browser.clone(),
        None => server_config.browser.enabled = true,
    }

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: server_config,
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager =
        TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver));
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_root.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        JWT_SECRET.to_string(),
        fs,
        None,
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
    )
    .expect("create test AppState");

    if browser.is_none() {
        *state.browser_host._test_mock_handle.write() = Some(
            dam_hopper_server::browser_host::manager::BrowserInstanceHandle {
                subject: "test-user".to_string(),
                is_dev: false,
                pid: 1234,
                ws_endpoint: "ws://127.0.0.1:9222/devtools/browser/mock".to_string(),
                browser_incarnation: "test-incarnation".to_string(),
                profile_epoch: 1,
                user_data_dir: workspace_root.join("mock-user-data"),
            },
        );
    }
    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }

    state
}

fn make_user_token(username: &str, role: UserRole, is_enabled: bool) -> (AuthService, String) {
    let now = Utc::now();
    let exp = now + ChronoDuration::days(1);

    let user = UserRecord {
        id: None,
        username: username.to_string(),
        password_hash: String::new(),
        is_enabled,
        role,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };

    let session = AuthSession {
        id: format!("session-for-{username}"),
        username: username.to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };

    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: username.to_string(),
        sid: format!("session-for-{username}"),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };

    let token = claims.encode(JWT_SECRET).expect("encode claims");
    let auth_service = AuthService::new_mock(user, session);

    (auth_service, token)
}

#[tokio::test]
async fn test_unauthenticated_request_rejected() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(resp.headers().get(CACHE_CONTROL).unwrap(), "no-store");

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["kind"], "unauthorized");
}

#[tokio::test]
async fn test_ordinary_user_rejected_with_admin_required() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("ordinary-user", UserRole::User, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    assert_eq!(resp.headers().get(CACHE_CONTROL).unwrap(), "no-store");

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["kind"], "adminRequired");
}

#[tokio::test]
async fn test_disabled_user_rejected_with_account_disabled() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("disabled-admin", UserRole::Admin, false);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["kind"], "accountDisabled");
}

#[tokio::test]
async fn test_admin_admission_success_and_capabilities() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("super-admin", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers().get(CACHE_CONTROL).unwrap(), "no-store");

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["protocolVersion"], 1);
}

#[tokio::test]
async fn test_dev_mode_loopback_and_origin_gates() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), true);
    // Dev admission trusts only the address the listener actually bound to.
    state
        .record_bound_listener("127.0.0.1:4801".parse().unwrap())
        .unwrap();
    let allowed_origin = HeaderValue::from_static("http://127.0.0.1:5173");
    let app = build_router_with_origins(state, vec![allowed_origin]);

    // 1. Loopback peer + matching Origin header -> OK
    let loopback_addr: SocketAddr = "127.0.0.1:45678".parse().unwrap();
    let mut req1 = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(ORIGIN, "http://127.0.0.1:5173")
        .body(Body::empty())
        .unwrap();
    req1.extensions_mut().insert(ConnectInfo(loopback_addr));

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // 2. Loopback peer + NO Origin header (native local agent) -> OK
    let mut req2 = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .body(Body::empty())
        .unwrap();
    req2.extensions_mut().insert(ConnectInfo(loopback_addr));

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    // 3. Non-loopback peer (e.g. 192.168.1.100) -> 403 devBypassDenied
    let non_loopback_addr: SocketAddr = "192.168.1.100:45678".parse().unwrap();
    let mut req3 = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .body(Body::empty())
        .unwrap();
    req3.extensions_mut().insert(ConnectInfo(non_loopback_addr));

    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::FORBIDDEN);
    let body3 = axum::body::to_bytes(resp3.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json3: Value = serde_json::from_slice(&body3).unwrap();
    assert_eq!(json3["kind"], "devBypassDenied");

    // 4. Loopback peer + mismatched Origin header (e.g. evil.com) -> 403 devBypassDenied
    let mut req4 = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(ORIGIN, "http://evil.com")
        .body(Body::empty())
        .unwrap();
    req4.extensions_mut().insert(ConnectInfo(loopback_addr));

    let resp4 = app.oneshot(req4).await.unwrap();
    assert_eq!(resp4.status(), StatusCode::FORBIDDEN);
    let body4 = axum::body::to_bytes(resp4.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json4: Value = serde_json::from_slice(&body4).unwrap();
    assert_eq!(json4["kind"], "devBypassDenied");
}

#[tokio::test]
async fn test_idempotent_session_creation_retry_and_caps() {
    let Some(env) = native_env("admin-session-test", 2, vec![]).await else {
        return;
    };
    let app = env.app.clone();
    let token = env.token.clone();

    let creation_key1 = uuid::Uuid::new_v4().to_string();
    let payload1 = json!({
        "creationKey": creation_key1,
        "url": "about:blank",
        "viewport": {
            "width": 1280,
            "height": 900,
            "dpr": 1.0
        }
    });

    // 1. First create -> 201 Created
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload1).unwrap()))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);
    assert_eq!(resp1.headers().get(CACHE_CONTROL).unwrap(), "no-store");
    let body1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp1.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    let session_id1 = body1["browserSessionId"].as_str().unwrap().to_string();

    // 2. Retry identical creationKey -> 200 OK with same browserSessionId
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload1).unwrap()))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body2["browserSessionId"].as_str().unwrap(), session_id1);

    // 3. Retry same creationKey with different URL -> 409 Conflict
    let payload_conflict = json!({
        "creationKey": creation_key1,
        "url": "https://example.com/other",
        "viewport": {
            "width": 1280,
            "height": 900,
            "dpr": 1.0
        }
    });
    let req3 = Request::builder()
        .method("POST")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload_conflict).unwrap()))
        .unwrap();

    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::CONFLICT);
    let body3: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp3.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body3["kind"], "sessionConflict");

    // 4. Create second session with different key -> 201 Created (distinct session)
    let creation_key2 = uuid::Uuid::new_v4().to_string();
    let payload2 = json!({
        "creationKey": creation_key2,
        "url": "about:blank",
        "viewport": {
            "width": 1280,
            "height": 900,
            "dpr": 1.0
        }
    });
    let req4 = Request::builder()
        .method("POST")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload2).unwrap()))
        .unwrap();

    let resp4 = app.clone().oneshot(req4).await.unwrap();
    assert_eq!(resp4.status(), StatusCode::CREATED);
    let body4: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp4.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    let session_id2 = body4["browserSessionId"].as_str().unwrap().to_string();
    assert_ne!(session_id1, session_id2);

    // 5. Creating a 3rd session exceeds capacity (2) -> 429 Too Many Requests
    let creation_key3 = uuid::Uuid::new_v4().to_string();
    let payload3 = json!({
        "creationKey": creation_key3,
        "url": "about:blank",
        "viewport": {
            "width": 1280,
            "height": 900,
            "dpr": 1.0
        }
    });
    let req5 = Request::builder()
        .method("POST")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload3).unwrap()))
        .unwrap();

    let resp5 = app.clone().oneshot(req5).await.unwrap();
    assert_eq!(resp5.status(), StatusCode::TOO_MANY_REQUESTS);
    let body5: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp5.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body5["kind"], "browserBusy");

    // 6. Delete session 1 -> frees target count
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/browser/sessions/{session_id1}"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::OK);

    // 7. Retrying delete is idempotent -> 200 OK
    let req_del_retry = Request::builder()
        .method("DELETE")
        .uri(format!("/api/browser/sessions/{session_id1}"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp_del_retry = app.clone().oneshot(req_del_retry).await.unwrap();
    assert_eq!(resp_del_retry.status(), StatusCode::OK);

    // 8. Now session 3 can be created -> 201 Created
    let req6 = Request::builder()
        .method("POST")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&payload3).unwrap()))
        .unwrap();

    let resp6 = app.oneshot(req6).await.unwrap();
    assert_eq!(resp6.status(), StatusCode::CREATED);
    env.state.browser_host.shutdown_all().await;
}

#[tokio::test]
async fn test_url_policy_enforcement() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-policy-test", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let test_cases = [
        ("file:///etc/passwd", "policyViolation"),
        ("data:text/html,<h1>Hello</h1>", "policyViolation"),
        ("javascript:alert(1)", "policyViolation"),
        ("chrome://settings", "policyViolation"),
        ("http://user:pass@example.com/", "policyViolation"),
        (
            "http://169.254.169.254/latest/meta-data/",
            "policyViolation",
        ),
    ];

    for (bad_url, expected_kind) in test_cases {
        let payload = json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": bad_url,
            "viewport": {
                "width": 1280,
                "height": 900,
                "dpr": 1.0
            }
        });

        let req = Request::builder()
            .method("POST")
            .uri("/api/browser/sessions")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&payload).unwrap()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body: Value = serde_json::from_slice(
            &axum::body::to_bytes(resp.into_body(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body["kind"], expected_kind);
    }
}

async fn dev_capabilities_status(bound: Option<&str>, peer: &str) -> (StatusCode, Option<String>) {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), true);
    if let Some(bound) = bound {
        state.record_bound_listener(bound.parse().unwrap()).unwrap();
    }
    let app = build_router_with_origins(state, vec![]);
    let mut req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap_or(Value::Null);
    (status, body["kind"].as_str().map(str::to_string))
}

/// LA:L1 — a loopback PEER is not enough: the actual bound listener must be loopback too, so a
/// wildcard (or never-recorded) listener can never serve the dev bypass.
#[tokio::test]
async fn test_dev_bypass_requires_bound_loopback_listener() {
    let loopback_peer = "127.0.0.1:50001";

    let (status, _) = dev_capabilities_status(Some("127.0.0.1:4801"), loopback_peer).await;
    assert_eq!(status, StatusCode::OK, "loopback listener + loopback peer");
    let (status, _) = dev_capabilities_status(Some("[::1]:4801"), "[::1]:50001").await;
    assert_eq!(status, StatusCode::OK, "IPv6 loopback listener + peer");

    for wildcard in ["0.0.0.0:4801", "[::]:4801", "192.168.1.10:4801"] {
        let (status, kind) = dev_capabilities_status(Some(wildcard), loopback_peer).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "listener {wildcard}");
        assert_eq!(
            kind.as_deref(),
            Some("devBypassDenied"),
            "listener {wildcard}"
        );
    }

    // Listener never recorded (not bound yet) fails closed.
    let (status, kind) = dev_capabilities_status(None, loopback_peer).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(kind.as_deref(), Some("devBypassDenied"));

    // Loopback listener but non-loopback peer is still denied.
    let (status, kind) =
        dev_capabilities_status(Some("127.0.0.1:4801"), "192.168.1.100:50001").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(kind.as_deref(), Some("devBypassDenied"));
}

/// Forwarded headers never grant dev authority to a non-loopback peer.
#[tokio::test]
async fn test_forwarded_headers_never_authorize_dev_bypass() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), true);
    state
        .record_bound_listener("127.0.0.1:4801".parse().unwrap())
        .unwrap();
    let app = build_router_with_origins(state, vec![]);
    let mut req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header("x-forwarded-for", "127.0.0.1")
        .header("forwarded", "for=127.0.0.1")
        .header("x-real-ip", "127.0.0.1")
        .body(Body::empty())
        .unwrap();
    req.extensions_mut().insert(ConnectInfo(
        "203.0.113.9:50001".parse::<SocketAddr>().unwrap(),
    ));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

async fn admin_capabilities_with_origin(
    allowlist: Vec<HeaderValue>,
    origin: Option<HeaderValue>,
) -> StatusCode {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-origin-test", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, allowlist);
    let mut builder = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {token}"));
    if let Some(origin) = origin {
        builder = builder.header(ORIGIN, origin);
    }
    app.oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

/// LA:L11 — exact Origin: empty, malformed, non-UTF8, `null`, non-canonical and unapproved
/// values are denied even with a valid Admin bearer; an EMPTY allowlist never approves an
/// Origin-bearing request; Origin-less bearer requests (native tools) still work.
#[tokio::test]
async fn test_rest_origin_is_exact_and_empty_allowlist_is_not_unrestricted() {
    let approved = HeaderValue::from_static("https://app.example");
    let allow = || vec![approved.clone()];

    assert_eq!(
        admin_capabilities_with_origin(allow(), Some(approved.clone())).await,
        StatusCode::OK
    );
    assert_eq!(
        admin_capabilities_with_origin(allow(), None).await,
        StatusCode::OK,
        "Origin-less bearer request"
    );

    let denied: Vec<(&str, HeaderValue)> = vec![
        ("empty", HeaderValue::from_static("")),
        ("null", HeaderValue::from_static("null")),
        ("non-utf8", HeaderValue::from_bytes(&[0xff, 0xfe]).unwrap()),
        (
            "trailing slash",
            HeaderValue::from_static("https://app.example/"),
        ),
        ("path", HeaderValue::from_static("https://app.example/x")),
        (
            "comma list",
            HeaderValue::from_static("https://app.example, https://evil.example"),
        ),
        ("scheme-less", HeaderValue::from_static("app.example")),
        (
            "different scheme",
            HeaderValue::from_static("http://app.example"),
        ),
        (
            "different case host",
            HeaderValue::from_static("https://APP.example"),
        ),
        (
            "unapproved",
            HeaderValue::from_static("https://evil.example"),
        ),
    ];
    for (label, origin) in denied {
        let status = admin_capabilities_with_origin(allow(), Some(origin)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{label}");
    }

    // Empty allowlist: any Origin-bearing request is denied, not unrestricted.
    for origin in ["https://app.example", "https://evil.example", ""] {
        let status = admin_capabilities_with_origin(
            Vec::new(),
            Some(HeaderValue::from_str(origin).unwrap()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "empty allowlist, origin {origin:?}"
        );
    }
    assert_eq!(
        admin_capabilities_with_origin(Vec::new(), None).await,
        StatusCode::OK
    );
}

/// Duplicate Origin headers are rejected as one unit.
#[tokio::test]
async fn test_rest_duplicate_origin_headers_denied() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-dup-origin", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app =
        build_router_with_origins(state, vec![HeaderValue::from_static("https://app.example")]);
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ORIGIN, "https://app.example")
        .header(ORIGIN, "https://app.example")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// ---------------------------------------------------------------------------
// LA:L1 — central request policy observed on real Chromium via local HTTP servers
// ---------------------------------------------------------------------------

type Hits = Arc<std::sync::Mutex<Vec<String>>>;

/// Local HTTP origin that records every request path it receives. `redirect_to` makes
/// `/redirect` answer 302 to that absolute URL; `/page` embeds one allowed and one
/// `foreign_img` subresource.
async fn spawn_origin(redirect_to: Option<String>, foreign_img: Option<String>) -> (u16, Hits) {
    use axum::extract::State;
    use axum::http::Uri;
    use axum::response::IntoResponse;

    #[derive(Clone)]
    struct Origin {
        hits: Hits,
        redirect_to: Option<String>,
        foreign_img: Option<String>,
        port: Arc<std::sync::atomic::AtomicU16>,
    }

    async fn handle(State(o): State<Origin>, uri: Uri) -> axum::response::Response {
        o.hits.lock().unwrap().push(uri.path().to_string());
        match uri.path() {
            "/redirect" => match &o.redirect_to {
                Some(to) => (
                    StatusCode::FOUND,
                    [(axum::http::header::LOCATION, to.clone())],
                )
                    .into_response(),
                None => StatusCode::NOT_FOUND.into_response(),
            },
            "/page" => {
                let port = o.port.load(std::sync::atomic::Ordering::SeqCst);
                let foreign = o
                    .foreign_img
                    .as_deref()
                    .map(|u| format!("<img src=\"{u}\">"))
                    .unwrap_or_default();
                axum::response::Html(format!(
                    "<html><body><img src=\"http://127.0.0.1:{port}/ok.png\">{foreign}</body></html>"
                ))
                .into_response()
            }
            _ => (
                [(axum::http::header::CONTENT_TYPE, "image/png")],
                vec![0u8; 8],
            )
                .into_response(),
        }
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits: Hits = Arc::new(std::sync::Mutex::new(Vec::new()));
    let origin = Origin {
        hits: hits.clone(),
        redirect_to,
        foreign_img,
        port: Arc::new(std::sync::atomic::AtomicU16::new(port)),
    };
    let app = axum::Router::new().fallback(handle).with_state(origin);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (port, hits)
}

fn hit_count(hits: &Hits, path: &str) -> usize {
    hits.lock().unwrap().iter().filter(|p| *p == path).count()
}

async fn wait_until(what: &str, cond: impl Fn() -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !cond() {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

async fn new_producer(
    client: &Arc<CdpClient>,
    policy: Option<Arc<NetworkPolicy>>,
) -> ScreencastProducer {
    use chromiumoxide_cdp::cdp::browser_protocol::target::CreateTargetParams;
    let target = client
        .send_typed(
            CreateTargetParams::builder()
                .url("about:blank")
                .build()
                .unwrap(),
            None,
        )
        .await
        .expect("Target.createTarget");
    let geometry = TargetGeometry {
        css_width: 800.0,
        css_height: 600.0,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    };
    let producer = ScreencastProducer::new(
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
        1,
        1,
        client.clone(),
        target.target_id.into(),
        geometry,
    );
    match policy {
        Some(policy) => producer.with_request_policy(policy, std::sync::Arc::new(|_: &str| {})),
        None => producer,
    }
}

async fn navigate(producer: &ScreencastProducer, url: &str) {
    let sid = producer.ensure_page_session().await.expect("page session");
    producer
        .cdp_client
        .send_command("Page.navigate", Some(json!({ "url": url })), Some(&sid))
        .await
        .expect("Page.navigate");
}

/// The policy is installed by `ensure_page_session` BEFORE the first navigation: a redirect to
/// a forbidden origin and a forbidden subresource must never reach the forbidden server, while
/// the configured target origin and its same-origin assets still load. A control target
/// without a policy proves the forbidden server really is reachable and observed.
#[tokio::test]
async fn test_request_policy_blocks_forbidden_redirect_and_subresource_on_chromium() {
    let Ok(exec) = find_browser_executable(None).or_else(|_| {
        [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.is_file())
        .ok_or(())
    }) else {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("Required Chrome/Chromium executable not found on host");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };

    // Forbidden origin B and allowed target origin A (distinct ports, both loopback).
    let (b_port, b_hits) = spawn_origin(None, None).await;
    let forbidden_img = format!("http://127.0.0.1:{b_port}/sub.png");
    let forbidden_landing = format!("http://127.0.0.1:{b_port}/landing");
    let (a_port, a_hits) = spawn_origin(Some(forbidden_landing), Some(forbidden_img)).await;

    let config = BrowserHostConfig {
        allowed_target_origins: vec![format!("http://127.0.0.1:{a_port}")],
        ..BrowserHostConfig::default()
    };
    let policy = Arc::new(NetworkPolicy::from_config(&config, false).unwrap());

    let tmp = tempdir().unwrap();
    let mut launch = BrowserLaunchConfig::new(tmp.path().join("policy-profile"));
    launch.executable_path = Some(exec);
    launch.headless = true;
    let mut process = BrowserProcess::launch(launch)
        .await
        .expect("browser launch");
    let client = CdpClient::connect(process.ws_endpoint())
        .await
        .expect("cdp connect");

    // Control: no policy → both the redirect landing and the subresource reach B.
    let control = new_producer(&client, None).await;
    navigate(&control, &format!("http://127.0.0.1:{a_port}/redirect")).await;
    wait_until("control redirect landing", || {
        hit_count(&b_hits, "/landing") >= 1
    })
    .await;
    navigate(&control, &format!("http://127.0.0.1:{a_port}/page")).await;
    wait_until("control subresource", || {
        hit_count(&b_hits, "/sub.png") >= 1
    })
    .await;

    let before_landing = hit_count(&b_hits, "/landing");
    let before_sub = hit_count(&b_hits, "/sub.png");
    let a_redirects_before = hit_count(&a_hits, "/redirect");
    let a_ok_before = hit_count(&a_hits, "/ok.png");

    // Policed target: redirect hop to B is failed before it leaves the browser.
    let policed = new_producer(&client, Some(policy)).await;
    navigate(&policed, &format!("http://127.0.0.1:{a_port}/redirect")).await;
    wait_until("policed redirect request", || {
        hit_count(&a_hits, "/redirect") > a_redirects_before
    })
    .await;
    // Policed target: allowed page loads, same-origin asset is fetched, B subresource is not.
    navigate(&policed, &format!("http://127.0.0.1:{a_port}/page")).await;
    wait_until("allowed same-origin asset", || {
        hit_count(&a_hits, "/ok.png") > a_ok_before
    })
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(750)).await;

    assert_eq!(
        hit_count(&b_hits, "/landing"),
        before_landing,
        "forbidden redirect target must never be requested"
    );
    assert_eq!(
        hit_count(&b_hits, "/sub.png"),
        before_sub,
        "forbidden subresource must never be requested"
    );

    let _ = process.terminate().await;
}

// ---------------------------------------------------------------------------
// LA:L2,L3,L4,L5,L8,L13 — manager-owned native target lifecycle on real Chromium
// ---------------------------------------------------------------------------

/// Sessions, producers and the shared target capacity are process-global: the real-browser
/// lifecycle tests run one at a time on a reset registry.
static NATIVE_SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn find_chromium() -> Option<PathBuf> {
    find_browser_executable(None).ok().or_else(|| {
        [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
    })
}

struct NativeEnv {
    state: AppState,
    app: axum::Router,
    token: String,
    principal: String,
    _tmp: tempfile::TempDir,
    _serial: tokio::sync::MutexGuard<'static, ()>,
}

async fn native_env(
    principal: &str,
    max_targets: usize,
    allowed_origins: Vec<String>,
) -> Option<NativeEnv> {
    let serial = NATIVE_SERIAL.lock().await;
    let Some(exec) = find_chromium() else {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("Required Chrome/Chromium executable not found on host");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return None;
    };
    global_session_registry().reset_for_test().await;
    GLOBAL_PRODUCERS.write().await.clear();

    let tmp = tempdir().unwrap();
    let browser = BrowserHostConfig {
        enabled: true,
        executable_path: Some(exec),
        profile_root: Some(tmp.path().join("profiles")),
        allowed_target_origins: allowed_origins,
        budgets: BrowserBudgetsConfig {
            max_targets,
            ..BrowserBudgetsConfig::default()
        },
        ..BrowserHostConfig::default()
    };
    let (auth_service, token) = make_user_token(principal, UserRole::Admin, true);
    let state = build_state(tmp.path().to_path_buf(), false, Some(browser))
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state.clone(), vec![]);
    Some(NativeEnv {
        state,
        app,
        token,
        principal: principal.to_string(),
        _tmp: tmp,
        _serial: serial,
    })
}

async fn api(
    app: &axum::Router,
    token: &str,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let req = match body {
        Some(v) => builder
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&v).unwrap())),
        None => builder.body(Body::empty()),
    }
    .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn create_body(key: &str, url: &str) -> Value {
    json!({
        "creationKey": key,
        "url": url,
        "viewport": { "width": 1280, "height": 900, "dpr": 1.0 }
    })
}

impl NativeEnv {
    async fn call(&self, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        api(&self.app, &self.token, method, uri, body).await
    }

    async fn create(&self, key: &str, url: &str) -> (StatusCode, Value) {
        self.call("POST", "/api/browser/sessions", Some(create_body(key, url)))
            .await
    }

    async fn session(&self, id: &str) -> (StatusCode, Value) {
        self.call("GET", &format!("/api/browser/sessions/{id}"), None)
            .await
    }

    async fn sessions(&self) -> Vec<Value> {
        let (status, body) = self.call("GET", "/api/browser/sessions", None).await;
        assert_eq!(status, StatusCode::OK);
        body.as_array().cloned().unwrap_or_default()
    }

    async fn pages(&self) -> Vec<NativeTargetInfo> {
        self.state
            .browser_host
            .native_control(&self.principal, false)
            .await
            .expect("live browser")
            .list_pages()
            .await
            .expect("native inventory")
    }

    async fn raw_client(&self) -> Arc<CdpClient> {
        let handle = self
            .state
            .browser_host
            .ensure_running(&self.principal, false)
            .await
            .expect("browser");
        CdpClient::connect(&handle.ws_endpoint)
            .await
            .expect("raw cdp")
    }

    async fn native_id(&self, session_id: &str) -> Option<String> {
        global_session_registry()
            .get_native_target_id(session_id)
            .await
    }
}

async fn wait_for<F, Fut>(what: &str, mut cond: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        if cond().await {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

async fn next_native_event<F: Fn(&NativeTargetEvent) -> bool>(
    rx: &mut tokio::sync::broadcast::Receiver<NativeTargetEvent>,
    what: &str,
    matches: F,
) -> NativeTargetEvent {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Ok(event)) if matches(&event) => return event,
            Ok(_) => {}
            Err(_) => panic!("timed out waiting for native event: {what}"),
        }
    }
}

fn session_id_of(body: &Value) -> String {
    body["browserSessionId"]
        .as_str()
        .expect("browserSessionId")
        .to_string()
}

/// L2: startup blank page, REST-created and raw-CDP-created pages all draw from ONE logical
/// capacity sized by the configured `max_targets`; raw authority is not a cap exemption, and a
/// raw page destroyed through raw CDP frees its slot.
#[tokio::test]
async fn test_native_pages_share_configured_cap_across_startup_rest_and_raw() {
    let Some(env) = native_env("admin-native-cap", 1, vec![]).await else {
        return;
    };
    let mut events = env.state.browser_host.subscribe_native_events();

    let (status, a) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{a}");
    assert_eq!(a["status"], "running");
    // The startup blank page was closed: exactly the managed page exists natively.
    assert_eq!(env.pages().await.len(), 1);
    assert_eq!(global_session_registry().active_target_count(), 1);

    // max_targets=1 (configured, not DEFAULT_MAX_TARGETS): a second REST session is refused.
    let (status, busy) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{busy}");
    assert_eq!(
        env.pages().await.len(),
        1,
        "refused create must not leave a native page"
    );

    // A raw-created page at capacity is closed and reported blocked.
    let raw = env.raw_client().await;
    raw.send_command(
        "Target.createTarget",
        Some(json!({ "url": "about:blank" })),
        None,
    )
    .await
    .expect("raw create");
    next_native_event(&mut events, "raw overflow blocked", |e| {
        matches!(e, NativeTargetEvent::TargetBlocked { .. })
    })
    .await;
    wait_for("overflow raw page closed", || async {
        env.pages().await.len() == 1
    })
    .await;
    assert_eq!(global_session_registry().active_target_count(), 1);

    // Closing the managed session frees the slot only after the page is gone.
    let a_id = session_id_of(&a);
    let (status, _) = env
        .call("DELETE", &format!("/api/browser/sessions/{a_id}"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(env.pages().await.is_empty());
    assert_eq!(global_session_registry().active_target_count(), 0);

    // Now a raw page is admitted and holds the slot until raw CDP destroys it.
    let created = raw
        .send_command(
            "Target.createTarget",
            Some(json!({ "url": "about:blank" })),
            None,
        )
        .await
        .expect("raw create");
    let raw_target = created["targetId"].as_str().unwrap().to_string();
    wait_for("raw page admitted", || async {
        global_session_registry().active_target_count() == 1
    })
    .await;
    let (status, busy) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "raw page holds the only slot: {busy}"
    );
    raw.send_command(
        "Target.closeTarget",
        Some(json!({ "targetId": raw_target })),
        None,
    )
    .await
    .expect("raw close");
    wait_for("raw destruction frees slot", || async {
        global_session_registry().active_target_count() == 0 && env.pages().await.is_empty()
    })
    .await;

    env.state.browser_host.shutdown_all().await;
}

/// An overflow page whose close is not proven keeps a capacity slot (it is never an untracked
/// page beside a full cap) and is retried until the inventory proves it absent.
#[tokio::test]
async fn test_overflow_page_with_failed_close_stays_charged_until_proven_absent() {
    let Some(env) = native_env("admin-native-overflow-close", 1, vec![]).await else {
        return;
    };
    let mut events = env.state.browser_host.subscribe_native_events();
    let (status, a) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{a}");
    assert_eq!(global_session_registry().active_target_count(), 1);

    env.state
        .browser_host
        .native_faults
        .fail_close
        .store(1, std::sync::atomic::Ordering::SeqCst);
    let raw = env.raw_client().await;
    raw.send_command(
        "Target.createTarget",
        Some(json!({ "url": "about:blank" })),
        None,
    )
    .await
    .expect("raw create");
    next_native_event(&mut events, "raw overflow blocked", |e| {
        matches!(e, NativeTargetEvent::TargetBlocked { .. })
    })
    .await;

    // The failed close leaves the page alive and charged beyond the configured cap.
    wait_for("unconfirmed overflow page charged", || async {
        global_session_registry().active_target_count() == 2
    })
    .await;
    assert_eq!(env.pages().await.len(), 2);
    let (status, busy) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{busy}");

    // The retry closes it; only then is the slot released.
    wait_for("overflow page retried and proven absent", || async {
        env.pages().await.len() == 1 && global_session_registry().active_target_count() == 1
    })
    .await;

    env.state.browser_host.shutdown_all().await;
}

/// L3: concurrent same-key creates coalesce onto one reservation, one native page and one
/// producer; exactly one caller is the creator.
#[tokio::test]
async fn test_concurrent_same_key_creates_publish_one_native_page_and_producer() {
    let Some(env) = native_env("admin-native-concurrent", 2, vec![]).await else {
        return;
    };
    let key = uuid::Uuid::new_v4().to_string();
    let results =
        futures_util::future::join_all((0..5).map(|_| env.create(&key, "about:blank"))).await;

    let created = results
        .iter()
        .filter(|(s, _)| *s == StatusCode::CREATED)
        .count();
    let replays = results.iter().filter(|(s, _)| *s == StatusCode::OK).count();
    assert_eq!((created, replays), (1, 4), "{results:?}");
    let ids: std::collections::HashSet<_> = results.iter().map(|(_, b)| session_id_of(b)).collect();
    assert_eq!(ids.len(), 1, "every caller observes the same session");
    assert!(results.iter().all(|(_, b)| b["status"] == "running"));

    assert_eq!(env.pages().await.len(), 1, "one native page for one key");
    assert_eq!(global_session_registry().active_target_count(), 1);
    assert_eq!(
        GLOBAL_PRODUCERS.read().await.len(),
        1,
        "one published producer"
    );

    env.state.browser_host.shutdown_all().await;
}

/// L3: a lost `Target.createTarget` response is reconciled by the creation marker; the session is
/// published with the one page Chrome created and a same-key retry never creates a duplicate.
#[tokio::test]
async fn test_lost_create_response_reconciles_without_duplicate_page() {
    let Some(env) = native_env("admin-native-lost", 2, vec![]).await else {
        return;
    };
    env.state
        .browser_host
        .native_faults
        .drop_create_responses
        .store(1, std::sync::atomic::Ordering::SeqCst);
    let key = uuid::Uuid::new_v4().to_string();
    let (status, first) = env.create(&key, "about:blank").await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["status"], "running");
    assert_eq!(
        env.pages().await.len(),
        1,
        "the page Chrome created is reused"
    );

    let (status, retry) = env.create(&key, "about:blank").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session_id_of(&retry), session_id_of(&first));
    assert_eq!(env.pages().await.len(), 1);
    assert_eq!(global_session_registry().active_target_count(), 1);

    env.state.browser_host.shutdown_all().await;
}

/// L3: when both the create response and the reconciliation fail, the outcome is NOT reported as
/// Running/201; the pending identity keeps its slot, the observer binds the late page, and the
/// same-key retry publishes that very page (no duplicate, same session id).
#[tokio::test]
async fn test_ambiguous_create_is_not_running_and_retry_reconciles_same_page() {
    let Some(env) = native_env("admin-native-ambiguous", 2, vec![]).await else {
        return;
    };
    let faults = env.state.browser_host.native_faults.clone();
    faults
        .drop_create_responses
        .store(1, std::sync::atomic::Ordering::SeqCst);
    faults
        .fail_reconcile
        .store(1, std::sync::atomic::Ordering::SeqCst);

    let key = uuid::Uuid::new_v4().to_string();
    let (status, failed) = env.create(&key, "about:blank").await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{failed}");
    assert_eq!(failed["kind"], "nativeTargetUnavailable");

    let listed = env.sessions().await;
    assert_eq!(listed.len(), 1);
    assert_eq!(
        listed[0]["status"], "initializing",
        "never Running after a failed create"
    );
    assert_eq!(
        global_session_registry().active_target_count(),
        1,
        "slot stays reserved"
    );
    let session_id = session_id_of(&listed[0]);
    // The page Chrome created is bound by the observer even though the response was lost.
    wait_for("observer binds the late page", || async {
        env.native_id(&session_id).await.is_some()
    })
    .await;
    let bound = env.native_id(&session_id).await.unwrap();
    assert_eq!(env.pages().await.len(), 1);

    let (status, retry) = env.create(&key, "about:blank").await;
    assert_eq!(status, StatusCode::CREATED, "{retry}");
    assert_eq!(session_id_of(&retry), session_id);
    assert_eq!(retry["status"], "running");
    assert_eq!(env.native_id(&session_id).await.unwrap(), bound);
    assert_eq!(
        env.pages().await.len(),
        1,
        "retry reconciled, it did not create again"
    );
    assert_eq!(GLOBAL_PRODUCERS.read().await.len(), 1);

    env.state.browser_host.shutdown_all().await;
}

/// L3: Chrome refusing the create releases the reservation; the response is an error (never
/// 201/Running) and the same key retries a fresh creation.
#[tokio::test]
async fn test_refused_create_is_not_running_and_same_key_retries_fresh() {
    let Some(env) = native_env("admin-native-refused", 2, vec![]).await else {
        return;
    };
    env.state
        .browser_host
        .native_faults
        .refuse_create
        .store(1, std::sync::atomic::Ordering::SeqCst);
    let key = uuid::Uuid::new_v4().to_string();
    let (status, failed) = env.create(&key, "about:blank").await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{failed}");
    assert!(env.sessions().await.is_empty());
    assert_eq!(global_session_registry().active_target_count(), 0);
    assert_eq!(global_session_registry().retained_session_count().await, 0);
    assert!(env.pages().await.is_empty());

    let (status, retry) = env.create(&key, "about:blank").await;
    assert_eq!(status, StatusCode::CREATED, "{retry}");
    assert_eq!(retry["status"], "running");
    assert_eq!(env.pages().await.len(), 1);

    env.state.browser_host.shutdown_all().await;
}

/// L4: a failed Target.closeTarget keeps the Closing identity, producer and capacity; a
/// replacement create is refused; a repeated DELETE resumes the cleanup and only then frees them.
#[tokio::test]
async fn test_failed_native_close_keeps_identity_and_delete_resumes() {
    let Some(env) = native_env("admin-native-close", 1, vec![]).await else {
        return;
    };
    let (status, created) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = session_id_of(&created);
    let native = env.native_id(&id).await.unwrap();
    assert!(get_producer(&id).await.is_some());

    env.state
        .browser_host
        .native_faults
        .fail_close
        .store(1, std::sync::atomic::Ordering::SeqCst);
    let uri = format!("/api/browser/sessions/{id}");
    let (status, failed) = env.call("DELETE", &uri, None).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{failed}");
    assert_eq!(failed["status"], "closing");

    let (_, current) = env.session(&id).await;
    assert_eq!(current["status"], "closing");
    assert_eq!(env.native_id(&id).await.as_deref(), Some(native.as_str()));
    assert!(
        get_producer(&id).await.is_some(),
        "producer is kept until absence is proven"
    );
    assert_eq!(
        global_session_registry().active_target_count(),
        1,
        "capacity is kept"
    );
    assert_eq!(env.pages().await.len(), 1);
    let (status, busy) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "no replacement beside a live page: {busy}"
    );
    assert_eq!(env.pages().await.len(), 1);

    let (status, closed) = env.call("DELETE", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert!(env.pages().await.is_empty());
    assert_eq!(global_session_registry().active_target_count(), 0);
    assert!(get_producer(&id).await.is_none());
    let (_, after) = env.session(&id).await;
    assert_eq!(after["status"], "closed");

    let (status, replacement) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{replacement}");

    env.state.browser_host.shutdown_all().await;
}

/// L8 + L13: a page destroyed through raw CDP retires exactly its session (lost, producer gone,
/// slot freed) while the sibling keeps its identity; retired history is reaped only after the
/// idempotency retry TTL.
#[tokio::test]
async fn test_raw_page_destruction_retires_exact_session_and_ttl_reaps_history() {
    let Some(env) = native_env("admin-native-destroy", 2, vec![]).await else {
        return;
    };
    let mut events = env.state.browser_host.subscribe_native_events();
    let (_, a) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    let (_, b) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    let (a_id, b_id) = (session_id_of(&a), session_id_of(&b));
    let a_native = env.native_id(&a_id).await.unwrap();
    let b_native = env.native_id(&b_id).await.unwrap();
    assert_ne!(a_native, b_native);

    let raw = env.raw_client().await;
    raw.send_command(
        "Target.closeTarget",
        Some(json!({ "targetId": a_native })),
        None,
    )
    .await
    .expect("raw destroy");

    let lost = next_native_event(&mut events, "session lost", |e| {
        matches!(e, NativeTargetEvent::SessionLost { .. })
    })
    .await;
    match lost {
        NativeTargetEvent::SessionLost {
            browser_session_id, ..
        } => assert_eq!(browser_session_id, a_id),
        other => panic!("unexpected {other:?}"),
    }
    let (_, a_now) = env.session(&a_id).await;
    assert_eq!(a_now["status"], "lost");
    assert_eq!(a_now["inputAvailable"], false);
    assert!(get_producer(&a_id).await.is_none());
    assert_eq!(
        global_session_registry().active_target_count(),
        1,
        "only the lost slot is freed"
    );

    // The sibling is untouched: same identity, still running, producer intact.
    let (_, b_now) = env.session(&b_id).await;
    assert_eq!(b_now["status"], "running");
    assert_eq!(
        env.native_id(&b_id).await.as_deref(),
        Some(b_native.as_str())
    );
    assert!(get_producer(&b_id).await.is_some());
    assert_eq!(env.pages().await.len(), 1);

    // History is bounded by TTL but never reaped while a retry result is promised.
    let registry = global_session_registry();
    assert_eq!(registry.retained_session_count().await, 2);
    registry
        .reap_expired_at(
            std::time::Instant::now() + IDEMPOTENCY_TTL - std::time::Duration::from_secs(30),
        )
        .await;
    assert_eq!(
        registry.retained_session_count().await,
        2,
        "promised result retained"
    );
    registry
        .reap_expired_at(
            std::time::Instant::now() + IDEMPOTENCY_TTL + std::time::Duration::from_secs(30),
        )
        .await;
    assert_eq!(
        registry.retained_session_count().await,
        1,
        "lost history reaped, live B preserved"
    );
    assert_eq!(env.session(&b_id).await.1["status"], "running");

    env.state.browser_host.shutdown_all().await;
}

/// L8: a browser crash retires every session of the incarnation (slots freed, producers gone),
/// the lost sessions keep their old incarnation, and a new create runs on a NEW incarnation.
#[tokio::test]
async fn test_browser_crash_retires_all_sessions_and_new_incarnation_creates_fresh() {
    let Some(env) = native_env("admin-native-crash", 2, vec![]).await else {
        return;
    };
    let (_, a) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    let (_, b) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    let (a_id, b_id) = (session_id_of(&a), session_id_of(&b));
    let old_incarnation = a["browserIncarnation"].as_str().unwrap().to_string();
    let handle = env
        .state
        .browser_host
        .ensure_running(&env.principal, false)
        .await
        .unwrap();
    assert_eq!(handle.browser_incarnation, old_incarnation);

    assert_eq!(unsafe { libc::kill(handle.pid as i32, libc::SIGKILL) }, 0);
    wait_for("crash retires every session", || async {
        global_session_registry().active_target_count() == 0
            && env.session(&a_id).await.1["status"] == "lost"
            && env.session(&b_id).await.1["status"] == "lost"
    })
    .await;
    assert!(get_producer(&a_id).await.is_none() && get_producer(&b_id).await.is_none());
    let (_, a_lost) = env.session(&a_id).await;
    assert_eq!(
        a_lost["browserIncarnation"], old_incarnation,
        "lost identity is the old incarnation"
    );

    let (status, fresh) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{fresh}");
    assert_ne!(fresh["browserIncarnation"], old_incarnation);
    assert_eq!(env.pages().await.len(), 1);
    assert_eq!(global_session_registry().active_target_count(), 1);

    env.state.browser_host.shutdown_all().await;
}

async fn reset_profile_and_wait(env: &NativeEnv, operation_id: &str, epoch: u64) {
    let (status, body) = env
        .call(
            "POST",
            "/api/browser/profile/reset",
            Some(json!({ "operationId": operation_id, "expectedProfileEpoch": epoch, "confirmed": true })),
        )
        .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::ACCEPTED,
        "reset: {status} {body}"
    );
    wait_for("reset completion", || async {
        let (_, st) = env
            .call(
                "GET",
                &format!("/api/browser/profile/reset/{operation_id}"),
                None,
            )
            .await;
        st["status"] == "completed"
    })
    .await;
}

/// L5: a create paused after native creation (before publication) cannot publish across a
/// reset: it fails (never 201), leaves no ghost session, producer or slot, and a fresh create
/// afterwards runs on the new epoch.
#[tokio::test]
async fn test_create_paused_before_publication_cannot_cross_reset() {
    let Some(env) = native_env("admin-native-reset-commit", 2, vec![]).await else {
        return;
    };
    env.state
        .browser_host
        .native_faults
        .delay_before_commit_ms
        .store(2500, std::sync::atomic::Ordering::SeqCst);
    let key = uuid::Uuid::new_v4().to_string();
    let paused = tokio::spawn({
        let (app, token) = (env.app.clone(), env.token.clone());
        let key = key.clone();
        async move {
            api(
                &app,
                &token,
                "POST",
                "/api/browser/sessions",
                Some(create_body(&key, "about:blank")),
            )
            .await
        }
    });
    // The native page exists and the creator is parked right before publication.
    wait_for("native page of the paused create", || async {
        match env
            .state
            .browser_host
            .native_control(&env.principal, false)
            .await
        {
            Ok(control) => control
                .list_pages()
                .await
                .is_ok_and(|pages| pages.len() == 1),
            Err(_) => false,
        }
    })
    .await;

    reset_profile_and_wait(&env, "op-paused-commit", 1).await;
    env.state
        .browser_host
        .native_faults
        .delay_before_commit_ms
        .store(0, std::sync::atomic::Ordering::SeqCst);

    let (status, body) = paused.await.unwrap();
    assert_ne!(
        status,
        StatusCode::CREATED,
        "late create must not publish: {body}"
    );
    assert_ne!(status, StatusCode::OK, "{body}");
    assert!(
        env.sessions().await.is_empty(),
        "no ghost session after reset"
    );
    assert_eq!(global_session_registry().active_target_count(), 0);
    assert_eq!(
        GLOBAL_PRODUCERS.read().await.len(),
        0,
        "no ghost producer after reset"
    );

    let (status, fresh) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{fresh}");
    assert_eq!(fresh["profileEpoch"], "2");
    assert_eq!(
        env.pages().await.len(),
        1,
        "only the new epoch's page exists"
    );

    env.state.browser_host.shutdown_all().await;
}

/// L5: a create admitted with the old handle but paused before it reserves capacity is rejected
/// at reservation once reset advanced the epoch: no session, slot or producer appears.
#[tokio::test]
async fn test_create_paused_before_reservation_cannot_cross_reset() {
    let Some(env) = native_env("admin-native-reset-reserve", 2, vec![]).await else {
        return;
    };
    // Launch once so the handle the paused request captures is the old epoch's.
    env.raw_client().await;
    env.state
        .browser_host
        .native_faults
        .delay_before_reserve_ms
        .store(1500, std::sync::atomic::Ordering::SeqCst);
    let paused = tokio::spawn({
        let (app, token) = (env.app.clone(), env.token.clone());
        async move {
            api(
                &app,
                &token,
                "POST",
                "/api/browser/sessions",
                Some(create_body(
                    &uuid::Uuid::new_v4().to_string(),
                    "about:blank",
                )),
            )
            .await
        }
    });
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    reset_profile_and_wait(&env, "op-paused-reserve", 1).await;

    let (status, body) = paused.await.unwrap();
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "stale-epoch create is rejected: {body}"
    );
    assert!(env.sessions().await.is_empty());
    assert_eq!(global_session_registry().active_target_count(), 0);
    assert_eq!(global_session_registry().retained_session_count().await, 0);
    assert_eq!(GLOBAL_PRODUCERS.read().await.len(), 0);

    env.state.browser_host.shutdown_all().await;
}

/// L2: a `window.open` popup of a managed session is admitted against the SAME cap, projected
/// as its own session with the central request policy installed before it navigates, and an
/// overflow popup is closed with a blocked notice on the opener.
#[tokio::test]
async fn test_popup_admission_policy_and_overflow_share_capacity() {
    let (b_port, b_hits) = spawn_origin(None, None).await;
    let forbidden_img = format!("http://127.0.0.1:{b_port}/sub.png");
    let (a_port, a_hits) = spawn_origin(None, Some(forbidden_img)).await;
    let Some(env) = native_env(
        "admin-native-popup",
        2,
        vec![format!("http://127.0.0.1:{a_port}")],
    )
    .await
    else {
        return;
    };
    let mut events = env.state.browser_host.subscribe_native_events();

    let (status, opener) = env
        .create(&uuid::Uuid::new_v4().to_string(), "about:blank")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opener}");
    let opener_id = session_id_of(&opener);
    let opener_native = env.native_id(&opener_id).await.unwrap();

    // Drive `window.open` from the opener's page with a user gesture (raw CDP authority).
    let raw = env.raw_client().await;
    let attached = raw
        .send_command(
            "Target.attachToTarget",
            Some(json!({ "targetId": opener_native, "flatten": true })),
            None,
        )
        .await
        .expect("attach opener");
    let opener_session = attached["sessionId"].as_str().unwrap().to_string();
    let open_popup = |path: &'static str| {
        let raw = raw.clone();
        let opener_session = opener_session.clone();
        async move {
            raw.send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": format!("window.open('http://127.0.0.1:{a_port}{path}'); 1"),
                    "userGesture": true,
                })),
                Some(&opener_session),
            )
            .await
            .expect("window.open")
        }
    };

    // First popup: admitted (slot 2/2), projected as a running session.
    open_popup("/page").await;
    let admitted = next_native_event(&mut events, "popup admitted", |e| {
        matches!(e, NativeTargetEvent::PopupAdmitted { .. })
    })
    .await;
    let NativeTargetEvent::PopupAdmitted {
        parent_session_id,
        session,
    } = admitted
    else {
        unreachable!()
    };
    assert_eq!(parent_session_id, opener_id);
    assert_eq!(session.status, "running");
    assert_ne!(session.browser_session_id, opener_id);
    assert_eq!(global_session_registry().active_target_count(), 2);
    assert_eq!(env.sessions().await.len(), 2);
    assert_eq!(env.pages().await.len(), 2);
    assert!(get_producer(&session.browser_session_id).await.is_some());

    // Policy was installed before the popup navigated: its allowed asset loads, the forbidden
    // subresource never reaches the forbidden origin.
    wait_for("popup page and same-origin asset", || async {
        hit_count(&a_hits, "/page") >= 1 && hit_count(&a_hits, "/ok.png") >= 1
    })
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(750)).await;
    assert_eq!(
        hit_count(&b_hits, "/sub.png"),
        0,
        "popup subresource policy"
    );

    // Second popup at capacity: closed, opener flagged, blocked notice emitted.
    open_popup("/page").await;
    next_native_event(&mut events, "popup blocked", |e| {
        matches!(e, NativeTargetEvent::PopupBlocked { .. })
    })
    .await;
    wait_for("overflow popup closed", || async {
        env.pages().await.len() == 2
    })
    .await;
    assert_eq!(global_session_registry().active_target_count(), 2);
    let (_, opener_now) = env.session(&opener_id).await;
    assert_eq!(opener_now["popupBlocked"], true);

    // Closing the admitted popup frees its slot.
    let popup_id = session.browser_session_id;
    let (status, _) = env
        .call("DELETE", &format!("/api/browser/sessions/{popup_id}"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(global_session_registry().active_target_count(), 1);
    assert_eq!(env.pages().await.len(), 1);

    env.state.browser_host.shutdown_all().await;
}
