use std::net::SocketAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use dam_hopper_server::browser_host::cdp::{CdpClient, CdpError};
use dam_hopper_server::browser_host::protocol::{
    pack_bhjf_frame, unpack_bhjf_frame, validate_decimal_sequence, ProtocolError,
    TargetFrameHeader, TargetGeometry, BHJF_MAGIC, MAX_COMMAND_BYTES, MAX_PENDING_COMMANDS,
    MAX_WRITER_QUEUE_MESSAGES, MAX_WS_MESSAGE_BYTES,
};

/// Helper to generate a minimal valid JPEG buffer with SOF0 marker
fn create_test_jpeg(width: u16, height: u16) -> Vec<u8> {
    let mut buf = Vec::new();
    // SOI
    buf.extend_from_slice(&[0xFF, 0xD8]);
    // APP0
    buf.extend_from_slice(&[
        0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
        0x01, 0x00, 0x00,
    ]);
    // SOF0: len=11, precision=8, height:2, width:2, components=3
    let (h_b1, h_b2) = ((height >> 8) as u8, (height & 0xFF) as u8);
    let (w_b1, w_b2) = ((width >> 8) as u8, (width & 0xFF) as u8);
    buf.extend_from_slice(&[
        0xFF, 0xC0, 0x00, 0x0B, 0x08, h_b1, h_b2, w_b1, w_b2, 0x03, 0x01, 0x11, 0x00,
    ]);
    // EOI
    buf.extend_from_slice(&[0xFF, 0xD9]);
    buf
}

fn sample_header(width: u32, height: u32) -> TargetFrameHeader {
    TargetFrameHeader {
        browser_session_id: "c7e2b704-586b-4e89-bd06-6c6a4d799011".to_string(),
        browser_incarnation: "88888888-4444-4444-4444-121212121212".to_string(),
        profile_epoch: "1".to_string(),
        producer_run: "11111111-2222-3333-4444-555555555555".to_string(),
        viewport_epoch: "100".to_string(),
        frame_seq: "1".to_string(),
        width,
        height,
        capture_time_unix_ms: 1731050000000,
        geometry: TargetGeometry {
            css_width: width as f64,
            css_height: height as f64,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
        input_trusted: true,
    }
}

#[test]
fn test_decimal_sequence_validation() {
    assert_eq!(validate_decimal_sequence("epoch", "1").unwrap(), 1);
    assert_eq!(validate_decimal_sequence("epoch", "10").unwrap(), 10);
    assert_eq!(
        validate_decimal_sequence("epoch", "18446744073709551615").unwrap(),
        u64::MAX
    );

    // Counters are canonical positive decimals: zero, leading zeros, signs, whitespace,
    // non-ASCII digits and empty strings are all rejected.
    for bad in [
        "", "0", "00", "01", "-1", "+1", "12a", " 1", "1 ", "1.0", "１２",
    ] {
        assert!(
            validate_decimal_sequence("epoch", bad).is_err(),
            "{bad:?} must be rejected"
        );
    }
    // Overflow u64::MAX and 21-digit values
    assert!(validate_decimal_sequence("epoch", "18446744073709551616").is_err());
    assert!(validate_decimal_sequence("epoch", "100000000000000000000").is_err());
}

#[test]
fn test_header_rejects_zero_counters() {
    for field in ["profileEpoch", "viewportEpoch", "frameSeq"] {
        let mut header = sample_header(640, 480);
        match field {
            "profileEpoch" => header.profile_epoch = "0".to_string(),
            "viewportEpoch" => header.viewport_epoch = "0".to_string(),
            _ => header.frame_seq = "0".to_string(),
        }
        assert!(
            matches!(header.validate(), Err(ProtocolError::InvalidDecimalSequence { field: f, .. }) if f == field),
            "{field}=0 must be rejected"
        );
    }
}

#[test]
fn test_bhjf_frame_roundtrip() {
    let jpeg = create_test_jpeg(1280, 900);
    let header = sample_header(1280, 900);

    let packed = pack_bhjf_frame(&header, &jpeg).expect("pack failed");
    assert_eq!(&packed[0..4], BHJF_MAGIC);
    assert_eq!(packed[4], 1); // version 1
    assert_eq!(packed[5], 0); // flags 0

    let (unpacked_header, unpacked_payload) = unpack_bhjf_frame(&packed).expect("unpack failed");
    assert_eq!(unpacked_header, header);
    assert_eq!(unpacked_payload, jpeg.as_slice());
}

#[test]
fn test_bhjf_rejects_dimension_mismatch() {
    let jpeg = create_test_jpeg(1280, 900);
    let mut header = sample_header(1280, 900);
    header.width = 800; // mismatch!

    let res = pack_bhjf_frame(&header, &jpeg);
    assert!(matches!(res, Err(ProtocolError::InvalidGeometry(_))));
}

#[test]
fn test_bhjf_rejects_malformed_framing() {
    let jpeg = create_test_jpeg(640, 480);
    let header = sample_header(640, 480);
    let mut packed = pack_bhjf_frame(&header, &jpeg).unwrap().to_vec();

    // 1. Corrupted magic
    packed[0] = b'X';
    assert!(matches!(
        unpack_bhjf_frame(&packed),
        Err(ProtocolError::InvalidMagic(_))
    ));
    packed[0] = b'B';

    // 2. Unsupported version
    packed[4] = 2;
    assert!(matches!(
        unpack_bhjf_frame(&packed),
        Err(ProtocolError::UnsupportedVersion(2))
    ));
    packed[4] = 1;

    // 3. Nonzero flags
    packed[5] = 1;
    assert!(matches!(
        unpack_bhjf_frame(&packed),
        Err(ProtocolError::UnsupportedFlags(1))
    ));
    packed[5] = 0;

    // 4. Truncated
    assert!(matches!(
        unpack_bhjf_frame(&packed[..10]),
        Err(ProtocolError::MessageTooShort { .. })
    ));
}

#[test]
fn test_geometry_limits() {
    let mut header = sample_header(1280, 900);
    header.geometry.page_scale = 0.05; // Below 0.1
    assert!(header.validate().is_err());

    header.geometry.page_scale = 15.0; // Above 10.0
    assert!(header.validate().is_err());

    header.geometry.page_scale = 1.0;
    header.geometry.offset_top = 20_000_000.0; // Above 10,000,000 CSS px
    assert!(header.validate().is_err());

    header.geometry.offset_top = f64::NAN;
    assert!(header.validate().is_err());
}

#[test]
fn test_geometry_css_viewport_ceilings() {
    let mut header = sample_header(1920, 1080);
    header
        .validate()
        .expect("documented maximum viewport is valid");

    header.geometry.css_width = 1920.5;
    assert!(matches!(
        header.validate(),
        Err(ProtocolError::InvalidGeometry(_))
    ));
    header.geometry.css_width = 1920.0;

    header.geometry.css_height = 1081.0;
    assert!(matches!(
        header.validate(),
        Err(ProtocolError::InvalidGeometry(_))
    ));
    header.geometry.css_height = 10_000_000.0; // old offset-sized ceiling no longer passes
    assert!(matches!(
        header.validate(),
        Err(ProtocolError::InvalidGeometry(_))
    ));
    header.geometry.css_height = 0.0;
    assert!(matches!(
        header.validate(),
        Err(ProtocolError::InvalidGeometry(_))
    ));
}

// -----------------------------------------------------------------------------
// Bounded CDP Actor Integration Tests over local mock WebSocket
// -----------------------------------------------------------------------------

async fn start_mock_cdp_server() -> (
    SocketAddr,
    tokio::sync::mpsc::Sender<Message>,
    tokio::sync::mpsc::Receiver<Message>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (server_send_tx, mut server_send_rx) = tokio::sync::mpsc::channel::<Message>(64);
    let (server_recv_tx, server_recv_rx) = tokio::sync::mpsc::channel::<Message>(64);

    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            if let Ok(mut ws) = accept_async(stream).await {
                loop {
                    tokio::select! {
                        msg_to_send = server_send_rx.recv() => {
                            match msg_to_send {
                                Some(msg) => {
                                    if ws.send(msg).await.is_err() {
                                        break;
                                    }
                                }
                                None => break,
                            }
                        }
                        incoming = ws.next() => {
                            match incoming {
                                Some(Ok(msg)) => {
                                    let _ = server_recv_tx.send(msg).await;
                                }
                                _ => break,
                            }
                        }
                    }
                }
            }
        }
    });

    (addr, server_send_tx, server_recv_rx)
}

#[tokio::test]
async fn test_cdp_command_dispatch_and_response() {
    let (addr, server_tx, mut server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    // Spawn server response handler
    tokio::spawn(async move {
        if let Some(Message::Text(cmd_text)) = server_rx.recv().await {
            let parsed: serde_json::Value = serde_json::from_str(&cmd_text).unwrap();
            let id = parsed["id"].as_u64().unwrap();
            let method = parsed["method"].as_str().unwrap();
            assert_eq!(method, "Browser.getVersion");

            let resp = json!({
                "id": id,
                "result": {
                    "product": "Chrome/157.0.0.0",
                    "protocolVersion": "1.3"
                }
            });
            server_tx
                .send(Message::Text(resp.to_string().into()))
                .await
                .unwrap();
        }
    });

    let res = client
        .send_command("Browser.getVersion", None, None)
        .await
        .expect("command failed");
    assert_eq!(res["product"], "Chrome/157.0.0.0");
    assert_eq!(res["protocolVersion"], "1.3");
}

#[tokio::test]
async fn test_cdp_pending_commands_bound_enforcement() {
    let (addr, _server_tx, mut server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    // Fill the 64-command total bound with unanswered commands, in waves no larger than the
    // 32-message writer queue; each wave is confirmed written (in flight) before the next.
    let mut handles = Vec::new();
    for _wave in 0..2 {
        for _ in 0..MAX_WRITER_QUEUE_MESSAGES {
            let client_c = client.clone();
            handles.push(tokio::spawn(async move {
                client_c.send_command("Test.ping", None, None).await
            }));
        }
        for _ in 0..MAX_WRITER_QUEUE_MESSAGES {
            timeout(Duration::from_secs(2), server_rx.recv())
                .await
                .expect("command never reached the peer")
                .expect("mock server closed");
        }
    }
    assert_eq!(handles.len(), MAX_PENDING_COMMANDS);

    // The 65th command MUST be rejected with TooManyPendingCommands
    let err = client.send_command("Test.overflow", None, None).await;
    match err {
        Err(CdpError::TooManyPendingCommands { current, max }) => {
            assert_eq!(current, 64);
            assert_eq!(max, 64);
        }
        other => panic!("expected TooManyPendingCommands, got {:?}", other),
    }
}

#[tokio::test]
async fn test_cdp_command_too_large_rejection() {
    let (addr, _server_tx, _server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    // Command payload larger than 64 KiB
    let big_data = "x".repeat(MAX_COMMAND_BYTES + 100);
    let params = json!({ "payload": big_data });

    let err = client.send_command("Test.large", Some(params), None).await;
    match err {
        Err(CdpError::CommandTooLarge { size, max }) => {
            assert!(size > max);
            assert_eq!(max, MAX_COMMAND_BYTES);
        }
        other => panic!("expected CommandTooLarge, got {:?}", other),
    }
}

#[tokio::test]
async fn test_cdp_unknown_event_ignore_counter() {
    let (addr, server_tx, mut server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    // Send 50 unknown events from browser
    for i in 0..50 {
        let event = json!({
            "method": format!("UnknownDomain.event_{i}"),
            "params": { "data": i }
        });
        server_tx
            .send(Message::Text(event.to_string().into()))
            .await
            .unwrap();
    }

    // Ordered response barrier: put a command in flight. Because WebSocket framing
    // and actor message processing are strictly FIFO, completing this barrier command
    // guarantees all preceding 50 unknown events were processed by the actor.
    let barrier = {
        let c = client.clone();
        tokio::spawn(async move { c.send_command("Target.getTargets", None, None).await })
    };
    let barrier_req = timeout(Duration::from_secs(2), server_rx.recv())
        .await
        .expect("barrier command never reached mock server")
        .expect("mock server closed");
    let req_val: serde_json::Value = match barrier_req {
        Message::Text(t) => serde_json::from_str(&t).expect("valid request JSON"),
        _ => panic!("expected text request"),
    };
    let req_id = req_val["id"].as_i64().expect("command id");

    server_tx
        .send(Message::Text(
            json!({ "id": req_id, "result": { "targetInfos": [] } })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();

    let res = timeout(Duration::from_secs(2), barrier)
        .await
        .expect("barrier command timed out")
        .unwrap()
        .expect("barrier command failed");
    assert!(res["targetInfos"].is_array());
    assert_eq!(
        client
            .stats()
            .unknown_events_count
            .load(std::sync::atomic::Ordering::Relaxed),
        50
    );
}

#[tokio::test]
async fn test_cdp_screencast_frame_routing() {
    let (addr, server_tx, _server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    let mut rx = client.subscribe_screencast();

    let frame_event = json!({
        "method": "Page.screencastFrame",
        "sessionId": "target-session-123",
        "params": {
            "data": "aGVsbG8=",
            "sessionId": 42,
            "metadata": {
                "offsetTop": 0,
                "pageScaleFactor": 1.0,
                "deviceWidth": 1280,
                "deviceHeight": 900,
                "scrollOffsetX": 0,
                "scrollOffsetY": 0,
                "timestamp": 123456.78
            }
        }
    });

    server_tx
        .send(Message::Text(frame_event.to_string().into()))
        .await
        .unwrap();

    let received = timeout(Duration::from_millis(500), rx.recv())
        .await
        .expect("timeout")
        .expect("recv failed");
    assert_eq!(received.session_id, "target-session-123");
    assert_eq!(received.frame_session_id, 42);
    assert_eq!(received.data_base64, "aGVsbG8=");
}

#[tokio::test]
async fn test_cdp_oversized_incoming_message_closes_actor() {
    let (addr, server_tx, mut server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    // Put a command in flight and confirm the peer received it before the oversized frame.
    let pending = {
        let c = client.clone();
        tokio::spawn(async move { c.send_command("Browser.getVersion", None, None).await })
    };
    timeout(Duration::from_secs(2), server_rx.recv())
        .await
        .expect("command never reached the peer")
        .expect("mock server closed");

    // Send message exceeding 4 MiB
    let big_payload = "a".repeat(MAX_WS_MESSAGE_BYTES + 1024);
    server_tx
        .send(Message::Text(big_payload.into()))
        .await
        .unwrap();

    // The in-flight command must terminate promptly with a connection-level failure (not wait
    // for its 10s deadline); transport-level oversize may surface as Transport or MessageTooLarge.
    let res = timeout(Duration::from_secs(5), pending)
        .await
        .expect("pending command hung")
        .unwrap();
    assert!(
        matches!(
            res,
            Err(CdpError::Transport(_))
                | Err(CdpError::MessageTooLarge { .. })
                | Err(CdpError::ConnectionClosed)
        ),
        "unexpected result {res:?}"
    );

    // Subsequent command fails with ConnectionClosed because the actor shut down.
    let res = client.send_command("Browser.getVersion", None, None).await;
    assert!(
        matches!(res, Err(CdpError::ConnectionClosed)),
        "got {res:?}"
    );
}

#[test]
fn test_media_control_camel_case_json_fixtures() {
    use dam_hopper_server::browser_host::protocol::{DiscardReason, MediaClientControl};

    let ack_json = r#"{
        "kind": "frameAck",
        "subscriptionEpoch": "11111111-2222-3333-4444-555555555555",
        "producerRun": "66666666-7777-8888-9999-000000000000",
        "viewportEpoch": "1",
        "frameSeq": "100"
    }"#;

    let control: MediaClientControl =
        serde_json::from_str(ack_json).expect("deserialize frameAck failed");
    match control {
        MediaClientControl::FrameAck {
            subscription_epoch,
            producer_run,
            viewport_epoch,
            frame_seq,
            reason,
        } => {
            assert_eq!(subscription_epoch, "11111111-2222-3333-4444-555555555555");
            assert_eq!(producer_run, "66666666-7777-8888-9999-000000000000");
            assert_eq!(viewport_epoch, "1");
            assert_eq!(frame_seq, "100");
            assert_eq!(reason, None);
        }
        other => panic!("expected FrameAck, got {:?}", other),
    }

    let discarded_json = r#"{
        "kind": "frameDiscarded",
        "subscriptionEpoch": "11111111-2222-3333-4444-555555555555",
        "producerRun": "66666666-7777-8888-9999-000000000000",
        "viewportEpoch": "1",
        "frameSeq": "100",
        "reason": "replaced"
    }"#;
    let discarded: MediaClientControl =
        serde_json::from_str(discarded_json).expect("deserialize frameDiscarded failed");
    match discarded {
        MediaClientControl::FrameDiscarded { reason, .. } => {
            assert_eq!(reason, Some(DiscardReason::Replaced));
        }
        other => panic!("expected FrameDiscarded, got {:?}", other),
    }

    let serialized = serde_json::to_string(&discarded).unwrap();
    assert!(serialized.contains(r#""subscriptionEpoch""#));
    assert!(serialized.contains(r#""producerRun""#));
    assert!(serialized.contains(r#""viewportEpoch""#));
    assert!(serialized.contains(r#""frameSeq""#));
}

#[tokio::test]
async fn test_cdp_actor_id_only_response_rejected() {
    let (addr, server_tx, mut server_rx) = start_mock_cdp_server().await;
    let ws_url = format!("ws://{addr}");
    let client = CdpClient::connect(&ws_url)
        .await
        .expect("client connect failed");

    tokio::spawn(async move {
        if let Some(Message::Text(cmd_text)) = server_rx.recv().await {
            let parsed: serde_json::Value = serde_json::from_str(&cmd_text).unwrap();
            let id = parsed["id"].as_u64().unwrap();
            let malformed = json!({ "id": id });
            server_tx
                .send(Message::Text(malformed.to_string().into()))
                .await
                .unwrap();
        }
    });

    let res = client.send_command("Test.malformed", None, None).await;
    assert!(
        matches!(res, Err(CdpError::MalformedResponse(_))),
        "id-only response must fail with MalformedResponse, got {:?}",
        res
    );
}

/// Mock browser reply loop: the first command is answered with `respond(id)` (arbitrary raw
/// message), every later command with a valid empty result.
fn reply_first_then_ok(
    mut server_rx: tokio::sync::mpsc::Receiver<Message>,
    server_tx: tokio::sync::mpsc::Sender<Message>,
    respond: impl FnOnce(u64) -> Message + Send + 'static,
) {
    tokio::spawn(async move {
        let mut respond = Some(respond);
        while let Some(Message::Text(cmd_text)) = server_rx.recv().await {
            let parsed: serde_json::Value = serde_json::from_str(&cmd_text).unwrap();
            let id = parsed["id"].as_u64().unwrap();
            let reply = match respond.take() {
                Some(first) => first(id),
                None => Message::Text(json!({"id": id, "result": {}}).to_string().into()),
            };
            if server_tx.send(reply).await.is_err() {
                break;
            }
        }
    });
}

#[tokio::test]
async fn test_cdp_routeable_error_envelopes_fail_owner_immediately() {
    // (reply, expect protocol error)
    let cases: Vec<(&str, fn(u64) -> serde_json::Value, bool)> = vec![
        (
            "valid protocol error",
            |id| json!({"id": id, "error": {"code": -32000, "message": "nope"}}),
            true,
        ),
        (
            "string error code",
            |id| json!({"id": id, "error": {"code": "bad", "message": "x"}}),
            false,
        ),
        (
            "error not an object",
            |id| json!({"id": id, "error": "boom"}),
            false,
        ),
        (
            "error as positional array",
            |id| json!({"id": id, "error": [-32000, "nope"]}),
            false,
        ),
        (
            "result not an object",
            |id| json!({"id": id, "result": [1, 2]}),
            false,
        ),
        (
            "result and error both",
            |id| json!({"id": id, "result": {}, "error": {"code": 1, "message": "m"}}),
            false,
        ),
        (
            "result with explicit null error",
            |id| json!({"id": id, "result": {}, "error": null}),
            false,
        ),
        (
            "explicit null result",
            |id| json!({"id": id, "result": null}),
            false,
        ),
        (
            "null error alone",
            |id| json!({"id": id, "error": null}),
            false,
        ),
    ];

    for (name, build, expect_protocol) in cases {
        let (addr, server_tx, server_rx) = start_mock_cdp_server().await;
        let client = CdpClient::connect(&format!("ws://{addr}"))
            .await
            .expect("client connect failed");
        reply_first_then_ok(server_rx, server_tx, move |id| {
            Message::Text(build(id).to_string().into())
        });

        let started = tokio::time::Instant::now();
        let res = client.send_command("Test.envelope", None, None).await;
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{name}: owner must fail immediately, not time out"
        );
        if expect_protocol {
            assert!(
                matches!(res, Err(CdpError::Protocol { code: -32000, .. })),
                "{name}: {res:?}"
            );
        } else {
            assert!(
                matches!(res, Err(CdpError::MalformedResponse(_))),
                "{name}: {res:?}"
            );
        }

        // A routeable bad response fails only its owner; the connection stays usable.
        assert!(
            client.send_command("Test.after", None, None).await.is_ok(),
            "{name}: routeable malformed response must not close the actor"
        );
    }
}

#[tokio::test]
async fn test_cdp_unrouteable_framing_closes_actor_and_fails_pending() {
    let bad_frames: Vec<(&str, fn(u64) -> Message)> = vec![
        ("invalid json", |_| Message::Text("{not json".into())),
        ("json array", |_| Message::Text("[1,2,3]".into())),
        ("no id and no method", |_| {
            Message::Text(r#"{"result":{}}"#.into())
        }),
        ("non-integer id", |_| {
            Message::Text(r#"{"id":"abc","result":{}}"#.into())
        }),
        ("non-string method", |_| {
            Message::Text(r#"{"method":42}"#.into())
        }),
        ("null id", |_| {
            Message::Text(r#"{"id":null,"result":{}}"#.into())
        }),
        ("null method", |_| {
            Message::Text(r#"{"method":null}"#.into())
        }),
        ("screencast frame without session id", |_| {
            Message::Text(r#"{"method":"Page.screencastFrame","params":{"data":"aA==","sessionId":1,"metadata":{}}}"#.into())
        }),
        ("screencast frame with non-object metadata", |_| {
            Message::Text(
                r#"{"method":"Page.screencastFrame","sessionId":"s","params":{"data":"aA==","sessionId":1,"metadata":3}}"#.into(),
            )
        }),
        ("screencast frame with empty metadata object", |_| {
            Message::Text(
                r#"{"method":"Page.screencastFrame","sessionId":"s","params":{"data":"aA==","sessionId":1,"metadata":{}}}"#.into(),
            )
        }),
        ("screencast frame with non-string data", |_| {
            Message::Text(
                r#"{"method":"Page.screencastFrame","sessionId":"s","params":{"data":5,"sessionId":1,"metadata":{}}}"#.into(),
            )
        }),
        ("binary not utf8", |_| {
            Message::Binary(vec![0xFF, 0xFE, 0xFD].into())
        }),
    ];

    for (name, build) in bad_frames {
        let (addr, server_tx, server_rx) = start_mock_cdp_server().await;
        let client = CdpClient::connect(&format!("ws://{addr}"))
            .await
            .expect("client connect failed");
        reply_first_then_ok(server_rx, server_tx, move |id| build(id));

        let started = tokio::time::Instant::now();
        let res = client.send_command("Test.pending", None, None).await;
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{name}: must not wait for deadline"
        );
        assert!(
            matches!(res, Err(CdpError::MalformedResponse(_))),
            "{name}: pending owner got {res:?}"
        );

        let after = client.send_command("Test.after", None, None).await;
        assert!(
            matches!(after, Err(CdpError::ConnectionClosed)),
            "{name}: actor must be closed, got {after:?}"
        );
    }
}

#[tokio::test]
async fn test_cdp_byte_budget_shared_across_queued_and_inflight_commands() {
    let (addr, _server_tx, mut server_rx) = start_mock_cdp_server().await;
    let client = CdpClient::connect(&format!("ws://{addr}"))
        .await
        .expect("client connect failed");

    // Unanswered ~60 KB commands in waves small enough for the writer to drain between waves:
    // admitted commands become in-flight and must keep their bytes reserved, so the 2 MiB budget
    // (not the 32-message queue or the 64-command cap) is what finally rejects callers.
    const PAYLOAD: usize = 60_000;
    const BUDGET: usize = 2_097_152;
    let mut handles = Vec::new();
    let mut received = 0usize;
    for _ in 0..10 {
        for _ in 0..20 {
            let c = client.clone();
            handles.push(tokio::spawn(async move {
                c.send_command(
                    "Test.big",
                    Some(json!({ "payload": "x".repeat(PAYLOAD) })),
                    None,
                )
                .await
            }));
        }
        // A wave settles when every caller was rejected or admitted and every admitted command
        // reached the peer (admitted commands become in-flight, keeping their reservation).
        let spawned = handles.len();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let rejected = handles.iter().filter(|h| h.is_finished()).count();
                let admitted = client
                    .stats()
                    .total_commands_sent
                    .load(std::sync::atomic::Ordering::Relaxed)
                    as usize;
                if rejected + admitted == spawned && received == admitted {
                    break;
                }
                tokio::select! {
                    msg = server_rx.recv() => {
                        msg.expect("mock server closed");
                        received += 1;
                    }
                    _ = tokio::task::yield_now() => {}
                }
            }
        })
        .await
        .expect("wave did not settle");
    }

    let admitted = handles.iter().filter(|h| !h.is_finished()).count();
    assert!(
        admitted * PAYLOAD <= BUDGET,
        "admitted {admitted} commands exceed the 2 MiB budget"
    );
    assert!(
        (admitted + 1) * (PAYLOAD + 200) > BUDGET,
        "budget under-used: only {admitted} admitted"
    );
    assert!(
        admitted < MAX_PENDING_COMMANDS,
        "byte budget must bind before the command cap"
    );
    let peak = client
        .stats()
        .peak_queued_bytes
        .load(std::sync::atomic::Ordering::Relaxed) as usize;
    assert!(peak <= BUDGET, "peak reserved bytes {peak} exceeds 2 MiB");
    assert!(peak >= admitted * PAYLOAD);

    for h in handles {
        if h.is_finished() {
            assert!(
                matches!(h.await.unwrap(), Err(CdpError::WriterQueueFull { .. })),
                "rejected callers must see WriterQueueFull"
            );
        } else {
            h.abort();
        }
    }
}

#[tokio::test]
async fn test_cdp_ack_enqueue_returns_before_any_response_and_wait_observes_it() {
    let (addr, server_tx, mut server_rx) = start_mock_cdp_server().await;
    let client = CdpClient::connect(&format!("ws://{addr}")).await.expect("client connect failed");

    // Two ACKs are admitted back to back; neither response exists yet.
    let first = client.enqueue_screencast_ack("page-session", 11).expect("first ACK admitted");
    let second = client.enqueue_screencast_ack("page-session", 11).expect("second ACK admitted without waiting");
    let mut wire_ids = Vec::new();
    for _ in 0..2 {
        let Message::Text(text) = timeout(Duration::from_secs(2), server_rx.recv()).await.unwrap().unwrap() else {
            panic!("expected text")
        };
        let cmd: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(cmd["method"], "Page.screencastFrameAck");
        assert_eq!(cmd["sessionId"], "page-session");
        assert_eq!(cmd["params"]["sessionId"], 11);
        wire_ids.push(cmd["id"].clone());
    }
    assert_eq!(client.stats().screencast_frames_acked.load(std::sync::atomic::Ordering::Relaxed), 0);

    // Answering (out of order) resolves each handle; an error answer is the ambiguous outcome.
    server_tx.send(Message::Text(json!({"id": wire_ids[1], "result": {}}).to_string().into())).await.unwrap();
    server_tx
        .send(Message::Text(json!({"id": wire_ids[0], "error": {"code": -32000, "message": "nope"}}).to_string().into()))
        .await
        .unwrap();
    assert!(second.wait().await.is_ok());
    assert!(matches!(first.wait().await, Err(CdpError::Protocol { .. })));
    assert_eq!(client.stats().screencast_frames_acked.load(std::sync::atomic::Ordering::Relaxed), 1);
}

/// Peer that accepts every connection: answers commands, lets the test push events to, or drop,
/// the live connection and counts connections.
struct ReconnectPeer {
    addr: SocketAddr,
    connections: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    push: tokio::sync::mpsc::UnboundedSender<Message>,
    drop_live: tokio::sync::mpsc::UnboundedSender<()>,
}

async fn start_reconnect_peer() -> ReconnectPeer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let connections = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (push, push_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    let (drop_live, drop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let counter = connections.clone();
    let push_rx = std::sync::Arc::new(tokio::sync::Mutex::new(push_rx));
    let drop_rx = std::sync::Arc::new(tokio::sync::Mutex::new(drop_rx));
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let Ok(mut ws) = accept_async(stream).await else { continue };
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let (push_rx, drop_rx) = (push_rx.clone(), drop_rx.clone());
            tokio::spawn(async move {
                let (mut push_rx, mut drop_rx) = (push_rx.lock().await, drop_rx.lock().await);
                loop {
                    tokio::select! {
                        msg = push_rx.recv() => {
                            let Some(msg) = msg else { break };
                            if ws.send(msg).await.is_err() { break; }
                        }
                        _ = drop_rx.recv() => break,
                        incoming = ws.next() => {
                            let Some(Ok(Message::Text(text))) = incoming else { break };
                            let cmd: serde_json::Value = serde_json::from_str(&text).unwrap();
                            let reply = json!({"id": cmd["id"], "result": {"echo": cmd["method"]}});
                            if ws.send(Message::Text(reply.to_string().into())).await.is_err() { break; }
                        }
                    }
                }
            });
        }
    });
    ReconnectPeer { addr, connections, push, drop_live }
}

#[tokio::test]
async fn test_cdp_reconnect_replaces_a_dead_actor_and_keeps_existing_subscribers() {
    use std::sync::atomic::Ordering;
    let peer = start_reconnect_peer().await;
    let client = CdpClient::connect(&format!("ws://{}", peer.addr)).await.expect("client connect failed");
    let mut frames = client.subscribe_screencast();
    assert_eq!(client.send_command("Browser.getVersion", None, None).await.unwrap()["echo"], "Browser.getVersion");

    // Alive: reconnect is a no-op and never dials again.
    client.reconnect().await.expect("reconnect while alive");
    assert_eq!(peer.connections.load(Ordering::SeqCst), 1);

    // Actor death is observable, commands fail, then reconnect brings a fresh actor.
    peer.drop_live.send(()).unwrap();
    timeout(Duration::from_secs(2), client.closed()).await.expect("actor must stop when the peer drops");
    assert!(client.is_closed());
    assert!(matches!(client.send_command("Browser.getVersion", None, None).await, Err(CdpError::ConnectionClosed)));
    client.reconnect().await.expect("reconnect after loss");
    assert!(!client.is_closed());
    assert_eq!(peer.connections.load(Ordering::SeqCst), 2);
    assert_eq!(client.send_command("Page.enable", None, None).await.unwrap()["echo"], "Page.enable");

    // The pre-existing subscriber receives events of the new connection.
    let frame_event = json!({"method": "Page.screencastFrame", "sessionId": "fresh-session", "params": {
        "data": "aGVsbG8=", "sessionId": 3,
        "metadata": {"offsetTop": 0, "pageScaleFactor": 1.0, "deviceWidth": 1280, "deviceHeight": 900,
                     "scrollOffsetX": 0, "scrollOffsetY": 0, "timestamp": 1.5}
    }});
    peer.push.send(Message::Text(frame_event.to_string().into())).unwrap();
    let received = timeout(Duration::from_secs(2), frames.recv()).await.expect("frame timeout").expect("subscriber survives reconnect");
    assert_eq!(received.session_id, "fresh-session");
}

#[tokio::test]
async fn test_cdp_client_without_an_endpoint_cannot_reconnect() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let ws = accept_async(stream).await.unwrap();
        drop(ws); // dies immediately
    });
    let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}")).await.unwrap();
    let client = CdpClient::from_ws_stream(ws);
    server.await.unwrap();
    timeout(Duration::from_secs(2), client.closed()).await.expect("actor stops");
    assert!(matches!(client.reconnect().await, Err(CdpError::Transport(_))));
    assert!(client.is_closed(), "a refused reconnect leaves the client closed");
}
