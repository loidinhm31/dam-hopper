mod common;

use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use base64::Engine;
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    auth::{
        chrono_to_bson,
        model::{AuthClaims, AuthSession, UserRecord, UserRole},
        AuthService, AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS,
    },
    browser_host::manager::BrowserInstanceHandle,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtyCreateOpts, PtySessionManager},
    state::AppState,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};
use futures_util::{SinkExt, StreamExt};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tower::ServiceExt;

const TOKEN: &str = "selection-test-secret-token";

fn make_admin_state(tmp: &tempfile::TempDir, username: &str, role: UserRole) -> (AppState, String) {
    let root = tmp.path().to_path_buf();
    let mut server_cfg = dam_hopper_server::config::ServerConfig::default();
    server_cfg.browser.enabled = true;
    server_cfg.browser.profile_root = Some(root.join("browser-profiles"));
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: server_cfg,
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: root.join("dam-hopper.toml"),
    };
    let (sink, _) = BroadcastEventSink::new(8);
    let tunnels = TunnelSessionManager::new(Arc::new(sink.clone()), Arc::new(CloudflaredDriver));

    let now = chrono::Utc::now();
    let exp_chrono = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
    let user = UserRecord {
        id: None,
        username: username.to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session_id = format!("sess-{username}");
    let session = AuthSession {
        id: session_id.clone(),
        username: username.to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp_chrono),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };
    let auth_svc = AuthService::new_mock(user, session);

    let state = AppState::new(
        root.clone(),
        config,
        GlobalConfig::default(),
        PtySessionManager::new(Arc::new(NoopEventSink::default())),
        AgentStoreService::new(root.join(".dam-hopper/agent-store")),
        sink,
        TOKEN.into(),
        FsSubsystem::new(vec![]),
        None,
        false,
        tunnels,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(root.join("diagnostics.jsonl")),
    )
    .unwrap()
    .with_auth_service(Arc::new(auth_svc));

    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: username.to_string(),
        sid: session_id,
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    let cookie = format!("damhopper-auth={}", claims.encode(TOKEN).unwrap());
    (state, cookie)
}

async fn api_request(
    state: AppState,
    method: &str,
    path: &str,
    cookie: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Cookie", cookie);
    let body_bytes = if let Some(b) = body {
        builder = builder.header("Content-Type", "application/json");
        Body::from(b.to_string())
    } else {
        Body::empty()
    };
    let resp = build_router(state)
        .oneshot(builder.body(body_bytes).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json_val)
}

fn valid_png_bytes() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_chunk(&mut png, b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    append_chunk(
        &mut png,
        b"IDAT",
        &[
            0x78, 0x01, 0x01, 0x05, 0x00, 0xfa, 0xff, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x00, 0x01,
        ],
    );
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn append_chunk(target: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    target.extend_from_slice(&(data.len() as u32).to_be_bytes());
    target.extend_from_slice(kind);
    target.extend_from_slice(data);
    target.extend_from_slice(&crc32(&[kind.as_slice(), data].concat()).to_be_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 0 {
                crc >> 1
            } else {
                (crc >> 1) ^ 0xedb8_8320
            };
        }
    }
    !crc
}

static TEST_SERIAL_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

struct MockCdpServer {
    ws_url: String,
    received_methods: Arc<Mutex<Vec<String>>>,
    event_tx: tokio::sync::broadcast::Sender<Value>,
}

async fn start_mock_cdp_server(extracted_payload: Value) -> MockCdpServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let ws_url = format!("ws://127.0.0.1:{port}/devtools/browser/mock");
    let received_methods = Arc::new(Mutex::new(Vec::new()));
    let methods_clone = received_methods.clone();
    let (event_tx, _) = tokio::sync::broadcast::channel::<Value>(32);
    let event_tx_clone = event_tx.clone();

    let png_b64 = base64::engine::general_purpose::STANDARD.encode(valid_png_bytes());

    tokio::spawn(async move {
        let mut target_seq = 0usize;
        while let Ok((stream, _)) = listener.accept().await {
            let methods = methods_clone.clone();
            let extracted = extracted_payload.clone();
            let png_b64 = png_b64.clone();
            let mut ev_rx = event_tx_clone.subscribe();
            target_seq += 1;
            let current_seq = target_seq;

            tokio::spawn(async move {
                let Ok(ws_stream) = tokio_tungstenite::accept_async(stream).await else {
                    return;
                };
                let (mut sink, mut stream_rx) = ws_stream.split();
                let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

                let out_tx_ev = out_tx.clone();
                tokio::spawn(async move {
                    while let Ok(ev) = ev_rx.recv().await {
                        let _ = out_tx_ev.send(ev.to_string());
                    }
                });
                tokio::spawn(async move {
                    while let Some(msg) = out_rx.recv().await {
                        if sink.send(WsMessage::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                });

                while let Some(Ok(msg)) = stream_rx.next().await {
                    let WsMessage::Text(text) = msg else { continue };
                    let Ok(val) = serde_json::from_str::<Value>(&text) else { continue };
                    let id = val.get("id").and_then(Value::as_u64).unwrap_or(0);
                    let method = val.get("method").and_then(Value::as_str).unwrap_or("");
                    let session_id = val.get("sessionId").cloned();
                    methods.lock().unwrap().push(method.to_string());

                    let result = match method {
                        "Target.createTarget" => json!({ "targetId": format!("mock-target-{current_seq}") }),
                        "Target.attachToTarget" => json!({ "sessionId": format!("mock-page-sid-{current_seq}") }),
                        "DOM.getNodeForLocation" => json!({ "backendNodeId": 42 }),
                        "DOM.resolveNode" => json!({ "object": { "objectId": "mock-obj-1" } }),
                        "Runtime.callFunctionOn" => json!({ "result": { "value": extracted } }),
                        "Page.captureScreenshot" => json!({ "data": png_b64 }),
                        _ => json!({}),
                    };

                    let mut resp = json!({ "id": id, "result": result });
                    if let Some(sid) = session_id {
                        resp.as_object_mut().unwrap().insert("sessionId".into(), sid);
                    }
                    let _ = out_tx.send(resp.to_string());
                }
            });
        }
    });

    MockCdpServer {
        ws_url,
        received_methods,
        event_tx,
    }
}

fn create_test_terminal(state: &AppState, id: &str, dir: &std::path::Path) -> u64 {
    state
        .pty_manager
        .create(PtyCreateOpts {
            id: id.into(),
            command: common::read_stdin_command().into(),
            cwd: dir.display().to_string(),
            env: Default::default(),
            cols: 80,
            rows: 24,
            project: None,
            worktree_path: None,
            name: None,
            restart_policy: Default::default(),
            restart_max_retries: 0,
        })
        .unwrap()
        .incarnation
}

#[tokio::test]
async fn selection_extracts_sanitized_preview_creates_managed_png_and_hands_off_atomically() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-sel-{}", uuid::Uuid::new_v4());
    let (state, cookie) = make_admin_state(&temp, &username, UserRole::Admin);

    let extracted = json!({
        "tag": "BUTTON",
        "role": "button\x07",
        "accessibleName": "Submit Order",
        "text": "Submit\nOrder",
        "value": "should-never-appear",
        "innerHTML": "<script>evil()</script>",
        "attributes": {
            "id": "submit-btn",
            "data-testid": "order-submit",
            "onclick": "steal()"
        },
        "locator": "form > button#submit-btn",
        "bounds": { "x": 12.0, "y": 24.0, "width": 120.0, "height": 40.0 }
    });
    let cdp = start_mock_cdp_server(extracted).await;

    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9999,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    // 1. Create browser session
    let (status, sess) = api_request(
        state.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/app",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    assert!(status == StatusCode::CREATED || status == StatusCode::OK);
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    // 2. Acquire control lease
    let (status, lease) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie,
        Some(json!({ "viewerId": "viewer-1", "holderKind": "human" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();

    // 3. Start selection with inspectPoint
    let (status, sel_res) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/start"),
        &cookie,
        Some(json!({
            "leaseToken": lease_token,
            "navigationRevision": 1,
            "inspectPoint": { "x": 50, "y": 40 }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let sel_rev = sel_res["selectionRevision"].as_u64().unwrap();
    assert_eq!(sel_res["preview"]["tag"], "button");
    assert_eq!(sel_res["preview"]["role"], "button");
    assert!(!sel_res["preview"]["attributes"]
        .as_object()
        .unwrap()
        .contains_key("onclick"));

    // 4. Create terminal & verify client-forged fields rejected
    let inc = create_test_terminal(&state, "shell:sel-1", temp.path());
    let (forged_status, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie,
        Some(json!({
            "selectionRevision": sel_rev,
            "terminalId": "shell:sel-1",
            "terminalIncarnation": inc,
            "source": "Cooperative",
            "owner": "someone-else"
        })),
    )
    .await;
    assert!(
        forged_status == StatusCode::BAD_REQUEST || forged_status == StatusCode::UNPROCESSABLE_ENTITY
    );

    // 5. Create ManagedBrowser selection artifact with bounded PNG
    let (art_status, art) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie,
        Some(json!({
            "selectionRevision": sel_rev,
            "terminalId": "shell:sel-1",
            "terminalIncarnation": inc.to_string(),
            "navigationRevision": 1,
            "includePng": true
        })),
    )
    .await;
    assert_eq!(art_status, StatusCode::CREATED);
    let artifact_id = art["artifactId"].as_str().unwrap().to_string();
    assert!(art["pngPath"].as_str().is_some());

    let methods = cdp.received_methods.lock().unwrap().clone();
    assert!(methods.contains(&"Page.captureScreenshot".to_string()));

    // 6. Handoff to exact terminal
    let (ho_status, ho_body) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser-debug/artifacts/{artifact_id}/handoff"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(ho_status, StatusCode::OK);
    assert_eq!(ho_body["inserted"], true);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let written = state.pty_manager.get_buffer("shell:sel-1").unwrap();
    assert!(written.contains("[DamHopper browser-debug artifact (untrusted page data): JSON "));
    assert!(written.contains("; PNG "));
    assert!(!written.contains("Submit Order"));
    assert!(!written.contains("should-never-appear"));
    let _ = api_request(state, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie, None).await;
}

#[tokio::test]
async fn terminal_replacement_and_navigation_invalidate_pending_handoff() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-race-{}", uuid::Uuid::new_v4());
    let (state, cookie) = make_admin_state(&temp, &username, UserRole::Admin);

    let extracted = json!({
        "tag": "div",
        "text": "Card",
        "attributes": { "id": "card" },
        "locator": "div#card",
        "bounds": { "x": 0, "y": 0, "width": 100, "height": 50 }
    });
    let cdp = start_mock_cdp_server(extracted).await;
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9998,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    let (_, sess) = api_request(
        state.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/page1",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    let (_, lease) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie,
        Some(json!({ "viewerId": "v1", "holderKind": "human" })),
    )
    .await;
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();

    let (_, sel) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/start"),
        &cookie,
        Some(json!({
            "leaseToken": lease_token,
            "navigationRevision": 1,
            "inspectPoint": { "x": 10, "y": 10 }
        })),
    )
    .await;
    let sel_rev = sel["selectionRevision"].as_u64().unwrap();

    // Terminal 1 and ambient Terminal 2
    let inc1 = create_test_terminal(&state, "shell:target", temp.path());
    let _inc2 = create_test_terminal(&state, "shell:ambient", temp.path());

    // Create artifact bound to shell:target@inc1
    let (status, art) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie,
        Some(json!({
            "selectionRevision": sel_rev,
            "terminalId": "shell:target",
            "terminalIncarnation": inc1,
            "includePng": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let art_id = art["artifactId"].as_str().unwrap().to_string();

    // Replace shell:target before handoff
    state.pty_manager.kill("shell:target").unwrap();
    let inc1_replaced = create_test_terminal(&state, "shell:target", temp.path());
    assert_ne!(inc1, inc1_replaced);

    let (ho_status, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser-debug/artifacts/{art_id}/handoff"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(ho_status, StatusCode::CONFLICT);

    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    // Neither replacement nor ambient terminal received any bytes
    let buf_replaced = state.pty_manager.get_buffer("shell:target").unwrap();
    assert!(!buf_replaced.contains("browser-debug artifact"));
    let buf_ambient = state.pty_manager.get_buffer("shell:ambient").unwrap();
    assert!(!buf_ambient.contains("browser-debug artifact"));

    // Navigate invalidates pending artifact and selection preview
    let (nav_status, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/navigate"),
        &cookie,
        Some(json!({ "url": "http://example.com/page2", "navigationRevision": 1 })),
    )
    .await;
    assert_eq!(nav_status, StatusCode::OK);

    // Pending artifact was revoked upon navigation -> 404 NotFound
    let (post_nav_ho, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser-debug/artifacts/{art_id}/handoff"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(post_nav_ho, StatusCode::NOT_FOUND);

    // Stale selectionRevision cannot create new artifacts -> 409 Conflict
    let (stale_art_status, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie,
        Some(json!({
            "selectionRevision": sel_rev,
            "terminalId": "shell:ambient",
            "terminalIncarnation": _inc2
        })),
    )
    .await;
    assert_eq!(stale_art_status, StatusCode::CONFLICT);
    let _ = api_request(state, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie, None).await;
}

#[tokio::test]
async fn demoted_admin_cannot_handoff_managed_selection_artifact() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-demote-{}", uuid::Uuid::new_v4());
    let (state_admin, cookie_admin) = make_admin_state(&temp, &username, UserRole::Admin);

    let extracted = json!({
        "tag": "span",
        "text": "Secret Admin Item",
        "attributes": {},
        "locator": "span",
        "bounds": { "x": 0, "y": 0, "width": 50, "height": 20 }
    });
    let cdp = start_mock_cdp_server(extracted).await;
    *state_admin.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9997,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    let (_, sess) = api_request(
        state_admin.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie_admin,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/admin",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    let (_, lease) = api_request(
        state_admin.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie_admin,
        Some(json!({ "viewerId": "v1", "holderKind": "human" })),
    )
    .await;
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();

    let (_, sel) = api_request(
        state_admin.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/start"),
        &cookie_admin,
        Some(json!({
            "leaseToken": lease_token,
            "navigationRevision": 1,
            "inspectPoint": { "x": 5, "y": 5 }
        })),
    )
    .await;
    let sel_rev = sel["selectionRevision"].as_u64().unwrap();
    let inc = create_test_terminal(&state_admin, "shell:demote", temp.path());

    let (status, art) = api_request(
        state_admin.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie_admin,
        Some(json!({
            "selectionRevision": sel_rev,
            "terminalId": "shell:demote",
            "terminalIncarnation": inc,
            "includePng": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let art_id = art["artifactId"].as_str().unwrap().to_string();

    // Demote the same subject to ordinary User
    let now = chrono::Utc::now();
    let exp_chrono = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
    let demoted_user = UserRecord {
        id: None,
        username: username.clone(),
        password_hash: String::new(),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session = AuthSession {
        id: format!("sess-{username}"),
        username: username.clone(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp_chrono),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };
    let demoted_state = state_admin
        .clone()
        .with_auth_service(Arc::new(AuthService::new_mock(demoted_user, session)));

    let (ho_status, _) = api_request(
        demoted_state,
        "POST",
        &format!("/api/browser-debug/artifacts/{art_id}/handoff"),
        &cookie_admin,
        None,
    )
    .await;
    assert_eq!(ho_status, StatusCode::NOT_FOUND);
    let _ = api_request(state_admin, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie_admin, None).await;
}

#[tokio::test]
async fn overlay_inspect_event_populates_preview_and_frame_nav_clears_it() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-overlay-{}", uuid::Uuid::new_v4());
    let (state, cookie) = make_admin_state(&temp, &username, UserRole::Admin);

    let extracted = json!({
        "tag": "a",
        "text": "Dashboard",
        "attributes": { "href": "ignored", "data-testid": "nav-dash" },
        "locator": "nav > a[data-testid=\"nav-dash\"]",
        "bounds": { "x": 100, "y": 20, "width": 80, "height": 24 }
    });
    let cdp = start_mock_cdp_server(extracted).await;
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9996,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    let (_, sess) = api_request(
        state.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/home",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    let (_, lease) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie,
        Some(json!({ "viewerId": "v1", "holderKind": "human" })),
    )
    .await;
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();

    // Start selection in interactive Overlay mode (no inspectPoint)
    let (start_status, start_body) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/start"),
        &cookie,
        Some(json!({
            "leaseToken": lease_token,
            "navigationRevision": 1
        })),
    )
    .await;
    assert_eq!(start_status, StatusCode::OK);
    assert_eq!(start_body["selectionActive"], true);

    // Wait briefly for observer to connect and send Overlay.setInspectMode
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    let _ = cdp.event_tx.send(json!({
        "method": "Overlay.inspectNodeRequested",
        "params": { "backendNodeId": 99 }
    }));

    // Poll GET /api/browser/sessions/{id} until preview arrives
    let mut found_preview = false;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let (st, s_body) = api_request(
            state.clone(),
            "GET",
            &format!("/api/browser/sessions/{session_id}"),
            &cookie,
            None,
        )
        .await;
        assert_eq!(st, StatusCode::OK);
        if s_body["selection"]["preview"].is_object() {
            assert_eq!(s_body["selection"]["preview"]["tag"], "a");
            assert_eq!(
                s_body["selection"]["preview"]["attributes"]["data-testid"],
                "nav-dash"
            );
            assert!(!s_body["selection"]["preview"]["attributes"]
                .as_object()
                .unwrap()
                .contains_key("href"));
            found_preview = true;
            break;
        }
    }
    assert!(found_preview, "expected Overlay.inspectNodeRequested to populate preview");

    // Emit top-level Page.frameNavigated -> clears preview
    let _ = cdp.event_tx.send(json!({
        "method": "Page.frameNavigated",
        "params": { "frame": { "id": "main", "url": "http://localhost:3000/other" } }
    }));

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let (_, after_nav) = api_request(
        state.clone(),
        "GET",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
    assert!(
        after_nav["selection"]["preview"].is_null() || after_nav["selection"].is_null(),
        "expected Page.frameNavigated to invalidate selection preview"
    );
    let _ = api_request(state, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie, None).await;
}

#[tokio::test]
async fn inspect_point_installs_observer_and_navigated_within_document_invalidates_selection() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-spa-{}", uuid::Uuid::new_v4());
    let (state, cookie) = make_admin_state(&temp, &username, UserRole::Admin);

    let extracted = json!({
        "tag": "button",
        "role": "button",
        "accessibleName": "SPA Tab",
        "text": "Overview",
        "attributes": { "data-testid": "spa-tab" },
        "locator": "nav > button",
        "bounds": { "x": 10.0, "y": 10.0, "width": 80.0, "height": 30.0 }
    });
    let cdp = start_mock_cdp_server(extracted).await;

    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9998,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    let (_, sess) = api_request(
        state.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/spa",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    let (_, lease) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie,
        Some(json!({ "viewerId": "v1", "holderKind": "human" })),
    )
    .await;
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();

    // Direct inspectPoint should record preview AND install Page navigation watcher
    let (status, sel_res) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/start"),
        &cookie,
        Some(json!({
            "leaseToken": lease_token,
            "navigationRevision": 1,
            "inspectPoint": { "x": 20, "y": 20 }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sel_res["preview"]["tag"], "button");

    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    // Emit same-document SPA navigation event
    let _ = cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/spa/details" }
    }));

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let (get_status, after_spa) = api_request(
        state.clone(),
        "GET",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(after_spa["navigationRevision"], "2");
    assert_eq!(after_spa["url"], "http://example.com/spa/details");
    assert!(
        after_spa["selection"]["preview"].is_null() || after_spa["selection"].is_null(),
        "expected Page.navigatedWithinDocument to invalidate inspectPoint preview"
    );
    let _ = api_request(state, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie, None).await;
}

#[tokio::test]
async fn concurrent_navigation_barrier_during_handoff_fails_closed_without_writing_pty() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-barrier-{}", uuid::Uuid::new_v4());
    let (state, cookie) = make_admin_state(&temp, &username, UserRole::Admin);

    let extracted = json!({
        "tag": "button",
        "text": "Submit",
        "attributes": { "id": "submit-barrier" },
        "locator": "button#submit-barrier",
        "bounds": { "x": 1.0, "y": 2.0, "width": 80.0, "height": 30.0 }
    });
    let cdp = start_mock_cdp_server(extracted).await;
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9998,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    let term_id = "shell:barrier-1";
    let term_inc = create_test_terminal(&state, term_id, temp.path());

    let (_, sess) = api_request(
        state.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/start",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    let (_, lease) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie,
        Some(json!({ "viewerId": "v1", "holderKind": "human" })),
    )
    .await;
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();

    let (sel_status, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/start"),
        &cookie,
        Some(json!({
            "leaseToken": lease_token,
            "navigationRevision": 1,
            "inspectPoint": { "x": 10, "y": 10 }
        })),
    )
    .await;
    assert_eq!(sel_status, StatusCode::OK);

    let (art_status, art) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie,
        Some(json!({
            "selectionRevision": 2,
            "terminalId": term_id,
            "terminalIncarnation": term_inc,
            "navigationRevision": 1,
            "includePng": false
        })),
    )
    .await;
    assert_eq!(art_status, StatusCode::CREATED);
    let artifact_id = art["artifactId"].as_str().unwrap().to_string();

    // Pause execute_handoff AFTER check_managed_admission passes and right BEFORE ordered fence
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let entered_c = entered.clone();
    let release_c = release.clone();
    *state.browser_debug_artifacts._before_handoff_fence_hook.write().unwrap() =
        Some(Arc::new(move || {
            let e = entered_c.clone();
            let r = release_c.clone();
            Box::pin(async move {
                e.notify_one();
                r.notified().await;
            })
        }));

    let ho_state = state.clone();
    let ho_cookie = cookie.clone();
    let ho_art = artifact_id.clone();
    let ho_task = tokio::spawn(async move {
        api_request(
            ho_state,
            "POST",
            &format!("/api/browser-debug/artifacts/{ho_art}/handoff"),
            &ho_cookie,
            None,
        )
        .await
    });

    entered.notified().await;

    // Navigate while handoff is paused between admission check and ordered selection fence!
    let (nav_status, _) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/navigate"),
        &cookie,
        Some(json!({ "url": "http://example.com/other", "navigationRevision": 1 })),
    )
    .await;
    assert_eq!(nav_status, StatusCode::OK);

    release.notify_one();
    let (ho_status, _) = ho_task.await.unwrap();
    *state.browser_debug_artifacts._before_handoff_fence_hook.write().unwrap() = None;

    assert_eq!(ho_status, StatusCode::NOT_FOUND);
    let buf = state.pty_manager.get_buffer(term_id).unwrap_or_default();
    assert!(
        !buf.contains("browser-debug artifact"),
        "stale handoff leaked bytes to PTY: {buf}"
    );
    let _ = api_request(state, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie, None).await;
}

#[tokio::test]
async fn api_nav_does_not_double_bump_while_native_nav_advances_without_picker() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-navwatch-{}", uuid::Uuid::new_v4());
    let (state, cookie) = make_admin_state(&temp, &username, UserRole::Admin);

    let cdp = start_mock_cdp_server(json!(null)).await;
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9998,
        ws_endpoint: cdp.ws_url.clone(),
        browser_incarnation: uuid::Uuid::new_v4().to_string(),
        profile_epoch: 1,
        user_data_dir: temp.path().to_path_buf(),
    });

    let (_, sess) = api_request(
        state.clone(),
        "POST",
        "/api/browser/sessions",
        &cookie,
        Some(json!({
            "creationKey": uuid::Uuid::new_v4().to_string(),
            "url": "http://example.com/one",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"].as_str().unwrap().to_string();

    // Initialize producer + persistent nav watcher WITHOUT opening selection picker
    let prod = dam_hopper_server::browser_host::media::ensure_producer_for_session(
        &state,
        &session_id,
        &username,
        false,
    )
    .await
    .unwrap();
    let _ = prod.ensure_page_session().await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // 1. API navigate advances 1 -> 2
    let (nav_status, nav_dto) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/navigate"),
        &cookie,
        Some(json!({ "url": "http://example.com/two", "navigationRevision": 1 })),
    )
    .await;
    assert_eq!(nav_status, StatusCode::OK);
    assert_eq!(nav_dto["navigationRevision"], "2");

    // Echo resulting CDP frameNavigated -> must NOT double-bump 2 -> 3
    let _ = cdp.event_tx.send(json!({
        "method": "Page.frameNavigated",
        "params": { "frame": { "url": "http://example.com/two" } }
    }));
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    let (_, after_api_echo) = api_request(
        state.clone(),
        "GET",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(after_api_echo["navigationRevision"], "2");

    // 2. Subsequent native pushState WITHOUT any selection picker advances 2 -> 3
    let _ = cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/three" }
    }));
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    let (_, after_native) = api_request(
        state.clone(),
        "GET",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(after_native["navigationRevision"], "3");
    assert_eq!(after_native["url"], "http://example.com/three");
    let _ = api_request(state, "DELETE", &format!("/api/browser/sessions/{session_id}"), &cookie, None).await;
}
