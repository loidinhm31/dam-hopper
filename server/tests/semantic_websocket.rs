#![cfg(target_os = "linux")]

//! Integration test suite for the authenticated semantic WebSocket gateway (`/ws/semantic/v1`).
//!
//! Enforces:
//! - Exact subprotocol (`dam-hopper.semantic.lsp.v1`) negotiation and rejection.
//! - Auth and Origin allowlist matrix parity with core `/ws`.
//! - Strict lifecycle sequencing: Unattached -> Attached -> Initializing -> Ready -> Terminated.
//! - Virtual URI grammar and non-disclosing outside-target containment.
//! - Required `damHopperDocumentVersion` extension on navigation requests.
//! - Cancellation-first live auth teardown and slow-consumer independence.
//! - Dedicated 4 MiB frame limits, rate limits, and binary payload rejection.

use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{handshake::client::generate_key, http, Message},
};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::{build_router, build_router_with_origins, semantic_ws::SEMANTIC_SUBPROTOCOL},
    auth::model::AuthClaims,
    auth::{Clock, AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER},
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

const TEST_SECRET: &str = "test-semantic-ws-jwt-secret-xyz";

fn make_valid_jwt(sub: &str, sid: &str) -> String {
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: sub.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: chrono::Utc::now().timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    claims.encode(TEST_SECRET).unwrap()
}

async fn make_test_app(
    tmp: &TempDir,
    projects: Vec<(&str, PathBuf)>,
) -> (AppState, common::semantic_fixtures::TestToolchain) {
    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let workspace_dir = tmp.path().to_path_buf();

    let project_infos: Vec<ProjectConfig> = projects
        .into_iter()
        .map(|(name, path)| ProjectConfig {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 5,
            health_check_url: None,
        })
        .collect();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "semantic-ws-test".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: project_infos,
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_SECRET.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("make_test_app AppState failed")
    .with_auth_service(Arc::new(
        dam_hopper_server::auth::AuthService::new_mock_default().0,
    ))
    .with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));

    // Enable semantic supervisor for test execution
    state.semantic_supervisor.set_enabled(true).await;

    (state, toolchain)
}

async fn start_server(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state);
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    addr
}

async fn read_next_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<Value, String> {
    read_next_json_with_timeout(ws, Duration::from_secs(5)).await
}

async fn read_initialize_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    expected_id: u64,
) -> Result<Value, String> {
    // Match the production client's handshake budget, not its navigation budget.
    let response = read_next_json_with_timeout(ws, Duration::from_secs(15)).await?;
    if response.get("id").and_then(Value::as_u64) != Some(expected_id) {
        return Err("Initialize response ID mismatch".into());
    }
    if response.get("error").is_some() || !response.get("result").is_some_and(Value::is_object) {
        return Err("Initialize response did not contain a successful result".into());
    }
    Ok(response)
}

async fn read_next_json_with_timeout(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    budget: Duration,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        // Even an always-ready stream of control frames cannot extend the deadline.
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "JSON receive timeout after {} ms",
                budget.as_millis()
            ));
        }
        let message = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| format!("JSON receive timeout after {} ms", budget.as_millis()))?;
        match message {
            Some(Ok(Message::Text(text))) => {
                // Never include payloads, credentials, paths or raw parser errors.
                return serde_json::from_str(&text).map_err(|error| {
                    format!(
                        "Invalid JSON: category={:?}, line={}, column={}",
                        error.classify(),
                        error.line(),
                        error.column(),
                    )
                });
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Close(frame))) => {
                return Err(format!(
                    "WebSocket Close: code={:?} (reason redacted)",
                    frame.map(|frame| u16::from(frame.code)),
                ));
            }
            Some(Ok(Message::Binary(_))) => return Err("Unexpected binary frame".into()),
            Some(Ok(_)) => return Err("Unexpected non-JSON frame".into()),
            Some(Err(_)) => return Err("WebSocket transport error (details redacted)".into()),
            None => return Err("WebSocket EOF without Close frame".into()),
        }
    }
}

#[tokio::test]
async fn test_handshake_subprotocol_and_auth_matrix() {
    let tmp = TempDir::new().unwrap();
    let (state, _tc) = make_test_app(&tmp, vec![]).await;
    let addr = start_server(state).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);

    // 1. Valid handshake: token + exact subprotocol
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (_ws, resp) = connect_async(req)
        .await
        .expect("valid handshake should connect");
    assert_eq!(resp.status(), 101);
    assert_eq!(
        resp.headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|h| h.to_str().ok()),
        Some(SEMANTIC_SUBPROTOCOL)
    );

    // 2. Missing subprotocol: rejected with 400 Bad Request
    let req_no_sub = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .body(())
        .unwrap();

    let err_no_sub = connect_async(req_no_sub).await.unwrap_err();
    match err_no_sub {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), http::StatusCode::BAD_REQUEST);
        }
        other => panic!("expected 400 Bad Request, got {:?}", other),
    }
    // 3. Wrong subprotocol: rejected with 400 Bad Request
    let req_wrong_sub = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", "generic-lsp")
        .body(())
        .unwrap();

    let err_wrong_sub = connect_async(req_wrong_sub).await.unwrap_err();
    match err_wrong_sub {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), http::StatusCode::BAD_REQUEST);
        }
        other => panic!("expected 400 Bad Request, got {:?}", other),
    }
    // 4. Missing token with allowed Origin: rejected with 401 Unauthorized
    let req_no_token = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", format!("http://{addr}"))
        .body(())
        .unwrap();

    let err_no_token = connect_async(req_no_token).await.unwrap_err();
    match err_no_token {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), http::StatusCode::UNAUTHORIZED);
        }
        other => panic!("expected 401 Unauthorized, got {:?}", other),
    }

    // 4b. Origin-less without query token: rejected with 403 Forbidden
    let req_originless_no_token = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let err_originless = connect_async(req_originless_no_token).await.unwrap_err();
    match err_originless {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), http::StatusCode::FORBIDDEN);
        }
        other => panic!("expected 403 Forbidden, got {:?}", other),
    }

    // 5. Origin allowlist check
    let (state_origin, _tc2) = make_test_app(&tmp, vec![]).await;
    let listener_origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr_origin = listener_origin.local_addr().unwrap();
    let router_origin = build_router_with_origins(
        state_origin,
        vec![axum::http::HeaderValue::from_static("http://trusted.local")],
    );
    tokio::spawn(async move {
        axum::serve(listener_origin, router_origin).await.unwrap();
    });

    // Allowed origin succeeds
    let req_allowed_origin = http::Request::builder()
        .uri(format!("ws://{addr_origin}/ws/semantic/v1?token={token}"))
        .header("Host", addr_origin.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", "http://trusted.local")
        .body(())
        .unwrap();
    let (_, resp_allowed) = connect_async(req_allowed_origin)
        .await
        .expect("allowed origin connects");
    assert_eq!(resp_allowed.status(), 101);

    // Disallowed origin rejected with 403 Forbidden
    let req_disallowed_origin = http::Request::builder()
        .uri(format!("ws://{addr_origin}/ws/semantic/v1?token={token}"))
        .header("Host", addr_origin.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", "http://evil.com")
        .body(())
        .unwrap();
    let err_origin = connect_async(req_disallowed_origin).await.unwrap_err();
    match err_origin {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), http::StatusCode::FORBIDDEN);
        }
        other => panic!("expected 403 Forbidden, got {:?}", other),
    }

    // Origin absent + cookie only rejected with 403 Forbidden (origin-less requires query token or no-auth)
    let req_cookie_only = http::Request::builder()
        .uri(format!("ws://{addr_origin}/ws/semantic/v1"))
        .header("Host", addr_origin.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Cookie", format!("damhopper-auth={token}"))
        .body(())
        .unwrap();
    let err_cookie = connect_async(req_cookie_only).await.unwrap_err();
    match err_cookie {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), http::StatusCode::FORBIDDEN);
        }
        other => panic!("expected 403 Forbidden, got {:?}", other),
    }
}

#[tokio::test]
async fn test_lifecycle_order_and_attach() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("my-project");
    std::fs::create_dir_all(&project_dir).unwrap();

    let (state, _tc) = make_test_app(&tmp, vec![("my-project", project_dir.clone())]).await;
    let addr = start_server(state).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // 1. Calling initialize before attachTarget must fail
    let init_before_attach = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    });
    ws.send(Message::Text(init_before_attach.to_string().into()))
        .await
        .unwrap();

    let err_frame = read_next_json(&mut ws).await.expect("error response");
    assert_eq!(err_frame["id"], 1);
    assert_eq!(
        err_frame["error"]["data"]["damHopperCode"],
        "ATTACH_REQUIRED"
    );

    // 2. Attach with unsupported descriptor (e.g. rust) must fail with zero children
    let attach_rust = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "my-project" },
            "descriptor": "rust"
        }
    });
    ws.send(Message::Text(attach_rust.to_string().into()))
        .await
        .unwrap();

    let err_rust = read_next_json(&mut ws).await.expect("error response");
    assert_eq!(err_rust["id"], 2);
    assert_eq!(
        err_rust["error"]["data"]["damHopperCode"],
        "UNSUPPORTED_DESCRIPTOR"
    );

    // 3. Attach with valid typescript descriptor must succeed
    let attach_ts = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "my-project" },
            "descriptor": "typescript"
        }
    });
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();

    let attach_res = read_next_json(&mut ws).await.expect("attach response");
    assert_eq!(attach_res["id"], 3);
    assert!(attach_res["result"]["targetId"].is_string());
    assert_eq!(attach_res["result"]["descriptor"], "typescript");

    // 4. Second attach on the same connection must be rejected
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();
    let err_second_attach = read_next_json(&mut ws).await.expect("second attach error");
    assert_eq!(
        err_second_attach["error"]["data"]["damHopperCode"],
        "TARGET_ALREADY_ATTACHED"
    );
}

#[tokio::test]
async fn test_virtual_uri_containment_and_traversal_rejection() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("secure-project");
    std::fs::create_dir_all(&project_dir).unwrap();

    let (state, _tc) = make_test_app(&tmp, vec![("secure-project", project_dir.clone())]).await;
    let addr = start_server(state).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach target
    let attach_ts = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "secure-project" },
            "descriptor": "typescript"
        }
    });
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();
    // Initialize session to Ready
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 10,
        "method": "initialize",
        "params": {}
    });
    ws.send(Message::Text(init_req.to_string().into()))
        .await
        .unwrap();
    let init_res = read_initialize_json(&mut ws, 10)
        .await
        .expect("initialize response");
    assert_eq!(init_res["id"], 10);

    let initialized_notif = json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });
    ws.send(Message::Text(initialized_notif.to_string().into()))
        .await
        .unwrap();

    // Open in-target document
    let open_notif = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": format!("dam-hopper://semantic/{target_id}/src/index.ts"),
                "languageId": "typescript",
                "version": 1,
                "text": "export const value = 42;"
            }
        }
    });
    ws.send(Message::Text(open_notif.to_string().into()))
        .await
        .unwrap();
    // Definition with traversal URI must be rejected
    let traversal_def = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": format!("dam-hopper://semantic/{target_id}/../etc/passwd") },
            "position": { "line": 0, "character": 0 },
            "damHopperDocumentVersion": 1
        }
    });
    ws.send(Message::Text(traversal_def.to_string().into()))
        .await
        .unwrap();

    let err_traversal = read_next_json(&mut ws).await.expect("traversal rejected");
    assert_eq!(err_traversal["id"], 2);
    assert_eq!(
        err_traversal["error"]["data"]["damHopperCode"],
        "INVALID_URI"
    );

    // Definition missing damHopperDocumentVersion must be rejected
    let missing_version_def = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": format!("dam-hopper://semantic/{target_id}/src/index.ts") },
            "position": { "line": 0, "character": 0 }
        }
    });
    ws.send(Message::Text(missing_version_def.to_string().into()))
        .await
        .unwrap();

    let err_missing_ver = read_next_json(&mut ws)
        .await
        .expect("missing version rejected");
    assert_eq!(err_missing_ver["id"], 3);
    assert_eq!(
        err_missing_ver["error"]["data"]["damHopperCode"],
        "INVALID_PARAMS"
    );
}

#[tokio::test]
async fn test_rate_limiting_and_binary_rejection() {
    let tmp = TempDir::new().unwrap();
    let (state, _tc) = make_test_app(&tmp, vec![]).await;
    let addr = start_server(state).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // 1. Binary message rejection
    let binary_bytes = vec![0x00, 0x01, 0x02, 0x03];
    ws.send(Message::Binary(binary_bytes.into())).await.unwrap();

    let bin_err = read_next_json(&mut ws).await.expect("binary rejected");
    assert_eq!(bin_err["error"]["code"], -32700);

    // 2. Non-object JSON rejection (array batch)
    let batch = json!([{"jsonrpc": "2.0", "method": "test"}]);
    ws.send(Message::Text(batch.to_string().into()))
        .await
        .unwrap();

    let batch_err = read_next_json(&mut ws).await.expect("batch rejected");
    assert_eq!(batch_err["error"]["code"], -32700);
}

#[tokio::test]
async fn test_adaptive_sync_and_navigation_resolution() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("full-sync-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();
    let test_file = project_dir.join("src/main.ts");
    std::fs::write(&test_file, "export const x = 1;\nexport const y = x + 1;\n").unwrap();

    let (state, _tc) = make_test_app(&tmp, vec![("full-sync-project", project_dir.clone())]).await;
    let addr = start_server(state).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach
    let attach_ts = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "full-sync-project" },
            "descriptor": "typescript"
        }
    });
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();

    // Initialize
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "initialize",
        "params": {}
    });
    ws.send(Message::Text(init_req.to_string().into()))
        .await
        .unwrap();
    let init_res = read_initialize_json(&mut ws, 2).await.unwrap();
    assert_eq!(init_res["result"]["capabilities"]["textDocumentSync"], 2);

    let initialized_notif = json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });
    ws.send(Message::Text(initialized_notif.to_string().into()))
        .await
        .unwrap();

    let doc_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");

    // didOpen
    let open_notif = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": doc_uri,
                "languageId": "typescript",
                "version": 1,
                "text": "export const x = 1;\nexport const y = x + 1;\n"
            }
        }
    });
    ws.send(Message::Text(open_notif.to_string().into()))
        .await
        .unwrap();

    // didChange: full edit (< 64 KiB)
    let change_notif = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didChange",
        "params": {
            "textDocument": {
                "uri": doc_uri,
                "version": 2
            },
            "contentChanges": [
                {
                    "text": "export const x = 2;\nexport const y = x + 2;\n"
                }
            ]
        }
    });
    ws.send(Message::Text(change_notif.to_string().into()))
        .await
        .unwrap();

    // Definition query at position 0:13 with damHopperDocumentVersion: 2
    let def_req = json!({
        "jsonrpc": "2.0",
        "id": 100,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": doc_uri },
            "position": { "line": 0, "character": 13 },
            "damHopperDocumentVersion": 2
        }
    });
    ws.send(Message::Text(def_req.to_string().into()))
        .await
        .unwrap();

    let def_res = read_next_json(&mut ws).await.expect("definition response");
    assert_eq!(def_res["id"], 100);

    // Stale version query (requesting version 1 when version is now 2)
    let stale_def_req = json!({
        "jsonrpc": "2.0",
        "id": 101,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": doc_uri },
            "position": { "line": 0, "character": 13 },
            "damHopperDocumentVersion": 1
        }
    });
    ws.send(Message::Text(stale_def_req.to_string().into()))
        .await
        .unwrap();

    let stale_res = read_next_json(&mut ws)
        .await
        .expect("stale version response");
    assert_eq!(stale_res["id"], 101);
    assert_eq!(stale_res["error"]["data"]["damHopperCode"], "STALE_VERSION");

    // Shutdown and exit
    let shutdown_req = json!({
        "jsonrpc": "2.0",
        "id": 200,
        "method": "shutdown",
        "params": null
    });
    ws.send(Message::Text(shutdown_req.to_string().into()))
        .await
        .unwrap();
    let shutdown_res = read_next_json(&mut ws).await.expect("shutdown response");
    assert_eq!(shutdown_res["id"], 200);
    assert!(shutdown_res["result"].is_null());

    let exit_notif = json!({
        "jsonrpc": "2.0",
        "method": "exit",
        "params": null
    });
    ws.send(Message::Text(exit_notif.to_string().into()))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_cancellation_first_live_auth_cutoff() {
    let fixture = common::auth_fixtures::AuthTestFixture::new_sqlite().await;
    let user = fixture
        .create_user("live-test-user", "Password123!", true)
        .await;
    let now = fixture.clock.now();
    let expires = now + chrono::Duration::hours(1);
    let (session, token) = fixture
        .create_session(&user.username, 0, now, expires, now)
        .await;
    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let state = fixture.state.clone().with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;

    let addr = start_server(state.clone()).await;

    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Revoke session in auth store
    fixture
        .store
        .revoke_session(&session.id, now)
        .await
        .unwrap();
    // Wait for the live auth watcher to detect revocation and trigger cancellation-first teardown
    // The watcher polls every 5s; after detection it cancels admission and closes the stream.
    let mut closed = false;
    for _ in 0..15 {
        tokio::select! {
            msg = ws.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        closed = true;
                        break;
                    }
                    _ => {}
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(500)) => {}
        }
    }
    assert!(
        closed,
        "Socket must be closed following live auth revocation"
    );
}

#[tokio::test]
async fn test_active_session_reap_on_client_disconnect() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("cleanup-project");
    std::fs::create_dir_all(&project_dir).unwrap();

    let (state, _tc) = make_test_app(&tmp, vec![("cleanup-project", project_dir.clone())]).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach
    let attach_ts = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "cleanup-project" },
            "descriptor": "typescript"
        }
    });
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();
    let _ = read_next_json(&mut ws).await.unwrap();

    // Initialize
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "initialize",
        "params": {}
    });
    ws.send(Message::Text(init_req.to_string().into()))
        .await
        .unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();

    // Confirm session is active
    let snap_before = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(snap_before.active_sessions, 1);

    // Disconnect client socket
    drop(ws);

    // Give reader/writer loop a moment to notice EOF and run teardown
    tokio::time::sleep(Duration::from_millis(500)).await;

    let snap_after = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(
        snap_after.active_sessions, 0,
        "Active session must be completely reaped on client disconnect"
    );
}

#[tokio::test]
async fn test_cancellation_response_id_and_malformed_change() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("cancel-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();
    std::fs::write(
        project_dir.join("src/main.ts"),
        "export const answer: number = 42;\n",
    )
    .unwrap();

    let (state, _tc) = make_test_app(&tmp, vec![("cancel-project", project_dir.clone())]).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach
    let attach_ts = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "cancel-project" },
            "descriptor": "typescript"
        }
    });
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();

    // Initialize
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "initialize",
        "params": {}
    });
    ws.send(Message::Text(init_req.to_string().into()))
        .await
        .unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();

    let initialized_notif = json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });
    ws.send(Message::Text(initialized_notif.to_string().into()))
        .await
        .unwrap();
    // didOpen
    let virtual_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    let open_notif = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": virtual_uri,
                "languageId": "typescript",
                "version": 1,
                "text": "const x: number = 42;\n"
            }
        }
    });
    ws.send(Message::Text(open_notif.to_string().into()))
        .await
        .unwrap();

    // Send definition request with id: 100
    let def_req = json!({
        "jsonrpc": "2.0",
        "id": 100,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": virtual_uri },
            "position": { "line": 0, "character": 6 },
            "damHopperDocumentVersion": 1
        }
    });
    ws.send(Message::Text(def_req.to_string().into()))
        .await
        .unwrap();

    // Immediately cancel request 100
    let cancel_notif = json!({
        "jsonrpc": "2.0",
        "method": "$/cancelRequest",
        "params": { "id": 100 }
    });
    ws.send(Message::Text(cancel_notif.to_string().into()))
        .await
        .unwrap();

    // Read definition response: either cancelled (-32800) or completed with id: 100
    let def_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(def_res["id"], 100, "Response ID must match request ID 100");
    if let Some(err) = def_res.get("error") {
        assert_eq!(err["code"], -32800, "Cancelled error code must be -32800");
    }

    // Send malformed didChange (malformed contentChanges element)
    let malformed_change = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didChange",
        "params": {
            "textDocument": {
                "uri": virtual_uri,
                "version": 2
            },
            "contentChanges": ["not-an-object"]
        }
    });
    ws.send(Message::Text(malformed_change.to_string().into()))
        .await
        .unwrap();

    // Give actor a moment to close document
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Now navigation should fail or report document closed/stale because document was closed
    let def_req2 = json!({
        "jsonrpc": "2.0",
        "id": 101,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": virtual_uri },
            "position": { "line": 0, "character": 6 },
            "damHopperDocumentVersion": 2
        }
    });
    ws.send(Message::Text(def_req2.to_string().into()))
        .await
        .unwrap();

    let def_res2 = read_next_json(&mut ws).await.unwrap();
    assert_eq!(def_res2["id"], 101);
    assert!(
        def_res2.get("error").is_some(),
        "Document closed on malformed change must reject subsequent request"
    );

    // Cleanup
    drop(ws);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let snap_after = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(snap_after.active_sessions, 0);
}

#[tokio::test]
async fn test_wc_invalid_id_not_echoed_and_wd_pre_actor_did_open_eviction() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("wc-wd-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();
    std::fs::write(
        project_dir.join("src/main.ts"),
        "export const answer: number = 42;\n",
    )
    .unwrap();

    let (state, _tc) = make_test_app(&tmp, vec![("wc-wd-project", project_dir.clone())]).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach and verify negotiated policy fields
    let attach_ts = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "damHopper/attachTarget",
        "params": {
            "target": { "project": "wc-wd-project" },
            "descriptor": "typescript"
        }
    });
    ws.send(Message::Text(attach_ts.to_string().into()))
        .await
        .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(attach_res["result"]["adaptiveSyncThresholdBytes"], 65536);

    // Initialize and verify experimental damHopperAdaptiveSync capability
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "initialize",
        "params": {}
    });
    ws.send(Message::Text(init_req.to_string().into()))
        .await
        .unwrap();
    let init_res = read_initialize_json(&mut ws, 2).await.unwrap();
    assert_eq!(
        init_res["result"]["capabilities"]["experimental"]["damHopperAdaptiveSync"]
            ["thresholdBytes"],
        65536
    );

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    let virtual_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");

    // W-C: 100 KB oversized string ID must NOT be echoed in response
    let huge_id = "x".repeat(100_000);
    let bad_id_req = json!({
        "jsonrpc": "2.0",
        "id": huge_id,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": virtual_uri },
            "position": { "line": 0, "character": 0 },
            "damHopperDocumentVersion": 1
        }
    });
    ws.send(Message::Text(bad_id_req.to_string().into()))
        .await
        .unwrap();
    let bad_id_res = read_next_json(&mut ws).await.unwrap();
    assert!(
        bad_id_res["id"].is_null(),
        "Invalid request ID must return id: null, never echoing the invalid ID"
    );
    assert_eq!(
        bad_id_res["error"]["data"]["damHopperCode"],
        "INVALID_REQUEST_ID"
    );
    assert!(bad_id_res.to_string().len() < 512);

    // W-C: Notification-style navigation (missing `id`) must produce NO reply
    let notif_nav = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": virtual_uri },
            "position": { "line": 0, "character": 0 },
            "damHopperDocumentVersion": 1
        }
    });
    ws.send(Message::Text(notif_nav.to_string().into()))
        .await
        .unwrap();

    // Open valid v1 overlay
    let open_v1 = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": virtual_uri,
                "languageId": "typescript",
                "version": 1,
                "text": "export const answer: number = 42;\n"
            }
        }
    });
    ws.send(Message::Text(open_v1.to_string().into()))
        .await
        .unwrap();

    // W-D: Send rejected didOpen for same URI (unsupported languageId "rust") -> must evict v1 overlay!
    let bad_reopen = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": virtual_uri,
                "languageId": "rust",
                "version": 2,
                "text": "fn main() {}\n"
            }
        }
    });
    ws.send(Message::Text(bad_reopen.to_string().into()))
        .await
        .unwrap();

    // Querying navigation at v1 must now fail with STALE_VERSION because v1 overlay was evicted
    let nav_after_evict = json!({
        "jsonrpc": "2.0",
        "id": 50,
        "method": "textDocument/definition",
        "params": {
            "textDocument": { "uri": virtual_uri },
            "position": { "line": 0, "character": 13 },
            "damHopperDocumentVersion": 1
        }
    });
    ws.send(Message::Text(nav_after_evict.to_string().into()))
        .await
        .unwrap();
    let res_after_evict = read_next_json(&mut ws).await.unwrap();
    assert_eq!(res_after_evict["id"], 50);
    assert_eq!(
        res_after_evict["error"]["data"]["damHopperCode"],
        "STALE_VERSION"
    );

    // W-A: Send exit notification -> must close socket and release presence + session
    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "exit", "params": null })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    let mut presence = state.client_presence.subscribe();
    tokio::time::timeout(Duration::from_secs(6), async {
        while presence.borrow_and_update().connection_count != 0 {
            presence.changed().await.unwrap();
        }
    })
    .await
    .expect("semantic exit did not release presence");
    let snap_after = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(snap_after.active_sessions, 0);
}

#[tokio::test]
async fn test_revocation_token_at_admission_completion_and_queued_writer_boundaries() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("revoke-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();
    std::fs::write(
        project_dir.join("src/main.ts"),
        "export const x = 1;\nexport const y = x;\n",
    )
    .unwrap();

    // Use a custom fixture script that delays navigation by 1500ms so we can test delayed-completion revocation
    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");
    let custom_cli = r#"
let buf = Buffer.alloc(0);
function send(obj) {
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`);
}
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 2, definitionProvider: true, implementationProvider: true } } });
    } else if (msg.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: msg.id, result: null });
    } else if (msg.method === 'exit') {
      process.exit(0);
    } else if (msg.method === 'textDocument/definition') {
      setTimeout(() => {
        send({ jsonrpc: '2.0', id: msg.id, result: [] });
      }, 1200);
    }
  }
});
"#;
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("revoke-project", project_dir.clone())]).await;
    let state = base_state.with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach + Initialize + Initialized + didOpen
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": "revoke-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    let doc_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": doc_uri,
                    "languageId": "typescript",
                    "version": 1,
                    "text": "export const x = 1;\nexport const y = x;\n"
                }
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // 1. Send in-flight navigation request (id: 10)
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": doc_uri },
                "position": { "line": 1, "character": 17 },
                "damHopperDocumentVersion": 1
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    tokio::time::sleep(Duration::from_millis(80)).await;

    // Call phase-1 prepare_invalidate_target WITHOUT calling reap yet!
    let to_reap = state
        .semantic_supervisor
        .prepare_invalidate_target("revoke-project", None)
        .await;
    assert_eq!(to_reap.len(), 1);

    // In-flight request 10 must immediately resolve with -32005 (AUTH_INVALIDATED) before reap!
    let in_flight_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(in_flight_res["id"], 10);
    assert_eq!(in_flight_res["error"]["code"], -32005);

    // 2. Subsequent request (id: 11) on the retained connection must be rejected at admission with -32005!
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": doc_uri },
                "position": { "line": 1, "character": 17 },
                "damHopperDocumentVersion": 1
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let post_prepare_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(post_prepare_res["id"], 11);
    assert_eq!(post_prepare_res["error"]["code"], -32005);

    // Now reap the retired session
    state.semantic_supervisor.reap_sessions(to_reap).await;
}

#[tokio::test]
async fn test_g5_destination_provenance_open_and_unopened_pin_and_requery() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("g5-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
    let unopened_text = "// header line\nexport function helper(): number {\n  return 99;\n}\n";
    let main_path = project_dir.join("src/main.ts");
    let unopened_path = project_dir.join("src/unopened.ts");
    std::fs::write(&main_path, main_text).unwrap();
    std::fs::write(&unopened_path, unopened_text).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let canonical_unopened = dunce::canonicalize(&unopened_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main)
        .unwrap()
        .to_string();
    let unopened_file_uri = url::Url::from_file_path(&canonical_unopened)
        .unwrap()
        .to_string();

    let rpc_log_path = tmp.path().join("child-rpc-log.jsonl");
    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    // Fixture TSLS script that tracks open buffers via didOpen/didChange/didClose:
    // - For unopened.ts: if NOT open in child buffers, returns a dummy range (line 0, char 0..2);
    //   ONLY when unopened.ts IS open in child buffers via didOpen with the real disk text,
    //   returns the exact range on line 1 (char 16..22)!
    // - For line 99 query: returns an out-of-bounds line 500 to test range-in-text rejection.
    let custom_cli = format!(
        r#"
import fs from 'node:fs';
const logPath = {log_path:?};
const mainUri = {main_uri:?};
const unopenedUri = {unopened_uri:?};
const openDocs = new Map();
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    fs.appendFileSync(logPath, JSON.stringify({{ method: msg.method, uri: msg.params?.textDocument?.uri ?? null }}) + '\n');
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true, implementationProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      openDocs.set(msg.params.textDocument.uri, msg.params.textDocument.text);
    }} else if (msg.method === 'textDocument/didClose') {{
      openDocs.delete(msg.params.textDocument.uri);
    }} else if (msg.method === 'textDocument/definition') {{
      const line = msg.params.position.line;
      if (line === 0) {{
        // Cross-file navigation to unopened.ts
        const isPinned = openDocs.has(unopenedUri);
        send({{
          jsonrpc: '2.0',
          id: msg.id,
          result: [{{
            targetUri: unopenedUri,
            targetRange: {{ start: {{ line: isPinned ? 1 : 0, character: 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 32 : 2 }} }},
            targetSelectionRange: {{ start: {{ line: isPinned ? 1 : 0, character: isPinned ? 16 : 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 22 : 2 }} }}
          }}]
        }});
      }} else if (line === 1) {{
        // Same-file navigation to open main.ts
        send({{
          jsonrpc: '2.0',
          id: msg.id,
          result: [{{
            uri: mainUri,
            range: {{ start: {{ line: 1, character: 13 }}, end: {{ line: 1, character: 21 }} }}
          }}]
        }});
      }} else {{
        // Out-of-bounds range in main.ts (line 500 does not exist)
        send({{
          jsonrpc: '2.0',
          id: msg.id,
          result: [{{
            uri: mainUri,
            range: {{ start: {{ line: 500, character: 0 }}, end: {{ line: 500, character: 5 }} }}
          }}]
        }});
      }}
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        log_path = rpc_log_path.to_string_lossy(),
        main_uri = main_file_uri,
        unopened_uri = unopened_file_uri,
    );
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("g5-project", project_dir.clone())]).await;
    let state = base_state.with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach + Initialize + Initialized + didOpen(main.ts only)
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": "g5-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": main_virt_uri,
                    "languageId": "typescript",
                    "version": 3,
                    "text": main_text
                }
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // 1. Query definition on line 1 (same-file open overlay destination `src/main.ts`)
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": main_virt_uri },
                "position": { "line": 1, "character": 15 },
                "damHopperDocumentVersion": 3
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let open_dest_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(open_dest_res["id"], 10);
    let open_locs = open_dest_res["result"].as_array().unwrap();
    assert_eq!(open_locs.len(), 1);
    assert_eq!(
        open_locs[0]["damHopperDestinationContentSha256"],
        dam_hopper_server::semantic::uri::compute_text_sha256(main_text)
    );
    assert_eq!(open_locs[0]["damHopperDestinationVersion"], 3);
    assert_eq!(open_locs[0]["damHopperDestinationIncarnation"], 1);

    // 2. Query definition on line 0 (unopened destination `src/unopened.ts`):
    // Must execute FIFO didOpen(unopened.ts) -> requery definition -> didClose(unopened.ts)
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": main_virt_uri },
                "position": { "line": 0, "character": 10 },
                "damHopperDocumentVersion": 3
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let unopened_dest_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(unopened_dest_res["id"], 11);
    let unopened_locs = unopened_dest_res["result"].as_array().unwrap();
    assert_eq!(unopened_locs.len(), 1);
    // Because the requery ran while unopened.ts was pinned via didOpen, line is 1 (not 0)!
    assert_eq!(unopened_locs[0]["targetSelectionRange"]["start"]["line"], 1);
    assert_eq!(
        unopened_locs[0]["targetSelectionRange"]["start"]["character"],
        16
    );
    assert_eq!(
        unopened_locs[0]["damHopperDestinationContentSha256"],
        dam_hopper_server::semantic::uri::compute_text_sha256(unopened_text)
    );
    assert!(unopened_locs[0]["damHopperDestinationVersion"].is_null());
    assert!(unopened_locs[0]["damHopperDestinationIncarnation"].is_null());

    // Verify child RPC log shows didOpen(unopened.ts) -> definition -> didClose(unopened.ts)
    let log_text = std::fs::read_to_string(&rpc_log_path).unwrap();
    assert!(
        log_text.contains(&format!(
            r#"{{"method":"textDocument/didOpen","uri":"{unopened_file_uri}"}}"#
        )),
        "Server must pin unopened destination via didOpen before requerying"
    );
    assert!(
        log_text.contains(&format!(
            r#"{{"method":"textDocument/didClose","uri":"{unopened_file_uri}"}}"#
        )),
        "Server must close temporary unopened destination pin after requery"
    );

    // 3. Query definition on line 2 (returns out-of-bounds line 500 -> must fail closed to empty array)
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 12,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": main_virt_uri },
                "position": { "line": 2, "character": 0 },
                "damHopperDocumentVersion": 3
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let oob_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(oob_res["id"], 12);
    assert_eq!(oob_res["result"], json!([]));
}

#[tokio::test]
async fn test_f3_preserve_query_snapshot_proof_remediation() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("f3-remed-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
    let disk_unopened_text = "// disk header line\nexport function helper(): number {\n  return 99;\n}\n";
    let main_path = project_dir.join("src/main.ts");
    let unopened_path = project_dir.join("src/unopened.ts");
    std::fs::write(&main_path, main_text).unwrap();
    std::fs::write(&unopened_path, disk_unopened_text).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let canonical_unopened = dunce::canonicalize(&unopened_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main).unwrap().to_string();
    let unopened_file_uri = url::Url::from_file_path(&canonical_unopened).unwrap().to_string();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    let custom_cli = format!(
        r#"
import fs from 'node:fs';
const mainUri = {main_uri:?};
const unopenedUri = {unopened_uri:?};
const openDocs = new Map();
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      openDocs.set(msg.params.textDocument.uri, msg.params.textDocument.text);
    }} else if (msg.method === 'textDocument/didClose') {{
      openDocs.delete(msg.params.textDocument.uri);
    }} else if (msg.method === 'textDocument/definition') {{
      const isPinned = openDocs.has(unopenedUri);
      send({{
        jsonrpc: '2.0',
        id: msg.id,
        result: [{{
          targetUri: unopenedUri,
          targetRange: {{ start: {{ line: isPinned ? 1 : 0, character: 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 32 : 2 }} }},
          targetSelectionRange: {{ start: {{ line: isPinned ? 1 : 0, character: isPinned ? 16 : 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 22 : 2 }} }}
        }}]
      }});
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        main_uri = main_file_uri,
        unopened_uri = unopened_file_uri,
    );
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("f3-remed-project", project_dir.clone())]).await;
    let state = base_state.with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget",
            "params": { "target": { "project": "f3-remed-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();

    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    let unopened_virt_uri = format!("dam-hopper://semantic/{target_id}/src/unopened.ts");

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // 1. Unopened pin-and-requery: proof extracted from _damHopperProvenSnapshots, metadata stripped from output
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 10, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let def_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(def_res["id"], 10);
    assert!(def_res.get("_damHopperProvenSnapshots").is_none(), "Internal proven snapshots must be stripped from response");
    let locs = def_res["result"].as_array().unwrap();
    assert_eq!(locs.len(), 1);
    assert_eq!(
        locs[0]["damHopperDestinationContentSha256"],
        dam_hopper_server::semantic::uri::compute_text_sha256(disk_unopened_text)
    );
    assert_eq!(locs[0]["damHopperDestinationVersion"], Value::Null);

    // 2. Positive control: User-open destination before pin with different content from disk.
    // Requery must succeed using the actor's immutable proof, preserving user's version and contentSha256!
    let user_open_text = "// user overlay line\nexport function helper(): number {\n  return 100;\n}\n";
    let user_open_sha = dam_hopper_server::semantic::uri::compute_text_sha256(user_open_text);
    assert_ne!(user_open_sha, dam_hopper_server::semantic::uri::compute_text_sha256(disk_unopened_text));

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": { "textDocument": { "uri": unopened_virt_uri, "languageId": "typescript", "version": 5, "text": user_open_text } }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 11, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let open_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(open_res["id"], 11);
    let open_locs = open_res["result"].as_array().unwrap();
    assert_eq!(open_locs.len(), 1);
    assert_eq!(open_locs[0]["damHopperDestinationContentSha256"], user_open_sha);
    assert_eq!(open_locs[0]["damHopperDestinationVersion"], 5);
}

#[tokio::test]
async fn test_f9_retain_logical_cancellation_ownership_remediation() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("f9-remed-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "export const val = 42;\nexport const refVal = val;\n";
    let main_path = project_dir.join("src/main.ts");
    std::fs::write(&main_path, main_text).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main).unwrap().to_string();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    let custom_cli = format!(
        r#"
import fs from 'node:fs';
const mainUri = {main_uri:?};
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      // Open doc
    }} else if (msg.method === 'textDocument/definition') {{
      // Simulate a slightly delayed response so client can cancel or test duplicate IDs
      setTimeout(() => {{
        send({{
          jsonrpc: '2.0',
          id: msg.id,
          result: [{{
            uri: mainUri,
            range: {{ start: {{ line: 0, character: 13 }}, end: {{ line: 0, character: 16 }} }}
          }}]
        }});
      }}, 100);
    }} else if (msg.method === '$/cancelRequest') {{
      // Acknowledged cancel
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        main_uri = main_file_uri,
    );
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("f9-remed-project", project_dir.clone())]).await;
    let state = base_state.with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget",
            "params": { "target": { "project": "f9-remed-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();

    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // 1. Duplicate ID rejection while in-flight:
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 50, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 1, "character": 22 }, "damHopperDocumentVersion": 1 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // Immediately send duplicate request with same client ID 50
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 50, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 1, "character": 22 }, "damHopperDocumentVersion": 1 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // The duplicate request must immediately fail with DUPLICATE_REQUEST_ID (-32600)
    let dup_err = read_next_json(&mut ws).await.unwrap();
    assert_eq!(dup_err["id"], 50);
    assert_eq!(dup_err["error"]["code"], -32600);

    // The original request 50 completes successfully
    let orig_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(orig_res["id"], 50);
    assert!(orig_res.get("result").is_some());

    // 2. Cancellation: Client sends request with ID 60 and immediately cancels it
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 60, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 1, "character": 22 }, "damHopperDocumentVersion": 1 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "$/cancelRequest",
            "params": { "id": 60 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // The cancelled request must return -32800 REQUEST_CANCELLED
    let cancel_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(cancel_res["id"], 60);
    assert_eq!(cancel_res["error"]["code"], -32800);

    // 3. ID reuse after terminal completion: ID 60 can now be reused cleanly
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 60, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 1, "character": 22 }, "damHopperDocumentVersion": 1 }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let reused_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(reused_res["id"], 60);
    assert!(reused_res.get("result").is_some());
}

#[tokio::test]
async fn test_f3_interleaving_with_barrier_remediation() {
    use dam_hopper_server::semantic::gateway::test_barriers;
    let _guard = test_barriers::BarrierGuard;
    test_barriers::F3_ENABLED.store(true, std::sync::atomic::Ordering::SeqCst);

    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("f3-barrier-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
    let unopened_text_a = "// header line\nexport function helper(): number {\n  return 99;\n}\n";
    let sha_a = dam_hopper_server::semantic::uri::compute_text_sha256(unopened_text_a);
    let main_path = project_dir.join("src/main.ts");
    let unopened_path = project_dir.join("src/unopened.ts");
    std::fs::write(&main_path, main_text).unwrap();
    std::fs::write(&unopened_path, unopened_text_a).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let canonical_unopened = dunce::canonicalize(&unopened_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main).unwrap().to_string();
    let unopened_file_uri = url::Url::from_file_path(&canonical_unopened).unwrap().to_string();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    let custom_cli = format!(
        r#"
import fs from 'node:fs';
const mainUri = {main_uri:?};
const unopenedUri = {unopened_uri:?};
const openDocs = new Map();
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      openDocs.set(msg.params.textDocument.uri, msg.params.textDocument.text);
    }} else if (msg.method === 'textDocument/didClose') {{
      openDocs.delete(msg.params.textDocument.uri);
    }} else if (msg.method === 'textDocument/definition') {{
      const isPinned = openDocs.has(unopenedUri);
      send({{
        jsonrpc: '2.0',
        id: msg.id,
        result: [{{
          targetUri: unopenedUri,
          targetRange: {{ start: {{ line: isPinned ? 1 : 0, character: 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 32 : 2 }} }},
          targetSelectionRange: {{ start: {{ line: isPinned ? 1 : 0, character: isPinned ? 16 : 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 22 : 2 }} }}
        }}]
      }});
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        main_uri = main_file_uri,
        unopened_uri = unopened_file_uri,
    );
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("f3-barrier-project", project_dir.clone())]).await;
    let supervisor = Arc::new(dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)));
    let state = base_state.with_semantic_supervisor(supervisor.clone());
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget",
        "params": { "target": { "project": "f3-barrier-project" }, "descriptor": "typescript" }
    }).to_string().into())).await.unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();

    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } }
    }).to_string().into())).await.unwrap();

    let barrier_paused = test_barriers::F3_PAUSE_NOTIFY.notified();
    tokio::pin!(barrier_paused);

    // Send definition query
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 101, "method": "textDocument/definition",
        "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 }
    }).to_string().into())).await.unwrap();

    // Wait for gateway to pause at F3 barrier
    barrier_paused.await;

    // Mutate destination in session overlay while paused
    let text_b = "// mutated B\n// second line has length 35 chars!\nexport function helperB(): number {\n  return 999;\n}\n";
    let sha_b = dam_hopper_server::semantic::uri::compute_text_sha256(text_b);

    ws.send(Message::Text(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": format!("dam-hopper://semantic/{target_id}/src/unopened.ts"),
                "languageId": "typescript",
                "version": 2,
                "text": text_b
            }
        }
    }).to_string().into())).await.unwrap();
    // Deterministic causal synchronization: send a probe message with id 996 to guarantee didOpen
    // was fully processed by reader loop before resuming the barrier!
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 996, "method": "unknownProbe", "params": {}
    }).to_string().into())).await.unwrap();
    let probe_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(probe_res["id"], 996);

    // Resume gateway
    test_barriers::F3_RESUME_NOTIFY.notify_waiters();
    let res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(res["id"], 101);

    // CRITICAL ACCEPTANCE: Gateway NEVER outputs A coordinates labeled with B's proof!
    // Gateway uses exact immutable requery proof (sha_a), NEVER live text proof (sha_b)!
    let locs = res["result"].as_array().expect("result array");
    assert_eq!(locs.len(), 1);
    assert_eq!(
        locs[0]["damHopperDestinationContentSha256"], sha_a,
        "Gateway must use exact immutable requery proof (sha_a), NEVER live text proof (sha_b)"
    );
    assert_ne!(locs[0]["damHopperDestinationContentSha256"], sha_b);
    test_barriers::F3_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[tokio::test]
async fn test_f9_gap_cancellation_with_barrier_remediation() {
    use dam_hopper_server::semantic::gateway::test_barriers;
    let _guard = test_barriers::BarrierGuard;
    test_barriers::F9_GAP_ENABLED.store(true, std::sync::atomic::Ordering::SeqCst);

    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("f9-gap-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
    let unopened_text = "// header line\nexport function helper(): number {\n  return 99;\n}\n";
    let main_path = project_dir.join("src/main.ts");
    let unopened_path = project_dir.join("src/unopened.ts");
    std::fs::write(&main_path, main_text).unwrap();
    std::fs::write(&unopened_path, unopened_text).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let canonical_unopened = dunce::canonicalize(&unopened_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main).unwrap().to_string();
    let unopened_file_uri = url::Url::from_file_path(&canonical_unopened).unwrap().to_string();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    let custom_cli = format!(
        r#"
import fs from 'node:fs';
const mainUri = {main_uri:?};
const unopenedUri = {unopened_uri:?};
const openDocs = new Map();
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      openDocs.set(msg.params.textDocument.uri, msg.params.textDocument.text);
    }} else if (msg.method === 'textDocument/didClose') {{
      openDocs.delete(msg.params.textDocument.uri);
    }} else if (msg.method === 'textDocument/definition') {{
      const isPinned = openDocs.has(unopenedUri);
      send({{
        jsonrpc: '2.0',
        id: msg.id,
        result: [{{
          targetUri: unopenedUri,
          targetRange: {{ start: {{ line: isPinned ? 1 : 0, character: 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 32 : 2 }} }},
          targetSelectionRange: {{ start: {{ line: isPinned ? 1 : 0, character: isPinned ? 16 : 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 22 : 2 }} }}
        }}]
      }});
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        main_uri = main_file_uri,
        unopened_uri = unopened_file_uri,
    );
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("f9-gap-project", project_dir.clone())]).await;
    let state = base_state.with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget",
        "params": { "target": { "project": "f9-gap-project" }, "descriptor": "typescript" }
    }).to_string().into())).await.unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();

    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } }
    }).to_string().into())).await.unwrap();

    let barrier_paused = test_barriers::F9_GAP_PAUSE_NOTIFY.notified();
    tokio::pin!(barrier_paused);

    // Send definition query with client ID 501
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 501, "method": "textDocument/definition",
        "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 }
    }).to_string().into())).await.unwrap();

    // Wait for gateway to pause in the pin gap
    barrier_paused.await;

    // Client sends $/cancelRequest for in-flight ID 501
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "method": "$/cancelRequest",
        "params": { "id": 501 }
    }).to_string().into())).await.unwrap();
    // Deterministic causal synchronization: send a probe message with id 998 to guarantee cancelRequest
    // was fully processed by reader loop before resuming the barrier!
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 998, "method": "unknownProbe", "params": {}
    }).to_string().into())).await.unwrap();
    let probe_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(probe_res["id"], 998);

    // Resume gateway
    test_barriers::F9_GAP_RESUME_NOTIFY.notify_waiters();
    // The gateway must cancel before stage 2 and return -32800 Request cancelled
    let res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(res["id"], 501);
    assert_eq!(res["error"]["code"], -32800, "Gap cancellation must return -32800 REQUEST_CANCELLED");

    test_barriers::F9_GAP_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[tokio::test]
async fn test_f9_stage2_cancellation_with_barrier_remediation() {
    use dam_hopper_server::semantic::gateway::test_barriers;
    let _guard = test_barriers::BarrierGuard;
    test_barriers::F9_STAGE2_ENABLED.store(true, std::sync::atomic::Ordering::SeqCst);

    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("f9-stage2-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
    let unopened_text = "// header line\nexport function helper(): number {\n  return 99;\n}\n";
    let main_path = project_dir.join("src/main.ts");
    let unopened_path = project_dir.join("src/unopened.ts");
    std::fs::write(&main_path, main_text).unwrap();
    std::fs::write(&unopened_path, unopened_text).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let canonical_unopened = dunce::canonicalize(&unopened_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main).unwrap().to_string();
    let unopened_file_uri = url::Url::from_file_path(&canonical_unopened).unwrap().to_string();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    let custom_cli = format!(
        r#"
import fs from 'node:fs';
const mainUri = {main_uri:?};
const unopenedUri = {unopened_uri:?};
const openDocs = new Map();
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      openDocs.set(msg.params.textDocument.uri, msg.params.textDocument.text);
    }} else if (msg.method === 'textDocument/didClose') {{
      openDocs.delete(msg.params.textDocument.uri);
    }} else if (msg.method === 'textDocument/definition') {{
      const isPinned = openDocs.has(unopenedUri);
      send({{
        jsonrpc: '2.0',
        id: msg.id,
        result: [{{
          targetUri: unopenedUri,
          targetRange: {{ start: {{ line: isPinned ? 1 : 0, character: 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 32 : 2 }} }},
          targetSelectionRange: {{ start: {{ line: isPinned ? 1 : 0, character: isPinned ? 16 : 0 }}, end: {{ line: isPinned ? 1 : 0, character: isPinned ? 22 : 2 }} }}
        }}]
      }});
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        main_uri = main_file_uri,
        unopened_uri = unopened_file_uri,
    );
    std::fs::write(&cli_path, custom_cli).unwrap();
    let profile = toolchain.tool_profile();

    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("f9-stage2-project", project_dir.clone())]).await;
    let state = base_state.with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));
    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server(state.clone()).await;

    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(req).await.unwrap();

    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget",
        "params": { "target": { "project": "f9-stage2-project" }, "descriptor": "typescript" }
    }).to_string().into())).await.unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();

    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } }
    }).to_string().into())).await.unwrap();

    let barrier_paused = test_barriers::F9_STAGE2_PAUSE_NOTIFY.notified();
    tokio::pin!(barrier_paused);

    // Send definition query with client ID 502
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 502, "method": "textDocument/definition",
        "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 }
    }).to_string().into())).await.unwrap();

    // Wait for gateway to pause in stage 2 after submission
    barrier_paused.await;

    // Client sends $/cancelRequest for in-flight ID 502
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "method": "$/cancelRequest",
        "params": { "id": 502 }
    }).to_string().into())).await.unwrap();
    // Deterministic causal synchronization: send a probe message with id 997 to guarantee cancelRequest
    // was fully processed and child cancel dispatched before resuming the barrier!
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 997, "method": "unknownProbe", "params": {}
    }).to_string().into())).await.unwrap();
    let probe_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(probe_res["id"], 997);

    // Resume gateway
    test_barriers::F9_STAGE2_RESUME_NOTIFY.notify_waiters();
    // The gateway must cancel active stage 2 child and return -32800 Request cancelled
    let res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(res["id"], 502);
    assert_eq!(res["error"]["code"], -32800, "Stage-2 cancellation must return -32800 REQUEST_CANCELLED");

    test_barriers::F9_STAGE2_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[tokio::test]
async fn test_gateway_concurrency_saturation_and_cleanup() {
    let tmp = TempDir::new().unwrap();
    let project_dir = tmp.path().join("concurrency-saturation-project");
    std::fs::create_dir_all(project_dir.join("src")).unwrap();

    let main_text = "export const x = 42;\n";
    let main_path = project_dir.join("src/main.ts");
    std::fs::write(&main_path, main_text).unwrap();

    let canonical_main = dunce::canonicalize(&main_path).unwrap();
    let main_file_uri = url::Url::from_file_path(&canonical_main).unwrap().to_string();

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let cli_path = toolchain
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");

    let custom_cli = format!(
        r#"
const mainUri = {main_uri:?};
let buf = Buffer.alloc(0);
function send(obj) {{
  const s = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${{Buffer.byteLength(s, 'utf8')}}\r\n\r\n${{s}}`);
}}
process.stdin.on('data', (chunk) => {{
  buf = Buffer.concat([buf, chunk]);
  while (true) {{
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const m = buf.slice(0, idx).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString('utf8'));
    buf = buf.slice(idx + 4 + len);
    if (msg.method === 'initialize') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: {{ capabilities: {{ textDocumentSync: 2, definitionProvider: true }} }} }});
    }} else if (msg.method === 'textDocument/didOpen') {{
      // noop
    }} else if (msg.method === 'textDocument/definition') {{
      setTimeout(() => {{
        send({{ jsonrpc: '2.0', id: msg.id, result: [] }});
      }}, 60);
    }} else if (msg.method === 'shutdown') {{
      send({{ jsonrpc: '2.0', id: msg.id, result: null }});
    }} else if (msg.method === 'exit') {{
      process.exit(0);
    }}
  }}
}});
"#,
        main_uri = main_file_uri
    );
    std::fs::write(&cli_path, custom_cli).unwrap();

    let profile = toolchain.tool_profile();
    let (base_state, _unused_tc) =
        make_test_app(&tmp, vec![("concurrency-project", project_dir.clone())]).await;
    let supervisor = Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    );
    let state = base_state.with_semantic_supervisor(supervisor.clone());
    state.semantic_supervisor.set_enabled(true).await;

    let addr = start_server(state.clone()).await;
    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();

    let (mut ws, _) = connect_async(req).await.unwrap();

    // Attach target
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget",
            "params": { "target": { "project": "concurrency-project" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = read_next_json(&mut ws).await.unwrap();
    assert_eq!(attach_res["id"], 1);
    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();

    // Initialize
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();

    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } }
    }).to_string().into())).await.unwrap();

    // Send 8 navigation requests to saturate all slots
    for id in 10..18 {
        ws.send(Message::Text(json!({
            "jsonrpc": "2.0", "id": id, "method": "textDocument/definition",
            "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 13 }, "damHopperDocumentVersion": 1 }
        }).to_string().into())).await.unwrap();
    }

    // 9th request must be immediately rejected with RPC_ERR_IN_FLIGHT_FULL (-32004)
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 999, "method": "textDocument/definition",
        "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 13 }, "damHopperDocumentVersion": 1 }
    }).to_string().into())).await.unwrap();

    let err999 = read_next_json(&mut ws).await.unwrap();
    assert_eq!(err999["id"], 999);
    assert_eq!(err999["error"]["code"], -32004, "9th concurrent request must be rejected with RPC_ERR_IN_FLIGHT_FULL");

    // Drain the 8 responses
    for _ in 10..18 {
        let res = read_next_json(&mut ws).await.unwrap();
        assert!(res.get("result").is_some());
    }

    // 10th request after drain must succeed, proving slot freed
    ws.send(Message::Text(json!({
        "jsonrpc": "2.0", "id": 1000, "method": "textDocument/definition",
        "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 13 }, "damHopperDocumentVersion": 1 }
    }).to_string().into())).await.unwrap();

    let res1000 = read_next_json(&mut ws).await.unwrap();
    assert_eq!(res1000["id"], 1000);
    assert!(res1000.get("result").is_some(), "Freed concurrency slot must permit subsequent request");

    supervisor.shutdown().await;
}

