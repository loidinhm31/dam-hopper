use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tempfile::tempdir;

use axum::body::Body;
use axum::extract::ws::{Message as AxumWsMsg, WebSocketUpgrade};
use axum::extract::Path as AxumPath;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, ORIGIN};
use axum::http::{HeaderValue, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use bcrypt::{hash, DEFAULT_COST};
use chrono::{Duration as ChronoDuration, Utc};
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message as WsMsg;
use tower::ServiceExt;

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::browser_host::{
    global_attachment_manager, global_input_managers, global_session_registry,
};
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::{AuthService, AuthStore, SystemClock};
use dam_hopper_server::browser_host::attachments::{
    AdmittedAttachment, AttachmentError, AttachmentPurpose, PairRegistration,
};
use dam_hopper_server::browser_host::config::BrowserHostConfig;
use dam_hopper_server::browser_host::manager::BrowserInstanceHandle;
use dam_hopper_server::browser_host::media::ViewerPermit;
use dam_hopper_server::browser_host::session::{
    BindOutcome, CreateParams, CreateReservation, CreateSessionRequest, ViewportRequest,
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
static TEST_SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const JWT_SECRET: &str = "test-jwt-secret-browser-devtools";

fn create_test_state(
    workspace_root: PathBuf,
    auth_store: Option<AuthStore>,
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
    let state = AppState::new(
        workspace_root.clone(),
        config,
        GlobalConfig::default(),
        pty_manager,
        AgentStoreService::new(workspace_root.join(".dam-hopper/agent-store")),
        event_sink,
        JWT_SECRET.to_string(),
        FsSubsystem::new(vec![]),
        auth_store,
        false,
        TunnelSessionManager::new(
            Arc::new(BroadcastEventSink::new(64).0),
            Arc::new(CloudflaredDriver),
        ),
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(workspace_root.join("diagnostics.jsonl")),
    )
    .expect("create AppState");

    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }
    state
}

fn make_user_token(username: &str, role: UserRole) -> (AuthService, String) {
    let now = Utc::now();
    let exp = now + ChronoDuration::days(1);
    let user = UserRecord {
        id: None,
        username: username.to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let sid = format!("sess-{username}");
    let session = AuthSession {
        id: sid.clone(),
        username: username.to_string(),
        auth_version: 1,
        credential_version: 1,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: username.to_string(),
        sid,
        auth_version: 1,
        credential_version: 1,
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };
    let token = claims.encode(JWT_SECRET).unwrap();
    (AuthService::new_mock(user, session), token)
}

async fn setup_sqlite_multi_session(
    root: &std::path::Path,
    username: &str,
    session_ids: &[&str],
) -> (AuthStore, Arc<AuthService>, Vec<String>) {
    let store = AuthStore::open_sqlite(&root.join("auth.db")).await.unwrap();
    store.init_indexes().await.unwrap();
    store
        .create_user(UserRecord {
            id: None,
            username: username.to_string(),
            password_hash: hash("pw", DEFAULT_COST).unwrap(),
            is_enabled: true,
            role: UserRole::Admin,
            auth_version: 1,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        })
        .await
        .unwrap();
    let now = Utc::now();
    let exp = now + ChronoDuration::hours(2);
    let mut tokens = Vec::new();
    for sid in session_ids {
        store
            .create_session(AuthSession {
                id: (*sid).to_string(),
                username: username.to_string(),
                auth_version: 1,
                credential_version: 1,
                issued_at: chrono_to_bson(now),
                expires_at: chrono_to_bson(exp),
                mfa_verified_at: chrono_to_bson(now),
                revoked_at: None,
                user_agent: None,
            })
            .await
            .unwrap();
        tokens.push(
            AuthClaims {
                v: AUTH_PROTOCOL_VERSION,
                sub: username.to_string(),
                sid: (*sid).to_string(),
                auth_version: 1,
                credential_version: 1,
                iat: now.timestamp() as usize,
                exp: exp.timestamp() as usize,
            }
            .encode(JWT_SECRET)
            .unwrap(),
        );
    }
    let service = Arc::new(AuthService::new(
        Some(store.clone()),
        None,
        Arc::new(SystemClock),
    ));
    (store, service, tokens)
}

async fn insert_running_session(
    principal: &str,
    is_dev: bool,
    incarnation: &str,
    target_id: &str,
) -> String {
    let registry = global_session_registry();
    let req = CreateSessionRequest {
        creation_key: uuid::Uuid::new_v4().to_string(),
        url: "about:blank".to_string(),
        viewport: ViewportRequest { width: 1024, height: 768, dpr: 1.0 },
    };
    let CreateReservation::Pending { session_id } = registry
        .reserve_creation(
            &CreateParams {
                principal,
                is_dev,
                browser_incarnation: incarnation,
                profile_epoch: 1,
                request: &req,
                allowed_origins: &[],
                max_targets: usize::MAX,
            },
            &|| true,
        )
        .await
        .unwrap()
    else {
        panic!("expected pending reservation");
    };
    assert_eq!(
        registry.bind_native_target(&session_id, incarnation, target_id).await,
        BindOutcome::Bound
    );
    registry.commit_running(&session_id, &|| true).await.unwrap();
    session_id
}

async fn spawn_mock_chromium_server(
    expected_target_id: String,
) -> (
    u16,
    Arc<Mutex<Vec<String>>>,
    Arc<Mutex<Vec<usize>>>,
    Arc<Mutex<Vec<usize>>>,
) {
    let seen_methods = Arc::new(Mutex::new(Vec::<String>::new()));
    let triggered_connections = Arc::new(Mutex::new(Vec::<usize>::new()));
    let closed_connections = Arc::new(Mutex::new(Vec::<usize>::new()));
    let next_connection_id = Arc::new(AtomicUsize::new(0));
    let seen_clone = seen_methods.clone();
    let triggered_clone = triggered_connections.clone();
    let closed_clone = closed_connections.clone();
    let next_connection_clone = next_connection_id.clone();
    let target_clone = expected_target_id;

    let router = Router::new()
        .route(
            "/devtools/devtools_app.html",
            get(|| async {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(
                        r#"<!doctype html><meta http-equiv="Content-Security-Policy" content="object-src 'none'; connect-src ws://127.0.0.1:*"><h1>DevTools</h1>"#,
                    ))
                    .unwrap()
            }),
        )
        .route(
            "/devtools/panels/network/network.js",
            get(|| async {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "application/javascript")
                    .body(Body::from("export const ok = true;"))
                    .unwrap()
            }),
        )
        .route(
            "/devtools/browser/mock",
            get(|ws: WebSocketUpgrade| async move {
                ws.on_upgrade(|mut socket| async move {
                    while let Some(Ok(AxumWsMsg::Text(txt))) = socket.next().await {
                        let val: Value = serde_json::from_str(&txt).unwrap();
                        let result = if val.get("method").and_then(Value::as_str) == Some("Target.getTargets") {
                            json!({ "targetInfos": [] })
                        } else {
                            json!({ "success": true })
                        };
                        let reply = json!({ "id": val["id"], "result": result });
                        if socket.send(AxumWsMsg::Text(reply.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                })
            }),
        )
        .route(
            "/devtools/page/{tid}",
            get(move |AxumPath(tid): AxumPath<String>, ws: WebSocketUpgrade| {
                let seen = seen_clone.clone();
                let exp = target_clone.clone();
                let triggered = triggered_clone.clone();
                let closed = closed_clone.clone();
                let next_connection = next_connection_clone.clone();
                async move {
                    if tid != exp {
                        return StatusCode::NOT_FOUND.into_response();
                    }
                    ws.on_upgrade(move |mut socket| async move {
                        let connection_id = next_connection.fetch_add(1, Ordering::Relaxed);
                        let triggered = triggered.clone();
                        let closed = closed.clone();
                        let _ = socket
                            .send(AxumWsMsg::Text(
                                json!({
                                    "method": "Target.targetCreated",
                                    "params": { "targetInfo": { "targetId": "FOREIGN-TAB", "type": "page" } }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await;
                        let _ = socket
                            .send(AxumWsMsg::Text(
                                json!({
                                    "method": "Target.targetDestroyed",
                                    "params": { "targetId": "FOREIGN-TAB" }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await;
                        let _ = socket
                            .send(AxumWsMsg::Text(
                                json!({
                                    "method": "Target.targetCreated",
                                    "params": { "targetInfo": { "targetId": "CHILD-WORKER", "type": "worker" } }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await;
                        let _ = socket
                            .send(AxumWsMsg::Text(
                                json!({
                                    "method": "ServiceWorker.workerRegistrationUpdated",
                                    "sessionId": "unknown-session",
                                    "params": { "registrations": [{ "scopeURL": "https://foreign.test/" }] }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await;
                        let _ = socket
                            .send(AxumWsMsg::Text(
                                json!({
                                    "method": "BackgroundService.recordingStateChanged",
                                    "sessionId": "unknown-session",
                                    "params": { "service": "backgroundFetch", "isRecording": true }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await;
                        while let Some(Ok(frame)) = socket.next().await {
                            match frame {
                                AxumWsMsg::Text(txt) => {
                                    let Ok(val) = serde_json::from_str::<Value>(&txt) else {
                                        seen.lock().push("<invalid-json>".into());
                                        continue;
                                    };
                                    let Some(method) = val.get("method").and_then(Value::as_str) else {
                                        seen.lock().push("<non-command>".into());
                                        continue;
                                    };
                                    seen.lock().push(method.to_string());
                                    if method == "Runtime.triggerBinary" {
                                        triggered.lock().push(connection_id);
                                        if socket.send(AxumWsMsg::Binary(vec![0, 1, 2].into())).await.is_err() {
                                            break;
                                        }
                                        continue;
                                    }
                                    let reply = json!({ "id": val["id"], "result": { "ok": true } });
                                    if socket.send(AxumWsMsg::Text(reply.to_string().into())).await.is_err() {
                                        break;
                                    }
                                }
                                AxumWsMsg::Binary(_) => seen.lock().push("<binary>".into()),
                                AxumWsMsg::Ping(payload) => {
                                    if socket.send(AxumWsMsg::Pong(payload)).await.is_err() {
                                        break;
                                    }
                                }
                                AxumWsMsg::Pong(_) => {}
                                AxumWsMsg::Close(_) => {
                                    closed.lock().push(connection_id);
                                    break;
                                }
                            }
                        }
                    })
                }
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (port, seen_methods, triggered_connections, closed_connections)
}

async fn resp_json(resp: reqwest::Response) -> Value {
    let bytes = resp.bytes().await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
async fn wait_cdp_response<S>(
    ws: &mut tokio_tungstenite::WebSocketStream<S>,
    id: u64,
    timeout: std::time::Duration,
) -> Result<Value, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!("timed out waiting for CDP response id {id}"));
        }
        match tokio::time::timeout(remaining, ws.next()).await {
            Err(_) => return Err(format!("timed out waiting for CDP response id {id}")),
            Ok(Some(Ok(WsMsg::Text(text)))) => {
                let response: Value = serde_json::from_str(&text)
                    .map_err(|error| format!("invalid CDP JSON while waiting for id {id}: {error}"))?;
                if response.get("id") == Some(&json!(id)) {
                    return Ok(response);
                }
            }
            Ok(Some(Ok(WsMsg::Close(frame)))) => {
                return Err(format!("CDP websocket closed waiting for id {id}: {frame:?}"));
            }
            Ok(Some(Err(error))) => {
                return Err(format!("CDP websocket error waiting for id {id}: {error}"));
            }
            Ok(None) => return Err(format!("CDP websocket ended waiting for id {id}")),
            Ok(Some(Ok(_))) => {}
        }
    }
}
static TEST_VIEWER_CAP: AtomicUsize = AtomicUsize::new(0);

struct PairedViewerGuard {
    media: PairRegistration,
    control: PairRegistration,
}

impl PairedViewerGuard {
    async fn release(self) {
        let mgr = global_attachment_manager();
        mgr.unregister_connection(self.control.connection_id).await;
        mgr.unregister_connection(self.media.connection_id).await;
    }
}

async fn admit_paired_viewer(
    principal: &str,
    auth_session_id: &str,
    browser_session_id: &str,
    viewer_id: &str,
    incarnation: &str,
) -> PairedViewerGuard {
    let mgr = global_attachment_manager();
    let sub_epoch = uuid::Uuid::new_v4().to_string();
    let base = |purpose| AdmittedAttachment {
        purpose,
        principal: principal.to_string(),
        is_dev: false,
        auth_session_id: Some(auth_session_id.to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
        profile_epoch: 1,
        browser_incarnation: incarnation.to_string(),
        browser_session_id: Some(browser_session_id.to_string()),
        viewer_id: Some(viewer_id.to_string()),
        subscription_epoch: Some(sub_epoch.clone()),
    };
    let permit = || {
        ViewerPermit::try_acquire_in(&TEST_VIEWER_CAP, 64)
            .map_err(|_| AttachmentError::ViewerCapacityExceeded(64))
    };
    let media = mgr
        .register_pair_connection(&base(AttachmentPurpose::Media), permit)
        .await
        .expect("register media pair");
    assert!(mgr.mark_media_attached(media.connection_id).await);
    let control = mgr
        .register_pair_connection(&base(AttachmentPurpose::Control), permit)
        .await
        .expect("register control pair");
    PairedViewerGuard { media, control }
}

async fn acquire_control_router(
    app: &Router,
    session_id: &str,
    auth_token: &str,
    viewer_id: &str,
) -> String {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{session_id}/control/acquire"))
                .header(AUTHORIZATION, format!("Bearer {auth_token}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": viewer_id, "holderKind": "human" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&axum::body::to_bytes(resp.into_body(), 65536).await.unwrap())
            .unwrap();
    body["leaseToken"].as_str().unwrap().to_string()
}

async fn cleanup_test_session_viewers(sid: &str) {
    let mgr = global_input_managers().write().await.remove(sid);
    if let Some(mgr) = mgr {
        let _ = mgr.revoke_lease().await;
    }
    dam_hopper_server::browser_host::devtools::global_devtools_leases()
        .revoke_by_browser_session(sid)
        .await;
    global_attachment_manager()
        .revoke_by_browser_session(sid)
        .await;
}

async fn acquire_control_http(
    client: &reqwest::Client,
    addr: SocketAddr,
    session_id: &str,
    auth_token: &str,
    viewer_id: &str,
) -> String {
    let resp = client
        .post(format!("http://{addr}/api/browser/sessions/{session_id}/control/acquire"))
        .header(AUTHORIZATION, format!("Bearer {auth_token}"))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "viewerId": viewer_id, "holderKind": "human" }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp_json(resp).await["leaseToken"].as_str().unwrap().to_string()
}

async fn mint_devtools_probe_token(
    client: &reqwest::Client,
    addr: SocketAddr,
    session_id: &str,
    auth_token: &str,
    viewer_id: &str,
    lease_token: &str,
) -> String {
    let response = client
        .post(format!("http://{addr}/api/browser/sessions/{session_id}/devtools"))
        .header(AUTHORIZATION, format!("Bearer {auth_token}"))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "viewerId": viewer_id, "leaseToken": lease_token }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    resp_json(response).await["token"].as_str().unwrap().to_string()
}

async fn assert_devtools_client_frame_closes(addr: SocketAddr, token: &str, frame: WsMsg) {
    let (mut ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{token}/ws"))
            .await
            .expect("connect disposable DevTools socket");
    let initial = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(initial.to_text().unwrap()).unwrap()["params"]["targetInfo"]["targetId"],
        "CHILD-WORKER"
    );
    ws.send(frame).await.unwrap();
    let closed = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap();
    assert!(matches!(closed, None | Some(Ok(WsMsg::Close(_))) | Some(Err(_))));
}

async fn assert_devtools_upstream_binary_closes(
    addr: SocketAddr,
    token: &str,
    triggered: Arc<Mutex<Vec<usize>>>,
    closed_connections: Arc<Mutex<Vec<usize>>>,
) {
    let (mut ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{token}/ws"))
            .await
            .expect("connect disposable DevTools socket");
    let initial = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(initial.to_text().unwrap()).unwrap()["params"]["targetInfo"]["targetId"],
        "CHILD-WORKER"
    );
    ws.send(WsMsg::Text(
        json!({"id": 501, "method": "Runtime.triggerBinary"}).to_string().into(),
    ))
    .await
    .unwrap();
    let downstream_closed = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap();
    assert!(matches!(downstream_closed, None | Some(Ok(WsMsg::Close(_))) | Some(Err(_))));
    let connection_id = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Some(connection_id) = triggered.lock().last().copied() {
                break connection_id;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("mock must record the binary-triggering connection");
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if closed_connections.lock().contains(&connection_id) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("relay must close the binary-triggering upstream connection");
}

#[tokio::test]
async fn test_devtools_lease_mint_foreign_conflict_and_capacity() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (auth_service, owner_tok) = make_user_token("dt-owner", UserRole::Admin);
    let (other_auth, other_tok) = make_user_token("dt-foreign", UserRole::Admin);
    let origins = vec![HeaderValue::from_static("http://127.0.0.1:5173")];
    let enabled_cfg = Some(BrowserHostConfig {
        enabled: true,
        ..BrowserHostConfig::default()
    });
    let state = create_test_state(tmp.path().to_path_buf(), None, enabled_cfg.clone())
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state.clone(), origins.clone());

    let running_id = insert_running_session("dt-owner", false, "inc-cap", "TARGET-CAP").await;
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: "dt-owner".into(),
        is_dev: false,
        pid: 1,
        ws_endpoint: "ws://127.0.0.1:19999/devtools/browser/mock".into(),
        browser_incarnation: "inc-cap".into(),
        profile_epoch: 1,
        user_data_dir: tmp.path().to_path_buf(),
    });

    // Foreign principal cannot mint lease -> 404 (even with JSON body)
    let foreign_state = create_test_state(tmp.path().to_path_buf(), None, enabled_cfg)
        .with_auth_service(Arc::new(other_auth));
    let foreign_app = build_router_with_origins(foreign_state, origins);
    let resp = foreign_app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {other_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "v-other", "leaseToken": "tok-other" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Bodyless mint is rejected (no legacy fallback) and does not create an input manager
    let bodyless_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(bodyless_resp.status().is_client_error());
    assert!(global_input_managers().read().await.get(&running_id).is_none());

    // Same owner without active control lease -> 403 and no input manager created
    let no_ctrl_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "viewer-cap", "leaseToken": "missing" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(no_ctrl_resp.status(), StatusCode::FORBIDDEN);
    assert!(global_input_managers().read().await.get(&running_id).is_none());

    // Acquire control WITHOUT admitted viewer pair -> 403 viewerNotAdmitted
    let lease_tok = acquire_control_router(&app, &running_id, &owner_tok, "viewer-cap").await;
    let unadmitted_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "viewer-cap", "leaseToken": lease_tok }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unadmitted_resp.status(), StatusCode::FORBIDDEN);

    // Admit paired viewer, verify wrong viewerId or wrong leaseToken rejected, then mint 8 (cap) -> 9th 429
    let pair = admit_paired_viewer("dt-owner", "sess-dt-owner", &running_id, "viewer-cap", "inc-cap").await;
    let wrong_viewer = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "viewer-wrong", "leaseToken": lease_tok }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_viewer.status(), StatusCode::FORBIDDEN);

    let mut minted = Vec::new();
    for _ in 0..8 {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                    .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                    .header(ORIGIN, "http://127.0.0.1:5173")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "viewerId": "viewer-cap", "leaseToken": lease_tok }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&axum::body::to_bytes(resp.into_body(), 65536).await.unwrap())
                .unwrap();
        assert_eq!(body["viewerId"], "viewer-cap");
        assert!(body["controlEpoch"].as_str().is_some());
        minted.push(body["token"].as_str().unwrap().to_string());
    }
    let cap_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{running_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "viewer-cap", "leaseToken": lease_tok }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cap_resp.status(), StatusCode::TOO_MANY_REQUESTS);

    // Non-running (Initializing) session returns 409 Conflict
    let pending_req = CreateSessionRequest {
        creation_key: uuid::Uuid::new_v4().to_string(),
        url: "about:blank".to_string(),
        viewport: ViewportRequest { width: 800, height: 600, dpr: 1.0 },
    };
    let CreateReservation::Pending { session_id: init_id } = global_session_registry()
        .reserve_creation(
            &CreateParams {
                principal: "dt-owner",
                is_dev: false,
                browser_incarnation: "inc-cap",
                profile_epoch: 1,
                request: &pending_req,
                allowed_origins: &[],
                max_targets: usize::MAX,
            },
            &|| true,
        )
        .await
        .unwrap()
    else {
        panic!("expected pending");
    };
    let conflict_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{init_id}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "viewer-cap", "leaseToken": lease_tok }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(conflict_resp.status(), StatusCode::CONFLICT);

    // DELETE revokes one lease and frees slot; session cleanup releases pair & control
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/browser/sessions/{running_id}/devtools/{}", minted[0]))
                .header(AUTHORIZATION, format!("Bearer {owner_tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_resp.status(), StatusCode::OK);
    pair.release().await;
    cleanup_test_session_viewers(&running_id).await;
}

#[tokio::test]
async fn test_devtools_asset_proxy_csp_and_path_traversal() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, _, _, _) = spawn_mock_chromium_server("TARGET-ASSET".into()).await;
    let (auth_service, tok) = make_user_token("dt-asset", UserRole::Admin);
    let state = create_test_state(
        tmp.path().to_path_buf(),
        None,
        Some(BrowserHostConfig {
            enabled: true,
            ..BrowserHostConfig::default()
        }),
    )
    .with_auth_service(Arc::new(auth_service));
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: "dt-asset".into(),
        is_dev: false,
        pid: 1,
        ws_endpoint: format!("ws://127.0.0.1:{mock_port}/devtools/browser/mock"),
        browser_incarnation: "inc-asset".into(),
        profile_epoch: 1,
        user_data_dir: tmp.path().to_path_buf(),
    });
    let app = build_router_with_origins(state, vec![HeaderValue::from_static("http://127.0.0.1:5173")]);
    let sid = insert_running_session("dt-asset", false, "inc-asset", "TARGET-ASSET").await;
    let pair = admit_paired_viewer("dt-asset", "sess-dt-asset", &sid, "viewer-asset", "inc-asset").await;
    let ctrl_tok = acquire_control_router(&app, &sid, &tok, "viewer-asset").await;

    let mint_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{sid}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "viewerId": "viewer-asset", "leaseToken": ctrl_tok }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mint_resp.status(), StatusCode::OK);
    let lease: Value =
        serde_json::from_slice(&axum::body::to_bytes(mint_resp.into_body(), 65536).await.unwrap())
            .unwrap();
    let dt_token = lease["token"].as_str().unwrap();

    // HTML asset: rewritten CSP + no-store + security headers
    let html_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/browser/devtools/{dt_token}/devtools_app.html"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(html_resp.status(), StatusCode::OK);
    assert_eq!(html_resp.headers().get(CACHE_CONTROL).unwrap(), "no-store");
    assert_eq!(html_resp.headers().get("referrer-policy").unwrap(), "no-referrer");
    assert_eq!(html_resp.headers().get("x-content-type-options").unwrap(), "nosniff");
    let html_body = String::from_utf8(
        axum::body::to_bytes(html_resp.into_body(), 65536).await.unwrap().to_vec(),
    )
    .unwrap();
    assert!(html_body.contains("'self' ws: wss: ws://127.0.0.1:*"));

    // JS subresource: private, max-age=300
    let js_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/browser/devtools/{dt_token}/panels/network/network.js"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(js_resp.status(), StatusCode::OK);
    assert_eq!(js_resp.headers().get(CACHE_CONTROL).unwrap(), "private, max-age=300");

    // Traversal rejected -> 400
    let trav_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/browser/devtools/{dt_token}/../secret"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(trav_resp.status(), StatusCode::BAD_REQUEST);

    // Explicit DELETE revokes token
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/browser/sessions/{sid}/devtools/{dt_token}"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let expired_resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/browser/devtools/{dt_token}/devtools_app.html"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(expired_resp.status(), StatusCode::UNAUTHORIZED);
    pair.release().await;
    cleanup_test_session_viewers(&sid).await;
}

#[tokio::test]
async fn test_devtools_ws_target_isolation_geometry_fence_and_revocation() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, seen_methods, triggered_connections, closed_connections) =
        spawn_mock_chromium_server("TARGET-WS".into()).await;
    let (store, auth_service, tokens) =
        setup_sqlite_multi_session(tmp.path(), "dt-ws", &["auth-a", "auth-b"]).await;
    let state = create_test_state(
        tmp.path().to_path_buf(),
        Some(store),
        Some(BrowserHostConfig {
            enabled: true,
            ..BrowserHostConfig::default()
        }),
    )
    .with_auth_service(auth_service);
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: "dt-ws".into(),
        is_dev: false,
        pid: 1,
        ws_endpoint: format!("ws://127.0.0.1:{mock_port}/devtools/browser/mock"),
        browser_incarnation: "inc-ws".into(),
        profile_epoch: 1,
        user_data_dir: tmp.path().to_path_buf(),
    });
    let app = build_router_with_origins(state.clone(), vec![HeaderValue::from_static("http://127.0.0.1:5173")]);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    let sid = insert_running_session("dt-ws", false, "inc-ws", "TARGET-WS").await;
    let client = reqwest::Client::new();
    let pair_a = admit_paired_viewer("dt-ws", "auth-a", &sid, "viewer-a", "inc-ws").await;
    let lease_token_a = acquire_control_http(&client, addr, &sid, &tokens[0], "viewer-a").await;
    // Another auth session cannot mint DevTools using viewer-a's admitted viewer ID
    let cross_auth_resp = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "viewerId": "viewer-a", "leaseToken": lease_token_a }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(cross_auth_resp.status(), StatusCode::FORBIDDEN);
    let tok_a = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;
    let tok_binary = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;
    let tok_malformed = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;
    let tok_batch = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;
    let tok_upstream_binary = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;
    let tok_dense = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;
    let tok_scalar = mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_token_a).await;

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{tok_a}/ws"))
        .await
        .expect("connect devtools ws");

    // Second WS with same token rejected with 409 Conflict
    let dup = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{tok_a}/ws")).await;
    assert!(dup.is_err(), "duplicate WS for same token must be rejected");
    // Unsupported binary application frames terminate only their own socket.
    let (mut binary_ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{tok_binary}/ws"))
            .await
            .expect("connect binary-probe devtools ws");
    let binary_first_evt = tokio::time::timeout(std::time::Duration::from_secs(2), binary_ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(binary_first_evt.to_text().unwrap()).unwrap()["params"]["targetInfo"]["targetId"],
        "CHILD-WORKER"
    );
    binary_ws.send(WsMsg::Binary(vec![0, 1, 2].into())).await.unwrap();
    let binary_closed = tokio::time::timeout(std::time::Duration::from_secs(2), binary_ws.next())
        .await
        .unwrap();
    assert!(matches!(binary_closed, None | Some(Ok(WsMsg::Close(_))) | Some(Err(_))));
    assert_devtools_client_frame_closes(
        addr,
        &tok_malformed,
        WsMsg::Text("{".to_string().into()),
    )
    .await;
    assert_devtools_client_frame_closes(
        addr,
        &tok_batch,
        WsMsg::Text(json!([{"id": 1, "method": "Runtime.enable"}]).to_string().into()),
    )
    .await;
    let dense_values = vec!["0"; 9_000].join(",");
    let dense_message = format!(
        r#"{{"id":77,"method":"Runtime.evaluate","params":{{"value":[{dense_values}]}}}}"#
    );
    assert_devtools_client_frame_closes(
        addr,
        &tok_dense,
        WsMsg::Text(dense_message.into()),
    )
    .await;
    assert_devtools_client_frame_closes(
        addr,
        &tok_scalar,
        WsMsg::Text(r#""not a command""#.to_string().into()),
    )
    .await;
    assert_devtools_upstream_binary_closes(
        addr,
        &tok_upstream_binary,
        triggered_connections,
        closed_connections,
    )
    .await;
    assert!(seen_methods.lock().contains(&"Runtime.triggerBinary".to_string()));
    assert!(!seen_methods.lock().iter().any(|frame| {
        matches!(frame.as_str(), "<binary>" | "<invalid-json>" | "<non-command>")
    }));

    // Upstream foreign page Target.targetCreated dropped; worker forwarded
    let first_evt = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let first_val: Value = serde_json::from_str(first_evt.to_text().unwrap()).unwrap();
    assert_eq!(first_val["params"]["targetInfo"]["targetId"], "CHILD-WORKER");

    // Protected effects and cross-target commands are rejected before reaching the peer.
    for (id, method, params) in [
        (1, "Emulation.clearDeviceMetricsOverride", json!({})),
        (2, "Emulation.setDeviceMetricsOverride", json!({"width": 500, "height": 500, "deviceScaleFactor": 1, "mobile": false})),
        (3, "Browser.getVersion", json!({})),
        (4, "Target.getTargets", json!({})),
        (5, "Target.sendMessageToTarget", json!({"sessionId": "x", "message": "{}"})),
        (6, "Target.attachToTarget", json!({"targetId": "OTHER-TAB"})),
        (7, "Page.setDownloadBehavior", json!({"behavior": "allow", "downloadPath": "/tmp/attacker"})),
        (8, "ServiceWorker.stopAllWorkers", json!({})),
        (9, "ServiceWorker.enable", json!({})),
        (10, "Storage.getCookies", json!({})),
        (11, "Network.setCookie", json!({"name": "x", "value": "y"})),
        (12, "BackgroundService.startObserving", json!({"service": "backgroundFetch"})),
        (13, "BackgroundService.setRecording", json!({"service": "backgroundFetch", "shouldRecord": true})),
    ] {
        ws.send(WsMsg::Text(json!({"id": id, "method": method, "params": params}).to_string().into()))
            .await
            .unwrap();
        let reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let parsed: Value = serde_json::from_str(reply.to_text().unwrap()).unwrap();
        assert_eq!(parsed["id"], id);
        assert_eq!(parsed["error"]["code"], -32601);
    }
    ws.send(WsMsg::Text(
        json!({
            "id": 14,
            "sessionId": "unknown-session",
            "method": "Page.setDownloadBehavior",
            "params": {"behavior": "allow", "downloadPath": "/tmp/child"}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let flattened_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let flattened_value: Value = serde_json::from_str(flattened_reply.to_text().unwrap()).unwrap();
    assert_eq!(flattened_value["id"], 14);
    assert_eq!(flattened_value["sessionId"], "unknown-session");
    assert_eq!(flattened_value["error"]["code"], -32601);
    assert!(flattened_value.get("result").is_none());
    ws.send(WsMsg::Text(
        json!({
            "id": 15,
            "sessionId": "unknown-session",
            "method": "BackgroundService.startObserving",
            "params": {"service": "backgroundFetch"}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let flattened_worker_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let flattened_worker_value: Value =
        serde_json::from_str(flattened_worker_reply.to_text().unwrap()).unwrap();
    assert_eq!(flattened_worker_value["id"], 15);
    assert_eq!(flattened_worker_value["sessionId"], "unknown-session");
    assert_eq!(flattened_worker_value["error"]["code"], -32601);
    assert!(flattened_worker_value.get("result").is_none());
    ws.send(WsMsg::Text(
        json!({
            "id": 16,
            "sessionId": "unknown-session",
            "method": "ServiceWorker.stopAllWorkers",
            "params": {}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let flattened_service_worker_reply =
        tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    let flattened_service_worker_value: Value =
        serde_json::from_str(flattened_service_worker_reply.to_text().unwrap()).unwrap();
    assert_eq!(flattened_service_worker_value["id"], 16);
    assert_eq!(flattened_service_worker_value["sessionId"], "unknown-session");
    assert_eq!(flattened_service_worker_value["error"]["code"], -32601);
    assert!(flattened_service_worker_value.get("result").is_none());

    // Allowed Runtime.enable reaches upstream
    ws.send(WsMsg::Text(json!({"id": 99, "method": "Runtime.enable"}).to_string().into()))
        .await
        .unwrap();
    let ok_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let dense_values = vec!["0"; 2_000].join(",");
    let dense_allowed = format!(
        r#"{{"id":100,"method":"Runtime.evaluate","params":{{"value":[{dense_values}]}}}}"#
    );
    ws.send(WsMsg::Text(dense_allowed.into())).await.unwrap();
    let dense_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let dense_reply_value: Value = serde_json::from_str(dense_reply.to_text().unwrap()).unwrap();
    assert_eq!(dense_reply_value["id"], 100);
    assert_eq!(dense_reply_value["result"]["ok"], true);
    let ok_val: Value = serde_json::from_str(ok_reply.to_text().unwrap()).unwrap();
    assert_eq!(ok_val["id"], 99);
    assert_eq!(ok_val["result"]["ok"], true);
    assert_eq!(seen_methods.lock().as_slice(), &["Runtime.triggerBinary", "Runtime.enable", "Runtime.evaluate"]);

    // Session input_available remains true
    let snap = global_session_registry().snapshot(&sid, "dt-ws").await.unwrap();
    assert!(snap.dto.input_available, "input_available must stay true");
    assert_eq!(seen_methods.lock().as_slice(), &["Runtime.triggerBinary", "Runtime.enable", "Runtime.evaluate"]);

    // Single-session auth revocation (DELETE /api/auth/sessions/auth-a) closes auth-a WS
    let revoke_resp = client
        .delete(format!("http://{addr}/api/auth/sessions/auth-a"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .send()
        .await
        .unwrap();
    assert_eq!(revoke_resp.status(), StatusCode::NO_CONTENT);
    let closed = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next()).await.unwrap();
    assert!(matches!(closed, None | Some(Ok(WsMsg::Close(_))) | Some(Err(_))));
    pair_a.release().await;

    // auth-b admits its own viewer, acquires control, mints DevTools, and continues
    let pair_b = admit_paired_viewer("dt-ws", "auth-b", &sid, "viewer-b", "inc-ws").await;
    let lease_token_b = acquire_control_http(&client, addr, &sid, &tokens[1], "viewer-b").await;
    let tok_b = mint_devtools_probe_token(&client, addr, &sid, &tokens[1], "viewer-b", &lease_token_b).await;
    let (mut survivor_ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{tok_b}/ws"))
            .await
            .expect("connect auth-b survivor devtools ws");
    let survivor_first_evt = tokio::time::timeout(std::time::Duration::from_secs(2), survivor_ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(survivor_first_evt.to_text().unwrap()).unwrap()["params"]["targetInfo"]["targetId"],
        "CHILD-WORKER"
    );
    survivor_ws
        .send(WsMsg::Text(json!({"id": 100, "method": "Runtime.enable"}).to_string().into()))
        .await
        .unwrap();
    let survivor_reply = tokio::time::timeout(std::time::Duration::from_secs(2), survivor_ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let survivor_value: Value = serde_json::from_str(survivor_reply.to_text().unwrap()).unwrap();
    assert_eq!(survivor_value["id"], 100);
    assert_eq!(survivor_value["result"]["ok"], true);
    assert_eq!(seen_methods.lock().as_slice(), &["Runtime.triggerBinary", "Runtime.enable", "Runtime.evaluate", "Runtime.enable"]);

    let b_asset = client
        .get(format!("http://{addr}/api/browser/devtools/{tok_b}/devtools_app.html"))
        .send()
        .await
        .unwrap();
    assert_eq!(b_asset.status(), StatusCode::OK);

    // Deleting the browser session revokes remaining DevTools leases for that session
    let _ = client
        .delete(format!("http://{addr}/api/browser/sessions/{sid}"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .send()
        .await
        .unwrap();
    let survivor_closed =
        tokio::time::timeout(std::time::Duration::from_secs(2), survivor_ws.next()).await.unwrap();
    assert!(matches!(survivor_closed, None | Some(Ok(WsMsg::Close(_))) | Some(Err(_))));
    let b_after = client
        .get(format!("http://{addr}/api/browser/devtools/{tok_b}/devtools_app.html"))
        .send()
        .await
        .unwrap();
    assert_eq!(b_after.status(), StatusCode::UNAUTHORIZED);
    pair_b.release().await;
    cleanup_test_session_viewers(&sid).await;
}

#[tokio::test]
async fn test_devtools_ws_enforces_max_concurrent_connections() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, _, _, _) = spawn_mock_chromium_server("TARGET-MAX".into()).await;
    let (auth_service, tok) = make_user_token("dt-max", UserRole::Admin);
    let state = create_test_state(
        tmp.path().to_path_buf(),
        None,
        Some(BrowserHostConfig {
            enabled: true,
            ..BrowserHostConfig::default()
        }),
    )
    .with_auth_service(Arc::new(auth_service));
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: "dt-max".into(),
        is_dev: false,
        pid: 1,
        ws_endpoint: format!("ws://127.0.0.1:{mock_port}/devtools/browser/mock"),
        browser_incarnation: "inc-max".into(),
        profile_epoch: 1,
        user_data_dir: tmp.path().to_path_buf(),
    });
    let app = build_router_with_origins(state, vec![HeaderValue::from_static("http://127.0.0.1:5173")]);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    let sid = insert_running_session("dt-max", false, "inc-max", "TARGET-MAX").await;
    let client = reqwest::Client::new();
    let pair = admit_paired_viewer("dt-max", "sess-dt-max", &sid, "viewer-max", "inc-max").await;
    let lease_token = acquire_control_http(&client, addr, &sid, &tok, "viewer-max").await;
    let mut sockets = Vec::new();
    for _ in 0..4 {
        let t = mint_devtools_probe_token(&client, addr, &sid, &tok, "viewer-max", &lease_token).await;
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{t}/ws"))
            .await
            .unwrap();
        sockets.push(ws);
    }
    let fifth_tok = mint_devtools_probe_token(&client, addr, &sid, &tok, "viewer-max", &lease_token).await;
    let err = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{fifth_tok}/ws"))
        .await
        .unwrap_err();
    let tokio_tungstenite::tungstenite::Error::Http(resp) = err else {
        panic!("expected HTTP 429 rejection, got {err:?}");
    };
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    drop(sockets);
    pair.release().await;
    cleanup_test_session_viewers(&sid).await;
}

#[tokio::test]
async fn test_real_chromium_devtools_and_native_host_downloads() {
    let _serial = TEST_SERIAL.lock().await;
    let _ = tracing_subscriber::fmt()
        .with_test_writer()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    global_session_registry().reset_for_test().await;
    // The exact filePath assertion below is a real-Chromium qualification lane:
    // CDP permits filePath to be omitted on other platforms.

    let chromium_path = match dam_hopper_server::browser_host::process::find_browser_executable(None) {
        Ok(path) => path,
        Err(error) if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") => {
            panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found: {error}");
        }
        Err(error) => {
            eprintln!("SKIP: No configured Chrome/Chromium executable: {error}");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let dl_dir = tmp.path().join("native-downloads");
    std::fs::create_dir_all(&dl_dir).unwrap();
    struct RestoreXdg(Option<std::ffi::OsString>);
    impl Drop for RestoreXdg {
        fn drop(&mut self) {
            let _guard = ENV_LOCK.lock();
            match self.0.take() {
                Some(prev) => std::env::set_var("XDG_DOWNLOAD_DIR", prev),
                None => std::env::remove_var("XDG_DOWNLOAD_DIR"),
            }
        }
    }
    let _xdg_restore = {
        let _guard = ENV_LOCK.lock();
        let prev = std::env::var_os("XDG_DOWNLOAD_DIR");
        std::env::set_var("XDG_DOWNLOAD_DIR", &dl_dir);
        RestoreXdg(prev)
    };

    let oopif_payload_requests = Arc::new(AtomicUsize::new(0));
    let oopif_payload_requests_for_route = Arc::clone(&oopif_payload_requests);
    let same_process_payload_requests = Arc::new(AtomicUsize::new(0));
    let same_process_payload_requests_for_route = Arc::clone(&same_process_payload_requests);
    let site_router = Router::new()
        .route(
            "/",
            get(|| async {
                Response::builder()
                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(
                        r#"<!doctype html>
                        <a id="dl-data" href="data:text/plain,hello-data-dl" download="data-dl.txt">data</a>
                        <a id="dl-http" href="/payload.bin" download="http-dl.bin">http</a>
                        <script>
                          window.triggerBlobDownload = () => {
                            const b = new Blob(["hello-blob-dl"], { type: "text/plain" });
                            const u = URL.createObjectURL(b);
                            const a = document.createElement("a");
                            a.href = u;
                            a.download = "blob-dl.txt";
                            document.body.appendChild(a);
                            a.click();
                          };
                        </script>"#,
                    ))
                    .unwrap()
            }),
        )
        .route(
            "/same-process-child",
            get(|| async {
                Response::builder()
                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(
                        r#"<!doctype html><script>
                            const params = new URL(location.href).searchParams;
                            const nonce = params.get('nonce');
                            const phase = params.get('phase') || 'initial';
                            parent.postMessage({ kind: 'same-process-ready', nonce, phase }, '*');
                            addEventListener('message', event => {
                                if (event.source === parent && event.data?.kind === 'same-process-download'
                                    && event.data.nonce === nonce) {
                                    location.href = '/same-process-payload?phase=' + encodeURIComponent(event.data.phase || phase);
                                }
                            });
                        </script>"#,
                    ))
                    .unwrap()
            }),
        )
        .route(
            "/same-process-payload",
            get(move |axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>| {
                same_process_payload_requests_for_route.fetch_add(1, Ordering::SeqCst);
                let filename = if query.get("phase").map(String::as_str) == Some("return") {
                    "return-same-proc-dl.bin"
                } else {
                    "same-proc-dl.bin"
                };
                let body = if query.get("phase").map(String::as_str) == Some("return") {
                    "hello-return-same-process-download"
                } else {
                    "hello-same-process-download"
                };
                async move {
                    Response::builder()
                        .header(CONTENT_TYPE, "application/octet-stream")
                        .header("content-disposition", format!("attachment; filename=\"{filename}\""))
                        .body(Body::from(body))
                        .unwrap()
                }
            }),
        )
        .route(
            "/child",
            get(|| async {
                Response::builder()
                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(
                        r#"<!doctype html><script>
                            const nonce = new URL(location.href).searchParams.get('nonce');
                            parent.postMessage({ kind: 'oopif-ready', nonce }, '*');
                            addEventListener('message', event => {
                                if (event.source === parent && event.data?.kind === 'download' && event.data.nonce === nonce) {
                                    location.href = '/oopif-payload';
                                }
                            });
                        </script>"#,
                    ))
                    .unwrap()
            }),
        )
        .route(
            "/oopif-payload",
            get(move || {
                oopif_payload_requests_for_route.fetch_add(1, Ordering::SeqCst);
                async {
                    Response::builder()
                        .header(CONTENT_TYPE, "application/octet-stream")
                        .header("content-disposition", "attachment; filename=\"oopif-dl.bin\"")
                        .body(Body::from("hello-oopif-download"))
                        .unwrap()
                }
            }),
        )
        .route(
            "/payload.bin",
            get(|| async {
                Response::builder()
                    .header(CONTENT_TYPE, "application/octet-stream")
                    .body(Body::from("hello-http-dl"))
                    .unwrap()
            }),
        );
    let site_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let site_port = site_listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(site_listener, site_router).await.unwrap(); });

    let browser_cfg = BrowserHostConfig {
        enabled: true,
        executable_path: Some(chromium_path),
        allowed_target_origins: vec![
            format!("http://127.0.0.1:{site_port}"),
            format!("http://localhost:{site_port}"),
        ],
        ..BrowserHostConfig::default()
    };
    let (auth_service, tok) = make_user_token("dt-real", UserRole::Admin);
    let state = create_test_state(tmp.path().to_path_buf(), None, Some(browser_cfg))
        .with_auth_service(Arc::new(auth_service));
    let app = build_router_with_origins(state.clone(), vec![HeaderValue::from_static("http://127.0.0.1:5173")]);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    let client = reqwest::Client::new();
    let create_resp = client
        .post(format!("http://{addr}/api/browser/sessions"))
        .header(AUTHORIZATION, format!("Bearer {tok}"))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(
            json!({
                "creationKey": uuid::Uuid::new_v4().to_string(),
                "url": format!("http://127.0.0.1:{site_port}/"),
                "viewport": { "width": 1024, "height": 768, "dpr": 1.0 }
            })
            .to_string(),
        )
        .send()
        .await
        .unwrap();
    let create_status = create_resp.status();
    if create_status != StatusCode::CREATED {
        let error_body = create_resp
            .text()
            .await
            .unwrap_or_else(|error| format!("<failed to read response body: {error}>"));
        panic!("expected browser session creation to return 201, got {create_status}: {error_body}");
    }
    let created = resp_json(create_resp).await;
    let sid = created["browserSessionId"].as_str().unwrap().to_string();
    let inc = created["browserIncarnation"].as_str().unwrap().to_string();
    let pair = admit_paired_viewer("dt-real", "sess-dt-real", &sid, "viewer-real", &inc).await;
    let lease_token = acquire_control_http(&client, addr, &sid, &tok, "viewer-real").await;

    // 1. Mint DevTools lease and fetch real Chromium devtools_app.html
    let dt_tok = mint_devtools_probe_token(&client, addr, &sid, &tok, "viewer-real", &lease_token).await;
    let dt_html = client
        .get(format!("http://{addr}/api/browser/devtools/{dt_tok}/devtools_app.html"))
        .send()
        .await
        .unwrap();
    assert_eq!(dt_html.status(), StatusCode::OK);
    let html_txt = dt_html.text().await.unwrap();
    assert!(html_txt.contains("devtools_app"), "must serve real Chromium devtools_app.html");
    assert!(html_txt.contains("'self' ws: wss: ws://127.0.0.1:*"));

    let module = client
        .get(format!("http://{addr}/api/browser/devtools/{dt_tok}/panels/network/network.js"))
        .send()
        .await
        .unwrap();
    assert_eq!(module.status(), StatusCode::OK);
    assert_eq!(module.headers().get(CACHE_CONTROL).unwrap(), "private, max-age=300");
    assert!(module.headers().get(CONTENT_TYPE).unwrap().to_str().unwrap().contains("javascript"));
    assert!(!module.bytes().await.unwrap().is_empty(), "Chromium module must not be empty");

    // 2. Connect WS, trigger console log + blocked geometry command
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{dt_tok}/ws"))
        .await
        .expect("connect real chromium devtools ws");
    ws.send(WsMsg::Text(json!({"id": 1, "method": "Runtime.enable"}).to_string().into())).await.unwrap();
    ws.send(WsMsg::Text(json!({"id": 2, "method": "Emulation.clearDeviceMetricsOverride"}).to_string().into())).await.unwrap();
    ws.send(WsMsg::Text(json!({"id": 3, "method": "Runtime.evaluate", "params": {"expression": "console.log('devtools-console-ok')"}}).to_string().into())).await.unwrap();

    let mut saw_geometry_reject = false;
    let mut saw_console = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline && !(saw_geometry_reject && saw_console) {
        if let Ok(Some(Ok(WsMsg::Text(txt)))) = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next()).await {
            let v: Value = serde_json::from_str(&txt).unwrap();
            if v.get("id") == Some(&json!(2)) && v.pointer("/error/code") == Some(&json!(-32601)) {
                saw_geometry_reject = true;
            }
            if v.get("method") == Some(&json!("Runtime.consoleAPICalled")) && txt.contains("devtools-console-ok") {
                saw_console = true;
            }
        }
    }
    assert!(saw_geometry_reject, "Emulation.clearDeviceMetricsOverride must return -32601");
    assert!(saw_console, "must receive Runtime.consoleAPICalled over DevTools WS");

    // 3. Trigger data:, http:, and blob: downloads and verify files land in XDG_DOWNLOAD_DIR
    for (expr, file_name, expected_content) in [
        ("document.getElementById('dl-data').click()", "data-dl.txt", "hello-data-dl"),
        ("document.getElementById('dl-http').click()", "http-dl.bin", "hello-http-dl"),
        ("window.triggerBlobDownload()", "blob-dl.txt", "hello-blob-dl"),
    ] {
        ws.send(WsMsg::Text(json!({"id": 10, "method": "Runtime.evaluate", "params": {"expression": expr}}).to_string().into())).await.unwrap();
        let path = dl_dir.join(file_name);
        let wait_dl = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
        while tokio::time::Instant::now() < wait_dl {
            if path.is_file() && std::fs::read_to_string(&path).ok().as_deref() == Some(expected_content) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), expected_content, "missing native download {file_name}");
    }

    // 4. Verify BrowserSessionDto.lastDownload reports completed and inputAvailable stays true
    let wait_dto = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut final_dto = Value::Null;
    while tokio::time::Instant::now() < wait_dto {
        let dto = resp_json(
            client
                .get(format!("http://{addr}/api/browser/sessions/{sid}"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .send()
                .await
                .unwrap(),
        )
        .await;
        if dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("blob-dl.txt"))
            && dto.pointer("/lastDownload/filePath").and_then(Value::as_str)
                == dl_dir.join("blob-dl.txt").to_str()
        {
            final_dto = dto;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(final_dto.pointer("/lastDownload/state"), Some(&json!("completed")));
    assert_eq!(
        final_dto.pointer("/lastDownload/filePath").and_then(Value::as_str),
        dl_dir.join("blob-dl.txt").to_str(),
        "completed download must report its native host path"
    );
    assert_eq!(final_dto.get("inputAvailable"), Some(&json!(true)));
    let parent_download_guid = final_dto
        .pointer("/lastDownload/guid")
        .and_then(Value::as_str)
        .expect("parent download GUID")
        .to_string();
    // Round-trip a single iframe element across same-process -> cross-origin OOPIF -> same-process -> remove.
    let nonce = uuid::Uuid::new_v4().to_string();
    let attach_same_process_eval = format!(
        r#"(() => {{
            const nonce = '{nonce}';
            const sameOrigin = 'http://127.0.0.1:{site_port}';
            const crossOrigin = 'http://localhost:{site_port}';
            const frame = document.createElement('iframe');
            window.__oopifFrame = frame;
            window.__sameProcPhase = null;
            window.__oopifReady = false;
            window.addEventListener('message', event => {{
                if (event.origin === sameOrigin && event.source === frame.contentWindow
                    && event.data?.kind === 'same-process-ready' && event.data.nonce === nonce) {{
                    window.__sameProcPhase = event.data.phase;
                }}
                if (event.origin === crossOrigin && event.source === frame.contentWindow
                    && event.data?.kind === 'oopif-ready' && event.data.nonce === nonce) {{
                    window.__oopifReady = true;
                }}
            }});
            frame.src = sameOrigin + '/same-process-child?nonce=' + encodeURIComponent(nonce) + '&phase=initial';
            document.body.appendChild(frame);
            return true;
        }})()"#,
    );
    ws.send(WsMsg::Text(json!({
        "id": 20,
        "method": "Runtime.evaluate",
        "params": { "expression": attach_same_process_eval, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    let attach_response = wait_cdp_response(
        &mut ws, 20, std::time::Duration::from_secs(3),
    ).await.expect("receive synchronous same-process iframe attachment evaluation");
    assert_eq!(attach_response.pointer("/result/result/value"), Some(&json!(true)));

    let mut same_proc_ready = false;
    for id in 21..=40 {
        ws.send(WsMsg::Text(json!({
            "id": id,
            "method": "Runtime.evaluate",
            "params": { "expression": "window.__sameProcPhase === 'initial'", "returnByValue": true }
        }).to_string().into())).await.unwrap();
        let response = wait_cdp_response(
            &mut ws, id, std::time::Duration::from_secs(1),
        ).await.expect("receive same-process readiness poll");
        if response.pointer("/result/result/value") == Some(&json!(true)) {
            same_proc_ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(same_proc_ready, "same-process child did not post its readiness message");

    let trigger_same_proc_download = format!(
        "window.__oopifFrame.contentWindow.postMessage({{kind:'same-process-download',nonce:'{nonce}',phase:'initial'}}, 'http://127.0.0.1:{site_port}')",
    );
    ws.send(WsMsg::Text(json!({
        "id": 41,
        "method": "Runtime.evaluate",
        "params": { "expression": trigger_same_proc_download, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    wait_cdp_response(
        &mut ws, 41, std::time::Duration::from_secs(3),
    ).await.expect("receive same-process download trigger");

    let same_proc_path = dl_dir.join("same-proc-dl.bin");
    let same_proc_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut same_proc_dto = Value::Null;
    while tokio::time::Instant::now() < same_proc_deadline {
        let dto = resp_json(
            client
                .get(format!("http://{addr}/api/browser/sessions/{sid}"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .send()
                .await
                .unwrap(),
        ).await;
        same_proc_dto = dto;
        if std::fs::read_to_string(&same_proc_path).ok().as_deref() == Some("hello-same-process-download")
            && same_proc_dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && same_proc_dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("same-proc-dl.bin"))
            && same_proc_dto.pointer("/lastDownload/filePath").and_then(Value::as_str) == same_proc_path.to_str()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let same_proc_guid = same_proc_dto.pointer("/lastDownload/guid").and_then(Value::as_str).map(str::to_string);
    assert!(
        same_proc_dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && same_proc_dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("same-proc-dl.bin"))
            && same_proc_guid.as_deref().is_some_and(|guid| guid != parent_download_guid),
        "same-process child download failed: {same_proc_dto}"
    );

    // Swap the same-process iframe to cross-origin (OOPIF).
    let navigate_to_oopif = format!(
        "window.__oopifFrame.src = 'http://localhost:{site_port}/child?nonce=' + encodeURIComponent('{nonce}'); true",
    );
    ws.send(WsMsg::Text(json!({
        "id": 42,
        "method": "Runtime.evaluate",
        "params": { "expression": navigate_to_oopif, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    wait_cdp_response(
        &mut ws, 42, std::time::Duration::from_secs(3),
    ).await.expect("navigate same-process iframe to OOPIF");

    let mut child_ready = false;
    for id in 43..=62 {
        ws.send(WsMsg::Text(json!({
            "id": id,
            "method": "Runtime.evaluate",
            "params": { "expression": "window.__oopifReady === true", "returnByValue": true }
        }).to_string().into())).await.unwrap();
        let response = wait_cdp_response(
            &mut ws, id, std::time::Duration::from_secs(1),
        ).await.expect("receive synchronous OOPIF readiness poll");
        if response.pointer("/result/result/value") == Some(&json!(true)) {
            child_ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(child_ready, "cross-origin child did not post its nonce-bound readiness message");

    let sop_check = r#"(() => {
        try { void window.__oopifFrame.contentWindow.document; return false; }
        catch (error) { return error.name === 'SecurityError'; }
    })()"#;
    ws.send(WsMsg::Text(json!({
        "id": 63,
        "method": "Runtime.evaluate",
        "params": { "expression": sop_check, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    let sop_response = wait_cdp_response(
        &mut ws, 63, std::time::Duration::from_secs(3),
    ).await.expect("receive synchronous cross-origin policy check");
    assert_eq!(sop_response.pointer("/result/result/value"), Some(&json!(true)),
        "localhost iframe must be cross-origin to its 127.0.0.1 parent: {sop_response}");

    let trigger_oopif_download = format!(
        "window.__oopifFrame.contentWindow.postMessage({{kind:'download',nonce:'{nonce}'}}, 'http://localhost:{site_port}')",
    );
    ws.send(WsMsg::Text(json!({
        "id": 64,
        "method": "Runtime.evaluate",
        "params": { "expression": trigger_oopif_download, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    let oopif_trigger_response = wait_cdp_response(
        &mut ws, 64, std::time::Duration::from_secs(3),
    ).await.expect("receive OOPIF download trigger");
    assert!(
        oopif_trigger_response.get("error").is_none()
            && oopif_trigger_response.pointer("/result/exceptionDetails").is_none(),
        "OOPIF download trigger failed: {oopif_trigger_response}"
    );

    let oopif_path = dl_dir.join("oopif-dl.bin");
    let oopif_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut oopif_dto = Value::Null;
    while tokio::time::Instant::now() < oopif_deadline {
        let dto = resp_json(
            client
                .get(format!("http://{addr}/api/browser/sessions/{sid}"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .send()
                .await
                .unwrap(),
        ).await;
        oopif_dto = dto;
        if std::fs::read_to_string(&oopif_path).ok().as_deref() == Some("hello-oopif-download")
            && oopif_dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && oopif_dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("oopif-dl.bin"))
            && oopif_dto.pointer("/lastDownload/filePath").and_then(Value::as_str) == oopif_path.to_str()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let oopif_file = std::fs::read_to_string(&oopif_path).ok();
    let child_download_guid = oopif_dto.pointer("/lastDownload/guid").and_then(Value::as_str).map(str::to_string);
    let payload_request_count = oopif_payload_requests.load(Ordering::SeqCst);
    assert!(
        oopif_dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && oopif_dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("oopif-dl.bin"))
            && oopif_dto.pointer("/lastDownload/filePath").and_then(Value::as_str) == oopif_path.to_str()
            && child_download_guid.as_deref().is_some_and(|guid| Some(guid) != same_proc_guid.as_deref())
            && oopif_file.as_deref() == Some("hello-oopif-download")
            && payload_request_count == 1,
        "OOPIF qualification failed: latest DTO={oopif_dto}, child GUID={child_download_guid:?}, same-process GUID={same_proc_guid:?}, payload requests={payload_request_count}, file contents={oopif_file:?}"
    );

    // Swap the OOPIF back to same-process and confirm attribution remains live.
    let return_to_same_process = format!(
        "window.__oopifFrame.src = 'http://127.0.0.1:{site_port}/same-process-child?nonce=' + encodeURIComponent('{nonce}') + '&phase=return'; true",
    );
    ws.send(WsMsg::Text(json!({
        "id": 65,
        "method": "Runtime.evaluate",
        "params": { "expression": return_to_same_process, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    wait_cdp_response(
        &mut ws, 65, std::time::Duration::from_secs(3),
    ).await.expect("navigate OOPIF back to same-process");

    let mut return_ready = false;
    for id in 66..=85 {
        ws.send(WsMsg::Text(json!({
            "id": id,
            "method": "Runtime.evaluate",
            "params": { "expression": "window.__sameProcPhase === 'return'", "returnByValue": true }
        }).to_string().into())).await.unwrap();
        let response = wait_cdp_response(
            &mut ws, id, std::time::Duration::from_secs(1),
        ).await.expect("receive return same-process readiness poll");
        if response.pointer("/result/result/value") == Some(&json!(true)) {
            return_ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(return_ready, "returned same-process child did not post readiness message");

    let trigger_return_download = format!(
        "window.__oopifFrame.contentWindow.postMessage({{kind:'same-process-download',nonce:'{nonce}',phase:'return'}}, 'http://127.0.0.1:{site_port}')",
    );
    ws.send(WsMsg::Text(json!({
        "id": 86,
        "method": "Runtime.evaluate",
        "params": { "expression": trigger_return_download, "returnByValue": true }
    }).to_string().into())).await.unwrap();
    wait_cdp_response(
        &mut ws, 86, std::time::Duration::from_secs(3),
    ).await.expect("receive return same-process download trigger");

    let return_path = dl_dir.join("return-same-proc-dl.bin");
    let return_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut return_dto = Value::Null;
    while tokio::time::Instant::now() < return_deadline {
        let dto = resp_json(
            client
                .get(format!("http://{addr}/api/browser/sessions/{sid}"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .send()
                .await
                .unwrap(),
        ).await;
        return_dto = dto;
        if std::fs::read_to_string(&return_path).ok().as_deref() == Some("hello-return-same-process-download")
            && return_dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && return_dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("return-same-proc-dl.bin"))
            && return_dto.pointer("/lastDownload/filePath").and_then(Value::as_str) == return_path.to_str()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(return_dto.pointer("/lastDownload/state"), Some(&json!("completed")));
    assert_eq!(return_dto.pointer("/lastDownload/suggestedFilename"), Some(&json!("return-same-proc-dl.bin")));
    assert_eq!(return_dto.pointer("/lastDownload/filePath").and_then(Value::as_str), return_path.to_str());
    assert_eq!(same_process_payload_requests.load(Ordering::SeqCst), 2);

    ws.send(WsMsg::Text(json!({
        "id": 87,
        "method": "Runtime.evaluate",
        "params": { "expression": r#"(() => {
            window.__oopifFrame.remove();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(["after-oopif"], { type: "text/plain" }));
            a.download = "after-oopif.txt";
            a.click();
        })()"# }
    }).to_string().into())).await.unwrap();
    wait_cdp_response(
        &mut ws, 87, std::time::Duration::from_secs(3),
    ).await.expect("receive post-OOPIF parent download");
    let after_oopif_path = dl_dir.join("after-oopif.txt");
    let after_oopif_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut after_oopif_dto = Value::Null;
    while tokio::time::Instant::now() < after_oopif_deadline {
        let dto = resp_json(
            client
                .get(format!("http://{addr}/api/browser/sessions/{sid}"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .send()
                .await
                .unwrap(),
        )
        .await;
        if std::fs::read_to_string(&after_oopif_path).ok().as_deref() == Some("after-oopif")
            && dto.pointer("/lastDownload/state") == Some(&json!("completed"))
            && dto.pointer("/lastDownload/suggestedFilename") == Some(&json!("after-oopif.txt"))
        {
            after_oopif_dto = dto;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(after_oopif_dto.pointer("/lastDownload/state"), Some(&json!("completed")));
    assert_eq!(after_oopif_dto.pointer("/lastDownload/suggestedFilename"), Some(&json!("after-oopif.txt")));
    assert_eq!(after_oopif_dto.pointer("/lastDownload/filePath").and_then(Value::as_str), after_oopif_path.to_str());

    drop(ws);
    pair.release().await;
    cleanup_test_session_viewers(&sid).await;
    let _ = client
        .delete(format!("http://{addr}/api/browser/sessions/{sid}"))
        .header(AUTHORIZATION, format!("Bearer {tok}"))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .send()
        .await;
    state.browser_host.shutdown_all().await;
}

#[derive(Default)]
struct ProgrammableCdpBehavior {
    reject_keyup: std::sync::atomic::AtomicBool,
    reject_bad_repeat: std::sync::atomic::AtomicBool,
}

async fn spawn_programmable_cdp_server(
    expected_target_id: String,
) -> (
    u16,
    Arc<Mutex<Vec<(String, Value)>>>,
    Arc<ProgrammableCdpBehavior>,
) {
    let recorded: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let behavior = Arc::new(ProgrammableCdpBehavior::default());

    let ver_router = Router::new().route(
        "/json/version",
        get(|| async {
            axum::Json(json!({
                "Browser": "Chrome/130.0.0.0",
                "Protocol-Version": "1.3"
            }))
        }),
    );

    let rec_clone = recorded.clone();
    let beh_clone = behavior.clone();
    let target_clone = expected_target_id.clone();

    let app = ver_router.route(
        "/devtools/page/{tid}",
        get(
            move |AxumPath(tid): AxumPath<String>, ws: WebSocketUpgrade| {
                let rec = rec_clone.clone();
                let beh = beh_clone.clone();
                let exp = target_clone.clone();
                async move {
                    if tid != exp {
                        return StatusCode::NOT_FOUND.into_response();
                    }
                    ws.on_upgrade(move |mut socket| async move {
                        while let Some(Ok(frame)) = socket.next().await {
                            match frame {
                                AxumWsMsg::Text(txt) => {
                                    let Ok(val) = serde_json::from_str::<Value>(&txt) else {
                                        continue;
                                    };
                                    let method = val
                                        .get("method")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string();
                                    let params = val.get("params").cloned().unwrap_or(Value::Null);
                                    rec.lock().push((method.clone(), params.clone()));

                                    let is_keyup = method == "Input.dispatchKeyEvent"
                                        && params.get("type").and_then(Value::as_str)
                                            == Some("keyUp");
                                    let is_bad_repeat = method == "Input.dispatchKeyEvent"
                                        && params.get("key").and_then(Value::as_str)
                                            == Some("BadRepeat");

                                    let reply = if is_keyup
                                        && beh.reject_keyup.load(Ordering::Acquire)
                                    {
                                        json!({
                                            "id": val["id"],
                                            "error": { "code": -32000, "message": "simulated keyUp release failure" }
                                        })
                                    } else if is_bad_repeat
                                        && beh.reject_bad_repeat.load(Ordering::Acquire)
                                    {
                                        json!({
                                            "id": val["id"],
                                            "error": { "code": -32000, "message": "simulated key repeat error" }
                                        })
                                    } else {
                                        json!({ "id": val["id"], "result": { "ok": true } })
                                    };
                                    if socket
                                        .send(AxumWsMsg::Text(reply.to_string().into()))
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                                AxumWsMsg::Ping(payload) => {
                                    if socket.send(AxumWsMsg::Pong(payload)).await.is_err() {
                                        break;
                                    }
                                }
                                AxumWsMsg::Close(_) => break,
                                _ => {}
                            }
                        }
                    })
                }
            },
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (port, recorded, behavior)
}

#[tokio::test]
async fn test_devtools_control_transfer_race_and_stale_refresh_denial() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, seen_methods, _, _) =
        spawn_mock_chromium_server("TARGET-XFER".into()).await;
    let (store, auth_service, tokens) =
        setup_sqlite_multi_session(tmp.path(), "dt-xfer", &["auth-a", "auth-b"]).await;
    let state = create_test_state(
        tmp.path().to_path_buf(),
        Some(store),
        Some(BrowserHostConfig {
            enabled: true,
            ..BrowserHostConfig::default()
        }),
    )
    .with_auth_service(auth_service);
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: "dt-xfer".into(),
        is_dev: false,
        pid: 1,
        ws_endpoint: format!("ws://127.0.0.1:{mock_port}/devtools/browser/mock"),
        browser_incarnation: "inc-xfer".into(),
        profile_epoch: 1,
        user_data_dir: tmp.path().to_path_buf(),
    });
    let app = build_router_with_origins(
        state,
        vec![HeaderValue::from_static("http://127.0.0.1:5173")],
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    let sid = insert_running_session("dt-xfer", false, "inc-xfer", "TARGET-XFER").await;
    let client = reqwest::Client::new();
    let pair_a = admit_paired_viewer("dt-xfer", "auth-a", &sid, "viewer-a", "inc-xfer").await;
    let pair_b = admit_paired_viewer("dt-xfer", "auth-b", &sid, "viewer-b", "inc-xfer").await;

    // 1. viewer-a acquires control and mints DevTools lease (bound to viewer-a & epoch1)
    let lease_a = acquire_control_http(&client, addr, &sid, &tokens[0], "viewer-a").await;
    let mint_a_resp = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[0]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "viewerId": "viewer-a", "leaseToken": lease_a }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(mint_a_resp.status(), StatusCode::OK);
    let mint_a = resp_json(mint_a_resp).await;
    assert_eq!(mint_a["viewerId"], "viewer-a");
    let epoch_a = mint_a["controlEpoch"].as_str().unwrap().to_string();
    let dt_tok_a = mint_a["token"].as_str().unwrap().to_string();

    let (mut ws_a, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{dt_tok_a}/ws"))
            .await
            .expect("viewer-a devtools ws connects");
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next())
        .await
        .unwrap();

    // 2. Same-epoch control/renew preserves existing DevTools socket and capability
    let renew_resp = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/control/renew"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[0]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "leaseToken": lease_a }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(renew_resp.status(), StatusCode::OK);
    ws_a.send(WsMsg::Text(
        json!({"id": 1, "method": "Runtime.enable"}).to_string().into(),
    ))
    .await
    .unwrap();
    loop {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let val: Value = serde_json::from_str(msg.to_text().unwrap()).unwrap();
        if val.get("id") == Some(&json!(1)) {
            assert_eq!(val["result"]["ok"], true);
            break;
        }
    }

    // 3. Mint an unused second DevTools token for viewer-a to verify post-transfer connect/refresh denial
    let unused_a_tok =
        mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_a).await;

    // 4. Cooperative control check: viewer-b cannot steal live control without release (409 Conflict)
    let steal_attempt = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/control/acquire"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "viewerId": "viewer-b", "holderKind": "human" }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(steal_attempt.status(), StatusCode::CONFLICT);

    // Release viewer-a control -> closes viewer-a WS, revokes viewer-a asset/WS tokens
    let release_a_resp = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/control/release"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[0]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "leaseToken": lease_a }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(release_a_resp.status(), StatusCode::OK);
    let _lease_b1 = acquire_control_http(&client, addr, &sid, &tokens[1], "viewer-b").await;
    let closed_a = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next())
        .await
        .unwrap();
    assert!(matches!(
        closed_a,
        None | Some(Ok(WsMsg::Close(_))) | Some(Err(_))
    ));
    let commands_after_transfer = seen_methods.lock().len();

    let asset_after = client
        .get(format!(
            "http://{addr}/api/browser/devtools/{dt_tok_a}/devtools_app.html"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(asset_after.status(), StatusCode::UNAUTHORIZED);

    let stale_ws_err = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/api/browser/devtools/{unused_a_tok}/ws"
    ))
    .await
    .unwrap_err();
    let tokio_tungstenite::tungstenite::Error::Http(stale_ws_resp) = stale_ws_err else {
        panic!("expected HTTP rejection for stale devtools WS token, got {stale_ws_err:?}");
    };
    assert_eq!(stale_ws_resp.status(), StatusCode::UNAUTHORIZED);

    // viewer-a cannot re-mint with its revoked lease token
    let stale_mint = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[0]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "viewerId": "viewer-a", "leaseToken": lease_a }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(stale_mint.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        seen_methods.lock().len(),
        commands_after_transfer,
        "no post-fence DevTools commands may reach mock Chromium"
    );

    // 5. Same-viewer reacquire (viewer-b -> viewer-b) rotates controlEpoch and revokes prior epoch's DevTools token
    let mint_b1 = resp_json(
        client
            .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
            .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
            .header(ORIGIN, "http://127.0.0.1:5173")
            .header(CONTENT_TYPE, "application/json")
            .body(json!({ "viewerId": "viewer-b", "leaseToken": _lease_b1 }).to_string())
            .send()
            .await
            .unwrap(),
    )
    .await;
    let dt_tok_b1 = mint_b1["token"].as_str().unwrap().to_string();
    let epoch_b1 = mint_b1["controlEpoch"].as_str().unwrap().to_string();
    assert_ne!(epoch_a, epoch_b1);
    let b1_ok = client
        .get(format!(
            "http://{addr}/api/browser/devtools/{dt_tok_b1}/devtools_app.html"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(b1_ok.status(), StatusCode::OK);

    let lease_b2 = acquire_control_http(&client, addr, &sid, &tokens[1], "viewer-b").await;
    assert_ne!(_lease_b1, lease_b2);
    let b1_after_reacquire = client
        .get(format!(
            "http://{addr}/api/browser/devtools/{dt_tok_b1}/devtools_app.html"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(b1_after_reacquire.status(), StatusCode::UNAUTHORIZED);

    pair_a.release().await;
    pair_b.release().await;
    cleanup_test_session_viewers(&sid).await;
}

#[tokio::test]
async fn test_devtools_shared_input_ledger_ordered_release_and_stalled_write_cancel() {
    use dam_hopper_server::browser_host::cdp_gateway::{write_with_cancel, WriteOutcome};

    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, recorded_cmds, behavior) =
        spawn_programmable_cdp_server("TARGET-LEDGER".into()).await;
    let (store, auth_service, tokens) =
        setup_sqlite_multi_session(tmp.path(), "dt-ledger", &["auth-a", "auth-b"]).await;
    let state = create_test_state(
        tmp.path().to_path_buf(),
        Some(store),
        Some(BrowserHostConfig {
            enabled: true,
            ..BrowserHostConfig::default()
        }),
    )
    .with_auth_service(auth_service);
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: "dt-ledger".into(),
        is_dev: false,
        pid: 1,
        ws_endpoint: format!("ws://127.0.0.1:{mock_port}/devtools/browser/mock"),
        browser_incarnation: "inc-ledger".into(),
        profile_epoch: 1,
        user_data_dir: tmp.path().to_path_buf(),
    });
    let app = build_router_with_origins(
        state,
        vec![HeaderValue::from_static("http://127.0.0.1:5173")],
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    let sid = insert_running_session("dt-ledger", false, "inc-ledger", "TARGET-LEDGER").await;
    let client = reqwest::Client::new();
    let pair_a = admit_paired_viewer("dt-ledger", "auth-a", &sid, "viewer-a", "inc-ledger").await;
    let pair_b = admit_paired_viewer("dt-ledger", "auth-b", &sid, "viewer-b", "inc-ledger").await;

    let lease_a = acquire_control_http(&client, addr, &sid, &tokens[0], "viewer-a").await;
    let dt_tok_a =
        mint_devtools_probe_token(&client, addr, &sid, &tokens[0], "viewer-a", &lease_a).await;
    let (mut ws_a, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{dt_tok_a}/ws"))
            .await
            .expect("connect devtools ws for ledger test");

    // 1. Denied unsupported Input.* methods fail before reaching mock Chromium
    for (id, method, params) in [
        (10, "Input.dispatchTouchEvent", json!({ "type": "touchStart", "touchPoints": [] })),
        (11, "Input.dispatchDragEvent", json!({ "type": "dragEnter", "x": 10, "y": 10, "data": { "items": [], "dragOperationsMask": 1 } })),
        (12, "Input.synthesizeTapGesture", json!({ "x": 10, "y": 10 })),
        (13, "Input.imeSetComposition", json!({ "text": "a", "selectionStart": 0, "selectionEnd": 1 })),
        (14, "Input.setIgnoreInputEvents", json!({ "ignore": true })),
        (15, "Input.unknownMethod", json!({})),
    ] {
        ws_a.send(WsMsg::Text(
            json!({ "id": id, "method": method, "params": params })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let val: Value = serde_json::from_str(reply.to_text().unwrap()).unwrap();
        assert_eq!(val["id"], id);
        assert_eq!(val["error"]["code"], -32601);
    }
    assert!(
        recorded_cmds.lock().is_empty(),
        "denied Input.* methods must never reach Chromium"
    );

    // 2. Send supported keyDown KeyA, mousePressed left, insertText, plus failed repeat keyDown
    for (id, method, params) in [
        (
            20,
            "Input.dispatchKeyEvent",
            json!({ "type": "keyDown", "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65 }),
        ),
        (
            21,
            "Input.dispatchMouseEvent",
            json!({ "type": "mousePressed", "x": 40, "y": 50, "button": "left", "clickCount": 1 }),
        ),
        (22, "Input.insertText", json!({ "text": "hello" })),
    ] {
        ws_a.send(WsMsg::Text(
            json!({ "id": id, "method": method, "params": params })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let val: Value = serde_json::from_str(reply.to_text().unwrap()).unwrap();
        assert_eq!(val["id"], id);
        assert_eq!(val["result"]["ok"], true);
    }
    behavior.reject_bad_repeat.store(true, Ordering::Release);
    ws_a.send(WsMsg::Text(
        json!({
            "id": 23,
            "method": "Input.dispatchKeyEvent",
            "params": { "type": "keyDown", "key": "BadRepeat", "code": "KeyA", "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let repeat_err_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let repeat_err_val: Value = serde_json::from_str(repeat_err_reply.to_text().unwrap()).unwrap();
    assert_eq!(repeat_err_val["id"], 23);
    assert_eq!(repeat_err_val["error"]["code"], -32000);

    // 3. Control release + handoff to viewer-b releases mousePressed & KeyA via captured DevTools proxy BEFORE returning 200 OK
    let count_before_transfer = recorded_cmds.lock().len();
    let release_a_resp = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/control/release"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[0]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "leaseToken": lease_a }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(release_a_resp.status(), StatusCode::OK);
    let post_transfer_cmds: Vec<(String, Value)> = recorded_cmds.lock()[count_before_transfer..].to_vec();
    let lease_b = acquire_control_http(&client, addr, &sid, &tokens[1], "viewer-b").await;
    let saw_mouse_release = post_transfer_cmds.iter().any(|(m, p)| {
        m == "Input.dispatchMouseEvent"
            && p.get("type").and_then(Value::as_str) == Some("mouseReleased")
            && p.get("button").and_then(Value::as_str) == Some("left")
    });
    let saw_key_release = post_transfer_cmds.iter().any(|(m, p)| {
        m == "Input.dispatchKeyEvent"
            && p.get("type").and_then(Value::as_str) == Some("keyUp")
            && p.get("code").and_then(Value::as_str) == Some("KeyA")
    });
    assert!(
        saw_mouse_release && saw_key_release,
        "control transfer must release held mouse & key BEFORE returning 200 OK; saw={post_transfer_cmds:?}"
    );
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), ws_a.next()).await;

    // 4. Closing DevTools WS with zero holds leaves UI control lease live; closing while holding KeyZ releases KeyZ
    let dt_tok_b1 =
        mint_devtools_probe_token(&client, addr, &sid, &tokens[1], "viewer-b", &lease_b).await;
    let (ws_b1, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{dt_tok_b1}/ws"))
            .await
            .unwrap();
    drop(ws_b1);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let renew_after_clean_close = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/control/renew"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "leaseToken": lease_b }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(renew_after_clean_close.status(), StatusCode::OK);

    let dt_tok_b2 =
        mint_devtools_probe_token(&client, addr, &sid, &tokens[1], "viewer-b", &lease_b).await;
    let (mut ws_b2, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{dt_tok_b2}/ws"))
            .await
            .unwrap();
    ws_b2
        .send(WsMsg::Text(
            json!({
                "id": 30,
                "method": "Input.dispatchKeyEvent",
                "params": { "type": "keyDown", "key": "z", "code": "KeyZ", "windowsVirtualKeyCode": 90, "nativeVirtualKeyCode": 90 }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let z_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws_b2.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(z_reply.to_text().unwrap()).unwrap()["result"]["ok"], true);
    let count_before_ws_close = recorded_cmds.lock().len();
    drop(ws_b2);
    let release_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    let mut released_z = false;
    while tokio::time::Instant::now() < release_deadline {
        let cmds = recorded_cmds.lock();
        if cmds[count_before_ws_close..].iter().any(|(m, p)| {
            m == "Input.dispatchKeyEvent"
                && p.get("type").and_then(Value::as_str) == Some("keyUp")
                && p.get("code").and_then(Value::as_str) == Some("KeyZ")
        }) {
            released_z = true;
            break;
        }
        drop(cmds);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(released_z, "closing DevTools WS while holding KeyZ must release KeyZ");

    // 5. Failed cleanup on control release/reacquire rejects with 503 inputUnavailable
    let lease_b2 = acquire_control_http(&client, addr, &sid, &tokens[1], "viewer-b").await;
    let dt_tok_b3 =
        mint_devtools_probe_token(&client, addr, &sid, &tokens[1], "viewer-b", &lease_b2).await;
    let (mut ws_b3, _) =
        tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{dt_tok_b3}/ws"))
            .await
            .unwrap();
    ws_b3
        .send(WsMsg::Text(
            json!({
                "id": 40,
                "method": "Input.dispatchKeyEvent",
                "params": { "type": "keyDown", "key": "k", "code": "KeyK", "windowsVirtualKeyCode": 75, "nativeVirtualKeyCode": 75 }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let k_reply = tokio::time::timeout(std::time::Duration::from_secs(2), ws_b3.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(k_reply.to_text().unwrap()).unwrap()["result"]["ok"], true);

    behavior.reject_keyup.store(true, Ordering::Release);
    let failed_transfer_resp = client
        .post(format!("http://{addr}/api/browser/sessions/{sid}/control/release"))
        .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "leaseToken": lease_b2 }).to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(
        failed_transfer_resp.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    behavior.reject_keyup.store(false, Ordering::Release);

    // 6. Stalled write_with_cancel aborts promptly when cancellation token triggers
    let (_abort_tx, mut abort_rx) = tokio::sync::mpsc::channel::<()>(1);
    let cancel_tok = tokio_util::sync::CancellationToken::new();
    let cancel_trigger = cancel_tok.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        cancel_trigger.cancel();
    });
    let start = tokio::time::Instant::now();
    let (outcome, aborted) = write_with_cancel(
        futures_util::future::pending::<Result<(), ()>>(),
        &mut abort_rx,
        None,
        Some(&cancel_tok),
    )
    .await;
    assert_eq!(outcome, WriteOutcome::Failed);
    assert!(aborted);
    assert!(
        start.elapsed() < std::time::Duration::from_millis(500),
        "write_with_cancel must cancel immediately rather than waiting 5s WRITE_DEADLINE"
    );

    drop(ws_b3);
    pair_a.release().await;
    pair_b.release().await;
    cleanup_test_session_viewers(&sid).await;
}
