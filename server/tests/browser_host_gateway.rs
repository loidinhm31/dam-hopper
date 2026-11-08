use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;

use axum::body::Body;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONNECTION, ORIGIN, SEC_WEBSOCKET_KEY, SEC_WEBSOCKET_VERSION, UPGRADE};
use axum::http::{HeaderValue, Request, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::Value;
use tower::ServiceExt;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::auth::{verify_live_admission, BrowserAdmission};
use dam_hopper_server::api::browser_host::global_session_registry;
use dam_hopper_server::browser_host::cdp_gateway::{
    global_cdp_gateway, handle_client_cdp_message, handle_upstream_cdp_message, write_with_cancel,
    CdpGatewayManager, WriteOutcome,
};
use dam_hopper_server::browser_host::session::{CreateSessionRequest, SessionError, ViewportRequest};
use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use opaque_ke::ServerSetup;

static ENV_LOCK: Mutex<()> = Mutex::new(());
const JWT_SECRET: &str = "test-jwt-secret-key-cdp-gateway";

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
async fn test_unauthenticated_discovery_denied_401() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);
    let app = build_router_with_origins(state, vec![]);

    // 1. GET /api/browser/cdp/json/version without token -> 401
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(resp.headers().get(CACHE_CONTROL).unwrap(), "no-store");

    // 2. GET /api/browser/cdp/json/list without token -> 401
    let req2 = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/list")
        .body(Body::empty())
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(resp2.headers().get(CACHE_CONTROL).unwrap(), "no-store");
}

#[tokio::test]
async fn test_non_admin_discovery_denied_403() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("user-bob", UserRole::User, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let val: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val["kind"], "adminRequired");
}

#[tokio::test]
async fn test_discovery_wrong_origin_denied_403() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-alice", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let allowed = HeaderValue::from_static("http://127.0.0.1:5173");
    let app = build_router_with_origins(state, vec![allowed]);

    // 1. Unapproved origin
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ORIGIN, "http://evil.com")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 2. Trailing slash
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ORIGIN, "http://127.0.0.1:5173/")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 3. Comma duplicate
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ORIGIN, "http://127.0.0.1:5173, http://127.0.0.1:5173")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 4. Exact approved origin passes
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // In unit test without running chromium, returns 503 browserUnavailable, not 401/403
    assert!(resp.status() == StatusCode::OK || resp.status() == StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn test_origin_less_without_bearer_denied_401() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_ws_upgrade_unauthenticated_denied_401() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);
    let app = build_router_with_origins(state, vec![]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/ws")
        .header(CONNECTION, "Upgrade")
        .header(UPGRADE, "websocket")
        .header(SEC_WEBSOCKET_VERSION, "13")
        .header(SEC_WEBSOCKET_KEY, "dGhlIHNhbXBsZSBub25jZQ==")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_ws_upgrade_wrong_origin_denied_403() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-alice", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let allowed = HeaderValue::from_static("http://127.0.0.1:5173");
    let app = build_router_with_origins(state, vec![allowed]);

    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/ws")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ORIGIN, "http://evil.com")
        .header(CONNECTION, "Upgrade")
        .header(UPGRADE, "websocket")
        .header(SEC_WEBSOCKET_VERSION, "13")
        .header(SEC_WEBSOCKET_KEY, "dGhlIHNhbXBsZSBub25jZQ==")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_global_agent_capacity_limit_rejects_busy_429() {
    let gateway = global_cdp_gateway();

    // Acquire permits to saturate capacity (2)
    let permit1 = gateway.try_acquire().expect("permit 1");
    let permit2 = gateway.try_acquire().expect("permit 2");
    assert_eq!(gateway.active_connections(), 2);

    // 3rd attempt must be rejected with 429
    let permit3 = gateway.try_acquire();
    assert_eq!(permit3.unwrap_err(), StatusCode::TOO_MANY_REQUESTS);

    // Dropping permit frees capacity
    drop(permit1);
    assert_eq!(gateway.active_connections(), 1);

    let permit3_retry = gateway.try_acquire();
    assert!(permit3_retry.is_ok());

    drop(permit2);
    drop(permit3_retry);
    assert_eq!(gateway.active_connections(), 0);
}

#[tokio::test]
async fn test_live_revocation_detection() {
    let (auth_service, _token) = make_user_token("admin-revoked", UserRole::Admin, true);
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));

    let adm = BrowserAdmission {
        principal: "admin-revoked".to_string(),
        is_dev: false,
        session_id: Some("session-for-admin-revoked".to_string()),
        auth_version: Some(0),
        credential_version: Some(0),
        effective_deadline: None,
    };

    // Valid check succeeds
    let res = verify_live_admission(&state, &adm).await;
    assert!(res.is_ok());

    // Expired deadline fails
    let expired_adm = BrowserAdmission {
        effective_deadline: Some(Utc::now() - ChronoDuration::seconds(10)),
        ..adm.clone()
    };
    let expired_res = verify_live_admission(&state, &expired_adm).await;
    assert!(matches!(expired_res.unwrap_err(), dam_hopper_server::browser_host::auth::BrowserAuthError::SessionExpired(_)));
}

#[tokio::test]
async fn test_write_with_cancel_aborts_immediately() {
    let (abort_tx, mut abort_rx) = tokio::sync::mpsc::channel::<()>(1);

    // Abort signal already sent
    abort_tx.send(()).await.unwrap();

    let pending_write = async {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        Ok::<(), std::io::Error>(())
    };

    let (outcome, aborted) = write_with_cancel(pending_write, &mut abort_rx, None).await;
    assert_eq!(outcome, WriteOutcome::Failed);
    assert!(aborted, "write_with_cancel should flag aborted == true");

    // Test write_with_cancel deadline elapsed
    let (_tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);
    let long_write = async {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        Ok::<(), std::io::Error>(())
    };
    let deadline_at = tokio::time::Instant::now() + std::time::Duration::from_millis(50);
    let (outcome2, aborted2) = write_with_cancel(long_write, &mut rx, Some(deadline_at)).await;
    assert_eq!(outcome2, WriteOutcome::DeadlineElapsed);
    assert!(aborted2, "deadline expiry in write_with_cancel should abort");
}

#[tokio::test]
async fn test_capacity_limit_dynamic_budget() {
    let gateway = CdpGatewayManager::new(8);

    // Limit = 1
    let permit1 = gateway.try_acquire_with_limit(1).expect("permit 1");
    let permit2 = gateway.try_acquire_with_limit(1);
    assert_eq!(permit2.unwrap_err(), StatusCode::TOO_MANY_REQUESTS);

    // Free permit
    drop(permit1);
    assert_eq!(gateway.active_connections(), 0);

    // Limit = 3
    let p1 = gateway.try_acquire_with_limit(3).expect("p1");
    let p2 = gateway.try_acquire_with_limit(3).expect("p2");
    let p3 = gateway.try_acquire_with_limit(3).expect("p3");
    let p4 = gateway.try_acquire_with_limit(3);
    assert_eq!(p4.unwrap_err(), StatusCode::TOO_MANY_REQUESTS);

    drop(p1);
    drop(p2);
    drop(p3);
    assert_eq!(gateway.active_connections(), 0);
}

#[tokio::test]
async fn test_origin_less_capability_only_denied_401() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);
    let app = build_router_with_origins(state, vec![]);

    // Request without Origin and without Authorization header, only ticket in subprotocol
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/ws")
        .header(CONNECTION, "Upgrade")
        .header(UPGRADE, "websocket")
        .header(SEC_WEBSOCKET_VERSION, "13")
        .header(SEC_WEBSOCKET_KEY, "dGhlIHNhbXBsZSBub25jZQ==")
        .header("Sec-WebSocket-Protocol", "damhopper.ticket.invalidfakeentropyfortest")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_native_geometry_mutation_fences_managed_input() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);
    let registry = global_session_registry();

    let creation_key = uuid::Uuid::new_v4().to_string();
    let req = CreateSessionRequest {
        creation_key,
        url: "http://example.com".to_string(),
        viewport: ViewportRequest {
            width: 800,
            height: 600,
            dpr: 1.0,
        },
    };

    let (session, _) = registry
        .create_or_idempotent_get("admin-geom-user", false, "inc-1", 1, &req, &[])
        .await
        .expect("create session");
    assert_eq!(session.viewport_epoch, "1");

    // Agent sends native Emulation.setDeviceMetricsOverride
    let cdp_msg = serde_json::json!({
        "id": 1,
        "method": "Emulation.setDeviceMetricsOverride",
        "params": {
            "width": 1024,
            "height": 768,
            "deviceScaleFactor": 2.0,
            "mobile": false
        }
    })
    .to_string();

    handle_client_cdp_message(&cdp_msg, "admin-geom-user", false).await;

    // Verify stale epoch 1 input is rejected with Conflict
    let stale_input_res = registry
        .update_viewport(&session.browser_session_id, "admin-geom-user", 1, 900, 700, 1.0)
        .await;
    assert!(matches!(stale_input_res, Err(SessionError::Conflict(_))), "stale epoch input must fail with Conflict");

    // Verify session epoch has advanced to 2 and geometry updated
    let updated = registry
        .get_session(&session.browser_session_id, "admin-geom-user")
        .await
        .expect("get session");
    assert_eq!(updated.viewport_epoch, "2");
    assert_eq!(updated.geometry.css_width, 1024.0);
    assert_eq!(updated.geometry.css_height, 768.0);
    assert_eq!(updated.geometry.dpr, 2.0);
    assert!(updated.input_available);

    // Verify real SessionInputManager rejects stale epoch with StaleViewportEpoch
    let input_mgr = dam_hopper_server::browser_host::input::SessionInputManager::new();
    let (lease_token, _) = input_mgr.acquire_lease("viewer1", "human").await.unwrap();
    input_mgr.set_expected_viewport_epoch(2).await;

    let stale_msg = dam_hopper_server::browser_host::input::InputMessage {
        lease_token,
        browser_session_id: session.browser_session_id.clone(),
        browser_incarnation: "inc-1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub-1".to_string(),
        input_seq: 1,
        viewport_epoch: 1,
        event: dam_hopper_server::browser_host::input::InputEvent::KeyDown {
            key: "A".to_string(),
            code: "KeyA".to_string(),
            modifiers: 0,
        },
    };
    let enqueue_res = input_mgr.enqueue_input(stale_msg).await;
    assert!(
        matches!(
            enqueue_res,
            Err(dam_hopper_server::browser_host::input::InputError::StaleViewportEpoch {
                expected: 2,
                actual: 1
            })
        ),
        "stale viewport epoch must be rejected at input manager boundary"
    );

    // Test clearDeviceMetricsOverride marks input unavailable pending layout reconciliation
    let clear_msg = serde_json::json!({
        "method": "Emulation.clearDeviceMetricsOverride"
    }).to_string();
    handle_client_cdp_message(&clear_msg, "admin-geom-user", false).await;

    let cleared = registry
        .get_session(&session.browser_session_id, "admin-geom-user")
        .await
        .expect("get cleared session");
    assert_eq!(cleared.viewport_epoch, "3");
    assert!(!cleared.input_available, "clearing geometry must disable input pending layout reconciliation");
}

#[tokio::test]
async fn test_agent_target_registration_in_manager() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);

    let target_created = serde_json::json!({
        "method": "Target.targetCreated",
        "params": {
            "targetInfo": {
                "targetId": "target-agent-999",
                "type": "page",
                "title": "Agent Target",
                "url": "http://example.com/target",
                "attached": true,
                "canAccessOpener": false
            }
        }
    })
    .to_string();

    handle_upstream_cdp_message(&target_created, &state, "admin-agent-mgr", false).await;

    let targets = state.browser_host.get_active_targets("admin-agent-mgr", false).await;
    assert_eq!(targets.get("target-agent-999"), Some(&"http://example.com/target".to_string()));

    // Target destroyed
    let target_destroyed = serde_json::json!({
        "method": "Target.targetDestroyed",
        "params": {
            "targetId": "target-agent-999"
        }
    })
    .to_string();

    handle_upstream_cdp_message(&target_destroyed, &state, "admin-agent-mgr", false).await;

    let targets_after = state.browser_host.get_active_targets("admin-agent-mgr", false).await;
    assert!(!targets_after.contains_key("target-agent-999"));
}

#[tokio::test]
async fn test_agent_target_bounds_and_capacity_cap() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), false);

    // 1. Oversized target ID (> 64 chars) rejected
    let huge_id = "a".repeat(65);
    let target_huge_id = serde_json::json!({
        "method": "Target.targetCreated",
        "params": {
            "targetInfo": {
                "targetId": huge_id,
                "url": "http://example.com"
            }
        }
    }).to_string();
    handle_upstream_cdp_message(&target_huge_id, &state, "admin-bounds-user", false).await;
    let targets = state.browser_host.get_active_targets("admin-bounds-user", false).await;
    assert!(targets.is_empty(), "target with ID > 64 chars must be ignored");

    // 2. Oversized URL (> 2048 chars) rejected
    let huge_url = format!("http://example.com/{}", "x".repeat(2048));
    let target_huge_url = serde_json::json!({
        "method": "Target.targetCreated",
        "params": {
            "targetInfo": {
                "targetId": "valid-id",
                "url": huge_url
            }
        }
    }).to_string();
    handle_upstream_cdp_message(&target_huge_url, &state, "admin-bounds-user", false).await;
    let targets2 = state.browser_host.get_active_targets("admin-bounds-user", false).await;
    assert!(targets2.is_empty(), "target with URL > 2048 chars must be ignored");

    // 3. 64-entry capacity cap
    for i in 0..70 {
        let msg = serde_json::json!({
            "method": "Target.targetCreated",
            "params": {
                "targetInfo": {
                    "targetId": format!("tid-{i}"),
                    "url": format!("http://example.com/{i}")
                }
            }
        }).to_string();
        handle_upstream_cdp_message(&msg, &state, "admin-bounds-user", false).await;
    }
    let targets_cap = state.browser_host.get_active_targets("admin-bounds-user", false).await;
    assert_eq!(targets_cap.len(), 64, "active_targets capacity must be capped at 64");
}
