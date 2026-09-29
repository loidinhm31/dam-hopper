#![cfg(target_os = "linux")]

use futures_util::{SinkExt, StreamExt};
use std::{os::unix::fs::symlink, path::Path, process::Stdio, time::Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Message};

use dam_hopper_server::{
    agent_status::{
        AgentKind, AgentState, AgentStatusAvailability, AgentStatusCollector, AgentStatusRuntime,
        ENV_AGENT_HOOKS_SOCKET, ENV_AGENT_STATUS_TOKEN, ENV_AGENT_STATUS_URL,
    },
    pty::activity::probe_process_identity,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

async fn post_hook(
    socket: &Path,
    host: &str,
    token: Option<&str>,
    origin: bool,
    body: &[u8],
) -> u16 {
    let mut stream = tokio::net::UnixStream::connect(socket).await.unwrap();
    let auth = token.map_or(String::new(), |value| {
        format!("Authorization: Bearer {value}\r\n")
    });
    let origin_header = if origin {
        "Origin: http://example.invalid\r\n"
    } else {
        ""
    };
    let headers = format!(
        "POST /v1/agent-hooks HTTP/1.1\r\nHost: {host}\r\n{auth}{origin_header}Content-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes()).await.unwrap();
    // The oversized Content-Length is rejected before reading a body. Sending
    // excess bytes would leave unread data and reset the socket on close.
    if body.len() <= 4096 {
        stream.write_all(body).await.unwrap();
    }
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    let line = std::str::from_utf8(&response)
        .unwrap()
        .lines()
        .next()
        .unwrap();
    line.split_whitespace().nth(1).unwrap().parse().unwrap()
}

#[tokio::test]
async fn hook_endpoint_rejects_browser_origin_wrong_host_oversize_and_revoked_capability() {
    let runtime = AgentStatusRuntime::with_epoch(43, AgentStatusAvailability::Unavailable, None);
    let collector = AgentStatusCollector::bind(runtime.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let credential = runtime.reserve_credential("security", 1).unwrap();
    let token = credential.token().to_owned();
    credential.activate();
    let socket = collector.socket_path().unwrap();
    assert_eq!(
        post_hook(socket, "localhost", Some(&token), true, b"{}").await,
        403
    );
    assert_eq!(
        post_hook(socket, "example.invalid", Some(&token), false, b"{}").await,
        400
    );
    assert_eq!(
        post_hook(socket, "localhost", None, false, b"{}").await,
        401
    );
    assert_eq!(
        post_hook(socket, "localhost", Some(&token), false, &vec![b'a'; 4097]).await,
        413
    );
    runtime.revoke_credential("security", 1);
    assert_eq!(
        post_hook(socket, "localhost", Some(&token), false, b"{}").await,
        401
    );
    assert!(runtime.snapshot().terminals.is_empty());
    collector.shutdown();
}

#[tokio::test]
async fn partial_native_request_times_out_before_admission() {
    let runtime = AgentStatusRuntime::with_epoch(43, AgentStatusAvailability::Unavailable, None);
    let collector = AgentStatusCollector::bind(runtime.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let mut stalled = tokio::net::UnixStream::connect(collector.socket_path().unwrap())
        .await
        .unwrap();
    stalled
        .write_all(
            b"POST /v1/agent-hooks HTTP/1.1\r\nHost: localhost\r\nContent-Length: 128\r\n\r\n{",
        )
        .await
        .unwrap();
    let mut one = [0u8; 1];
    let n = tokio::time::timeout(Duration::from_secs(1), stalled.read(&mut one))
        .await
        .expect("incomplete native request must not hold a connection")
        .unwrap();
    assert_eq!(n, 0);
    assert!(runtime.snapshot().terminals.is_empty());
    assert_eq!(
        post_hook(
            collector.socket_path().unwrap(),
            "localhost",
            None,
            false,
            b"{}"
        )
        .await,
        401
    );
    collector.shutdown();
}

#[tokio::test]
async fn revoked_after_websocket_upgrade_cannot_restore_omp_status() {
    let runtime = AgentStatusRuntime::with_epoch(43, AgentStatusAvailability::Ready, None);
    let collector = AgentStatusCollector::bind(runtime.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let reservation = runtime
        .reserve_credential("revoke-during-hello", 1)
        .unwrap();
    let token = reservation.token().to_owned();
    reservation.activate();

    let mut request = collector.ws_url().into_client_request().unwrap();
    request.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
    );
    let (mut socket, _) = connect_async(request).await.unwrap();
    runtime.revoke_credential("revoke-during-hello", 1);
    let hello = serde_json::json!({
        "version": 1,
        "agentKind": "omp",
        "reporterId": "stale-reporter",
        "agentSessionId": "stale-session",
        "adapterVersion": "test"
    });
    socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .unwrap();
    let response = tokio::time::timeout(Duration::from_secs(1), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(response, Message::Text(text) if text.contains("\"kind\":\"rejected\"")));
    assert!(runtime.snapshot().terminals.is_empty());
    collector.shutdown();
}

#[tokio::test]
async fn report_hook_without_capability_exits_silently() {
    let output = Command::new(env!("CARGO_BIN_EXE_dam-hopper-server"))
        .args(["integration", "claude", "report-hook"])
        .env_remove(ENV_AGENT_STATUS_URL)
        .env_remove(ENV_AGENT_STATUS_TOKEN)
        .env_remove(ENV_AGENT_HOOKS_SOCKET)
        .stdin(Stdio::null())
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty() && output.stderr.is_empty());

    // A producer that never closes stdin must not hold the one-shot CLI open.
    let mut child = Command::new(env!("CARGO_BIN_EXE_dam-hopper-server"))
        .args(["integration", "claude", "report-hook"])
        .env_remove(ENV_AGENT_STATUS_URL)
        .env_remove(ENV_AGENT_STATUS_TOKEN)
        .env_remove(ENV_AGENT_HOOKS_SOCKET)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let held_stdin = child.stdin.take().unwrap();
    let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .expect("open stdin must not hang hook process")
        .unwrap();
    assert!(status.success());
    drop(held_stdin);
}

#[tokio::test]
async fn native_hook_reporter_updates_only_live_capability_and_expires_without_attention() {
    let runtime = AgentStatusRuntime::with_epoch(42, AgentStatusAvailability::Unavailable, None);
    let collector = AgentStatusCollector::bind(runtime.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let reservation = runtime.reserve_credential("native-test", 1).unwrap();
    let token = reservation.token().to_owned();
    let root = probe_process_identity(std::process::id()).unwrap();
    runtime.register_terminal_root("native-test", 1, root);
    reservation.activate();

    // A symlinked shell simulates the native root for transport qualification;
    // it does not qualify an actual Codex binary or provider event schema.
    let dir = tempfile::tempdir().unwrap();
    let cli = dir.path().join("codex");
    symlink("/bin/sh", &cli).unwrap();
    let binary = env!("CARGO_BIN_EXE_dam-hopper-server");
    let mut child = Command::new(&cli)
        .arg("-c")
        .arg(format!("cat | '{binary}' integration codex report-hook"))
        .env(ENV_AGENT_STATUS_URL, collector.ws_url())
        .env(ENV_AGENT_STATUS_TOKEN, &token)
        .env(ENV_AGENT_HOOKS_SOCKET, collector.socket_path().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let cli_pid = child.id().unwrap();
    let cli_stat = dam_hopper_server::pty::activity::read_process_stat(Path::new("/proc"), cli_pid)
        .expect("native CLI root alive");
    assert!(
        dam_hopper_server::agent_status::hook_reporter::is_agent_cli_process(
            Path::new("/proc"),
            cli_pid,
            &cli_stat.comm,
            AgentKind::Codex,
        ),
        "simulated native CLI must qualify: {}",
        cli_stat.comm
    );
    child.stdin.take().unwrap().write_all(
        br#"{"hook_event_name":"UserPromptSubmit","session_id":"session-1","turn_id":"turn-1","prompt":"do not publish this"}"#,
    ).await.unwrap();
    let output = tokio::time::timeout(Duration::from_secs(3), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty() && output.stderr.is_empty());
    let row = runtime
        .snapshot()
        .terminals
        .into_iter()
        .find(|row| row.id == "native-test")
        .expect("admitted hook row");
    assert_eq!(row.agent_kind, AgentKind::Codex);
    assert_eq!(row.state, AgentState::Working);
    assert_eq!(row.turn_id.as_deref(), Some("turn-1"));
    assert!(row.expires_at_ms.is_some());

    let expired = runtime
        .check_leases_with_time(row.expires_at_ms.unwrap(), 15_000)
        .unwrap();
    assert_eq!(expired, 1);
    let expired_row = runtime.snapshot().terminals.into_iter().next().unwrap();
    assert_eq!(expired_row.state, AgentState::Unknown);
    assert!(expired_row.expires_at_ms.is_none());

    runtime.revoke_credential("native-test", 1);
    assert!(runtime
        .apply_hook_event(
            "native-test",
            1,
            &dam_hopper_server::agent_status::PrivateHookEnvelope {
                version: 1,
                agent_kind: AgentKind::Codex,
                adapter_version: "1.0.0".into(),
                event_id: "revoked".into(),
                event: "UserPromptSubmit".into(),
                agent_session_id: "session-1".into(),
                turn_id: Some("turn-2".into()),
                tool_call_id: None,
                reason: None,
                notification_type: None,
                root_process: root,
                process_ancestry: vec![root],
            },
            row.expires_at_ms.unwrap() + 1,
        )
        .is_err());
    assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Unknown);
    collector.shutdown();
}
