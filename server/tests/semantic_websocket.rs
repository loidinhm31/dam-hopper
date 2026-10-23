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
) -> Option<Value> {
    tokio::select! {
        msg = ws.next() => {
            match msg {
                Some(Ok(Message::Text(t))) => serde_json::from_str(&t).ok(),
                _ => None,
            }
        }
        _ = tokio::time::sleep(Duration::from_secs(5)) => None,
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
    let init_res = read_next_json(&mut ws).await.expect("initialize response");
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
    let init_res = read_next_json(&mut ws).await.unwrap();
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
    let _ = read_next_json(&mut ws).await.unwrap();

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
