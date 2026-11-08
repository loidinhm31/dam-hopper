use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;

use axum::body::Body;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{Request, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tower::ServiceExt;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::browser_host::{
    get_or_create_input_manager, global_session_registry, X_BROWSER_LEASE,
};
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::input::{
    map_fraction_to_css_coords, InputError, InputEvent, InputMessage, MouseButton,
    MAX_RELIABLE_RECORDS,
};
use dam_hopper_server::browser_host::protocol::TargetGeometry;
use dam_hopper_server::browser_host::session::{CreateSessionRequest, ViewportRequest};
use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use opaque_ke::ServerSetup;

static ENV_LOCK: Mutex<()> = Mutex::new(());
static SERIAL_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const JWT_SECRET: &str = "test-jwt-secret-key-browser-input";

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
async fn test_rest_control_lease_lifecycle() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-lease-user", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    // Create session first
    let (session_dto, _) = global_session_registry()
        .create_or_idempotent_get(
            "admin-lease-user",
            false,
            "inc-1",
            1,
            &CreateSessionRequest {
                creation_key: uuid::Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();

    let session_id = session_dto.browser_session_id;

    // 1. Viewer 1 acquires lease -> 200 OK
    let req_acq1 = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/control/acquire"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "viewerId": "viewer-1",
                "holderKind": "human"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_acq1 = app.clone().oneshot(req_acq1).await.unwrap();
    assert_eq!(resp_acq1.status(), StatusCode::OK);
    let body_acq1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_acq1.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();
    let lease_token = body_acq1["leaseToken"].as_str().unwrap().to_string();

    // 2. Viewer 2 tries to acquire lease -> 409 Conflict (no silent steal)
    let req_acq2 = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/control/acquire"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "viewerId": "viewer-2",
                "holderKind": "agent"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_acq2 = app.clone().oneshot(req_acq2).await.unwrap();
    assert_eq!(resp_acq2.status(), StatusCode::CONFLICT);

    // 3. Viewer 1 renews lease -> 200 OK
    let req_renew = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/control/renew"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "leaseToken": lease_token }).to_string()))
        .unwrap();

    let resp_renew = app.clone().oneshot(req_renew).await.unwrap();
    assert_eq!(resp_renew.status(), StatusCode::OK);

    // 4. Fake token renewal -> 403 Forbidden
    let req_fake_renew = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/control/renew"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "leaseToken": "fake-token" }).to_string()))
        .unwrap();

    let resp_fake = app.clone().oneshot(req_fake_renew).await.unwrap();
    assert_eq!(resp_fake.status(), StatusCode::FORBIDDEN);

    // 5. Release lease -> 200 OK
    let req_release = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/control/release"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "leaseToken": lease_token }).to_string()))
        .unwrap();
    let resp_release = app.clone().oneshot(req_release).await.unwrap();
    assert_eq!(resp_release.status(), StatusCode::OK);

    // 6. Viewer 2 can now acquire lease -> 200 OK
    let req_acq2_after = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/control/acquire"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "viewerId": "viewer-2",
                "holderKind": "agent"
            })
            .to_string(),
        ))
        .unwrap();
    let resp_acq2_after = app.oneshot(req_acq2_after).await.unwrap();
    assert_eq!(resp_acq2_after.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_viewport_update_and_epochs() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-vp-user", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    let (session_dto, _) = global_session_registry()
        .create_or_idempotent_get(
            "admin-vp-user",
            false,
            "inc-1",
            1,
            &CreateSessionRequest {
                creation_key: uuid::Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();

    let session_id = session_dto.browser_session_id;

    // Acquire lease
    let input_mgr = get_or_create_input_manager(&session_id).await;
    let (lease_token, _) = input_mgr.acquire_lease("v1", "human").await.unwrap();

    // Viewport PUT with valid lease and viewportEpoch: 1
    let req_vp = Request::builder()
        .method("PUT")
        .uri(format!("/api/browser/sessions/{session_id}/viewport"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "viewportEpoch": 1,
                "width": 1920,
                "height": 1080,
                "dpr": 2.0
            })
            .to_string(),
        ))
        .unwrap();

    let resp_vp = app.clone().oneshot(req_vp).await.unwrap();
    assert_eq!(resp_vp.status(), StatusCode::OK);
    let body_vp: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_vp.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();

    // Viewport epoch advanced to 2
    assert_eq!(body_vp["viewportEpoch"].as_str().unwrap(), "2");
    assert_eq!(body_vp["geometry"]["cssWidth"].as_f64().unwrap(), 1920.0);
    assert_eq!(body_vp["geometry"]["cssHeight"].as_f64().unwrap(), 1080.0);

    // Stale epoch (repeating with epoch 1) returns 409 Conflict
    let req_stale = Request::builder()
        .method("PUT")
        .uri(format!("/api/browser/sessions/{session_id}/viewport"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "viewportEpoch": 1,
                "width": 1280,
                "height": 900,
                "dpr": 1.0
            })
            .to_string(),
        ))
        .unwrap();

    let resp_stale = app.oneshot(req_stale).await.unwrap();
    assert_eq!(resp_stale.status(), StatusCode::CONFLICT);
}

#[test]
fn test_fraction_to_css_mapping_and_boundaries() {
    let geo = TargetGeometry {
        css_width: 1280.0,
        css_height: 900.0,
        offset_top: 25.0,
        scroll_x: 50.0,
        scroll_y: 100.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.5,
    };

    // Centroid: (0.5, 0.5)
    let (x, y) = map_fraction_to_css_coords(0.5, 0.5, &geo).unwrap();
    assert_eq!(x, 640.0);
    assert_eq!(y, 475.0); // 450 + 25 offset_top (scroll offsets NOT added to coords)

    // Boundaries: (0.0, 0.0) -> (0, offset_top)
    let (x0, y0) = map_fraction_to_css_coords(0.0, 0.0, &geo).unwrap();
    assert_eq!(x0, 0.0);
    assert_eq!(y0, 25.0);

    // Boundaries: (1.0, 1.0) -> (css_width, css_height + offset_top)
    let (x1, y1) = map_fraction_to_css_coords(1.0, 1.0, &geo).unwrap();
    assert_eq!(x1, 1280.0);
    assert_eq!(y1, 925.0);

    // Negative or > 1.0 rejected
    assert!(map_fraction_to_css_coords(-0.01, 0.5, &geo).is_err());
    assert!(map_fraction_to_css_coords(0.5, 1.01, &geo).is_err());
    assert!(map_fraction_to_css_coords(f64::NAN, 0.5, &geo).is_err());
}

#[tokio::test]
async fn test_reliable_queue_coalescing_and_sequence_gap() {
    let input_mgr = dam_hopper_server::browser_host::input::SessionInputManager::new();
    let (token, _) = input_mgr.acquire_lease("viewer-queue", "human").await.unwrap();

    let make_move = |seq: u64, u: f64, v: f64| InputMessage {
        browser_session_id: "s1".to_string(),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub1".to_string(),
        lease_token: token.clone(),
        input_seq: seq,
        viewport_epoch: 1,
        event: InputEvent::PointerMove { u, v, modifiers: 0 },
    };

    // Send move seq 1
    assert!(input_mgr.enqueue_input(make_move(1, 0.1, 0.1)).await.is_ok());

    // Send adjacent move seq 2 -> coalesced
    assert!(input_mgr.enqueue_input(make_move(2, 0.2, 0.2)).await.is_ok());

    // Send button down seq 3 -> barrier event
    let down_msg = InputMessage {
        browser_session_id: "s1".to_string(),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub1".to_string(),
        lease_token: token.clone(),
        input_seq: 3,
        viewport_epoch: 1,
        event: InputEvent::PointerDown {
            button: MouseButton::Left,
            u: 0.2,
            v: 0.2,
            modifiers: 0,
        },
    };
    assert!(input_mgr.enqueue_input(down_msg).await.is_ok());

    // Duplicate seq 3 ignored
    let dup_res = input_mgr.enqueue_input(make_move(3, 0.2, 0.2)).await.unwrap();
    assert_eq!(dup_res, None);

    // Sequence gap: send seq 5 instead of 4 -> revokes lease!
    let gap_err = input_mgr.enqueue_input(make_move(5, 0.3, 0.3)).await.unwrap_err();
    assert!(matches!(gap_err, InputError::SequenceGap { expected: 4, actual: 5 }));

    // Lease was revoked
    assert_eq!(input_mgr.renew_lease(&token, None).await.unwrap_err(), InputError::LeaseNotFound);
}

#[tokio::test]
async fn test_saturation_queue_overflow_releases_held_keys() {
    let input_mgr = dam_hopper_server::browser_host::input::SessionInputManager::new();
    let (token, _) = input_mgr.acquire_lease("viewer-saturate", "human").await.unwrap();

    // Press Shift and Left button
    let shift_down = InputMessage {
        browser_session_id: "s1".to_string(),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub1".to_string(),
        lease_token: token.clone(),
        input_seq: 1,
        viewport_epoch: 1,
        event: InputEvent::KeyDown {
            key: "Shift".to_string(),
            code: "ShiftLeft".to_string(),
            modifiers: 8,
        },
    };
    input_mgr.enqueue_input(shift_down).await.unwrap();

    let btn_down = InputMessage {
        browser_session_id: "s1".to_string(),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub1".to_string(),
        lease_token: token.clone(),
        input_seq: 2,
        viewport_epoch: 1,
        event: InputEvent::PointerDown {
            button: MouseButton::Left,
            u: 0.5,
            v: 0.5,
            modifiers: 8,
        },
    };
    input_mgr.enqueue_input(btn_down).await.unwrap();

    // Saturate queue with non-coalescing events up to capacity
    for seq in 3..=(MAX_RELIABLE_RECORDS as u64 + 5) {
        let text_msg = InputMessage {
            browser_session_id: "s1".to_string(),
            browser_incarnation: "inc1".to_string(),
            profile_epoch: 1,
            subscription_epoch: "sub1".to_string(),
            lease_token: token.clone(),
            input_seq: seq,
            viewport_epoch: 1,
            event: InputEvent::InsertText {
                text: format!("char-{}", seq),
            },
        };
        if let Err(err) = input_mgr.enqueue_input(text_msg).await {
            assert!(matches!(err, InputError::QueueOverflow));
            break;
        }
    }

    // Lease was revoked on overflow, releasing held keys
    let _releases = input_mgr.revoke_lease().await;
    assert_eq!(input_mgr.renew_lease(&token, None).await.unwrap_err(), InputError::LeaseNotFound);
}
#[tokio::test]
async fn test_lease_renewal_clipped_to_auth_deadline() {
    let input_mgr = dam_hopper_server::browser_host::input::SessionInputManager::new();
    let (token, _) = input_mgr.acquire_lease("viewer-dl", "human").await.unwrap();

    // Deadline in past -> LeaseExpired
    let past_deadline = Utc::now() - ChronoDuration::seconds(10);
    assert_eq!(
        input_mgr.renew_lease(&token, Some(past_deadline)).await.unwrap_err(),
        InputError::LeaseExpired
    );

    // Deadline in 5s -> renewed expiry is clipped to <= 5s
    let future_deadline = Utc::now() + ChronoDuration::seconds(5);
    let exp_ms = input_mgr.renew_lease(&token, Some(future_deadline)).await.unwrap();
    let now_ms = Utc::now().timestamp_millis();
    assert!(exp_ms - now_ms <= 6000);
}

#[tokio::test]
async fn test_selected_text_and_find_commands() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-text-user", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    let (session_dto, _) = global_session_registry()
        .create_or_idempotent_get(
            "admin-text-user",
            false,
            "inc-1",
            1,
            &CreateSessionRequest {
                creation_key: uuid::Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();

    let session_id = session_dto.browser_session_id;
    let input_mgr = get_or_create_input_manager(&session_id).await;
    let (lease_token, _) = input_mgr.acquire_lease("viewer-t", "human").await.unwrap();

    // Cache some text
    input_mgr.set_selected_text("Hello CDP world!").await;

    // 1. GET selected-text WITHOUT X-Browser-Lease header -> 403 Forbidden
    let req_no_header = Request::builder()
        .method("GET")
        .uri(format!("/api/browser/sessions/{session_id}/selected-text"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp_no = app.clone().oneshot(req_no_header).await.unwrap();
    assert_eq!(resp_no.status(), StatusCode::FORBIDDEN);

    // 2. GET selected-text WITH valid X-Browser-Lease header -> 200 OK
    let req_with_header = Request::builder()
        .method("GET")
        .uri(format!("/api/browser/sessions/{session_id}/selected-text"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(&X_BROWSER_LEASE, &lease_token)
        .body(Body::empty())
        .unwrap();

    let resp_ok = app.clone().oneshot(req_with_header).await.unwrap();
    assert_eq!(resp_ok.status(), StatusCode::OK);
    let body_text: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_ok.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();
    assert_eq!(body_text["text"], "Hello CDP world!");

    // 3. POST find within bounds (<= 256 chars) -> 200 OK
    let req_find = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/find"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "query": "CDP",
                "forward": true
            })
            .to_string(),
        ))
        .unwrap();

    let resp_find = app.clone().oneshot(req_find).await.unwrap();
    assert_eq!(resp_find.status(), StatusCode::OK);

    // 4. POST find exceeding 256 chars -> 400 Bad Request
    let long_query = "x".repeat(300);
    let req_find_long = Request::builder()
        .method("POST")
        .uri(format!("/api/browser/sessions/{session_id}/find"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "query": long_query,
                "forward": true
            })
            .to_string(),
        ))
        .unwrap();

    let resp_find_long = app.oneshot(req_find_long).await.unwrap();
    assert_eq!(resp_find_long.status(), StatusCode::BAD_REQUEST);
}
