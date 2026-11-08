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
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
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
    let _guard = ENV_LOCK.lock();

    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
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
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver));
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_root,
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
    assert_eq!(
        resp.headers().get(CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
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
    assert_eq!(
        resp.headers().get(CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
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

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
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
    assert_eq!(
        resp.headers().get(CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["protocolVersion"], 1);
}

#[tokio::test]
async fn test_dev_mode_loopback_and_origin_gates() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), true);
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
    let body3 = axum::body::to_bytes(resp3.into_body(), 1024 * 1024).await.unwrap();
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
    let body4 = axum::body::to_bytes(resp4.into_body(), 1024 * 1024).await.unwrap();
    let json4: Value = serde_json::from_slice(&body4).unwrap();
    assert_eq!(json4["kind"], "devBypassDenied");
}

#[tokio::test]
async fn test_idempotent_session_creation_retry_and_caps() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-session-test", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

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
        &axum::body::to_bytes(resp1.into_body(), 1024 * 1024).await.unwrap(),
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
        &axum::body::to_bytes(resp2.into_body(), 1024 * 1024).await.unwrap(),
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
        &axum::body::to_bytes(resp3.into_body(), 1024 * 1024).await.unwrap(),
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
        &axum::body::to_bytes(resp4.into_body(), 1024 * 1024).await.unwrap(),
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
        &axum::body::to_bytes(resp5.into_body(), 1024 * 1024).await.unwrap(),
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
        ("http://169.254.169.254/latest/meta-data/", "policyViolation"),
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
            &axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap(),
        )
        .unwrap();
        assert_eq!(body["kind"], expected_kind);
    }
}
