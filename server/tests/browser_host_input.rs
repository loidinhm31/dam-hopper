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
        .insert_running_for_test(
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
        .insert_running_for_test(
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
                "viewportEpoch": "1",
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
                "viewportEpoch": "1",
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

#[tokio::test]
async fn test_viewport_sanitized_noop_and_flood_coalescing() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-vp-coalesce", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    let (session_dto, _) = global_session_registry()
        .insert_running_for_test(
            "admin-vp-coalesce",
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
    let (lease_token, _) = input_mgr.acquire_lease("v1", "human").await.unwrap();

    // 1. Identical sanitized viewport (1280x900@1.0) is a no-op: returns 200 OK with epoch still "1"
    let req_noop = Request::builder()
        .method("PUT")
        .uri(format!("/api/browser/sessions/{session_id}/viewport"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "viewportEpoch": "1",
                "width": 1280,
                "height": 900,
                "dpr": 1.0
            })
            .to_string(),
        ))
        .unwrap();
    let resp_noop = app.clone().oneshot(req_noop).await.unwrap();
    assert_eq!(resp_noop.status(), StatusCode::OK);
    let body_noop: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_noop.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();
    assert_eq!(body_noop["viewportEpoch"].as_str().unwrap(), "1");

    // 2. Clamped identical viewport (width 1920, height 1080 -> after applying 1920x1080@3.0, sending 9999x9999@9.0 clamps to 1920x1080@3.0 -> no-op!)
    let req_max = Request::builder()
        .method("PUT")
        .uri(format!("/api/browser/sessions/{session_id}/viewport"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "viewportEpoch": "1",
                "width": 1920,
                "height": 1080,
                "dpr": 3.0
            })
            .to_string(),
        ))
        .unwrap();
    let resp_max = app.clone().oneshot(req_max).await.unwrap();
    assert_eq!(resp_max.status(), StatusCode::OK);
    let body_max: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_max.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();
    assert_eq!(body_max["viewportEpoch"].as_str().unwrap(), "2");

    let req_clamped_noop = Request::builder()
        .method("PUT")
        .uri(format!("/api/browser/sessions/{session_id}/viewport"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "leaseToken": lease_token,
                "viewportEpoch": "2",
                "width": 4000,
                "height": 3000,
                "dpr": 5.0
            })
            .to_string(),
        ))
        .unwrap();
    let resp_clamped_noop = app.clone().oneshot(req_clamped_noop).await.unwrap();
    assert_eq!(resp_clamped_noop.status(), StatusCode::OK);
    let body_clamped: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_clamped_noop.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();
    assert_eq!(
        body_clamped["viewportEpoch"].as_str().unwrap(),
        "2",
        "clamped identical viewport must not advance epoch"
    );

    // 3. Resize flood coalescing: 1 active + 1 latest pending (intermediate superseded, final applied)
    let reg = global_session_registry();
    let out1 = reg
        .begin_viewport_transaction(&session_id, "admin-vp-coalesce", Some(2), 1000, 700, 1.0)
        .await
        .unwrap()
        .err()
        .expect("leader outcome");
    assert!(matches!(
        out1,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Leader { .. }
    ));

    // Two rapid subsequent updates while leader is active -> both become Followers, coalesced to latest (800x600@1.5)
    let out2 = reg
        .begin_viewport_transaction(&session_id, "admin-vp-coalesce", Some(2), 900, 650, 1.0)
        .await
        .unwrap()
        .err()
        .expect("follower 1");
    let out3 = reg
        .begin_viewport_transaction(&session_id, "admin-vp-coalesce", Some(2), 800, 600, 1.5)
        .await
        .unwrap()
        .err()
        .expect("follower 2");
    assert!(matches!(
        out2,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Follower(_)
    ));
    assert!(matches!(
        out3,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Follower(_)
    ));

    let (coalesced_req, waiters, _wait) = reg
        .take_next_coalesced_viewport(&session_id)
        .await
        .expect("coalesced pending slot");
    assert_eq!(coalesced_req.width, 800);
    assert_eq!(coalesced_req.height, 600);
    assert_eq!(coalesced_req.dpr, 1.5);
    assert_eq!(waiters.len(), 2, "both followers share the single coalesced pending slot");
    assert!(reg.take_next_coalesced_viewport(&session_id).await.is_none());
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
        .insert_running_for_test(
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

#[tokio::test]
async fn test_viewport_coalescer_race_and_lease_revoked_exit() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    let reg = global_session_registry();
    reg.reset_for_test().await;

    let (session_dto, _) = reg
        .insert_running_for_test(
            "admin-race-test",
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

    // Part 1: Enqueue follower between take-next and retire cannot strand.
    // 1. First transaction becomes Leader.
    let leader_out = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 1024, 768, 1.0)
        .await
        .unwrap()
        .err()
        .expect("leader");
    assert!(matches!(
        leader_out,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Leader { .. }
    ));

    // 2. Enqueue follower A while leader is active.
    let follower_a = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 800, 600, 1.0)
        .await
        .unwrap()
        .err()
        .expect("follower a");
    assert!(matches!(
        follower_a,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Follower(_)
    ));

    // 3. Worker takes follower A. Pending is now None, active is still true.
    let (req_a, waiters_a, _) = reg
        .take_next_coalesced_viewport(&session_id)
        .await
        .expect("follower A extracted");
    assert_eq!(req_a.width, 800);
    assert_eq!(waiters_a.len(), 1);

    // 4. Follower B is enqueued while worker executes follower A.
    let follower_b = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 640, 480, 1.0)
        .await
        .unwrap()
        .err()
        .expect("follower b");
    assert!(matches!(
        follower_b,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Follower(_)
    ));

    // 5. Worker takes follower B.
    let (req_b, waiters_b, _) = reg
        .take_next_coalesced_viewport(&session_id)
        .await
        .expect("follower B extracted");
    assert_eq!(req_b.width, 640);
    assert_eq!(waiters_b.len(), 1);

    // 6. Worker calls take_next_coalesced_viewport when pending is None:
    // It atomically retires active = false under the exact same lock!
    assert!(reg.take_next_coalesced_viewport(&session_id).await.is_none());

    // 7. A subsequent request arrives immediately: because active was retired atomically,
    // it MUST become a new Leader, never a stranded follower!
    let next_leader = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 1920, 1080, 1.0)
        .await
        .unwrap()
        .err()
        .expect("new leader");
    assert!(matches!(
        next_leader,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Leader { .. }
    ));

    // Part 2: Lease-revoked exit resolves all waiters and retires coalescer atomically.
    // Enqueue two followers behind next_leader.
    let out_f1 = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 1600, 900, 1.0)
        .await
        .unwrap()
        .err()
        .unwrap();
    let out_f2 = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 1440, 900, 1.0)
        .await
        .unwrap()
        .err()
        .unwrap();

    let rx_f1 = match out_f1 {
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Follower(rx) => rx,
        _ => panic!("expected follower 1"),
    };
    let rx_f2 = match out_f2 {
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Follower(rx) => rx,
        _ => panic!("expected follower 2"),
    };

    // Simulate lease revocation aborting all pending coalesced waiters atomically.
    let lease_err = SessionError::Conflict("control lease revoked".to_string());
    reg.abort_viewport_coalescer(&session_id, lease_err).await;

    // Both queued waiters MUST resolve with explicit conflict error (not dropped or hung).
    let res1 = rx_f1.await.expect("waiter 1 channel not dropped");
    let res2 = rx_f2.await.expect("waiter 2 channel not dropped");
    assert!(matches!(&res1, Err(SessionError::Conflict(msg)) if msg.contains("control lease revoked")));
    assert!(matches!(&res2, Err(SessionError::Conflict(msg)) if msg.contains("control lease revoked")));

    // Coalescer is retired: take_next is None, next call becomes Leader.
    assert!(reg.take_next_coalesced_viewport(&session_id).await.is_none());
    let fresh = reg
        .begin_viewport_transaction(&session_id, "admin-race-test", Some(1), 1280, 720, 1.0)
        .await
        .unwrap()
        .err()
        .expect("fresh leader");
    assert!(matches!(
        fresh,
        dam_hopper_server::browser_host::session::ViewportQueueOutcome::Leader { .. }
    ));
}

// ---------------------------------------------------------------------------
// Canonical decimal-string counters (SI-08): REST + WS DTO boundaries
// ---------------------------------------------------------------------------

const TWO_POW_53_PLUS_1: &str = "9007199254740993";
const U64_MAX: &str = "18446744073709551615";

async fn send_json(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

struct CounterFixture {
    app: axum::Router,
    token: String,
    session_id: String,
    lease_token: String,
    _tmp: tempfile::TempDir,
}

async fn counter_fixture(principal: &str) -> CounterFixture {
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token(principal, UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    let (dto, _) = global_session_registry()
        .insert_running_for_test(
            principal,
            false,
            "inc-1",
            1,
            &CreateSessionRequest {
                creation_key: uuid::Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
            },
            &[],
        )
        .await
        .unwrap();
    let session_id = dto.browser_session_id;
    let (lease_token, _) = get_or_create_input_manager(&session_id)
        .await
        .acquire_lease("v1", "human")
        .await
        .unwrap();
    CounterFixture { app, token, session_id, lease_token, _tmp: tmp }
}

#[tokio::test]
async fn test_rest_counters_reject_numbers_and_non_canonical_strings() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    let fx = counter_fixture("counter-reject-user").await;
    let bad_values = [
        json!(1),
        json!(1.0),
        json!(null),
        json!("0"),
        json!("01"),
        json!("+1"),
        json!("-1"),
        json!("1.0"),
        json!(" 1"),
        json!("1 "),
        json!("1e3"),
        json!("0x1"),
        json!(""),
        json!("18446744073709551616"),
        json!("١"),
    ];
    for bad in &bad_values {
        let vp = send_json(
            &fx.app,
            "PUT",
            &format!("/api/browser/sessions/{}/viewport", fx.session_id),
            &fx.token,
            json!({ "leaseToken": fx.lease_token, "viewportEpoch": bad, "width": 1000, "height": 700, "dpr": 1.0 }),
        )
        .await;
        assert_eq!(vp.0, StatusCode::UNPROCESSABLE_ENTITY, "viewportEpoch {bad} must be rejected");
        for (route, body) in [
            ("navigate", json!({ "url": "about:blank", "navigationRevision": bad })),
            ("history", json!({ "direction": "back", "navigationRevision": bad })),
            ("reload", json!({ "navigationRevision": bad })),
        ] {
            let res = send_json(
                &fx.app,
                "POST",
                &format!("/api/browser/sessions/{}/{route}", fx.session_id),
                &fx.token,
                body,
            )
            .await;
            assert_eq!(
                res.0,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{route} navigationRevision {bad} must be rejected"
            );
        }
    }
    // Selection and profile-reset DTOs use the same canonical decimal wire format.
    for bad in &bad_values {
        for (route, body) in [
            ("selection/start", json!({ "leaseToken": fx.lease_token, "navigationRevision": bad })),
            ("selection/cancel", json!({ "leaseToken": fx.lease_token, "navigationRevision": bad })),
            (
                "selection/artifacts",
                json!({ "selectionRevision": bad, "terminalId": "t", "terminalIncarnation": "1" }),
            ),
            (
                "selection/artifacts",
                json!({ "selectionRevision": "0", "terminalId": "t", "terminalIncarnation": bad }),
            ),
        ] {
            let res = send_json(
                &fx.app,
                "POST",
                &format!("/api/browser/sessions/{}/{route}", fx.session_id),
                &fx.token,
                body,
            )
            .await;
            // selectionRevision/terminalIncarnation may legitimately be zero.
            let zero_ok = bad == &json!("0");
            if !zero_ok {
                assert_eq!(res.0, StatusCode::UNPROCESSABLE_ENTITY, "{route} {bad}");
            }
        }
        let reset = send_json(
            &fx.app,
            "POST",
            "/api/browser/profile/reset",
            &fx.token,
            json!({ "operationId": "op-1", "expectedProfileEpoch": bad, "confirmed": true }),
        )
        .await;
        assert_eq!(reset.0, StatusCode::UNPROCESSABLE_ENTITY, "reset expectedProfileEpoch {bad}");
    }
    // Canonical string is accepted and the DTO is unchanged by the rejected attempts.
    let ok = send_json(
        &fx.app,
        "PUT",
        &format!("/api/browser/sessions/{}/viewport", fx.session_id),
        &fx.token,
        json!({ "leaseToken": fx.lease_token, "viewportEpoch": "1", "width": 1000, "height": 700, "dpr": 1.0 }),
    )
    .await;
    assert_eq!(ok.0, StatusCode::OK);
    assert_eq!(ok.1["viewportEpoch"], "2");
}

#[tokio::test]
async fn test_rest_counters_round_trip_at_two_pow_53_plus_1_and_u64_max() {
    let _serial = SERIAL_TEST_LOCK.lock().await;
    let fx = counter_fixture("counter-boundary-user").await;
    let reg = global_session_registry();
    let vp_uri = format!("/api/browser/sessions/{}/viewport", fx.session_id);
    let reload_uri = format!("/api/browser/sessions/{}/reload", fx.session_id);

    // 2^53+1: exact identity above the JS safe-integer range, advances by exactly one.
    let dto = reg
        .set_counters_for_test(&fx.session_id, 9_007_199_254_740_993, 9_007_199_254_740_993)
        .await
        .unwrap();
    assert_eq!(dto.navigation_revision, TWO_POW_53_PLUS_1);
    let vp = send_json(
        &fx.app,
        "PUT",
        &vp_uri,
        &fx.token,
        json!({ "leaseToken": fx.lease_token, "viewportEpoch": TWO_POW_53_PLUS_1, "width": 1000, "height": 700, "dpr": 1.0 }),
    )
    .await;
    assert_eq!(vp.0, StatusCode::OK, "{:?}", vp.1);
    assert_eq!(vp.1["viewportEpoch"], "9007199254740994");
    let rl = send_json(&fx.app, "POST", &reload_uri, &fx.token, json!({ "navigationRevision": TWO_POW_53_PLUS_1 })).await;
    assert_eq!(rl.0, StatusCode::OK, "{:?}", rl.1);
    assert_eq!(rl.1["navigationRevision"], "9007199254740994");
    // The neighbour that a lossy f64 round trip would collapse to is a different identity.
    let lossy = send_json(&fx.app, "POST", &reload_uri, &fx.token, json!({ "navigationRevision": "9007199254740992" })).await;
    assert_eq!(lossy.0, StatusCode::CONFLICT);
    assert!(lossy.1["error"].as_str().unwrap().contains("expected 9007199254740992, current 9007199254740994"));

    // u64::MAX parses losslessly (no 422) and is compared exactly.
    reg.set_counters_for_test(&fx.session_id, u64::MAX, u64::MAX).await.unwrap();
    let near = send_json(&fx.app, "POST", &reload_uri, &fx.token, json!({ "navigationRevision": "18446744073709551614" })).await;
    assert_eq!(near.0, StatusCode::CONFLICT);
    assert!(near.1["error"].as_str().unwrap().contains("expected 18446744073709551614, current 18446744073709551615"));
    // At the exact current identity the counter is exhausted: never wraps or saturates in place.
    let exhausted = send_json(&fx.app, "POST", &reload_uri, &fx.token, json!({ "navigationRevision": U64_MAX })).await;
    assert_eq!(exhausted.0, StatusCode::CONFLICT);
    assert!(exhausted.1["error"].as_str().unwrap().contains("exhausted"), "{:?}", exhausted.1);
    let vp_max = send_json(
        &fx.app,
        "PUT",
        &vp_uri,
        &fx.token,
        json!({ "leaseToken": fx.lease_token, "viewportEpoch": U64_MAX, "width": 900, "height": 600, "dpr": 1.0 }),
    )
    .await;
    assert_eq!(vp_max.0, StatusCode::CONFLICT);
    assert!(vp_max.1["error"].as_str().unwrap().contains("exhausted"), "{:?}", vp_max.1);
    // The session still reports the unchanged exact identity.
    let got = reg.get_session(&fx.session_id, "counter-boundary-user").await.unwrap();
    assert_eq!(got.navigation_revision, U64_MAX);
    assert_eq!(got.viewport_epoch, U64_MAX);
}

#[test]
fn test_input_message_wire_counters_are_canonical_decimal_strings() {
    let wire = |profile: Value, seq: Value, epoch: Value| {
        json!({
            "browserSessionId": "s1",
            "browserIncarnation": "inc1",
            "profileEpoch": profile,
            "subscriptionEpoch": "sub1",
            "leaseToken": "lease",
            "inputSeq": seq,
            "viewportEpoch": epoch,
            "event": { "kind": "pointerCancel" }
        })
    };
    let ok: InputMessage = serde_json::from_value(wire(
        json!(TWO_POW_53_PLUS_1),
        json!(U64_MAX),
        json!(U64_MAX),
    ))
    .expect("canonical decimal strings parse");
    assert_eq!(ok.profile_epoch, 9_007_199_254_740_993);
    assert_eq!(ok.input_seq, u64::MAX);
    assert_eq!(ok.viewport_epoch, u64::MAX);
    let echoed = serde_json::to_value(&ok).unwrap();
    assert_eq!(echoed["profileEpoch"], TWO_POW_53_PLUS_1);
    assert_eq!(echoed["inputSeq"], U64_MAX);
    assert_eq!(echoed["viewportEpoch"], U64_MAX);

    for bad in [json!(1), json!("0"), json!("01"), json!("-1"), json!("18446744073709551616"), json!(null)] {
        for (p, s, e) in [
            (bad.clone(), json!("1"), json!("1")),
            (json!("1"), bad.clone(), json!("1")),
            (json!("1"), json!("1"), bad.clone()),
        ] {
            assert!(
                serde_json::from_value::<InputMessage>(wire(p, s, e)).is_err(),
                "wire counter {bad} must be rejected"
            );
        }
    }
}

/// Live real-Chromium lifecycle: real sockets (media + control), REST and a DOM key/mouse
/// oracle observing what the native page actually received.
mod live {
    use super::*;
    use chromiumoxide_cdp::cdp::browser_protocol::target::{AttachToTargetParams, CreateTargetParams};
    use dam_hopper_server::api::browser_host::get_or_register_producer;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::process::{
        find_browser_executable, BrowserLaunchConfig, BrowserProcess,
    };
    use dam_hopper_server::browser_host::screencast::ScreencastProducer;
    use futures_util::{SinkExt, StreamExt};
    use std::net::SocketAddr;
    use std::time::Duration;
    use tokio::time::{sleep, timeout};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message;

    pub type Ws = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;
    pub const PRINCIPAL: &str = "dev-user";

    pub fn require_browser_executable() -> Option<PathBuf> {
        if let Ok(path) = find_browser_executable(None) {
            return Some(path);
        }
        for candidate in &["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return Some(p);
            }
        }
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("Required Chrome/Chromium executable not found on host");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        None
    }

    pub struct LiveInput {
        _tmp: tempfile::TempDir,
        process: BrowserProcess,
        pub client: Arc<CdpClient>,
        pub page_sid: String,
        pub target_id: String,
        pub producer: Arc<ScreencastProducer>,
        pub session_id: String,
        pub incarnation: String,
        pub addr: SocketAddr,
        http: reqwest::Client,
    }

    /// Launches Chromium, binds a running session + producer to its page, serves the real
    /// router in dev mode and installs a DOM oracle recording keydown/keyup/mousedown/mouseup.
    /// `lease_ttl` pre-seeds the session's input manager when a short lease is under test.
    pub async fn start(lease_ttl: Option<Duration>) -> Option<LiveInput> {
        let exec = require_browser_executable()?;
        global_session_registry().reset_for_test().await;
        let tmp = tempdir().unwrap();
        let mut config = BrowserLaunchConfig::new(tmp.path().join("input-live-data"));
        config.executable_path = Some(exec);
        config.headless = true;
        let process = BrowserProcess::launch(config).await.expect("browser launch");
        let client = CdpClient::connect(process.ws_endpoint()).await.expect("cdp connect");
        let target_id: String = client
            .send_typed(CreateTargetParams::builder().url("about:blank").build().unwrap(), None)
            .await
            .expect("Target.createTarget")
            .target_id
            .into();

        let state = create_test_state(tmp.path().to_path_buf(), true);
        state.config.write().await.server.browser.budgets.max_viewers = 16;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        state.record_bound_listener(addr).expect("record listener");
        let router = dam_hopper_server::api::build_router(state);
        tokio::spawn(async move {
            axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
                .await
                .unwrap();
        });

        let incarnation = uuid::Uuid::new_v4().to_string();
        let (dto, _) = global_session_registry()
            .insert_running_for_test(
                PRINCIPAL,
                true,
                &incarnation,
                1,
                &CreateSessionRequest {
                    creation_key: uuid::Uuid::new_v4().to_string(),
                    url: "about:blank".to_string(),
                    viewport: ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
                },
                &[],
            )
            .await
            .unwrap();
        let session_id = dto.browser_session_id;
        if let Some(ttl) = lease_ttl {
            dam_hopper_server::api::browser_host::global_input_managers()
                .write()
                .await
                .insert(
                    session_id.clone(),
                    dam_hopper_server::browser_host::input::SessionInputManager::new_shared(ttl),
                );
        }
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(),
            incarnation.clone(),
            1,
            1,
            client.clone(),
            target_id.clone(),
            TargetGeometry {
                css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
                page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
            },
        ));
        let page_sid = producer.ensure_page_session().await.expect("page session");
        get_or_register_producer(&session_id, producer.clone()).await;
        client
            .send_command("Emulation.setFocusEmulationEnabled", Some(json!({"enabled": true})), Some(&page_sid))
            .await
            .expect("focus emulation");
        client
            .send_command(
                "Runtime.evaluate",
                Some(json!({ "expression": "window.__ev=[];document.body.style.margin='0';\
                    document.body.style.minHeight='100vh';\
                    for (const t of ['keydown','keyup','mousedown','mouseup']) {\
                      window.addEventListener(t, e => window.__ev.push(t.startsWith('key') ? t+':'+e.code+':'+e.key : t+':'+e.button), true);\
                    }" })),
                Some(&page_sid),
            )
            .await
            .expect("install DOM oracle");
        Some(LiveInput {
            _tmp: tmp,
            process,
            client,
            page_sid,
            target_id,
            producer,
            session_id,
            incarnation,
            addr,
            http: reqwest::Client::new(),
        })
    }

    impl LiveInput {
        pub async fn finish(mut self) {
            let _ = self.process.terminate().await;
        }

        pub async fn rest(&self, method: &str, path: &str, body: Value) -> (u16, Value) {
            let url = format!("http://{}{path}", self.addr);
            let req = match method {
                "DELETE" => self.http.delete(url),
                _ => self.http.post(url).header("content-type", "application/json").body(body.to_string()),
            };
            let resp = req.send().await.expect("rest request");
            let status = resp.status().as_u16();
            let bytes = resp.bytes().await.unwrap();
            (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
        }

        pub async fn acquire(&self, viewer: &str) -> String {
            let path = format!("/api/browser/sessions/{}/control/acquire", self.session_id);
            let (status, body) =
                self.rest("POST", &path, json!({ "viewerId": viewer, "holderKind": "human" })).await;
            assert_eq!(status, 200, "{body}");
            body["leaseToken"].as_str().unwrap().to_string()
        }

        pub async fn release(&self, token: &str) -> (u16, Value) {
            let path = format!("/api/browser/sessions/{}/control/release", self.session_id);
            self.rest("POST", &path, json!({ "leaseToken": token })).await
        }

        pub async fn ticket(&self, purpose: &str, viewer: &str, sub: &str) -> (u16, Value) {
            self.rest(
                "POST",
                "/api/browser/attachments",
                json!({
                    "purpose": purpose,
                    "browserSessionId": self.session_id,
                    "viewerId": viewer,
                    "subscriptionEpoch": sub,
                    "browserIncarnation": self.incarnation,
                    "profileEpoch": "1",
                }),
            )
            .await
        }

        /// Upgrade attempt: `Ok(socket)` or the HTTP status of the refused upgrade.
        pub async fn try_connect(&self, kind: &str, viewer: &str, sub: &str) -> Result<Ws, u16> {
            let (status, body) = self.ticket(kind, viewer, sub).await;
            assert_eq!(status, 200, "ticket issue: {body}");
            let ticket = body["ticket"].as_str().unwrap().to_string();
            let mut req = format!("ws://{}/api/browser/{kind}", self.addr).into_client_request().unwrap();
            req.headers_mut().insert(
                "Sec-WebSocket-Protocol",
                format!("damhopper.browser.{kind}.v1, damhopper.ticket.{ticket}").parse().unwrap(),
            );
            match tokio_tungstenite::connect_async(req).await {
                Ok((ws, _)) => Ok(ws),
                Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => Err(resp.status().as_u16()),
                Err(other) => panic!("ws connect failed: {other}"),
            }
        }

        pub async fn connect(&self, kind: &str, viewer: &str, sub: &str) -> Ws {
            self.try_connect(kind, viewer, sub).await.expect("ws upgrade")
        }

        /// Media then control for one viewer subscription; the control socket's first status
        /// frame is consumed so the pair is established when this returns.
        pub async fn pair(&self, viewer: &str, sub: &str) -> (Ws, Ws) {
            let media = self.connect("media", viewer, sub).await;
            let mut control = self.connect("control", viewer, sub).await;
            next_text(&mut control).await;
            (media, control)
        }

        pub fn input(&self, token: &str, sub: &str, seq: u64, event: Value) -> Message {
            Message::Text(
                json!({
                    "browserSessionId": self.session_id,
                    "browserIncarnation": self.incarnation,
                    "profileEpoch": "1",
                    "subscriptionEpoch": sub,
                    "leaseToken": token,
                    "inputSeq": seq.to_string(),
                    "viewportEpoch": "1",
                    "event": event,
                })
                .to_string()
                .into(),
            )
        }

        pub async fn dom_events(&self) -> Vec<String> {
            let value = self
                .client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "JSON.stringify(window.__ev)", "returnByValue": true })),
                    Some(&self.page_sid),
                )
                .await
                .expect("read DOM oracle");
            serde_json::from_str(value["result"]["value"].as_str().unwrap()).unwrap()
        }

        pub async fn wait_dom(&self, what: &str, pred: impl Fn(&[String]) -> bool) -> Vec<String> {
            let mut last = Vec::new();
            for _ in 0..100 {
                last = self.dom_events().await;
                if pred(&last) {
                    return last;
                }
                sleep(Duration::from_millis(50)).await;
            }
            panic!("DOM oracle never observed {what}: {last:?}");
        }
    }

    pub async fn next_text(ws: &mut Ws) -> String {
        loop {
            match timeout(Duration::from_secs(5), ws.next()).await.expect("ws message") {
                Some(Ok(Message::Text(text))) => return text.to_string(),
                Some(Ok(_)) => continue,
                other => panic!("control socket ended: {other:?}"),
            }
        }
    }

    pub async fn send(ws: &mut Ws, msg: Message) {
        ws.send(msg).await.expect("ws send");
    }

    pub fn key_down() -> Value {
        json!({ "kind": "keyDown", "key": "a", "code": "KeyA", "modifiers": 0 })
    }
    pub fn pointer_down() -> Value {
        json!({ "kind": "pointerDown", "button": "left", "u": 0.5, "v": 0.5, "modifiers": 0 })
    }
    pub fn held(events: &[String]) -> bool {
        events.iter().any(|e| e == "keydown:KeyA:a") && events.iter().any(|e| e == "mousedown:0")
    }
    pub fn released(events: &[String]) -> bool {
        events.iter().any(|e| e == "keyup:KeyA:a") && events.iter().any(|e| e == "mouseup:0")
    }

    /// Holds key `a` and the left button through the control socket until the DOM saw both.
    pub async fn hold_key_and_button(live: &LiveInput, control: &mut Ws, token: &str, sub: &str) {
        send(control, live.input(token, sub, 1, key_down())).await;
        send(control, live.input(token, sub, 2, pointer_down())).await;
        live.wait_dom("native keydown+mousedown", held).await;
    }

    #[tokio::test]
    async fn real_rest_release_emits_native_keyup_and_mouseup() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-rest").await;
        hold_key_and_button(&live, &mut control, &token, "sub-rest").await;

        let (status, body) = live.release(&token).await;
        assert_eq!((status, &body["status"]), (200, &json!("released")), "{body}");
        live.wait_dom("native keyup+mouseup after REST release", released).await;
        live.finish().await;
    }

    #[tokio::test]
    async fn admitted_old_epoch_pointer_is_not_dispatched_after_geometry_fence() {
        use dam_hopper_server::browser_host::control_input::{
            handle_control_text, ControlInputContext, ControlInputOutcome,
        };

        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let manager = get_or_create_input_manager(&live.session_id).await;
        manager.set_expected_viewport_epoch(1).await;
        let ctx = ControlInputContext {
            input_manager: &manager,
            session_id: &live.session_id,
            viewer_id: "viewer-1",
            subscription_epoch: "sub-race",
            paired: true,
        };
        let text = |seq, event| match live.input(&token, "sub-race", seq, event) {
            Message::Text(text) => text.to_string(),
            _ => unreachable!(),
        };

        // Prove that this production handler and the DOM oracle can deliver native input.
        assert!(live.producer.input_geometry_trusted());
        let baseline = text(1, pointer_down());
        assert!(matches!(handle_control_text(&ctx, &baseline).await, ControlInputOutcome::Continue));
        live.wait_dom("baseline native mousedown", |events| events.iter().any(|e| e == "mousedown:0")).await;
        let baseline_up = text(2, json!({
            "kind": "pointerUp", "button": "left", "u": 0.5, "v": 0.5, "modifiers": 0
        }));
        assert!(matches!(handle_control_text(&ctx, &baseline_up).await, ControlInputOutcome::Continue));
        live.wait_dom("baseline native mouseup", |events| events.iter().any(|e| e == "mouseup:0")).await;

        // Hold the dispatch gate, queue the real geometry fence first, then drive the input
        // handler until it also waits on the gate. Polling these futures directly keeps their
        // ordering deterministic; unconstrained polling avoids Tokio's cooperative yield.
        let gate = manager.begin_dispatch(&token).await.expect("lease live");
        let registry_guard = dam_hopper_server::api::browser_host::global_input_managers().write().await;
        drop(registry_guard);
        let mut fence = Box::pin(tokio::task::unconstrained(live.producer.begin_external_geometry_fence()));
        assert!(futures_util::poll!(fence.as_mut()).is_pending());

        let stale = text(3, pointer_down());
        let mut dispatch = Box::pin(tokio::task::unconstrained(handle_control_text(&ctx, &stale)));
        assert!(futures_util::poll!(dispatch.as_mut()).is_pending());

        // A duplicate proves sequence 3 passed admission; an empty queue proves the handler
        // already popped it and is waiting for dispatch, not merely waiting for admission.
        let admitted: InputMessage = serde_json::from_str(&stale).unwrap();
        assert_eq!(manager.enqueue_input_for_viewer("viewer-1", admitted).await.unwrap(), None);
        assert!(manager.pop_next_input().await.is_none());

        drop(gate);
        timeout(Duration::from_secs(5), fence.as_mut()).await.expect("geometry fence");
        assert!(!live.producer.input_geometry_trusted());
        live.producer.commit_external_geometry_fence(2, None).await;
        assert_eq!(live.producer.viewport_epoch(), 2);
        assert!(matches!(
            timeout(Duration::from_secs(5), dispatch.as_mut()).await.expect("input dispatch"),
            ControlInputOutcome::Continue
        ));
        drop(dispatch);
        drop(fence);
        let events = live.dom_events().await;
        assert_eq!(events.iter().filter(|e| *e == "mousedown:0").count(), 1, "stale pointer reached Chromium: {events:?}");
        live.finish().await;
    }

    #[tokio::test]
    async fn real_pointer_cancel_releases_the_native_button() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-cancel").await;
        hold_key_and_button(&live, &mut control, &token, "sub-cancel").await;

        send(&mut control, live.input(&token, "sub-cancel", 3, json!({ "kind": "pointerCancel" }))).await;
        live.wait_dom("native mouseup after pointerCancel", |e| e.iter().any(|x| x == "mouseup:0")).await;
        live.finish().await;
    }

    #[tokio::test]
    async fn real_sequence_gap_releases_native_key_and_button() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-gap").await;
        hold_key_and_button(&live, &mut control, &token, "sub-gap").await;

        send(&mut control, live.input(&token, "sub-gap", 9, json!({ "kind": "pointerMove", "u": 0.1, "v": 0.1, "modifiers": 0 }))).await;
        live.wait_dom("native keyup+mouseup after sequence gap", released).await;
        live.finish().await;
    }

    #[tokio::test]
    async fn real_control_disconnect_releases_native_key_and_button() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-disc").await;
        hold_key_and_button(&live, &mut control, &token, "sub-disc").await;

        drop(control);
        live.wait_dom("native keyup+mouseup after control disconnect", released).await;
        live.finish().await;
    }

    #[tokio::test]
    async fn disconnect_releases_both_physical_modifier_sides_independently() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-modifiers").await;
        for (seq, kind, code) in [(1, "keyDown", "ShiftLeft"), (2, "keyDown", "ShiftRight"), (3, "keyUp", "ShiftLeft")] {
            send(&mut control, live.input(&token, "sub-modifiers", seq, json!({
                "kind": kind, "key": "Shift", "code": code, "modifiers": 8
            }))).await;
        }
        live.wait_dom("both Shift downs and left up", |events| {
            events.iter().any(|e| e == "keydown:ShiftLeft:Shift")
                && events.iter().any(|e| e == "keydown:ShiftRight:Shift")
                && events.iter().any(|e| e == "keyup:ShiftLeft:Shift")
        }).await;
        drop(control);
        live.wait_dom("right Shift released on disconnect", |events| {
            events.iter().any(|e| e == "keyup:ShiftRight:Shift")
        }).await;
        live.finish().await;
    }
    #[tokio::test]
    async fn control_disconnect_is_observed_while_native_dispatch_is_blocked() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-blocked").await;
        let manager = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;
        let gate = manager.begin_dispatch(&token).await.unwrap();
        send(&mut control, live.input(&token, "sub-blocked", 1, key_down())).await;
        send(&mut control, live.input(&token, "sub-blocked", 2, json!({
            "kind": "keyUp", "key": "a", "code": "KeyA", "modifiers": 0
        }))).await;
        control.close(None).await.unwrap();
        drop(control);
        timeout(Duration::from_secs(3), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.expect("disconnect must fence the lease before the native gate opens");
        drop(gate);
        timeout(Duration::from_secs(3), async {
            loop {
                match manager.acquire_lease("successor", "human").await {
                    Ok(_) => break,
                    Err(InputError::GeometryUnavailable) => tokio::task::yield_now().await,
                    Err(error) => panic!("unexpected successor error: {error:?}"),
                }
            }
        }).await.unwrap();
        assert!(!live.dom_events().await.iter().any(|event| event == "keydown:KeyA:a"));
        live.finish().await;
    }

    #[tokio::test]
    async fn socket_overflow_while_gate_held_fences_promptly() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-overflow").await;
        let manager = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;
        let gate = manager.begin_dispatch(&token).await.unwrap();
        let big_text = "x".repeat(dam_hopper_server::browser_host::input::MAX_INSERT_TEXT_BYTES);
        for seq in 1..=66u64 {
            if control.send(live.input(&token, "sub-overflow", seq, json!({
                "kind": "insertText", "text": big_text
            }))).await.is_err() {
                break;
            }
        }
        let status = next_text(&mut control).await;
        assert!(status.contains("\"inputAvailable\":false"), "{status}");
        assert!(manager.validate_lease(&token).await.is_err());
        drop(gate);
        live.finish().await;
    }

    #[tokio::test]
    async fn invalid_pointer_after_native_down_releases_original_button() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        for kind in ["pointerMove", "pointerUp"] {
            let Some(live) = start(None).await else { return };
            let token = live.acquire("viewer-1").await;
            let (_media, mut control) = live.pair("viewer-1", "sub-invalid").await;
            send(&mut control, live.input(&token, "sub-invalid", 1, pointer_down())).await;
            live.wait_dom("native mousedown", |events| events.iter().any(|e| e == "mousedown:0")).await;
            let invalid = if kind == "pointerUp" {
                json!({"kind": kind, "button": "left", "u": 2.0, "v": 0.5, "modifiers": 0})
            } else {
                json!({"kind": kind, "u": 2.0, "v": 0.5, "modifiers": 0})
            };
            send(&mut control, live.input(&token, "sub-invalid", 2, invalid)).await;
            live.wait_dom("native mouseup after invalid pointer", |events| events.iter().any(|e| e == "mouseup:0")).await;
            let manager = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;
            assert!(manager.validate_lease(&token).await.is_err());
            live.finish().await;
        }
    }

    #[tokio::test]
    async fn real_session_delete_releases_native_key_and_button() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-del").await;
        hold_key_and_button(&live, &mut control, &token, "sub-del").await;

        let path = format!("/api/browser/sessions/{}", live.session_id);
        let _ = live.rest("DELETE", &path, Value::Null).await;
        live.wait_dom("native keyup+mouseup after session delete", released).await;
        live.finish().await;
    }

    #[tokio::test]
    async fn real_lease_expiry_releases_without_further_traffic() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(Some(Duration::from_millis(1500))).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-exp").await;
        hold_key_and_button(&live, &mut control, &token, "sub-exp").await;

        // No further message, renewal or REST call: only the lease's own timer can release.
        live.wait_dom("native keyup+mouseup after active lease expiry", released).await;
        live.finish().await;
    }

    #[tokio::test]
    async fn real_foreign_viewer_cannot_use_another_viewers_lease() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token_a = live.acquire("viewer-a").await;
        let (_media_a, mut control_a) = live.pair("viewer-a", "sub-a").await;
        let (_media_b, mut control_b) = live.pair("viewer-b", "sub-b").await;

        // Viewer B's authenticated socket presents viewer A's (valid) lease token.
        send(&mut control_b, live.input(&token_a, "sub-b", 1, json!({ "kind": "keyDown", "key": "x", "code": "KeyX", "modifiers": 0 }))).await;
        // Viewer A's own socket is still served, and arrives strictly after B's rejected message.
        send(&mut control_a, live.input(&token_a, "sub-a", 1, key_down())).await;
        let events = live.wait_dom("viewer A's own keydown", |e| e.iter().any(|x| x == "keydown:KeyA:a")).await;
        assert!(!events.iter().any(|e| e.contains("KeyX")), "foreign viewer reached native input: {events:?}");
        live.finish().await;
    }

    #[tokio::test]
    async fn real_unpaired_control_never_dispatches_native_input_until_media_joins() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let mut control = live.connect("control", "viewer-1", "sub-solo").await;
        let first = next_text(&mut control).await;
        assert!(first.contains("\"inputAvailable\":false"), "unpaired control must not advertise input: {first}");

        send(&mut control, live.input(&token, "sub-solo", 1, key_down())).await;
        sleep(Duration::from_millis(600)).await;
        assert!(live.dom_events().await.is_empty(), "unpaired control reached native input");

        // Media joins the pair: the same control socket is now served and told so.
        let _media = live.connect("media", "viewer-1", "sub-solo").await;
        let update = next_text(&mut control).await;
        assert!(update.contains("\"inputAvailable\":true"), "paired control must advertise input: {update}");
        send(&mut control, live.input(&token, "sub-solo", 1, key_down())).await;
        live.wait_dom("keydown once paired", |e| e.iter().any(|x| x == "keydown:KeyA:a")).await;
        live.finish().await;
    }

    /// Drive queue overflow directly on a real native page identity; revoke covers
    /// auth-cancel and authority loss.
    #[tokio::test]
    async fn real_queue_overflow_and_revoke_release_native_key_and_button() {
        use dam_hopper_server::browser_host::input_native_release::NativeInputTarget;

        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let manager = get_or_create_input_manager(&live.session_id).await;
        let target = NativeInputTarget {
            client: live.client.clone(),
            page_session_id: live.page_sid.clone(),
            geometry: live.producer.geometry().await,
        };
        for scenario in ["overflow", "revoke"] {
            let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
            let msg = |seq: u64, event: InputEvent| InputMessage {
                browser_session_id: live.session_id.clone(),
                browser_incarnation: live.incarnation.clone(),
                profile_epoch: 1,
                subscription_epoch: "sub".to_string(),
                lease_token: token.clone(),
                input_seq: seq,
                viewport_epoch: 1,
                event,
            };
            let down = [
                InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 },
                InputEvent::PointerDown { button: MouseButton::Left, u: 0.5, v: 0.5, modifiers: 0 },
            ];
            for (index, event) in down.into_iter().enumerate() {
                manager.enqueue_input(msg(index as u64 + 1, event.clone())).await.unwrap();
                let gate = manager.begin_dispatch(&token).await.expect("lease live");
                manager.prepare_native_input(&gate, target.clone(), &event).await.unwrap();
                target.dispatch(&event).await.expect("native press");
                manager.confirm_native_input(&gate, &event).await;
                drop(gate);
            }
            live.wait_dom("native keydown+mousedown", held).await;

            if scenario == "overflow" {
                // Nothing pops the queue, so reliable records fill until overflow ends the lease.
                let mut overflowed = false;
                for seq in 3..(3 + MAX_RELIABLE_RECORDS as u64 + 8) {
                    match manager.enqueue_input(msg(seq, InputEvent::InsertText { text: "x".into() })).await {
                        Err(InputError::QueueOverflow) => {
                            overflowed = true;
                            break;
                        }
                        other => {
                            other.unwrap();
                        }
                    }
                }
                assert!(overflowed, "queue never overflowed");
            } else {
                manager.revoke_lease().await.expect("revoke releases natively");
            }
            live.wait_dom(&format!("native keyup+mouseup after {scenario}"), released).await;
            live.client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "window.__ev.length=0" })),
                    Some(&live.page_sid),
                )
                .await
                .unwrap();
        }
        live.finish().await;
    }

    #[tokio::test]
    async fn real_chromium_selected_text_reads_page_selection_and_excludes_password_input() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;

        // Populate page with regular text, textarea, text input, and password input.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        document.body.innerHTML = `
                            <p id="copyable">Hello Chromium Selection!</p>
                            <textarea id="notes">Textarea selected text</textarea>
                            <input id="text-in" type="text" value="Plain input value" />
                            <input id="pwd" type="password" value="top-secret-password" />
                        `;
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();

        let get_selected = |lease: &str| {
            let url = format!("http://{}/api/browser/sessions/{}/selected-text", live.addr, live.session_id);
            let client = reqwest::Client::new();
            let lease = lease.to_string();
            async move {
                let resp = client
                    .get(url)
                    .header(X_BROWSER_LEASE.as_str(), lease)
                    .send()
                    .await
                    .unwrap();
                let status = resp.status().as_u16();
                let bytes = resp.bytes().await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
                (status, body)
            }
        };

        // 1. Select text in <p id="copyable"> via DOM Selection range.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const p = document.getElementById('copyable');
                        const range = document.createRange();
                        range.selectNodeContents(p);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st1, b1) = get_selected(&token).await;
        assert_eq!(st1, 200);
        assert_eq!(b1["text"], "Hello Chromium Selection!");

        // 2. Select text inside <textarea>.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        window.getSelection().removeAllRanges();
                        const ta = document.getElementById('notes');
                        ta.focus();
                        ta.setSelectionRange(0, 17);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st2, b2) = get_selected(&token).await;
        assert_eq!(st2, 200);
        assert_eq!(b2["text"], "Textarea selected");

        // 3. Select text inside <input type="text">.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        window.getSelection().removeAllRanges();
                        const inp = document.getElementById('text-in');
                        inp.focus();
                        inp.setSelectionRange(6, 11);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st3, b3) = get_selected(&token).await;
        assert_eq!(st3, 200);
        assert_eq!(b3["text"], "input");

        // 4. Select text inside <input type="password"> -> MUST return "".
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        window.getSelection().removeAllRanges();
                        const pwd = document.getElementById('pwd');
                        pwd.focus();
                        pwd.select();
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st4, b4) = get_selected(&token).await;
        assert_eq!(st4, 200);
        assert_eq!(b4["text"], "", "password input selection must never be returned");

        // 5. Clear selection -> returns "".
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        window.getSelection().removeAllRanges();
                        if (document.activeElement) document.activeElement.blur();
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st5, b5) = get_selected(&token).await;
        assert_eq!(st5, 200);
        assert_eq!(b5["text"], "");

        live.finish().await;
    }

    #[tokio::test]
    async fn real_chromium_selected_text_bounds_large_and_surrogate_pair_selections_without_cdp_loss() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;

        let get_selected = |lease: &str| {
            let url = format!(
                "http://{}/api/browser/sessions/{}/selected-text",
                live.addr, live.session_id
            );
            let client = reqwest::Client::new();
            let lease = lease.to_string();
            async move {
                let resp = client
                    .get(url)
                    .header(X_BROWSER_LEASE.as_str(), lease)
                    .send()
                    .await
                    .unwrap();
                let status = resp.status().as_u16();
                let bytes = resp.bytes().await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
                (status, body)
            }
        };

        // 1. Select >5 MiB ASCII text in the page (> 4 MiB CDP transport limit).
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const big = 'A'.repeat(5 * 1024 * 1024 + 4096);
                        document.body.innerHTML = `<pre id="huge">${big}</pre><p id="small">CDP still alive!</p><textarea id="huge-ta"></textarea>`;
                        document.getElementById('huge-ta').value = big;
                        const pre = document.getElementById('huge');
                        const range = document.createRange();
                        range.selectNodeContents(pre);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();

        let (st_big, body_big) = get_selected(&token).await;
        assert_eq!(st_big, 200, "{body_big}");
        let big_text = body_big["text"].as_str().unwrap();
        assert!(big_text.len() <= 65_536);
        assert_eq!(big_text.len(), 65_536);
        assert!(!live.client.is_closed(), "CDP transport must stay healthy after >5 MiB selection");

        // 2. Also verify >5 MiB <textarea> selection is bounded in JS before CDP serialization.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        window.getSelection().removeAllRanges();
                        const ta = document.getElementById('huge-ta');
                        ta.focus();
                        ta.setSelectionRange(0, ta.value.length);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st_ta, body_ta) = get_selected(&token).await;
        assert_eq!(st_ta, 200);
        assert_eq!(body_ta["text"].as_str().unwrap().len(), 65_536);

        // 3. Surrogate-pair boundary: 65535 ASCII + 200 4-byte emojis -> cut must walk back cleanly
        //    so no unpaired surrogate / U+FFFD replacement character is produced.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        if (document.activeElement) document.activeElement.blur();
                        const sur = 'a'.repeat(65535) + '🦀'.repeat(200);
                        const p = document.createElement('p');
                        p.id = 'sur';
                        p.textContent = sur;
                        document.body.appendChild(p);
                        const range = document.createRange();
                        range.selectNodeContents(p);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st_sur, body_sur) = get_selected(&token).await;
        assert_eq!(st_sur, 200);
        let sur_text = body_sur["text"].as_str().unwrap();
        assert!(sur_text.len() <= 65_536);
        assert_eq!(sur_text.len(), 65_535);
        assert!(!sur_text.contains('\u{FFFD}'));

        // 4. Same session & CDP connection still works for a normal selection right after.
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const p = document.getElementById('small');
                        const range = document.createRange();
                        range.selectNodeContents(p);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    })()"#
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let (st_small, body_small) = get_selected(&token).await;
        assert_eq!(st_small, 200);
        assert_eq!(body_small["text"], "CDP still alive!");

        live.finish().await;
    }

    #[tokio::test]
    async fn real_chromium_bounded_multichunk_paste_and_trailing_typing_arrive_intact() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-paste").await;

        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const ta = document.createElement('textarea');
                        ta.id = 'paste-target';
                        document.body.appendChild(ta);
                        ta.focus();
                    })()"#,
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();

        let unit = "đặng🙂a"; // 12 UTF-8 bytes
        let full_paste = unit.repeat(1200); // 14,400 UTF-8 bytes (> 4096, <= 16384)
        let mut seq = 1u64;
        let mut start = 0usize;
        while start < full_paste.len() {
            let mut end = (start + 4096).min(full_paste.len());
            while !full_paste.is_char_boundary(end) {
                end -= 1;
            }
            let chunk = &full_paste[start..end];
            let msg = live.input(&token, "sub-paste", seq, json!({ "kind": "insertText", "text": chunk }));
            assert!(msg.len() <= 16 * 1024);
            send(&mut control, msg).await;
            seq += 1;
            start = end;
        }
        send(&mut control, live.input(&token, "sub-paste", seq, json!({ "kind": "insertText", "text": "tail" }))).await;

        let expected = format!("{full_paste}tail");
        let mut observed = String::new();
        for _ in 0..100 {
            let val = live
                .client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "document.getElementById('paste-target').value", "returnByValue": true })),
                    Some(&live.page_sid),
                )
                .await
                .unwrap();
            observed = val["result"]["value"].as_str().unwrap_or_default().to_string();
            if observed == expected {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(observed.len(), expected.len());
        assert_eq!(observed, expected);
        live.finish().await;
    }

    #[tokio::test]
    async fn real_chromium_escape_heavy_paste_oversize_rejection_and_mid_paste_disconnect() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let oracle_client = CdpClient::connect(live.process.ws_endpoint())
            .await
            .expect("oracle CDP connection");
        let oracle_page_sid: String = oracle_client
            .send_typed(
                AttachToTargetParams::builder()
                    .target_id(live.target_id.clone())
                    .flatten(true)
                    .build()
                    .unwrap(),
                None,
            )
            .await
            .expect("attach independent DOM oracle")
            .session_id
            .into();
        oracle_client
            .send_command("Runtime.enable", None, Some(&oracle_page_sid))
            .await
            .expect("enable independent DOM oracle");
        let mgr = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;
        let token = live.acquire("viewer-1").await;
        let (mut media, mut control) = live.pair("viewer-1", "sub-esc").await;

        oracle_client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const ta = document.createElement('textarea');
                        ta.id = 'esc-target';
                        document.body.appendChild(ta);
                        ta.focus();
                    })()"#,
                })),
                Some(&oracle_page_sid),
            )
            .await
            .unwrap();

        let read_dom = || async {
            let val = oracle_client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "document.getElementById('esc-target').value", "returnByValue": true })),
                    Some(&oracle_page_sid),
                )
                .await
                .unwrap();
            val["result"]["value"].as_str().unwrap_or_default().to_string()
        };

        // 1. Oversize single insertText (> 4096 raw bytes) and >16KiB frame are rejected with zero prefix inserted.
        let oversize = "X".repeat(4097);
        send(&mut control, live.input(&token, "sub-esc", 1, json!({ "kind": "insertText", "text": oversize }))).await;
        sleep(Duration::from_millis(80)).await;
        assert_eq!(read_dom().await, "");
        let over_frame = "Y".repeat(16 * 1024 + 1);
        let _ = control
            .send(live.input(&token, "sub-esc", 1, json!({ "kind": "insertText", "text": over_frame })))
            .await;
        sleep(Duration::from_millis(80)).await;
        assert_eq!(read_dom().await, "");
        let _ = control.close(None).await;
        let _ = media.close(None).await;
        drop((media, control));
        let _ = live.release(&token).await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while mgr.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        // Reacquire after oversize/frame violation to get a fresh clean sequence 1.
        let token3 = live.acquire("viewer-1").await;
        let (mut media3, mut control3) = live.pair("viewer-1", "sub-esc-3").await;
        // 2. Escape-heavy text whose JSON expansion exceeds 16 KiB unsplit (3000 * \u0007 = 18000 JSON bytes)
        //    is re-split into <=16KiB JSON chunks + trailing typing and arrives intact on real Chromium.
        let esc_full = format!("{}{}", "\u{0007}".repeat(3000), "\"\\\t\n".repeat(400));
        let mut seq = 1u64;
        for chunk_bytes in esc_full.as_bytes().chunks(2500) {
            let chunk = std::str::from_utf8(chunk_bytes).unwrap();
            let msg = live.input(&token3, "sub-esc-3", seq, json!({ "kind": "insertText", "text": chunk }));
            assert!(msg.len() <= 16 * 1024);
            send(&mut control3, msg).await;
            seq += 1;
        }
        send(&mut control3, live.input(&token3, "sub-esc-3", seq, json!({ "kind": "insertText", "text": "end" }))).await;
        let expected_esc = format!("{esc_full}end");
        let mut got = String::new();
        for _ in 0..100 {
            got = read_dom().await;
            if got == expected_esc {
                break;
            }
            sleep(Duration::from_millis(30)).await;
        }
        assert_eq!(got, expected_esc);

        // 3. Mid-paste disconnect: send chunk 1 then close control before chunk 2; replacement lease never replays old paste.
        let _ = control3.close(None).await;
        let _ = media3.close(None).await;
        drop((media3, control3));
        let _ = live.release(&token3).await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while mgr.validate_lease(&token3).await.is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let token4 = live.acquire("viewer-1").await;
        let (mut media4, mut control4) = live.pair("viewer-1", "sub-esc-4").await;
        send(&mut control4, live.input(&token4, "sub-esc-4", 1, json!({ "kind": "insertText", "text": "PARTIAL_" }))).await;
        let expected_partial = format!("{expected_esc}PARTIAL_");
        for _ in 0..100 {
            if read_dom().await == expected_partial {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(read_dom().await, expected_partial);
        let _ = control4.close(None).await;
        let _ = media4.close(None).await;
        drop((media4, control4));
        let _ = live.release(&token4).await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while mgr.validate_lease(&token4).await.is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let _token5 = live.acquire("viewer-1").await;
        let (_media5, _control5) = live.pair("viewer-1", "sub-esc-5").await;
        sleep(Duration::from_millis(80)).await;
        assert_eq!(read_dom().await, expected_partial);
        live.finish().await;
    }

    #[tokio::test]
    async fn real_chromium_canonical_wheel_displaces_scroll_in_css_pixels() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-wheel").await;

        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const scroller = document.createElement('div');
                        scroller.id = 'wheel-scroller';
                        scroller.style.cssText = 'position:fixed;inset:0;overflow:auto;';
                        const inner = document.createElement('div');
                        inner.style.cssText = 'width:4000px;height:4000px;';
                        scroller.appendChild(inner);
                        document.body.appendChild(scroller);
                    })()"#,
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();

        // Normalized 3 lines (3 * 16 = 48 CSS px), 1 page (900 CSS px), then -18 CSS px via canonical snake_case wire fields only.
        for (seq, dy) in [(1, 48.0), (2, 900.0), (3, -18.0)] {
            send(
                &mut control,
                live.input(
                    &token,
                    "sub-wheel",
                    seq,
                    json!({ "kind": "wheel", "u": 0.5, "v": 0.5, "delta_x": 0.0, "delta_y": dy, "modifiers": 0 }),
                ),
            )
            .await;
        }

        let mut scroll_top = 0.0f64;
        for _ in 0..100 {
            let val = live
                .client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "document.getElementById('wheel-scroller').scrollTop", "returnByValue": true })),
                    Some(&live.page_sid),
                )
                .await
                .unwrap();
            scroll_top = val["result"]["value"].as_f64().unwrap_or(0.0);
            if (scroll_top - 930.0).abs() <= 1.0 {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        assert!((scroll_top - 930.0).abs() <= 1.0, "expected ~930 CSS px scrollTop, got {scroll_top}");
        live.finish().await;
    }

    #[tokio::test]
    async fn real_chromium_control_select_arbitrates_updates_and_input_fairly_without_weakening_cancel() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (mut media, mut control) = live.pair("viewer-1", "sub-fair").await;

        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({
                    "expression": r#"(() => {
                        const inp = document.createElement('input');
                        inp.id = 'fair-input';
                        document.body.appendChild(inp);
                        inp.focus();
                    })()"#,
                })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();

        // Continuously churn session updates on the registry while sending input
        let stop_churn = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_flag = stop_churn.clone();
        let sid_churn = live.session_id.clone();
        let churn_task = tokio::spawn(async move {
            while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = global_session_registry()
                    .record_cdp_navigation(&sid_churn, None, &[])
                    .await;
                tokio::task::yield_now().await;
            }
        });

        for seq in 1..=5u64 {
            send(
                &mut control,
                live.input(&token, "sub-fair", seq, json!({ "kind": "insertText", "text": format!("f{seq}") })),
            )
            .await;
        }

        let mut observed = String::new();
        // Fairness means eventual, ordered delivery while the registry churns; a loaded CI runner
        // needs far more than 2.5 s for five inputs on the shared current-thread runtime.
        for _ in 0..400 {
            let val = live
                .client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "document.getElementById('fair-input').value", "returnByValue": true })),
                    Some(&live.page_sid),
                )
                .await
                .unwrap();
            observed = val["result"]["value"].as_str().unwrap_or_default().to_string();
            if observed == "f1f2f3f4f5" {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(observed, "f1f2f3f4f5");
        stop_churn.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = churn_task.await;

        // Drain queued snapshot messages and verify reverse workload: continuous input does not suppress a pushed update
        while timeout(Duration::from_millis(30), control.next()).await.is_ok() {}
        let bumped_rev = global_session_registry()
            .record_cdp_navigation(&live.session_id, None, &[])
            .await
            .expect("bumped nav rev");
        for seq in 6..=15u64 {
            send(
                &mut control,
                live.input(&token, "sub-fair", seq, json!({ "kind": "insertText", "text": "x" })),
            )
            .await;
        }
        let mut saw_bumped = false;
        for _ in 0..20 {
            let txt = next_text(&mut control).await;
            let v: Value = serde_json::from_str(&txt).unwrap();
            if v["kind"] == "sessionUpdated"
                && v["session"]["navigationRevision"].as_str() == Some(&bumped_rev.to_string())
            {
                saw_bumped = true;
                break;
            }
        }
        assert!(saw_bumped, "continuous input must not suppress latest session snapshot update");

        // Wait for all 10 "x" inputs from the reverse burst to settle on the DOM before testing cancel priority
        let mut settled = String::new();
        for _ in 0..100 {
            let val = live
                .client
                .send_command(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "document.getElementById('fair-input').value", "returnByValue": true })),
                    Some(&live.page_sid),
                )
                .await
                .unwrap();
            settled = val["result"]["value"].as_str().unwrap_or_default().to_string();
            if settled == "f1f2f3f4f5xxxxxxxxxx" {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(settled, "f1f2f3f4f5xxxxxxxxxx");

        // Cancellation/pair teardown wins immediately even with input ready; no subsequent native input arrives
        live.client
            .send_command(
                "Runtime.evaluate",
                Some(json!({ "expression": "document.getElementById('fair-input').value = ''", "returnByValue": true })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        let _ = media.close(None).await;
        drop(media);
        sleep(Duration::from_millis(50)).await;
        let _ = control
            .send(live.input(&token, "sub-fair", 16, json!({ "kind": "insertText", "text": "post-cancel" })))
            .await;
        sleep(Duration::from_millis(150)).await;
        let after = live
            .client
            .send_command(
                "Runtime.evaluate",
                Some(json!({ "expression": "document.getElementById('fair-input').value", "returnByValue": true })),
                Some(&live.page_sid),
            )
            .await
            .unwrap();
        assert_eq!(after["result"]["value"].as_str().unwrap_or_default(), "");
        live.finish().await;
    }
}

/// Release semantics against a mock CDP browser: exact captured key/code/button/position on the
/// original native identity for every termination path, and injected dispatch failure.
mod native_release {
    use super::*;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::input::SessionInputManager;
    use dam_hopper_server::browser_host::input_native_release::NativeInputTarget;
    use futures_util::{SinkExt, StreamExt};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    use tokio_tungstenite::tungstenite::Message;

    struct MockNative {
        target: NativeInputTarget,
        commands: Arc<Mutex<Vec<Value>>>,
        fail_input: Arc<AtomicBool>,
        drop_input: Arc<AtomicBool>,
        block_input: Arc<AtomicBool>,
        block_after_failure: Arc<AtomicBool>,
        blocked: Arc<tokio::sync::Notify>,
        resume: Arc<tokio::sync::Notify>,
    }

    /// Mock CDP: records every command; `Input.*` fails while `fail_input` is set.
    async fn mock_native() -> MockNative {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let commands = Arc::new(Mutex::new(Vec::new()));
        let fail_input = Arc::new(AtomicBool::new(false));
        let drop_input = Arc::new(AtomicBool::new(false));
        let disconnect = drop_input.clone();
        let (log, fail) = (commands.clone(), fail_input.clone());
        let block_input = Arc::new(AtomicBool::new(false));
        let block_after_failure = Arc::new(AtomicBool::new(false));
        let block_after = block_after_failure.clone();
        let blocked = Arc::new(tokio::sync::Notify::new());
        let resume = Arc::new(tokio::sync::Notify::new());
        let (block, entered, proceed) = (block_input.clone(), blocked.clone(), resume.clone());
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                while let Some(Ok(Message::Text(text))) = ws.next().await {
                    let cmd: Value = serde_json::from_str(&text).unwrap();
                    log.lock().push(cmd.clone());
                    let method = cmd["method"].as_str().unwrap_or_default();
                    if method.starts_with("Input.") && disconnect.load(Ordering::SeqCst) {
                        break;
                    }
                    if method.starts_with("Input.") && block.load(Ordering::SeqCst) {
                        entered.notify_one();
                        proceed.notified().await;
                    }
                    let reply = if method.starts_with("Input.") && fail.load(Ordering::SeqCst) {
                        json!({"id": cmd["id"], "error": {"code": -32000, "message": "injected dispatch failure"}})
                    } else if method == "Target.attachToTarget" {
                        json!({"id": cmd["id"], "result": {"sessionId": "ORIGINAL-PAGE-SESSION"}})
                    } else {
                        json!({"id": cmd["id"], "result": {}})
                    };
                    if method.starts_with("Input.") && fail.load(Ordering::SeqCst)
                        && block_after.swap(false, Ordering::SeqCst)
                    {
                        block.store(true, Ordering::SeqCst);
                    }
                    if ws.send(Message::Text(reply.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
        });
        let client = CdpClient::connect(&format!("ws://{addr}")).await.expect("mock cdp");
        MockNative {
            target: NativeInputTarget {
                client,
                page_session_id: "ORIGINAL-PAGE-SESSION".to_string(),
                geometry: TargetGeometry {
                    css_width: 1000.0, css_height: 800.0, offset_top: 0.0, scroll_x: 0.0,
                    scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0,
                    dpr: 1.0,
                },
            },
            commands,
            fail_input,
            drop_input,
            block_input,
            block_after_failure,
            blocked,
            resume,
        }
    }

    fn input(token: &str, seq: u64, event: InputEvent) -> InputMessage {
        InputMessage {
            browser_session_id: "s".into(),
            browser_incarnation: "i".into(),
            profile_epoch: 1,
            subscription_epoch: "sub".into(),
            lease_token: token.into(),
            input_seq: seq,
            viewport_epoch: 1,
            event,
        }
    }

    /// Holds key `a`/`KeyA` and the left button (pointer last at 0.25, 0.75) on `native`.
    async fn hold(manager: &SessionInputManager, native: &MockNative, token: &str) {
        for (seq, event) in [
            (1, InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 }),
            (2, InputEvent::PointerDown { button: MouseButton::Left, u: 0.1, v: 0.1, modifiers: 0 }),
            (3, InputEvent::PointerMove { u: 0.25, v: 0.75, modifiers: 0 }),
        ] {
            manager.enqueue_input(input(token, seq, event.clone())).await.unwrap();
            let gate = manager.begin_dispatch(token).await.unwrap();
            manager.prepare_native_input(&gate, native.target.clone(), &event).await.unwrap();
            native.target.dispatch(&event).await.unwrap();
            manager.confirm_native_input(&gate, &event).await;
        }
        manager.drain_inputs().await;
        native.commands.lock().clear();
    }

    fn input_commands(native: &MockNative) -> Vec<Value> {
        native.commands.lock().iter().filter(|c| c["method"].as_str().is_some_and(|m| m.starts_with("Input."))).cloned().collect()
    }

    fn assert_released_exactly(native: &MockNative, what: &str) {
        let commands = input_commands(native);
        let key_up = commands.iter().find(|c| c["method"] == "Input.dispatchKeyEvent").unwrap_or_else(|| panic!("{what}: no keyUp: {commands:?}"));
        assert_eq!((&key_up["params"]["type"], &key_up["params"]["key"], &key_up["params"]["code"]), (&json!("keyUp"), &json!("a"), &json!("KeyA")), "{what}: {key_up}");
        assert_eq!(key_up["sessionId"], "ORIGINAL-PAGE-SESSION", "{what}: original native identity");
        let mouse_up = commands.iter().find(|c| c["method"] == "Input.dispatchMouseEvent").unwrap_or_else(|| panic!("{what}: no mouseUp: {commands:?}"));
        assert_eq!((&mouse_up["params"]["type"], &mouse_up["params"]["button"]), (&json!("mouseReleased"), &json!("left")), "{what}: {mouse_up}");
        assert_eq!((mouse_up["params"]["x"].as_f64(), mouse_up["params"]["y"].as_f64()), (Some(250.0), Some(600.0)), "{what}: released where the pointer was");
        assert_eq!(mouse_up["sessionId"], "ORIGINAL-PAGE-SESSION");
    }

    #[tokio::test]
    async fn every_termination_path_releases_on_the_captured_identity() {
        for path in ["release", "revoke", "holder", "gap", "overflow", "expiry"] {
            let native = mock_native().await;
            let ttl = if path == "expiry" { Duration::from_millis(250) } else { Duration::from_secs(30) };
            let manager = SessionInputManager::with_lease_ttl(ttl);
            let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
            hold(&manager, &native, &token).await;
            assert!(input_commands(&native).is_empty(), "{path}: nothing released while the lease is live");
            match path {
                "release" => {
                    manager.release_lease(&token).await.unwrap();
                }
                "revoke" => manager.revoke_lease().await.unwrap(),
                "holder" => manager.revoke_lease_if_holder("viewer-1").await.unwrap(),
                "gap" => {
                    let err = manager.enqueue_input(input(&token, 9, InputEvent::PointerCancel)).await.unwrap_err();
                    assert!(matches!(err, InputError::SequenceGap { .. }), "{err:?}");
                }
                "overflow" => {
                    let mut overflowed = false;
                    for seq in 4..(4 + MAX_RELIABLE_RECORDS as u64 + 8) {
                        if let Err(err) = manager.enqueue_input(input(&token, seq, InputEvent::InsertText { text: "x".into() })).await {
                            assert_eq!(err, InputError::QueueOverflow);
                            overflowed = true;
                            break;
                        }
                    }
                    assert!(overflowed);
                }
                _ => {
                    tokio::time::sleep(Duration::from_millis(350)).await;
                    manager.expire_if_due().await.unwrap();
                }
            }
            assert_released_exactly(&native, path);
            assert!(manager.release_failure().await.is_none(), "{path}");
        }
    }

    #[tokio::test]
    async fn pointer_cancel_releases_only_the_held_buttons() {
        let native = mock_native().await;
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        manager.release_pointer_buttons().await.unwrap();
        let commands = input_commands(&native);
        assert_eq!(commands.len(), 1, "{commands:?}");
        assert_eq!(commands[0]["params"]["type"], "mouseReleased");
        // The key is still tracked and released with the lease.
        manager.release_lease(&token).await.unwrap();
        assert_released_exactly(&native, "cancel then release");
    }

    #[tokio::test]
    async fn failed_native_keyup_keeps_original_hold_for_cleanup() {
        let native = mock_native().await;
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        let event = InputEvent::KeyUp { key: "a".into(), code: "KeyA".into(), modifiers: 0 };
        manager.enqueue_input(input(&token, 4, event.clone())).await.unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        manager.prepare_native_input(&gate, native.target.clone(), &event).await.unwrap();
        native.fail_input.store(true, Ordering::SeqCst);
        assert!(native.target.dispatch(&event).await.is_err());
        drop(gate);
        native.fail_input.store(false, Ordering::SeqCst);
        native.commands.lock().clear();
        manager.release_lease(&token).await.unwrap();
        assert_released_exactly(&native, "failed keyup cleanup");
    }

    #[tokio::test]
    async fn socket_disconnect_waits_for_written_command_and_drops_queued_tail() {
        use dam_hopper_server::browser_host::media::get_or_register_producer;
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = live::start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-written").await;
        let native = mock_native().await;
        let producer = Arc::new(ScreencastProducer::new(
            live.session_id.clone(), live.incarnation.clone(), 1, 1,
            native.target.client.clone(), "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&live.session_id, producer).await;
        let manager = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;
        let finished = Arc::new(tokio::sync::Notify::new());
        let hook = finished.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        native.block_input.store(true, Ordering::SeqCst);
        live::send(&mut control, live.input(&token, "sub-written", 1, live::key_down())).await;
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        live::send(&mut control, live.input(&token, "sub-written", 2, json!({
            "kind": "insertText", "text": "must not be dispatched"
        }))).await;
        control.close(None).await.unwrap();
        drop(control);
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        assert!(!input_commands(&native).iter().any(|c| c["params"]["type"] == "keyUp"));
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), finished.notified()).await.unwrap();
        let commands = input_commands(&native);
        assert!(commands.iter().any(|c| c["params"]["type"] == "keyUp" && c["sessionId"] == "ORIGINAL-PAGE-SESSION"));
        assert!(!commands.iter().any(|c| c["method"] == "Input.insertText"));
        live.finish().await;
    }

    #[tokio::test]
    async fn mid_paste_disconnect_cancels_queued_tail_and_never_replays_on_reacquire() {
        use dam_hopper_server::browser_host::media::get_or_register_producer;
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = live::start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-paste-tail").await;
        let native = mock_native().await;
        let producer = Arc::new(ScreencastProducer::new(
            live.session_id.clone(), live.incarnation.clone(), 1, 1,
            native.target.client.clone(), "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&live.session_id, producer).await;
        let manager = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;

        native.block_input.store(true, Ordering::SeqCst);
        live::send(&mut control, live.input(&token, "sub-paste-tail", 1, json!({
            "kind": "insertText", "text": "FIRST_"
        }))).await;
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();

        // Queue a genuine multi-chunk tail while chunk 1 is in flight, then disconnect mid-paste.
        live::send(&mut control, live.input(&token, "sub-paste-tail", 2, json!({
            "kind": "insertText", "text": "SECOND_"
        }))).await;
        live::send(&mut control, live.input(&token, "sub-paste-tail", 3, json!({
            "kind": "insertText", "text": "TAIL_"
        }))).await;
        control.close(None).await.unwrap();
        drop(control);

        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::sleep(Duration::from_millis(80)).await;

        let _token2 = live.acquire("viewer-1").await;
        let (_media2, _control2) = live.pair("viewer-1", "sub-paste-tail-2").await;
        tokio::time::sleep(Duration::from_millis(80)).await;

        let inserted: Vec<String> = input_commands(&native)
            .into_iter()
            .filter(|c| c["method"] == "Input.insertText")
            .map(|c| c["params"]["text"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(inserted, vec!["FIRST_"]);
        live.finish().await;
    }

    #[tokio::test]
    async fn socket_disconnect_cancels_actor_queued_unwritten_command() {
        use dam_hopper_server::browser_host::diagnostics::MemoryAdmissionController;
        use dam_hopper_server::browser_host::media::get_or_register_producer;
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;
        use futures_util::{Sink, Stream};
        use std::pin::Pin;
        use std::task::{Context, Poll, Waker};
        use tokio::sync::mpsc;

        struct BlockableWs {
            out_tx: mpsc::UnboundedSender<Value>,
            sent_log: Arc<Mutex<Vec<Value>>>,
            in_rx: mpsc::UnboundedReceiver<Result<Message, tokio_tungstenite::tungstenite::Error>>,
            block_write: Arc<AtomicBool>,
            write_blocked: Arc<tokio::sync::Notify>,
            waker: Arc<std::sync::Mutex<Option<Waker>>>,
        }

        impl Stream for BlockableWs {
            type Item = Result<Message, tokio_tungstenite::tungstenite::Error>;
            fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
                Pin::new(&mut self.in_rx).poll_recv(cx)
            }
        }

        impl Sink<Message> for BlockableWs {
            type Error = tokio_tungstenite::tungstenite::Error;
            fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
                Poll::Ready(Ok(()))
            }
            fn start_send(self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
                if let Message::Text(txt) = item {
                    if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                        self.sent_log.lock().push(v.clone());
                        let _ = self.out_tx.send(v);
                    }
                }
                Ok(())
            }
            fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
                if self.block_write.load(Ordering::Acquire) {
                    *self.waker.lock().unwrap() = Some(cx.waker().clone());
                    self.write_blocked.notify_one();
                    return Poll::Pending;
                }
                Poll::Ready(Ok(()))
            }
            fn poll_close(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
                Poll::Ready(Ok(()))
            }
        }

        let _serial = SERIAL_TEST_LOCK.lock().await;
        let Some(live) = live::start(None).await else { return };
        let token = live.acquire("viewer-1").await;
        let (_media, mut control) = live.pair("viewer-1", "sub-actor-queued").await;

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
        let (in_tx, in_rx) = mpsc::unbounded_channel();
        let block_write = Arc::new(AtomicBool::new(false));
        let write_blocked = Arc::new(tokio::sync::Notify::new());
        let waker = Arc::new(std::sync::Mutex::new(None::<Waker>));
        let sent_log = Arc::new(Mutex::new(Vec::new()));
        let client = CdpClient::from_ws_stream_with_memory_controller(
            BlockableWs {
                sent_log: sent_log.clone(),
                out_tx,
                in_rx,
                block_write: block_write.clone(),
                write_blocked: write_blocked.clone(),
                waker: waker.clone(),
            },
            MemoryAdmissionController::new(64 * 1024 * 1024),
        );
        let responder = tokio::spawn(async move {
            while let Some(cmd) = out_rx.recv().await {
                let result = if cmd["method"] == "Target.attachToTarget" {
                    json!({"sessionId": "ORIGINAL-PAGE-SESSION"})
                } else {
                    json!({})
                };
                if in_tx.send(Ok(Message::Text(json!({"id": cmd["id"], "result": result}).to_string().into()))).is_err() {
                    break;
                }
            }
        });
        let producer = Arc::new(ScreencastProducer::new(
            live.session_id.clone(), live.incarnation.clone(), 1, 1,
            client.clone(), "target".into(), TargetGeometry {
                css_width: 1000.0, css_height: 800.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
            },
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&live.session_id, producer).await;

        block_write.store(true, Ordering::Release);
        let blocker_client = client.clone();
        let blocker = tokio::spawn(async move {
            blocker_client.send_command("Runtime.evaluate", Some(json!({"expression": "1"})), Some("ORIGINAL-PAGE-SESSION")).await
        });
        tokio::time::timeout(Duration::from_secs(2), write_blocked.notified()).await.unwrap();
        let baseline_sent = client.stats().total_commands_sent.load(Ordering::Relaxed);
        live::send(&mut control, live.input(&token, "sub-actor-queued", 1, live::key_down())).await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while client.stats().total_commands_sent.load(Ordering::Relaxed) <= baseline_sent {
                tokio::task::yield_now().await;
            }
        }).await.expect("keyDown must be queued into CDP actor command channel");
        control.close(None).await.unwrap();
        drop(control);
        let manager = dam_hopper_server::api::browser_host::get_or_create_input_manager(&live.session_id).await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        block_write.store(false, Ordering::Release);
        if let Some(w) = waker.lock().unwrap().take() {
            w.wake();
        }
        blocker.await.unwrap().unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                match manager.acquire_lease("successor", "human").await {
                    Ok(_) => break,
                    Err(InputError::GeometryUnavailable) => tokio::task::yield_now().await,
                    Err(error) => panic!("unexpected acquire error: {error:?}"),
                }
            }
        }).await.unwrap();
        responder.abort();
        assert!(manager.release_failure().await.is_none());
        let sent = sent_log.lock().clone();
        assert!(!sent.iter().any(|c| c["params"]["type"] == "rawKeyDown"), "unwritten keyDown must never be written: {sent:?}");
        assert!(sent.iter().any(|c| c["params"]["type"] == "keyUp" && c["sessionId"] == "ORIGINAL-PAGE-SESSION"), "cleanup must release prepared keyUp: {sent:?}");
        live.finish().await;
    }

    #[tokio::test]
    async fn held_keys_cap_rejects_excess_physical_keys_and_releases_tracked_holds() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use dam_hopper_server::browser_host::input::MAX_HELD_KEYS;
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        for i in 0..MAX_HELD_KEYS {
            let msg = input(&token, i as u64 + 1, InputEvent::KeyDown {
                key: format!("k{i}"), code: format!("Key{i}"), modifiers: 0,
            });
            assert!(matches!(handle_control_text(&context, &serde_json::to_string(&msg).unwrap()).await, ControlInputOutcome::Continue));
        }
        native.commands.lock().clear();
        let overflow_msg = input(&token, MAX_HELD_KEYS as u64 + 1, InputEvent::KeyDown {
            key: "extra".into(), code: "KeyExtra".into(), modifiers: 0,
        });
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&overflow_msg).unwrap()).await, ControlInputOutcome::DispatchFailed));
        assert!(manager.validate_lease(&token).await.is_err());
        let commands = input_commands(&native);
        assert!(!commands.iter().any(|c| c["params"]["code"] == "KeyExtra"));
        assert_eq!(commands.iter().filter(|c| c["params"]["type"] == "keyUp").count(), MAX_HELD_KEYS);
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn control_handler_fences_failed_keyup_and_retries_original_release() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        let down = input(&token, 1, InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 });
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&down).unwrap()).await, ControlInputOutcome::Continue));
        native.fail_input.store(true, Ordering::SeqCst);
        let up = input(&token, 2, InputEvent::KeyUp { key: "a".into(), code: "KeyA".into(), modifiers: 0 });
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&up).unwrap()).await, ControlInputOutcome::ReleaseFailed(_)));
        assert!(manager.validate_lease(&token).await.is_err());
        assert!(manager.release_failure().await.is_some());
        native.fail_input.store(false, Ordering::SeqCst);
        native.commands.lock().clear();
        manager.acquire_lease("viewer-2", "human").await.unwrap();
        let commands = input_commands(&native);
        assert!(commands.iter().any(|c| c["params"]["type"] == "keyUp" && c["sessionId"] == "ORIGINAL-PAGE-SESSION"), "{commands:?}");
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn lost_native_dispatch_outcome_blocks_reacquisition() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        native.drop_input.store(true, Ordering::SeqCst);
        let down = input(&token, 1, InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 });
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&down).unwrap()).await, ControlInputOutcome::ReleaseFailed(_)));
        assert!(manager.validate_lease(&token).await.is_err());
        assert!(manager.release_failure().await.unwrap().contains("unresolved"));
        assert!(matches!(manager.acquire_lease("viewer-2", "human").await, Err(InputError::ReleaseFailed(_))));
        assert!(!input_commands(&native).iter().any(|c| c["params"]["type"] == "keyUp"),
            "uncertain command must not be reported as reconciled by a later release");
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn ambiguous_release_stays_unavailable_after_transport_reconnects() {
        let native = mock_native().await;
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        native.drop_input.store(true, Ordering::SeqCst);
        assert!(manager.release_lease(&token).await.is_err());
        assert!(manager.release_failure().await.unwrap().contains("unresolved"));
        native.drop_input.store(false, Ordering::SeqCst);
        tokio::time::timeout(Duration::from_secs(2), native.target.client.reconnect()).await.unwrap().unwrap();
        // The peer now accepts input, but a successful later command cannot prove whether the
        // previous unanswered release ran on the original connection.
        native.target.dispatch(&InputEvent::KeyUp { key: "a".into(), code: "KeyA".into(), modifiers: 0 }).await.unwrap();
        assert!(manager.release_native().await.is_err());
        assert!(matches!(manager.acquire_lease("viewer-2", "human").await, Err(InputError::ReleaseFailed(_))));
    }

    #[tokio::test]
    async fn cancelled_dequeued_release_waiting_on_gate_releases_original_input() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;
        use std::task::Poll;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        let notified = Arc::new(tokio::sync::Notify::new());
        let hook = notified.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        let release = serde_json::to_string(&input(&token, 4, InputEvent::KeyUp {
            key: "a".into(), code: "KeyA".into(), modifiers: 0,
        })).unwrap();
        let gate = manager.begin_dispatch(&token).await.unwrap();
        let mut dispatch = Box::pin(tokio::task::unconstrained(handle_control_text(&context, &release)));
        assert!(matches!(futures_util::poll!(dispatch.as_mut()), Poll::Pending));
        drop(dispatch);
        drop(gate);
        tokio::time::timeout(Duration::from_secs(2), notified.notified()).await.unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        assert_released_exactly(&native, "cancelled queued release");
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn cancelled_actor_queued_keydown_is_not_written_after_cleanup() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;
        use std::task::Poll;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let notified = Arc::new(tokio::sync::Notify::new());
        let hook = notified.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        native.commands.lock().clear();
        native.block_input.store(true, Ordering::SeqCst);
        let blocker = {
            let client = native.target.client.clone();
            tokio::spawn(async move {
                client.send_command("Input.insertText", Some(json!({"text": "blocker"})), Some("ORIGINAL-PAGE-SESSION")).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        let down = serde_json::to_string(&input(&token, 1, InputEvent::KeyDown {
            key: "a".into(), code: "KeyA".into(), modifiers: 0,
        })).unwrap();
        let mut dispatch = Box::pin(tokio::task::unconstrained(handle_control_text(&context, &down)));
        assert!(matches!(futures_util::poll!(dispatch.as_mut()), Poll::Pending));
        drop(dispatch);
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), blocker).await.unwrap().unwrap().unwrap();
        tokio::time::timeout(Duration::from_secs(2), notified.notified()).await.unwrap();
        let commands = input_commands(&native);
        assert!(!commands.iter().any(|c| c["params"]["type"] == "rawKeyDown" || c["params"]["type"] == "keyDown"), "{commands:?}");
        assert!(commands.iter().any(|c| c["params"]["type"] == "keyUp" && c["sessionId"] == "ORIGINAL-PAGE-SESSION"), "{commands:?}");
        assert!(manager.validate_lease(&token).await.is_err());
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn lease_fence_cancels_actor_queued_input_without_dropping_handler() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;
        use std::task::Poll;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        native.commands.lock().clear();
        native.block_input.store(true, Ordering::SeqCst);
        let blocker = {
            let client = native.target.client.clone();
            tokio::spawn(async move {
                client.send_command("Input.insertText", Some(json!({"text": "blocker"})), Some("ORIGINAL-PAGE-SESSION")).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        let down = serde_json::to_string(&input(&token, 1, InputEvent::KeyDown {
            key: "a".into(), code: "KeyA".into(), modifiers: 0,
        })).unwrap();
        let mut dispatch = Box::pin(tokio::task::unconstrained(handle_control_text(&context, &down)));
        assert!(matches!(futures_util::poll!(dispatch.as_mut()), Poll::Pending));
        manager.fence_lease().await;
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), blocker).await.unwrap().unwrap().unwrap();
        assert!(matches!(tokio::time::timeout(Duration::from_secs(2), dispatch).await.unwrap(), ControlInputOutcome::DispatchFailed));
        let commands = input_commands(&native);
        assert!(!commands.iter().any(|c| c["params"]["type"] == "rawKeyDown" || c["params"]["type"] == "keyDown"), "{commands:?}");
        assert!(manager.validate_lease(&token).await.is_err());
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn cancelled_written_keydown_waits_for_reply_before_native_release() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;
        use tokio::sync::mpsc;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (responses, mut response_rx) = mpsc::unbounded_channel::<Value>();
        let (down_tx, mut down_rx) = mpsc::unbounded_channel::<Value>();
        let (up_tx, mut up_rx) = mpsc::unbounded_channel::<Value>();
        let peer_responses = responses.clone();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let ws = tokio_tungstenite::accept_async(socket).await.unwrap();
            let (mut sink, mut stream) = ws.split();
            tokio::spawn(async move {
                while let Some(response) = response_rx.recv().await {
                    if sink.send(Message::Text(response.to_string().into())).await.is_err() {
                        break;
                    }
                }
            });
            while let Some(Ok(Message::Text(text))) = stream.next().await {
                let command: Value = serde_json::from_str(&text).unwrap();
                if command["params"]["type"] == "rawKeyDown" {
                    down_tx.send(command).unwrap();
                    continue;
                }
                if command["params"]["type"] == "keyUp" {
                    up_tx.send(command.clone()).unwrap();
                }
                let result = if command["method"] == "Target.attachToTarget" {
                    json!({"sessionId": "ORIGINAL-PAGE-SESSION"})
                } else {
                    json!({})
                };
                if peer_responses.send(json!({"id": command["id"], "result": result})).is_err() {
                    break;
                }
            }
        });
        let client = CdpClient::connect(&format!("ws://{address}")).await.unwrap();
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, client,
            "target".into(), TargetGeometry {
                css_width: 1000.0, css_height: 800.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
            },
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let notified = Arc::new(tokio::sync::Notify::new());
        let hook = notified.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        let message = serde_json::to_string(&input(&token, 1, InputEvent::KeyDown {
            key: "a".into(), code: "KeyA".into(), modifiers: 0,
        })).unwrap();
        let task = {
            let manager = manager.clone();
            let session_id = session_id.clone();
            tokio::spawn(async move {
                let context = ControlInputContext {
                    input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
                    subscription_epoch: "sub", paired: true,
                };
                handle_control_text(&context, &message).await
            })
        };
        let original = tokio::time::timeout(Duration::from_secs(2), down_rx.recv()).await.unwrap().unwrap();
        task.abort();
        assert!(task.await.is_err());
        assert!(tokio::time::timeout(Duration::from_millis(100), up_rx.recv()).await.is_err(),
            "cleanup must wait for the written command's outcome");
        responses.send(json!({"id": original["id"], "result": {}})).unwrap();
        let released = tokio::time::timeout(Duration::from_secs(2), up_rx.recv()).await.unwrap().unwrap();
        assert_eq!(released["sessionId"], "ORIGINAL-PAGE-SESSION");
        tokio::time::timeout(Duration::from_secs(2), notified.notified()).await.unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn revoke_fences_reacquire_already_cleaning_predecessor() {
        let native = mock_native().await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        native.block_input.store(true, Ordering::SeqCst);
        let acquiring = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.acquire_lease("viewer-1", "human").await })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        let revoking = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.revoke_lease().await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        assert!(matches!(acquiring.await.unwrap(), Err(InputError::GeometryUnavailable)));
        revoking.await.unwrap().unwrap();
        assert_released_exactly(&native, "revoke during reacquisition");
        assert!(manager.acquire_lease("successor", "human").await.is_ok());
    }

    #[tokio::test]
    async fn cancelled_revoke_waiting_for_gate_releases_original_holds() {
        let native = mock_native().await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        let gate = manager.begin_dispatch(&token).await.unwrap();
        let finished = Arc::new(tokio::sync::Notify::new());
        let hook_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (hook, count) = (finished.clone(), hook_count.clone());
        manager.set_lease_end_hook(Arc::new(move |_| {
            let (hook, count) = (hook.clone(), count.clone());
            Box::pin(async move {
                count.fetch_add(1, Ordering::SeqCst);
                hook.notify_one();
            })
        }));
        let task = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.revoke_lease().await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.validate_lease(&token).await.is_ok() {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        task.abort();
        drop(gate);
        tokio::time::timeout(Duration::from_secs(2), finished.notified()).await.unwrap();
        assert_released_exactly(&native, "cancelled revoke");
        assert_eq!(hook_count.load(Ordering::SeqCst), 1);
        assert!(manager.acquire_lease("successor", "human").await.is_ok());
    }

    #[tokio::test]
    async fn cancelled_inflight_keydown_fences_lease_and_releases_original_target() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer.clone()).await;
        let manager = Arc::new(SessionInputManager::new());
        dam_hopper_server::api::browser_host::global_input_managers()
            .write().await.insert(session_id.clone(), manager.clone());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let notified = Arc::new(tokio::sync::Notify::new());
        let hook = notified.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        native.block_input.store(true, Ordering::SeqCst);
        let message = serde_json::to_string(&input(&token, 1, InputEvent::KeyDown {
            key: "a".into(), code: "KeyA".into(), modifiers: 0,
        })).unwrap();
        let task = {
            let manager = manager.clone();
            let session_id = session_id.clone();
            tokio::spawn(async move {
                let context = ControlInputContext {
                    input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
                    subscription_epoch: "sub", paired: true,
                };
                handle_control_text(&context, &message).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        task.abort();
        assert!(task.await.is_err());
        let mut fence = tokio::spawn(async move { producer.begin_external_geometry_fence().await });
        assert!(tokio::time::timeout(Duration::from_millis(100), &mut fence).await.is_err(),
            "geometry fence must wait for original-target cleanup");
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), notified.notified()).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), fence).await.unwrap().unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        assert!(manager.release_failure().await.is_none());
        assert!(input_commands(&native).iter().any(|c| c["params"]["type"] == "keyUp" && c["sessionId"] == "ORIGINAL-PAGE-SESSION"));
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
        dam_hopper_server::api::browser_host::global_input_managers()
            .write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn cancelled_control_handler_does_not_abandon_failed_dispatch_cleanup() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        let down = input(&token, 1, InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 });
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&down).unwrap()).await, ControlInputOutcome::Continue));
        native.fail_input.store(true, Ordering::SeqCst);
        native.block_after_failure.store(true, Ordering::SeqCst);
        let up = serde_json::to_string(&input(&token, 2, InputEvent::KeyUp { key: "a".into(), code: "KeyA".into(), modifiers: 0 })).unwrap();
        let task = {
            let manager = manager.clone();
            let session_id = session_id.clone();
            tokio::spawn(async move {
                let context = ControlInputContext {
                    input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
                    subscription_epoch: "sub", paired: true,
                };
                handle_control_text(&context, &up).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        task.abort();
        assert!(task.await.is_err());
        native.fail_input.store(false, Ordering::SeqCst);
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        let gate = tokio::time::timeout(Duration::from_secs(2), manager.begin_dispatch(&token)).await.unwrap();
        assert!(gate.is_none(), "failed lease must stay fenced after cleanup");
        assert!(manager.release_failure().await.is_none());
        assert!(input_commands(&native).iter().filter(|c| c["params"]["type"] == "keyUp").count() >= 2);
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn cancelled_pointer_cancel_handler_finishes_native_button_release() {
        use dam_hopper_server::browser_host::control_input::{handle_control_text, ControlInputContext, ControlInputOutcome};
        use dam_hopper_server::browser_host::media::{get_or_register_producer, GLOBAL_PRODUCERS};
        use dam_hopper_server::browser_host::screencast::ScreencastProducer;

        let native = mock_native().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(), "inc".into(), 1, 1, native.target.client.clone(),
            "target".into(), native.target.geometry.clone(),
        ));
        producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let context = ControlInputContext {
            input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
            subscription_epoch: "sub", paired: true,
        };
        let down = input(&token, 1, InputEvent::PointerDown {
            button: MouseButton::Left, u: 0.5, v: 0.5, modifiers: 0,
        });
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&down).unwrap()).await, ControlInputOutcome::Continue));
        let finished = Arc::new(tokio::sync::Notify::new());
        let hook = finished.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let hook = hook.clone();
            Box::pin(async move { hook.notify_one() })
        }));
        native.block_input.store(true, Ordering::SeqCst);
        let cancel = serde_json::to_string(&input(&token, 2, InputEvent::PointerCancel)).unwrap();
        let task = {
            let manager = manager.clone();
            let session_id = session_id.clone();
            tokio::spawn(async move {
                let context = ControlInputContext {
                    input_manager: &manager, session_id: &session_id, viewer_id: "viewer-1",
                    subscription_epoch: "sub", paired: true,
                };
                handle_control_text(&context, &cancel).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        task.abort();
        assert!(task.await.is_err());
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), finished.notified()).await.unwrap();
        assert!(manager.validate_lease(&token).await.is_err());
        assert_eq!(input_commands(&native).iter().filter(|c| c["params"]["type"] == "mouseReleased").count(), 1);
        assert!(manager.release_failure().await.is_none());
        let token = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match manager.acquire_lease("viewer-1", "human").await {
                    Ok((token, _)) => break token,
                    Err(InputError::GeometryUnavailable) => tokio::task::yield_now().await,
                    Err(error) => panic!("unexpected acquisition error: {error:?}"),
                }
            }
        }).await.unwrap();
        let down_again = input(&token, 1, down.event.clone());
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&down_again).unwrap()).await, ControlInputOutcome::Continue));
        native.fail_input.store(true, Ordering::SeqCst);
        let failed_cancel = input(&token, 2, InputEvent::PointerCancel);
        assert!(matches!(handle_control_text(&context, &serde_json::to_string(&failed_cancel).unwrap()).await, ControlInputOutcome::ReleaseFailed(_)));
        assert!(manager.validate_lease(&token).await.is_err());
        native.fail_input.store(false, Ordering::SeqCst);
        native.commands.lock().clear();
        manager.acquire_lease("viewer-2", "human").await.unwrap();
        assert!(input_commands(&native).iter().any(|c| c["params"]["type"] == "mouseReleased" && c["sessionId"] == "ORIGINAL-PAGE-SESSION"));
        GLOBAL_PRODUCERS.write().await.remove(&session_id);
    }

    #[tokio::test]
    async fn same_viewer_reacquire_releases_original_native_holds_first() {
        let native = mock_native().await;
        let manager = SessionInputManager::new();
        let (old, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &old).await;
        let (new, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        assert_ne!(old, new);
        assert_released_exactly(&native, "same viewer replacement");
        assert!(manager.validate_lease(&old).await.is_err());
        assert!(manager.validate_lease(&new).await.is_ok());
    }

    #[tokio::test]
    async fn cancelled_reacquire_finishes_cleanup_without_replacing_lease() {
        let native = mock_native().await;
        let manager = SessionInputManager::new_shared(Duration::from_secs(30));
        let (old, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &old).await;
        native.block_input.store(true, Ordering::SeqCst);
        let acquiring = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.acquire_lease("viewer-1", "human").await })
        };
        tokio::time::timeout(Duration::from_secs(1), native.blocked.notified()).await.unwrap();
        acquiring.abort();
        assert!(acquiring.await.unwrap_err().is_cancelled());
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        let gate = tokio::time::timeout(Duration::from_secs(2), manager.begin_dispatch(&old))
            .await.unwrap().expect("predecessor lease must remain live");
        drop(gate);
        assert!(manager.release_failure().await.is_none());
        assert!(manager.validate_lease(&old).await.is_ok());
        assert_released_exactly(&native, "cancelled reacquisition");
        let commands = input_commands(&native);
        assert_eq!(commands.iter().filter(|c| c["params"]["type"] == "mouseReleased").count(), 1);
        assert_eq!(commands.iter().filter(|c| c["params"]["type"] == "keyUp").count(), 1);
    }

    #[tokio::test]
    async fn cancelled_explicit_release_finishes_cleanup_and_notifies() {
        let native = mock_native().await;
        let manager = Arc::new(SessionInputManager::new());
        let (token, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &token).await;
        let notified = Arc::new(tokio::sync::Notify::new());
        let hook_notify = notified.clone();
        manager.set_lease_end_hook(Arc::new(move |_| {
            let notify = hook_notify.clone();
            Box::pin(async move { notify.notify_one() })
        }));
        native.block_input.store(true, Ordering::SeqCst);
        let releasing = {
            let manager = manager.clone();
            let token = token.clone();
            tokio::spawn(async move { manager.release_lease(&token).await })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        releasing.abort();
        assert!(releasing.await.unwrap_err().is_cancelled());
        assert!(manager.validate_lease(&token).await.is_err());
        let mut successor = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.acquire_lease("viewer-2", "human").await })
        };
        assert!(tokio::time::timeout(Duration::from_millis(100), &mut successor).await.is_err());
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(2), notified.notified()).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), successor).await.unwrap().unwrap().unwrap();
        assert_released_exactly(&native, "cancelled explicit release");
    }

    #[tokio::test]
    async fn cancelled_reacquire_without_predecessor_finishes_native_cleanup() {
        let native = mock_native().await;
        let manager = Arc::new(SessionInputManager::new());
        let (old, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        hold(&manager, &native, &old).await;
        native.fail_input.store(true, Ordering::SeqCst);
        assert!(manager.release_lease(&old).await.is_err());
        assert!(manager.release_failure().await.is_some());
        native.fail_input.store(false, Ordering::SeqCst);
        native.commands.lock().clear();
        native.block_input.store(true, Ordering::SeqCst);
        let acquiring = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.acquire_lease("viewer-2", "human").await })
        };
        tokio::time::timeout(Duration::from_secs(2), native.blocked.notified()).await.unwrap();
        acquiring.abort();
        assert!(acquiring.await.unwrap_err().is_cancelled());
        native.block_input.store(false, Ordering::SeqCst);
        native.resume.notify_one();
        assert!(tokio::time::timeout(Duration::from_secs(2), manager.begin_dispatch(&old)).await.unwrap().is_none());
        assert!(manager.release_failure().await.is_none());
        assert!(!manager.is_lease_holder("viewer-2").await);
        assert_released_exactly(&native, "cancelled acquisition without predecessor");
    }

    #[tokio::test]
    async fn lease_cannot_be_used_by_a_foreign_viewer() {
        let manager = SessionInputManager::new();
        let (token, _) = manager.acquire_lease("viewer-a", "human").await.unwrap();
        let msg = input(&token, 1, InputEvent::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 0 });
        assert_eq!(manager.enqueue_input_for_viewer("viewer-b", msg.clone()).await.unwrap_err(), InputError::NotLeaseHolder);
        assert!(manager.drain_inputs().await.is_empty(), "foreign viewer enqueued input");
        assert!(manager.enqueue_input_for_viewer("viewer-a", msg).await.unwrap().is_some());
        assert!(manager.is_lease_holder("viewer-a").await, "a rejected foreign viewer must not revoke the lease");
    }

    #[tokio::test]
    async fn failed_release_is_unavailable_not_released_and_recovers_on_retry() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        global_session_registry().reset_for_test().await;
        let tmp = tempdir().unwrap();
        let (auth_service, token) = make_user_token("release-failure-user", UserRole::Admin, true);
        let state = create_test_state(tmp.path().to_path_buf(), false).with_auth_service(Arc::new(auth_service));
        let app = build_router_with_origins(state, vec![]);
        let (dto, _) = global_session_registry()
            .insert_running_for_test(
                "release-failure-user", false, "inc-1", 1,
                &CreateSessionRequest {
                    creation_key: uuid::Uuid::new_v4().to_string(),
                    url: "about:blank".to_string(),
                    viewport: ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
                },
                &[],
            )
            .await
            .unwrap();
        let session_id = dto.browser_session_id;
        let manager = get_or_create_input_manager(&session_id).await;
        let (lease, _) = manager.acquire_lease("viewer-1", "human").await.unwrap();
        let native = mock_native().await;
        hold(&manager, &native, &lease).await;

        native.fail_input.store(true, Ordering::SeqCst);
        let uri = format!("/api/browser/sessions/{session_id}/control/release");
        let (status, body) = send_json(&app, "POST", &uri, &token, json!({ "leaseToken": lease })).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "failed release must not be reported as released: {body}");
        assert_ne!(body["status"], "released");
        assert!(manager.release_failure().await.is_some(), "input must be marked unavailable");

        // A new lease is refused while native input is still held ...
        let acquire = format!("/api/browser/sessions/{session_id}/control/acquire");
        let (status, _) = send_json(&app, "POST", &acquire, &token, json!({ "viewerId": "viewer-2", "holderKind": "human" })).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

        // ... and the retry succeeds once the browser accepts the releases.
        native.fail_input.store(false, Ordering::SeqCst);
        let (status, _) = send_json(&app, "POST", &acquire, &token, json!({ "viewerId": "viewer-2", "holderKind": "human" })).await;
        assert_eq!(status, StatusCode::OK);
        assert!(manager.release_failure().await.is_none());
        let key_ups = input_commands(&native).iter().filter(|c| c["params"]["type"] == "keyUp").count();
        assert!(key_ups >= 1, "retry released the key");
    }
}

mod selected_text_revalidation {
    use super::*;
    use dam_hopper_server::api::browser_host::get_or_register_producer;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::screencast::ScreencastProducer;
    use futures_util::{SinkExt, StreamExt};
    use tokio::sync::Notify;
    use tokio_tungstenite::tungstenite::Message;

    async fn setup_paused_eval_session(
        username: &str,
    ) -> (
        tempfile::TempDir,
        axum::Router,
        String,
        String,
        String,
        Arc<Notify>,
        Arc<Notify>,
    ) {
        global_session_registry().reset_for_test().await;
        let tmp = tempdir().unwrap();
        let (auth_service, token) = make_user_token(username, UserRole::Admin, true);
        let state = create_test_state(tmp.path().to_path_buf(), false)
            .with_auth_service(Arc::new(auth_service));
        let app = build_router_with_origins(state, vec![]);

        let eval_entered = Arc::new(Notify::new());
        let eval_release = Arc::new(Notify::new());
        let entered_clone = eval_entered.clone();
        let release_clone = eval_release.clone();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let Ok((stream, _)) = listener.accept().await else { return };
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let cmd: Value = serde_json::from_str(&text).unwrap();
                let id = cmd["id"].clone();
                let method = cmd["method"].as_str().unwrap_or_default().to_string();
                let sid = cmd.get("sessionId").cloned();
                let result = if method == "Target.attachToTarget" {
                    json!({ "sessionId": "paused-eval-page-sid" })
                } else if method == "Runtime.evaluate" {
                    entered_clone.notify_one();
                    release_clone.notified().await;
                    json!({ "result": { "type": "string", "value": "late-secret-selection" } })
                } else {
                    json!({})
                };
                let mut resp = json!({ "id": id, "result": result });
                if let Some(s) = sid {
                    resp.as_object_mut().unwrap().insert("sessionId".into(), s);
                }
                if ws.send(Message::Text(resp.to_string().into())).await.is_err() {
                    break;
                }
            }
        });

        let client = CdpClient::connect(&format!("ws://127.0.0.1:{port}"))
            .await
            .expect("mock cdp");
        let (dto, _) = global_session_registry()
            .insert_running_for_test(
                username,
                false,
                "inc-reval",
                1,
                &CreateSessionRequest {
                    creation_key: uuid::Uuid::new_v4().to_string(),
                    url: "http://example.com".to_string(),
                    viewport: ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
                },
                &[],
            )
            .await
            .unwrap();
        let session_id = dto.browser_session_id;
        let producer = Arc::new(ScreencastProducer::new(
            session_id.clone(),
            "inc-reval".to_string(),
            1,
            1,
            client,
            "target-reval".to_string(),
            TargetGeometry {
                css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0,
                dpr: 1.0,
            },
        ));
        let _ = producer.ensure_page_session().await.unwrap();
        get_or_register_producer(&session_id, producer).await;

        let input_mgr = get_or_create_input_manager(&session_id).await;
        let (lease_token, _) = input_mgr.acquire_lease("viewer-1", "human").await.unwrap();
        input_mgr.set_selected_text("previous-cached").await;

        (tmp, app, token, session_id, lease_token, eval_entered, eval_release)
    }

    #[tokio::test]
    async fn selected_text_rejects_when_lease_revoked_during_cdp_eval() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let (_tmp, app, token, session_id, lease_token, eval_entered, eval_release) =
            setup_paused_eval_session("admin-reval-lease").await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/browser/sessions/{session_id}/selected-text"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(&X_BROWSER_LEASE, &lease_token)
            .body(Body::empty())
            .unwrap();
        let pending = tokio::spawn(async move { app.oneshot(req).await.unwrap() });

        eval_entered.notified().await;
        let input_mgr = get_or_create_input_manager(&session_id).await;
        input_mgr.revoke_lease().await.unwrap();
        eval_release.notify_one();

        let resp = pending.await.unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        let body: Value = serde_json::from_slice(
            &axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap(),
        )
        .unwrap();
        assert_ne!(body["text"], "late-secret-selection");
        // Cache must not be overwritten with the post-revocation eval result.
        let (new_lease, _) = input_mgr.acquire_lease("viewer-2", "human").await.unwrap();
        assert_eq!(input_mgr.get_selected_text(&new_lease).await.unwrap(), "previous-cached");
    }

    #[tokio::test]
    async fn selected_text_rejects_when_navigation_revision_changes_during_cdp_eval() {
        let _serial = SERIAL_TEST_LOCK.lock().await;
        let (_tmp, app, token, session_id, lease_token, eval_entered, eval_release) =
            setup_paused_eval_session("admin-reval-nav").await;

        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/browser/sessions/{session_id}/selected-text"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(&X_BROWSER_LEASE, &lease_token)
            .body(Body::empty())
            .unwrap();
        let pending = tokio::spawn(async move { app.oneshot(req).await.unwrap() });

        eval_entered.notified().await;
        let bumped = global_session_registry()
            .record_cdp_navigation(&session_id, Some("http://example.com/moved"), &[])
            .await;
        assert_eq!(bumped, Some(2));
        eval_release.notify_one();

        let resp = pending.await.unwrap();
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let body: Value = serde_json::from_slice(
            &axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap(),
        )
        .unwrap();
        assert_eq!(body["kind"], "sessionConflict");
        assert_ne!(body["text"], "late-secret-selection");
        let input_mgr = get_or_create_input_manager(&session_id).await;
        assert_eq!(input_mgr.get_selected_text(&lease_token).await.unwrap(), "previous-cached");
    }
}
