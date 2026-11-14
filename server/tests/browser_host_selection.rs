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
    let expires_at = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
    make_admin_state_expiring(tmp, username, role, expires_at)
}

fn make_admin_state_expiring(
    tmp: &tempfile::TempDir,
    username: &str,
    role: UserRole,
    exp_chrono: chrono::DateTime<chrono::Utc>,
) -> (AppState, String) {
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
        exp: exp_chrono.timestamp() as usize,
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
    /// `mode` of every `Overlay.setInspectMode` received, in order.
    inspect_modes: Arc<Mutex<Vec<String>>>,
    event_tx: tokio::sync::broadcast::Sender<Value>,
}

async fn start_mock_cdp_server(extracted_payload: Value) -> MockCdpServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let ws_url = format!("ws://127.0.0.1:{port}/devtools/browser/mock");
    let received_methods = Arc::new(Mutex::new(Vec::new()));
    let methods_clone = received_methods.clone();
    let inspect_modes = Arc::new(Mutex::new(Vec::new()));
    let modes_clone = inspect_modes.clone();
    let (event_tx, _) = tokio::sync::broadcast::channel::<Value>(32);
    let event_tx_clone = event_tx.clone();

    let png_b64 = base64::engine::general_purpose::STANDARD.encode(valid_png_bytes());

    tokio::spawn(async move {
        let mut target_seq = 0usize;
        while let Ok((stream, _)) = listener.accept().await {
            let methods = methods_clone.clone();
            let modes = modes_clone.clone();
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
                let default_sid = format!("mock-page-sid-{current_seq}");
                tokio::spawn(async move {
                    while let Ok(mut ev) = ev_rx.recv().await {
                        if ev.get("sessionId").is_none() {
                            if let Some(obj) = ev.as_object_mut() {
                                obj.insert("sessionId".into(), Value::String(default_sid.clone()));
                            }
                        }
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
                    let Ok(val) = serde_json::from_str::<Value>(&text) else {
                        continue;
                    };
                    let id = val.get("id").and_then(Value::as_u64).unwrap_or(0);
                    let method = val.get("method").and_then(Value::as_str).unwrap_or("");
                    let session_id = val.get("sessionId").cloned();
                    methods.lock().unwrap().push(method.to_string());
                    if method == "Overlay.setInspectMode" {
                        let mode = val["params"]["mode"].as_str().unwrap_or("");
                        modes.lock().unwrap().push(mode.to_string());
                    }

                    let result = match method {
                        "Target.createTarget" => {
                            json!({ "targetId": format!("mock-target-{current_seq}") })
                        }
                        "Target.attachToTarget" => {
                            json!({ "sessionId": format!("mock-page-sid-{current_seq}") })
                        }
                        "DOM.getNodeForLocation" => json!({ "backendNodeId": 42 }),
                        "DOM.resolveNode" => json!({ "object": { "objectId": "mock-obj-1" } }),
                        "Runtime.callFunctionOn" => json!({ "result": { "value": extracted } }),
                        "Page.captureScreenshot" => json!({ "data": png_b64 }),
                        _ => json!({}),
                    };

                    let mut resp = json!({ "id": id, "result": result });
                    if let Some(sid) = session_id {
                        resp.as_object_mut()
                            .unwrap()
                            .insert("sessionId".into(), sid);
                    }
                    let _ = out_tx.send(resp.to_string());
                }
            });
        }
    });

    MockCdpServer {
        ws_url,
        received_methods,
        inspect_modes,
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
            "navigationRevision": "1",
            "inspectPoint": { "x": 50, "y": 40 }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let sel_rev = sel_res["selectionRevision"].as_str().unwrap().parse::<u64>().unwrap();
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
            "selectionRevision": sel_rev.to_string(),
            "terminalId": "shell:sel-1",
            "terminalIncarnation": inc.to_string(),
            "source": "Cooperative",
            "owner": "someone-else"
        })),
    )
    .await;
    assert!(
        forged_status == StatusCode::BAD_REQUEST
            || forged_status == StatusCode::UNPROCESSABLE_ENTITY
    );

    // 5. Create ManagedBrowser selection artifact with bounded PNG
    let (art_status, art) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie,
        Some(json!({
            "selectionRevision": sel_rev.to_string(),
            "terminalId": "shell:sel-1",
            "terminalIncarnation": inc.to_string(),
            "navigationRevision": "1",
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
    let _ = api_request(
        state,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
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
            "navigationRevision": "1",
            "inspectPoint": { "x": 10, "y": 10 }
        })),
    )
    .await;
    let sel_rev = sel["selectionRevision"].as_str().unwrap().parse::<u64>().unwrap();

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
            "selectionRevision": sel_rev.to_string(),
            "terminalId": "shell:target",
            "terminalIncarnation": inc1.to_string(),
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
        Some(json!({ "url": "http://example.com/page2", "navigationRevision": "1" })),
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
            "selectionRevision": sel_rev.to_string(),
            "terminalId": "shell:ambient",
            "terminalIncarnation": _inc2.to_string()
        })),
    )
    .await;
    assert_eq!(stale_art_status, StatusCode::CONFLICT);
    let _ = api_request(
        state,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
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
            "navigationRevision": "1",
            "inspectPoint": { "x": 5, "y": 5 }
        })),
    )
    .await;
    let sel_rev = sel["selectionRevision"].as_str().unwrap().parse::<u64>().unwrap();
    let inc = create_test_terminal(&state_admin, "shell:demote", temp.path());

    let (status, art) = api_request(
        state_admin.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/selection/artifacts"),
        &cookie_admin,
        Some(json!({
            "selectionRevision": sel_rev.to_string(),
            "terminalId": "shell:demote",
            "terminalIncarnation": inc.to_string(),
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
    let _ = api_request(
        state_admin,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie_admin,
        None,
    )
    .await;
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
            "navigationRevision": "1"
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
    assert!(
        found_preview,
        "expected Overlay.inspectNodeRequested to populate preview"
    );

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
    let _ = api_request(
        state,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
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
            "navigationRevision": "1",
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
    let _ = api_request(
        state,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
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
            "navigationRevision": "1",
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
            "selectionRevision": "2",
            "terminalId": term_id,
            "terminalIncarnation": term_inc.to_string(),
            "navigationRevision": "1",
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
    *state
        .browser_debug_artifacts
        ._before_handoff_fence_hook
        .write()
        .unwrap() = Some(Arc::new(move || {
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
        Some(json!({ "url": "http://example.com/other", "navigationRevision": "1" })),
    )
    .await;
    assert_eq!(nav_status, StatusCode::OK);

    release.notify_one();
    let (ho_status, _) = ho_task.await.unwrap();
    *state
        .browser_debug_artifacts
        ._before_handoff_fence_hook
        .write()
        .unwrap() = None;

    assert_eq!(ho_status, StatusCode::NOT_FOUND);
    let buf = state.pty_manager.get_buffer(term_id).unwrap_or_default();
    assert!(
        !buf.contains("browser-debug artifact"),
        "stale handoff leaked bytes to PTY: {buf}"
    );
    let _ = api_request(
        state,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
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
        Some(json!({ "url": "http://example.com/two", "navigationRevision": "1" })),
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
    let _ = api_request(
        state,
        "DELETE",
        &format!("/api/browser/sessions/{session_id}"),
        &cookie,
        None,
    )
    .await;
}

// ---------------------------------------------------------------------------------------------
// Final handoff fence, navigation watcher recovery and bounded selection bookkeeping.
// ---------------------------------------------------------------------------------------------

struct Fixture {
    state: AppState,
    cookie: String,
    cdp: MockCdpServer,
    session_id: String,
    username: String,
    lease_token: String,
    temp: tempfile::TempDir,
}

async fn fixture(label: &str, session_expires_in: Option<chrono::Duration>) -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let username = format!("admin-{label}-{}", uuid::Uuid::new_v4());
    let (state, cookie) = match session_expires_in {
        Some(delta) => make_admin_state_expiring(
            &temp,
            &username,
            UserRole::Admin,
            chrono::Utc::now() + delta,
        ),
        None => make_admin_state(&temp, &username, UserRole::Admin),
    };
    let cdp = start_mock_cdp_server(json!({
        "tag": "button",
        "text": "Submit",
        "attributes": { "id": "submit-fence" },
        "locator": "button#submit-fence",
        "bounds": { "x": 1.0, "y": 2.0, "width": 80.0, "height": 30.0 }
    }))
    .await;
    *state.browser_host._test_mock_handle.write() = Some(BrowserInstanceHandle {
        subject: username.clone(),
        is_dev: false,
        pid: 9990,
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
            "url": "http://example.com/start",
            "viewport": { "width": 1280, "height": 900, "dpr": 1 }
        })),
    )
    .await;
    let session_id = sess["browserSessionId"]
        .as_str()
        .unwrap_or_else(|| panic!("session creation failed: {sess}"))
        .to_string();
    let (_, lease) = api_request(
        state.clone(),
        "POST",
        &format!("/api/browser/sessions/{session_id}/control/acquire"),
        &cookie,
        Some(json!({ "viewerId": "v1", "holderKind": "human" })),
    )
    .await;
    let lease_token = lease["leaseToken"].as_str().unwrap().to_string();
    Fixture {
        state,
        cookie,
        cdp,
        session_id,
        username,
        lease_token,
        temp,
    }
}

impl Fixture {
    /// Records an inspect-point selection at `navigation_revision`; returns its selectionRevision.
    async fn select(&self, navigation_revision: u64) -> u64 {
        let (status, sel) = api_request(
            self.state.clone(),
            "POST",
            &format!("/api/browser/sessions/{}/selection/start", self.session_id),
            &self.cookie,
            Some(json!({
                "leaseToken": self.lease_token,
                "navigationRevision": navigation_revision.to_string(),
                "inspectPoint": { "x": 10, "y": 10 }
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{sel}");
        sel["selectionRevision"].as_str().unwrap().parse::<u64>().unwrap()
    }

    async fn artifact(&self, term_id: &str, term_inc: u64, sel_rev: u64, nav_rev: u64) -> String {
        let (status, art) = api_request(
            self.state.clone(),
            "POST",
            &format!(
                "/api/browser/sessions/{}/selection/artifacts",
                self.session_id
            ),
            &self.cookie,
            Some(json!({
                "selectionRevision": sel_rev.to_string(),
                "terminalId": term_id,
                "terminalIncarnation": term_inc.to_string(),
                "navigationRevision": nav_rev.to_string(),
                "includePng": false
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{art}");
        art["artifactId"].as_str().unwrap().to_string()
    }

    async fn handoff(&self, artifact_id: &str) -> StatusCode {
        api_request(
            self.state.clone(),
            "POST",
            &format!("/api/browser-debug/artifacts/{artifact_id}/handoff"),
            &self.cookie,
            None,
        )
        .await
        .0
    }

    async fn registry_nav(&self) -> u64 {
        dam_hopper_server::api::browser_host::global_session_registry()
            .get_session(&self.session_id, &self.username)
            .await
            .unwrap()
            .navigation_revision
            .parse()
            .unwrap()
    }

    async fn wait_registry_nav(&self, expected: u64) {
        for _ in 0..100 {
            if self.registry_nav().await == expected {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!(
            "navigation revision never reached {expected} (at {})",
            self.registry_nav().await
        );
    }

    async fn close(self) {
        let _ = api_request(
            self.state,
            "DELETE",
            &format!("/api/browser/sessions/{}", self.session_id),
            &self.cookie,
            None,
        )
        .await;
    }

    /// Closes the session when the (expired) login can no longer call the DELETE route, so the
    /// global browser target capacity is not leaked into later tests.
    async fn close_expired(self) {
        dam_hopper_server::api::browser_host::global_session_registry()
            .close_principal_sessions(&self.username)
            .await;
    }
}

fn install_final_validation_hook(
    state: &AppState,
    hook: impl Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
        + Send
        + Sync
        + 'static,
) {
    *state
        .browser_debug_artifacts
        ._before_handoff_final_validation_hook
        .write()
        .unwrap() = Some(Arc::new(hook));
}

fn pty_has_reference(state: &AppState, term_id: &str) -> bool {
    state
        .pty_manager
        .get_buffer(term_id)
        .unwrap_or_default()
        .contains("browser-debug artifact")
}

#[tokio::test]
async fn navigation_recorded_after_fence_snapshot_is_caught_by_final_validation_without_pty_write()
{
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-nav", None).await;
    let term_id = "shell:fence-nav";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    // After the fence snapshot (entry lock + selection fence held) a navigation N+1 lands via a
    // path that does not use the selection gate; final validation must still deny the write.
    let sid = fx.session_id.clone();
    install_final_validation_hook(&fx.state, move || {
        let sid = sid.clone();
        Box::pin(async move {
            let bumped = dam_hopper_server::api::browser_host::global_session_registry()
                .record_cdp_navigation(&sid, Some("http://example.com/after-fence"), &[])
                .await;
            assert_eq!(bumped, Some(2));
        })
    });
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "stale handoff leaked bytes to the PTY"
    );
    fx.close().await;
}

/// Holds the PTY mutex on a blocking thread until the returned sender fires (or drops).
async fn hold_pty_lock(state: &AppState) -> std::sync::mpsc::Sender<()> {
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let pty = state.pty_manager.clone();
    tokio::task::spawn_blocking(move || {
        pty.with_fleet_for_test(|_| {
            locked_tx.send(()).unwrap();
            let _ = release_rx.recv();
        })
    });
    tokio::task::spawn_blocking(move || {
        locked_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .expect("PTY lock was never taken")
    })
    .await
    .unwrap();
    release_tx
}

type HandoffTask = tokio::task::JoinHandle<(StatusCode, Value)>;

/// Starts a handoff and returns once its blocking worker is about to wait for the PTY lock the
/// test holds. Every async validation has already completed at that point.
async fn handoff_parked_on_pty_lock(
    fx: &Fixture,
    artifact_id: &str,
) -> (HandoffTask, std::sync::mpsc::Sender<()>) {
    let release = hold_pty_lock(&fx.state).await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    *fx.state
        .browser_debug_artifacts
        ._before_pty_mutation_hook
        .write()
        .unwrap() = Some(Arc::new(move || {
        let _ = entered_tx.send(());
    }));
    let (state, cookie, artifact) = (fx.state.clone(), fx.cookie.clone(), artifact_id.to_string());
    let task = tokio::spawn(async move {
        api_request(
            state,
            "POST",
            &format!("/api/browser-debug/artifacts/{artifact}/handoff"),
            &cookie,
            None,
        )
        .await
    });
    tokio::task::spawn_blocking(move || {
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .expect("handoff never reached the PTY mutation boundary")
    })
    .await
    .unwrap();
    (task, release)
}

async fn wait_observed_navigations(fx: &Fixture, expected: u64) {
    for _ in 0..100 {
        if dam_hopper_server::browser_host::selection::observed_navigation_count(&fx.session_id)
            == expected
        {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("native navigation was never observed");
}

#[tokio::test]
async fn native_navigation_observed_while_the_handoff_holds_the_fence_prevents_the_write() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-order", None).await;
    let term_id = "shell:fence-order";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (entered_c, release_c) = (entered.clone(), release.clone());
    install_final_validation_hook(&fx.state, move || {
        let (e, r) = (entered_c.clone(), release_c.clone());
        Box::pin(async move {
            e.notify_one();
            r.notified().await;
        })
    });

    let ho_state = fx.state.clone();
    let ho_cookie = fx.cookie.clone();
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

    // A native navigation arrives while the handoff holds the fence. Chromium has already
    // navigated: its registry record waits behind the fence, but the observation is published
    // at once and must deny the write.
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/native" }
    }));
    wait_observed_navigations(&fx, 1).await;
    assert_eq!(
        fx.registry_nav().await,
        1,
        "the revision record itself still waits behind the fence"
    );

    release.notify_one();
    let (ho_status, _) = ho_task.await.unwrap();
    assert_eq!(ho_status, StatusCode::NOT_FOUND);
    fx.wait_registry_nav(2).await;
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "a navigation observed before the PTY write must prevent the handoff"
    );

    // The artifact is stale for good.
    *fx.state
        .browser_debug_artifacts
        ._before_handoff_final_validation_hook
        .write()
        .unwrap() = None;
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);
    fx.close().await;
}

#[tokio::test]
async fn native_navigation_during_the_pty_lock_wait_prevents_the_write() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-ptywait", None).await;
    let term_id = "shell:fence-ptywait";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    let (ho_task, release_pty) = handoff_parked_on_pty_lock(&fx, &artifact_id).await;

    // Every async validation passed; the worker now waits for the PTY lock. The navigation
    // lands only now and is the sole thing that can still deny the write.
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/during-pty-wait" }
    }));
    wait_observed_navigations(&fx, 1).await;
    assert_eq!(fx.registry_nav().await, 1);

    release_pty.send(()).unwrap();
    let (status, _) = ho_task.await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "stale handoff leaked bytes to the PTY"
    );
    fx.wait_registry_nav(2).await;
    fx.close().await;
}

#[tokio::test]
async fn handoff_waiting_for_the_pty_lock_succeeds_when_no_navigation_arrives() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-ptywait-ok", None).await;
    let term_id = "shell:fence-ptywait-ok";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    let (ho_task, release_pty) = handoff_parked_on_pty_lock(&fx, &artifact_id).await;
    release_pty.send(()).unwrap();
    let (status, _) = ho_task.await.unwrap();
    assert_eq!(status, StatusCode::OK);
    for _ in 0..50 {
        if pty_has_reference(&fx.state, term_id) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(pty_has_reference(&fx.state, term_id));
    fx.close().await;
}

#[tokio::test]
async fn session_deadline_passing_during_the_pty_lock_wait_prevents_the_write() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-ptywait-deadline", Some(chrono::Duration::seconds(4))).await;
    let term_id = "shell:fence-ptywait-deadline";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    // Still live for every async validation; the deadline passes only while the worker waits
    // for the PTY lock, so just the check made under that lock can deny the write.
    let (ho_task, release_pty) = handoff_parked_on_pty_lock(&fx, &artifact_id).await;
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    release_pty.send(()).unwrap();
    let (status, _) = ho_task.await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "expired session leaked bytes to the PTY"
    );
    fx.close_expired().await;
}

#[tokio::test]
async fn deadline_expiring_during_final_lock_waits_denies_the_handoff_write() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-deadline", Some(chrono::Duration::seconds(4))).await;
    let term_id = "shell:fence-deadline";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    // The session is still live when the handoff starts and when the fence is acquired, then
    // its deadline passes while the handoff waits for its final validation.
    install_final_validation_hook(&fx.state, || {
        Box::pin(async {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        })
    });
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "expired session leaked bytes to the PTY"
    );
    fx.close_expired().await;
}

#[tokio::test]
async fn watcher_overflow_resumes_observation_so_a_new_picker_still_sees_navigation() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("watch-overflow", None).await;
    let first_rev = fx.select(1).await;
    assert!(first_rev >= 1);
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    // An oversized sessionId makes the CDP client project an `Overflow` lifecycle event: a lost
    // event that may have been a navigation. The watcher treats it as one and keeps observing.
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.frameNavigated",
        "sessionId": "x".repeat(300),
        "params": { "frame": { "id": "main", "url": "http://example.com/lost" } }
    }));
    fx.wait_registry_nav(2).await;

    // A new picker after the overflow is accepted and its watcher is live...
    let second_rev = fx.select(2).await;
    assert!(second_rev > first_rev);
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    // ...so a later native navigation still advances the revision and invalidates the selection.
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/after-overflow" }
    }));
    fx.wait_registry_nav(3).await;
    let (_, after) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(after["navigationRevision"], "3");
    assert!(
        after["selection"].is_null() || after["selection"]["preview"].is_null(),
        "post-overflow navigation must invalidate the new selection: {after}"
    );
    fx.close().await;
}

#[tokio::test]
async fn repeated_prepare_and_terminal_paths_keep_selection_registrations_bounded() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("registrations", None).await;
    let term_id = "shell:registrations";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let count = || {
        dam_hopper_server::browser_host::selection::pending_artifact_registration_count(
            &fx.session_id,
        )
    };

    // One unchanged selection, prepared and discarded repeatedly via the DELETE route.
    for _ in 0..6 {
        let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;
        assert_eq!(count().await, 1);
        let (status, _) = api_request(
            fx.state.clone(),
            "DELETE",
            &format!("/api/browser-debug/artifacts/{artifact_id}"),
            &fx.cookie,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            count().await,
            0,
            "deleted artifact must not stay registered"
        );
    }

    // Force-invalidation (capture failure / navigation teardown) retires the registration too.
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;
    assert_eq!(count().await, 1);
    fx.state
        .browser_debug_artifacts
        .force_invalidate(uuid::Uuid::parse_str(&artifact_id).unwrap())
        .await
        .unwrap();
    assert_eq!(count().await, 0);

    // Principal reset/revocation retires registrations of fenced artifacts as well.
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;
    assert_eq!(count().await, 1);
    fx.state
        .browser_debug_artifacts
        .revoke_managed_by_principal(&fx.username, None)
        .await
        .unwrap();
    assert_eq!(count().await, 0);
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);
    fx.close().await;
}

#[tokio::test]
async fn logout_during_the_pty_lock_wait_prevents_the_write() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-logout", None).await;
    let term_id = "shell:fence-logout";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    // Every async validation passed and the worker waits for the PTY lock; the login is then
    // revoked through the real logout route. Only the final in-lock check can still deny it.
    let (ho_task, release_pty) = handoff_parked_on_pty_lock(&fx, &artifact_id).await;
    let (logout_status, _) = api_request(
        fx.state.clone(),
        "POST",
        "/api/auth/logout",
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(logout_status, StatusCode::OK);

    release_pty.send(()).unwrap();
    let (status, _) = ho_task.await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "a handoff of a revoked login leaked bytes to the PTY"
    );
    fx.close_expired().await;
}

/// Real StepUp MFA rotation (challenge + verify through the production routes, against a real
/// SQLite auth store) completes while a handoff that already passed every async credential
/// check waits for the PTY lock: the superseded credential must not write.
#[tokio::test]
async fn mfa_step_up_rotation_during_the_pty_lock_wait_prevents_the_write() {
    use dam_hopper_server::auth::{
        model::MfaConfirmed, policy::MockClock, secret::MfaEncryptionKey, totp::TotpEngine,
        AuthStore, Clock,
    };
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let mut fx = fixture("fence-mfa", None).await;
    let term_id = "shell:fence-mfa";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    // Swap the fixture's mock auth for a real store holding the same admin login.
    let auth_dir = tempfile::tempdir().unwrap();
    let store = AuthStore::open_sqlite(&auth_dir.path().join("auth.db"))
        .await
        .unwrap();
    let mfa_key = MfaEncryptionKey::new([0x33u8; 32], "selection-mfa-key");
    let clock = Arc::new(MockClock::new(chrono::Utc::now()));
    let now = clock.now();
    let secret = [7u8; 20];
    let (ciphertext, nonce) = mfa_key
        .encrypt(&fx.username, "enrollment-confirmed", &secret)
        .unwrap();
    store
        .create_user(UserRecord {
            id: None,
            username: fx.username.clone(),
            password_hash: String::new(),
            is_enabled: true,
            role: UserRole::Admin,
            auth_version: 0,
            mfa: Some(MfaConfirmed {
                secret_ciphertext: ciphertext,
                nonce,
                key_id: mfa_key.key_id().to_string(),
                enrolled_at: chrono_to_bson(now),
                last_accepted_step: now.timestamp() / 30 - 1,
            }),
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        })
        .await
        .unwrap();
    store
        .create_session(AuthSession {
            id: format!("sess-{}", fx.username),
            username: fx.username.clone(),
            auth_version: 0,
            credential_version: 0,
            issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(
                chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap(),
            ),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
            user_agent: None,
        })
        .await
        .unwrap();
    fx.state = fx
        .state
        .clone()
        .with_auth_service(Arc::new(AuthService::new(
            Some(store),
            Some(mfa_key),
            clock.clone(),
        )));

    // Every async validation passed and the worker waits for the PTY lock; the credential is
    // then rotated by the real StepUp routes. Only the final in-lock check can still deny it.
    let (ho_task, release_pty) = handoff_parked_on_pty_lock(&fx, &artifact_id).await;
    let (status, challenge) = api_request(
        fx.state.clone(),
        "POST",
        "/api/auth/mfa/challenge",
        &fx.cookie,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{challenge}");
    let code = TotpEngine::generate_code_at(&secret, clock.now().timestamp() as u64).unwrap();
    let (status, rotated) = api_request(
        fx.state.clone(),
        "POST",
        "/api/auth/mfa/verify",
        &fx.cookie,
        Some(json!({ "challengeToken": challenge["challengeToken"], "code": code })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rotated}");
    assert_eq!(rotated["state"], "authenticated");

    release_pty.send(()).unwrap();
    let (status, _) = ho_task.await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "a handoff of a rotated-away credential leaked bytes to the PTY"
    );
    fx.close_expired().await;
}

#[tokio::test]
async fn retired_browser_incarnation_during_the_pty_lock_wait_prevents_the_write() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("fence-incarnation", None).await;
    let term_id = "shell:fence-incarnation";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    let (ho_task, release_pty) = handoff_parked_on_pty_lock(&fx, &artifact_id).await;
    // The browser the artifact came from is retired (crash/stop/reset): its live incarnation
    // leaves the manager synchronously, before any selection cleanup could arrive.
    let live = fx.state.browser_host._test_mock_handle.write().take();
    release_pty.send(()).unwrap();
    let (status, _) = ho_task.await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "an artifact of a retired browser incarnation leaked bytes to the PTY"
    );

    // The artifact was never claimed: with the browser live again it still hands off.
    *fx.state.browser_host._test_mock_handle.write() = live;
    *fx.state
        .browser_debug_artifacts
        ._before_pty_mutation_hook
        .write()
        .unwrap() = None;
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::OK);
    fx.close().await;
}

/// Opens the parked-unlink gate when dropped, so a failing assertion cannot leave a blocking
/// worker parked (which would hang runtime shutdown).
struct OpenGateOnDrop(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);

impl Drop for OpenGateOnDrop {
    fn drop(&mut self) {
        *self.0 .0.lock().unwrap() = true;
        self.0 .1.notify_all();
    }
}

#[tokio::test]
async fn navigation_during_a_parked_artifact_cleanup_is_observed_and_denies_a_new_handoff() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("watch-parked-cleanup", None).await;
    let term_id = "shell:watch-parked-cleanup";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let _stale_artifact = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    // The first unlink (the cleanup the first navigation owes its pending artifact) parks.
    let (entered_tx, entered_rx) = std::sync::mpsc::channel::<()>();
    let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let first = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let hook_gate = gate.clone();
    *fx.state
        .browser_debug_artifacts
        ._before_unlink_hook
        .write()
        .unwrap() = Some(Arc::new(move || {
        if first.swap(false, std::sync::atomic::Ordering::SeqCst) {
            let _ = entered_tx.send(());
            let (open, cvar) = &*hook_gate;
            let mut open = open.lock().unwrap();
            while !*open {
                open = cvar.wait(open).unwrap();
            }
        }
    }));
    let open_gate = OpenGateOnDrop(gate.clone());

    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/first" }
    }));
    wait_observed_navigations(&fx, 1).await;
    tokio::task::spawn_blocking(move || {
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the artifact cleanup never started")
    })
    .await
    .unwrap();
    fx.wait_registry_nav(2).await;

    // While that cleanup is parked a new picker selects and prepares an artifact at revision 2.
    let new_sel_rev = fx.select(2).await;
    let artifact_id = fx.artifact(term_id, term_inc, new_sel_rev, 2).await;

    // A second native navigation arrives: it must be observed at once, not queue behind the
    // parked cleanup, so the handoff below can never validate a stale page.
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/second" }
    }));
    wait_observed_navigations(&fx, 2).await;
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&fx.state, term_id),
        "a handoff after an unpublished navigation leaked bytes to the PTY"
    );

    drop(open_gate);
    fx.wait_registry_nav(3).await;
    fx.close().await;
}

/// Parks the first artifact unlink on its blocking worker until the returned guard drops.
fn park_first_unlink(state: &AppState) -> (std::sync::mpsc::Receiver<()>, OpenGateOnDrop) {
    let (entered_tx, entered_rx) = std::sync::mpsc::channel::<()>();
    let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let first = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let hook_gate = gate.clone();
    *state
        .browser_debug_artifacts
        ._before_unlink_hook
        .write()
        .unwrap() = Some(Arc::new(move || {
        if first.swap(false, std::sync::atomic::Ordering::SeqCst) {
            let _ = entered_tx.send(());
            let (open, cvar) = &*hook_gate;
            let mut open = open.lock().unwrap();
            while !*open {
                open = cvar.wait(open).unwrap();
            }
        }
    }));
    (entered_rx, OpenGateOnDrop(gate))
}

async fn wait_unlink_parked(entered: std::sync::mpsc::Receiver<()>) {
    tokio::task::spawn_blocking(move || {
        entered
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the artifact cleanup never started")
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn late_cleanup_of_an_old_selection_never_disables_a_newer_picker() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("late-cleanup-picker", None).await;
    let term_id = "shell:late-cleanup-picker";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let _stale_artifact = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    let (entered, open_gate) = park_first_unlink(&fx.state);
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/first" }
    }));
    wait_unlink_parked(entered).await;
    fx.wait_registry_nav(2).await;

    // While the old selection's unlink is parked a NEW interactive picker starts and enables
    // native picking.
    let (status, started) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token, "navigationRevision": "2" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    for _ in 0..100 {
        if fx
            .cdp
            .inspect_modes
            .lock()
            .unwrap()
            .iter()
            .any(|m| m == "searchForNode")
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    // The obsolete cleanup now finishes: it must not switch the new picker off.
    drop(open_gate);
    dam_hopper_server::browser_host::selection::drain_navigation_cleanups().await;
    let modes = fx.cdp.inspect_modes.lock().unwrap().clone();
    let picker = modes
        .iter()
        .position(|m| m == "searchForNode")
        .expect("the new picker never enabled native picking");
    assert!(
        !modes[picker..].iter().any(|m| m == "none"),
        "late cleanup of an old selection disabled the newer picker: {modes:?}"
    );
    fx.close().await;
}

#[tokio::test]
async fn navigation_cleanup_queue_coalesces_and_session_close_waits_for_it() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("cleanup-queue", None).await;
    let term_id = "shell:cleanup-queue";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let _stale_artifact = fx.artifact(term_id, term_inc, sel_rev, 1).await;

    let (entered, open_gate) = park_first_unlink(&fx.state);
    let _ = fx.cdp.event_tx.send(json!({
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/n0" }
    }));
    wait_unlink_parked(entered).await;
    fx.wait_registry_nav(2).await;

    // Many navigations land behind the parked unlink: each is observed at once and their
    // (empty) teardowns coalesce instead of queueing one record per navigation.
    const BURST: u64 = 12;
    for i in 1..=BURST {
        let _ = fx.cdp.event_tx.send(json!({
            "method": "Page.navigatedWithinDocument",
            "params": { "frameId": "main", "url": format!("http://example.com/n{i}") }
        }));
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    wait_observed_navigations(&fx, BURST + 1).await;
    fx.wait_registry_nav(BURST + 2).await;

    // Session close must wait for the queued teardown instead of leaving it detached.
    let close = {
        let (state, cookie, session_id) =
            (fx.state.clone(), fx.cookie.clone(), fx.session_id.clone());
        tokio::spawn(async move {
            api_request(
                state,
                "DELETE",
                &format!("/api/browser/sessions/{session_id}"),
                &cookie,
                None,
            )
            .await
        })
    };
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    assert!(
        !close.is_finished(),
        "close returned while cleanup was still parked"
    );
    drop(open_gate);
    let (status, _) = tokio::time::timeout(std::time::Duration::from_secs(10), close)
        .await
        .expect("close never finished after the cleanup was released")
        .unwrap();
    assert!(status.is_success(), "{status}");

    let nones = fx
        .cdp
        .inspect_modes
        .lock()
        .unwrap()
        .iter()
        .filter(|m| *m == "none")
        .count();
    assert!(
        nones <= 2,
        "overlay teardown was queued once per navigation instead of coalesced: {nones}"
    );
}

#[tokio::test]
async fn page_replacement_gap_fences_parked_handoff_and_invalidates_selection() {
    use dam_hopper_server::browser_host::selection::{
        begin_page_observation_gap, is_selection_live, observed_navigation_count,
    };

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("page-gap-handoff", None).await;
    let term_id = "shell:page-gap-handoff";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let sel_rev = fx.select(1).await;
    let artifact = fx.artifact(term_id, term_inc, sel_rev, 1).await;
    let producer = dam_hopper_server::browser_host::media::get_producer(&fx.session_id)
        .await
        .unwrap();
    let (handoff, release) = handoff_parked_on_pty_lock(&fx, &artifact).await;

    // Publication is synchronous even while the handoff owns the selection read lock.
    let mut gap = begin_page_observation_gap(&fx.session_id);
    assert_eq!(observed_navigation_count(&fx.session_id), 1);
    let state = fx.state.clone();
    let invalidation = tokio::spawn(async move {
        gap.invalidate(&state).await;
        gap
    });
    release.send(()).unwrap();
    assert_eq!(handoff.await.unwrap().0, StatusCode::NOT_FOUND);
    let gap = invalidation.await.unwrap();
    assert!(!pty_has_reference(&fx.state, term_id));
    assert!(!is_selection_live(&fx.session_id, &fx.username, 1, sel_rev).await);
    assert_eq!(fx.registry_nav().await, 2);
    assert_eq!(fx.handoff(&artifact).await, StatusCode::NOT_FOUND);

    assert!(gap.finish(&fx.state, &producer.cdp_client, "replacement-page").await);
    let _ = fx.cdp.event_tx.send(json!({
        "sessionId": "replacement-page",
        "method": "Page.navigatedWithinDocument",
        "params": { "frameId": "main", "url": "http://example.com/replacement" }
    }));
    fx.wait_registry_nav(3).await;
    fx.close().await;
}

#[tokio::test]
async fn only_latest_page_gap_can_settle_and_cancelled_gap_stays_closed() {
    use dam_hopper_server::browser_host::selection::begin_page_observation_gap;

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("page-gap-generation", None).await;
    fx.select(1).await;
    let producer = dam_hopper_server::browser_host::media::get_producer(&fx.session_id)
        .await
        .unwrap();
    let mut first = begin_page_observation_gap(&fx.session_id);
    first.invalidate(&fx.state).await;
    let mut second = begin_page_observation_gap(&fx.session_id);
    second.invalidate(&fx.state).await;
    assert!(!first.finish(&fx.state, &producer.cdp_client, "old-page").await);
    let (status, _) = api_request(
        fx.state.clone(), "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token, "navigationRevision": "3",
                     "inspectPoint": { "x": 10, "y": 10 } })),
    ).await;
    assert_ne!(status, StatusCode::OK);
    assert!(second.finish(&fx.state, &producer.cdp_client, "new-page").await);

    // A dropped replacement does not reopen selection, even after its invalidation completed.
    let mut cancelled = begin_page_observation_gap(&fx.session_id);
    cancelled.invalidate(&fx.state).await;
    drop(cancelled);
    let (status, _) = api_request(
        fx.state.clone(), "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token, "navigationRevision": "4",
                     "inspectPoint": { "x": 10, "y": 10 } })),
    ).await;
    assert_ne!(status, StatusCode::OK);
    fx.close().await;
}

#[tokio::test]
async fn actor_recovery_invalidates_production_selection_before_replacement() {
    use dam_hopper_server::browser_host::selection::is_selection_live;

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("recovery-selection-fence", None).await;
    let terminal = "shell:recovery-selection-fence";
    let incarnation = create_test_terminal(&fx.state, terminal, fx.temp.path());
    let selection_revision = fx.select(1).await;
    let artifact = fx.artifact(terminal, incarnation, selection_revision, 1).await;
    let producer = dam_hopper_server::browser_host::media::get_producer(&fx.session_id)
        .await
        .unwrap();
    let subscription = uuid::Uuid::new_v4().to_string();
    producer.register_viewer_demand("v1", &subscription, true).await;
    let run = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if producer.state().await
                == dam_hopper_server::browser_host::screencast::ScreencastState::Streaming
            {
                break producer.current_run().await.unwrap();
            }
            tokio::task::yield_now().await;
        }
    }).await.unwrap();

    producer.cdp_client.close().await;
    fx.wait_registry_nav(2).await;
    assert!(!is_selection_live(&fx.session_id, &fx.username, 1, selection_revision).await);
    assert_eq!(fx.handoff(&artifact).await, StatusCode::NOT_FOUND);
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if producer.current_run().await.is_some_and(|current| current != run)
                && !producer.recovery_pending()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    }).await.expect("replacement run should become available");
    assert!(!pty_has_reference(&fx.state, terminal));
    fx.close().await;
}

#[tokio::test]
async fn release_control_clears_active_and_picked_selection_and_hides_overlay() {
    use dam_hopper_server::browser_host::selection::{
        is_selection_live, pending_artifact_registration_count,
    };

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("release-clears-sel", None).await;
    let term_id = "shell:release-clears-sel";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());

    // 1. Start interactive selection (no inspectPoint) -> active == true, searchForNode sent
    let (st_start, body_start) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": fx.lease_token,
            "navigationRevision": "1"
        })),
    )
    .await;
    assert_eq!(st_start, StatusCode::OK, "{body_start}");
    assert_eq!(body_start["selectionActive"], true);

    for _ in 0..50 {
        if fx
            .cdp
            .inspect_modes
            .lock()
            .unwrap()
            .iter()
            .any(|m| m == "searchForNode")
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    // Release control -> active becomes false and overlay inspect/highlight cleared
    let (st_rel, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token })),
    )
    .await;
    assert_eq!(st_rel, StatusCode::OK);

    let (_, sess_after_rel1) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(sess_after_rel1["selection"]["active"], false);
    assert!(sess_after_rel1["selection"]["preview"].is_null());
    {
        let methods = fx.cdp.received_methods.lock().unwrap();
        assert!(methods.iter().any(|m| m == "Overlay.hideHighlight"));
        let modes = fx.cdp.inspect_modes.lock().unwrap();
        assert_eq!(modes.last().map(String::as_str), Some("none"));
    }

    // 2. Re-acquire lease, pick an element (preview = Some, active = false, Overlay.highlightNode),
    //    create an unclaimed pending artifact, move navigationRevision in registry, then release!
    let (st_acq2, lease2) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/acquire", fx.session_id),
        &fx.cookie,
        Some(json!({ "viewerId": "v2", "holderKind": "human" })),
    )
    .await;
    assert_eq!(st_acq2, StatusCode::OK);
    let lease2_token = lease2["leaseToken"].as_str().unwrap().to_string();

    let (st_pick, pick_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": lease2_token,
            "navigationRevision": "1",
            "inspectPoint": { "x": 15, "y": 25 }
        })),
    )
    .await;
    assert_eq!(st_pick, StatusCode::OK, "{pick_body}");
    assert_eq!(pick_body["selectionActive"], false);
    assert!(pick_body["preview"].is_object());
    let sel_rev = pick_body["selectionRevision"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();

    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;
    assert_eq!(pending_artifact_registration_count(&fx.session_id).await, 1);

    // Move registry navigationRevision so selection/cancel would 409, proving release_control
    // still clears selection and hides overlay even after navigationRevision moved.
    let new_rev = dam_hopper_server::api::browser_host::global_session_registry()
        .record_cdp_navigation(&fx.session_id, Some("http://example.com/moved"), &[])
        .await;
    assert_eq!(new_rev, Some(2));

    let methods_before = fx.cdp.received_methods.lock().unwrap().len();

    let (st_rel2, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": lease2_token })),
    )
    .await;
    assert_eq!(st_rel2, StatusCode::OK);

    assert!(!is_selection_live(&fx.session_id, &fx.username, 1, sel_rev).await);
    assert_eq!(pending_artifact_registration_count(&fx.session_id).await, 0);
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);

    let new_methods = fx.cdp.received_methods.lock().unwrap()[methods_before..].to_vec();
    assert!(
        new_methods.iter().any(|m| m == "Overlay.setInspectMode"),
        "expected Overlay.setInspectMode none after release: {new_methods:?}"
    );
    assert!(
        new_methods.iter().any(|m| m == "Overlay.hideHighlight"),
        "expected Overlay.hideHighlight after release: {new_methods:?}"
    );
    fx.close().await;
}

#[tokio::test]
async fn cancel_selection_hides_highlight_after_element_picked() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("cancel-picked", None).await;

    let (st_pick, pick_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": fx.lease_token,
            "navigationRevision": "1",
            "inspectPoint": { "x": 10, "y": 10 }
        })),
    )
    .await;
    assert_eq!(st_pick, StatusCode::OK, "{pick_body}");
    assert_eq!(pick_body["selectionActive"], false);
    assert!(pick_body["preview"].is_object());

    let methods_before = fx.cdp.received_methods.lock().unwrap().len();
    assert!(fx.cdp.received_methods.lock().unwrap().iter().any(|m| m == "Overlay.highlightNode"));

    let (st_cancel, cancel_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/cancel", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": fx.lease_token,
            "navigationRevision": "1"
        })),
    )
    .await;
    assert_eq!(st_cancel, StatusCode::OK, "{cancel_body}");
    assert_eq!(cancel_body["selectionActive"], false);

    let (_, sess_after) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(sess_after["selection"]["active"], false);
    assert!(sess_after["selection"]["preview"].is_null());

    let new_methods = fx.cdp.received_methods.lock().unwrap()[methods_before..].to_vec();
    assert!(new_methods.iter().any(|m| m == "Overlay.setInspectMode"));
    assert!(new_methods.iter().any(|m| m == "Overlay.hideHighlight"));
    fx.close().await;
}

#[tokio::test]
async fn lease_expiry_clears_selection_and_hides_overlay() {
    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("expiry-clears-sel", None).await;

    // Release initial long-TTL lease and replace input manager with a short-TTL one.
    let _ = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token })),
    )
    .await;
    dam_hopper_server::api::browser_host::global_input_managers()
        .write()
        .await
        .insert(
            fx.session_id.clone(),
            dam_hopper_server::browser_host::input::SessionInputManager::new_shared(
                std::time::Duration::from_millis(500),
            ),
        );

    let (st_acq, lease_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/acquire", fx.session_id),
        &fx.cookie,
        Some(json!({ "viewerId": "v-short", "holderKind": "human" })),
    )
    .await;
    assert_eq!(st_acq, StatusCode::OK);
    let short_token = lease_body["leaseToken"].as_str().unwrap().to_string();

    let (st_start, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": short_token,
            "navigationRevision": "1"
        })),
    )
    .await;
    assert_eq!(st_start, StatusCode::OK);

    for _ in 0..40 {
        let (_, sess) = api_request(
            fx.state.clone(),
            "GET",
            &format!("/api/browser/sessions/{}", fx.session_id),
            &fx.cookie,
            None,
        )
        .await;
        if sess["selection"]["active"] == false
            && fx
                .cdp
                .received_methods
                .lock()
                .unwrap()
                .iter()
                .any(|m| m == "Overlay.hideHighlight")
        {
            fx.close().await;
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
    panic!("lease expiry did not clear selection and hide overlay in time");
}

#[tokio::test]
async fn stale_lease_end_cleanup_does_not_cancel_successor_lease_selection() {
    use dam_hopper_server::api::browser_host::get_or_create_input_manager;
    use dam_hopper_server::browser_host::selection::{
        clear_selection_on_lease_end, is_selection_live, pending_artifact_registration_count,
    };

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("h5-successor", None).await;
    let term_id = "shell:h5-successor";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());
    let input_mgr = get_or_create_input_manager(&fx.session_id).await;
    let old_lease_epoch = input_mgr.validate_lease_epoch(&fx.lease_token).await.unwrap();

    // Release old lease, then successor lease acquires and starts selection + picks element + artifact.
    let (st_rel1, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token })),
    )
    .await;
    assert_eq!(st_rel1, StatusCode::OK);

    let (st_acq2, lease2) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/acquire", fx.session_id),
        &fx.cookie,
        Some(json!({ "viewerId": "v-successor", "holderKind": "human" })),
    )
    .await;
    assert_eq!(st_acq2, StatusCode::OK);
    let lease2_token = lease2["leaseToken"].as_str().unwrap().to_string();

    // Successor picks an element and creates a pending artifact.
    let (st_pick, pick_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": lease2_token,
            "navigationRevision": "1",
            "inspectPoint": { "x": 12, "y": 14 }
        })),
    )
    .await;
    assert_eq!(st_pick, StatusCode::OK, "{pick_body}");
    let sel_rev = pick_body["selectionRevision"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;
    assert_eq!(pending_artifact_registration_count(&fx.session_id).await, 1);

    // Delayed cleanup from old lease arrives after successor already started selection!
    let methods_before = fx.cdp.received_methods.lock().unwrap().len();
    clear_selection_on_lease_end(&fx.state, &fx.session_id, &fx.username, old_lease_epoch).await;

    // Successor selection, artifact, and overlay highlight MUST remain intact.
    assert!(is_selection_live(&fx.session_id, &fx.username, 1, sel_rev).await);
    assert_eq!(pending_artifact_registration_count(&fx.session_id).await, 1);
    let methods_after = fx.cdp.received_methods.lock().unwrap()[methods_before..].to_vec();
    assert!(
        !methods_after.iter().any(|m| m == "Overlay.hideHighlight"),
        "delayed old-lease cleanup must not hide successor highlight: {methods_after:?}"
    );

    // Also test interactive active selection on successor is untouched by old-lease cleanup.
    let (st_active, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": lease2_token,
            "navigationRevision": "1"
        })),
    )
    .await;
    assert_eq!(st_active, StatusCode::OK);
    clear_selection_on_lease_end(&fx.state, &fx.session_id, &fx.username, old_lease_epoch).await;
    let (_, sess) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(sess["selection"]["active"], true);

    let _ = artifact_id;
    fx.close().await;
}

#[tokio::test]
async fn stale_start_selection_overtaken_by_lease_release_stays_inactive() {
    use dam_hopper_server::browser_host::selection::GLOBAL_SELECTION_MANAGER;

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("h5-stale-start", None).await;

    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let entered_c = entered.clone();
    let release_c = release.clone();
    *GLOBAL_SELECTION_MANAGER
        ._before_start_publish_hook
        .lock()
        .unwrap() = Some(Arc::new(move || {
        let e = entered_c.clone();
        let r = release_c.clone();
        Box::pin(async move {
            e.notify_one();
            r.notified().await;
        })
    }));

    let st_state = fx.state.clone();
    let st_cookie = fx.cookie.clone();
    let st_sid = fx.session_id.clone();
    let st_lease = fx.lease_token.clone();
    let start_task = tokio::spawn(async move {
        api_request(
            st_state,
            "POST",
            &format!("/api/browser/sessions/{st_sid}/selection/start"),
            &st_cookie,
            Some(json!({
                "leaseToken": st_lease,
                "navigationRevision": "1"
            })),
        )
        .await
    });

    // Wait until start_selection passed renew_lease + get_session and paused before publish.
    entered.notified().await;
    *GLOBAL_SELECTION_MANAGER
        ._before_start_publish_hook
        .lock()
        .unwrap() = None;

    // Release the lease while start_selection is paused!
    let (rel_st, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token })),
    )
    .await;
    assert_eq!(rel_st, StatusCode::OK);

    // Resume the stale start_selection -> must fail closed and leave selection inactive!
    release.notify_one();
    let (start_st, start_body) = start_task.await.unwrap();
    assert_eq!(start_st, StatusCode::CONFLICT, "{start_body}");

    let (_, sess_after) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert!(
        sess_after["selection"].is_null()
            || (sess_after["selection"]["active"] == false
                && sess_after["selection"]["preview"].is_null()),
        "stale start_selection resurrected selection after release: {sess_after}"
    );
    assert!(
        !fx.cdp
            .inspect_modes
            .lock()
            .unwrap()
            .iter()
            .any(|m| m == "searchForNode"),
        "stale start_selection must never enable native inspect mode"
    );
    fx.close().await;
}

#[tokio::test]
async fn failed_native_release_still_clears_picked_and_active_selection_and_hides_overlay() {
    use dam_hopper_server::api::browser_host::get_or_create_input_manager;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::input::{InputEvent, InputMessage};
    use dam_hopper_server::browser_host::input_native_release::NativeInputTarget;
    use dam_hopper_server::browser_host::protocol::TargetGeometry;
    use dam_hopper_server::browser_host::selection::{
        is_selection_live, pending_artifact_registration_count,
    };
    use std::sync::atomic::{AtomicBool, Ordering};

    let _guard = TEST_SERIAL_LOCK.lock().await;
    let fx = fixture("h-c2-2-rel-fail", None).await;
    let term_id = "shell:h-c2-2-rel-fail";
    let term_inc = create_test_terminal(&fx.state, term_id, fx.temp.path());

    // Mock native input CDP that fails Input.* when fail_input is set.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let fail_input = Arc::new(AtomicBool::new(false));
    let fail_clone = fail_input.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let fail = fail_clone.clone();
            tokio::spawn(async move {
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                while let Some(Ok(WsMessage::Text(text))) = ws.next().await {
                    let cmd: Value = serde_json::from_str(&text).unwrap();
                    let method = cmd["method"].as_str().unwrap_or_default();
                    let reply = if method.starts_with("Input.") && fail.load(Ordering::SeqCst) {
                        json!({"id": cmd["id"], "error": {"code": -32000, "message": "injected native release failure"}})
                    } else {
                        json!({"id": cmd["id"], "result": {}})
                    };
                    if ws.send(WsMessage::Text(reply.to_string().into())).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    let native_client = CdpClient::connect(&format!("ws://127.0.0.1:{port}"))
        .await
        .unwrap();
    let native_target = NativeInputTarget {
        client: native_client,
        page_session_id: "NATIVE-FAIL-PAGE".to_string(),
        geometry: TargetGeometry {
            css_width: 1280.0,
            css_height: 900.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
    };

    let input_mgr = get_or_create_input_manager(&fx.session_id).await;
    input_mgr.capture_native_target(native_target.clone()).await;
    input_mgr
        .enqueue_input(InputMessage {
            browser_session_id: fx.session_id.clone(),
            browser_incarnation: "inc".to_string(),
            profile_epoch: 1,
            subscription_epoch: "sub-1".to_string(),
            lease_token: fx.lease_token.clone(),
            input_seq: 1,
            viewport_epoch: 1,
            event: InputEvent::KeyDown {
                key: "a".to_string(),
                code: "KeyA".to_string(),
                modifiers: 0,
            },
        })
        .await
        .unwrap();
    input_mgr.drain_inputs().await;

    // Pick element + create unclaimed pending artifact.
    let sel_rev = fx.select(1).await;
    let artifact_id = fx.artifact(term_id, term_inc, sel_rev, 1).await;
    assert!(is_selection_live(&fx.session_id, &fx.username, 1, sel_rev).await);
    assert_eq!(pending_artifact_registration_count(&fx.session_id).await, 1);

    let methods_before = fx.cdp.received_methods.lock().unwrap().len();

    // Trigger native release failure on explicit /control/release!
    fail_input.store(true, Ordering::SeqCst);
    let (rel_status, rel_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": fx.lease_token })),
    )
    .await;
    assert_eq!(rel_status, StatusCode::SERVICE_UNAVAILABLE, "{rel_body}");
    assert_eq!(rel_body["kind"], "inputUnavailable");
    assert!(input_mgr.release_failure().await.is_some());

    // Even though release returned 503 inputUnavailable, the lease ended so selection,
    // pending artifact, and CDP overlay MUST all be cleared!
    assert!(!is_selection_live(&fx.session_id, &fx.username, 1, sel_rev).await);
    assert_eq!(pending_artifact_registration_count(&fx.session_id).await, 0);
    assert_eq!(fx.handoff(&artifact_id).await, StatusCode::NOT_FOUND);
    let (_, sess_after) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(sess_after["selection"]["active"], false);
    assert!(sess_after["selection"]["preview"].is_null());

    let new_methods = fx.cdp.received_methods.lock().unwrap()[methods_before..].to_vec();
    assert!(new_methods.iter().any(|m| m == "Overlay.setInspectMode"));
    assert!(new_methods.iter().any(|m| m == "Overlay.hideHighlight"));

    // Clear native failure, re-acquire, start active selection, hold key again, fail release ->
    // active selection is ALSO cleared!
    fail_input.store(false, Ordering::SeqCst);
    let (acq2_st, acq2_body) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/acquire", fx.session_id),
        &fx.cookie,
        Some(json!({ "viewerId": "v2", "holderKind": "human" })),
    )
    .await;
    assert_eq!(acq2_st, StatusCode::OK, "{acq2_body}");
    let lease2 = acq2_body["leaseToken"].as_str().unwrap().to_string();

    input_mgr.capture_native_target(native_target).await;
    input_mgr
        .enqueue_input(InputMessage {
            browser_session_id: fx.session_id.clone(),
            browser_incarnation: "inc".to_string(),
            profile_epoch: 1,
            subscription_epoch: "sub-2".to_string(),
            lease_token: lease2.clone(),
            input_seq: 1,
            viewport_epoch: 1,
            event: InputEvent::KeyDown {
                key: "b".to_string(),
                code: "KeyB".to_string(),
                modifiers: 0,
            },
        })
        .await
        .unwrap();
    input_mgr.drain_inputs().await;

    let (st_active, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/selection/start", fx.session_id),
        &fx.cookie,
        Some(json!({
            "leaseToken": lease2,
            "navigationRevision": "1"
        })),
    )
    .await;
    assert_eq!(st_active, StatusCode::OK);

    fail_input.store(true, Ordering::SeqCst);
    let (rel2_st, _) = api_request(
        fx.state.clone(),
        "POST",
        &format!("/api/browser/sessions/{}/control/release", fx.session_id),
        &fx.cookie,
        Some(json!({ "leaseToken": lease2 })),
    )
    .await;
    assert_eq!(rel2_st, StatusCode::SERVICE_UNAVAILABLE);
    let (_, sess_after2) = api_request(
        fx.state.clone(),
        "GET",
        &format!("/api/browser/sessions/{}", fx.session_id),
        &fx.cookie,
        None,
    )
    .await;
    assert_eq!(sess_after2["selection"]["active"], false);
    assert!(sess_after2["selection"]["preview"].is_null());

    fx.close().await;
}
