use opaque_ke::ServerSetup;
/// WS upload protocol integration tests.
///
/// Tests the full fs:upload_begin → fs:upload_chunk (binary) → fs:upload_commit cycle.
use std::{net::SocketAddr, path::Path, process::Command, sync::Arc, time::Duration};

use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtySessionManager},
    state::AppState,
};

mod common;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const TEST_TOKEN: &str = "upload-test-token";
fn test_jwt() -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    #[derive(serde::Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    let claims = Claims {
        sub: "test-user".into(),
        exp: (chrono::Utc::now().timestamp() as usize) + 3600,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_TOKEN.as_bytes()),
    )
    .unwrap()
}
const CHUNK_SIZE: usize = 128 * 1024;

fn make_state(tmp: &TempDir) -> AppState {
    let workspace_dir = tmp.path().to_path_buf();
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "ws".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
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
            restart_policy: Default::default(),
            restart_max_retries: 5,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };
    let (event_sink, _) = BroadcastEventSink::new(64);
    let pty = PtySessionManager::new(Arc::new(NoopEventSink::default()));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![("proj".into(), workspace_dir.clone())]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));
    AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty,
        agent_store,
        event_sink,
        TEST_TOKEN.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut rand::rngs::OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("make_state failed")
}

async fn spawn_server(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state);
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    addr
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(addr: SocketAddr) -> WsStream {
    let url = format!("ws://127.0.0.1:{}/ws?token={}", addr.port(), test_jwt());
    let (ws, _) = connect_async(&url).await.expect("WS connect failed");
    ws
}

async fn next_json(ws: &mut WsStream, timeout: Duration) -> Option<Value> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => return serde_json::from_str(&t).ok(),
            Ok(Some(Ok(_))) => continue,
            _ => return None,
        }
    }
}

/// Full upload: begin → N chunks → commit. Returns the result message.
async fn do_upload(ws: &mut WsStream, upload_id: &str, filename: &str, data: &[u8]) -> Value {
    do_upload_to(ws, upload_id, filename, data, None).await
}

async fn do_upload_to(
    ws: &mut WsStream,
    upload_id: &str,
    filename: &str,
    data: &[u8],
    worktree_path: Option<&Path>,
) -> Value {
    let len = data.len() as u64;

    // Begin
    let mut begin = json!({
        "kind": "fs:upload_begin",
        "req_id": 100,
        "upload_id": upload_id,
        "project": "proj",
        "dir": "",
        "filename": filename,
        "len": len,
    });
    if let Some(worktree_path) = worktree_path {
        begin["worktree_path"] = json!(worktree_path);
    }
    ws.send(Message::Text(begin.to_string().into()))
        .await
        .unwrap();

    let begin_ack = next_json(ws, Duration::from_secs(5))
        .await
        .expect("upload_begin_ok");
    assert_eq!(begin_ack["kind"], "fs:upload_begin_ok", "{begin_ack}");

    // Chunks
    let mut seq: u64 = 0;
    for chunk in data.chunks(CHUNK_SIZE) {
        ws.send(Message::Text(
            json!({
                "kind": "fs:upload_chunk",
                "upload_id": upload_id,
                "seq": seq,
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
        ws.send(Message::Binary(chunk.to_vec().into()))
            .await
            .unwrap();

        let chunk_ack = next_json(ws, Duration::from_secs(10))
            .await
            .expect("upload_chunk_ack");
        assert_eq!(chunk_ack["kind"], "fs:upload_chunk_ack", "{chunk_ack}");
        assert_eq!(chunk_ack["seq"], seq);
        seq += 1;
    }

    // Commit
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_commit",
            "req_id": 101,
            "upload_id": upload_id,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    next_json(ws, Duration::from_secs(10))
        .await
        .expect("upload_result")
}

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
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
async fn upload_targets_registered_worktree_and_rejects_unregistered_sibling() {
    let project = tempfile::tempdir().unwrap();
    let targets = tempfile::tempdir().unwrap();
    let worktree = targets.path().join("feature-worktree");
    git(project.path(), &["init", "-b", "main"]);
    git(
        project.path(),
        &["config", "user.email", "test@example.com"],
    );
    git(project.path(), &["config", "user.name", "Test"]);
    std::fs::write(project.path().join("README.md"), "root").unwrap();
    git(project.path(), &["add", "README.md"]);
    git(project.path(), &["commit", "-m", "initial"]);
    git(
        project.path(),
        &[
            "worktree",
            "add",
            "-b",
            "feature",
            worktree.to_str().unwrap(),
        ],
    );

    let addr = spawn_server(make_state(&project)).await;
    let mut ws = connect(addr).await;
    let result = do_upload_to(
        &mut ws,
        "worktree-upload",
        "target.txt",
        b"target",
        Some(&worktree),
    )
    .await;
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(
        std::fs::read(worktree.join("target.txt")).unwrap(),
        b"target"
    );
    assert!(!project.path().join("target.txt").exists());

    let foreign = targets.path().join("foreign");
    std::fs::create_dir(&foreign).unwrap();
    let mut begin = json!({
        "kind": "fs:upload_begin",
        "req_id": 102,
        "upload_id": "foreign-upload",
        "project": "proj",
        "worktree_path": foreign,
        "dir": "",
        "filename": "escape.txt",
        "len": 1,
    });
    ws.send(Message::Text(begin.take().to_string().into()))
        .await
        .unwrap();
    let rejected = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_ne!(rejected["kind"], "fs:upload_begin_ok");
    assert!(!foreign.join("escape.txt").exists());
    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_commit_rejects_removed_and_recreated_worktree_target() {
    let project = tempfile::tempdir().unwrap();
    let targets = tempfile::tempdir().unwrap();
    let worktree = targets.path().join("replaceable-worktree");
    git(project.path(), &["init", "-b", "main"]);
    git(
        project.path(),
        &["config", "user.email", "test@example.com"],
    );
    git(project.path(), &["config", "user.name", "Test"]);
    std::fs::write(project.path().join("README.md"), "root").unwrap();
    git(project.path(), &["add", "README.md"]);
    git(project.path(), &["commit", "-m", "initial"]);
    git(
        project.path(),
        &[
            "worktree",
            "add",
            "-b",
            "replaceable",
            worktree.to_str().unwrap(),
        ],
    );

    let addr = spawn_server(make_state(&project)).await;
    let mut ws = connect(addr).await;
    let content = b"delayed upload";
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_begin",
            "req_id": 120,
            "upload_id": "replace-target",
            "project": "proj",
            "worktree_path": worktree,
            "dir": "",
            "filename": "must-not-land.txt",
            "len": content.len(),
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let begin = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(begin["kind"], "fs:upload_begin_ok", "{begin}");
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_chunk",
            "upload_id": "replace-target",
            "seq": 0,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    ws.send(Message::Binary(content.to_vec().into()))
        .await
        .unwrap();
    let chunk = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(chunk["kind"], "fs:upload_chunk_ack", "{chunk}");

    git(
        project.path(),
        &["worktree", "remove", "--force", worktree.to_str().unwrap()],
    );
    git(
        project.path(),
        &["worktree", "add", worktree.to_str().unwrap(), "replaceable"],
    );
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_commit",
            "req_id": 121,
            "upload_id": "replace-target",
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let result = next_json(&mut ws, Duration::from_secs(10)).await.unwrap();
    assert_eq!(result["kind"], "fs:upload_result", "{result}");
    assert_eq!(result["ok"], false, "{result}");
    assert!(!worktree.join("must-not-land.txt").exists());
    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn write_commit_rejects_removed_and_recreated_worktree_target() {
    let project = tempfile::tempdir().unwrap();
    let targets = tempfile::tempdir().unwrap();
    let worktree = targets.path().join("replaceable-write-worktree");
    git(project.path(), &["init", "-b", "main"]);
    git(
        project.path(),
        &["config", "user.email", "test@example.com"],
    );
    git(project.path(), &["config", "user.name", "Test"]);
    std::fs::write(project.path().join("README.md"), "root").unwrap();
    git(project.path(), &["add", "README.md"]);
    git(project.path(), &["commit", "-m", "initial"]);
    git(
        project.path(),
        &[
            "worktree",
            "add",
            "-b",
            "replaceable-write",
            worktree.to_str().unwrap(),
        ],
    );
    let file = worktree.join("delayed.txt");
    std::fs::write(&file, "old").unwrap();
    let expected_mtime = std::fs::metadata(&file)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let addr = spawn_server(make_state(&project)).await;
    let mut ws = connect(addr).await;
    let content = b"new content";
    ws.send(Message::Text(
        json!({
            "kind": "fs:write_begin",
            "req_id": 130,
            "project": "proj",
            "worktree_path": worktree,
            "path": "delayed.txt",
            "expected_mtime": expected_mtime,
            "size": content.len(),
            "encoding": "binary",
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let begin = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(begin["kind"], "fs:write_ack", "{begin}");
    let write_id = begin["write_id"].as_u64().unwrap();
    ws.send(Message::Text(
        json!({
            "kind": "fs:write_chunk_binary",
            "write_id": write_id,
            "seq": 0,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    ws.send(Message::Binary(content.to_vec().into()))
        .await
        .unwrap();
    let chunk = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(chunk["kind"], "fs:write_chunk_ack", "{chunk}");

    git(
        project.path(),
        &["worktree", "remove", "--force", worktree.to_str().unwrap()],
    );
    git(
        project.path(),
        &[
            "worktree",
            "add",
            worktree.to_str().unwrap(),
            "replaceable-write",
        ],
    );

    ws.send(Message::Text(
        json!({
            "kind": "fs:write_commit",
            "write_id": write_id,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let result = next_json(&mut ws, Duration::from_secs(10)).await.unwrap();
    assert_eq!(result["kind"], "fs:write_result", "{result}");
    assert_eq!(result["ok"], false, "{result}");
    assert!(!worktree.join("delayed.txt").exists());
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

    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_begin",
            "req_id": 200,
            "upload_id": "zip-slip",
            "project": "proj",
            "dir": "",
            "filename": "../evil.txt",
            "len": 5,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let resp = next_json(&mut ws, Duration::from_secs(5))
        .await
        .expect("response");
    // Should return fs:error (not begin_ok)
    assert_ne!(
        resp["kind"], "fs:upload_begin_ok",
        "zip-slip must be rejected: {resp}"
    );

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_len_over_100mb_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_begin",
            "req_id": 300,
            "upload_id": "toolarge",
            "project": "proj",
            "dir": "",
            "filename": "big.bin",
            "len": 101 * 1024 * 1024u64,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let resp = next_json(&mut ws, Duration::from_secs(5))
        .await
        .expect("response");
    assert_ne!(
        resp["kind"], "fs:upload_begin_ok",
        "oversized upload must be rejected: {resp}"
    );

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_out_of_order_seq_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let content = b"some data";
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    // Begin
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_begin",
            "req_id": 400,
            "upload_id": "oos",
            "project": "proj",
            "dir": "",
            "filename": "oos.txt",
            "len": content.len() as u64,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let begin_ack = next_json(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(begin_ack["kind"], "fs:upload_begin_ok");

    // Send chunk with wrong seq (should be 0, sending 5)
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_chunk",
            "upload_id": "oos",
            "seq": 5u64,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    ws.send(Message::Binary(content.to_vec().into()))
        .await
        .unwrap();

    // Commit should now fail (session dropped)
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_commit",
            "req_id": 401,
            "upload_id": "oos",
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5))
        .await
        .expect("result");
    assert_eq!(
        result["ok"], false,
        "out-of-order seq must cause commit failure: {result}"
    );

    ws.close(None).await.unwrap();
}

#[tokio::test]
async fn upload_commit_without_matching_bytes_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let addr = spawn_server(make_state(&tmp)).await;
    let mut ws = connect(addr).await;

    // Declare 100 bytes but send only 5
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_begin",
            "req_id": 500,
            "upload_id": "short",
            "project": "proj",
            "dir": "",
            "filename": "short.txt",
            "len": 100u64,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    next_json(&mut ws, Duration::from_secs(5))
        .await
        .expect("begin_ok");

    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_chunk",
            "upload_id": "short",
            "seq": 0u64,
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    ws.send(Message::Binary(b"hello".to_vec().into()))
        .await
        .unwrap();
    next_json(&mut ws, Duration::from_secs(5))
        .await
        .expect("chunk_ack");

    // Commit early (bytes_written=5, expected_len=100)
    ws.send(Message::Text(
        json!({
            "kind": "fs:upload_commit",
            "req_id": 501,
            "upload_id": "short",
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let result = next_json(&mut ws, Duration::from_secs(5))
        .await
        .expect("result");
    assert_eq!(
        result["ok"], false,
        "incomplete upload must be rejected at commit: {result}"
    );

    ws.close(None).await.unwrap();
}
