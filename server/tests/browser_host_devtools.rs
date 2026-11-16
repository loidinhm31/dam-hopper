use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
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
use dam_hopper_server::api::browser_host::global_session_registry;
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION;
use dam_hopper_server::auth::{AuthService, AuthStore, SystemClock};
use dam_hopper_server::browser_host::config::BrowserHostConfig;
use dam_hopper_server::browser_host::manager::BrowserInstanceHandle;
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

async fn spawn_mock_chromium_server(expected_target_id: String) -> (u16, Arc<Mutex<Vec<String>>>) {
    let seen_methods = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen_clone = seen_methods.clone();
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
                async move {
                    if tid != exp {
                        return StatusCode::NOT_FOUND.into_response();
                    }
                    ws.on_upgrade(move |mut socket| async move {
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
                        while let Some(Ok(AxumWsMsg::Text(txt))) = socket.next().await {
                            let val: Value = serde_json::from_str(&txt).unwrap();
                            if let Some(m) = val.get("method").and_then(Value::as_str) {
                                seen.lock().push(m.to_string());
                            }
                            let reply = json!({ "id": val["id"], "result": { "ok": true } });
                            if socket.send(AxumWsMsg::Text(reply.to_string().into())).await.is_err() {
                                break;
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
    (port, seen_methods)
}

async fn resp_json(resp: reqwest::Response) -> Value {
    let bytes = resp.bytes().await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
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

    // Foreign principal cannot mint lease -> 404
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
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Mint 8 leases (cap) -> 9th returns 429
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
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&axum::body::to_bytes(resp.into_body(), 65536).await.unwrap())
                .unwrap();
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
                .body(Body::empty())
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
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(conflict_resp.status(), StatusCode::CONFLICT);

    // DELETE revokes one lease and frees slot; session DELETE revokes all
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
}

#[tokio::test]
async fn test_devtools_asset_proxy_csp_and_path_traversal() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, _) = spawn_mock_chromium_server("TARGET-ASSET".into()).await;
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

    let mint_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/browser/sessions/{sid}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
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
}

#[tokio::test]
async fn test_devtools_ws_target_isolation_geometry_fence_and_revocation() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, seen_methods) = spawn_mock_chromium_server("TARGET-WS".into()).await;
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
    let lease_a = resp_json(
        client
            .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
            .header(AUTHORIZATION, format!("Bearer {}", tokens[0]))
            .header(ORIGIN, "http://127.0.0.1:5173")
            .send()
            .await
            .unwrap(),
    )
    .await;
    let lease_b = resp_json(
        client
            .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
            .header(AUTHORIZATION, format!("Bearer {}", tokens[1]))
            .header(ORIGIN, "http://127.0.0.1:5173")
            .send()
            .await
            .unwrap(),
    )
    .await;
    let tok_a = lease_a["token"].as_str().unwrap();
    let tok_b = lease_b["token"].as_str().unwrap();

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{tok_a}/ws"))
        .await
        .expect("connect devtools ws");

    // Second WS with same token rejected with 409 Conflict
    let dup = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{tok_a}/ws")).await;
    assert!(dup.is_err(), "duplicate WS for same token must be rejected");

    // Upstream foreign page Target.targetCreated dropped; worker forwarded
    let first_evt = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let first_val: Value = serde_json::from_str(first_evt.to_text().unwrap()).unwrap();
    assert_eq!(first_val["params"]["targetInfo"]["targetId"], "CHILD-WORKER");

    // Geometry, Browser.*, and cross-target Target.* rejected with -32601
    for (id, method, params) in [
        (1, "Emulation.clearDeviceMetricsOverride", json!({})),
        (2, "Emulation.setDeviceMetricsOverride", json!({"width": 500, "height": 500, "deviceScaleFactor": 1, "mobile": false})),
        (3, "Browser.getVersion", json!({})),
        (4, "Target.getTargets", json!({})),
        (5, "Target.sendMessageToTarget", json!({"sessionId": "x", "message": "{}"})),
        (6, "Target.attachToTarget", json!({"targetId": "OTHER-TAB"})),
    ] {
        ws.send(WsMsg::Text(json!({"id": id, "method": method, "params": params}).to_string().into()))
            .await
            .unwrap();
        let reply = ws.next().await.unwrap().unwrap();
        let parsed: Value = serde_json::from_str(reply.to_text().unwrap()).unwrap();
        assert_eq!(parsed["id"], id);
        assert_eq!(parsed["error"]["code"], -32601);
    }

    // Allowed Runtime.enable reaches upstream
    ws.send(WsMsg::Text(json!({"id": 99, "method": "Runtime.enable"}).to_string().into()))
        .await
        .unwrap();
    let ok_reply = ws.next().await.unwrap().unwrap();
    let ok_val: Value = serde_json::from_str(ok_reply.to_text().unwrap()).unwrap();
    assert_eq!(ok_val["id"], 99);
    assert_eq!(ok_val["result"]["ok"], true);
    assert_eq!(seen_methods.lock().as_slice(), &["Runtime.enable"]);

    // Session input_available remains true
    let snap = global_session_registry().snapshot(&sid, "dt-ws").await.unwrap();
    assert!(snap.dto.input_available, "input_available must stay true");

    // Single-session auth revocation (DELETE /api/auth/sessions/auth-a) closes auth-a WS while auth-b survives
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
    let b_after = client
        .get(format!("http://{addr}/api/browser/devtools/{tok_b}/devtools_app.html"))
        .send()
        .await
        .unwrap();
    assert_eq!(b_after.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_devtools_ws_enforces_max_concurrent_connections() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let tmp = tempdir().unwrap();
    let (mock_port, _) = spawn_mock_chromium_server("TARGET-MAX".into()).await;
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
    let mut sockets = Vec::new();
    for _ in 0..4 {
        let lease = resp_json(
            client
                .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
                .header(AUTHORIZATION, format!("Bearer {tok}"))
                .header(ORIGIN, "http://127.0.0.1:5173")
                .send()
                .await
                .unwrap(),
        )
        .await;
        let t = lease["token"].as_str().unwrap();
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{t}/ws"))
            .await
            .unwrap();
        sockets.push(ws);
    }
    let fifth = resp_json(
        client
            .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
            .header(AUTHORIZATION, format!("Bearer {tok}"))
            .header(ORIGIN, "http://127.0.0.1:5173")
            .send()
            .await
            .unwrap(),
    )
    .await;
    let fifth_tok = fifth["token"].as_str().unwrap();
    let err = tokio_tungstenite::connect_async(format!("ws://{addr}/api/browser/devtools/{fifth_tok}/ws"))
        .await
        .unwrap_err();
    let tokio_tungstenite::tungstenite::Error::Http(resp) = err else {
        panic!("expected HTTP 429 rejection, got {err:?}");
    };
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    drop(sockets);
}

#[tokio::test]
async fn test_real_chromium_devtools_and_native_host_downloads() {
    let _serial = TEST_SERIAL.lock().await;
    global_session_registry().reset_for_test().await;
    let Some(chromium_path) = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
    else {
        eprintln!("SKIP: Chromium binary not found");
        return;
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
        allowed_target_origins: vec![format!("http://127.0.0.1:{site_port}")],
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
    assert_eq!(create_resp.status(), StatusCode::CREATED);
    let created = resp_json(create_resp).await;
    let sid = created["browserSessionId"].as_str().unwrap().to_string();

    // 1. Mint DevTools lease and fetch real Chromium devtools_app.html
    let lease = resp_json(
        client
            .post(format!("http://{addr}/api/browser/sessions/{sid}/devtools"))
            .header(AUTHORIZATION, format!("Bearer {tok}"))
            .header(ORIGIN, "http://127.0.0.1:5173")
            .send()
            .await
            .unwrap(),
    )
    .await;
    let dt_tok = lease["token"].as_str().unwrap();
    let dt_html = client
        .get(format!("http://{addr}/api/browser/devtools/{dt_tok}/devtools_app.html"))
        .send()
        .await
        .unwrap();
    assert_eq!(dt_html.status(), StatusCode::OK);
    let html_txt = dt_html.text().await.unwrap();
    assert!(html_txt.contains("devtools_app"), "must serve real Chromium devtools_app.html");
    assert!(html_txt.contains("'self' ws: wss: ws://127.0.0.1:*"));

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
        if dto.pointer("/lastDownload/state") == Some(&json!("completed")) {
            final_dto = dto;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(final_dto.pointer("/lastDownload/state"), Some(&json!("completed")));
    assert_eq!(final_dto.get("inputAvailable"), Some(&json!(true)));

    drop(ws);
    let _ = client
        .delete(format!("http://{addr}/api/browser/sessions/{sid}"))
        .header(AUTHORIZATION, format!("Bearer {tok}"))
        .header(ORIGIN, "http://127.0.0.1:5173")
        .send()
        .await;
    state.browser_host.shutdown_all().await;
}
