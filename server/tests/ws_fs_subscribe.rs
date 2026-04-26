/// End-to-end WebSocket FS subscription test.
///
/// Spins a real dam-hopper-server on an ephemeral port, connects via
/// tokio-tungstenite, exercises the full subscribe → snapshot → event → unsubscribe
/// cycle, and verifies the refcount cleanup.
use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const TEST_TOKEN: &str = "ws-test-token-xyz";
fn test_jwt() -> String {
    use jsonwebtoken::{encode, Header, EncodingKey};
    #[derive(serde::Serialize)]
    struct Claims { sub: String, exp: usize }
    let claims = Claims { sub: "test-user".into(), exp: (chrono::Utc::now().timestamp() as usize) + 3600 };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(TEST_TOKEN.as_bytes())).unwrap()
}

fn make_test_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo { name: "ws-test".into(), root: ".".into() },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "test-project".into(),
            path: workspace_dir.to_string_lossy().into_owned(),
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
        }],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(workspace_dir.clone());
    let tunnel_manager = common::make_tunnel_manager(&event_sink);

    AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_TOKEN.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
    ).expect("make_test_state failed")
}

async fn spawn_server(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state, vec![]);
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    addr
}

/// Read the next JSON text frame from the WS stream (with timeout).
async fn next_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    timeout: Duration,
) -> Option<Value> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                return serde_json::from_str(&t).ok();
            }
            Ok(Some(Ok(_))) => continue, // Ping/Binary
            _ => return None,
        }
    }
}

// ---------------------------------------------------------------------------
// Test: subscribe → snapshot → unsubscribe
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ws_fs_subscribe_receives_snapshot() {
    let tmp = tempfile::tempdir().unwrap();

    // Seed a file so the snapshot is non-empty
    std::fs::write(tmp.path().join("hello.txt"), "hello").unwrap();

    let state = make_test_state(&tmp);
    let addr = spawn_server(state).await;

    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (mut ws, _) = connect_async(&url).await.expect("WS connect failed");

    // Subscribe
    let sub_msg = json!({
        "kind": "fs:subscribe_tree",
        "req_id": 1,
        "project": "test-project",
        "path": ""
    });
    ws.send(Message::Text(sub_msg.to_string().into())).await.unwrap();

    // Expect snapshot
    let snapshot = next_json(&mut ws, Duration::from_secs(5)).await
        .expect("expected fs:tree_snapshot");

    assert_eq!(snapshot["kind"], "fs:tree_snapshot", "unexpected: {snapshot}");
    assert_eq!(snapshot["req_id"], 1);
    assert!(snapshot["sub_id"].is_number(), "sub_id missing");
    let nodes = snapshot["nodes"].as_array().expect("nodes array");
    assert!(
        nodes.iter().any(|n| n["name"] == "hello.txt"),
        "hello.txt not in snapshot: {nodes:?}"
    );

    ws.close(None).await.unwrap();
}

// ---------------------------------------------------------------------------
// Test: create file → receive fs:event
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ws_fs_subscribe_receives_create_event() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let addr = spawn_server(state).await;

    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (mut ws, _) = connect_async(&url).await.expect("WS connect failed");

    ws.send(Message::Text(
        json!({
            "kind": "fs:subscribe_tree",
            "req_id": 2,
            "project": "test-project",
            "path": ""
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // Drain snapshot
    let _snap = next_json(&mut ws, Duration::from_secs(5)).await
        .expect("expected snapshot");

    // Create file — should trigger fs:event
    let new_file = tmp.path().join("new-file.txt");
    std::fs::write(&new_file, "data").unwrap();

    // Poll for event with 3s window (debounce = 150ms)
    let event = next_json(&mut ws, Duration::from_secs(3)).await
        .expect("expected fs:event after file create");

    assert_eq!(event["kind"], "fs:event", "unexpected msg: {event}");
    let ev = &event["event"];
    assert_eq!(ev["kind"], "created");
    assert!(
        ev["path"].as_str().map(|p| p.contains("new-file.txt")).unwrap_or(false),
        "path missing new-file.txt: {ev}"
    );

    ws.close(None).await.unwrap();
}

// ---------------------------------------------------------------------------
// Test: unsubscribe stops events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ws_fs_unsubscribe_stops_events() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let addr = spawn_server(state).await;

    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (mut ws, _) = connect_async(&url).await.expect("WS connect failed");

    ws.send(Message::Text(
        json!({
            "kind": "fs:subscribe_tree",
            "req_id": 3,
            "project": "test-project",
            "path": ""
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let snap = next_json(&mut ws, Duration::from_secs(5)).await.expect("snapshot");
    let sub_id = snap["sub_id"].as_u64().unwrap();

    // Unsubscribe
    ws.send(Message::Text(
        json!({ "kind": "fs:unsubscribe_tree", "sub_id": sub_id }).to_string().into(),
    ))
    .await
    .unwrap();

    // Wait for unsubscribe to propagate
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Create file — should NOT produce an event
    std::fs::write(tmp.path().join("after-unsub.txt"), "x").unwrap();

    // Give a short window; no event expected
    let spurious = next_json(&mut ws, Duration::from_millis(700)).await;
    assert!(
        spurious.is_none()
            || spurious
                .as_ref()
                .map(|v| v["kind"] != "fs:event")
                .unwrap_or(false),
        "received unexpected event after unsubscribe: {spurious:?}"
    );

    ws.close(None).await.unwrap();
}

// ---------------------------------------------------------------------------
// Test: non-existent project → fs:error
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ws_fs_subscribe_nonexistent_project_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let addr = spawn_server(state).await;

    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (mut ws, _) = connect_async(&url).await.expect("WS connect failed");

    ws.send(Message::Text(
        json!({
            "kind": "fs:subscribe_tree",
            "req_id": 99,
            "project": "no-such-project",
            "path": ""
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let resp = next_json(&mut ws, Duration::from_secs(3)).await
        .expect("expected error response");

    assert_eq!(resp["kind"], "fs:error", "unexpected: {resp}");
    assert_eq!(resp["req_id"], 99);

    ws.close(None).await.unwrap();
}

// ---------------------------------------------------------------------------
// Test: two subscribers — second unsub doesn't kill first's events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn watcher_shared_between_two_connections() {
    let tmp = tempfile::tempdir().unwrap();
    let state = make_test_state(&tmp);
    let addr = spawn_server(state).await;

    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    let (mut ws2, _) = connect_async(&url).await.unwrap();

    let sub_msg_1 = json!({ "kind": "fs:subscribe_tree", "req_id": 10, "project": "test-project", "path": "" });
    let sub_msg_2 = json!({ "kind": "fs:subscribe_tree", "req_id": 11, "project": "test-project", "path": "" });

    ws1.send(Message::Text(sub_msg_1.to_string().into())).await.unwrap();
    ws2.send(Message::Text(sub_msg_2.to_string().into())).await.unwrap();

    let _snap1 = next_json(&mut ws1, Duration::from_secs(5)).await.expect("snap1");
    let snap2 = next_json(&mut ws2, Duration::from_secs(5)).await.expect("snap2");
    let sub_id2 = snap2["sub_id"].as_u64().unwrap();

    // Unsubscribe ws2 only
    ws2.send(Message::Text(
        json!({ "kind": "fs:unsubscribe_tree", "sub_id": sub_id2 }).to_string().into(),
    ))
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;

    // ws1 should still receive events — watcher is shared and still alive
    std::fs::write(tmp.path().join("shared-watcher-test.txt"), "x").unwrap();

    let ev = next_json(&mut ws1, Duration::from_secs(3)).await
        .expect("ws1 should still receive events after ws2 unsubscribed");
    assert_eq!(ev["kind"], "fs:event");

    ws1.close(None).await.unwrap();
    ws2.close(None).await.unwrap();
}
