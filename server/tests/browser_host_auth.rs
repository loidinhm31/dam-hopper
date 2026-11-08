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
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::attachments::{
    AttachmentError, AttachmentManager, AttachmentPurpose, IssueTicketRequest,
};
use dam_hopper_server::browser_host::auth::{
    verify_live_admission, BrowserAdmission, BrowserAuthError,
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
const JWT_SECRET: &str = "test-jwt-secret-key-browser-auth";

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
async fn test_rest_issue_ticket_and_consume() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-ticket-tester", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let (sess_dto, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .create_or_idempotent_get(
            "admin-ticket-tester",
            false,
            "inc-1",
            1,
            &dam_hopper_server::browser_host::session::CreateSessionRequest {
                creation_key: uuid::Uuid::new_v4().to_string(),
                url: "about:blank".into(),
                viewport: dam_hopper_server::browser_host::session::ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();

    let issue_req = json!({
        "purpose": "media",
        "browserSessionId": sess_dto.browser_session_id,
        "viewerId": "viewer-uuid-1",
        "subscriptionEpoch": "sub-epoch-1",
        "browserIncarnation": "inc-1",
        "profileEpoch": 1
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/browser/attachments")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&issue_req).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap(),
    )
    .unwrap();

    let raw_ticket = body["ticket"].as_str().unwrap();
    assert!(!raw_ticket.is_empty());
    let expires_at_ms = body["expiresAtUnixMs"].as_i64().unwrap();
    assert!(expires_at_ms > Utc::now().timestamp_millis());

    // Consume via global attachment manager
    let mgr = dam_hopper_server::api::browser_host::global_attachment_manager();
    let consumed = mgr
        .consume_ticket(raw_ticket, AttachmentPurpose::Media, None)
        .await
        .expect("consume should succeed");

    assert_eq!(consumed.principal, "admin-ticket-tester");
    assert_eq!(consumed.browser_session_id.as_deref(), Some(sess_dto.browser_session_id.as_str()));
    assert_eq!(consumed.viewer_id.as_deref(), Some("viewer-uuid-1"));
    assert_eq!(consumed.subscription_epoch.as_deref(), Some("sub-epoch-1"));

    // Replay attempt fails: single-use ticket
    let replay_res = mgr
        .consume_ticket(raw_ticket, AttachmentPurpose::Media, None)
        .await;
    assert_eq!(replay_res.unwrap_err(), AttachmentError::TicketNotFound);
}

#[tokio::test]
async fn test_purpose_and_origin_swap_rejected() {
    let mgr = AttachmentManager::new();
    let adm = BrowserAdmission {
        principal: "admin".to_string(),
        is_dev: false,
        session_id: Some("sid1".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };

    let req = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some("s1".to_string()),
        viewer_id: Some("v1".to_string()),
        subscription_epoch: Some("sub1".to_string()),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    };

    let issued = mgr
        .issue_ticket(&adm, &req, Some("http://localhost:5173"))
        .await
        .unwrap();

    // Wrong purpose
    let purpose_err = mgr
        .consume_ticket(&issued.ticket, AttachmentPurpose::Control, Some("http://localhost:5173"))
        .await
        .unwrap_err();
    assert!(matches!(purpose_err, AttachmentError::PurposeMismatch { .. }));

    // Re-issue for origin test
    let issued2 = mgr
        .issue_ticket(&adm, &req, Some("http://localhost:5173"))
        .await
        .unwrap();

    // Wrong origin
    let origin_err = mgr
        .consume_ticket(&issued2.ticket, AttachmentPurpose::Media, Some("http://evil.com"))
        .await
        .unwrap_err();
    assert!(matches!(origin_err, AttachmentError::OriginMismatch { .. }));
}

#[tokio::test]
async fn test_ticket_expiry_clipped_by_auth_deadline() {
    let mgr = AttachmentManager::new();
    // Auth deadline in 5 seconds
    let deadline = Utc::now() + ChronoDuration::seconds(5);

    let adm = BrowserAdmission {
        principal: "admin".to_string(),
        is_dev: false,
        session_id: Some("sid1".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: Some(deadline),
    };

    let req = IssueTicketRequest {
        purpose: AttachmentPurpose::AgentCdp,
        browser_session_id: None,
        viewer_id: None,
        subscription_epoch: None,
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    };

    let issued = mgr.issue_ticket(&adm, &req, None).await.unwrap();

    let now_ms = Utc::now().timestamp_millis();
    let ttl_ms = issued.expires_at_unix_ms - now_ms;
    // TTL should be around 5000 ms, not 30000 ms
    assert!(ttl_ms <= 6000);
}

#[tokio::test]
async fn test_paired_media_control_connection_and_cancellation() {
    let mgr = AttachmentManager::new();
    let adm = BrowserAdmission {
        principal: "admin".to_string(),
        is_dev: false,
        session_id: Some("sid1".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };

    let req_media = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some("s1".to_string()),
        viewer_id: Some("viewer-pair".to_string()),
        subscription_epoch: Some("sub-pair".to_string()),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    };
    let req_control = IssueTicketRequest {
        purpose: AttachmentPurpose::Control,
        browser_session_id: Some("s1".to_string()),
        viewer_id: Some("viewer-pair".to_string()),
        subscription_epoch: Some("sub-pair".to_string()),
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    };

    let t_m = mgr.issue_ticket(&adm, &req_media, None).await.unwrap();
    let t_c = mgr.issue_ticket(&adm, &req_control, None).await.unwrap();

    let adm_m = mgr.consume_ticket(&t_m.ticket, AttachmentPurpose::Media, None).await.unwrap();
    let adm_c = mgr.consume_ticket(&t_c.ticket, AttachmentPurpose::Control, None).await.unwrap();

    let (conn_m, cancel_m) = mgr.register_connection(&adm_m).await.unwrap();
    let (_conn_c, cancel_c) = mgr.register_connection(&adm_c).await.unwrap();

    assert!(!cancel_m.is_cancelled());
    assert!(!cancel_c.is_cancelled());

    // Unregistering media connection cancels pair
    mgr.unregister_connection(conn_m).await;
    assert!(cancel_m.is_cancelled());
    assert!(cancel_c.is_cancelled());
}

#[tokio::test]
async fn test_targeted_revocation_preserves_sibling_login() {
    let mgr = AttachmentManager::new();
    let adm_session1 = BrowserAdmission {
        principal: "alice".to_string(),
        is_dev: false,
        session_id: Some("login-session-1".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };
    let adm_session2 = BrowserAdmission {
        principal: "alice".to_string(),
        is_dev: false,
        session_id: Some("login-session-2".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };

    let req1 = IssueTicketRequest {
        purpose: AttachmentPurpose::AgentCdp,
        browser_session_id: None,
        viewer_id: None,
        subscription_epoch: None,
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    };
    let req2 = IssueTicketRequest {
        purpose: AttachmentPurpose::AgentCdp,
        browser_session_id: None,
        viewer_id: None,
        subscription_epoch: None,
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    };

    let t1 = mgr.issue_ticket(&adm_session1, &req1, None).await.unwrap();
    let t2 = mgr.issue_ticket(&adm_session2, &req2, None).await.unwrap();

    let c1 = mgr.consume_ticket(&t1.ticket, AttachmentPurpose::AgentCdp, None).await.unwrap();
    let c2 = mgr.consume_ticket(&t2.ticket, AttachmentPurpose::AgentCdp, None).await.unwrap();

    let (_id1, cancel1) = mgr.register_connection(&c1).await.unwrap();
    let (_id2, cancel2) = mgr.register_connection(&c2).await.unwrap();

    // Targeted revoke on session 1
    mgr.revoke_by_auth_session("alice", "login-session-1").await;

    // Session 1 cancelled
    assert!(cancel1.is_cancelled());
    // Sibling session 2 NOT cancelled
    assert!(!cancel2.is_cancelled());
}

#[tokio::test]
async fn test_live_auth_verification_demotion() {
    let tmp = tempdir().unwrap();
    // Admin user initially
    let (auth_service, _token) = make_user_token("live-admin", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));

    let adm = BrowserAdmission {
        principal: "live-admin".to_string(),
        is_dev: false,
        session_id: Some("session-for-live-admin".to_string()),
        auth_version: Some(0),
        credential_version: Some(0),
        effective_deadline: None,
    };

    // Live verification passes
    assert!(verify_live_admission(&state, &adm).await.is_ok());

    // Demoted to ordinary User
    let (demoted_service, _token) = make_user_token("live-admin", UserRole::User, true);
    let demoted_state = state.with_auth_service(Arc::new(demoted_service));

    let res = verify_live_admission(&demoted_state, &adm).await;
    assert_eq!(
        res.unwrap_err(),
        BrowserAuthError::AdminRequired("user was demoted from Admin role".to_string())
    );
}
