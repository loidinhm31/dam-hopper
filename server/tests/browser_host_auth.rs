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
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::browser_host::attachments::{
    AttachmentError, AttachmentManager, AttachmentPurpose, IssueTicketRequest,
    MAX_UNCONSUMED_TICKETS_GLOBAL, MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL,
};
use dam_hopper_server::browser_host::auth::{
    verify_live_admission, BrowserAdmission, BrowserAuthError,
};
use dam_hopper_server::browser_host::media::ViewerPermit;
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
async fn test_rest_issue_ticket_and_consume() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-ticket-tester", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);

    let (sess_dto, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .insert_running_for_test(
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
        "profileEpoch": "1"
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
        &axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap(),
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
    assert_eq!(
        consumed.browser_session_id.as_deref(),
        Some(sess_dto.browser_session_id.as_str())
    );
    assert_eq!(consumed.viewer_id.as_deref(), Some("viewer-uuid-1"));
    assert_eq!(consumed.subscription_epoch.as_deref(), Some("sub-epoch-1"));

    // Replay attempt fails: single-use ticket
    let replay_res = mgr
        .consume_ticket(raw_ticket, AttachmentPurpose::Media, None)
        .await;
    assert_eq!(replay_res.unwrap_err(), AttachmentError::TicketNotFound);
}

/// Ticket issue is bound to the LIVE session identity (Running, exact incarnation and profile
/// epoch, same owner), and a DELETE invalidates every unconsumed ticket of the session.
#[tokio::test]
async fn test_rest_issue_ticket_requires_live_exact_identity_and_delete_invalidates_tickets() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-ticket-live", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    let registry = dam_hopper_server::api::browser_host::global_session_registry();
    let new_session = |principal: &str| {
        let request = dam_hopper_server::browser_host::session::CreateSessionRequest {
            creation_key: uuid::Uuid::new_v4().to_string(),
            url: "about:blank".into(),
            viewport: dam_hopper_server::browser_host::session::ViewportRequest {
                width: 1280,
                height: 900,
                dpr: 1.0,
            },
        };
        let principal = principal.to_string();
        async move {
            registry
                .insert_running_for_test(&principal, false, "inc-live", 1, &request, &[])
                .await
                .unwrap()
                .0
                .browser_session_id
        }
    };
    let session = new_session("admin-ticket-live").await;
    let foreign = new_session("someone-else").await;
    let issue = |session: String, incarnation: &'static str, epoch: &'static str| {
        let app = app.clone();
        let token = token.clone();
        async move {
            let body = json!({
                "purpose": "control", "browserSessionId": session, "viewerId": "v",
                "subscriptionEpoch": "sub", "browserIncarnation": incarnation, "profileEpoch": epoch,
            });
            let req = Request::builder()
                .method("POST")
                .uri("/api/browser/attachments")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap();
            let resp = app.oneshot(req).await.unwrap();
            let status = resp.status();
            let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
            (status, serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null))
        }
    };

    assert_eq!(issue(session.clone(), "inc-stale", "1").await.0, StatusCode::NOT_FOUND, "stale incarnation");
    assert_eq!(issue(session.clone(), "inc-live", "2").await.0, StatusCode::NOT_FOUND, "stale profile epoch");
    assert_eq!(issue(foreign, "inc-live", "1").await.0, StatusCode::NOT_FOUND, "foreign principal's session");
    let (status, body) = issue(session.clone(), "inc-live", "1").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let early_ticket = body["ticket"].as_str().unwrap().to_string();

    // DELETE the session: the unconsumed ticket dies with it ...
    let delete = Request::builder()
        .method("DELETE")
        .uri(format!("/api/browser/sessions/{session}"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let _ = app.clone().oneshot(delete).await.unwrap();
    let mgr = dam_hopper_server::api::browser_host::global_attachment_manager();
    assert_eq!(
        mgr.consume_ticket(&early_ticket, AttachmentPurpose::Control, None).await.unwrap_err(),
        AttachmentError::TicketNotFound,
        "ticket issued before the close must not be consumable after it"
    );
    // ... and a closed session never receives a new one.
    let (status, _) = issue(session, "inc-live", "1").await;
    assert!(
        status == StatusCode::NOT_FOUND || status == StatusCode::CONFLICT,
        "closed session issued a ticket: {status}"
    );
}

/// `profileEpoch` on the ticket wire is a canonical positive decimal string: numbers and
/// non-canonical strings are rejected before any ticket state is touched.
#[tokio::test]
async fn test_issue_ticket_profile_epoch_is_canonical_decimal_string() {
    let tmp = tempdir().unwrap();
    let (auth_service, token) = make_user_token("admin-ticket-epoch", UserRole::Admin, true);
    let state = create_test_state(tmp.path().to_path_buf(), false)
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state, vec![]);
    for bad in [json!(1), json!("0"), json!("01"), json!("-1"), json!("18446744073709551616"), json!(null)] {
        let req = Request::builder()
            .method("POST")
            .uri("/api/browser/attachments")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "purpose": "media",
                    "browserSessionId": "s1",
                    "viewerId": "v1",
                    "subscriptionEpoch": "sub-1",
                    "browserIncarnation": "inc-1",
                    "profileEpoch": bad
                })
                .to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY, "profileEpoch {bad}");
    }
    // u64::MAX is a valid identity: it passes parsing and fails only on session lookup (404).
    let req = Request::builder()
        .method("POST")
        .uri("/api/browser/attachments")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "purpose": "media",
                "browserSessionId": "no-such-session",
                "viewerId": "v1",
                "subscriptionEpoch": "sub-1",
                "browserIncarnation": "inc-1",
                "profileEpoch": "18446744073709551615"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
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
        .consume_ticket(
            &issued.ticket,
            AttachmentPurpose::Control,
            Some("http://localhost:5173"),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        purpose_err,
        AttachmentError::PurposeMismatch { .. }
    ));

    // Re-issue for origin test
    let issued2 = mgr
        .issue_ticket(&adm, &req, Some("http://localhost:5173"))
        .await
        .unwrap();

    // Wrong origin
    let origin_err = mgr
        .consume_ticket(
            &issued2.ticket,
            AttachmentPurpose::Media,
            Some("http://evil.com"),
        )
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

    let adm_m = mgr
        .consume_ticket(&t_m.ticket, AttachmentPurpose::Media, None)
        .await
        .unwrap();
    let adm_c = mgr
        .consume_ticket(&t_c.ticket, AttachmentPurpose::Control, None)
        .await
        .unwrap();

    // Private counter: the process-global ACTIVE_VIEWERS is shared with live handler tests.
    static PAIR_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let media = mgr
        .register_pair_connection(&adm_m, || {
            ViewerPermit::try_acquire_in(&PAIR_COUNTER, 4)
                .map_err(|_| AttachmentError::ViewerCapacityExceeded(4))
        })
        .await
        .unwrap();
    let control = mgr
        .register_pair_connection(&adm_c, || panic!("control joins the pair's permit"))
        .await
        .unwrap();
    assert_eq!(PAIR_COUNTER.load(std::sync::atomic::Ordering::SeqCst), 1, "one permit per pair");

    assert!(!media.cancel_token.is_cancelled());
    assert!(!control.cancel_token.is_cancelled());

    // Unregistering media connection cancels the pair; the pair's permit is returned once the
    // sockets' tasks (which own it) have ended.
    mgr.unregister_connection(media.connection_id).await;
    assert!(media.cancel_token.is_cancelled());
    assert!(control.cancel_token.is_cancelled());
    assert_eq!(PAIR_COUNTER.load(std::sync::atomic::Ordering::SeqCst), 1);
    drop(media);
    assert_eq!(PAIR_COUNTER.load(std::sync::atomic::Ordering::SeqCst), 1, "mate still holds it");
    drop(control);
    assert_eq!(PAIR_COUNTER.load(std::sync::atomic::Ordering::SeqCst), 0);
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

    let c1 = mgr
        .consume_ticket(&t1.ticket, AttachmentPurpose::AgentCdp, None)
        .await
        .unwrap();
    let c2 = mgr
        .consume_ticket(&t2.ticket, AttachmentPurpose::AgentCdp, None)
        .await
        .unwrap();

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

fn agent_request() -> IssueTicketRequest {
    IssueTicketRequest {
        purpose: AttachmentPurpose::AgentCdp,
        browser_session_id: None,
        viewer_id: None,
        subscription_epoch: None,
        browser_incarnation: "inc1".to_string(),
        profile_epoch: 1,
    }
}

fn admission_for(principal: &str, session: &str) -> BrowserAdmission {
    BrowserAdmission {
        principal: principal.to_string(),
        is_dev: false,
        session_id: Some(session.to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    }
}

/// Issues, consumes and registers one supervised agent connection.
async fn register_agent_connection(
    mgr: &AttachmentManager,
    principal: &str,
    session: &str,
) -> tokio_util::sync::CancellationToken {
    let issued = mgr
        .issue_ticket(&admission_for(principal, session), &agent_request(), None)
        .await
        .unwrap();
    let admitted = mgr
        .consume_ticket(&issued.ticket, AttachmentPurpose::AgentCdp, None)
        .await
        .unwrap();
    let (_conn, token) = mgr.register_connection(&admitted).await.unwrap();
    token
}

/// LA:L12 — concurrent issuers never exceed the per-principal or global cap.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_concurrent_ticket_issue_never_exceeds_caps() {
    let mgr = Arc::new(AttachmentManager::new());
    let mut tasks = Vec::new();
    // 6 principals x 20 attempts = 120 concurrent attempts; per-principal cap 16 and global
    // cap 64 mean exactly 64 may succeed (6 x 16 = 96 > 64) and no principal exceeds 16.
    for p in 0..6 {
        for _ in 0..20 {
            let mgr = mgr.clone();
            tasks.push(tokio::spawn(async move {
                let principal = format!("cap-principal-{p}");
                mgr.issue_ticket(&admission_for(&principal, "sid"), &agent_request(), None)
                    .await
                    .map(|_| principal)
            }));
        }
    }
    let mut per_principal = std::collections::HashMap::<String, usize>::new();
    let mut rejected = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(principal) => *per_principal.entry(principal).or_default() += 1,
            Err(err) => {
                assert!(matches!(err, AttachmentError::CapacityExceeded(_)));
                rejected += 1;
            }
        }
    }
    let total: usize = per_principal.values().sum();
    assert_eq!(total, MAX_UNCONSUMED_TICKETS_GLOBAL, "global cap is exact");
    assert_eq!(rejected, 120 - MAX_UNCONSUMED_TICKETS_GLOBAL);
    assert!(per_principal
        .values()
        .all(|n| *n <= MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL));
}

/// LA:L12 — expired tickets never count toward saturation: after a saturated window expires,
/// concurrent issuers are admitted up to the cap again (prune happens under the same lock as
/// the cap check and insert).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_concurrent_ticket_expiry_recovers_saturation_atomically() {
    let mgr = Arc::new(AttachmentManager::new());
    // Saturate globally with tickets clipped to expire in ~700ms by the auth deadline.
    let short = Utc::now() + ChronoDuration::milliseconds(700);
    for p in 0..4 {
        for _ in 0..MAX_UNCONSUMED_TICKETS_PER_PRINCIPAL {
            let mut adm = admission_for(&format!("expiring-{p}"), "sid");
            adm.effective_deadline = Some(short);
            mgr.issue_ticket(&adm, &agent_request(), None)
                .await
                .unwrap();
        }
    }
    let saturated = mgr
        .issue_ticket(&admission_for("fresh", "sid"), &agent_request(), None)
        .await
        .unwrap_err();
    assert!(matches!(saturated, AttachmentError::CapacityExceeded(_)));

    tokio::time::sleep(std::time::Duration::from_millis(900)).await;

    // 8 principals x 8 concurrent issuers = exactly the global cap, all admitted once the
    // expired tickets are pruned.
    let mut tasks = Vec::new();
    for p in 0..8 {
        for _ in 0..8 {
            let mgr = mgr.clone();
            tasks.push(tokio::spawn(async move {
                mgr.issue_ticket(
                    &admission_for(&format!("fresh-{p}"), "sid"),
                    &agent_request(),
                    None,
                )
                .await
            }));
        }
    }
    for task in tasks {
        task.await
            .unwrap()
            .expect("expired tickets must not hold capacity");
    }
    let over = mgr
        .issue_ticket(&admission_for("fresh-extra", "sid"), &agent_request(), None)
        .await
        .unwrap_err();
    assert!(matches!(over, AttachmentError::CapacityExceeded(_)));
}

/// LA:L14 — identity checks are deduplicated, independent and hard-bounded: slow identities
/// are cancelled at `LIVE_CHECK_TIMEOUT` (not serialized), never delay a revoked identity, and a
/// healthy identity with many sockets costs one check.
#[tokio::test]
async fn test_live_check_round_is_deduped_concurrent_and_bounded() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let mgr = Arc::new(AttachmentManager::new());
    let slow: Vec<_> = {
        let mut tokens = Vec::new();
        for i in 0..4 {
            tokens.push(register_agent_connection(&mgr, &format!("slow-{i}"), "sid").await);
        }
        tokens
    };
    let revoked = register_agent_connection(&mgr, "revoked", "sid").await;
    let mut healthy = Vec::new();
    for _ in 0..5 {
        healthy.push(register_agent_connection(&mgr, "healthy", "sid-h").await);
    }

    let healthy_checks = Arc::new(AtomicUsize::new(0));
    let healthy_counter = healthy_checks.clone();
    let round = {
        let mgr = mgr.clone();
        tokio::spawn(async move {
            mgr.run_live_check_round(false, move |adm| {
                let healthy_counter = healthy_counter.clone();
                async move {
                    if adm.principal.starts_with("slow") {
                        // A hung store: never answers.
                        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                        Ok(())
                    } else if adm.principal == "revoked" {
                        Err(BrowserAuthError::SessionRevoked("revoked".to_string()))
                    } else {
                        healthy_counter.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                }
            })
            .await;
        })
    };
    let started = std::time::Instant::now();

    // The revoked identity is cancelled promptly while four hung stores are still pending.
    tokio::time::timeout(std::time::Duration::from_millis(500), revoked.cancelled())
        .await
        .expect("revoked identity must not wait behind slow identity checks");

    round.await.unwrap();
    let elapsed = started.elapsed();
    // Serialized 2s timeouts would take >= 8s for four slow identities.
    assert!(
        elapsed < std::time::Duration::from_millis(3500),
        "round must be bounded by one check timeout, took {elapsed:?}"
    );
    assert!(
        slow.iter().all(|t| t.is_cancelled()),
        "unverifiable identities fail closed"
    );
    assert!(healthy.iter().all(|t| !t.is_cancelled()));
    assert_eq!(
        healthy_checks.load(Ordering::SeqCst),
        1,
        "one check per identity"
    );
}

/// More distinct identities than the concurrency ceiling, against a hung store: queueing for a
/// check slot is inside the one round deadline, so the round (and the revocation window of an
/// identity stuck behind the hung ones) stays one `LIVE_CHECK_TIMEOUT`, never one per batch.
#[tokio::test]
async fn test_live_check_round_with_more_identities_than_capacity_is_one_deadline() {
    let mgr = Arc::new(AttachmentManager::new());
    let mut hung = Vec::new();
    for i in 0..200 {
        hung.push(register_agent_connection(&mgr, &format!("hung-{i}"), "sid").await);
    }
    let revoked = register_agent_connection(&mgr, "revoked", "sid").await;

    let started = std::time::Instant::now();
    mgr.run_live_check_round(false, move |adm| async move {
        if adm.principal.starts_with("hung") {
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
            Ok(())
        } else {
            Err(BrowserAuthError::SessionRevoked("revoked".to_string()))
        }
    })
    .await;
    let elapsed = started.elapsed();

    // Serial batches of 64 hung checks would take >= 4 x 2s.
    assert!(
        elapsed < std::time::Duration::from_millis(3500),
        "round must end at one check deadline, took {elapsed:?}"
    );
    assert!(
        hung.iter().all(|t| t.is_cancelled()),
        "identities that could not be verified in time fail closed"
    );
    assert!(
        revoked.is_cancelled(),
        "the revoked identity queued behind hung checks is cancelled within the round"
    );
}
