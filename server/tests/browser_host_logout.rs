use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use axum::body::{to_bytes, Body};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE};
use axum::http::{Request, StatusCode};
use axum::Router;
use bcrypt::{hash, DEFAULT_COST};
use chrono::{Duration, Utc};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tempfile::{tempdir, TempDir};
use tower::ServiceExt;
use uuid::Uuid;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::router::{build_router_with_origins, parse_cors_origins};
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::{MockClock, AUTH_PROTOCOL_VERSION};
use dam_hopper_server::auth::secret::MfaEncryptionKey;
use dam_hopper_server::auth::{AuthService, AuthStore, Clock};
use dam_hopper_server::browser_debug::{
    ArtifactSource, BrowserSelectionBoundsV1, BrowserSelectionV1,
};
use dam_hopper_server::browser_host::attachments::{AttachmentPurpose, IssueTicketRequest};
use dam_hopper_server::browser_host::auth::BrowserAdmission;
use dam_hopper_server::browser_host::config::BrowserHostConfig;
use dam_hopper_server::browser_host::manager::{BrowserHostManager, ManagerError};
use dam_hopper_server::browser_host::profile::ManagedProfile;
use dam_hopper_server::browser_host::session::{CreateSessionRequest, ViewportRequest};
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
    ServerConfig, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use opaque_ke::ServerSetup;
use tokio_util::sync::CancellationToken;

const TEST_JWT_SECRET: &str = "test-logout-jwt-secret-key-32bytes!";
const DEFAULT_MFA_KEY: [u8; 32] = [0x44u8; 32];

struct LogoutFixture {
    app: Router,
    store: AuthStore,
    clock: Arc<MockClock>,
    state: AppState,
    profile_root: PathBuf,
    _tmp_dir: TempDir,
}

impl LogoutFixture {
    async fn new() -> Self {
        let tmp = tempdir().unwrap();
        let workspace_root = tmp.path().to_path_buf();
        let project_dir = workspace_root.join("test-project");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(project_dir.join("cover.png"), b"\x89PNG\r\n\x1a\n").unwrap();

        let profile_root = workspace_root.join("browser-profiles");
        fs::create_dir_all(&profile_root).unwrap();

        let db_path = workspace_root.join("auth.db");
        let store = AuthStore::open_sqlite(&db_path).await.unwrap();
        store.init_indexes().await.unwrap();

        let (event_sink, _rx) = BroadcastEventSink::new(512);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

        let mut server_cfg = ServerConfig::default();
        server_cfg.browser = BrowserHostConfig {
            enabled: true,
            profile_root: Some(profile_root.clone()),
            ..BrowserHostConfig::default()
        };

        let config = DamHopperConfig {
            workspace: WorkspaceInfo {
                name: "logout-test-ws".into(),
                root: workspace_root.display().to_string(),
            },
            server: server_cfg,
            agent_store: None,
            projects: vec![ProjectConfig {
                name: "test-project".into(),
                path: project_dir.display().to_string(),
                project_type: ProjectType::Custom,
                services: None,
                commands: None,
                env_file: None,
                tags: None,
                terminals: vec![],
                agents: None,
                restart_policy: RestartPolicy::Never,
                restart_max_retries: 0,
                health_check_url: None,
            }],
            features: FeaturesConfig::default(),
            ui: None,
            workspaces: None,
            config_path: workspace_root.join("dam-hopper.toml"),
        };

        let global_config = GlobalConfig::default();
        let agent_store = AgentStoreService::new(workspace_root.join(".dam-hopper/agent-store"));
        let fs_sub = FsSubsystem::new_with_workspace(
            vec![("test-project".into(), project_dir)],
            Some(workspace_root.clone()),
        );
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
            TEST_JWT_SECRET.to_string(),
            fs_sub,
            Some(store.clone()),
            false,
            tunnel_manager,
            None,
            ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
            diagnostics,
        )
        .expect("AppState::new");

        let mfa_key = MfaEncryptionKey::new(DEFAULT_MFA_KEY, "logout-mfa-key");
        let clock = Arc::new(MockClock::new(Utc::now()));
        let auth_service = Arc::new(AuthService::new(
            Some(store.clone()),
            Some(mfa_key),
            clock.clone(),
        ));
        let state = state.with_auth_service(auth_service);
        let origins = parse_cors_origins(Some("http://trusted.example")).unwrap();
        let app = build_router_with_origins(state.clone(), origins);

        Self {
            app,
            store,
            clock,
            state,
            profile_root,
            _tmp_dir: tmp,
        }
    }

    async fn create_user_with_role(&self, username: &str, role: UserRole) {
        let user = UserRecord {
            id: None,
            username: username.to_string(),
            password_hash: hash("password", DEFAULT_COST).unwrap(),
            is_enabled: true,
            role,
            auth_version: 1,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        };
        self.store.create_user(user).await.unwrap();
    }

    async fn create_session(&self, username: &str, expired: bool) -> (AuthSession, String) {
        let now = self.clock.now();
        let (issued_at, expires_at) = if expired {
            (now - Duration::days(30), now - Duration::seconds(1))
        } else {
            (now, now + Duration::days(30))
        };
        let sid = format!("sess-{}", Uuid::new_v4().simple());
        let session = AuthSession {
            id: sid.clone(),
            username: username.to_string(),
            auth_version: 1,
            credential_version: 1,
            issued_at: chrono_to_bson(issued_at),
            expires_at: chrono_to_bson(expires_at),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
            user_agent: None,
        };
        self.store.create_session(session.clone()).await.unwrap();
        let claims = AuthClaims {
            v: AUTH_PROTOCOL_VERSION,
            sub: username.to_string(),
            sid,
            auth_version: 1,
            credential_version: 1,
            iat: issued_at.timestamp() as usize,
            exp: expires_at.timestamp() as usize,
        };
        let token = claims.encode(TEST_JWT_SECRET).unwrap();
        (session, token)
    }

    async fn issue_fs_image_ticket(&self, token: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/fs/image/tickets")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "project": "test-project",
                    "path": "cover.png",
                    "mediaClientId": Uuid::new_v4().to_string(),
                })
                .to_string(),
            ))
            .unwrap();
        let resp = self.app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = to_bytes(resp.into_body(), 65536).await.unwrap();
        let val: Value = serde_json::from_slice(&body).unwrap();
        val["ticket"].as_str().unwrap().to_string()
    }
}

async fn json_body(resp: axum::response::Response) -> Value {
    let bytes = to_bytes(resp.into_body(), 65536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn populate_browser_credentials(profile_root: &std::path::Path, subject: &str) -> PathBuf {
    let profile = ManagedProfile::new(profile_root, subject, false).unwrap();
    profile.load_or_init_metadata().unwrap();
    profile.ensure_user_data_dir().unwrap();
    let cookie_file = profile.user_data_dir().join("Cookies");
    fs::write(&cookie_file, b"shared-site-cookies").unwrap();
    cookie_file
}

#[tokio::test]
async fn legacy_expired_missing_and_stale_confirmation_logout_always_200_revokes_session_first_and_retains_profile(
) {
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-{}", Uuid::new_v4().simple());
    let ordinary = format!("user-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    fx.create_user_with_role(&ordinary, UserRole::User).await;

    let cookie_file = populate_browser_credentials(&fx.profile_root, &admin);
    let (_s_sib, sib_tok) = fx.create_session(&admin, false).await;

    // 1. Legacy empty-body logout revokes initiating session & fs ticket FIRST and retains Browser profile
    let (s1, tok1) = fx.create_session(&admin, false).await;
    let img_ticket1 = fx.issue_fs_image_ticket(&tok1).await;
    let att_mgr = dam_hopper_server::api::browser_host::global_attachment_manager();
    let adm1 = BrowserAdmission {
        principal: admin.clone(),
        is_dev: false,
        session_id: Some(s1.id.clone()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };
    let t_s1 = att_mgr
        .issue_ticket(
            &adm1,
            &IssueTicketRequest {
                purpose: AttachmentPurpose::AgentCdp,
                browser_session_id: None,
                viewer_id: None,
                subscription_epoch: None,
                browser_incarnation: "inc-1".into(),
                profile_epoch: 1,
            },
            None,
        )
        .await
        .unwrap();

    let resp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {tok1}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers()[CACHE_CONTROL], "no-store");
    assert!(resp.headers()[SET_COOKIE]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    let body = json_body(resp).await;
    assert_eq!(body["ok"], true);
    assert_eq!(body["browserResetState"], "retained");
    assert_eq!(body["browserCredentialsRetained"], true);
    assert_eq!(body["resetRequired"], true);
    // Session & fs ticket revoked FIRST; Browser ticket for s1 revoked; sibling & cookies retained
    assert!(fx
        .store
        .get_session(&s1.id)
        .await
        .unwrap()
        .unwrap()
        .revoked_at
        .is_some());
    assert!(fx
        .state
        .image_stream_tickets
        .lookup_and_touch(&img_ticket1)
        .is_none());
    assert!(att_mgr
        .consume_ticket(&t_s1.ticket, AttachmentPurpose::AgentCdp, None)
        .await
        .is_err());
    assert!(cookie_file.exists());

    // 2. Expired token logout even with confirmed reset fields returns 200 unknown, never wipes or leaks metadata
    let (_s_exp, exp_tok) = fx.create_session(&admin, true).await;
    let resp_exp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {exp_tok}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "browserReset": true,
                        "confirmed": true,
                        "expectedProfileEpoch": 1,
                        "operationId": "op-expired-attempt",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_exp.status(), StatusCode::OK);
    let body_exp = json_body(resp_exp).await;
    assert_eq!(body_exp["browserResetState"], "unknown");
    assert_eq!(body_exp["browserCredentialsRetained"], true);
    assert_eq!(body_exp["resetRequired"], true);
    assert!(body_exp.get("profileEpoch").is_none());
    assert!(cookie_file.exists());

    // 3. Ordinary non-Admin user logout returns 200 unknown, revokes own session, never leaks metadata or wipes
    let (s_ord, ord_tok) = fx.create_session(&ordinary, false).await;
    let resp_ord = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {ord_tok}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "browserReset": true,
                        "confirmed": true,
                        "expectedProfileEpoch": 1,
                        "operationId": "op-ordinary-attempt",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_ord.status(), StatusCode::OK);
    let body_ord = json_body(resp_ord).await;
    assert_eq!(body_ord["browserResetState"], "unknown");
    assert_eq!(body_ord["browserCredentialsRetained"], true);
    assert_eq!(body_ord["resetRequired"], true);
    assert!(body_ord.get("profileEpoch").is_none());
    assert!(fx
        .store
        .get_session(&s_ord.id)
        .await
        .unwrap()
        .unwrap()
        .revoked_at
        .is_some());
    assert!(cookie_file.exists());

    // 4. Live Admin with missing confirmation, malformed JSON, Origin-less cookie CSRF, or stale epoch:
    // always 200 OK, revokes session & media ticket FIRST, retains Browser credentials
    let scenarios = vec![
        (
            "missing-confirmed",
            false,
            None,
            json!({ "browserReset": true, "expectedProfileEpoch": 1, "operationId": "op-no-conf" }).to_string(),
        ),
        ("malformed-json", false, None, "{bad json".to_string()),
        (
            "stale-epoch",
            false,
            None,
            json!({ "browserReset": true, "confirmed": true, "expectedProfileEpoch": 99, "operationId": "op-stale" }).to_string(),
        ),
        (
            "cookie-without-origin-csrf",
            true,
            None,
            json!({ "browserReset": true, "confirmed": true, "expectedProfileEpoch": 1, "operationId": "op-csrf-cookie" }).to_string(),
        ),
        (
            "evil-origin",
            false,
            Some("https://evil.example"),
            json!({ "browserReset": true, "confirmed": true, "expectedProfileEpoch": 1, "operationId": "op-evil-origin" }).to_string(),
        ),
    ];

    for (label, cookie_only, origin, payload) in scenarios {
        let (sess, tok) = fx.create_session(&admin, false).await;
        let media_t = fx.issue_fs_image_ticket(&tok).await;
        let mut builder = Request::builder()
            .method("POST")
            .uri("/api/auth/logout")
            .header(CONTENT_TYPE, "application/json");
        if cookie_only {
            builder = builder.header(COOKIE, format!("damhopper-auth={tok}"));
        } else {
            builder = builder.header(AUTHORIZATION, format!("Bearer {tok}"));
        }
        if let Some(orig) = origin {
            builder = builder.header(ORIGIN, orig);
        }
        let resp = fx
            .app
            .clone()
            .oneshot(builder.body(Body::from(payload)).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "{label}");
        let body = json_body(resp).await;
        assert_eq!(
            body["browserCredentialsRetained"], true,
            "{label}: must retain credentials"
        );
        assert_eq!(body["resetRequired"], true, "{label}");
        assert_ne!(body["browserResetState"], "cleared", "{label}");
        assert!(
            fx.store
                .get_session(&sess.id)
                .await
                .unwrap()
                .unwrap()
                .revoked_at
                .is_some(),
            "{label}: session must be revoked first"
        );
        assert!(
            fx.state
                .image_stream_tickets
                .lookup_and_touch(&media_t)
                .is_none(),
            "{label}: media ticket must be revoked first"
        );
        assert!(cookie_file.exists(), "{label}: cookies must NOT be wiped");
    }

    // 5. Dedicated /api/browser/profile/reset rejects stale epoch with 409 and preserves login
    let stale_reset = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/browser/profile/reset")
                .header(AUTHORIZATION, format!("Bearer {sib_tok}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "operationId": "op-direct-stale",
                        "expectedProfileEpoch": 99,
                        "confirmed": true,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_reset.status(), StatusCode::CONFLICT);
    assert!(cookie_file.exists());
    let still_authed = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/sessions")
                .header(AUTHORIZATION, format!("Bearer {sib_tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(still_authed.status(), StatusCode::OK);
}

#[tokio::test]
async fn confirmed_live_admin_logout_wipes_profile_fences_sibling_resources_and_preserves_sibling_login(
) {
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-wipe-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let cookie_file = populate_browser_credentials(&fx.profile_root, &admin);

    let (s1, tok1) = fx.create_session(&admin, false).await;
    let (s2, tok2) = fx.create_session(&admin, false).await;

    // Seed shared Browser session, attachments for s1 and s2, and ManagedBrowser artifact
    let sess_reg = dam_hopper_server::api::browser_host::global_session_registry();
    let (b_sess, _) = sess_reg
        .insert_running_for_test(
            &admin,
            false,
            &Uuid::new_v4().to_string(),
            1,
            &CreateSessionRequest {
                creation_key: Uuid::new_v4().to_string(),
                url: "http://trusted.example/app".to_string(),
                viewport: ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[String::from("http://trusted.example")],
        )
        .await
        .unwrap();

    let att_mgr = dam_hopper_server::api::browser_host::global_attachment_manager();
    let adm2 = BrowserAdmission {
        principal: admin.clone(),
        is_dev: false,
        session_id: Some(s2.id.clone()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };
    let sib_ticket = att_mgr
        .issue_ticket(
            &adm2,
            &IssueTicketRequest {
                purpose: AttachmentPurpose::Media,
                browser_session_id: Some(b_sess.browser_session_id.clone()),
                viewer_id: Some("viewer-sib".into()),
                subscription_epoch: Some("sub-sib".into()),
                browser_incarnation: b_sess.browser_incarnation.clone(),
                profile_epoch: 1,
            },
            Some("http://trusted.example"),
        )
        .await
        .unwrap();
    let adm_sib_consume = att_mgr
        .issue_ticket(
            &adm2,
            &IssueTicketRequest {
                purpose: AttachmentPurpose::AgentCdp,
                browser_session_id: None,
                viewer_id: None,
                subscription_epoch: None,
                browser_incarnation: b_sess.browser_incarnation.clone(),
                profile_epoch: 1,
            },
            Some("http://trusted.example"),
        )
        .await
        .unwrap();
    let consumed = att_mgr
        .consume_ticket(
            &adm_sib_consume.ticket,
            AttachmentPurpose::AgentCdp,
            Some("http://trusted.example"),
        )
        .await
        .unwrap();
    let (_conn_id, sib_cancel) = att_mgr.register_connection(&consumed).await.unwrap();

    let artifact = fx
        .state
        .browser_debug_artifacts
        .create(
            admin.clone(),
            ArtifactSource::ManagedBrowser {
                principal: admin.clone(),
                profile_epoch: 1,
                browser_incarnation: "inc-1".into(),
            },
            "term-1".into(),
            1,
            BrowserSelectionV1 {
                version: 1,
                tag: "button".into(),
                role: Some("button".into()),
                accessible_name: Some("Go".into()),
                text: Some("Go".into()),
                attributes: Default::default(),
                locator: "button".into(),
                bounds: BrowserSelectionBoundsV1 {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                },
            },
        )
        .await
        .unwrap();

    // Confirmed logout via allowed Origin + Cookie (or Bearer)
    let resp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(COOKIE, format!("damhopper-auth={tok1}"))
                .header(ORIGIN, "http://trusted.example")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "browserReset": true,
                        "confirmed": true,
                        "expectedProfileEpoch": 1,
                        "operationId": "op-confirmed-logout-1",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers()[SET_COOKIE]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    let body = json_body(resp).await;
    assert_eq!(body["browserResetState"], "cleared");
    assert_eq!(body["browserCredentialsRetained"], false);
    assert_eq!(body["resetRequired"], false);
    assert_eq!(body["profileEpoch"], 2);

    // 1. User-data cookies deleted and user-data recreated empty; manager files preserved
    assert!(!cookie_file.exists());
    let profile = ManagedProfile::new(&fx.profile_root, &admin, false).unwrap();
    assert!(profile.user_data_dir().is_dir());
    assert_eq!(fs::read_dir(profile.user_data_dir()).unwrap().count(), 0);
    assert!(profile.lock_file().exists());
    assert!(profile.metadata_file().exists());
    assert_eq!(profile.load_or_init_metadata().unwrap().profile_epoch, 2);

    // 2. Shared Browser session, sibling Browser attachment/ticket, and ManagedBrowser artifact fenced & revoked
    assert!(sib_cancel.is_cancelled());
    assert!(att_mgr
        .consume_ticket(
            &sib_ticket.ticket,
            AttachmentPurpose::Media,
            Some("http://trusted.example")
        )
        .await
        .is_err());
    let closed_b_sess = sess_reg
        .get_session(&b_sess.browser_session_id, &admin)
        .await
        .unwrap();
    assert_eq!(closed_b_sess.status, "closed");
    assert!(!closed_b_sess.input_available);
    assert!(sess_reg.list_sessions(&admin).await.is_empty());
    let actor_admin = dam_hopper_server::api::auth::AuthenticatedActor::with_session(
        &admin,
        None,
        &s2.id,
        1,
        1,
        fx.clock.now() + Duration::days(30),
        UserRole::Admin,
    );
    assert!(fx
        .state
        .browser_debug_artifacts
        .upload_png(
            Uuid::parse_str(&artifact.artifact_id).unwrap(),
            &actor_admin,
            axum::body::Bytes::from_static(b"\x89PNG\r\n\x1a\n"),
        )
        .await
        .is_err());
    // 3. Initiating login s1 is revoked, sibling DamHopper login s2 remains valid
    assert!(fx
        .store
        .get_session(&s1.id)
        .await
        .unwrap()
        .unwrap()
        .revoked_at
        .is_some());
    let sib_check = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/sessions")
                .header(AUTHORIZATION, format!("Bearer {tok2}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(sib_check.status(), StatusCode::OK);
}

#[tokio::test]
async fn slow_or_failed_cleanup_returns_within_2s_with_cleanup_pending_survives_restart_and_status_requires_reauth(
) {
    // Part A: Slow background cleanup (>2s) returns 200 cleanupPending within 2s and completes asynchronously
    let fx = LogoutFixture::new().await;
    let admin_slow = format!("admin-slow-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin_slow, UserRole::Admin).await;
    let slow_cookie = populate_browser_credentials(&fx.profile_root, &admin_slow);
    let (_s1, tok1) = fx.create_session(&admin_slow, false).await;
    let (_s2, tok2) = fx.create_session(&admin_slow, false).await;

    fx.state
        .browser_host
        ._simulated_reset_delay_ms
        .store(2500, Ordering::SeqCst);

    let start = Instant::now();
    let resp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {tok1}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "browserReset": true,
                        "confirmed": true,
                        "expectedProfileEpoch": 1,
                        "operationId": "op-slow-reset-1",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let elapsed = start.elapsed();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(
        elapsed.as_millis() < 2450,
        "logout must respond within ~2s with cleanupPending when worker continues, took {:?}",
        elapsed
    );
    let body = json_body(resp).await;
    assert_eq!(body["browserResetState"], "cleanupPending");
    assert_eq!(body["browserCredentialsRetained"], true);
    assert_eq!(body["resetRequired"], true);
    assert_eq!(body["profileEpoch"], 2);
    assert_eq!(body["operationId"], "op-slow-reset-1");

    // Revoked logout token cannot query destructive status
    let revoked_status = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/browser/profile/reset/op-slow-reset-1")
                .header(AUTHORIZATION, format!("Bearer {tok1}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked_status.status(), StatusCode::UNAUTHORIZED);

    // Reauthenticated session observes cleanupPending then completed once worker finishes
    let pending_status = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/browser/profile/reset/op-slow-reset-1")
                .header(AUTHORIZATION, format!("Bearer {tok2}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pending_status.status(), StatusCode::OK);
    assert_eq!(json_body(pending_status).await["status"], "cleanupPending");

    fx.state
        .browser_host
        ._simulated_reset_delay_ms
        .store(0, Ordering::SeqCst);
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;

    let done_status = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/browser/profile/reset/op-slow-reset-1")
                .header(AUTHORIZATION, format!("Bearer {tok2}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(done_status.status(), StatusCode::OK);
    let done_body = json_body(done_status).await;
    assert_eq!(done_body["status"], "completed");
    assert_eq!(done_body["profileEpoch"], 2);
    assert!(!slow_cookie.exists());

    // Part B: Kill failure persists cleanupPending across restart, blocks relaunch, and retries idempotently
    let admin_fail = format!("admin-fail-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin_fail, UserRole::Admin).await;
    let fail_cookie = populate_browser_credentials(&fx.profile_root, &admin_fail);
    let (_sf1, fail_tok1) = fx.create_session(&admin_fail, false).await;
    let (_sf2, fail_tok2) = fx.create_session(&admin_fail, false).await;

    fx.state
        .browser_host
        ._simulated_reset_kill_failure
        .store(true, Ordering::SeqCst);
    let fail_logout = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {fail_tok1}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "browserReset": true,
                        "confirmed": true,
                        "expectedProfileEpoch": 1,
                        "operationId": "op-fail-reset-1",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fail_logout.status(), StatusCode::OK);
    let fail_body = json_body(fail_logout).await;
    assert_eq!(fail_body["browserResetState"], "cleanupPending");
    assert_eq!(fail_body["browserCredentialsRetained"], true);
    assert_eq!(fail_body["resetRequired"], true);
    assert!(fail_cookie.exists());

    // Restarted manager sees CleanupPending and blocks dirty relaunch
    let mut restarted_cfg = BrowserHostConfig::default();
    restarted_cfg.enabled = true;
    restarted_cfg.profile_root = Some(fx.profile_root.clone());
    let restarted = BrowserHostManager::new(
        restarted_cfg,
        Some(fx.profile_root.clone()),
        CancellationToken::new(),
    );
    assert!(!restarted.capabilities(&admin_fail, false).await.available);
    assert!(matches!(
        restarted.ensure_running(&admin_fail, false).await,
        Err(ManagerError::CleanupPending(_))
    ));

    // Retry via dedicated /api/browser/profile/reset while fault cleared -> completes without double epoch increment
    fx.state
        .browser_host
        ._simulated_reset_kill_failure
        .store(false, Ordering::SeqCst);

    let retry_reset = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/browser/profile/reset")
                .header(AUTHORIZATION, format!("Bearer {fail_tok2}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "operationId": "op-fail-reset-1",
                        "expectedProfileEpoch": 1,
                        "confirmed": true,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(retry_reset.status(), StatusCode::OK);
    let retry_body = json_body(retry_reset).await;
    assert_eq!(retry_body["status"], "completed");
    assert_eq!(retry_body["profileEpoch"], 2);
    assert!(!fail_cookie.exists());

    // Same operation replay is idempotent
    let replay_reset = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/browser/profile/reset")
                .header(AUTHORIZATION, format!("Bearer {fail_tok2}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "operationId": "op-fail-reset-1",
                        "expectedProfileEpoch": 1,
                        "confirmed": true,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay_reset.status(), StatusCode::OK);
    assert_eq!(json_body(replay_reset).await["profileEpoch"], 2);
}

#[tokio::test]
async fn admin_absent_profile_keep_data_reports_cleared_without_creating_profile() {
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-absent-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let (_s1, tok1) = fx.create_session(&admin, false).await;

    let resp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {tok1}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "browserReset": false }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = json_body(resp).await;
    assert_eq!(body["browserResetState"], "cleared");
    assert_eq!(body["browserCredentialsRetained"], false);
    assert_eq!(body["resetRequired"], false);

    let profile = ManagedProfile::new(&fx.profile_root, &admin, false).unwrap();
    assert!(!profile.user_data_dir().exists());
}

#[tokio::test]
async fn demotion_under_principal_lock_aborts_reset_before_tombstone_or_epoch() {
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-demote-lock-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;

    let profile = ManagedProfile::new(&fx.profile_root, &admin, false).unwrap();
    let meta = profile.load_or_init_metadata().unwrap();
    profile.save_metadata(&meta).unwrap();
    let hooks = dam_hopper_server::browser_host::manager::ResetFenceHooks {
        recheck_admin: Some(Arc::new(|| Box::pin(async { false }))),
        sync_fence: None,
        async_teardown: None,
    };

    let res = fx
        .state
        .browser_host
        .reset_profile_with_hooks(&admin, false, "op-demoted-lock", 1, hooks)
        .await;
    assert!(matches!(res, Err(ManagerError::PermissionDenied(_))));
    assert!(!profile.reset_file().exists());
    let meta = profile.load_or_init_metadata().unwrap();
    assert_eq!(meta.profile_epoch, 1);
}

#[tokio::test]
async fn stalled_cdp_teardown_does_not_delay_reset_past_2s_and_completes_worker() {
    use futures_util::StreamExt;
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-stalled-cdp-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let (_s1, tok1) = fx.create_session(&admin, false).await;

    let profile = ManagedProfile::new(&fx.profile_root, &admin, false).unwrap();
    fs::create_dir_all(profile.user_data_dir()).unwrap();
    fs::write(profile.user_data_dir().join("Cookies"), b"cookie-bytes").unwrap();
    let mut meta = profile.load_or_init_metadata().unwrap();
    meta.browser_incarnation = Some("inc-stalled".into());
    profile.save_metadata(&meta).unwrap();
    // Start a real WebSocket CDP server that accepts commands and NEVER replies to close/stop
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let ws_url = format!("ws://127.0.0.1:{port}/devtools/browser/stalled");
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            if let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await {
                while let Some(Ok(_)) = ws.next().await {
                    // Intentionally stall forever without replying to Target.closeTarget
                }
            }
        }
    });

    let cdp = dam_hopper_server::browser_host::cdp::CdpClient::connect(&ws_url)
        .await
        .unwrap();
    let (sess_dto, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .insert_running_for_test(
            &admin,
            false,
            "inc-stalled",
            1,
            &CreateSessionRequest {
                creation_key: Uuid::new_v4().to_string(),
                url: "https://example.com".into(),
                viewport: ViewportRequest {
                    width: 1280,
                    height: 800,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();
    let producer = Arc::new(
        dam_hopper_server::browser_host::screencast::ScreencastProducer::new(
            sess_dto.browser_session_id.clone(),
            "inc-stalled".into(),
            1,
            1,
            cdp,
            "native-target-stalled".into(),
            sess_dto.geometry,
        ),
    );
    dam_hopper_server::api::browser_host::get_or_register_producer(
        &sess_dto.browser_session_id,
        producer,
    )
    .await;

    let started = Instant::now();
    let resp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {tok1}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "browserReset": true,
                        "confirmed": true,
                        "expectedProfileEpoch": 1,
                        "operationId": "op-stalled-cdp-1"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let elapsed = started.elapsed();
    assert_eq!(resp.status(), StatusCode::OK);
    // Must bound post-intent wait to ~2s despite stalled CDP producer teardown (never 5s+ CDP timeout)
    assert!(
        elapsed < std::time::Duration::from_millis(2600),
        "logout took too long behind stalled CDP: {elapsed:?}"
    );
    let body = json_body(resp).await;
    assert!(
        body["browserResetState"] == "cleanupPending" || body["browserResetState"] == "cleared",
        "unexpected state: {body:?}"
    );

    // Worker completes cleanup independently once bounded teardown times out
    let (_s2, tok2) = fx.create_session(&admin, false).await;
    let mut completed = false;
    for _ in 0..25 {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let st = fx
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/browser/profile/reset/op-stalled-cdp-1")
                    .header(AUTHORIZATION, format!("Bearer {tok2}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        if st.status() == StatusCode::OK {
            let sb = json_body(st).await;
            if sb["status"] == "completed" {
                completed = true;
                break;
            }
        }
    }
    assert!(
        completed,
        "background reset worker never completed after stalled CDP teardown"
    );
    assert!(!profile.user_data_dir().join("Cookies").exists());
    assert_eq!(fs::read_dir(profile.user_data_dir()).unwrap().count(), 0);
}

#[tokio::test]
async fn session_revocation_failure_reports_revocation_uncertain_on_logout() {
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-revoke-fail-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let (_s1, tok1) = fx.create_session(&admin, false).await;

    // Inject SQLite BEFORE UPDATE trigger so evaluate_claims succeeds while revoke_session fails
    let conn = rusqlite::Connection::open(fx._tmp_dir.path().join("auth.db")).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_session_revoke BEFORE UPDATE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'simulated revoke failure'); END;",
    )
    .unwrap();

    let resp = fx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {tok1}"))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "browserReset": false }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = json_body(resp).await;
    assert_eq!(body["ok"], true);
    assert_eq!(body["sessionRevoked"], false);
    assert_eq!(body["revocationUncertain"], true);
    assert_eq!(body["browserResetState"], "cleared");
}

#[tokio::test]
async fn stalled_sync_fence_returns_cleanup_pending_within_2s_and_aborted_caller_completes_worker()
{
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-stalled-sync-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let profile = ManagedProfile::new(&fx.profile_root, &admin, false).unwrap();
    profile.recreate_user_data().unwrap();
    fs::write(profile.user_data_dir().join("Cookies"), b"secret-cookie").unwrap();

    let gate = Arc::new(tokio::sync::Notify::new());
    let entered = Arc::new(tokio::sync::Notify::new());
    let gate_c = gate.clone();
    let entered_c = entered.clone();
    let hooks = dam_hopper_server::browser_host::manager::ResetFenceHooks {
        recheck_admin: None,
        sync_fence: Some(Arc::new(move || {
            let g = gate_c.clone();
            let e = entered_c.clone();
            Box::pin(async move {
                e.notify_one();
                g.notified().await;
            })
        })),
        async_teardown: None,
    };

    // 1. Spawn reset call and abort caller task as soon as sync_fence enters -> worker must stay alive
    let mgr = fx.state.browser_host.clone();
    let adm_clone = admin.clone();
    let reset_handle = tokio::spawn(async move {
        mgr.reset_profile_with_hooks(&adm_clone, false, "op-stalled-sync-1", 1, hooks)
            .await
    });
    entered.notified().await;
    reset_handle.abort();
    let _ = reset_handle.await;

    // Another attempt for same opId while sync_fence is still blocked returns CleanupPending within ~2s!
    let start = std::time::Instant::now();
    let res2 = fx
        .state
        .browser_host
        .reset_profile_with_hooks(
            &admin,
            false,
            "op-stalled-sync-1",
            1,
            dam_hopper_server::browser_host::manager::ResetFenceHooks::default(),
        )
        .await
        .unwrap();
    assert!(
        start.elapsed() < std::time::Duration::from_secs(4),
        "stalled sync_fence delayed response past bound: {:?}",
        start.elapsed()
    );
    assert!(matches!(
        res2,
        dam_hopper_server::browser_host::manager::ResetOutcome::CleanupPending { .. }
    ));

    // Release sync_fence -> worker spawned by aborted caller completes cleanup!
    gate.notify_waiters();
    let mut completed = false;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let st = fx
            .state
            .browser_host
            .get_reset_status(&admin, false, "op-stalled-sync-1")
            .await
            .unwrap();
        if matches!(
            st,
            dam_hopper_server::browser_host::manager::ResetStatus::Completed { .. }
        ) {
            completed = true;
            break;
        }
    }
    assert!(completed, "worker owned by aborted caller never completed");
    assert!(!profile.user_data_dir().join("Cookies").exists());
}

async fn post_logout(fx: &LogoutFixture, headers: &[(&str, String)], body: Option<Value>) -> Value {
    let mut builder = Request::builder().method("POST").uri("/api/auth/logout");
    for (name, value) in headers {
        builder = builder.header(*name, value);
    }
    let req = match body {
        Some(b) => builder
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string())),
        None => builder.body(Body::empty()),
    }
    .unwrap();
    let resp = fx.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    json_body(resp).await
}

async fn token_authenticates(fx: &LogoutFixture, token: &str) -> bool {
    fx.app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/sessions")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
        == StatusCode::OK
}

#[tokio::test]
async fn anonymous_or_cookie_only_logout_never_confirms_revocation_of_an_unsent_saved_bearer_token()
{
    let fx = LogoutFixture::new().await;
    let user = format!("user-l1-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&user, UserRole::User).await;
    let (saved_session, saved_token) = fx.create_session(&user, false).await;
    let (cookie_session, cookie_token) = fx.create_session(&user, false).await;

    // The client deliberately does not send its saved Bearer over cleartext HTTP, and has no
    // cookie: a public, uncredentialed logout. Nothing is identified, nothing is revoked, and
    // the server must not claim otherwise.
    let anon = post_logout(&fx, &[], Some(json!({ "browserReset": false }))).await;
    assert_eq!(anon["ok"], true);
    assert_eq!(anon["sessionRevoked"], false);
    assert_eq!(anon["sessionIdentified"], false);
    assert!(fx
        .store
        .get_session(&saved_session.id)
        .await
        .unwrap()
        .unwrap()
        .revoked_at
        .is_none());
    assert!(
        token_authenticates(&fx, &saved_token).await,
        "saved token is still valid"
    );

    // Cookie-only logout reports the cookie's own session, not the unsent saved token.
    let cookie_only = post_logout(
        &fx,
        &[(COOKIE.as_str(), format!("damhopper-auth={cookie_token}"))],
        Some(json!({ "browserReset": false })),
    )
    .await;
    assert_eq!(cookie_only["sessionRevoked"], true);
    assert_eq!(cookie_only["sessionIdentified"], true);
    assert!(fx
        .store
        .get_session(&cookie_session.id)
        .await
        .unwrap()
        .unwrap()
        .revoked_at
        .is_some());
    assert!(
        fx.store
            .get_session(&saved_session.id)
            .await
            .unwrap()
            .unwrap()
            .revoked_at
            .is_none(),
        "unsent saved token session must remain active"
    );
    assert!(token_authenticates(&fx, &saved_token).await);

    // A request that actually carries the credential identifies and revokes exactly it.
    let bearer = post_logout(
        &fx,
        &[(AUTHORIZATION.as_str(), format!("Bearer {saved_token}"))],
        Some(json!({ "browserReset": false })),
    )
    .await;
    assert_eq!(bearer["sessionRevoked"], true);
    assert_eq!(bearer["sessionIdentified"], true);
    assert_eq!(bearer["revocationUncertain"], false);
    assert!(!token_authenticates(&fx, &saved_token).await);
}

#[cfg(unix)]
#[tokio::test]
async fn denied_artifact_unlink_keeps_confirmed_reset_pending_until_private_files_are_gone() {
    use std::os::unix::fs::PermissionsExt;
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-s3-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let cookie_file = populate_browser_credentials(&fx.profile_root, &admin);
    let (_s1, tok1) = fx.create_session(&admin, false).await;

    let artifact = fx
        .state
        .browser_debug_artifacts
        .create(
            admin.clone(),
            ArtifactSource::ManagedBrowser {
                principal: admin.clone(),
                profile_epoch: 1,
                browser_incarnation: "inc-1".into(),
            },
            "term-s3".into(),
            1,
            BrowserSelectionV1 {
                version: 1,
                tag: "button".into(),
                role: None,
                accessible_name: None,
                text: Some("Go".into()),
                attributes: Default::default(),
                locator: "button".into(),
                bounds: BrowserSelectionBoundsV1 {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                },
            },
        )
        .await
        .unwrap();
    let artifact_dir = std::path::Path::new(&artifact.json_path)
        .parent()
        .unwrap()
        .to_path_buf();
    let charged = fx.state.browser_debug_artifacts.reserved_bytes();
    assert!(charged > 0);

    fs::set_permissions(&artifact_dir, fs::Permissions::from_mode(0o500)).unwrap();
    assert!(
        fs::File::create(artifact_dir.join("probe-denied")).is_err(),
        "test requires a non-root user so a read-only directory denies unlink"
    );

    let body = post_logout(
        &fx,
        &[
            (COOKIE.as_str(), format!("damhopper-auth={tok1}")),
            (ORIGIN.as_str(), "http://trusted.example".to_string()),
        ],
        Some(json!({
            "browserReset": true,
            "confirmed": true,
            "expectedProfileEpoch": 1,
            "operationId": "op-denied-unlink-1",
        })),
    )
    .await;
    // The reset must not be reported complete while a private artifact file remains.
    assert_eq!(body["browserResetState"], "cleanupPending", "{body}");
    assert_eq!(body["browserCredentialsRetained"], true);
    assert_eq!(body["resetRequired"], true);
    assert!(Path::new(&artifact.json_path).exists());
    assert_eq!(fx.state.browser_debug_artifacts.pending_cleanup_count(), 1);
    assert_eq!(fx.state.browser_debug_artifacts.reserved_bytes(), charged);
    assert!(
        cookie_file.exists(),
        "profile deletion must not start before the purge is clean"
    );
    assert!(matches!(
        fx.state
            .browser_host
            .get_reset_status(&admin, false, "op-denied-unlink-1")
            .await
            .unwrap(),
        dam_hopper_server::browser_host::manager::ResetStatus::CleanupPending { .. }
    ));

    // Permission restored: the retained cleanup is retried and only then does the reset finish.
    fs::set_permissions(&artifact_dir, fs::Permissions::from_mode(0o700)).unwrap();
    let mut completed = false;
    for _ in 0..80 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if matches!(
            fx.state
                .browser_host
                .get_reset_status(&admin, false, "op-denied-unlink-1")
                .await
                .unwrap(),
            dam_hopper_server::browser_host::manager::ResetStatus::Completed { .. }
        ) {
            completed = true;
            break;
        }
    }
    assert!(
        completed,
        "reset never completed after the unlink became possible"
    );
    assert!(!Path::new(&artifact.json_path).exists());
    assert_eq!(fx.state.browser_debug_artifacts.pending_cleanup_count(), 0);
    assert_eq!(fx.state.browser_debug_artifacts.reserved_bytes(), 0);
    assert!(!cookie_file.exists());
}

/// A managed writer that started before the reset fence has persisted its private file but not
/// published it: the file is in neither the entry map nor the pending set. The reset must not
/// complete (nor delete the profile) until that writer has cleaned up after itself.
#[cfg(unix)]
#[tokio::test]
async fn reset_waits_for_an_unpublished_artifact_writer_started_before_its_fence() {
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-s3w-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let cookie_file = populate_browser_credentials(&fx.profile_root, &admin);
    let (_s1, tok1) = fx.create_session(&admin, false).await;

    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = std::sync::Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let hook_gate = gate.clone();
    struct OpenOnDrop(std::sync::Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);
    impl Drop for OpenOnDrop {
        fn drop(&mut self) {
            let (lock, cvar) = &*self.0;
            *lock.lock().unwrap() = true;
            cvar.notify_all();
        }
    }
    let _open = OpenOnDrop(gate.clone());
    *fx.state
        .browser_debug_artifacts
        ._after_persist_before_publish_hook
        .write()
        .unwrap() = Some(std::sync::Arc::new(move || {
        let _ = entered_tx.send(());
        let (lock, cvar) = &*hook_gate;
        let mut open = lock.lock().unwrap();
        while !*open {
            open = cvar.wait(open).unwrap();
        }
    }));
    let writer = {
        let artifacts = fx.state.browser_debug_artifacts.clone();
        let principal = admin.clone();
        tokio::spawn(async move {
            artifacts
                .create(
                    principal.clone(),
                    ArtifactSource::ManagedBrowser {
                        principal,
                        profile_epoch: 1,
                        browser_incarnation: "inc-1".into(),
                    },
                    "term-s3w".into(),
                    1,
                    BrowserSelectionV1 {
                        version: 1,
                        tag: "button".into(),
                        role: None,
                        accessible_name: None,
                        text: Some("Go".into()),
                        attributes: Default::default(),
                        locator: "button".into(),
                        bounds: BrowserSelectionBoundsV1 {
                            x: 0.0,
                            y: 0.0,
                            width: 100.0,
                            height: 40.0,
                        },
                    },
                )
                .await
        })
    };
    tokio::task::spawn_blocking(move || {
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("writer never persisted its file")
    })
    .await
    .unwrap();
    assert!(fx.state.browser_debug_artifacts.reserved_bytes() > 0);

    let body = post_logout(
        &fx,
        &[
            (COOKIE.as_str(), format!("damhopper-auth={tok1}")),
            (ORIGIN.as_str(), "http://trusted.example".to_string()),
        ],
        Some(json!({
            "browserReset": true,
            "confirmed": true,
            "expectedProfileEpoch": 1,
            "operationId": "op-inflight-writer-1",
        })),
    )
    .await;
    assert_eq!(body["browserResetState"], "cleanupPending", "{body}");
    assert!(
        cookie_file.exists(),
        "profile deletion must not start while a pre-fence writer still owns a private file"
    );
    assert!(matches!(
        fx.state
            .browser_host
            .get_reset_status(&admin, false, "op-inflight-writer-1")
            .await
            .unwrap(),
        dam_hopper_server::browser_host::manager::ResetStatus::CleanupPending { .. }
    ));

    // The writer finishes: it sees the fence, removes its own file, and only then can the
    // reset's purge (retried with backoff) complete.
    {
        let (lock, cvar) = &*gate;
        *lock.lock().unwrap() = true;
        cvar.notify_all();
    }
    assert!(
        writer.await.unwrap().is_err(),
        "fenced writer must not publish"
    );
    let mut completed = false;
    for _ in 0..80 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if matches!(
            fx.state
                .browser_host
                .get_reset_status(&admin, false, "op-inflight-writer-1")
                .await
                .unwrap(),
            dam_hopper_server::browser_host::manager::ResetStatus::Completed { .. }
        ) {
            completed = true;
            break;
        }
    }
    assert!(completed, "reset never completed after the writer finished");
    assert_eq!(fx.state.browser_debug_artifacts.pending_cleanup_count(), 0);
    assert_eq!(fx.state.browser_debug_artifacts.reserved_bytes(), 0);
    assert!(!cookie_file.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn denied_artifact_unlink_never_reports_cleared_when_no_browser_profile_exists() {
    use std::os::unix::fs::PermissionsExt;
    let fx = LogoutFixture::new().await;
    let admin = format!("admin-s3-noprofile-{}", Uuid::new_v4().simple());
    fx.create_user_with_role(&admin, UserRole::Admin).await;
    let (_s1, tok1) = fx.create_session(&admin, false).await;
    let artifact = fx
        .state
        .browser_debug_artifacts
        .create(
            admin.clone(),
            ArtifactSource::ManagedBrowser {
                principal: admin.clone(),
                profile_epoch: 1,
                browser_incarnation: "inc-1".into(),
            },
            "term-s3b".into(),
            1,
            BrowserSelectionV1 {
                version: 1,
                tag: "button".into(),
                role: None,
                accessible_name: None,
                text: None,
                attributes: Default::default(),
                locator: "button".into(),
                bounds: BrowserSelectionBoundsV1 {
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                },
            },
        )
        .await
        .unwrap();
    let artifact_dir = Path::new(&artifact.json_path)
        .parent()
        .unwrap()
        .to_path_buf();
    fs::set_permissions(&artifact_dir, fs::Permissions::from_mode(0o500)).unwrap();
    assert!(fs::File::create(artifact_dir.join("probe-denied")).is_err());

    let reset_request = json!({
        "browserReset": true,
        "confirmed": true,
        "expectedProfileEpoch": 1,
        "operationId": "op-no-profile-denied",
    });
    let headers = [
        (COOKIE.as_str(), format!("damhopper-auth={tok1}")),
        (ORIGIN.as_str(), "http://trusted.example".to_string()),
    ];
    let body = post_logout(&fx, &headers, Some(reset_request)).await;
    assert_eq!(body["browserResetState"], "cleanupPending", "{body}");
    assert_eq!(body["resetRequired"], true);
    assert!(Path::new(&artifact.json_path).exists());
    assert_eq!(fx.state.browser_debug_artifacts.pending_cleanup_count(), 1);

    // Once the unlink works, the retained cleanup completes on the next retry (sweeper path).
    fs::set_permissions(&artifact_dir, fs::Permissions::from_mode(0o700)).unwrap();
    fx.state.browser_debug_artifacts.sweep_expired().await;
    assert!(!Path::new(&artifact.json_path).exists());
    assert_eq!(fx.state.browser_debug_artifacts.pending_cleanup_count(), 0);
    assert_eq!(fx.state.browser_debug_artifacts.reserved_bytes(), 0);
}
