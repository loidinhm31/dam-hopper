#![cfg(target_os = "linux")]

mod common;

use std::fs;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::http;
use common::semantic_fixtures::PackagedToolchain;
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::{
        router::build_router_with_origins,
        semantic_ws::SEMANTIC_SUBPROTOCOL,
    },
    auth::{
        model::AuthClaims,
        AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER,
    },
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
        ServerConfig, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    semantic::{
        protocol::{
            ConnectionId, NavigationParams, Position,
            SemanticState, TextDocumentIdentifier,
        },
        session::{path_to_file_uri, SessionError},
        supervisor::SemanticSupervisor,
    },
    state::AppState,
};
use futures_util::{SinkExt, StreamExt};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{handshake::client::generate_key, Message},
};

const TEST_SECRET: &str = "test-semantic-lifecycle-replay-secret";
const TRUSTED_ORIGIN: &str = "http://trusted.semantic.local";


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

async fn start_server_with_origin(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router_with_origins(
        state,
        vec![axum::http::HeaderValue::from_static(TRUSTED_ORIGIN)],
    );
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    addr
}

async fn read_next_json_with_timeout(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    budget: Duration,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(format!("JSON receive timeout after {} ms", budget.as_millis()));
        }
        let message = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| format!("JSON receive timeout after {} ms", budget.as_millis()))?;
        match message {
            Some(Ok(Message::Text(text))) => {
                return serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {e}"));
            }
            Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => continue,
            Some(Ok(other)) => {
                return Err(format!("Unexpected message frame: {other:?}"));
            }
            Some(Err(e)) => return Err(format!("WebSocket receive error: {e}")),
            None => return Err("WebSocket stream closed unexpectedly".into()),
        }
    }
}

fn assert_definition_points_to_dirty_marker(def: &Value, expected_uri: &str) {
    assert!(def.get("error").is_none(), "Response must not contain error: {def:?}");
    let result = def.get("result").expect("must have result");
    let locs = if let Some(arr) = result.as_array() {
        arr.clone()
    } else if result.is_object() {
        vec![result.clone()]
    } else {
        panic!("Definition result must be array or object, got: {result:?}");
    };
    assert!(!locs.is_empty(), "Definition locations must not be empty: {result:?}");
    let loc = &locs[0];
    let uri = loc.get("uri").or_else(|| loc.get("targetUri")).and_then(Value::as_str).expect("location URI");
    assert_eq!(uri, expected_uri);
    let line = loc.pointer("/range/start/line")
        .or_else(|| loc.pointer("/targetRange/start/line"))
        .or_else(|| loc.pointer("/targetSelectionRange/start/line"))
        .and_then(Value::as_u64)
        .expect("start line");
    assert_eq!(line, 0, "Definition must point to dirtyMarkerA at line 0 (differing from disk)");
}

/// Exercise real-child crash handling, FIFO overlay replay, restart budget exhaustion,
/// and fresh session admission using the packaged Node 24 + TS 5.9 + TSLS 6.0 tuple. (F10)
#[tokio::test]
async fn test_real_tuple_budgeted_replay() {
    let packaged = PackagedToolchain::new();
    let supervisor = SemanticSupervisor::new(Some(packaged.tool_profile()));
    supervisor.set_enabled(true).await;

    let ws_tmp = tempfile::tempdir().expect("ws tempdir");
    let ws = ws_tmp.path();
    let file_a = ws.join("a.ts");
    let file_b = ws.join("b.ts");
    fs::write(&file_a, "export const fromDiskA = 100;\n").unwrap();
    fs::write(&file_b, "export const fromDiskB = 200;\n").unwrap();
    let uri_a = path_to_file_uri(&file_a);
    let uri_b = path_to_file_uri(&file_b);

    let conn_1 = ConnectionId("conn-real-replay-1".into());
    let ep_1 = supervisor.register_connection(&conn_1).await;
    let session = supervisor
        .get_or_create_session(conn_1.clone(), "proj-replay", None, ws.to_path_buf(), ep_1)
        .await
        .unwrap();

    // 1. Open dirty A differing from disk
    session
        .did_open(
            uri_a.clone(),
            "typescript".into(),
            1,
            "export const dirtyMarkerA = 999;\nexport const refMarker = dirtyMarkerA;\n".into(),
        )
        .await
        .unwrap();

    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid1 = session.get_pgid().await.expect("child PGID 1 must exist");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid1));

    // Verify navigation sees dirty A
    let def1 = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: uri_a.clone() },
                position: Position { line: 1, character: 27 },
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_definition_points_to_dirty_marker(&def1, &uri_a);

    // 2. Crash recorded child group 1 (consumes restart 1, backoff 1s)
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid1,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid2 = session.get_pgid().await.expect("child PGID 2 must exist");
    assert_ne!(pgid1, pgid2, "A new replacement child PGID must be spawned");

    // Verify replacement child automatically received dirty A and navigation still sees dirtyMarkerA
    let def2 = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: uri_a.clone() },
                position: Position { line: 1, character: 27 },
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_definition_points_to_dirty_marker(&def2, &uri_a);

    // 3. Crash recorded child group 2 (consumes restart 2, backoff 2s)
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid2,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(Duration::from_millis(2500)).await;
    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid3 = session.get_pgid().await.expect("child PGID 3 must exist");
    assert_ne!(pgid2, pgid3);

    // 4. Crash recorded child group 3 (budget exhausted: max 2 restarts per window)
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid3,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(session.get_state().await, SemanticState::Crashed);

    // 5. Open B without editing A: exhausted actor MUST reject B
    let open_b_res = session
        .did_open(
            uri_b.clone(),
            "typescript".into(),
            1,
            "export const dirtyB = 888;\n".into(),
        )
        .await;
    assert!(
        matches!(open_b_res, Err(SessionError::NotReady(SemanticState::Crashed))),
        "Exhausted actor must reject did_open and not revive"
    );

    // 6. Invalidate connection and open fresh session on same project
    supervisor.invalidate_connection(&conn_1).await;
    let conn_2 = ConnectionId("conn-real-replay-2".into());
    let ep_2 = supervisor.register_connection(&conn_2).await;
    let fresh_session = supervisor
        .get_or_create_session(conn_2, "proj-replay", None, ws.to_path_buf(), ep_2)
        .await
        .unwrap();

    // Fresh session succeeds opening original dirty A and dirty B
    fresh_session
        .did_open(
            uri_a.clone(),
            "typescript".into(),
            1,
            "export const dirtyMarkerA = 999;\nexport const refMarker = dirtyMarkerA;\n".into(),
        )
        .await
        .unwrap();
    let pgid_fresh = fresh_session.get_pgid().await.expect("fresh PGID must exist");
    fresh_session
        .did_open(
            uri_b.clone(),
            "typescript".into(),
            1,
            "import { dirtyMarkerA } from './a';\nexport const useFromB = dirtyMarkerA;\n".into(),
        )
        .await
        .unwrap();
    assert_eq!(fresh_session.get_state().await, SemanticState::Ready);
    let (docs, _) = fresh_session.get_overlay_stats().await;
    assert_eq!(docs, 2);

    // Verify navigation in fresh session sees dirtyMarkerA from B
    let def_b = fresh_session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: uri_b.clone() },
                position: Position { line: 1, character: 27 },
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_definition_points_to_dirty_marker(&def_b, &uri_a);

    supervisor.shutdown().await;
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid1));
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid2));
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid3));
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid_fresh));
}
/// Exercise 60-second idle eviction of initialized empty sessions under regular WebSocket Pings,
/// verifying supervisor tree capacity is reclaimed and subsequent admission succeeds. (F11)
#[tokio::test]
async fn test_empty_session_ping_eviction() {
    let packaged = PackagedToolchain::new();
    let profile = packaged.tool_profile();

    let workspace_dir = tempfile::tempdir().unwrap();
    let p1_dir = workspace_dir.path().join("proj-1");
    let p2_dir = workspace_dir.path().join("proj-2");
    let p3_dir = workspace_dir.path().join("proj-3");
    fs::create_dir_all(&p1_dir).unwrap();
    fs::create_dir_all(&p2_dir).unwrap();
    fs::create_dir_all(&p3_dir).unwrap();
    fs::write(p1_dir.join("index.ts"), "export const x = 1;\n").unwrap();
    fs::write(p2_dir.join("index.ts"), "export const y = 2;\n").unwrap();
    fs::write(p3_dir.join("index.ts"), "export const z = 3;\n").unwrap();

    let config = DamHopperConfig {
        projects: vec![
            ProjectConfig {
                name: "proj-1".into(),
                path: p1_dir.to_string_lossy().to_string(),
                project_type: ProjectType::Custom,
                services: None,
                commands: None,
                env_file: None,
                tags: None,
                terminals: vec![],
                agents: None,
                restart_policy: RestartPolicy::default(),
                restart_max_retries: 5,
                health_check_url: None,
            },
            ProjectConfig {
                name: "proj-2".into(),
                path: p2_dir.to_string_lossy().to_string(),
                project_type: ProjectType::Custom,
                services: None,
                commands: None,
                env_file: None,
                tags: None,
                terminals: vec![],
                agents: None,
                restart_policy: RestartPolicy::default(),
                restart_max_retries: 5,
                health_check_url: None,
            },
            ProjectConfig {
                name: "proj-3".into(),
                path: p3_dir.to_string_lossy().to_string(),
                project_type: ProjectType::Custom,
                services: None,
                commands: None,
                env_file: None,
                tags: None,
                terminals: vec![],
                agents: None,
                restart_policy: RestartPolicy::default(),
                restart_max_retries: 5,
                health_check_url: None,
            },
        ],
        workspace: WorkspaceInfo {
            name: "test-ws".into(),
            root: workspace_dir.path().to_string_lossy().to_string(),
        },
        agent_store: None,
        server: ServerConfig::default(),
        features: FeaturesConfig::default(),
        config_path: workspace_dir.path().join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let agent_store = AgentStoreService::new(workspace_dir.path().join(".dam-hopper/agent-store"));
    let fs_sub = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let opaque_setup = ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng);
    let diagnostics = DiagnosticStore::new(workspace_dir.path().join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_dir.path().to_path_buf(),
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink.clone(),
        TEST_SECRET.to_string(),
        fs_sub,
        None,
        false,
        tunnel_manager,
        None,
        opaque_setup,
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap()
    .with_auth_service(Arc::new(
        dam_hopper_server::auth::AuthService::new_mock_default().0,
    ))
    .with_semantic_supervisor(Arc::new(SemanticSupervisor::new(Some(profile))));

    state.semantic_supervisor.set_enabled(true).await;
    let addr = start_server_with_origin(state.clone()).await;

    // Connect WebSocket 1 (proj-1)
    let token1 = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req1 = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token1}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", TRUSTED_ORIGIN)
        .body(())
        .unwrap();
    let (mut ws1, _) = connect_async(req1).await.expect("connect ws1");

    ws1.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": "proj-1" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach1_resp = read_next_json_with_timeout(&mut ws1, Duration::from_secs(5)).await.unwrap();
    assert!(attach1_resp.get("result").is_some());

    ws1.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "initialize",
            "params": {}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let init1_resp = read_next_json_with_timeout(&mut ws1, Duration::from_secs(15)).await.unwrap();
    assert!(init1_resp.get("result").is_some());

    ws1.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // Connect WebSocket 2 (proj-2)
    let token2 = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req2 = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token2}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", TRUSTED_ORIGIN)
        .body(())
        .unwrap();
    let (mut ws2, _) = connect_async(req2).await.expect("connect ws2");

    ws2.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": "proj-2" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach2_resp = read_next_json_with_timeout(&mut ws2, Duration::from_secs(5)).await.unwrap();
    assert!(attach2_resp.get("result").is_some());

    ws2.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "initialize",
            "params": {}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let init2_resp = read_next_json_with_timeout(&mut ws2, Duration::from_secs(15)).await.unwrap();
    assert!(init2_resp.get("result").is_some());

    ws2.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // Both sessions are initialized with 0 documents; all 2 tree slots are occupied
    let status_occupied = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(status_occupied.active_trees, 2, "Both session trees must be active");
    let empty_pgids = state.semantic_supervisor.get_all_pgids().await;
    assert_eq!(empty_pgids.len(), 2, "Must have recorded exactly 2 child PGIDs");
    // Send Pings every 20 seconds for > 60 seconds (64 seconds total)
    let start_wait = std::time::Instant::now();
    while start_wait.elapsed() < Duration::from_secs(64) {
        let _ = ws1.send(Message::Ping(vec![1, 2, 3].into())).await;
        let _ = ws2.send(Message::Ping(vec![4, 5, 6].into())).await;
        tokio::time::sleep(Duration::from_secs(20)).await;
    }

    // Both empty sessions must be evicted by idle timeout worker despite regular Ping frames
    let status_evicted = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(
        status_evicted.active_trees, 0,
        "Empty sessions must be evicted after 60s idle deadline despite socket Pings"
    );
    for &pgid in &empty_pgids {
        assert!(
            dam_hopper_server::semantic::reaper::is_pgid_empty(pgid),
            "Evicted empty session child PGID {pgid} must be completely reaped"
        );
    }
    // Now connect WebSocket 3 (proj-3); admission must succeed because capacity was reclaimed
    let token3 = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
    let req3 = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token3}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .header("Origin", TRUSTED_ORIGIN)
        .body(())
        .unwrap();
    let (mut ws3, _) = connect_async(req3).await.expect("connect ws3");

    ws3.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": "proj-3" }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach3_resp = read_next_json_with_timeout(&mut ws3, Duration::from_secs(5)).await.unwrap();
    assert!(attach3_resp.get("result").is_some());

    ws3.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "initialize",
            "params": {}
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let init3_resp = read_next_json_with_timeout(&mut ws3, Duration::from_secs(15)).await.unwrap();
    assert!(
        init3_resp.get("result").is_some(),
        "Third session initialization must succeed after empty session eviction"
    );

    let status_after_third = state.semantic_supervisor.get_aggregate_status().await;
    assert_eq!(status_after_third.active_trees, 1);
    let third_pgids = state.semantic_supervisor.get_all_pgids().await;
    assert_eq!(third_pgids.len(), 1, "Must have recorded exactly 1 child PGID for session 3");
    let pgid_third = third_pgids[0];

    drop(ws1);
    drop(ws2);
    drop(ws3);
    state.semantic_supervisor.shutdown().await;
    assert!(
        dam_hopper_server::semantic::reaper::is_pgid_empty(pgid_third),
        "Shutdown must completely reap third session child PGID {pgid_third}"
    );
}
