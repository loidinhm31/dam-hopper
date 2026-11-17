use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;

use axum::body::Body;
use axum::http::header::{
    AUTHORIZATION, CACHE_CONTROL, CONNECTION, ORIGIN, SEC_WEBSOCKET_KEY, SEC_WEBSOCKET_VERSION,
    UPGRADE,
};
use axum::http::{HeaderValue, Request, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::Value;
use tower::ServiceExt;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::browser_host::{
    get_or_create_input_manager, get_or_register_producer, global_session_registry,
};
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::auth::{verify_live_admission, BrowserAdmission};
use dam_hopper_server::browser_host::cdp::CdpClient;
use dam_hopper_server::browser_host::cdp_gateway::{
    global_cdp_gateway, write_with_cancel, CdpGatewayManager, WriteOutcome,
};
use dam_hopper_server::browser_host::input::{
    InputError, InputEvent, InputMessage, SessionInputManager,
};
use dam_hopper_server::browser_host::protocol::TargetGeometry;
use dam_hopper_server::browser_host::raw_geometry_fence::handle_client_cdp_message;
use dam_hopper_server::browser_host::raw_session_targets::RawSessionTargets;
use dam_hopper_server::browser_host::screencast::ScreencastProducer;
use dam_hopper_server::browser_host::config::{BrowserHostConfig, PublicServerOrigin};
use dam_hopper_server::browser_host::session::{
    BindOutcome, CreateParams, CreateReservation, CreateSessionRequest, SessionError,
    ViewportRequest,
};
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
    create_test_state_with_browser(workspace_root, no_auth, None)
}

fn create_test_state_with_browser(
    workspace_root: PathBuf,
    no_auth: bool,
    browser: Option<dam_hopper_server::browser_host::config::BrowserHostConfig>,
) -> AppState {
    let _guard = ENV_LOCK.lock();

    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let mut server_config = dam_hopper_server::config::ServerConfig::default();
    if let Some(browser) = browser {
        server_config.browser = browser;
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
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
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
    assert!(matches!(
        expired_res.unwrap_err(),
        dam_hopper_server::browser_host::auth::BrowserAuthError::SessionExpired(_)
    ));
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
    assert!(
        aborted2,
        "deadline expiry in write_with_cancel should abort"
    );
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
        .header(
            "Sec-WebSocket-Protocol",
            "damhopper.ticket.invalidfakeentropyfortest",
        )
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// Mock browser CDP endpoint: acknowledges every command; `Target.attachToTarget` returns a session.
async fn spawn_mock_cdp() -> String {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else { return };
                while let Some(Ok(Message::Text(text))) = ws.next().await {
                    let cmd: Value = serde_json::from_str(&text).unwrap();
                    let result = if cmd["method"] == "Target.attachToTarget" {
                        serde_json::json!({ "sessionId": "MOCK-PAGE-SESSION" })
                    } else {
                        serde_json::json!({})
                    };
                    let reply = serde_json::json!({ "id": cmd["id"], "result": result });
                    if ws.send(Message::Text(reply.to_string().into())).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    format!("ws://{addr}")
}

struct ManagedSession {
    session_id: String,
    producer: Arc<ScreencastProducer>,
    input: Arc<SessionInputManager>,
    lease_token: String,
}

/// A running registry session bound to `target_id`, with a producer, input manager and lease at epoch 1.
async fn managed_session(principal: &str, target_id: &str, mock_url: &str) -> ManagedSession {
    let registry = global_session_registry();
    let request = CreateSessionRequest {
        creation_key: uuid::Uuid::new_v4().to_string(),
        url: "about:blank".to_string(),
        viewport: ViewportRequest { width: 800, height: 600, dpr: 1.0 },
    };
    let CreateReservation::Pending { session_id } = registry
        .reserve_creation(
            &CreateParams {
                principal,
                is_dev: false,
                browser_incarnation: "inc-1",
                profile_epoch: 1,
                request: &request,
                allowed_origins: &[],
                max_targets: usize::MAX,
            },
            &|| true,
        )
        .await
        .unwrap()
    else {
        panic!("fresh creation key must reserve");
    };
    assert_eq!(registry.bind_native_target(&session_id, "inc-1", target_id).await, BindOutcome::Bound);
    registry.commit_running(&session_id, &|| true).await.unwrap();
    let client = CdpClient::connect(mock_url).await.expect("connect mock cdp");
    let producer = Arc::new(ScreencastProducer::new(
        session_id.clone(),
        "inc-1".to_string(),
        1,
        1,
        client,
        target_id.to_string(),
        TargetGeometry {
            css_width: 800.0,
            css_height: 600.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
    ));
    get_or_register_producer(&session_id, producer.clone()).await;
    let input = get_or_create_input_manager(&session_id).await;
    let (lease_token, _) = input.acquire_lease("viewer-1", "human").await.unwrap();
    input.set_expected_viewport_epoch(1).await;
    ManagedSession { session_id, producer, input, lease_token }
}

fn key_input(ms: &ManagedSession, seq: u64, viewport_epoch: u64) -> InputMessage {
    InputMessage {
        browser_session_id: ms.session_id.clone(),
        browser_incarnation: "inc-1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub-1".to_string(),
        lease_token: ms.lease_token.clone(),
        input_seq: seq,
        viewport_epoch,
        event: InputEvent::KeyDown { key: "A".to_string(), code: "KeyA".to_string(), modifiers: 0 },
    }
}

fn raw_attach(id: i64, target: &str) -> String {
    serde_json::json!({ "id": id, "method": "Target.attachToTarget",
        "params": { "targetId": target, "flatten": true } }).to_string()
}

fn raw_resize(session: Option<&str>, w: u32, h: u32, dpr: f64) -> String {
    let mut msg = serde_json::json!({ "id": 9, "method": "Emulation.setDeviceMetricsOverride",
        "params": { "width": w, "height": h, "deviceScaleFactor": dpr, "mobile": false } });
    if let Some(sid) = session {
        msg["sessionId"] = serde_json::json!(sid);
    }
    msg.to_string()
}

/// Correlates `flat` -> `target` exactly as the relay does: client request, upstream response.
async fn attach(targets: &mut RawSessionTargets, principal: &str, flat: &str, target: &str) {
    handle_client_cdp_message(&raw_attach(5, target), principal, false, targets).await;
    targets.observe_upstream(
        &serde_json::json!({ "id": 5, "result": { "sessionId": flat } }).to_string(),
    );
}

#[tokio::test]
async fn test_raw_flattened_resize_fences_registry_input_and_producer_before_relay() {
    let principal = "raw-fence-user";
    let mock = spawn_mock_cdp().await;
    let ms = managed_session(principal, "TARGET-RAW-A", &mock).await;
    let registry = global_session_registry();
    assert_eq!(registry.get_session(&ms.session_id, principal).await.unwrap().viewport_epoch, "1");
    assert!(ms.producer.input_geometry_trusted());

    let mut targets = RawSessionTargets::new(None);
    attach(&mut targets, principal, "FLAT-A", "TARGET-RAW-A").await;
    // The relay inspects the message BEFORE forwarding it upstream; the fence is complete on return.
    handle_client_cdp_message(&raw_resize(Some("FLAT-A"), 1024, 768, 2.0), principal, false, &mut targets).await;

    let updated = registry.get_session(&ms.session_id, principal).await.unwrap();
    assert_eq!(updated.viewport_epoch, "2");
    assert_eq!(updated.geometry.css_width, 1024.0);
    assert_eq!(updated.geometry.css_height, 768.0);
    assert_eq!(updated.geometry.dpr, 2.0);
    assert!(updated.input_available);

    // Producer cache/epoch fence and projection basis follow the registry identity.
    assert_eq!(ms.producer.viewport_epoch(), 2);
    let geometry = ms.producer.geometry().await;
    assert_eq!((geometry.css_width, geometry.css_height), (1024.0, 768.0));
    assert!(ms.producer.get_cached_frame().await.is_none());
    assert!(
        !ms.producer.input_geometry_trusted(),
        "projection stays untrusted until a native frame confirms the raw geometry"
    );

    // Input manager: the old epoch is rejected, only the new identity is accepted.
    let stale = ms.input.enqueue_input(key_input(&ms, 1, 1)).await;
    assert!(
        matches!(stale, Err(InputError::StaleViewportEpoch { expected: 2, actual: 1 })),
        "{stale:?}"
    );
    assert!(ms.input.enqueue_input(key_input(&ms, 1, 2)).await.is_ok());
    // REST viewport on the registry also rejects the pre-fence identity.
    let stale_rest = registry.update_viewport(&ms.session_id, principal, 1, 900, 700, 1.0).await;
    assert!(matches!(stale_rest, Err(SessionError::Conflict(_))));
}

#[tokio::test]
async fn test_raw_resize_fences_only_the_addressed_native_target() {
    let principal = "raw-fence-scope-user";
    let mock = spawn_mock_cdp().await;
    let a = managed_session(principal, "TARGET-SCOPE-A", &mock).await;
    let b = managed_session(principal, "TARGET-SCOPE-B", &mock).await;
    let registry = global_session_registry();

    let mut targets = RawSessionTargets::new(None);
    attach(&mut targets, principal, "FLAT-B", "TARGET-SCOPE-B").await;
    attach(&mut targets, principal, "FLAT-FOREIGN", "TARGET-NOT-MANAGED").await;

    // A flattened session attached to an unmanaged page changes nothing managed.
    handle_client_cdp_message(&raw_resize(Some("FLAT-FOREIGN"), 500, 400, 1.0), principal, false, &mut targets).await;
    // A browser-level command without a session is rejected by the browser: nothing to fence.
    handle_client_cdp_message(&raw_resize(None, 500, 400, 1.0), principal, false, &mut targets).await;
    for ms in [&a, &b] {
        assert_eq!(registry.get_session(&ms.session_id, principal).await.unwrap().viewport_epoch, "1");
        assert_eq!(ms.producer.viewport_epoch(), 1);
        assert!(ms.producer.input_geometry_trusted());
        assert!(ms.input.enqueue_input(key_input(ms, 1, 1)).await.is_ok());
    }

    // A mapped session addressing a managed target fences exactly that target's session.
    handle_client_cdp_message(&raw_resize(Some("FLAT-B"), 640, 480, 1.0), principal, false, &mut targets).await;
    assert_eq!(registry.get_session(&b.session_id, principal).await.unwrap().viewport_epoch, "2");
    assert_eq!(registry.get_session(&a.session_id, principal).await.unwrap().viewport_epoch, "1");
    assert_eq!(a.producer.viewport_epoch(), 1);
    assert_eq!(b.producer.viewport_epoch(), 2);
}

#[tokio::test]
async fn test_raw_resize_from_unmapped_session_fences_conservatively_without_guessing_geometry() {
    let principal = "raw-fence-unmapped-user";
    let mock = spawn_mock_cdp().await;
    let ms = managed_session(principal, "TARGET-UNMAPPED", &mock).await;
    let registry = global_session_registry();

    let mut targets = RawSessionTargets::new(None);
    // Never saw this flattened session attach: its target is unknown.
    handle_client_cdp_message(&raw_resize(Some("FLAT-UNKNOWN"), 1024, 768, 2.0), principal, false, &mut targets).await;

    let updated = registry.get_session(&ms.session_id, principal).await.unwrap();
    assert_eq!(updated.viewport_epoch, "2");
    assert_eq!(updated.geometry.css_width, 800.0, "unmapped command must not adopt guessed geometry");
    assert!(!updated.input_available);
    assert_eq!(ms.producer.viewport_epoch(), 2);
    assert_eq!(ms.producer.geometry().await.css_width, 800.0);
    assert!(!ms.producer.input_geometry_trusted());
    assert!(matches!(
        ms.input.enqueue_input(key_input(&ms, 1, 1)).await,
        Err(InputError::StaleViewportEpoch { expected: 2, actual: 1 })
    ));
}

#[tokio::test]
async fn test_raw_page_socket_sessionless_resize_and_clear_fence_its_target() {
    let principal = "raw-fence-page-user";
    let mock = spawn_mock_cdp().await;
    let ms = managed_session(principal, "TARGET-PAGE-SOCKET", &mock).await;
    let registry = global_session_registry();

    // `/cdp/ws/{target}`: sessionless Emulation commands address the page itself.
    let mut targets = RawSessionTargets::new(Some("TARGET-PAGE-SOCKET".to_string()));
    handle_client_cdp_message(&raw_resize(None, 1024, 768, 1.0), principal, false, &mut targets).await;
    let resized = registry.get_session(&ms.session_id, principal).await.unwrap();
    assert_eq!((resized.viewport_epoch.as_str(), resized.geometry.css_width), ("2", 1024.0));
    assert_eq!(ms.producer.viewport_epoch(), 2);

    let clear = serde_json::json!({ "id": 10, "method": "Emulation.clearDeviceMetricsOverride" }).to_string();
    handle_client_cdp_message(&clear, principal, false, &mut targets).await;
    let cleared = registry.get_session(&ms.session_id, principal).await.unwrap();
    assert_eq!(cleared.viewport_epoch, "3");
    assert!(!cleared.input_available, "clearing geometry must disable input pending reconciliation");
    assert_eq!(ms.producer.viewport_epoch(), 3);
    assert!(!ms.producer.input_geometry_trusted());
    assert!(matches!(
        ms.input.enqueue_input(key_input(&ms, 1, 2)).await,
        Err(InputError::StaleViewportEpoch { expected: 3, actual: 2 })
    ));
}

fn find_test_browser() -> Option<PathBuf> {
    dam_hopper_server::browser_host::process::find_browser_executable(None).ok()
}

async fn get_json(app: &axum::Router, uri: &str, token: &str, host: &str) -> (StatusCode, String) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("host", host)
        .header("x-forwarded-host", host)
        .header("forwarded", format!("host={host};proto=http"))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

/// LA:L9 — with no trusted public origin configured, discovery is rejected BEFORE any browser is
/// started and never reflects the request Host or forwarded headers.
#[tokio::test]
async fn test_discovery_without_trusted_public_origin_is_rejected_not_reflected() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-no-origin", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    for uri in [
        "/api/browser/cdp/json/version",
        "/api/browser/cdp/json/list",
    ] {
        let (status, body) = get_json(&app, uri, &token, "attacker.example:8443").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        assert!(body.contains("publicOriginUnavailable"), "{uri}: {body}");
        assert!(!body.contains("attacker.example"), "{uri}: {body}");
    }
}

/// LA:L9 — an unbound/wildcard dev listener is not a trusted public origin either.
#[tokio::test]
async fn test_dev_discovery_requires_loopback_bound_listener() {
    for (bound, expect_ok_origin) in [
        (None, false),
        (Some("0.0.0.0:4801"), false),
        (Some("[::]:4801"), false),
        (Some("127.0.0.1:4801"), true),
    ] {
        let tmp = tempdir().unwrap();
        let state = create_test_state(tmp.path().to_path_buf(), true);
        if let Some(bound) = bound {
            state.record_bound_listener(bound.parse().unwrap()).unwrap();
        }
        let app = build_router_with_origins(state, vec![]);
        let mut req = Request::builder()
            .method("GET")
            .uri("/api/browser/cdp/json/version")
            .header("host", "attacker.example")
            .header(ORIGIN, "http://127.0.0.1:5173")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(axum::extract::ConnectInfo(
            "127.0.0.1:50000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body = String::from_utf8_lossy(
            &axum::body::to_bytes(resp.into_body(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .into_owned();
        assert!(!body.contains("attacker.example"), "{bound:?}: {body}");
        if expect_ok_origin {
            // Admitted and the origin is the bound loopback socket; the browser engine may be
            // unavailable in this unit environment, which is a different (503/502) outcome.
            assert_ne!(status, StatusCode::FORBIDDEN, "{bound:?}: {body}");
        } else {
            assert_eq!(status, StatusCode::FORBIDDEN, "{bound:?}: {body}");
            assert!(body.contains("devBypassDenied"), "{bound:?}: {body}");
        }
    }
}

/// LA:L9 — every origin-bearing discovery/upgrade request needs an exactly approved Origin:
/// empty, non-UTF8 and empty-allowlist cases are denied even with a valid Admin bearer.
#[tokio::test]
async fn test_cdp_origin_empty_malformed_and_empty_allowlist_denied() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-origin-exact", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let bad_origins = [
        HeaderValue::from_static(""),
        HeaderValue::from_static("null"),
        HeaderValue::from_bytes(&[0xff]).unwrap(),
        HeaderValue::from_static("https://app.example"), // empty allowlist approves nothing
    ];
    for origin in bad_origins {
        for uri in [
            "/api/browser/cdp/json/version",
            "/api/browser/cdp/json/list",
            "/api/browser/cdp/ws",
        ] {
            let mut builder = Request::builder()
                .method("GET")
                .uri(uri)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header(ORIGIN, origin.clone());
            if uri.ends_with("/ws") {
                builder = builder
                    .header(CONNECTION, "Upgrade")
                    .header(UPGRADE, "websocket")
                    .header(SEC_WEBSOCKET_VERSION, "13")
                    .header(SEC_WEBSOCKET_KEY, "dGhlIHNhbXBsZSBub25jZQ==");
            }
            let resp = app
                .clone()
                .oneshot(builder.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                resp.status(),
                StatusCode::FORBIDDEN,
                "{uri} origin {origin:?}"
            );
        }
    }
}

/// LA:L9 — HTTPS configured-origin discovery against a real Chromium: advertised URLs are
/// derived ONLY from the configured public origin (`wss://`), and the request Host, forwarded
/// headers and loopback engine endpoint are never advertised.
#[tokio::test]
async fn test_https_configured_origin_discovery_on_real_browser() {
    let Some(exec) = find_test_browser() else {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("Required Chrome/Chromium executable not found on host");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-https-discovery", UserRole::Admin, true);
    let browser = BrowserHostConfig {
        enabled: true,
        executable_path: Some(exec),
        profile_root: Some(tmp.path().join("profiles")),
        ..BrowserHostConfig::default()
    };
    let state = create_test_state_with_browser(tmp.path().to_path_buf(), false, Some(browser))
        .with_auth_service(Arc::new(auth_service))
        .with_public_server_origin(Some(
            PublicServerOrigin::parse("https://browser.example.com").unwrap(),
        ));
    let app = build_router_with_origins(state.clone(), vec![]);

    let (status, body) = get_json(
        &app,
        "/api/browser/cdp/json/version",
        &token,
        "attacker.example:8443",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let version: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        version["webSocketDebuggerUrl"],
        "wss://browser.example.com/api/browser/cdp/ws"
    );
    assert!(!body.contains("attacker.example"), "{body}");
    assert!(!body.contains("127.0.0.1"), "{body}");

    let (status, body) = get_json(
        &app,
        "/api/browser/cdp/json/list",
        &token,
        "attacker.example:8443",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let list: Value = serde_json::from_str(&body).unwrap();
    for target in list.as_array().unwrap() {
        let ws = target["webSocketDebuggerUrl"].as_str().unwrap();
        assert!(
            ws.starts_with("wss://browser.example.com/api/browser/cdp/ws"),
            "{ws}"
        );
    }
    assert!(!body.contains("attacker.example"), "{body}");
    assert!(!body.contains("127.0.0.1"), "{body}");

    state.browser_host.shutdown_all().await;
}
