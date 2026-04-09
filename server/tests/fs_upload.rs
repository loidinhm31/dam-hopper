/// WS upload protocol integration tests.
///
/// Tests the full fs:upload_begin → fs:upload_chunk (binary) → fs:upload_commit cycle.
use std::{net::SocketAddr, sync::Arc, time::Duration};

use dev_hub_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DevHubConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo},
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const TEST_TOKEN: &str = "upload-test-token";
const CHUNK_SIZE: usize = 128 * 1024;

fn make_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let config = DevHubConfig {
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
        features: FeaturesConfig { ide_explorer: true, ..Default::default() },
        config_path: workspace_dir.join("dev-hub.toml"),
    };
    let (event_sink, _) = BroadcastEventSink::new(64);
    let pty = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dev-hub/agent-store"));
    let fs = FsSubsystem::new(workspace_dir.clone());
    AppState::new(workspace_dir, config, GlobalConfig::default(), pty, agent_store, event_sink, TEST_TOKEN.to_string(), fs)
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
    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), TEST_TOKEN);
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

/// Full upload: begin → N chunks → commit. Returns the result message.
async fn do_upload(ws: &mut WsStream, upload_id: &str, filename: &str, data: &[u8]) -> Value {
    let len = data.len() as u64;

    // Begin
    ws.send(Message::Text(json!({
        "kind": "fs:upload_begin",
        "req_id": 100,
        "upload_id": upload_id,
        "project": "proj",
        "dir": "",
        "filename": filename,
        "len": len,
    }).to_string().into())).await.unwrap();

    let begin_ack = next_json(ws, Duration::from_secs(5)).await.expect("upload_begin_ok");
    assert_eq!(begin_ack["kind"], "fs:upload_begin_ok", "{begin_ack}");

    // Chunks
    let mut seq: u64 = 0;
    for chunk in data.chunks(CHUNK_SIZE) {
        ws.send(Message::Text(json!({
            "kind": "fs:upload_chunk",
            "upload_id": upload_id,
            "seq": seq,
        }).to_string().into())).await.unwrap();
        ws.send(Message::Binary(chunk.to_vec().into())).await.unwrap();

        let chunk_ack = next_json(ws, Duration::from_secs(10)).await.expect("upload_chunk_ack");
        assert_eq!(chunk_ack["kind"], "fs:upload_chunk_ack", "{chunk_ack}");
        assert_eq!(chunk_ack["seq"], seq);
        seq += 1;
    }

    // Commit
    ws.send(Message::Text(json!({
        "kind": "fs:upload_commit",
        "req_id": 101,
        "upload_id": upload_id,
    }).to_string().into())).await.unwrap();

    next_json(ws, Duration::from_secs(10)).await.expect("upload_result")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upload_happy_path_file_content_matches() {
    let tmp = tempfile::tempdir().unwrap();
    let content = b"Hello, upload world!";
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    let result = do_upload(&mut ws, "upload-1", "hello-upload.txt", content).await;

    assert_eq!(result["kind"], "fs:upload_result", "{result}");
    assert_eq!(result["ok"], true, "{result}");

    let written = std::fs::read(tmp.path().join("hello-upload.txt")).unwrap();
    assert_eq!(written, content);

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_multi_chunk_large_file() {
    let tmp = tempfile::tempdir().unwrap();
    // 300 KB → 3 chunks
    let content: Vec<u8> = (0..300 * 1024).map(|i| (i % 251) as u8).collect();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    let result = do_upload(&mut ws, "upload-2", "large.bin", &content).await;

    assert_eq!(result["ok"], true, "{result}");
    let written = std::fs::read(tmp.path().join("large.bin")).unwrap();
    assert_eq!(written, content);

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_zip_slip_filename_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    ws.send(Message::Text(json!({
        "kind": "fs:upload_begin",
        "req_id": 200,
        "upload_id": "zip-slip",
        "project": "proj",
        "dir": "",
        "filename": "../evil.txt",
        "len": 5,
    }).to_string().into())).await.unwrap();

    let resp = next_json(&mut ws, Duration::from_secs(5)).await.expect("response");
    // Should return fs:error (not begin_ok)
    assert_ne!(resp["kind"], "fs:upload_begin_ok", "zip-slip must be rejected: {resp}");

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_len_over_100mb_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    ws.send(Message::Text(json!({
        "kind": "fs:upload_begin",
        "req_id": 300,
        "upload_id": "toolarge",
        "project": "proj",
        "dir": "",
        "filename": "big.bin",
        "len": 101 * 1024 * 1024u64,
    }).to_string().into())).await.unwrap();

    let resp = next_json(&mut ws, Duration::from_secs(5)).await.expect("response");
    assert_ne!(resp["kind"], "fs:upload_begin_ok", "oversized upload must be rejected: {resp}");

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_out_of_order_seq_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let content = b"some data";
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    // Begin
    ws.send(Message::Text(json!({
        "kind": "fs:upload_begin",
        "req_id": 400,
        "upload_id": "oos",
        "project": "proj",
        "dir": "",
        "filename": "oos.txt",
        "len": content.len() as u64,
    }).to_string().into())).await.unwrap();
    let begin_ack = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(begin_ack["kind"], "fs:upload_begin_ok");

    // Send chunk with wrong seq (should be 0, sending 5)
    ws.send(Message::Text(json!({
        "kind": "fs:upload_chunk",
        "upload_id": "oos",
        "seq": 5u64,
    }).to_string().into())).await.unwrap();
    ws.send(Message::Binary(content.to_vec().into())).await.unwrap();

    // Commit should now fail (session dropped)
    ws.send(Message::Text(json!({
        "kind": "fs:upload_commit",
        "req_id": 401,
        "upload_id": "oos",
    }).to_string().into())).await.unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5)).await.expect("result");
    assert_eq!(result["ok"], false, "out-of-order seq must cause commit failure: {result}");

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_commit_without_matching_bytes_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    // Declare 100 bytes but send only 5
    ws.send(Message::Text(json!({
        "kind": "fs:upload_begin",
        "req_id": 500,
        "upload_id": "short",
        "project": "proj",
        "dir": "",
        "filename": "short.txt",
        "len": 100u64,
    }).to_string().into())).await.unwrap();
    next_json(&mut ws, Duration::from_secs(5)).await.expect("begin_ok");

    ws.send(Message::Text(json!({
        "kind": "fs:upload_chunk",
        "upload_id": "short",
        "seq": 0u64,
    }).to_string().into())).await.unwrap();
    ws.send(Message::Binary(b"hello".to_vec().into())).await.unwrap();
    next_json(&mut ws, Duration::from_secs(5)).await.expect("chunk_ack");

    // Commit early (bytes_written=5, expected_len=100)
    ws.send(Message::Text(json!({
        "kind": "fs:upload_commit",
        "req_id": 501,
        "upload_id": "short",
    }).to_string().into())).await.unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5)).await.expect("result");
    assert_eq!(result["ok"], false, "incomplete upload must be rejected at commit: {result}");

    ws.close(None).await.unwrap();
}
