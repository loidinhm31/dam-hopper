/// WS write protocol (binary streaming) integration tests.
use std::{net::SocketAddr, sync::Arc, time::Duration};

use base64::Engine;
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo},
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const TEST_TOKEN: &str = "write-test-token";
fn test_jwt() -> String {
    use jsonwebtoken::{encode, Header, EncodingKey};
    #[derive(serde::Serialize)]
    struct Claims { sub: String, exp: usize }
    let claims = Claims { sub: "test-user".into(), exp: (chrono::Utc::now().timestamp() as usize) + 3600 };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(TEST_TOKEN.as_bytes())).unwrap()
}
const CHUNK_SIZE: usize = 128 * 1024;

fn make_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let config = DamHopperConfig {
        workspace: WorkspaceInfo { name: "ws".into(), root: ".".into() },
        agent_store: None,
        projects: vec![ProjectConfig {
            name: "proj".into(),
            path: workspace_dir.to_string_lossy().into_owned(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
        }],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };
    let (event_sink, _) = BroadcastEventSink::new(64);
    let pty = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(workspace_dir.clone());
    AppState::new(workspace_dir, config, GlobalConfig::default(), pty, agent_store, event_sink, TEST_TOKEN.to_string(), fs, None)
}

async fn spawn_server(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state, vec![]);
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    addr
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(addr: SocketAddr) -> WsStream {
    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (ws, _) = connect_async(&url).await.expect("WS connect failed");
    ws
}

async fn next_json(ws: &mut WsStream, timeout: Duration) -> Option<Value> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() { return None; }
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => return serde_json::from_str(&t).ok(),
            Ok(Some(Ok(_))) => continue,
            _ => return None,
        }
    }
}

async fn get_mtime(path: &std::path::Path) -> i64 {
    std::fs::metadata(path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn write_binary_happy_path() {
    let tmp = tempfile::tempdir().unwrap();
    let file_path = tmp.path().join("hello.txt");
    std::fs::write(&file_path, "initial content").unwrap();
    let mtime = get_mtime(&file_path).await;

    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    let new_content = b"Updated content via binary stream";
    let len = new_content.len() as u64;

    // 1. Begin
    ws.send(Message::Text(json!({
        "kind": "fs:write_begin",
        "req_id": 1,
        "project": "proj",
        "path": "hello.txt",
        "expected_mtime": mtime,
        "size": len,
        "encoding": "binary",
    }).to_string().into())).await.unwrap();

    let ack = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_ack");
    assert_eq!(ack["kind"], "fs:write_ack");
    let write_id = ack["write_id"].as_u64().unwrap();

    // 2. Chunk (one chunk for simplicity)
    ws.send(Message::Text(json!({
        "kind": "fs:write_chunk_binary",
        "write_id": write_id,
        "seq": 0,
    }).to_string().into())).await.unwrap();
    ws.send(Message::Binary(new_content.to_vec().into())).await.unwrap();

    let chunk_ack = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_chunk_ack");
    assert_eq!(chunk_ack["kind"], "fs:write_chunk_ack");
    assert_eq!(chunk_ack["seq"], 0);

    // 3. Commit
    ws.send(Message::Text(json!({
        "kind": "fs:write_commit",
        "write_id": write_id,
    }).to_string().into())).await.unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_result");
    assert_eq!(result["kind"], "fs:write_result");
    assert_eq!(result["ok"], true, "{result}");

    let written = std::fs::read(&file_path).unwrap();
    assert_eq!(written, new_content);

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn write_binary_occ_conflict() {
    let tmp = tempfile::tempdir().unwrap();
    let file_path = tmp.path().join("conflict.txt");
    std::fs::write(&file_path, "initial").unwrap();
    let mtime = get_mtime(&file_path).await;

    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    // Begin with correct mtime
    ws.send(Message::Text(json!({
        "kind": "fs:write_begin",
        "req_id": 1,
        "project": "proj",
        "path": "conflict.txt",
        "expected_mtime": mtime,
        "size": 5,
        "encoding": "binary",
    }).to_string().into())).await.unwrap();

    let ack = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_ack");
    let write_id = ack["write_id"].as_u64().unwrap();

    // Now modify the file out of band to change mtime
    // Wait a bit to ensure mtime changes if fs resolution is low
    tokio::time::sleep(Duration::from_millis(1100)).await;
    std::fs::write(&file_path, "modified out of band").unwrap();

    // Send chunk
    ws.send(Message::Text(json!({
        "kind": "fs:write_chunk_binary",
        "write_id": write_id,
        "seq": 0,
    }).to_string().into())).await.unwrap();
    ws.send(Message::Binary(b"chunk".to_vec().into())).await.unwrap();
    next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_chunk_ack");

    // Commit should fail with conflict
    ws.send(Message::Text(json!({
        "kind": "fs:write_commit",
        "write_id": write_id,
    }).to_string().into())).await.unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_result");
    assert_eq!(result["ok"], false);
    assert_eq!(result["conflict"], true);

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn write_binary_out_of_order_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let file_path = tmp.path().join("oos.txt");
    std::fs::write(&file_path, "initial").unwrap();
    let mtime = get_mtime(&file_path).await;

    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    ws.send(Message::Text(json!({
        "kind": "fs:write_begin",
        "req_id": 1,
        "project": "proj",
        "path": "oos.txt",
        "expected_mtime": mtime,
        "size": 10,
        "encoding": "binary",
    }).to_string().into())).await.unwrap();

    let ack = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_ack");
    let write_id = ack["write_id"].as_u64().unwrap();

    // Send chunk with seq 1 instead of 0
    ws.send(Message::Text(json!({
        "kind": "fs:write_chunk_binary",
        "write_id": write_id,
        "seq": 1,
    }).to_string().into())).await.unwrap();

    // Should drop session. Commit should fail.
    ws.send(Message::Text(json!({
        "kind": "fs:write_commit",
        "write_id": write_id,
    }).to_string().into())).await.unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_result");
    assert_eq!(result["ok"], false);
    assert!(result["error"].as_str().unwrap().contains("not found"));

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn write_base64_backward_compatibility() {
    let tmp = tempfile::tempdir().unwrap();
    let file_path = tmp.path().join("compat.txt");
    std::fs::write(&file_path, "initial").unwrap();
    let mtime = get_mtime(&file_path).await;

    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    let new_content = b"Updated via base64";
    let encoded = base64::engine::general_purpose::STANDARD.encode(new_content);

    // Begin without encoding field (defaults to base64)
    ws.send(Message::Text(json!({
        "kind": "fs:write_begin",
        "req_id": 1,
        "project": "proj",
        "path": "compat.txt",
        "expected_mtime": mtime,
        "size": new_content.len() as u64,
    }).to_string().into())).await.unwrap();

    let ack = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_ack");
    let write_id = ack["write_id"].as_u64().unwrap();

    // Send chunk with base64 data
    ws.send(Message::Text(json!({
        "kind": "fs:write_chunk",
        "write_id": write_id,
        "seq": 0,
        "eof": true,
        "data": encoded,
    }).to_string().into())).await.unwrap();

    next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_chunk_ack");

    // Commit
    ws.send(Message::Text(json!({
        "kind": "fs:write_commit",
        "write_id": write_id,
    }).to_string().into())).await.unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:write_result");
    assert_eq!(result["ok"], true);

    let written = std::fs::read(&file_path).unwrap();
    assert_eq!(written, new_content);

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn write_to_nonexistent_file_fails() {
    let tmp = tempfile::tempdir().unwrap();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    // Begin for a file that doesn't exist
    ws.send(Message::Text(json!({
        "kind": "fs:write_begin",
        "req_id": 1,
        "project": "proj",
        "path": "nonexistent.txt",
        "expected_mtime": 0,
        "size": 5,
        "encoding": "binary",
    }).to_string().into())).await.unwrap();

    let resp = next_json(&mut ws, Duration::from_secs(5)).await.expect("fs:error");
    assert_eq!(resp["kind"], "fs:error");
    assert!(resp["code"].as_str().unwrap().contains("PATH_REJECTED"));

    ws.close(None).await.unwrap();
}
