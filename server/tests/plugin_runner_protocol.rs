use std::sync::Arc;
use std::time::Duration;

use dam_hopper_server::plugins::{
    build_json_rpc_request, encode_frame, validate_json_rpc_message,
    FrameDecoder, PluginErrorCode, PluginRegistry, PluginRegistryLayout, RunnerClient,
    RunnerClientConfig, RunnerServer, RunnerServerConfig, SupervisorManager, FRAME_HEADER_LEN,
    MAX_FRAME_PAYLOAD_BYTES, RUNNER_PROTOCOL_VERSION,
};
use tempfile::TempDir;
use tokio::net::UnixStream;
use tokio::sync::watch;

#[test]
fn test_framing_encode_decode_roundtrip() {
    let payload = b"{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"runner.hello\"}";
    let encoded = encode_frame(payload).unwrap();
    assert_eq!(encoded.len(), FRAME_HEADER_LEN + payload.len());

    let mut decoder = FrameDecoder::new();
    let frames = decoder.push(&encoded).unwrap();
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0], std::str::from_utf8(payload).unwrap());
    assert_eq!(decoder.buffered_bytes(), 0);
}

#[test]
fn test_framing_fragmentation_and_coalescing() {
    let payload1 = b"{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"plugin.list\"}";
    let payload2 = b"{\"jsonrpc\":\"2.0\",\"id\":\"2\",\"method\":\"plugin.list\"}";
    let mut stream = Vec::new();
    stream.extend_from_slice(&encode_frame(payload1).unwrap());
    stream.extend_from_slice(&encode_frame(payload2).unwrap());

    // Byte-by-byte feed to test all boundary conditions
    let mut decoder = FrameDecoder::new();
    let mut received = Vec::new();
    for b in &stream {
        let chunk = [*b];
        let frames = decoder.push(&chunk).unwrap();
        received.extend(frames);
    }
    assert_eq!(received.len(), 2);
    assert_eq!(received[0], std::str::from_utf8(payload1).unwrap());
    assert_eq!(received[1], std::str::from_utf8(payload2).unwrap());
    assert_eq!(decoder.buffered_bytes(), 0);

    // Coalesced chunk: both frames in one push
    let mut decoder2 = FrameDecoder::new();
    let frames2 = decoder2.push(&stream).unwrap();
    assert_eq!(frames2.len(), 2);
    assert_eq!(frames2[0], std::str::from_utf8(payload1).unwrap());
    assert_eq!(frames2[1], std::str::from_utf8(payload2).unwrap());
}

#[test]
fn test_framing_rejects_oversized_payload() {
    let big = vec![0u8; MAX_FRAME_PAYLOAD_BYTES + 1];
    let err = encode_frame(&big).unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Overloaded);

    // Construct a malicious header specifying > 16 MiB
    let mut malicious = Vec::new();
    let bad_len = (MAX_FRAME_PAYLOAD_BYTES as u32) + 10;
    malicious.extend_from_slice(&bad_len.to_be_bytes());
    malicious.extend_from_slice(&[0u8; 100]);

    let mut decoder = FrameDecoder::new();
    let err2 = decoder.push(&malicious).unwrap_err();
    assert_eq!(err2.code, PluginErrorCode::Overloaded);
}

#[test]
fn test_json_rpc_strict_validation() {
    // Valid request
    let valid_req = r#"{"jsonrpc":"2.0","id":"req-1","method":"plugin.list","params":{}}"#;
    assert!(validate_json_rpc_message(valid_req).is_ok());

    // Valid notification (no id)
    let valid_notif = r#"{"jsonrpc":"2.0","method":"worker.shutdown","params":{}}"#;
    assert!(validate_json_rpc_message(valid_notif).is_ok());

    // Valid response
    let valid_res = r#"{"jsonrpc":"2.0","id":"req-1","result":{"status":"active"}}"#;
    assert!(validate_json_rpc_message(valid_res).is_ok());

    // Rejects numeric id
    let num_id = r#"{"jsonrpc":"2.0","id":123,"method":"plugin.list"}"#;
    assert!(validate_json_rpc_message(num_id).is_err());

    // Rejects batch array
    let batch = r#"[{"jsonrpc":"2.0","id":"1","method":"plugin.list"}]"#;
    assert!(validate_json_rpc_message(batch).is_err());

    // Rejects missing/wrong jsonrpc version
    let bad_ver = r#"{"jsonrpc":"1.0","id":"1","method":"plugin.list"}"#;
    assert!(validate_json_rpc_message(bad_ver).is_err());

    // Rejects unknown fields in request
    let unknown_field = r#"{"jsonrpc":"2.0","id":"1","method":"plugin.list","foo":"bar"}"#;
    assert!(validate_json_rpc_message(unknown_field).is_err());

    // Rejects trailing non-whitespace data
    let trailing = r#"{"jsonrpc":"2.0","id":"1","method":"plugin.list"} trailing"#;
    assert!(validate_json_rpc_message(trailing).is_err());
}

#[tokio::test]
async fn test_runner_server_handshake_and_method_dispatch() {
    let temp_dir = TempDir::new().unwrap();
    let socket_path = temp_dir.path().join("runner.sock");
    let registry_dir = temp_dir.path().join("registry");

    let layout = PluginRegistryLayout::new(&registry_dir);
    let registry = Arc::new(PluginRegistry::new(layout).unwrap());
    let supervisor_manager = Arc::new(SupervisorManager::new(
        registry.clone(),
        std::path::PathBuf::from("node"),
    ));

    let my_uid = unsafe { libc::getuid() };
    let server = Arc::new(RunnerServer::new(
        RunnerServerConfig {
            socket_path: socket_path.clone(),
            expected_api_uid: Some(my_uid),
            allow_root_peer: true,
        },
        registry.clone(),
        supervisor_manager.clone(),
    ));

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_handle = tokio::spawn({
        let s = server.clone();
        async move { s.run(shutdown_rx).await }
    });

    // Wait briefly for server to bind socket
    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(socket_path.exists());

    let client = RunnerClient::new(RunnerClientConfig {
        socket_path: socket_path.clone(),
        expected_runner_uid: Some(my_uid),
        allow_root_peer: true,
        client_name: "test-client".to_string(),
        max_reconnect_retries: 3,
        reconnect_base_delay: Duration::from_millis(20),
    });

    // Successful handshake and hello query
    let hello = client.hello().await.unwrap();
    assert_eq!(hello.negotiated_protocol_version, RUNNER_PROTOCOL_VERSION);
    assert_eq!(
        hello.supported_capabilities,
        vec!["advisor.scan".to_string()]
    );

    // List plugins (should be empty initially)
    let list = client.list_plugins(true).await.unwrap();
    assert_eq!(list.plugins.len(), 0);

    // Shutdown server
    let _ = shutdown_tx.send(true);
    let _ = server_handle.await;
    assert!(!socket_path.exists());
}

#[tokio::test]
async fn test_runner_server_rejects_mismatched_protocol_version() {
    let temp_dir = TempDir::new().unwrap();
    let socket_path = temp_dir.path().join("runner.sock");
    let registry_dir = temp_dir.path().join("registry");
    let layout = PluginRegistryLayout::new(&registry_dir);
    let registry = Arc::new(PluginRegistry::new(layout).unwrap());
    let supervisor_manager = Arc::new(SupervisorManager::new(
        registry.clone(),
        std::path::PathBuf::from("node"),
    ));

    let my_uid = unsafe { libc::getuid() };
    let server = Arc::new(RunnerServer::new(
        RunnerServerConfig {
            socket_path: socket_path.clone(),
            expected_api_uid: Some(my_uid),
            allow_root_peer: true,
        },
        registry.clone(),
        supervisor_manager.clone(),
    ));

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn({
        let s = server.clone();
        async move { s.run(shutdown_rx).await }
    });

    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    // Connect raw stream and send incompatible protocol version
    let mut stream = UnixStream::connect(&socket_path).await.unwrap();
    let bad_hello = build_json_rpc_request(
        "1",
        "runner.hello",
        serde_json::json!({
            "hostVersion": "0.4.0",
            "clientProtocolVersion": "9.9.9",
        }),
    );
    let bytes = encode_frame(&serde_json::to_vec(&bad_hello).unwrap()).unwrap();
    use tokio::io::AsyncWriteExt;
    stream.write_all(&bytes).await.unwrap();

    let resp_frame = dam_hopper_server::plugins::read_frame_async(&mut stream)
        .await
        .unwrap();
    assert!(resp_frame.is_some());
    let val = validate_json_rpc_message(&resp_frame.unwrap()).unwrap();
    assert!(val.get("error").is_some());

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn test_runner_server_peer_uid_validation() {
    let temp_dir = TempDir::new().unwrap();
    let socket_path = temp_dir.path().join("runner.sock");
    let registry_dir = temp_dir.path().join("registry");

    let layout = PluginRegistryLayout::new(&registry_dir);
    let registry = Arc::new(PluginRegistry::new(layout).unwrap());
    let supervisor_manager = Arc::new(SupervisorManager::new(
        registry.clone(),
        std::path::PathBuf::from("node"),
    ));

    // Require an impossible expected UID (e.g. 999999)
    let impossible_uid = 999_999;
    let server = Arc::new(RunnerServer::new(
        RunnerServerConfig {
            socket_path: socket_path.clone(),
            expected_api_uid: Some(impossible_uid),
            allow_root_peer: false,
        },
        registry.clone(),
        supervisor_manager.clone(),
    ));

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn({
        let s = server.clone();
        async move { s.run(shutdown_rx).await }
    });

    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    // Connect from current user UID -> should be closed / rejected by server
    let stream_res = UnixStream::connect(&socket_path).await;
    if let Ok(mut stream) = stream_res {
        let hello = build_json_rpc_request(
            "1",
            "runner.hello",
            serde_json::json!({
                "hostVersion": "0.4.0",
                "clientProtocolVersion": RUNNER_PROTOCOL_VERSION,
            }),
        );
        let bytes = encode_frame(&serde_json::to_vec(&hello).unwrap()).unwrap();
        use tokio::io::AsyncWriteExt;
        let _ = stream.write_all(&bytes).await;

        let read_res = dam_hopper_server::plugins::read_frame_async(&mut stream).await;
        // Either read failed or returned EOF (None) because server rejected peer
        assert!(read_res.is_err() || read_res.unwrap().is_none());
    }

    let _ = shutdown_tx.send(true);
}
