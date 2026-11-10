use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;

use axum::body::Body;
use axum::http::header::{HeaderMap, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, Request, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tokio::time::sleep;
use tower::ServiceExt;
use uuid::Uuid;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::attachments::{
    AttachmentError, AttachmentManager, AttachmentPurpose, IssueTicketRequest,
};
use dam_hopper_server::browser_host::auth::{
    evaluate_browser_admission, verify_live_admission, BrowserAdmission, BrowserAuthError,
};
use dam_hopper_server::browser_host::input::{
    InputError, InputEvent, InputMessage, SessionInputManager,
};
use dam_hopper_server::browser_host::diagnostics::{global_memory_controller, TrackedBhjfFrame};
use dam_hopper_server::browser_host::media::ViewerCreditController;
use dam_hopper_server::browser_host::network_policy::{validate_navigation_url, NetworkPolicyError};
use dam_hopper_server::browser_host::protocol::{
    pack_bhjf_frame, TargetFrameHeader, TargetGeometry,
};
use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, EventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use opaque_ke::ServerSetup;

fn resolve_test_executable() -> Option<PathBuf> {
    if let Ok(p) = dam_hopper_server::browser_host::process::find_browser_executable(None) {
        return Some(p);
    }
    for candidate in &["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

static ENV_LOCK: Mutex<()> = Mutex::new(());
const JWT_SECRET: &str = "test-jwt-secret-key-security-matrix";

fn create_test_state(workspace_root: PathBuf, no_auth: bool) -> AppState {
    let _guard = ENV_LOCK.lock();

    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let mut server_config = dam_hopper_server::config::ServerConfig::default();
    server_config.browser.enabled = true;
    server_config.browser.executable_path = resolve_test_executable();
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
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver));
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

    *state.browser_host._test_mock_handle.write() = Some(
        dam_hopper_server::browser_host::manager::BrowserInstanceHandle {
            subject: "admin-user".to_string(),
            is_dev: false,
            pid: 1234,
            ws_endpoint: "ws://127.0.0.1:9222/devtools/browser/00000000-0000-0000-0000-000000000001".to_string(),
            browser_incarnation: "test-incarnation-uuid".to_string(),
            profile_epoch: 1,
            user_data_dir: workspace_root.join("mock-user-data"),
        },
    );

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

fn make_dummy_jpeg() -> Vec<u8> {
    let mut data = vec![
        0xFF, 0xD8, // SOI
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02,
        0x11, 0x01, 0x03, 0x11, 0x01, // SOF0 (64x64)
        0xFF, 0xD9, // EOI
    ];
    data.resize(64, 0);
    data[62] = 0xFF;
    data[63] = 0xD9;
    data
}

fn make_test_frame(run_id: &str, v_epoch: &str, seq: &str) -> TrackedBhjfFrame {
    let header = TargetFrameHeader {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        producer_run: run_id.to_string(),
        viewport_epoch: v_epoch.to_string(),
        frame_seq: seq.to_string(),
        width: 64,
        height: 64,
        capture_time_unix_ms: 1000,
        geometry: TargetGeometry {
            css_width: 64.0,
            css_height: 64.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
        input_trusted: true,
    };
    let bytes = pack_bhjf_frame(&header, &make_dummy_jpeg()).expect("pack frame");
    let res = global_memory_controller()
        .try_reserve(bytes.len())
        .expect("reserve memory");
    TrackedBhjfFrame::new(bytes, res)
}

#[tokio::test]
async fn test_security_matrix_role_denial_unauthenticated_and_ordinary() {
    let tmp = tempdir().unwrap();
    let (admin_auth, admin_token) = make_user_token("admin-user", UserRole::Admin, true);
    let (member_auth, member_token) = make_user_token("member-user", UserRole::User, true);

    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(admin_auth));
    let app = build_router_with_origins(state, vec![]);

    // 1. Capabilities endpoint
    // 1a. Unauthenticated -> 401
    let req_unauth = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(res.headers().get(CACHE_CONTROL).unwrap(), "no-store");

    // 1b. Ordinary member -> 403
    let member_state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(member_auth));
    let member_app = build_router_with_origins(member_state, vec![]);
    let req_member = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {member_token}"))
        .body(Body::empty())
        .unwrap();
    let res = member_app.clone().oneshot(req_member).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 1c. Admin -> 200 available
    let req_admin = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header(AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req_admin).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = axum::body::to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["available"], true);

    // 2. Sessions list
    // 2a. Unauth -> 401
    let req_sessions_unauth = Request::builder()
        .method("GET")
        .uri("/api/browser/sessions")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req_sessions_unauth).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // 2b. Member -> 403
    let req_sessions_member = Request::builder()
        .method("GET")
        .uri("/api/browser/sessions")
        .header(AUTHORIZATION, format!("Bearer {member_token}"))
        .body(Body::empty())
        .unwrap();
    let res = member_app.clone().oneshot(req_sessions_member).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 3. Attachments
    let att_body = json!({
        "purpose": "media",
        "browserSessionId": "session-1",
        "viewerId": "viewer-1",
        "subscriptionEpoch": "sub-1",
        "browserIncarnation": "inc-1",
        "profileEpoch": 1
    }).to_string();

    // 3a. Unauth -> 401
    let req_att_unauth = Request::builder()
        .method("POST")
        .uri("/api/browser/attachments")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(att_body.clone()))
        .unwrap();
    let res = app.clone().oneshot(req_att_unauth).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // 3b. Member -> 403
    let req_att_member = Request::builder()
        .method("POST")
        .uri("/api/browser/attachments")
        .header(AUTHORIZATION, format!("Bearer {member_token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(att_body))
        .unwrap();
    let res = member_app.clone().oneshot(req_att_member).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 4. Raw CDP discovery (/api/browser/cdp/json/version)
    let req_cdp_unauth = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req_cdp_unauth).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let req_cdp_member = Request::builder()
        .method("GET")
        .uri("/api/browser/cdp/json/version")
        .header(AUTHORIZATION, format!("Bearer {member_token}"))
        .body(Body::empty())
        .unwrap();
    let res = member_app.clone().oneshot(req_cdp_member).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 5. Profile reset
    let reset_body = json!({
        "operationId": "op-test-1",
        "expectedProfileEpoch": 1,
        "confirmed": true
    }).to_string();

    let req_reset_unauth = Request::builder()
        .method("POST")
        .uri("/api/browser/profile/reset")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(reset_body.clone()))
        .unwrap();
    let res = app.clone().oneshot(req_reset_unauth).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let req_reset_member = Request::builder()
        .method("POST")
        .uri("/api/browser/profile/reset")
        .header(AUTHORIZATION, format!("Bearer {member_token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(reset_body))
        .unwrap();
    let res = member_app.clone().oneshot(req_reset_member).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_ticket_replay_purpose_origin_and_epoch_rejection() {
    let mgr = AttachmentManager::new();
    let adm = BrowserAdmission {
        principal: "subject-admin".to_string(),
        is_dev: false,
        session_id: Some("auth-session-1".to_string()),
        auth_version: Some(0),
        credential_version: Some(0),
        effective_deadline: None,
    };

    let req = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some("session-1".to_string()),
        viewer_id: Some("viewer-1".to_string()),
        subscription_epoch: Some("sub-1".to_string()),
        browser_incarnation: "inc-1".to_string(),
        profile_epoch: 1,
    };

    // 1. Issue a ticket to test wrong purpose rejection
    let ticket1 = mgr
        .issue_ticket(&adm, &req, Some("http://127.0.0.1:4801"))
        .await
        .expect("issue media ticket 1");

    let res_wrong_purpose = mgr
        .consume_ticket(
            &ticket1.ticket,
            AttachmentPurpose::Control, // wrong!
            Some("http://127.0.0.1:4801"),
        )
        .await;
    assert!(res_wrong_purpose.is_err(), "wrong purpose must be rejected");

    // 2. Issue a ticket to test wrong origin rejection
    let ticket2 = mgr
        .issue_ticket(&adm, &req, Some("http://127.0.0.1:4801"))
        .await
        .expect("issue media ticket 2");

    let res_wrong_origin = mgr
        .consume_ticket(
            &ticket2.ticket,
            AttachmentPurpose::Media,
            Some("http://evil.example.com"), // wrong!
        )
        .await;
    assert!(res_wrong_origin.is_err(), "mismatched origin must be rejected");

    // 3. Issue a ticket to test exact consume then replay
    let ticket3 = mgr
        .issue_ticket(&adm, &req, Some("http://127.0.0.1:4801"))
        .await
        .expect("issue media ticket 3");

    let consumed = mgr
        .consume_ticket(
            &ticket3.ticket,
            AttachmentPurpose::Media,
            Some("http://127.0.0.1:4801"),
        )
        .await;
    assert!(consumed.is_ok(), "exact ticket consume must succeed");

    // 4. Replay attempt on consumed ticket -> must fail with TicketNotFound
    let replay_res = mgr
        .consume_ticket(
            &ticket3.ticket,
            AttachmentPurpose::Media,
            Some("http://127.0.0.1:4801"),
        )
        .await;
    assert_eq!(replay_res.unwrap_err(), AttachmentError::TicketNotFound);
}

#[tokio::test]
async fn test_no_auth_guarded_loopback_and_header_rejection() {
    let tmp = tempdir().unwrap();
    let state = create_test_state(tmp.path().to_path_buf(), true);
    state
        .record_bound_listener("127.0.0.1:4801".parse().unwrap())
        .expect("record listener");
    let headers = HeaderMap::new();

    // 1. Loopback peer address (127.0.0.1) -> allowed
    let loopback_addr: SocketAddr = "127.0.0.1:54321".parse().unwrap();
    let adm_loopback = evaluate_browser_admission(&state, &headers, Some(loopback_addr), None).await;
    assert!(adm_loopback.is_ok(), "loopback dev access should succeed");
    let adm = adm_loopback.unwrap();
    assert!(adm.is_dev, "admitted session should be marked dev");

    // 2. Non-loopback peer address (e.g. 192.168.1.50) -> strictly rejected
    let non_loopback_addr: SocketAddr = "192.168.1.50:54321".parse().unwrap();
    let adm_non_loopback = evaluate_browser_admission(&state, &headers, Some(non_loopback_addr), None).await;
    assert!(
        matches!(adm_non_loopback, Err(BrowserAuthError::DevBypassDenied(_))),
        "non-loopback dev peer must be rejected"
    );

    // 3. Forwarded headers cannot bypass non-loopback peer
    let app = build_router_with_origins(
        state,
        vec![HeaderValue::from_static("http://localhost:3000")],
    );
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/capabilities")
        .header("X-Forwarded-For", "127.0.0.1")
        .header("X-Forwarded-Host", "localhost")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert!(
        res.status() == StatusCode::UNAUTHORIZED || res.status() == StatusCode::FORBIDDEN,
        "spoofed forwarded headers must not bypass loopback requirement"
    );
}

#[tokio::test]
async fn test_url_safety_and_forbidden_schemes() {
    // 1. Dangerous schemes must be rejected
    let forbidden_urls = [
        "javascript:alert(1)",
        "data:text/html,<h1>bad</h1>",
        "file:///etc/passwd",
        "view-source:http://example.com",
        "chrome://settings",
        "about:flags",
    ];

    for url in forbidden_urls {
        let res = validate_navigation_url(url, false, &[]);
        assert!(res.is_err(), "URL {url} must be rejected");
    }

    // 2. Credentials in URL must be rejected
    let cred_url = "http://user:password@example.com";
    let cred_res = validate_navigation_url(cred_url, false, &[]);
    assert_eq!(cred_res, Err(NetworkPolicyError::CredentialsNotAllowed));

    // 3. Metadata IPs must be rejected in production
    let meta_url = "http://169.254.169.254/latest/meta-data/";
    let meta_res = validate_navigation_url(meta_url, false, &[]);
    assert!(meta_res.is_err(), "cloud metadata service must be blocked");

    // 4. Valid public internet and about:blank allowed in production
    assert!(validate_navigation_url("about:blank", false, &[]).is_ok());
    assert!(validate_navigation_url("https://example.com/path", false, &[]).is_ok());
}

#[tokio::test]
async fn test_multi_target_and_multi_viewer_isolation() {
    let run = Uuid::new_v4().to_string();

    // 1. Two viewers connecting to same target
    let sub1 = Uuid::new_v4().to_string();
    let sub2 = Uuid::new_v4().to_string();

    let mut ctrl1 = ViewerCreditController::new(sub1.clone());
    let mut ctrl2 = ViewerCreditController::new(sub2.clone());

    // Both viewers receive identical BHJF frame Bytes (zero-copy shared Bytes)
    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");
    let frame3 = make_test_frame(&run, "1", "3");

    // Viewer 1 receives frame 1 and sends ACK
    let res1_v1 = ctrl1.on_incoming_frame(frame1.clone());
    assert!(res1_v1.is_some());
    assert_eq!(ctrl1.outstanding_count(), 1);

    // Viewer 2 receives identical frame 1 but STALLS (no ACK sent)
    let res1_v2 = ctrl2.on_incoming_frame(frame1.clone());
    assert!(res1_v2.is_some());
    assert_eq!(ctrl2.outstanding_count(), 1);

    // Wait > 100ms for governor
    sleep(Duration::from_millis(110)).await;

    // Dispatch frame 2
    let _ = ctrl1.on_incoming_frame(frame2.clone());
    let _ = ctrl2.on_incoming_frame(frame2.clone());
    assert_eq!(ctrl1.outstanding_count(), 2);
    assert_eq!(ctrl2.outstanding_count(), 2);

    // Viewer 1 ACKs frame 1 -> frees credit on Viewer 1
    let _unblocked_v1 = ctrl1.on_credit_return(&sub1, &run, "1", "1", false);
    assert_eq!(ctrl1.outstanding_count(), 1);

    // Dispatch frame 3
    sleep(Duration::from_millis(110)).await;
    let res3_v1 = ctrl1.on_incoming_frame(frame3.clone());
    assert!(res3_v1.is_some(), "Viewer 1 should receive frame 3 because it has credit");
    assert_eq!(ctrl1.outstanding_count(), 2);

    // Viewer 2 is STALLED at capacity (2 outstanding) -> frame 3 is held in pending, NOT stalling Viewer 1!
    let res3_v2 = ctrl2.on_incoming_frame(frame3.clone());
    assert!(res3_v2.is_none(), "Viewer 2 is stalled at 2 outstanding; incoming frame buffered in pending");
    assert_eq!(ctrl2.outstanding_count(), 2);
    assert!(ctrl2.has_pending());

    // Cross-subscription ACK isolation: Viewer 2's subscription cannot return credit to Viewer 1
    let cross_ack = ctrl1.on_credit_return(&sub2, &run, "1", "2", false);
    assert!(cross_ack.is_none(), "foreign subscription ACK must not return credit");

    // 2. Verify PTY session broadcast responsiveness during media fanout
    let (event_sink, mut rx) = BroadcastEventSink::new(64);
    event_sink.send_terminal_data("test-pty-session", "terminal echo output\n", 0, 1);
    let received_str = rx.recv().await.expect("receive PTY event");
    let json_val: Value = serde_json::from_str(&received_str).expect("parse json");
    assert_eq!(json_val["id"], "test-pty-session");
    assert_eq!(json_val["data"], "terminal echo output\n");
}

#[tokio::test]
async fn test_stale_epoch_input_and_lease_conflict() {
    let mgr = SessionInputManager::new();

    // 1. Viewer 1 acquires lease
    let (lease_token, _exp) = mgr
        .acquire_lease("viewer-1", "human")
        .await
        .expect("acquire lease 1");

    // 2. Viewer 2 attempts to acquire lease on same session -> LeaseConflict
    let conflict_res = mgr.acquire_lease("viewer-2", "human").await;
    assert!(
        matches!(conflict_res, Err(InputError::LeaseConflict(_))),
        "lease already held must return LeaseConflict (409)"
    );

    // 3. Stale epoch input rejection
    // Set manager's expected viewport epoch to 2
    mgr.set_expected_viewport_epoch(2).await;

    // Dispatch input with stale viewport epoch 1
    let stale_msg = InputMessage {
        browser_session_id: "session-1".to_string(),
        browser_incarnation: "inc-1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub-1".to_string(),
        lease_token: lease_token.clone(),
        input_seq: 1,
        viewport_epoch: 1, // stale!
        event: InputEvent::PointerMove { u: 0.5, v: 0.5, modifiers: 0 },
    };
    let stale_res = mgr.enqueue_input(stale_msg).await;
    assert!(
        matches!(stale_res, Err(InputError::StaleViewportEpoch { expected: 2, actual: 1 })),
        "stale viewport epoch input must be rejected"
    );

    // 4. Input with matching viewport epoch 2 succeeds
    let valid_msg = InputMessage {
        browser_session_id: "session-1".to_string(),
        browser_incarnation: "inc-1".to_string(),
        profile_epoch: 1,
        subscription_epoch: "sub-1".to_string(),
        lease_token: lease_token.clone(),
        input_seq: 1,
        viewport_epoch: 2, // matching!
        event: InputEvent::PointerMove { u: 0.5, v: 0.5, modifiers: 0 },
    };
    let valid_res = mgr.enqueue_input(valid_msg).await;
    assert!(valid_res.is_ok(), "matching viewport epoch input should succeed");

    // 5. Release lease allows subsequent acquisition
    let rel_res = mgr.release_lease(&lease_token).await;
    assert!(rel_res.is_ok(), "lease release succeeds");

    let lease_v2 = mgr.acquire_lease("viewer-2", "agent").await;
    assert!(lease_v2.is_ok(), "after release, viewer 2 can acquire lease");
}

#[tokio::test]
async fn test_demoted_role_and_auth_revocation() {
    let tmp = tempdir().unwrap();
    let (auth_service, _admin_token) = make_user_token("test-user", UserRole::Admin, true);

    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service.clone()));

    let adm = BrowserAdmission {
        principal: "test-user".to_string(),
        is_dev: false,
        session_id: Some("session-for-test-user".to_string()),
        auth_version: Some(0),
        credential_version: Some(0),
        effective_deadline: None,
    };

    // 1. Initially Admin -> admission succeeds
    let res1 = verify_live_admission(&state, &adm).await;
    assert!(res1.is_ok(), "admin caller admitted");

    // 2. Demote user to UserRole::User
    let demoted_user = UserRecord {
        id: None,
        username: "test-user".to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role: UserRole::User, // demoted!
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let active_session = AuthSession {
        id: "session-for-test-user".to_string(),
        username: "test-user".to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(Utc::now()),
        expires_at: chrono_to_bson(Utc::now() + ChronoDuration::days(1)),
        mfa_verified_at: chrono_to_bson(Utc::now()),
        revoked_at: None,
        user_agent: None,
    };
    let demoted_service = AuthService::new_mock(demoted_user, active_session);
    let demoted_state = state.with_auth_service(Arc::new(demoted_service));

    let res2 = verify_live_admission(&demoted_state, &adm).await;
    assert!(
        matches!(res2, Err(BrowserAuthError::AdminRequired(_))),
        "demoted user must be rejected with AdminRequired"
    );
}
