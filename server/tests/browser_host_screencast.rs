use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;
use chromiumoxide_cdp::cdp::browser_protocol::target::CreateTargetParams;
use dam_hopper_server::browser_host::cdp::CdpClient;
use dam_hopper_server::browser_host::process::{find_browser_executable, BrowserLaunchConfig, BrowserProcess};
use dam_hopper_server::browser_host::protocol::{
    unpack_bhjf_frame, StreamQualityStatus, TargetGeometry, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH,
};
use dam_hopper_server::browser_host::screencast::{
    create_governor_interval, ScreencastProducer, ScreencastState,
};
use tempfile::tempdir;
use tokio::time::{sleep, timeout};
use uuid::Uuid;

fn require_browser_executable() -> Option<std::path::PathBuf> {
    if let Ok(path) = find_browser_executable(None) {
        return Some(path);
    }
    for candidate in &["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"] {
        let p = std::path::PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
        panic!("Required Chrome/Chromium executable not found on host");
    }
    eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
    None
}

/// Helper to launch real Chromium, connect CDP, create target, and construct ScreencastProducer.
async fn setup_producer() -> Option<(BrowserProcess, Arc<CdpClient>, ScreencastProducer, tempfile::TempDir)> {
    let exec = require_browser_executable()?;
    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("screencast-test-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let process = BrowserProcess::launch(config)
        .await
        .expect("browser launch failed");
    let ws_url = process.ws_endpoint().to_string();

    let client = CdpClient::connect(&ws_url)
        .await
        .expect("CDP client connect failed");

    // Create target
    let create_target = CreateTargetParams::builder().url("about:blank").build().unwrap();
    let target_res = client
        .send_typed(create_target, None)
        .await
        .expect("Target.createTarget failed");
    let target_id = target_res.target_id;

    let session_id = Uuid::new_v4().to_string();
    let incarnation = Uuid::new_v4().to_string();
    let initial_geom = TargetGeometry {
        css_width: 1280.0,
        css_height: 900.0,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    };

    let producer = ScreencastProducer::new(
        session_id,
        incarnation,
        1, // profileEpoch
        1, // viewportEpoch
        client.clone(),
        target_id.into(),
        initial_geom,
    );

    Some((process, client, producer, tmp))
}

#[tokio::test]
async fn test_screencast_producer_lifecycle_and_frames() {
    let (mut process, _client, producer, _tmp) = match setup_producer().await {
        Some(s) => s,
        None => return,
    };

    let viewer_id = "test-viewer-1";
    let sub_epoch = Uuid::new_v4().to_string();

    let mut frame_rx = producer.subscribe_frames();

    // 1. Demand registration starts screencast
    producer
        .register_viewer_demand(viewer_id, &sub_epoch, true)
        .await;

    // Allow time for start command to execute
    sleep(Duration::from_millis(300)).await;
    assert_ne!(producer.state().await, ScreencastState::Stopped);

    // 2. Wait for first BHJF frame (within 10s)
    let first_frame = timeout(Duration::from_secs(10), frame_rx.recv())
        .await
        .expect("timed out waiting for first frame")
        .expect("frame receiver closed");

    assert!(!first_frame.data().is_empty());
    let (header, jpeg_payload) = unpack_bhjf_frame(first_frame.data()).expect("valid BHJF packet");
    assert!(header.width > 0 && header.width <= MAX_IMAGE_WIDTH);
    assert!(header.height > 0 && header.height <= MAX_IMAGE_HEIGHT);
    assert_eq!(header.viewport_epoch, "1");
    assert_eq!(header.frame_seq, "1");
    assert!(header.input_trusted);
    assert!(!jpeg_payload.is_empty());

    // Verify ACK was enqueued
    assert!(producer.ledger.acks_enqueued.load(Ordering::Relaxed) >= 1);
    assert_eq!(producer.ledger.periodic_screenshot_violations.load(Ordering::Relaxed), 0);

    // 3. Verify cached frame exists before resize
    let cached = producer.get_cached_frame().await;
    assert!(cached.is_some());
    let (cached_hdr, _) = unpack_bhjf_frame(cached.unwrap().data()).unwrap();
    assert_eq!(cached_hdr.browser_session_id, header.browser_session_id);

    // 4. Viewport epoch advance without dimension change preserves valid cached frame
    let scrolled_geom = TargetGeometry {
        css_width: 1280.0,
        css_height: 900.0,
        offset_top: 0.0,
        scroll_x: 50.0,
        scroll_y: 50.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    };
    producer.update_geometry(scrolled_geom).await.expect("update geometry");
    assert_eq!(producer.viewport_epoch(), 2);
    assert!(producer.get_cached_frame().await.is_some());

    // 5. Zero-demand stop
    producer.remove_viewer_demand(&sub_epoch).await;
    sleep(Duration::from_millis(500)).await;
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert!(producer.ledger.zero_demand_stops.load(Ordering::Relaxed) >= 1);

    // Final frame remains retained after stop
    let final_frame = producer.get_cached_frame().await;
    assert!(final_frame.is_some());

    // 6. Dimension change invalidates stale incompatible cache per W5 contract
    let resized_geom = TargetGeometry {
        css_width: 800.0,
        css_height: 600.0,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    };
    producer.update_geometry(resized_geom).await.expect("update geometry");
    assert!(producer.get_cached_frame().await.is_none());
    // 6. Clean up process
    let _ = process.terminate().await;
}

#[tokio::test]
async fn test_screencast_heartbeat_expiry() {
    let (mut process, _client, producer, _tmp) = match setup_producer().await {
        Some(s) => s,
        None => return,
    };

    let viewer_1 = "v1";
    let sub_1 = Uuid::new_v4().to_string();
    let viewer_2 = "v2";
    let sub_2 = Uuid::new_v4().to_string();

    producer.register_viewer_demand(viewer_1, &sub_1, true).await;
    producer.register_viewer_demand(viewer_2, &sub_2, true).await;
    assert_eq!(producer.visible_viewer_count().await, 2);

    // Simulating heartbeats: heartbeat viewer 1 only
    producer.heartbeat(&sub_1, true).await;
    assert_eq!(producer.visible_viewer_count().await, 2);

    // Marking viewer 2 non-visible
    producer.heartbeat(&sub_2, false).await;
    assert_eq!(producer.visible_viewer_count().await, 1);

    // Pausing viewer 1 releases all demand
    producer.remove_viewer_demand(&sub_1).await;
    sleep(Duration::from_millis(500)).await;
    assert_eq!(producer.visible_viewer_count().await, 0);
    assert_eq!(producer.state().await, ScreencastState::Stopped);

    let _ = process.terminate().await;
}

#[tokio::test]
async fn test_screencast_burst_events_and_candidate_replacement() {
    let (mut process, _client, producer, _tmp) = match setup_producer().await {
        Some(s) => s,
        None => return,
    };

    let sub_epoch = Uuid::new_v4().to_string();
    producer
        .register_viewer_demand("viewer-burst", &sub_epoch, true)
        .await;

    // Wait until streaming
    let mut started = false;
    for _ in 0..20 {
        if producer.state().await == ScreencastState::Streaming {
            started = true;
            break;
        }
        sleep(Duration::from_millis(100)).await;
    }
    assert!(started, "producer did not enter Streaming state");

    // Let it run for 1 second to observe incoming frames and candidate replacement
    sleep(Duration::from_secs(1)).await;

    let received = producer.ledger.events_received.load(Ordering::Relaxed);
    let acks = producer.ledger.acks_enqueued.load(Ordering::Relaxed);
    let decoded = producer.ledger.base64_decoded.load(Ordering::Relaxed);
    let published = producer.ledger.frames_published.load(Ordering::Relaxed);

    println!(
        "[Screencast Metrics] Received: {}, ACKs: {}, Decoded: {}, Published: {}",
        received, acks, decoded, published
    );

    // Every received event had an ACK attempted
    assert_eq!(received, acks);

    // Decode only occurs on governor publication, so decoded count <= received count
    assert!(decoded <= received + 1);

    // No periodic screenshot violation
    assert_eq!(
        producer.ledger.periodic_screenshot_violations.load(Ordering::Relaxed),
        0
    );

    let _ = producer.stop_screencast().await;
    let _ = process.terminate().await;
}

#[tokio::test]
async fn test_screencast_native_capture_timestamp_validation_and_preservation() {
    use dam_hopper_server::browser_host::cdp::parse_native_capture_time_unix_ms;
    use dam_hopper_server::browser_host::diagnostics::global_stream_diagnostics;
    use serde_json::json;

    // 1. Unit verification of native metadata timestamp parsing and invalid rejection
    assert_eq!(
        parse_native_capture_time_unix_ms(&json!({ "timestamp": 1731050000.125 })),
        Some(1_731_050_000_125)
    );
    assert_eq!(parse_native_capture_time_unix_ms(&json!({})), None);
    assert_eq!(
        parse_native_capture_time_unix_ms(&json!({ "timestamp": null })),
        None
    );
    assert_eq!(
        parse_native_capture_time_unix_ms(&json!({ "timestamp": 0.0 })),
        None
    );
    assert_eq!(
        parse_native_capture_time_unix_ms(&json!({ "timestamp": -12.5 })),
        None
    );
    assert_eq!(
        parse_native_capture_time_unix_ms(&json!({ "timestamp": 9_007_199_254_741.0 })),
        None
    );

    // 2. Real Chromium screencast preserves valid native timestamp and records separate server receipt
    let (mut process, _client, producer, _tmp) = match setup_producer().await {
        Some(s) => s,
        None => return,
    };
    let diag = global_stream_diagnostics();
    let valid_before = diag.native_capture_timestamps_valid.load(Ordering::Relaxed);

    let sub_epoch = Uuid::new_v4().to_string();
    let mut frame_rx = producer.subscribe_frames();
    producer
        .register_viewer_demand("viewer-ts", &sub_epoch, true)
        .await;

    let frame = timeout(Duration::from_secs(10), frame_rx.recv())
        .await
        .expect("timed out waiting for frame")
        .expect("frame_rx closed");
    let (header, _) = unpack_bhjf_frame(frame.data()).expect("valid BHJF frame");

    let receipt_ms = diag.last_server_receipt_unix_ms.load(Ordering::Relaxed);
    assert!(receipt_ms > 0, "server receipt timestamp must be recorded");
    assert!(
        header.capture_time_unix_ms > 0,
        "real Chromium screencast frame must preserve positive native metadata timestamp"
    );
    assert_eq!(
        header.native_capture_time_unix_ms(),
        Some(header.capture_time_unix_ms)
    );
    assert!(
        diag.native_capture_timestamps_valid.load(Ordering::Relaxed) > valid_before,
        "valid native capture timestamp counter must advance"
    );
    producer.remove_viewer_demand(&sub_epoch).await;
    let _ = producer.stop_screencast().await;
    let _ = process.terminate().await;
}

#[tokio::test(start_paused = true)]
async fn test_governor_missed_ticks_skip_catchup_burst() {
    let mut governor_ticker = create_governor_interval(Duration::from_millis(42));

    // First immediate tick
    governor_ticker.tick().await;

    // Advance 500ms (~12 governor intervals) without polling ticker
    tokio::time::advance(Duration::from_millis(500)).await;

    let mut ticks_fired = 0usize;
    while tokio::time::timeout(Duration::ZERO, governor_ticker.tick())
        .await
        .is_ok()
    {
        ticks_fired += 1;
    }

    assert_eq!(
        ticks_fired, 1,
        "MissedTickBehavior::Skip must emit at most 1 tick after a stall, never a catch-up burst"
    );
}

async fn start_mock_cdp(
    fail_emulation: bool,
    fail_screencast_restart: bool,
    fail_rollback: bool,
) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let screencast_call_count = Arc::new(AtomicUsize::new(0));
    let emu_1280_call_count = Arc::new(AtomicUsize::new(0));
    let handle = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let sc_count = screencast_call_count.clone();
            let emu_count = emu_1280_call_count.clone();
            let mut ws = match tokio_tungstenite::accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => continue,
            };
            while let Some(msg) = ws.next().await {
                let Ok(Message::Text(text)) = msg else { continue };
                let Ok(cmd): Result<Value, _> = serde_json::from_str(&text) else { continue };
                let method = cmd["method"].as_str().unwrap_or("");
                let reply = if method == "Target.attachToTarget" {
                    json!({"id": cmd["id"], "result": {"sessionId": "MOCK-PAGE-SESSION"}})
                } else if method == "Emulation.setDeviceMetricsOverride" {
                    if fail_emulation && cmd["params"]["width"] == 800 {
                        json!({"id": cmd["id"], "error": {"code": -32000, "message": "Emulation metrics failed"}})
                    } else if cmd["params"]["width"] == 1280 {
                        let count_1280 = emu_count.fetch_add(1, Ordering::SeqCst);
                        if fail_rollback && count_1280 >= 1 {
                            json!({"id": cmd["id"], "error": {"code": -32000, "message": "Rollback emulation metrics failed"}})
                        } else {
                            json!({"id": cmd["id"], "result": {}})
                        }
                    } else {
                        json!({"id": cmd["id"], "result": {}})
                    }
                } else if method == "Page.startScreencast" {
                    let count = sc_count.fetch_add(1, Ordering::SeqCst);
                    if count == 1 && fail_screencast_restart {
                        json!({"id": cmd["id"], "error": {"code": -32000, "message": "Page.startScreencast failed"}})
                    } else if count > 1 && fail_rollback {
                        json!({"id": cmd["id"], "error": {"code": -32000, "message": "Rollback Page.startScreencast failed"}})
                    } else {
                        json!({"id": cmd["id"], "result": {}})
                    }
                } else {
                    json!({"id": cmd["id"], "result": {}})
                };
                if ws.send(Message::Text(reply.to_string().into())).await.is_err() {
                    break;
                }
            }
        }
    });
    (format!("ws://{addr}"), handle)
}

#[tokio::test]
async fn test_update_geometry_surfaces_cdp_failure_leaving_producer_unchanged() {
    // Case 1: Emulation.setDeviceMetricsOverride fails -> geometry and epoch unchanged
    let (ws_url_1, _srv1) = start_mock_cdp(true, false, false).await;
    let client_1 = CdpClient::connect(&ws_url_1).await.expect("connect mock cdp");
    let initial_geom = TargetGeometry {
        css_width: 1280.0,
        css_height: 900.0,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    };
    let producer_1 = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client_1,
        "PAGE-TARGET-1".to_string(),
        initial_geom.clone(),
    );
    producer_1.ensure_page_session().await.expect("ensure page session");

    let new_geom = TargetGeometry {
        css_width: 800.0,
        css_height: 600.0,
        dpr: 1.5,
        ..initial_geom.clone()
    };

    let res_1 = producer_1.update_geometry(new_geom.clone()).await;
    assert!(res_1.is_err(), "update_geometry must fail when CDP command fails");
    let err_msg_1 = res_1.unwrap_err();
    assert!(
        err_msg_1.contains("Emulation.setDeviceMetricsOverride failed"),
        "unexpected error message: {err_msg_1}"
    );
    assert_eq!(
        producer_1.geometry().await,
        initial_geom,
        "producer geometry must remain unchanged on CDP failure"
    );
    assert_eq!(
        producer_1.viewport_epoch(),
        1,
        "producer viewport epoch must remain unchanged on CDP failure"
    );

    // Case 2: Page.startScreencast restart fails -> geometry and epoch restored consistently
    let (ws_url_2, _srv2) = start_mock_cdp(false, true, false).await;
    let client_2 = CdpClient::connect(&ws_url_2).await.expect("connect mock cdp 2");
    let producer_2 = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client_2,
        "PAGE-TARGET-2".to_string(),
        initial_geom.clone(),
    );
    producer_2.ensure_page_session().await.expect("ensure page session 2");
    // Register demand so producer state becomes Streaming (initial startScreencast succeeds)
    producer_2.start_screencast_run().await.expect("start screencast run 2");
    // Visible demand keeps the run Streaming; otherwise the first zero-demand tick races the restart.
    producer_2.register_viewer_demand("keepalive", &Uuid::new_v4().to_string(), true).await;

    let res_2 = producer_2.update_geometry(new_geom.clone()).await;
    assert!(res_2.is_err(), "update_geometry must fail when screencast restart fails");
    let err_msg_2 = res_2.unwrap_err();
    assert!(
        err_msg_2.contains("Page.startScreencast restart failed"),
        "unexpected error message: {err_msg_2}"
    );
    assert_eq!(
        producer_2.geometry().await,
        initial_geom,
        "producer geometry must be restored to initial on screencast restart failure"
    );
    assert_eq!(
        producer_2.viewport_epoch(),
        1,
        "producer viewport epoch must be restored to initial on screencast restart failure"
    );
    assert!(
        producer_2.get_cached_frame().await.is_none(),
        "complete cache state (cached_frame = None) must be restored"
    );
    assert!(
        producer_2.get_cached_header().await.is_none(),
        "complete cache state (cached_header = None) must be restored"
    );
}

#[tokio::test]
async fn test_update_geometry_rollback_failure_retires_producer() {
    // When screencast restart fails AND native rollback command fails,
    // the producer MUST be marked unusable and retired (fail-closed).
    let (ws_url, _srv) = start_mock_cdp(false, true, true).await;
    let client = CdpClient::connect(&ws_url).await.expect("connect mock cdp");
    let initial_geom = TargetGeometry {
        css_width: 1280.0,
        css_height: 900.0,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    };
    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client,
        "PAGE-TARGET-RETIRE".to_string(),
        initial_geom.clone(),
    );
    producer.ensure_page_session().await.expect("ensure page session");
    producer.start_screencast_run().await.expect("start screencast run");
    producer.register_viewer_demand("keepalive", &Uuid::new_v4().to_string(), true).await;
    assert_eq!(producer.state().await, ScreencastState::Streaming);

    let new_geom = TargetGeometry {
        css_width: 800.0,
        css_height: 600.0,
        dpr: 1.5,
        ..initial_geom.clone()
    };

    let res = producer.update_geometry(new_geom).await;
    assert!(res.is_err(), "update_geometry must fail when rollback fails");
    let err = res.unwrap_err();
    assert!(
        err.contains("producer retired"),
        "expected producer retired message, got: {err}"
    );
    assert_eq!(
        producer.state().await,
        ScreencastState::Stopped,
        "producer must be retired to Stopped state"
    );
    assert_eq!(
        producer.current_run().await,
        None,
        "producer run must be cleared on fatal retirement"
    );
    assert!(
        producer.get_cached_frame().await.is_none(),
        "cached frame must be cleared on retirement"
    );
    assert!(
        producer.get_cached_header().await.is_none(),
        "cached header must be cleared on retirement"
    );
}

// ---------------------------------------------------------------------------------------------
// Adaptive capture tiers: fresh-run switch, audio source authority, failure recovery.
// ---------------------------------------------------------------------------------------------
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use dam_hopper_server::browser_host::adaptive_stream_controller::{AudioGate, AudioSuppression};
use dam_hopper_server::browser_host::capture_tier::{CaptureTier, DownscaleObservation, QualityPreference};
use tokio::sync::mpsc;

#[derive(Clone, Copy, Default)]
struct Faults {
    fail_stop: bool,
    fail_start_from: Option<usize>,
    fail_start_only: Option<usize>,
}

struct RecordingCdp {
    url: String,
    commands: mpsc::UnboundedReceiver<Value>,
    push: mpsc::UnboundedSender<Value>,
    _server: tokio::task::JoinHandle<()>,
}

async fn start_recording_cdp(faults: Faults) -> RecordingCdp {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (cmd_tx, commands) = mpsc::unbounded_channel::<Value>();
    let (push, mut push_rx) = mpsc::unbounded_channel::<Value>();
    let server = tokio::spawn(async move {
        let Ok((stream, _)) = listener.accept().await else { return };
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        let mut starts = 0usize;
        loop {
            tokio::select! {
                pushed = push_rx.recv() => {
                    let Some(ev) = pushed else { break };
                    if ws.send(Message::Text(ev.to_string().into())).await.is_err() { break; }
                }
                incoming = ws.next() => {
                    let Some(Ok(Message::Text(text))) = incoming else { break };
                    let cmd: Value = serde_json::from_str(&text).unwrap();
                    let method = cmd["method"].as_str().unwrap_or("").to_string();
                    let fail = match method.as_str() {
                        "Page.stopScreencast" => faults.fail_stop,
                        "Page.startScreencast" => {
                            let n = starts;
                            starts += 1;
                            faults.fail_start_from.is_some_and(|k| n >= k) || faults.fail_start_only == Some(n)
                        }
                        _ => false,
                    };
                    let reply = if fail {
                        json!({"id": cmd["id"], "error": {"code": -32000, "message": format!("{method} failed")}})
                    } else if method == "Target.attachToTarget" {
                        json!({"id": cmd["id"], "result": {"sessionId": "MOCK-PAGE-SESSION"}})
                    } else {
                        json!({"id": cmd["id"], "result": {}})
                    };
                    let _ = cmd_tx.send(cmd);
                    if ws.send(Message::Text(reply.to_string().into())).await.is_err() { break; }
                }
            }
        }
    });
    RecordingCdp { url: format!("ws://{addr}"), commands, push, _server: server }
}

fn dummy_jpeg_64() -> Vec<u8> {
    let mut data = vec![
        0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02,
        0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9,
    ];
    data.resize(64, 0);
    data[62] = 0xFF;
    data[63] = 0xD9;
    data
}

fn screencast_frame_event(native_id: i64) -> Value {
    json!({"method": "Page.screencastFrame", "sessionId": "MOCK-PAGE-SESSION", "params": {
        "sessionId": native_id, "data": B64.encode(dummy_jpeg_64()),
        "metadata": {"offsetTop": 0.0, "pageScaleFactor": 1.0, "deviceWidth": 1280.0, "deviceHeight": 720.0,
                     "scrollOffsetX": 0.0, "scrollOffsetY": 0.0, "timestamp": 1.0}
    }})
}

fn drain_commands(cdp: &mut RecordingCdp) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(c) = cdp.commands.try_recv() {
        if c["method"] != "Runtime.evaluate" {
            out.push(c);
        }
    }
    out
}

/// Streaming producer plus one visible keep-alive viewer (zero-demand would otherwise stop the run).
async fn streaming_producer(faults: Faults, jpeg_ceiling: u8) -> (ScreencastProducer, RecordingCdp, String) {
    let cdp = start_recording_cdp(faults).await;
    let client = CdpClient::connect(&cdp.url).await.expect("connect mock cdp");
    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client,
        "PAGE-TARGET-TIER".to_string(),
        TargetGeometry {
            css_width: 1280.0, css_height: 720.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
            page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
        },
    )
    .with_capture_policy(24, jpeg_ceiling);
    producer.ensure_page_session().await.expect("page session");
    producer.start_screencast_run().await.expect("start run");
    let sub = Uuid::new_v4().to_string();
    producer.register_viewer_demand("viewer-keepalive", &sub, true).await;
    (producer, cdp, sub)
}

/// With a q60 admin ceiling the Low tier is a single resolution hop (0.75x) from Medium.
async fn request_low_and_wait_for_scaled_snapshot(producer: &ScreencastProducer, sub: &str) {
    assert!(producer.set_viewer_quality_preference(sub, QualityPreference::Low));
    for _ in 0..240 {
        if producer.capture_snapshot().scale_permille < 1000 {
            return;
        }
        sleep(Duration::from_millis(25)).await;
    }
    panic!("controller never published the scaled snapshot");
}

/// Polls until the producer has a different live run than `old`. The state read is the lock
/// barrier: it waits out an in-flight switch so the run id observed afterwards is final.
async fn wait_for_new_run(producer: &ScreencastProducer, old: Uuid) -> Uuid {
    for _ in 0..240 {
        if producer.state().await == ScreencastState::Streaming {
            if let Some(run) = producer.current_run().await {
                if run != old {
                    return run;
                }
            }
        }
        sleep(Duration::from_millis(25)).await;
    }
    panic!("producer never started a fresh run");
}

fn start_params(commands: &[Value]) -> Vec<&Value> {
    commands.iter().filter(|c| c["method"] == "Page.startScreencast").map(|c| &c["params"]).collect()
}

fn index_of(commands: &[Value], method: &str) -> Option<usize> {
    commands.iter().position(|c| c["method"] == method)
}

#[tokio::test]
async fn capture_tier_switch_rotates_video_run_keeps_css_epoch_and_audio_source() {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 60).await;
    let run1 = producer.current_run().await.unwrap();
    assert_eq!(producer.audio_source_run(), Some(run1), "audio source starts with the first run");
    let (epoch, geometry) = (producer.viewport_epoch(), producer.geometry().await);
    let mut frames = producer.subscribe_frames();

    cdp.push.send(screencast_frame_event(1)).unwrap();
    let f1 = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let h1 = f1.header().unwrap().clone();
    assert_eq!(h1.producer_run, run1.to_string());
    assert!(h1.input_trusted);
    let proven = producer.effective_capture().expect("first current-run frame proves the snapshot");
    assert_eq!(proven.native_key(), (60, 1000));
    let _ = drain_commands(&mut cdp);

    request_low_and_wait_for_scaled_snapshot(&producer, &sub).await;
    let low = producer.capture_snapshot();
    assert_eq!(low.tier, CaptureTier::Low);
    let run2 = wait_for_new_run(&producer, run1).await;
    let cmds = drain_commands(&mut cdp);
    let (stop, start) = (index_of(&cmds, "Page.stopScreencast"), index_of(&cmds, "Page.startScreencast"));
    assert!(stop.is_some() && start.is_some() && stop < start, "stop must precede the fresh start: {cmds:?}");
    let starts = start_params(&cmds);
    assert_eq!(starts.len(), 1, "exactly one fresh start, never an active-start reissue");
    assert_eq!(starts[0]["format"], "jpeg");
    assert_eq!(starts[0]["quality"], 60);
    assert_eq!(starts[0]["maxWidth"], 960);
    assert_eq!(starts[0]["maxHeight"], 540);
    assert_eq!(starts[0]["everyNthFrame"], 1);
    assert!(index_of(&cmds, "Emulation.setDeviceMetricsOverride").is_none(), "capture-only switch never touches CSS viewport/DPR");
    assert_eq!(producer.viewport_epoch(), epoch);
    assert_eq!(producer.geometry().await, geometry);
    assert_eq!(producer.audio_source_run(), Some(run1), "audio source survives video-only restart");
    assert_ne!(run2, run1);
    assert!(producer.get_cached_frame().await.is_none(), "old-run pixels are not republished");
    assert_eq!(producer.effective_capture().unwrap().version, proven.version, "unproven settings are never effective");

    // Fresh run frame: effective only now; downscaled frames stay input-untrusted.
    cdp.push.send(screencast_frame_event(2)).unwrap();
    let f2 = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let h2 = f2.header().unwrap().clone();
    assert_eq!(h2.producer_run, run2.to_string());
    assert!(!h2.input_trusted, "downscaled frame must be input-untrusted until the oracle passes");
    assert_eq!((h2.geometry.css_width, h2.geometry.css_height), (1280.0, 720.0), "CSS metadata stays invariant");
    assert_eq!(producer.effective_capture().unwrap().version, low.version);

    let obs = |s: u16, w: u32, h: u32| DownscaleObservation {
        scale_permille: s, dom_inner: (1280.0, 720.0), dom_dpr: 1.0, meta_css: (1280.0, 720.0), jpeg: (w, h),
        click_expected_uv: (0.3, 0.6), click_observed_uv: (0.3, 0.6),
    };
    producer
        .capture_state()
        .qualify_downscale(1280.0, 720.0, 1.0, &[obs(1000, 1280, 720), obs(750, 960, 540), obs(500, 640, 360)])
        .expect("oracle passes");
    cdp.push.send(screencast_frame_event(2)).unwrap();
    let f3 = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert!(f3.header().unwrap().input_trusted, "qualified downscale becomes input-trusted");
}

#[tokio::test]
async fn failed_stop_leaves_live_run_untouched_and_never_reissues_start() {
    let (producer, mut cdp, sub) = streaming_producer(Faults { fail_stop: true, ..Faults::default() }, 60).await;
    let run1 = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert_eq!(producer.effective_capture().unwrap().fps, 10, "Auto warm start at Medium cadence");
    request_low_and_wait_for_scaled_snapshot(&producer, &sub).await;
    sleep(Duration::from_millis(500)).await;
    assert_eq!(producer.current_run().await, Some(run1));
    assert_eq!(producer.state().await, ScreencastState::Streaming);
    assert_eq!(producer.audio_source_run(), Some(run1));
    let cmds = drain_commands(&mut cdp);
    assert!(index_of(&cmds, "Page.stopScreencast").is_some(), "the switch attempt stopped first: {cmds:?}");
    assert_eq!(start_params(&cmds).len(), 1, "only the initial start; no reissue after a failed stop");
    // A failed switch backs off instead of hammering the native screencast on every evaluation.
    assert!(matches!(producer.apply_capture_snapshot().await, Ok(false)));
    sleep(Duration::from_millis(1300)).await;
    assert!(index_of(&drain_commands(&mut cdp), "Page.stopScreencast").is_none());

    // The native switch is deferred, but the governor already runs the desired cadence: effective
    // settings combine the live run's native quality/scale with the applied FPS (no stale value).
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let eff = producer.effective_capture().unwrap();
    assert_eq!(eff.fps, 6);
    assert_eq!(eff.native_key(), (60, 1000), "native settings stay those of the live run");
}

#[tokio::test]
async fn failed_start_reverts_to_proven_parameters_without_advertising_new_settings() {
    let (producer, mut cdp, sub) = streaming_producer(Faults { fail_start_only: Some(1), ..Faults::default() }, 60).await;
    let run1 = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let proven = producer.effective_capture().unwrap();
    let _ = drain_commands(&mut cdp);

    assert!(producer.set_viewer_quality_preference(&sub, QualityPreference::Low));
    let run2 = wait_for_new_run(&producer, run1).await;
    sleep(Duration::from_millis(100)).await;
    let cmds = drain_commands(&mut cdp);
    let starts = start_params(&cmds);
    assert_eq!(starts.len(), 2, "failed new-parameter start, then one retry: {cmds:?}");
    assert_eq!(starts[0]["maxWidth"], 960);
    assert_eq!(starts[1]["maxWidth"], 1280, "retry uses the last proven parameters");
    assert_eq!(starts[1]["quality"], 60);
    assert_eq!(producer.effective_capture().unwrap().version, proven.version, "unapplied settings never become effective");
    assert_eq!(producer.audio_source_run(), Some(run1));
    assert_ne!(run2, run1);
    // The controller still wants Low, but the failed switch backs off: no restart flapping.
    sleep(Duration::from_millis(2300)).await;
    assert!(start_params(&drain_commands(&mut cdp)).is_empty());
    assert_eq!(producer.current_run().await, Some(run2));
}

#[tokio::test]
async fn failed_retry_after_failed_switch_retires_the_producer_fail_closed() {
    let (producer, mut cdp, sub) = streaming_producer(Faults { fail_start_from: Some(1), ..Faults::default() }, 60).await;
    let mut frames = producer.subscribe_frames();
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert!(producer.set_viewer_quality_preference(&sub, QualityPreference::Low));
    for _ in 0..240 {
        if producer.state().await == ScreencastState::Stopped {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert_eq!(producer.current_run().await, None);
    assert_eq!(producer.audio_source_run(), None, "retirement ends the audio source");
    assert!(producer.get_cached_frame().await.is_none());
}

#[tokio::test]
async fn viewer_preference_flows_through_controller_to_shared_native_switch() {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let run1 = producer.current_run().await.unwrap();
    assert_eq!(producer.viewer_directives(&sub).unwrap().tier, CaptureTier::Medium);
    let _ = drain_commands(&mut cdp);
    let mut frames = producer.subscribe_frames();

    assert!(producer.set_viewer_quality_preference(&sub, QualityPreference::Low));
    let d = producer.viewer_directives(&sub).unwrap();
    assert_eq!(d.tier, CaptureTier::Low);
    assert_eq!(d.min_delivery_interval, Duration::from_secs_f64(1.0 / 6.0));

    // The 1s producer evaluation publishes the first shared knob (quality); the switch follows.
    let run2 = wait_for_new_run(&producer, run1).await;
    let cmds = drain_commands(&mut cdp);
    let starts = start_params(&cmds);
    assert_eq!(starts.len(), 1, "{cmds:?}");
    assert_eq!(starts[0]["quality"], 60);
    assert_eq!(starts[0]["maxWidth"], 1280, "resolution is the last knob, one step per dwell");
    assert_eq!(producer.capture_snapshot().fps, 6, "producer cadence follows the eligible viewer");
    assert_eq!(producer.audio_source_run(), Some(run1));
    assert_ne!(run2, run1);

    cdp.push.send(screencast_frame_event(2)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let eff = producer.effective_capture().unwrap();
    assert_eq!((eff.fps, eff.native_key()), (6, (60, 1000)), "effective = native run + applied cadence");
}

#[tokio::test]
async fn audio_authority_survives_capture_restart_and_viewer_gates_are_per_subscription() {
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 60).await;
    let run1 = producer.current_run().await.unwrap();
    let other = Uuid::new_v4().to_string();
    producer.register_viewer_demand("viewer-2", &other, true).await;
    assert!(producer.set_viewer_muted(&other, false));
    let pcm = B64.encode([0x12u8, 0x34, 0x56, 0x78]);
    let doc = producer.audio_doc_epoch();
    assert!(producer.admit_and_broadcast_audio_chunk(run1, doc, &pcm).await.is_some());

    assert!(producer.set_viewer_quality_preference(&sub, QualityPreference::Low));
    let run2 = wait_for_new_run(&producer, run1).await;
    assert!(
        producer.admit_and_broadcast_audio_chunk(run1, doc, &pcm).await.is_some(),
        "stable audio source identity is admissible after a capture-only restart"
    );
    assert!(
        producer.admit_and_broadcast_audio_chunk(run2, doc, &pcm).await.is_none(),
        "a video run id is not the audio source"
    );

    assert!(producer.set_viewer_muted(&sub, true));
    assert_eq!(producer.viewer_audio_gate(&sub), Some(AudioGate::Suppressed(AudioSuppression::Muted)));
    assert_eq!(producer.viewer_audio_gate(&other), Some(AudioGate::Allowed), "mute is per subscription");
    assert!(producer.set_viewer_muted(&sub, false));
    assert_eq!(producer.viewer_audio_gate(&sub), Some(AudioGate::Allowed));
    assert!(!producer.set_viewer_muted("unknown-subscription", true), "stale subscription cannot mutate policy");
}

#[tokio::test]
async fn queued_audio_is_dropped_after_a_quick_mute_unmute_and_for_unknown_subscriptions() {
    use dam_hopper_server::browser_host::media::audio_chunk_admissible;
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let run = producer.audio_source_run().unwrap().to_string();
    let doc = producer.audio_doc_epoch();
    assert!(producer.set_viewer_muted(&sub, false));
    let admitted = producer.viewer_audio_generation(&sub).unwrap();
    assert!(audio_chunk_admissible(&producer, &sub, admitted, 100, &run, doc));

    // Mute then unmute before the writer touches the queued chunk: allowed again, still dropped.
    assert!(producer.set_viewer_muted(&sub, true));
    assert!(producer.set_viewer_muted(&sub, false));
    assert_eq!(producer.viewer_audio_gate(&sub), Some(AudioGate::Allowed));
    assert!(!audio_chunk_admissible(&producer, &sub, admitted, 100, &run, doc), "pre-mute chunk must not be replayed");
    let fresh = producer.viewer_audio_generation(&sub).unwrap();
    assert!(audio_chunk_admissible(&producer, &sub, fresh, 200, &run, doc), "a chunk admitted after unmute is fine");

    assert!(!audio_chunk_admissible(&producer, "unknown-subscription", fresh, 200, &run, doc), "unknown subscription fails closed");
    assert!(!audio_chunk_admissible(&producer, &sub, fresh, 200, &Uuid::new_v4().to_string(), doc), "foreign audio source rejected");
    assert!(!audio_chunk_admissible(&producer, &sub, fresh, 200, &run, doc + 1), "stale document epoch rejected");
}

#[tokio::test]
async fn stream_quality_event_lifecycle_and_independent_viewer_gates() {
    use dam_hopper_server::browser_host::protocol::{StreamAudioReason, StreamQualityStatus};
    let (producer, mut cdp, sub1) = streaming_producer(Faults::default(), 75).await;
    let sub2 = Uuid::new_v4().to_string();
    producer.register_viewer_demand("viewer-2", &sub2, true).await;
    let mut frames = producer.subscribe_frames();

    // 1. Before native frame published: status is Warming.
    let q1_warm = producer.stream_quality_event(&sub1).await;
    assert_eq!(q1_warm.status, StreamQualityStatus::Warming);
    assert_eq!(q1_warm.preference, QualityPreference::Auto);
    assert!(q1_warm.audio_suppressed);
    assert_eq!(q1_warm.audio_reason, Some(StreamAudioReason::Muted));

    // Unmute sub1, keep sub2 muted.
    assert!(producer.set_viewer_muted(&sub1, false));

    // 2. Publish native frame -> status becomes Effective.
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();

    let q1_eff = producer.stream_quality_event(&sub1).await;
    assert_eq!(q1_eff.status, StreamQualityStatus::Effective);
    assert_eq!(q1_eff.preference, QualityPreference::Auto);
    assert!(!q1_eff.audio_suppressed);
    assert_eq!(q1_eff.audio_reason, None);
    assert_eq!(q1_eff.shared_tier, CaptureTier::Medium);
    assert_eq!(q1_eff.viewer_tier, CaptureTier::Medium);
    assert_eq!(q1_eff.image_width, 64);
    assert_eq!(q1_eff.image_height, 64);

    // Sub2 sees same sharedTier and applied image dimensions, but independent viewer state (muted).
    let q2_eff = producer.stream_quality_event(&sub2).await;
    assert_eq!(q2_eff.status, StreamQualityStatus::Effective);
    assert_eq!(q2_eff.shared_tier, q1_eff.shared_tier);
    assert_eq!(q2_eff.image_width, q1_eff.image_width);
    assert_eq!(q2_eff.image_height, q1_eff.image_height);
    assert!(q2_eff.audio_suppressed);
    assert_eq!(q2_eff.audio_reason, Some(StreamAudioReason::Muted));

    // 3. Sub2 requests Low preference without any lease.
    assert!(producer.set_viewer_quality_preference(&sub2, QualityPreference::Low));
    let q2_sw = producer.stream_quality_event(&sub2).await;
    assert_eq!(q2_sw.preference, QualityPreference::Low);
    assert_eq!(q2_sw.viewer_tier, CaptureTier::Low);
    // W4: proven sharedTier remains Medium until the Low native run is proven
    assert_eq!(q2_sw.shared_tier, CaptureTier::Medium);
}

#[tokio::test]
async fn video_restart_preserves_audio_source_and_audio_seq() {
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let run1 = producer.current_run().await.unwrap();
    let audio_run = producer.audio_source_run().expect("audio source run");
    assert_eq!(audio_run, run1);
    let pcm = B64.encode([0x12u8, 0x34, 0x56, 0x78]);
    let doc = producer.audio_doc_epoch();

    // Broadcast audio chunk seq 1
    let c1 = producer.admit_and_broadcast_audio_chunk(audio_run, doc, &pcm).await.expect("chunk 1");
    assert_eq!(c1.audio_seq, "1");
    assert_eq!(c1.audio_run, audio_run.to_string());

    // Video restart via preference switch
    assert!(producer.set_viewer_quality_preference(&sub, QualityPreference::Low));
    let run2 = wait_for_new_run(&producer, run1).await;
    assert_ne!(run2, run1);

    // Audio source run is unchanged, and audio seq continues monotonically (seq 2, NOT reset to 1)
    assert_eq!(producer.audio_source_run(), Some(audio_run));
    let c2 = producer.admit_and_broadcast_audio_chunk(audio_run, doc, &pcm).await.expect("chunk 2");
    assert_eq!(c2.audio_seq, "2");
    assert_eq!(c2.audio_run, audio_run.to_string());

    // Genuine stop tears down audio source
    assert!(producer.stop_screencast().await.is_ok());
    assert_eq!(producer.audio_source_run(), None);
}

#[tokio::test]
async fn steady_identical_frames_do_not_bump_quality_revision() {
    let (producer, mut cdp, _sub) = streaming_producer(Faults::default(), 75).await;
    let mut frames = producer.subscribe_frames();

    // First frame published
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let rev1 = producer.quality_revision();

    // 10 identical frames
    // 5 identical frames, waiting for governor interval
    for _ in 0..5 {
        sleep(Duration::from_millis(120)).await;
        cdp.push.send(screencast_frame_event(1)).unwrap();
        timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    }
    let rev2 = producer.quality_revision();
    assert_eq!(rev1, rev2, "quality_revision must not bump across identical frames");
    // Note on C3-W6: ScreencastLedger tracks frame and connection lifecycles but does not maintain
    // a separate per-producer quality_events_built counter. In the media pipeline (media.rs:1809),
    // last_digest.quality_rev != p.quality_revision() checks this exact revision, guaranteeing
    // that rev1 == rev2 produces zero quality event builds and zero outgoing streamQuality messages.
}

#[tokio::test]
async fn fps_only_change_converges_to_effective_status() {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let mut frames = producer.subscribe_frames();

    // 1. First frame proven -> effective
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let q1 = producer.stream_quality_event(&sub).await;
    assert_eq!(q1.status, StreamQualityStatus::Effective);
    assert_eq!(q1.fps, 10);

    // 2. Governor-only FPS change to 6 (same stage quality/scale)
    let med_stage = producer.capture_state().ladder().anchor(CaptureTier::Medium);
    let snap = producer.capture_state().publish(med_stage, 6).unwrap();
    assert_eq!(snap.native_key(), (65, 1000));
    assert_eq!(snap.fps, 6);

    // Frame published with governor applied_fps = 6
    sleep(Duration::from_millis(120)).await;
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    // Now governor has applied fps 6, native key matches: converges to Effective!
    let q3 = producer.stream_quality_event(&sub).await;
    assert_eq!(
        q3.status,
        StreamQualityStatus::Effective,
        "governor-only FPS change must converge to effective"
    );
    assert_eq!(q3.capture_version, snap.version.to_string());
}
#[tokio::test]
async fn capture_version_is_monotonic_during_switching_after_governor_fps_convergence() {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let mut frames = producer.subscribe_frames();

    // 1. First frame proven -> effective with native snapshot version 1
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let q1 = producer.stream_quality_event(&sub).await;
    assert_eq!(q1.status, StreamQualityStatus::Effective);
    assert_eq!(q1.capture_version, "1");

    // 2. Governor-only target v2 with FPS 6 (same native key)
    let med_stage = producer.capture_state().ladder().anchor(CaptureTier::Medium);
    let snap_v2 = producer.capture_state().publish(med_stage, 6).unwrap();
    assert_eq!(snap_v2.version, 2);

    // Frame published with applied_fps 6 -> converges to Effective with capture_version 2
    sleep(Duration::from_millis(120)).await;
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let q2 = producer.stream_quality_event(&sub).await;
    assert_eq!(q2.status, StreamQualityStatus::Effective);
    assert_eq!(q2.capture_version, "2");

    // 3. New target v3 with FPS 2 (Switching state before v3 is applied/proven)
    let snap_v3 = producer.capture_state().publish(med_stage, 2).unwrap();
    assert_eq!(snap_v3.version, 3);

    // Stream quality event during switching MUST retain monotonic capture_version >= 2,
    // NEVER falling back to native snapshot version 1.
    let q3 = producer.stream_quality_event(&sub).await;
    assert_eq!(q3.status, StreamQualityStatus::Switching);
    let v: u64 = q3.capture_version.parse().expect("valid version number");
    assert!(
        v >= 2,
        "capture_version during switching must be >= 2 (applied event version), got {}",
        q3.capture_version
    );
}

#[tokio::test]
async fn target_advances_before_first_frame_proof_still_emitted_coherently() {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let mut frames = producer.subscribe_frames();
    let initial_target = producer.capture_snapshot();

    // Target advances before any frame is received
    let med_stage = producer.capture_state().ladder().anchor(CaptureTier::Medium);
    let new_target = producer.capture_state().publish(med_stage, 6).unwrap();
    assert!(new_target.version > initial_target.version);

    // Warming status emits target version as placeholder
    let q_warm = producer.stream_quality_event(&sub).await;
    assert_eq!(q_warm.status, StreamQualityStatus::Warming);
    assert_eq!(q_warm.capture_version, new_target.version.to_string());

    // First frame arrives for initial native run
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();

    // Proven event is emitted coherently
    let q_prov = producer.stream_quality_event(&sub).await;
    assert!(matches!(q_prov.status, StreamQualityStatus::Effective | StreamQualityStatus::Switching));
    assert_eq!(q_prov.shared_tier, initial_target.tier);
}
