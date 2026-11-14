use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

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
    producer.update_geometry(scrolled_geom, 2).await.expect("update geometry");
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
    producer.update_geometry(resized_geom, 3).await.expect("update geometry");
    assert!(producer.get_cached_frame().await.is_none());
    // 6. Clean up process
    let _ = process.terminate().await;
}

/// Resize while STREAMING reissues `Page.startScreencast` on the same Page session. Chromium
/// numbers its native screencast sessions per start, so frames after the restart carry a newer
/// native id: they must still be ACKed and published (never silently stranded), carry the new
/// viewport epoch, and a published header must never carry the transitional (bit 63) marker.
#[tokio::test]
async fn real_streaming_resize_keeps_frames_flowing_with_clean_epochs() {
    let (mut process, _client, producer, _tmp) = match setup_producer().await {
        Some(s) => s,
        None => return,
    };
    let sub_epoch = Uuid::new_v4().to_string();
    let mut frame_rx = producer.subscribe_frames();
    producer.register_viewer_demand("resize-viewer", &sub_epoch, true).await;

    let first = timeout(Duration::from_secs(10), frame_rx.recv())
        .await.expect("first frame").expect("receiver open");
    assert_eq!(first.header().unwrap().viewport_epoch, "1");

    let resized = TargetGeometry {
        css_width: 800.0, css_height: 600.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
        page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
    };
    producer.update_geometry(resized, 2).await.expect("streaming resize");

    // Frames of the new geometry must arrive, and none may ever expose the transition marker.
    let transitional: u64 = 1 << 63;
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut saw_new_epoch = false;
    while Instant::now() < deadline && !saw_new_epoch {
        let Ok(Ok(frame)) = timeout(Duration::from_secs(2), frame_rx.recv()).await else { continue };
        let epoch: u64 = frame.header().unwrap().viewport_epoch.parse().unwrap();
        assert_eq!(epoch & transitional, 0, "transition marker leaked into a published header");
        saw_new_epoch = epoch == 2;
    }
    assert!(saw_new_epoch, "no frame of the resized geometry arrived: stream stranded after restart");
    assert!(producer.ledger.acks_enqueued.load(Ordering::Relaxed) >= 2);

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
    // A healthy real stream never overflows its bounded ingress or aborts the run.
    assert_eq!(producer.ledger.ingress_lagged.load(Ordering::Relaxed), 0);
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 0);

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

    let res_1 = producer_1.update_geometry(new_geom.clone(), 2).await;
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

    let res_2 = producer_2.update_geometry(new_geom.clone(), 2).await;
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

    let res = producer.update_geometry(new_geom, 2).await;
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

/// Dummy JPEG whose SOF declares `width`x`height` (the mock peer's stand-in for Chromium pixels).
fn screencast_frame_event_sized(native_id: i64, width: u16, height: u16) -> Value {
    let mut jpeg = dummy_jpeg_64();
    jpeg[7..9].copy_from_slice(&height.to_be_bytes());
    jpeg[9..11].copy_from_slice(&width.to_be_bytes());
    let mut ev = screencast_frame_event(native_id);
    ev["params"]["data"] = json!(B64.encode(jpeg));
    ev
}

fn acked_native_ids(commands: &[Value]) -> Vec<i64> {
    commands
        .iter()
        .filter(|c| c["method"] == "Page.screencastFrameAck")
        .filter_map(|c| c["params"]["sessionId"].as_i64())
        .collect()
}

/// Streaming producer at Medium with its first (1280x720, native session `first_native_id`)
/// frame published and proven, then switched to Low (960x540). Returns the fresh run.
async fn switched_to_low(
    first_native_id: i64,
) -> (ScreencastProducer, RecordingCdp, Uuid, u64) {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 60).await;
    let run1 = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();
    cdp.push.send(screencast_frame_event_sized(first_native_id, 1280, 720)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let proven = producer.effective_capture().expect("first frame proves Medium").version;
    request_low_and_wait_for_scaled_snapshot(&producer, &sub).await;
    let run2 = wait_for_new_run(&producer, run1).await;
    let _ = drain_commands(&mut cdp);
    (producer, cdp, run2, proven)
}

/// Class N: Chromium completes an in-flight capture of the retired session after the fresh start,
/// labelled with the NEW native session id but at the OLD size. It is ACKed (the new session
/// counts it) yet never published, never proves the Low settings and never disturbs the run.
#[tokio::test]
async fn capture_switch_drops_first_frame_with_new_session_id_at_previous_size() {
    let (producer, mut cdp, run2, proven_before) = switched_to_low(1).await;
    let mut frames = producer.subscribe_frames();

    cdp.push.send(screencast_frame_event_sized(2, 1280, 720)).unwrap();
    assert!(
        timeout(Duration::from_millis(600), frames.recv()).await.is_err(),
        "a frame at the replaced run's size must not be published under the fresh run"
    );
    assert_eq!(producer.effective_capture().unwrap().version, proven_before, "stale pixels never prove Low");
    assert!(producer.get_cached_frame().await.is_none());
    assert_eq!(acked_native_ids(&drain_commands(&mut cdp)), vec![2], "the stale frame is ACKed exactly once");

    cdp.push.send(screencast_frame_event_sized(2, 960, 540)).unwrap();
    let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let header = frame.header().unwrap();
    assert_eq!((header.producer_run.as_str(), header.width, header.height), (run2.to_string().as_str(), 960, 540));
    assert_ne!(producer.effective_capture().unwrap().version, proven_before, "the requested size proves Low");
    assert_eq!(producer.current_run().await, Some(run2));
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 0);
}

/// Class S: the first frame after the fresh start still carries the RETIRED native session id.
/// It must not become the run's native session (the real session's frames would then abort the
/// run as an unplanned native restart); it is ACKed and dropped.
#[tokio::test]
async fn capture_switch_drops_first_frame_of_retired_native_session() {
    let (producer, mut cdp, run2, _) = switched_to_low(7).await;
    let mut frames = producer.subscribe_frames();

    cdp.push.send(screencast_frame_event_sized(7, 960, 540)).unwrap();
    assert!(
        timeout(Duration::from_millis(600), frames.recv()).await.is_err(),
        "a frame of the retired native session must not be published under the fresh run"
    );
    assert_eq!(acked_native_ids(&drain_commands(&mut cdp)), vec![7], "the stale frame is ACKed exactly once");

    cdp.push.send(screencast_frame_event_sized(8, 960, 540)).unwrap();
    let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert_eq!(frame.header().unwrap().producer_run, run2.to_string());
    sleep(Duration::from_millis(300)).await;
    assert_eq!(producer.current_run().await, Some(run2), "the real session must not abort the run");
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 0);
    assert_eq!(producer.effective_capture().unwrap().scale_permille, 750);
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
async fn explicit_stop_reports_native_failure_and_retires_run() {
    let (producer, _cdp, _sub) = streaming_producer(Faults { fail_stop: true, ..Faults::default() }, 60).await;
    assert!(producer.stop_screencast().await.is_err(), "native stop failure must not report success");
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert_eq!(producer.current_run().await, None);
    assert_eq!(producer.audio_source_run(), None);
    assert!(producer.ensure_page_session().await.is_err(), "ambiguous session must not be reused");
    producer.stop_screencast().await.expect("a retry closes the ambiguous actor");
    assert!(producer.cdp_client.is_closed());
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

/// C3-W1: the fresh-audio boundary is a coherent (source, sequence) pair. A viewer reopened while NO
/// audio source is live must not carry the previous source's sequence into the next source.
#[tokio::test]
async fn reopen_without_a_live_audio_source_does_not_suppress_the_next_source() {
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let run1 = producer.audio_source_run().expect("audio source");
    let doc = producer.audio_doc_epoch();
    let pcm = B64.encode([0x12u8, 0x34, 0x56, 0x78]);
    assert!(producer.set_viewer_muted(&sub, false));
    for expected in ["1", "2", "3"] {
        let c = producer.admit_and_broadcast_audio_chunk(run1, doc, &pcm).await.expect("chunk");
        assert_eq!(c.audio_seq, expected);
    }
    let (_, _, wm_open) = producer.viewer_audio_gate_info(&sub).unwrap();
    assert_eq!((wm_open.source_run, wm_open.seq), (Some(run1), 0), "boundary of the live source at the first open");

    // Genuine stop ends the source; the retained viewer closes and reopens in the gap.
    producer.stop_screencast().await.expect("stop");
    assert_eq!(producer.audio_source_run(), None);
    assert!(producer.set_viewer_muted(&sub, true));
    assert!(producer.set_viewer_muted(&sub, false));
    let (_, _, wm_gap) = producer.viewer_audio_gate_info(&sub).unwrap();
    assert_eq!(wm_gap.seq, 0, "no live source: nothing was broadcast, so nothing may be suppressed later");

    producer.start_screencast_run().await.expect("restart");
    let run2 = producer.audio_source_run().expect("fresh audio source");
    assert_ne!(run1, run2);
    let (gate, gen, wm) = producer.viewer_audio_gate_info(&sub).unwrap();
    assert!(gate.is_allowed());
    let first = producer.admit_and_broadcast_audio_chunk(run2, doc, &pcm).await.expect("first chunk of new source");
    assert_eq!(first.audio_seq, "1", "sequence is scoped to its own source");
    assert!(!wm.suppresses(Some(run2), 1), "stale previous-source sequence must not suppress the new source");
    assert!(
        dam_hopper_server::browser_host::media::audio_chunk_admissible(&producer, &sub, gen, 1, &run2.to_string(), doc),
        "the first chunk of the restarted source is deliverable to the retained subscription"
    );
}

/// C3-W1: every queued slot is judged by its OWN admitted generation and sequence under one
/// consistent controller state; reopening never lets an older slot inherit a fresher generation.
#[tokio::test]
async fn audio_slots_are_validated_against_their_own_generation_and_sequence() {
    use dam_hopper_server::browser_host::media::audio_chunk_admissible;
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let run = producer.audio_source_run().unwrap();
    let run_s = run.to_string();
    let doc = producer.audio_doc_epoch();
    let pcm = B64.encode([0x12u8, 0x34, 0x56, 0x78]);
    assert!(producer.set_viewer_muted(&sub, false));
    let g1 = producer.viewer_audio_generation(&sub).unwrap();
    for _ in 0..4 {
        producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk");
    }
    // Slot A: dequeued under g1 as seq 4.
    assert!(audio_chunk_admissible(&producer, &sub, g1, 4, &run_s, doc));
    // Suppress then reopen while A is still queued; the boundary is sampled at the reopen (seq 4).
    assert!(producer.set_viewer_muted(&sub, true));
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 5 while closed");
    assert!(producer.set_viewer_muted(&sub, false));
    let g3 = producer.viewer_audio_generation(&sub).unwrap();
    assert_ne!(g1, g3);
    assert!(!audio_chunk_admissible(&producer, &sub, g1, 4, &run_s, doc), "old slot keeps its old generation");
    assert!(!audio_chunk_admissible(&producer, &sub, g3, 5, &run_s, doc), "sequence at/below the boundary is withheld");
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 6");
    assert!(audio_chunk_admissible(&producer, &sub, g3, 6, &run_s, doc), "post-boundary chunk with the fresh generation");
    assert!(!audio_chunk_admissible(&producer, &sub, g1, 6, &run_s, doc), "a fresh sequence never revives an old generation");
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

    // Stream quality event during switching MUST retain the applied version (2), NEVER falling back
    // to the native snapshot version 1.
    let q3 = producer.stream_quality_event(&sub).await;
    assert_eq!(q3.status, StreamQualityStatus::Switching);
    assert_eq!(q3.capture_version, "2", "switching advertises the retained applied version");

    // Convergence to v3 never lowers the advertised version along the way.
    let mut last = 2u64;
    let mut converged = None;
    for _ in 0..30 {
        sleep(Duration::from_millis(150)).await;
        cdp.push.send(screencast_frame_event(1)).unwrap();
        let _ = timeout(Duration::from_millis(600), frames.recv()).await;
        let q = producer.stream_quality_event(&sub).await;
        let current: u64 = q.capture_version.parse().expect("valid version number");
        assert!(current >= last, "advertised applied version must never decrease ({last} -> {current})");
        last = current;
        if q.status == StreamQualityStatus::Effective {
            converged = Some(q);
            break;
        }
    }
    let q4 = converged.expect("governor FPS 2 converges to effective");
    assert_eq!(q4.capture_version, "3");
}

/// C3-W4: the governor-only policy notification raises the advertised applied version without
/// any frame; that is an event-affecting mutation and must advance the revision too.
#[tokio::test]
async fn governor_only_policy_change_advances_the_applied_floor_with_a_revision_bump() {
    let (producer, mut cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let mut frames = producer.subscribe_frames();
    cdp.push.send(screencast_frame_event(1)).unwrap();
    timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let proven = producer.stream_quality_event(&sub).await;
    assert_eq!((proven.status, proven.capture_version.as_str()), (StreamQualityStatus::Effective, "1"));
    let rev_before = producer.quality_revision();

    let med_stage = producer.capture_state().ladder().anchor(CaptureTier::Medium);
    let snap = producer.capture_state().publish(med_stage, 6).expect("governor-only target");
    assert_eq!(snap.version, 2);

    let mut advanced = false;
    for _ in 0..80 {
        if producer.quality_revision() > rev_before {
            advanced = true;
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert!(advanced, "the run task's applied-floor advance must bump the revision");
    let after = producer.stream_quality_event(&sub).await;
    assert_eq!(after.capture_version, "2", "no frame needed: the floor already carries target v2");
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

fn geometry_of(width: f64, height: f64) -> TargetGeometry {
    TargetGeometry {
        css_width: width, css_height: height, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
        page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
    }
}

/// C3-W4: a successful geometry change alters the warming placeholder's image bounds, so it MUST
/// advance the quality revision (otherwise an unchanged digest hides the new event).
#[tokio::test]
async fn geometry_only_change_bumps_revision_and_updates_the_warming_event() {
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let before = producer.stream_quality_event(&sub).await;
    assert_eq!(before.status, StreamQualityStatus::Warming, "no native frame yet: placeholder bounds");
    assert_eq!((before.image_width, before.image_height), (1280, 720));
    let rev_before = producer.quality_revision();

    producer.update_geometry(geometry_of(640.0, 360.0), 2).await.expect("geometry change");

    let after = producer.stream_quality_event(&sub).await;
    assert_eq!(after.status, StreamQualityStatus::Warming);
    assert_eq!((after.image_width, after.image_height), (640, 360), "placeholder follows geometry");
    assert!(
        producer.quality_revision() > rev_before,
        "a committed geometry change must advance the revision the digest dedupes on"
    );

    // An identical request is a no-op and must stay quiet.
    let rev_settled = producer.quality_revision();
    producer.update_geometry(geometry_of(640.0, 360.0), 2).await.expect("no-op geometry");
    assert_eq!(producer.quality_revision(), rev_settled, "no-op geometry must not bump");
}

/// C3-W4: a run that appears while warming and then disappears because its start failed is a
/// second event-affecting transition; both must be versioned.
#[tokio::test]
async fn failed_start_run_disappearance_bumps_revision() {
    let cdp = start_recording_cdp(Faults { fail_start_from: Some(0), ..Faults::default() }).await;
    let client = CdpClient::connect(&cdp.url).await.expect("connect mock cdp");
    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client,
        "PAGE-TARGET-FAILED-START".to_string(),
        geometry_of(1280.0, 720.0),
    )
    .with_capture_policy(24, 75);
    producer.ensure_page_session().await.expect("page session");
    let rev_before = producer.quality_revision();
    assert!(producer.start_screencast_run().await.is_err(), "startScreencast is rejected");
    assert_eq!(producer.current_run().await, None, "the failed run disappeared");
    assert!(
        producer.quality_revision() >= rev_before + 2,
        "run appearance AND disappearance are both versioned (was {rev_before}, now {})",
        producer.quality_revision()
    );
    let sub = Uuid::new_v4().to_string();
    let q = producer.stream_quality_event(&sub).await;
    assert_eq!(q.status, StreamQualityStatus::Warming);
    assert_eq!(q.producer_run, Uuid::nil().to_string(), "no run: nil placeholder");
}

/// C3-W4: a mutation in flight while an event is constructed is never observed as a stable
/// snapshot: the reader waits for it, reports the committed revision, and a mutation that never
/// settles yields an explicitly unstable (non-memoizable) snapshot instead of a torn "stable" one.
#[tokio::test]
async fn event_snapshot_waits_for_in_flight_mutations_and_reports_unstable_when_they_persist() {
    let (producer, _cdp, sub) = streaming_producer(Faults::default(), 75).await;
    let quiet = producer.stream_quality_snapshot(&sub).await;
    assert_eq!(quiet.revision, Some(producer.quality_revision()), "quiescent read is stable");

    // A mutation that commits during construction: the snapshot is taken after it settles.
    let settled_before = producer.quality_revision();
    let guard = producer.begin_quality_mutation();
    let (snapshot, ()) = tokio::join!(producer.stream_quality_snapshot(&sub), async {
        sleep(Duration::from_millis(3)).await;
        drop(guard);
    });
    assert_eq!(snapshot.revision, Some(settled_before + 1), "reported revision is the post-mutation one");
    assert_eq!(snapshot.revision, Some(producer.quality_revision()));

    // A mutation that outlasts every retry: honest "unstable", so the caller must not memoize it.
    let stuck = producer.begin_quality_mutation();
    let unstable = producer.stream_quality_snapshot(&sub).await;
    assert_eq!(unstable.revision, None, "never a falsely stable revision while a writer is in flight");
    assert_eq!(unstable.event.status, StreamQualityStatus::Warming, "conservative placeholder, not a torn proof");
    drop(stuck);
    assert!(producer.stream_quality_snapshot(&sub).await.revision.is_some());
}

// ---------------------------------------------------------------------------------------------
// Geometry authority (SI-01 / SI-04): native evidence gates pointer trust; start/resize converge.
// ---------------------------------------------------------------------------------------------

fn frame_event_with_metadata(native_id: i64, width: f64, height: f64, page_scale: f64) -> Value {
    json!({"method": "Page.screencastFrame", "sessionId": "MOCK-PAGE-SESSION", "params": {
        "sessionId": native_id, "data": B64.encode(dummy_jpeg_64()),
        "metadata": {"offsetTop": 0.0, "pageScaleFactor": page_scale, "deviceWidth": width,
                     "deviceHeight": height, "scrollOffsetX": 0.0, "scrollOffsetY": 0.0, "timestamp": 1.0}
    }})
}

#[tokio::test]
async fn native_frame_metadata_divergence_revokes_input_trust_and_agreement_restores_it() {
    let (producer, cdp, _sub) = streaming_producer(Faults::default(), 60).await;
    let mut frames = producer.subscribe_frames();
    let mut next = |id: i64, w: f64, h: f64, scale: f64| {
        cdp.push.send(frame_event_with_metadata(id, w, h, scale)).unwrap();
    };

    // Native viewport equals the producer basis (1280x720, no zoom): trusted.
    next(1, 1280.0, 720.0, 1.0);
    let agreed = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert!(agreed.header().unwrap().input_trusted);
    assert!(producer.input_geometry_trusted());

    // Native reports a different CSS viewport: no guessed projection, display-only, and visible.
    next(1, 800.0, 600.0, 1.0);
    let diverged = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let header = diverged.header().unwrap();
    assert!(!header.input_trusted, "diverging native size must not be input-trusted");
    assert_eq!((header.geometry.css_width, header.geometry.css_height), (800.0, 600.0));
    assert!(!producer.input_geometry_trusted(), "server-side dispatch gate follows the evidence");

    // Page zoom is unexpected geometry too, even at the right size.
    next(1, 1280.0, 720.0, 2.0);
    let zoomed = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert!(!zoomed.header().unwrap().input_trusted);

    // A confirming native frame restores trust.
    next(1, 1280.0, 720.0, 1.0);
    let restored = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert!(restored.header().unwrap().input_trusted);
    assert!(producer.input_geometry_trusted());
}

/// Mock CDP that withholds the first `Emulation.setDeviceMetricsOverride` response until released,
/// recording every command so interleavings can be asserted.
struct GatedCdp {
    url: String,
    commands: Arc<std::sync::Mutex<Vec<Value>>>,
    release: Arc<tokio::sync::Notify>,
}

async fn start_gated_cdp() -> GatedCdp {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let commands = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let release = Arc::new(tokio::sync::Notify::new());
    let (log, gate) = (commands.clone(), release.clone());
    tokio::spawn(async move {
        let Ok((stream, _)) = listener.accept().await else { return };
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        let mut held: Option<Value> = None;
        loop {
            tokio::select! {
                _ = gate.notified(), if held.is_some() => {
                    let reply = held.take().unwrap();
                    if ws.send(Message::Text(reply.to_string().into())).await.is_err() { break; }
                }
                incoming = ws.next() => {
                    let Some(Ok(Message::Text(text))) = incoming else { break };
                    let cmd: Value = serde_json::from_str(&text).unwrap();
                    let reply = if cmd["method"] == "Target.attachToTarget" {
                        json!({"id": cmd["id"], "result": {"sessionId": "MOCK-PAGE-SESSION"}})
                    } else {
                        json!({"id": cmd["id"], "result": {}})
                    };
                    let hold_this = cmd["method"] == "Emulation.setDeviceMetricsOverride"
                        && !log.lock().unwrap().iter().any(|c| c["method"] == "Emulation.setDeviceMetricsOverride");
                    log.lock().unwrap().push(cmd);
                    if hold_this {
                        held = Some(reply);
                    } else if ws.send(Message::Text(reply.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
    GatedCdp { url: format!("ws://{addr}"), commands, release }
}

fn overrides(cdp: &GatedCdp) -> Vec<Value> {
    cdp.commands.lock().unwrap().iter()
        .filter(|c| c["method"] == "Emulation.setDeviceMetricsOverride").cloned().collect()
}

#[tokio::test]
async fn concurrent_start_and_resize_progress_and_native_matches_producer_geometry() {
    let cdp = start_gated_cdp().await;
    let client = CdpClient::connect(&cdp.url).await.expect("connect mock cdp");
    let initial = TargetGeometry {
        css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
        page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
    };
    let producer = Arc::new(ScreencastProducer::new(
        Uuid::new_v4().to_string(), Uuid::new_v4().to_string(), 1, 1,
        client, "PAGE-TARGET-RACE".to_string(), initial.clone(),
    ));

    // Visible demand starts the run (and keeps it alive); the start is paused inside page-session
    // setup, after it read the 1280x900 geometry.
    producer.register_viewer_demand("viewer", &Uuid::new_v4().to_string(), true).await;
    for _ in 0..200 {
        if overrides(&cdp).len() == 1 { break; }
        sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(overrides(&cdp).len(), 1, "start must reach the paused native metrics command");

    let resized = TargetGeometry { css_width: 800.0, css_height: 600.0, ..initial };
    let resizing = producer.clone();
    let resize = tokio::spawn(async move { resizing.update_geometry(resized, 2).await });
    sleep(Duration::from_millis(250)).await;
    assert!(!resize.is_finished(), "resize is ordered behind the in-flight start, not racing its state");
    assert_eq!(producer.viewport_epoch(), 1, "nothing is committed while the start is paused");

    cdp.release.notify_one();
    timeout(Duration::from_secs(5), resize).await.expect("resize progresses").unwrap().expect("resize ok");

    // Producer geometry/epoch and the LAST native metrics command agree (no half-applied start).
    let applied = overrides(&cdp);
    let last = applied.last().unwrap();
    assert_eq!((last["params"]["width"].as_u64(), last["params"]["height"].as_u64()), (Some(800), Some(600)));
    let geometry = producer.geometry().await;
    assert_eq!((geometry.css_width, geometry.css_height), (800.0, 600.0));
    assert_eq!(producer.viewport_epoch(), 2);
    assert!(producer.input_geometry_trusted());
    assert_eq!(producer.state().await, ScreencastState::Streaming);
    // The streaming run was restarted at the new size after the first start completed.
    let starts: Vec<Value> = cdp.commands.lock().unwrap().iter()
        .filter(|c| c["method"] == "Page.startScreencast").cloned().collect();
    assert_eq!(starts.len(), 2, "{starts:?}");
    assert_eq!(starts[0]["params"]["maxWidth"], 1280);
    assert_eq!(starts[1]["params"]["maxWidth"], 800);
}

/// Real Chromium: a raw flattened-session resize is fenced before it is relayed, old-epoch input
/// is rejected, a confirming native frame restores trust, and a center click (u=v=0.5) lands on
/// the DOM-observed center of the displayed native viewport.
#[tokio::test]
async fn real_raw_resize_fences_epoch_and_center_click_lands_at_native_center() {
    use chromiumoxide_cdp::cdp::browser_protocol::target::AttachToTargetParams;
    use dam_hopper_server::api::browser_host::{
        get_or_create_input_manager, get_or_register_producer, global_session_registry,
    };
    use dam_hopper_server::browser_host::input::{
        InputError, InputEvent, InputMessage, MouseButton,
    };
    use dam_hopper_server::browser_host::media::dispatch_input_event_to_cdp;
    use dam_hopper_server::browser_host::raw_geometry_fence::handle_client_cdp_message;
    use dam_hopper_server::browser_host::raw_session_targets::RawSessionTargets;
    use dam_hopper_server::browser_host::session::{
        BindOutcome, CreateParams, CreateReservation, CreateSessionRequest, ViewportRequest,
    };

    let Some(exec) = require_browser_executable() else { return };
    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("raw-resize-data"));
    config.executable_path = Some(exec);
    config.headless = true;
    let mut process = BrowserProcess::launch(config).await.expect("browser launch failed");
    let ws_url = process.ws_endpoint().to_string();
    let client = CdpClient::connect(&ws_url).await.expect("producer CDP client");
    let target_id: String = client
        .send_typed(CreateTargetParams::builder().url("about:blank").build().unwrap(), None)
        .await
        .expect("Target.createTarget")
        .target_id
        .into();

    // Managed session bound to the real native page.
    let principal = "real-raw-resize-user";
    let incarnation = Uuid::new_v4().to_string();
    let registry = global_session_registry();
    let request = CreateSessionRequest {
        creation_key: Uuid::new_v4().to_string(),
        url: "about:blank".to_string(),
        viewport: ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
    };
    let CreateReservation::Pending { session_id } = registry
        .reserve_creation(
            &CreateParams {
                principal, is_dev: false, browser_incarnation: &incarnation, profile_epoch: 1,
                request: &request, allowed_origins: &[], max_targets: usize::MAX,
            },
            &|| true,
        )
        .await
        .unwrap()
    else {
        panic!("fresh creation must reserve");
    };
    assert_eq!(registry.bind_native_target(&session_id, &incarnation, &target_id).await, BindOutcome::Bound);
    registry.commit_running(&session_id, &|| true).await.unwrap();
    let producer = Arc::new(ScreencastProducer::new(
        session_id.clone(), incarnation.clone(), 1, 1, client.clone(), target_id.clone(),
        TargetGeometry {
            css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
            page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
        },
    ));
    get_or_register_producer(&session_id, producer.clone()).await;
    let page_sid = producer.ensure_page_session().await.expect("page session");

    // DOM oracle: record mousedown client coordinates; keep repainting so native frames flow.
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({ "expression": "document.documentElement.style.margin='0';document.body.style.margin='0';\
                document.body.style.minHeight='100vh';window.__clicks=[];\
                document.addEventListener('mousedown',e=>window.__clicks.push([e.clientX,e.clientY]),true);\
                setInterval(()=>{document.body.style.background='#'+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')},30);" })),
            Some(&page_sid),
        )
        .await
        .expect("install DOM oracle");

    let mut frames = producer.subscribe_frames();
    producer.register_viewer_demand("viewer-1", &Uuid::new_v4().to_string(), true).await;
    let initial = timeout(Duration::from_secs(10), frames.recv()).await.expect("first frame").unwrap();
    let initial_header = initial.header().unwrap().clone();
    assert_eq!(initial_header.viewport_epoch, "1");
    assert!(initial_header.input_trusted, "initial native viewport agrees with requested geometry");

    let input = get_or_create_input_manager(&session_id).await;
    let (lease_token, _) = input.acquire_lease("viewer-1", "human").await.unwrap();
    input.set_expected_viewport_epoch(1).await;

    // A raw agent attaches to the page with a flattened session and resizes it.
    let agent = CdpClient::connect(&ws_url).await.expect("agent CDP client");
    let attach = agent
        .send_typed(AttachToTargetParams::builder().target_id(target_id.clone()).flatten(true).build().unwrap(), None)
        .await
        .expect("agent attach");
    let agent_sid: String = attach.session_id.into();
    let mut targets = RawSessionTargets::new(None);
    handle_client_cdp_message(
        &json!({"id": 5, "method": "Target.attachToTarget", "params": {"targetId": target_id, "flatten": true}}).to_string(),
        principal, false, &mut targets,
    ).await;
    targets.observe_upstream(&json!({"id": 5, "result": {"sessionId": agent_sid}}).to_string());

    let (new_w, new_h) = (800u32, 600u32);
    let raw = json!({"id": 7, "sessionId": agent_sid, "method": "Emulation.setDeviceMetricsOverride",
        "params": {"width": new_w, "height": new_h, "deviceScaleFactor": 1.0, "mobile": false}});
    handle_client_cdp_message(&raw.to_string(), principal, false, &mut targets).await;

    // Fenced before the command is relayed: epoch advanced, old-epoch input rejected, projection untrusted.
    assert_eq!(registry.get_session(&session_id, principal).await.unwrap().viewport_epoch, "2");
    assert_eq!(producer.viewport_epoch(), 2);
    assert!(!producer.input_geometry_trusted());
    let stale = input
        .enqueue_input(InputMessage {
            browser_session_id: session_id.clone(), browser_incarnation: incarnation.clone(),
            profile_epoch: 1, subscription_epoch: "sub".to_string(), lease_token: lease_token.clone(),
            input_seq: 1, viewport_epoch: 1,
            event: InputEvent::PointerDown { button: MouseButton::Left, u: 0.5, v: 0.5, modifiers: 0 },
        })
        .await;
    assert!(matches!(stale, Err(InputError::StaleViewportEpoch { expected: 2, actual: 1 })), "{stale:?}");

    // The relay now forwards the raw command to the browser.
    agent
        .send_command("Emulation.setDeviceMetricsOverride", Some(raw["params"].clone()), Some(&agent_sid))
        .await
        .expect("raw metrics override");

    // A native frame from the new epoch whose metadata matches restores trust.
    let confirmed = loop {
        let frame = timeout(Duration::from_secs(15), frames.recv())
            .await
            .expect("native frame confirming the raw resize")
            .unwrap();
        let header = frame.header().unwrap().clone();
        if header.viewport_epoch == "2" && header.input_trusted {
            break header;
        }
    };
    assert_eq!((confirmed.geometry.css_width, confirmed.geometry.css_height), (new_w as f64, new_h as f64));
    assert!(producer.input_geometry_trusted());

    // Center click through the production projection lands at the displayed native center.
    let geometry = producer.geometry().await;
    for event in [
        InputEvent::PointerDown { button: MouseButton::Left, u: 0.5, v: 0.5, modifiers: 0 },
        InputEvent::PointerUp { button: MouseButton::Left, u: 0.5, v: 0.5, modifiers: 0 },
    ] {
        dispatch_input_event_to_cdp(&producer.cdp_client, &page_sid, &geometry, &event).await;
    }
    let clicks = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({ "expression": "JSON.stringify(window.__clicks)", "returnByValue": true })),
            Some(&page_sid),
        )
        .await
        .expect("read DOM oracle");
    let clicks: Vec<Vec<f64>> = serde_json::from_str(clicks["result"]["value"].as_str().unwrap()).unwrap();
    assert_eq!(clicks.len(), 1, "{clicks:?}");
    assert!((clicks[0][0] - new_w as f64 / 2.0).abs() <= 1.0, "x {:?}", clicks);
    assert!((clicks[0][1] - new_h as f64 / 2.0).abs() <= 1.0, "y {:?}", clicks);

    let _ = process.terminate().await;
}

// ---------------------------------------------------------------------------------------------
// Run abort and recovery (SI-06): bounded prompt ACKs, fatal ambiguity, fresh run/session/actor.
// ---------------------------------------------------------------------------------------------
use dam_hopper_server::browser_host::screencast::RecoveryPolicy;
use std::sync::atomic::AtomicBool;

/// Scriptable CDP peer: accepts any number of connections (a reconnect dials again), answers
/// every command, mints a distinct Page session id per attach and can withhold or fail ACK
/// responses, fail attaches and drop the live connection.
struct ScriptShared {
    commands: std::sync::Mutex<Vec<(usize, Value)>>,
    connections: AtomicUsize,
    attaches: AtomicUsize,
    block_acks: AtomicBool,
    block_detach: AtomicBool,
    block_stop: AtomicBool,
    block_start: AtomicBool,
    garble_stop: AtomicBool,
    fail_stop: AtomicBool,
    /// While non-zero, `Emulation.setDeviceMetricsOverride` with this width gets no answer.
    block_emu_width: AtomicUsize,
    fail_detach: AtomicBool,
    block_attach_only: AtomicUsize,
    /// Remaining ACK responses to fail (`usize::MAX` = all of them).
    fail_acks: AtomicUsize,
    /// Attach ordinals at or beyond this fail (`usize::MAX` = none).
    fail_attach_from: AtomicUsize,
    /// Exactly this attach ordinal fails (`usize::MAX` = none).
    fail_attach_only: AtomicUsize,
    live: std::sync::Mutex<Option<(mpsc::UnboundedSender<Value>, mpsc::UnboundedSender<()>)>>,
}

struct ScriptedCdp {
    url: String,
    shared: Arc<ScriptShared>,
    _server: tokio::task::JoinHandle<()>,
}

fn script_reply(shared: &ScriptShared, cmd: &Value) -> Option<Value> {
    let id = cmd["id"].clone();
    match cmd["method"].as_str().unwrap_or("") {
        "Page.screencastFrameAck" => {
            if shared.block_acks.load(Ordering::SeqCst) {
                return None;
            }
            let remaining = shared.fail_acks.load(Ordering::SeqCst);
            if remaining > 0 {
                if remaining != usize::MAX {
                    shared.fail_acks.store(remaining - 1, Ordering::SeqCst);
                }
                return Some(json!({"id": id, "error": {"code": -32000, "message": "ack failed"}}));
            }
            Some(json!({"id": id, "result": {}}))
        }
        "Page.stopScreencast" if shared.block_stop.load(Ordering::SeqCst) => None,
        "Page.startScreencast" if shared.block_start.load(Ordering::SeqCst) => None,
        "Page.stopScreencast" if shared.garble_stop.load(Ordering::SeqCst) =>
            Some(json!({"id": id, "result": "unreadable"})),
        "Page.stopScreencast" if shared.fail_stop.load(Ordering::SeqCst) =>
            Some(json!({"id": id, "error": {"code": -32000, "message": "stop rejected"}})),
        "Emulation.setDeviceMetricsOverride"
            if shared.block_emu_width.load(Ordering::SeqCst) != 0
                && cmd["params"]["width"].as_u64()
                    == Some(shared.block_emu_width.load(Ordering::SeqCst) as u64) => None,
        "Target.detachFromTarget" if shared.block_detach.load(Ordering::SeqCst) => None,
        "Target.detachFromTarget" if shared.fail_detach.load(Ordering::SeqCst) =>
            Some(json!({"id": id, "error": {"code": -32000, "message": "detach failed"}})),
        "Target.attachToTarget" => {
            let n = shared.attaches.fetch_add(1, Ordering::SeqCst);
            if n == shared.block_attach_only.load(Ordering::SeqCst) {
                return None;
            }
            if n >= shared.fail_attach_from.load(Ordering::SeqCst)
                || n == shared.fail_attach_only.load(Ordering::SeqCst)
            {
                return Some(json!({"id": id, "error": {"code": -32000, "message": "attach failed"}}));
            }
            Some(json!({"id": id, "result": {"sessionId": format!("SESSION-{n}")}}))
        }
        _ => Some(json!({"id": id, "result": {}})),
    }
}

async fn serve_scripted_connection(
    mut ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    conn: usize,
    shared: Arc<ScriptShared>,
    mut push_rx: mpsc::UnboundedReceiver<Value>,
    mut kill_rx: mpsc::UnboundedReceiver<()>,
) {
    loop {
        tokio::select! {
            pushed = push_rx.recv() => {
                let Some(ev) = pushed else { break };
                if ws.send(Message::Text(ev.to_string().into())).await.is_err() { break; }
            }
            _ = kill_rx.recv() => break,
            incoming = ws.next() => {
                let Some(Ok(Message::Text(text))) = incoming else { break };
                let cmd: Value = serde_json::from_str(&text).unwrap();
                shared.commands.lock().unwrap().push((conn, cmd.clone()));
                if let Some(reply) = script_reply(&shared, &cmd) {
                    if ws.send(Message::Text(reply.to_string().into())).await.is_err() { break; }
                }
            }
        }
    }
}

async fn start_scripted_cdp() -> ScriptedCdp {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    let shared = Arc::new(ScriptShared {
        commands: std::sync::Mutex::new(Vec::new()),
        connections: AtomicUsize::new(0),
        attaches: AtomicUsize::new(0),
        block_acks: AtomicBool::new(false),
        block_detach: AtomicBool::new(false),
        block_stop: AtomicBool::new(false),
        block_start: AtomicBool::new(false),
        garble_stop: AtomicBool::new(false),
        fail_stop: AtomicBool::new(false),
        block_emu_width: AtomicUsize::new(0),
        fail_detach: AtomicBool::new(false),
        block_attach_only: AtomicUsize::new(usize::MAX),
        fail_acks: AtomicUsize::new(0),
        fail_attach_from: AtomicUsize::new(usize::MAX),
        fail_attach_only: AtomicUsize::new(usize::MAX),
        live: std::sync::Mutex::new(None),
    });
    let server_shared = shared.clone();
    let server = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let Ok(ws) = tokio_tungstenite::accept_async(stream).await else { continue };
            let conn = server_shared.connections.fetch_add(1, Ordering::SeqCst);
            let (push_tx, push_rx) = mpsc::unbounded_channel();
            let (kill_tx, kill_rx) = mpsc::unbounded_channel();
            *server_shared.live.lock().unwrap() = Some((push_tx, kill_tx));
            tokio::spawn(serve_scripted_connection(ws, conn, server_shared.clone(), push_rx, kill_rx));
        }
    });
    ScriptedCdp { url, shared, _server: server }
}

impl ScriptedCdp {
    fn commands(&self, method: &str) -> Vec<(usize, Value)> {
        self.shared
            .commands
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, c)| c["method"] == method)
            .cloned()
            .collect()
    }
    fn count(&self, method: &str) -> usize {
        self.commands(method).len()
    }
    fn acks_for(&self, session: &str) -> usize {
        self.commands("Page.screencastFrameAck")
            .iter()
            .filter(|(_, c)| c["sessionId"] == session)
            .count()
    }
    fn starts_for(&self, session: &str) -> usize {
        self.commands("Page.startScreencast")
            .iter()
            .filter(|(_, c)| c["sessionId"] == session)
            .count()
    }
    fn reply_to_last(&self, method: &str, result: Value) {
        let (_, command) = self.commands(method).last().cloned().expect("held command");
        let reply = json!({"id": command["id"], "result": result});
        if let Some((push, _)) = self.shared.live.lock().unwrap().as_ref() {
            let _ = push.send(reply);
        }
    }
    fn fail_last(&self, method: &str, message: &str) {
        let (_, command) = self.commands(method).last().cloned().expect("held command");
        let reply = json!({"id": command["id"], "error": {"code": -32000, "message": message}});
        if let Some((push, _)) = self.shared.live.lock().unwrap().as_ref() {
            let _ = push.send(reply);
        }
    }
    fn push_frame(&self, session: &str, native_id: i64) {
        let mut ev = screencast_frame_event(native_id);
        ev["sessionId"] = json!(session);
        if let Some((push, _)) = self.shared.live.lock().unwrap().as_ref() {
            let _ = push.send(ev);
        }
    }
    /// Drops the live connection without a close handshake: the client's actor dies.
    fn kill_connection(&self) {
        if let Some((_, kill)) = self.shared.live.lock().unwrap().as_ref() {
            let _ = kill.send(());
        }
    }
}

fn fast_policy() -> RecoveryPolicy {
    RecoveryPolicy {
        max_attempts: 3,
        base_backoff: Duration::from_millis(40),
        max_backoff: Duration::from_millis(200),
        ack_timeout: Duration::from_millis(400),
        stable_run: Duration::from_secs(60),
    }
}

/// Streaming producer over the scripted peer with one visible viewer: Page session `SESSION-0`.
async fn scripted_producer(cdp: &ScriptedCdp, policy: RecoveryPolicy) -> (ScreencastProducer, String) {
    let client = CdpClient::connect(&cdp.url).await.expect("connect scripted cdp");
    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client,
        "PAGE-TARGET-RECOVERY".to_string(),
        TargetGeometry {
            css_width: 1280.0, css_height: 720.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
            page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
        },
    )
    .with_capture_policy(24, 60)
    .with_recovery_policy(policy);
    producer.ensure_page_session().await.expect("page session");
    producer.start_screencast_run().await.expect("start run");
    let sub = Uuid::new_v4().to_string();
    producer.register_viewer_demand("viewer-recovery", &sub, true).await;
    (producer, sub)
}

async fn eventually(what: &str, within: Duration, mut check: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + within;
    while !check() {
        assert!(tokio::time::Instant::now() < deadline, "timed out waiting for: {what}");
        sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn blocked_ack_responses_never_stall_later_acks_and_expire_into_a_fresh_run() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid0 = producer.ensure_page_session().await.unwrap();
    assert_eq!(sid0, "SESSION-0");
    let run1 = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();

    // No ACK response ever arrives; every accepted frame still gets its own prompt attempt.
    cdp.shared.block_acks.store(true, Ordering::SeqCst);
    for _ in 0..3 {
        cdp.push_frame(&sid0, 7);
        sleep(Duration::from_millis(25)).await;
    }
    eventually("three ACK attempts on the wire while none was answered", Duration::from_millis(300), || {
        cdp.acks_for(&sid0) == 3
    })
    .await;
    assert_eq!(producer.ledger.acks_enqueued.load(Ordering::Relaxed), 3);
    assert_eq!(producer.ledger.acks_completed.load(Ordering::Relaxed), 0);
    assert_eq!(producer.current_run().await, Some(run1), "the ack deadline has not elapsed yet");

    // The unanswered ACK is ambiguous: old run stopped, old session detached, fresh run/session.
    let run2 = wait_for_new_run(&producer, run1).await;
    assert_ne!(run2, run1);
    let detached: Vec<Value> = cdp
        .commands("Target.detachFromTarget")
        .into_iter()
        .map(|(_, c)| c["params"]["sessionId"].clone())
        .collect();
    assert!(detached.contains(&json!(sid0)), "old Page session must be detached: {detached:?}");
    let sid1 = producer.ensure_page_session().await.unwrap();
    assert_eq!(sid1, "SESSION-1");
    assert_eq!(cdp.shared.attaches.load(Ordering::SeqCst), 2);
    assert_eq!(cdp.starts_for(&sid0), 1);
    assert_eq!(cdp.starts_for(&sid1), 1);
    assert_eq!(producer.audio_source_run(), Some(run2), "fresh audio source for the fresh run");
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 1);
    assert_eq!(producer.ledger.recoveries_succeeded.load(Ordering::Relaxed), 1);

    // Never replayed: old-run frames neither grant credit nor produce a new attempt.
    cdp.push_frame(&sid0, 7);
    sleep(Duration::from_millis(100)).await;
    assert_eq!(cdp.acks_for(&sid0), 3, "no ACK is replayed or added for the old run/session");
    eventually("every old attempt accounted for", Duration::from_secs(2), || {
        let l = &producer.ledger;
        l.acks_failed.load(Ordering::Relaxed) + l.acks_abandoned.load(Ordering::Relaxed) == 3
    })
    .await;
    assert!(producer.ledger.acks_failed.load(Ordering::Relaxed) >= 1);

    // The fresh run serves frames again.
    cdp.shared.block_acks.store(false, Ordering::SeqCst);
    cdp.push_frame(&sid1, 3);
    let frame = loop {
        // Run-1 frames published before the abort may still be queued for this subscriber.
        let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
        if frame.header().unwrap().producer_run == run2.to_string() {
            break frame;
        }
    };
    assert_eq!(frame.header().unwrap().producer_run, run2.to_string());
    eventually("fresh run frame ACKed once", Duration::from_secs(1), || cdp.acks_for(&sid1) == 1).await;
}

#[tokio::test]
async fn ambiguous_detach_reconnects_before_replacement_attach() {
    for withhold in [false, true] {
        let cdp = start_scripted_cdp().await;
        let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
        let sid = producer.ensure_page_session().await.unwrap();
        let run = producer.current_run().await.unwrap();
        cdp.shared.block_detach.store(withhold, Ordering::SeqCst);
        cdp.shared.fail_detach.store(!withhold, Ordering::SeqCst);
        cdp.shared.fail_acks.store(1, Ordering::SeqCst);
        cdp.push_frame(&sid, 5);
        wait_for_new_run(&producer, run).await;

        let attaches = cdp.commands("Target.attachToTarget");
        let detaches = cdp.commands("Target.detachFromTarget");
        assert_eq!(attaches.len(), 2);
        assert_eq!(detaches.len(), 1);
        assert_eq!(detaches[0].0, attaches[0].0);
        assert_ne!(attaches[1].0, attaches[0].0, "ambiguous detach must close the actor");
        assert_eq!(cdp.starts_for(&sid), 1);
        assert_eq!(cdp.starts_for("SESSION-1"), 1);
    }
}

#[tokio::test]
async fn timed_out_attach_closes_its_actor_before_retry() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid = producer.ensure_page_session().await.unwrap();
    cdp.shared.block_attach_only.store(1, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid, 5);

    eventually("retry after unanswered attach", Duration::from_secs(20), || {
        cdp.count("Target.attachToTarget") >= 3
    }).await;
    let attaches = cdp.commands("Target.attachToTarget");
    assert_eq!(attaches[0].0, attaches[1].0);
    assert_ne!(attaches[1].0, attaches[2].0, "unknown attached session requires a new actor");
    assert_eq!(cdp.starts_for("SESSION-1"), 0);
    eventually("replacement run", Duration::from_secs(3), || cdp.starts_for("SESSION-2") == 1).await;
}

#[tokio::test]
async fn explicit_stop_during_detach_does_not_restart_recovery() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    let sid = producer.ensure_page_session().await.unwrap();
    cdp.shared.block_detach.store(true, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid, 5);
    eventually("blocked detach", Duration::from_secs(3), || {
        cdp.count("Target.detachFromTarget") == 1
    })
    .await;
    let stopping = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.stop_screencast().await })
    };
    timeout(Duration::from_secs(5), stopping).await.unwrap().unwrap().unwrap();
    sleep(Duration::from_millis(250)).await;
    assert_eq!(cdp.count("Target.attachToTarget"), 1);
    assert_eq!(cdp.count("Page.startScreencast"), 1);
    assert_eq!(producer.current_run().await, None);
}

#[tokio::test]
async fn stop_is_responsive_during_recovery_detach_and_cannot_restart() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    let sid = producer.ensure_page_session().await.unwrap();
    cdp.shared.block_detach.store(true, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid, 5);
    eventually("held recovery detach", Duration::from_secs(3), || {
        cdp.count("Target.detachFromTarget") == 1
    }).await;

    timeout(Duration::from_millis(500), producer.stop_screencast())
        .await.expect("stop must not wait for the held CDP response").unwrap();
    cdp.reply_to_last("Target.detachFromTarget", json!({}));
    eventually("cancelled recovery cleanup", Duration::from_secs(3), || !producer.recovery_pending()).await;
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert_eq!(producer.current_run().await, None);
    assert_eq!(cdp.count("Target.attachToTarget"), 1);
    assert_eq!(cdp.count("Page.startScreencast"), 1);
}

#[tokio::test]
async fn held_native_stop_retires_audio_before_reply() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    assert!(producer.audio_source_run().is_some());
    cdp.shared.block_stop.store(true, Ordering::SeqCst);
    let stopping = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.stop_screencast().await })
    };
    eventually("held native stop", Duration::from_secs(3), || {
        cdp.count("Page.stopScreencast") == 1
    }).await;
    assert_eq!(producer.audio_source_run(), None);
    assert_eq!(producer.current_run().await, None);
    cdp.reply_to_last("Page.stopScreencast", json!({}));
    timeout(Duration::from_secs(3), stopping).await.unwrap().unwrap().unwrap();
}

#[tokio::test]
async fn cancelled_native_stop_closes_ambiguous_session_on_retry() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    cdp.shared.block_stop.store(true, Ordering::SeqCst);
    let stopping = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.stop_screencast().await })
    };
    eventually("held native stop", Duration::from_secs(3), || {
        cdp.count("Page.stopScreencast") == 1
    }).await;
    stopping.abort();
    assert!(stopping.await.unwrap_err().is_cancelled());
    assert_eq!(producer.audio_source_run(), None);
    timeout(Duration::from_secs(3), producer.stop_screencast()).await.unwrap().unwrap();
    assert!(producer.cdp_client.is_closed());
    assert_eq!(producer.state().await, ScreencastState::Stopped);
}

#[tokio::test]
async fn stop_cancels_start_queued_behind_recovery_detach() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid = producer.ensure_page_session().await.unwrap();
    cdp.shared.block_detach.store(true, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid, 5);
    eventually("held recovery detach", Duration::from_secs(3), || {
        cdp.count("Target.detachFromTarget") == 1
    }).await;

    let start = producer.start_screencast_run();
    tokio::pin!(start);
    tokio::select! {
        result = &mut start => panic!("start unexpectedly completed during detach: {result:?}"),
        _ = sleep(Duration::from_millis(50)) => {}
    }
    timeout(Duration::from_millis(500), producer.stop_screencast()).await.unwrap().unwrap();
    cdp.reply_to_last("Target.detachFromTarget", json!({}));
    assert!(timeout(Duration::from_secs(3), start).await.unwrap().is_err());
    eventually("cancelled recovery cleanup", Duration::from_secs(3), || !producer.recovery_pending()).await;
    assert_eq!(producer.current_run().await, None);
    assert_eq!(cdp.count("Page.startScreencast"), 1);
}

#[tokio::test]
async fn demand_loss_during_recovery_attach_prevents_publication() {
    let cdp = start_scripted_cdp().await;
    let (producer, sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid = producer.ensure_page_session().await.unwrap();
    cdp.shared.block_attach_only.store(1, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid, 5);
    eventually("held replacement attach", Duration::from_secs(3), || {
        cdp.shared.attaches.load(Ordering::SeqCst) == 2
    }).await;

    timeout(Duration::from_millis(500), producer.remove_viewer_demand(&sub))
        .await.expect("demand removal must not wait for native setup");
    timeout(Duration::from_millis(500), producer.state())
        .await.expect("producer state must remain responsive during native setup");
    cdp.reply_to_last("Target.attachToTarget", json!({"sessionId": "SESSION-1"}));
    eventually("recovery stops without demand", Duration::from_secs(3), || !producer.recovery_pending()).await;
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert_eq!(producer.current_run().await, None);
    assert_eq!(cdp.starts_for("SESSION-1"), 0);
}

#[tokio::test]
async fn recovery_revokes_previous_control_lease() {
    use dam_hopper_server::api::browser_host::get_or_create_input_manager;
    use dam_hopper_server::browser_host::input::InputError;

    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid = producer.ensure_page_session().await.unwrap();
    let old_run = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();
    cdp.push_frame(&sid, 1);
    let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    let input = get_or_create_input_manager(&frame.header().unwrap().browser_session_id).await;
    let (old_token, _) = input.acquire_lease("viewer-recovery", "human").await.unwrap();

    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid, 1);
    wait_for_new_run(&producer, old_run).await;
    assert!(matches!(input.validate_lease(&old_token).await, Err(InputError::LeaseNotFound)));
    timeout(Duration::from_secs(2), async {
        loop {
            if input.acquire_lease("viewer-recovery", "human").await.is_ok() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("control resumes after the new run is established");
}

#[tokio::test]
async fn failed_ack_aborts_the_run_and_recovers_without_replaying_old_credit() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid0 = producer.ensure_page_session().await.unwrap();
    let run1 = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);

    cdp.push_frame(&sid0, 5);
    let run2 = wait_for_new_run(&producer, run1).await;
    let sid1 = producer.ensure_page_session().await.unwrap();
    assert_ne!(sid1, sid0, "fresh dedicated Page session");
    assert_eq!(cdp.acks_for(&sid0), 1, "exactly one ACK attempt for the failed run");
    assert_eq!(producer.ledger.acks_failed.load(Ordering::Relaxed), 1);
    assert_eq!(cdp.starts_for(&sid1), 1);
    assert_eq!(producer.state().await, ScreencastState::Streaming);
    assert!(!producer.input_geometry_trusted(), "no input trust before the fresh run's first agreeing frame");

    // Old-session frames are dropped without credit; the new run ACKs its own frame once.
    cdp.push_frame(&sid0, 5);
    cdp.push_frame(&sid1, 5);
    eventually("new run ACKed", Duration::from_secs(2), || cdp.acks_for(&sid1) == 1).await;
    sleep(Duration::from_millis(150)).await;
    assert_eq!(cdp.acks_for(&sid0), 1, "old run credit is never replayed");
    assert_eq!(cdp.acks_for(&sid1), 1);
    assert_eq!(producer.current_run().await, Some(run2), "a healthy run is not restarted again");
    assert!(producer.ledger.events_dropped_old_run.load(Ordering::Relaxed) >= 1);

    // Input trust is withheld until a native frame of the fresh run agrees with the geometry.
    let frame = loop {
        let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
        if frame.header().unwrap().producer_run == run2.to_string() {
            break frame;
        }
    };
    assert!(frame.header().unwrap().input_trusted, "agreeing native metadata of the fresh run restores trust");
    assert!(producer.input_geometry_trusted());
}

#[tokio::test]
async fn ingress_overflow_is_fatal_and_recovers_with_a_fresh_run_session_and_audio_source() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid0 = producer.ensure_page_session().await.unwrap();
    let run1 = producer.current_run().await.unwrap();
    assert_eq!(producer.audio_source_run(), Some(run1));

    // Park the consumer (it observes the barrier at its next loop turn, at most one governor tick
    // away) so the 2-slot ingress overflows deterministically.
    producer.hold_frame_ingress();
    sleep(Duration::from_millis(400)).await;
    for _ in 0..6 {
        cdp.push_frame(&sid0, 9);
    }
    sleep(Duration::from_millis(150)).await;
    assert_eq!(producer.ledger.events_received.load(Ordering::Relaxed), 0, "consumer is parked");
    producer.release_frame_ingress();

    let run2 = wait_for_new_run(&producer, run1).await;
    assert_eq!(producer.ledger.ingress_lagged.load(Ordering::Relaxed), 1);
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 1);
    assert_eq!(cdp.acks_for(&sid0), 0, "stranded frames are never ACKed or replayed");
    assert_ne!(producer.ensure_page_session().await.unwrap(), sid0);
    assert_eq!(producer.audio_source_run(), Some(run2));
    assert_ne!(run2, run1);
    // Frames of the fresh run flow again after recovery.
    let mut frames = producer.subscribe_frames();
    let sid1 = producer.ensure_page_session().await.unwrap();
    cdp.push_frame(&sid1, 4);
    let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert_eq!(frame.header().unwrap().producer_run, run2.to_string());
    assert_eq!(producer.ledger.ingress_lagged.load(Ordering::Relaxed), 1, "healthy run does not lag");
}

#[tokio::test]
async fn lost_actor_reconnects_a_fresh_actor_session_and_run_and_frames_resume() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let run1 = producer.current_run().await.unwrap();
    let mut frames = producer.subscribe_frames();

    cdp.kill_connection();
    let run2 = wait_for_new_run(&producer, run1).await;
    assert_eq!(cdp.shared.connections.load(Ordering::SeqCst), 2, "a fresh actor connection was dialed");
    assert!(!producer.cdp_client.is_closed());
    let attaches = cdp.commands("Target.attachToTarget");
    assert_eq!(attaches.len(), 2);
    assert_eq!(attaches[1].0, 1, "the replacement session is attached on the new connection");
    let sid1 = producer.ensure_page_session().await.unwrap();
    assert_eq!(sid1, "SESSION-1");
    assert_eq!(cdp.starts_for(&sid1), 1);
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 1);
    assert_eq!(producer.ledger.recoveries_succeeded.load(Ordering::Relaxed), 1);
    assert_eq!(producer.audio_source_run(), Some(run2));

    cdp.push_frame(&sid1, 2);
    let frame = timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
    assert_eq!(frame.header().unwrap().producer_run, run2.to_string());
    eventually("frame ACKed on the new connection", Duration::from_secs(1), || {
        cdp.acks_for(&sid1) == 1
    })
    .await;
}

#[tokio::test]
async fn no_demand_never_restarts_and_issues_no_screenshot_polling() {
    let cdp = start_scripted_cdp().await;
    let (producer, sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid0 = producer.ensure_page_session().await.unwrap();

    // (a) Demand gone, then the actor dies: nothing to recover, nothing restarts.
    producer.remove_viewer_demand(&sub).await;
    eventually("zero-demand stop", Duration::from_secs(2), || {
        producer.ledger.zero_demand_stops.load(Ordering::Relaxed) == 1
    })
    .await;
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    cdp.kill_connection();
    sleep(Duration::from_millis(600)).await;
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert_eq!(cdp.shared.attaches.load(Ordering::SeqCst), 1);
    assert_eq!(cdp.starts_for(&sid0), 1);
    assert_eq!(cdp.count("Page.captureScreenshot"), 0);
    assert_eq!(producer.ledger.screenshot_fallbacks.load(Ordering::Relaxed), 0);
    assert_eq!(producer.ledger.recovery_attempts.load(Ordering::Relaxed), 0);

    // (b) New demand heals the dead actor through the same start path.
    producer.register_viewer_demand("viewer-back", &Uuid::new_v4().to_string(), true).await;
    eventually("demand-driven start on a fresh connection", Duration::from_secs(3), || {
        cdp.shared.connections.load(Ordering::SeqCst) == 2 && cdp.shared.attaches.load(Ordering::SeqCst) == 2
    })
    .await;
    assert_eq!(cdp.starts_for("SESSION-1"), 1);
    assert!(!producer.cdp_client.is_closed());
}

#[tokio::test]
async fn demand_that_disappears_while_recovery_backs_off_is_not_restarted() {
    let cdp = start_scripted_cdp().await;
    let policy = RecoveryPolicy { base_backoff: Duration::from_millis(500), max_backoff: Duration::from_secs(2), ..fast_policy() };
    let (producer, sub) = scripted_producer(&cdp, policy).await;
    let sid0 = producer.ensure_page_session().await.unwrap();
    let run1 = producer.current_run().await.unwrap();
    // First recovery attempt fails (attach #1) and the supervisor backs off.
    cdp.shared.fail_attach_only.store(1, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid0, 5);
    eventually("first attempt failed", Duration::from_secs(2), || {
        cdp.shared.attaches.load(Ordering::SeqCst) == 2
    })
    .await;
    assert!(producer.recovery_pending(), "supervisor is waiting out its backoff");

    producer.remove_viewer_demand(&sub).await; // pause: demand disappears
    sleep(Duration::from_millis(1200)).await;
    assert_eq!(cdp.shared.attaches.load(Ordering::SeqCst), 2, "no further attempt without demand");
    assert_eq!(cdp.count("Page.startScreencast"), 1);
    assert_eq!(cdp.count("Page.captureScreenshot"), 0, "static screenshot polling stays zero");
    assert_eq!(producer.current_run().await, None);
    assert_ne!(producer.current_run().await, Some(run1));
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert!(!producer.recovery_pending());
    assert!(!producer.recovery_unavailable(), "idle is not a failure");
}

#[tokio::test]
async fn pause_and_resume_during_recovery_start_exactly_one_fresh_run() {
    let cdp = start_scripted_cdp().await;
    let policy = RecoveryPolicy { base_backoff: Duration::from_millis(500), max_backoff: Duration::from_secs(2), ..fast_policy() };
    let (producer, sub) = scripted_producer(&cdp, policy).await;
    let sid0 = producer.ensure_page_session().await.unwrap();
    let run1 = producer.current_run().await.unwrap();
    cdp.shared.fail_attach_only.store(1, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid0, 5);
    eventually("first attempt failed", Duration::from_secs(2), || {
        cdp.shared.attaches.load(Ordering::SeqCst) == 2
    })
    .await;

    // Pause, then resume with a new viewer while the supervisor is still waiting.
    producer.remove_viewer_demand(&sub).await;
    sleep(Duration::from_millis(60)).await;
    producer.register_viewer_demand("viewer-resumed", &Uuid::new_v4().to_string(), true).await;
    let run2 = wait_for_new_run(&producer, run1).await;

    // The woken supervisor finds the run already restarted and does not start a second one.
    sleep(Duration::from_millis(1200)).await;
    assert_eq!(producer.current_run().await, Some(run2), "no extra restart");
    assert_eq!(producer.state().await, ScreencastState::Streaming);
    assert_eq!(cdp.count("Page.startScreencast"), 2, "initial run plus exactly one fresh run");
    assert_eq!(cdp.shared.attaches.load(Ordering::SeqCst), 3, "failed attempt + one successful attach");
    assert!(cdp.count("Page.captureScreenshot") <= 1, "at most the one bounded recovery screenshot");
    assert!(!producer.recovery_pending());
}

#[tokio::test]
async fn persistent_recovery_failure_is_bounded_visible_and_cleared_by_new_demand() {
    let cdp = start_scripted_cdp().await;
    let (producer, sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid0 = producer.ensure_page_session().await.unwrap();
    cdp.shared.fail_attach_from.store(1, Ordering::SeqCst);
    cdp.shared.fail_acks.store(1, Ordering::SeqCst);
    cdp.push_frame(&sid0, 5);

    eventually("recovery exhausted", Duration::from_secs(5), || producer.recovery_unavailable()).await;
    assert_eq!(cdp.shared.attaches.load(Ordering::SeqCst), 4, "initial attach + max_attempts (3) bounded attempts");
    assert_eq!(producer.ledger.recovery_attempts.load(Ordering::Relaxed), 3);
    assert_eq!(producer.ledger.recoveries_exhausted.load(Ordering::Relaxed), 1);
    let quality = producer.stream_quality_event(&sub).await;
    assert_eq!(quality.status, StreamQualityStatus::Unavailable, "visible failure, not a silent warming state");
    assert_eq!(producer.state().await, ScreencastState::Stopped);
    assert_eq!(producer.current_run().await, None);

    // No hot loop afterwards.
    sleep(Duration::from_millis(800)).await;
    assert_eq!(cdp.shared.attaches.load(Ordering::SeqCst), 4);
    assert_eq!(cdp.count("Page.startScreencast"), 1);
    assert_eq!(cdp.count("Page.captureScreenshot"), 0);

    // A healthy page plus new demand recovers visibly.
    cdp.shared.fail_attach_from.store(usize::MAX, Ordering::SeqCst);
    producer.register_viewer_demand("viewer-new", &Uuid::new_v4().to_string(), true).await;
    eventually("new demand starts a run", Duration::from_secs(3), || !producer.recovery_unavailable()).await;
    assert_ne!(producer.stream_quality_event(&sub).await.status, StreamQualityStatus::Unavailable);
    assert!(producer.current_run().await.is_some());
}

#[tokio::test]
async fn repeated_recovery_does_not_repeat_screenshot_in_same_epoch() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    eventually("initial fallback screenshot", Duration::from_secs(3), || {
        cdp.count("Page.captureScreenshot") == 1
    })
    .await;

    for _ in 0..2 {
        let old_run = producer.current_run().await.unwrap();
        let sid = producer.ensure_page_session().await.unwrap();
        cdp.shared.fail_acks.store(1, Ordering::SeqCst);
        cdp.push_frame(&sid, 5);
        wait_for_new_run(&producer, old_run).await;
        sleep(Duration::from_millis(400)).await;
    }
    assert_eq!(
        cdp.count("Page.captureScreenshot"),
        1,
        "recovery must not re-arm the screenshot allowance within one viewport epoch"
    );
}

#[tokio::test]
async fn persistently_failing_acks_cannot_spin_runs() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    cdp.shared.fail_acks.store(usize::MAX, Ordering::SeqCst);

    // Every run starts fine but its first ACK fails: bounded runs, then visibly unavailable.
    for _ in 0..300 {
        if producer.recovery_unavailable() {
            break;
        }
        if let Ok(sid) = producer.ensure_page_session().await {
            cdp.push_frame(&sid, 5);
        }
        sleep(Duration::from_millis(30)).await;
    }
    assert!(producer.recovery_unavailable(), "persistent failure must end in unavailable");
    let starts = cdp.count("Page.startScreencast");
    assert!(starts <= 4, "runs bounded by max_attempts + 1, got {starts}");
    sleep(Duration::from_millis(800)).await;
    assert_eq!(cdp.count("Page.startScreencast"), starts, "no further runs after exhaustion");
    assert_eq!(producer.state().await, ScreencastState::Stopped);
}

#[tokio::test]
async fn real_chromium_actor_loss_recovers_a_fresh_run_and_frame_marker_advances() {
    let Some((mut process, client, producer, _tmp)) = setup_producer().await else { return };
    let producer = producer.with_recovery_policy(fast_policy());
    let sid0 = producer.ensure_page_session().await.expect("page session");

    // Page-side frame marker: counts every rAF tick and repaints, so native frames keep flowing.
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({ "expression": "window.__marker=0;(function t(){window.__marker++;\
                document.body.style.background='#'+(window.__marker*40503%0xffffff).toString(16).padStart(6,'0');\
                requestAnimationFrame(t)})()" })),
            Some(&sid0),
        )
        .await
        .expect("install frame marker");

    let mut frames = producer.subscribe_frames();
    producer.register_viewer_demand("viewer-real", &Uuid::new_v4().to_string(), true).await;
    let first = timeout(Duration::from_secs(10), frames.recv()).await.expect("first frame").unwrap();
    let run1 = first.header().unwrap().producer_run.clone();
    let seq1: u64 = first.header().unwrap().frame_seq.parse().unwrap();

    // Kill the actor under the live run.
    client.close().await;
    let run2 = wait_for_new_run(&producer, Uuid::parse_str(&run1).unwrap()).await;
    assert_ne!(producer.ensure_page_session().await.unwrap(), sid0, "fresh dedicated Page session");
    assert!(!client.is_closed(), "fresh actor");

    // Production frames of the NEW run reach subscribers and advance the sequence ...
    let after = loop {
        let frame = timeout(Duration::from_secs(15), frames.recv()).await.expect("frame after recovery").unwrap();
        if frame.header().unwrap().producer_run == run2.to_string() {
            break frame;
        }
    };
    let seq2: u64 = after.header().unwrap().frame_seq.parse().unwrap();
    assert!(seq2 > seq1, "frame sequence advanced across recovery: {seq1} -> {seq2}");
    // ... and the page marker keeps advancing under the replacement session.
    let read_marker = || async {
        let sid = producer.ensure_page_session().await.unwrap();
        let v = client
            .send_command("Runtime.evaluate", Some(json!({ "expression": "window.__marker", "returnByValue": true })), Some(&sid))
            .await
            .expect("read marker");
        v["result"]["value"].as_f64().unwrap()
    };
    let m1 = read_marker().await;
    sleep(Duration::from_millis(300)).await;
    assert!(read_marker().await > m1, "page frame marker must advance after recovery");
    assert_eq!(producer.ledger.runs_aborted.load(Ordering::Relaxed), 1);
    assert_eq!(producer.ledger.recoveries_succeeded.load(Ordering::Relaxed), 1);
    assert_eq!(producer.ledger.ingress_lagged.load(Ordering::Relaxed), 0);
    let _ = producer.stop_screencast().await;
    let _ = process.terminate().await;
}

/// W4: a caller that goes away while the native start is in flight must not leave `Starting` and a
/// run id behind without drain/ACK tasks; the transition completes on its own.
#[tokio::test]
async fn dropped_start_caller_still_completes_the_transition() {
    let cdp = start_scripted_cdp().await;
    let client = CdpClient::connect(&cdp.url).await.expect("connect scripted cdp");
    let producer = Arc::new(
        ScreencastProducer::new(
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            1,
            1,
            client,
            "PAGE-TARGET-DROPPED-START".to_string(),
            TargetGeometry {
                css_width: 1280.0, css_height: 720.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
                page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
            },
        )
        .with_capture_policy(24, 60),
    );
    let sid = producer.ensure_page_session().await.expect("page session");
    cdp.shared.block_start.store(true, Ordering::SeqCst);

    let caller = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.start_screencast_run().await })
    };
    eventually("native start in flight", Duration::from_secs(3), || {
        cdp.count("Page.startScreencast") == 1
    }).await;
    // (Do not touch producer state here: the native start holds the lifecycle state lock.)
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());

    cdp.reply_to_last("Page.startScreencast", json!({}));
    let deadline = Instant::now() + Duration::from_secs(3);
    while producer.state().await != ScreencastState::Streaming {
        assert!(Instant::now() < deadline, "start never completed after its caller was dropped");
        sleep(Duration::from_millis(20)).await;
    }
    // Visible demand keeps the completed run alive past the first heartbeat.
    producer.register_viewer_demand("viewer-dropped-start", &Uuid::new_v4().to_string(), true).await;
    assert!(producer.current_run().await.is_some());
    // The run's drain/ACK tasks exist: a native frame is ACKed on the Page session.
    cdp.push_frame(&sid, 5);
    eventually("frame ACKed by the completed run", Duration::from_secs(3), || {
        cdp.acks_for(&sid) >= 1
    }).await;
}

/// W3: frames of an earlier native session are stale (dropped, no ACK); a NEWER native session
/// under the same run is an unplanned restart whose ACK obligations are unaccounted for, so the
/// run is aborted and recovered instead of silently dropping frames forever.
#[tokio::test]
async fn native_session_id_changes_drop_stale_frames_and_abort_on_newer_session() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid = producer.ensure_page_session().await.unwrap();
    let run1 = producer.current_run().await.unwrap();

    cdp.push_frame(&sid, 5); // establishes native session 5
    eventually("first frame ACKed", Duration::from_secs(3), || cdp.acks_for(&sid) == 1).await;

    cdp.push_frame(&sid, 3); // stale frame of an earlier native session
    sleep(Duration::from_millis(300)).await;
    assert_eq!(cdp.acks_for(&sid), 1, "a stale-session frame must not be ACKed");
    assert_eq!(producer.current_run().await, Some(run1), "a stale frame must not disturb the run");

    cdp.push_frame(&sid, 9); // newer native session under the same run
    let run2 = wait_for_new_run(&producer, run1).await;
    assert_ne!(run2, run1);
    assert!(producer.ledger.runs_aborted.load(Ordering::Relaxed) >= 1);
}

/// A `stop` that completes before the spawned start child first runs must still cancel that start.
/// (Current-thread runtime: one poll of the start future spawns the child but cannot run it.)
#[tokio::test]
async fn stop_completing_before_a_spawned_start_runs_still_cancels_that_start() {
    let cdp = start_scripted_cdp().await;
    let client = CdpClient::connect(&cdp.url).await.expect("connect scripted cdp");
    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client,
        "PAGE-TARGET-START-VS-STOP".to_string(),
        TargetGeometry {
            css_width: 1280.0, css_height: 720.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
            page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
        },
    )
    .with_capture_policy(24, 60);
    producer.ensure_page_session().await.expect("page session");

    let start = producer.start_screencast_run();
    tokio::pin!(start);
    tokio::select! {
        biased;
        _ = &mut start => panic!("the start must still be pending"),
        _ = std::future::ready(()) => {}
    }
    producer.stop_screencast().await.expect("stop");
    assert!(start.await.is_err(), "a start overtaken by a completed stop must not resurrect a run");
    assert_eq!(producer.current_run().await, None);
    assert_eq!(cdp.count("Page.startScreencast"), 0);
}

/// A viewer attaching while a native start is in flight must not wait for Chromium's answer
/// (the start holds the lifecycle state lock for up to the 10s command timeout).
#[tokio::test]
async fn viewer_registration_does_not_wait_behind_a_slow_native_start() {
    let cdp = start_scripted_cdp().await;
    let client = CdpClient::connect(&cdp.url).await.expect("connect scripted cdp");
    let producer = Arc::new(
        ScreencastProducer::new(
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            1,
            1,
            client,
            "PAGE-TARGET-SLOW-START".to_string(),
            geometry_of(1280.0, 720.0),
        )
        .with_capture_policy(24, 60),
    );
    producer.ensure_page_session().await.expect("page session");
    cdp.shared.block_start.store(true, Ordering::SeqCst);
    let caller = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.start_screencast_run().await })
    };
    eventually("native start in flight", Duration::from_secs(3), || {
        cdp.count("Page.startScreencast") == 1
    }).await;

    timeout(
        Duration::from_millis(500),
        producer.register_viewer_demand("late-viewer", &Uuid::new_v4().to_string(), true),
    )
    .await
    .expect("registering a viewer must not wait for the native start");

    cdp.reply_to_last("Page.startScreencast", json!({}));
    timeout(Duration::from_secs(3), caller).await.unwrap().unwrap().expect("start completes");
    assert_eq!(producer.state().await, ScreencastState::Streaming);
}

/// A native stop that gets no definite answer (here an unreadable response on a live actor) may
/// have executed: the run must be aborted into recovery, not assumed untouched.
#[tokio::test]
async fn ambiguous_native_stop_aborts_the_run_into_recovery() {
    let cdp = start_scripted_cdp().await;
    let (producer, sub) = scripted_producer(&cdp, fast_policy()).await;
    let run1 = producer.current_run().await.unwrap();
    cdp.shared.garble_stop.store(true, Ordering::SeqCst);

    request_low_and_wait_for_scaled_snapshot(&producer, &sub).await;
    let run2 = wait_for_new_run(&producer, run1).await;
    cdp.shared.garble_stop.store(false, Ordering::SeqCst);

    assert_ne!(run2, run1);
    assert!(cdp.count("Page.stopScreencast") >= 1);
    assert!(producer.ledger.runs_aborted.load(Ordering::Relaxed) >= 1);
}

/// A failed resize must not roll back over a newer raw-CDP fence that committed meanwhile.
#[tokio::test]
async fn failed_resize_does_not_overwrite_a_newer_external_fence() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    assert_eq!(cdp.count("Page.startScreencast"), 1);
    cdp.shared.block_start.store(true, Ordering::SeqCst);

    let resize = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.update_geometry(geometry_of(800.0, 600.0), 2).await })
    };
    eventually("restart start in flight", Duration::from_secs(3), || {
        cdp.count("Page.startScreencast") == 2
    }).await;

    // A raw-CDP resize fences and commits epoch 5 while the restart is still unanswered.
    let external = geometry_of(640.0, 480.0);
    producer.commit_external_geometry_fence(5, Some(external.clone())).await;
    cdp.shared.block_start.store(false, Ordering::SeqCst);
    cdp.fail_last("Page.startScreencast", "start failed");

    let err = timeout(Duration::from_secs(5), resize).await.unwrap().unwrap().unwrap_err();
    assert!(err.contains("newer geometry fence"), "unexpected error: {err}");
    assert_eq!(producer.viewport_epoch(), 5, "rollback must not regress a newer fence's epoch");
    assert_eq!(producer.geometry().await, external, "rollback must not restore the old geometry");
    assert_eq!(producer.state().await, ScreencastState::Streaming, "restarted at the newer geometry");
}

/// Number of `Emulation.setDeviceMetricsOverride` commands the peer has seen with this width.
fn emulation_width_count(cdp: &ScriptedCdp, width: u64) -> usize {
    cdp.commands("Emulation.setDeviceMetricsOverride")
        .iter()
        .filter(|(_, c)| c["params"]["width"] == width)
        .count()
}

/// An external fence that commits while the native rollback of a failed resize is in flight must
/// never be overwritten by the rollback's stale snapshot (start-failure path).
#[tokio::test]
async fn external_fence_committed_during_the_native_rollback_is_never_overwritten() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    let baseline = emulation_width_count(&cdp, 1280); // session setup already sent one
    cdp.shared.block_start.store(true, Ordering::SeqCst);
    let resize = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.update_geometry(geometry_of(800.0, 600.0), 2).await })
    };
    eventually("restart start in flight", Duration::from_secs(3), || {
        cdp.count("Page.startScreencast") == 2
    }).await;

    // Fail the start while holding the native ROLLBACK (back to the old 1280 width) in flight.
    cdp.shared.block_start.store(false, Ordering::SeqCst);
    cdp.shared.block_emu_width.store(1280, Ordering::SeqCst);
    cdp.fail_last("Page.startScreencast", "start failed");
    eventually("native rollback in flight", Duration::from_secs(3), || {
        emulation_width_count(&cdp, 1280) > baseline
    }).await;

    // A raw-CDP resize fences and commits during that await.
    let external = geometry_of(640.0, 480.0);
    producer.begin_external_geometry_fence().await;
    producer.commit_external_geometry_fence(5, Some(external.clone())).await;
    cdp.reply_to_last("Emulation.setDeviceMetricsOverride", json!({}));

    let err = timeout(Duration::from_secs(5), resize).await.unwrap().unwrap().unwrap_err();
    assert!(err.contains("newer geometry fence"), "unexpected error: {err}");
    assert_eq!(producer.viewport_epoch(), 5, "the rollback must not regress the newer epoch");
    assert_eq!(producer.geometry().await, external, "the rollback must not restore the old geometry");
    assert!(!producer.input_geometry_trusted(), "the fence's untrusted state must survive");
}

/// Same, for the stop-failure path, where an external fence that only BEGAN (epoch value
/// unchanged, transitional bit already set) is indistinguishable by epoch alone: ownership must
/// come from the fence generation.
#[tokio::test]
async fn external_fence_begun_during_the_stop_failure_rollback_is_not_cleared() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    let baseline = emulation_width_count(&cdp, 1280); // session setup already sent one
    assert!(producer.input_geometry_trusted());
    cdp.shared.fail_stop.store(true, Ordering::SeqCst);
    cdp.shared.block_emu_width.store(1280, Ordering::SeqCst);

    let resize = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.update_geometry(geometry_of(800.0, 600.0), 2).await })
    };
    // The stop is rejected, then the native rollback (back to 1280) is held in flight.
    eventually("native rollback in flight", Duration::from_secs(3), || {
        emulation_width_count(&cdp, 1280) > baseline
    }).await;

    producer.begin_external_geometry_fence().await;
    cdp.reply_to_last("Emulation.setDeviceMetricsOverride", json!({}));

    let err = timeout(Duration::from_secs(5), resize).await.unwrap().unwrap().unwrap_err();
    assert!(err.contains("newer geometry fence"), "unexpected error: {err}");
    assert!(!producer.input_geometry_trusted(), "the rollback must not re-trust over a begun fence");
    assert_eq!(producer.state().await, ScreencastState::Streaming, "the live run is untouched");
}

/// A delayed STALE external commit (older epoch) is rejected and changes nothing; it must not make
/// a concurrent failed resize refuse to restore and strand the producer fenced.
#[tokio::test]
async fn stale_rejected_external_commit_does_not_strand_a_failed_resize_fenced() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let producer = Arc::new(producer);
    producer.update_geometry(geometry_of(1280.0, 720.0), 5).await.expect("establish epoch 5");
    assert!(producer.input_geometry_trusted());

    cdp.shared.block_emu_width.store(800, Ordering::SeqCst);
    let baseline = emulation_width_count(&cdp, 800);
    let resize = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.update_geometry(geometry_of(800.0, 600.0), 6).await })
    };
    eventually("override in flight", Duration::from_secs(3), || {
        emulation_width_count(&cdp, 800) > baseline
    }).await;

    producer.commit_external_geometry_fence(4, Some(geometry_of(640.0, 480.0))).await;
    cdp.fail_last("Emulation.setDeviceMetricsOverride", "override rejected");

    let err = timeout(Duration::from_secs(5), resize).await.unwrap().unwrap().unwrap_err();
    assert!(err.contains("Emulation.setDeviceMetricsOverride failed"), "unexpected error: {err}");
    assert!(producer.input_geometry_trusted(), "the failed resize must restore its snapshot");
    assert_eq!(producer.geometry().await, geometry_of(1280.0, 720.0), "a rejected commit changes no geometry");
}

/// When a newer epoch wins, a stale resize must leave the winner's epoch encoding alone: a
/// successor fence's transitional bit keeps frame publication suppressed until it commits.
#[tokio::test]
async fn stale_resize_does_not_strip_a_successor_fences_transitional_bit() {
    let cdp = start_scripted_cdp().await;
    let (producer, _sub) = scripted_producer(&cdp, fast_policy()).await;
    let sid = producer.ensure_page_session().await.unwrap();
    let producer = Arc::new(producer);
    let mut frames = producer.subscribe_frames();

    cdp.shared.block_emu_width.store(800, Ordering::SeqCst);
    let baseline = emulation_width_count(&cdp, 800);
    let resize = {
        let producer = producer.clone();
        tokio::spawn(async move { producer.update_geometry(geometry_of(800.0, 600.0), 2).await })
    };
    eventually("override in flight", Duration::from_secs(3), || {
        emulation_width_count(&cdp, 800) > baseline
    }).await;

    // A newer raw-CDP resize wins (epoch 5); a successor fence then begins and stays uncommitted.
    producer.begin_external_geometry_fence().await;
    producer.commit_external_geometry_fence(5, None).await;
    producer.begin_external_geometry_fence().await;
    cdp.shared.block_emu_width.store(0, Ordering::SeqCst);
    cdp.reply_to_last("Emulation.setDeviceMetricsOverride", json!({}));
    timeout(Duration::from_secs(5), resize).await.unwrap().unwrap().expect("stale resize completes");

    cdp.push_frame(&sid, 5);
    assert!(
        timeout(Duration::from_millis(700), frames.recv()).await.is_err(),
        "a frame was published while the successor fence was still in progress"
    );
}

// ---------------------------------------------------------------------------------------------
// Real-engine qualification receipts (Phase 05). The production ScreencastProducer drives real
// Chromium; every measurement prints a machine-greppable `QUAL|<topic>|k=v|...` line (--nocapture).
// ---------------------------------------------------------------------------------------------
use dam_hopper_server::browser_host::adaptive_stream_controller::REPORT_EXPIRY;
use dam_hopper_server::browser_host::input::{map_fraction_to_css_coords, InputEvent, MouseButton};
use dam_hopper_server::browser_host::media::dispatch_input_event_to_cdp;
use dam_hopper_server::browser_host::protocol::TargetFrameHeader;
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use zune_jpeg::JpegDecoder;

/// Corner and centre hot zones (distinct flat colours) that record every mousedown; the grey
/// heartbeat square keeps Chromium repainting so frames keep flowing at every tier.
const MARKER_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#fff;overflow:hidden}
.z{position:fixed;width:48px;height:48px}
#tl{left:0;top:0;background:#f00}#tr{right:0;top:0;background:#00c800}
#bl{left:0;bottom:0;background:#00f}#br{right:0;bottom:0;background:#f0f}
#c{left:calc(50% - 24px);top:calc(50% - 24px);background:#ffc800}
#hb{position:fixed;left:25%;top:25%;width:8px;height:8px;background:#888}
</style></head><body>
<div class="z" id="tl"></div><div class="z" id="tr"></div><div class="z" id="bl"></div>
<div class="z" id="br"></div><div class="z" id="c"></div><div id="hb"></div>
<script>window.__clicks=[];
document.addEventListener('mousedown',e=>window.__clicks.push([e.clientX,e.clientY,e.target.id]),true);
let n=0;setInterval(()=>{n=(n+37)%200;document.getElementById('hb').style.background='rgb('+(n+20)+','+(n+20)+','+(n+20)+')'},33);
</script></body></html>"#;

fn qual_geometry(css_width: f64, css_height: f64, dpr: f64) -> TargetGeometry {
    TargetGeometry {
        css_width, css_height, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
        page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr,
    }
}

fn qual_load(topic: &str, tag: &str, when: &str) {
    let raw = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let load = raw.split_whitespace().take(3).collect::<Vec<_>>().join(",");
    println!("QUAL|load|topic={topic}|tag={tag}|when={when}|loadavg={load}");
}

/// Nearest-rank percentile of an ascending slice.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    let n = sorted.len();
    sorted[((p * n as f64).ceil() as usize).clamp(1, n) - 1]
}

/// Dimensions from the JPEG SOF segment, parsed independently of the production header packer.
fn try_sof_dims(jpeg: &[u8]) -> Option<(u32, u32)> {
    let mut decoder = JpegDecoder::new(std::io::Cursor::new(jpeg));
    decoder.decode_headers().ok()?;
    let info = decoder.info()?;
    Some((u32::from(info.width), u32::from(info.height)))
}

fn sof_dims(jpeg: &[u8]) -> (u32, u32) {
    try_sof_dims(jpeg).expect("JPEG SOF")
}

fn decode_rgb(jpeg: &[u8]) -> (usize, usize, Vec<u8>) {
    let mut decoder = JpegDecoder::new(std::io::Cursor::new(jpeg));
    let pixels = decoder.decode().expect("JPEG decode");
    let info = decoder.info().expect("JPEG info");
    (info.width as usize, info.height as usize, pixels)
}

/// Serves one fixed HTML document from a local loopback listener (no external network).
async fn serve_fixture(html: &str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let body = html.to_string();
    let task = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let body = body.clone();
            tokio::spawn(async move {
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request).await;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(body.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    (url, task)
}

/// One published frame as delivered to viewers, stamped when it left the producer's broadcast.
#[derive(Clone)]
struct FrameRec {
    at: Instant,
    header: TargetFrameHeader,
    bhjf: Vec<u8>,
}

impl FrameRec {
    fn jpeg(&self) -> &[u8] {
        unpack_bhjf_frame(&self.bhjf).expect("valid BHJF").1
    }
}

/// Raw native screencast frame as Chromium reported it (before any production processing).
struct RawNative {
    at: Instant,
    native_id: i64,
    device: (f64, f64),
    page_scale: f64,
    sof: (u32, u32),
}

struct LogEntry {
    at: Instant,
    run: String,
    trusted: bool,
}

struct Switch {
    old_run: Uuid,
    new_run: Uuid,
    first: FrameRec,
    ms: f64,
    old_before_first: usize,
    native_old: i64,
    native_new: i64,
    d_rx: u64,
    d_pub: u64,
    d_drop_old: u64,
    d_drop_over: u64,
    /// Raw native frames (`id:SOFxSOF@ms-after-request`) Chromium emitted until the first published frame.
    raw_trace: String,
}

/// Real Chromium + production producer + one visible viewer whose controller vote has expired, so
/// only the test drives tier switches (through the shared capture snapshot the run task watches).
struct EngineRig {
    process: BrowserProcess,
    client: Arc<CdpClient>,
    producer: ScreencastProducer,
    page_sid: String,
    frames: mpsc::UnboundedReceiver<FrameRec>,
    raw: Arc<std::sync::Mutex<Vec<RawNative>>>,
    log: Vec<LogEntry>,
    _tmp: tempfile::TempDir,
    _http: tokio::task::JoinHandle<()>,
}

impl EngineRig {
    async fn start(html: &str, geometry: TargetGeometry) -> Option<Self> {
        let exec = require_browser_executable()?;
        let tmp = tempdir().unwrap();
        let mut config = BrowserLaunchConfig::new(tmp.path().join("qual-data"));
        config.executable_path = Some(exec);
        config.headless = true;
        let process = BrowserProcess::launch(config).await.expect("browser launch failed");
        let client = CdpClient::connect(process.ws_endpoint()).await.expect("CDP connect");
        let (url, http) = serve_fixture(html).await;
        let target_id: String = client
            .send_typed(CreateTargetParams::builder().url(url).build().unwrap(), None)
            .await
            .expect("Target.createTarget")
            .target_id
            .into();
        let producer = ScreencastProducer::new(
            Uuid::new_v4().to_string(), Uuid::new_v4().to_string(), 1, 1,
            client.clone(), target_id, geometry.clone(),
        )
        .with_capture_policy(30, 80);
        let page_sid = producer.ensure_page_session().await.expect("page session");
        let mut rig = Self {
            process, client, producer, page_sid,
            frames: mpsc::unbounded_channel().1,
            raw: Arc::new(std::sync::Mutex::new(Vec::new())),
            log: Vec::new(), _tmp: tmp, _http: http,
        };
        for _ in 0..200 {
            if rig.eval("document.readyState").await == "complete" {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        // Same geometry, newer epoch: forces the native metrics override (DPR included) to apply.
        rig.producer.update_geometry(geometry, 2).await.expect("apply geometry");

        let (frame_tx, frame_rx) = mpsc::unbounded_channel();
        rig.frames = frame_rx;
        let mut published = rig.producer.subscribe_frames();
        tokio::spawn(async move {
            loop {
                match published.recv().await {
                    Ok(f) => {
                        let (at, header) = (Instant::now(), f.header().expect("header").clone());
                        if frame_tx.send(FrameRec { at, header, bhjf: f.data().to_vec() }).is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });
        let raw = rig.raw.clone();
        let mut native = rig.client.subscribe_screencast();
        tokio::spawn(async move {
            loop {
                match native.recv().await {
                    Ok(f) => raw.lock().unwrap().push(RawNative {
                        at: Instant::now(),
                        native_id: f.frame_session_id,
                        device: (
                            f.metadata["deviceWidth"].as_f64().unwrap_or(0.0),
                            f.metadata["deviceHeight"].as_f64().unwrap_or(0.0),
                        ),
                        page_scale: f.metadata["pageScaleFactor"].as_f64().unwrap_or(0.0),
                        sof: B64.decode(&f.data_base64).ok().and_then(|b| try_sof_dims(&b)).unwrap_or((0, 0)),
                    }),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });

        let sub = Uuid::new_v4().to_string();
        rig.producer.register_viewer_demand("qual-viewer", &sub, true).await;
        let version = rig.producer.capture_snapshot().version;
        rig.next_frame(Duration::from_secs(10)).await;
        // The controller keeps voting for its own stage until its (never refreshed) report expires.
        let quiet_at = Instant::now() + REPORT_EXPIRY + Duration::from_secs(1);
        while Instant::now() < quiet_at {
            rig.producer.register_viewer_demand("qual-viewer", &sub, true).await;
            sleep(Duration::from_secs(2)).await;
            while let Ok(r) = rig.frames.try_recv() {
                rig.note(&r);
            }
        }
        assert_eq!(rig.producer.capture_snapshot().version, version, "controller must stay quiet");
        Some(rig)
    }

    async fn eval(&self, expression: &str) -> Value {
        let res = self
            .client
            .send_command(
                "Runtime.evaluate",
                Some(json!({ "expression": expression, "returnByValue": true })),
                Some(&self.page_sid),
            )
            .await
            .expect("Runtime.evaluate");
        res["result"]["value"].clone()
    }

    /// Page-side `(innerWidth, innerHeight, devicePixelRatio)`.
    async fn page_metrics(&self) -> (f64, f64, f64) {
        let v = self.eval("JSON.stringify([innerWidth,innerHeight,devicePixelRatio])").await;
        let m: Vec<f64> = serde_json::from_str(v.as_str().expect("metrics string")).unwrap();
        (m[0], m[1], m[2])
    }

    fn note(&mut self, rec: &FrameRec) {
        self.log.push(LogEntry {
            at: rec.at, run: rec.header.producer_run.clone(), trusted: rec.header.input_trusted,
        });
    }

    async fn next_frame(&mut self, within: Duration) -> FrameRec {
        let rec = timeout(within, self.frames.recv())
            .await
            .expect("frame within deadline")
            .expect("frame collector open");
        self.note(&rec);
        rec
    }

    fn max_native_id(&self, until: Instant) -> i64 {
        let raw = self.raw.lock().unwrap();
        raw.iter().filter(|r| r.at <= until).map(|r| r.native_id).max().unwrap_or(0)
    }

    /// Last raw native metadata Chromium reported at or before `until`: (device dims, page scale).
    fn raw_meta_at(&self, until: Instant) -> ((f64, f64), f64) {
        let raw = self.raw.lock().unwrap();
        raw.iter().rev().find(|r| r.at <= until).map_or(((0.0, 0.0), 0.0), |r| (r.device, r.page_scale))
    }

    /// One production tier switch: publish the ladder stage's snapshot (the run task restarts the
    /// native screencast with a fresh run) and wait for the first published frame of the new run.
    async fn switch_to_stage(&mut self, stage: usize) -> Switch {
        while let Ok(r) = self.frames.try_recv() {
            self.note(&r);
        }
        // After a producer-side recovery the next run may still be starting.
        let mut live = None;
        for _ in 0..200 {
            if self.producer.state().await == ScreencastState::Streaming {
                live = self.producer.current_run().await;
                if live.is_some() {
                    break;
                }
            }
            sleep(Duration::from_millis(25)).await;
        }
        let old_run = live.expect("live run");
        let fps = self.producer.capture_state().ladder().stage(stage).fps;
        let l = &self.producer.ledger;
        let counters = |l: &dam_hopper_server::browser_host::screencast::ScreencastLedger| {
            (
                l.events_received.load(Ordering::Relaxed),
                l.frames_published.load(Ordering::Relaxed),
                l.events_dropped_old_run.load(Ordering::Relaxed),
                l.events_dropped_overwritten.load(Ordering::Relaxed),
            )
        };
        let before = counters(l);
        let native_old = self.max_native_id(Instant::now());
        let t0 = Instant::now();
        self.producer.capture_state().publish(stage, fps).expect("stage changes the snapshot");
        let mut old_before_first = 0;
        let first = loop {
            let rec = self.next_frame(Duration::from_secs(5)).await;
            if rec.header.producer_run == old_run.to_string() {
                old_before_first += 1;
                continue;
            }
            break rec;
        };
        let new_run = self.producer.current_run().await.expect("fresh run");
        assert_eq!(first.header.producer_run, new_run.to_string());
        assert_ne!(new_run, old_run, "run id rotates on every native restart");
        let want = self.producer.capture_state().ladder().stage(stage);
        for _ in 0..40 {
            if self.producer.effective_capture().is_some_and(|e| e.native_key() == (want.jpeg_quality, want.scale_permille)) {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(
            self.producer.effective_capture().unwrap().native_key(),
            (want.jpeg_quality, want.scale_permille),
            "a current-run frame proves the new native settings"
        );
        let after = counters(&self.producer.ledger);
        let raw_trace = self
            .raw
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.at >= t0 && r.at <= first.at)
            .map(|r| format!("{}:{}x{}@{:.0}", r.native_id, r.sof.0, r.sof.1, r.at.duration_since(t0).as_secs_f64() * 1000.0))
            .collect::<Vec<_>>()
            .join(",");
        Switch {
            old_run, new_run, ms: first.at.duration_since(t0).as_secs_f64() * 1000.0,
            old_before_first, native_old, native_new: self.max_native_id(first.at),
            d_rx: after.0 - before.0, d_pub: after.1 - before.1,
            d_drop_old: after.2 - before.2, d_drop_over: after.3 - before.3,
            raw_trace,
            first,
        }
    }

    /// The switch's first frame when its SOF is the target size; otherwise (Chromium sometimes
    /// emits the first frame of a fresh native session at the previous session's size) the next
    /// frames until one is, counting the skipped. The gap test reports how often that happens.
    async fn settled(&mut self, first: FrameRec, expect: (u32, u32)) -> (FrameRec, usize) {
        let (mut frame, mut skipped) = (first, 0);
        while sof_dims(frame.jpeg()) != expect && skipped < 8 {
            frame = self.next_frame(Duration::from_secs(5)).await;
            skipped += 1;
        }
        (frame, skipped)
    }

    async fn finish(mut self) {
        let _ = self.process.terminate().await;
    }
}

/// Image size the capture pipeline asks Chromium for: CSS size x scale (DPR is never multiplied in).
fn expected_dims(css_w: f64, css_h: f64, scale_permille: u16) -> (u32, u32) {
    let axis = |css: f64| ((css.round() as u64 * u64::from(scale_permille) + 500) / 1000) as u32;
    (axis(css_w), axis(css_h))
}

fn tier_stage(rig: &EngineRig, tier: CaptureTier) -> usize {
    rig.producer.capture_state().ladder().anchor(tier)
}

/// Receipt 1: CSS viewport, DPR and viewport epoch stay invariant across capture-scale switches;
/// the JPEG SOF scales with the capture scale only.
async fn geometry_matrix_for_dpr(dpr: f64) {
    let (css_w, css_h) = (1280.0, 720.0);
    let mut rig = EngineRig::start(MARKER_HTML, qual_geometry(css_w, css_h, dpr)).await.expect("rig");
    let epoch0 = rig.producer.viewport_epoch();
    let plan = [
        ("initial", 1000u16, None),
        ("to750", 750, Some(tier_stage(&rig, CaptureTier::Low))),
        ("to500", 500, Some(tier_stage(&rig, CaptureTier::Constrained))),
        ("to1000", 1000, Some(tier_stage(&rig, CaptureTier::Medium))),
    ];
    for (phase, scale, stage) in plan {
        let inner_before = rig.page_metrics().await;
        let expect = expected_dims(css_w, css_h, scale);
        let (frame, trace, stale) = match stage {
            Some(stage) => {
                let sw = rig.switch_to_stage(stage).await;
                let trace = format!("{}->{}|{}", sw.native_old, sw.native_new, sw.raw_trace);
                let (frame, stale) = rig.settled(sw.first, expect).await;
                (frame, trace, stale)
            }
            None => (rig.next_frame(Duration::from_secs(5)).await, String::new(), 0),
        };
        let inner = rig.page_metrics().await;
        let (hdr, sof) = (&frame.header, sof_dims(frame.jpeg()));
        let (raw_dev, raw_ps) = rig.raw_meta_at(frame.at);
        let epoch: u64 = hdr.viewport_epoch.parse().unwrap();
        println!(
            "QUAL|geometry|dpr={dpr}|scale={scale}|phase={phase}|innerBefore={}x{}|inner={}x{}|dprPage={}|meta={}x{}|hdr={}x{}|sof={}x{}|epoch={epoch}|rawDev={}x{}|rawPageScale={}|trusted={}|fallbacks={}|staleFirst={stale}|rawTrace={trace}",
            inner_before.0, inner_before.1, inner.0, inner.1, inner.2,
            hdr.geometry.css_width, hdr.geometry.css_height, hdr.width, hdr.height, sof.0, sof.1,
            raw_dev.0, raw_dev.1, raw_ps, hdr.input_trusted,
            rig.producer.ledger.screenshot_fallbacks.load(Ordering::Relaxed),
        );
        assert_eq!((inner_before.0, inner_before.1), (css_w, css_h), "CSS viewport before switch");
        assert_eq!((inner.0, inner.1), (css_w, css_h), "CSS viewport after switch");
        assert!((inner_before.2 - dpr).abs() < 0.01 && (inner.2 - dpr).abs() < 0.01, "page DPR {inner:?}");
        assert_eq!((hdr.geometry.css_width, hdr.geometry.css_height), (css_w, css_h));
        assert_eq!((hdr.width, hdr.height), sof, "header dims come from the real SOF");
        // Pipeline relation: bounds derive from CSS size x scale; DPR is never multiplied in.
        let s = f64::from(scale) / 1000.0;
        assert!((f64::from(sof.0) - css_w * s).abs() <= 1.0, "sof width {sof:?} vs css*scale");
        assert!((f64::from(sof.1) - css_h * s).abs() <= 1.0, "sof height {sof:?} vs css*scale");
        assert_eq!(epoch, epoch0, "a tier-only switch never advances the viewport epoch");
        assert_eq!(hdr.input_trusted, scale >= 1000, "downscaled frames stay untrusted until qualified");
    }
    assert_eq!(rig.producer.viewport_epoch(), epoch0);
    rig.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_engine_geometry_invariant_across_capture_scales_and_dpr() {
    if require_browser_executable().is_none() {
        return;
    }
    qual_load("geometry", "all", "before");
    futures_util::future::join_all([1.0, 1.5, 2.0].map(geometry_matrix_for_dpr)).await;
    qual_load("geometry", "all", "after");
}

/// Run-order analysis over every frame delivered: a frame whose run was already superseded by a
/// newer run's first frame is a late old-run frame. Returns late counts per run id.
fn late_old_by_run(log: &[LogEntry]) -> HashMap<String, usize> {
    let mut first_seen: HashMap<&str, Instant> = HashMap::new();
    for e in log {
        first_seen.entry(&e.run).and_modify(|t| *t = (*t).min(e.at)).or_insert(e.at);
    }
    let mut order: Vec<(&str, Instant)> = first_seen.into_iter().collect();
    order.sort_by_key(|(_, t)| *t);
    let retired_at: HashMap<&str, Instant> = order.windows(2).map(|w| (w[0].0, w[1].1)).collect();
    let mut late = HashMap::new();
    for e in log {
        if retired_at.get(e.run.as_str()).is_some_and(|t| e.at > *t) {
            *late.entry(e.run.clone()).or_default() += 1;
        }
    }
    late
}

/// Per-run anomaly counts of the serialized-switch receipt.
struct GapOutcome {
    ms: Vec<f64>,
    stale_first: usize,
    aborted: u64,
    unplanned_frames: usize,
}

/// Receipt 3, one run: 32 serialized production tier switches cycling High/Low/Constrained/Medium.
async fn gap_run(run: usize) -> GapOutcome {
    let (css_w, css_h) = (1280.0, 720.0);
    let mut rig = EngineRig::start(MARKER_HTML, qual_geometry(css_w, css_h, 1.0)).await.expect("rig");
    let ladder = rig.producer.capture_state().ladder().clone();
    let mut scale_of_run: HashMap<String, u16> = HashMap::new();
    scale_of_run.insert(rig.producer.current_run().await.expect("run").to_string(), 1000);
    let cycle = [CaptureTier::High, CaptureTier::Low, CaptureTier::Constrained, CaptureTier::Medium];
    let (mut from, mut rows) = (CaptureTier::Medium, Vec::new());
    let mut settle_skips = Vec::new();
    for i in 0..32 {
        let to = cycle[i % 4];
        let stage = ladder.anchor(to);
        let sw = rig.switch_to_stage(stage).await;
        let scale = ladder.stage(stage).scale_permille;
        scale_of_run.insert(sw.new_run.to_string(), scale);
        // Not part of the timed gap: how many frames until the run delivers the target size.
        let (_, skipped) = rig.settled(sw.first.clone(), expected_dims(css_w, css_h, scale)).await;
        settle_skips.push(skipped);
        rows.push((i, from, to, stage, sw));
        from = to;
    }
    sleep(Duration::from_millis(700)).await; // let any late old-run frame surface
    while let Ok(r) = rig.frames.try_recv() {
        rig.note(&r);
    }
    let late = late_old_by_run(&rig.log);
    let mut stale_first = 0;
    let mut ms_all = Vec::new();
    for (i, from, to, stage, sw) in &rows {
        let scale = ladder.stage(*stage).scale_permille;
        let first_dims = sof_dims(sw.first.jpeg());
        assert_eq!((sw.first.header.width, sw.first.header.height), first_dims, "header never misreports the JPEG size");
        let dims_ok = first_dims == expected_dims(css_w, css_h, scale);
        stale_first += usize::from(!dims_ok);
        let late_old = late.get(&sw.old_run.to_string()).copied().unwrap_or(0);
        println!(
            "QUAL|gap|run={run}|i={i}|from={from:?}|to={to:?}|ms={:.1}|firstFrameRun={}|rotated={}|lateOld={late_old}|oldBeforeFirst={}|nativeOld={}|nativeNew={}|firstDims={}x{}|firstDimsOk={dims_ok}|rx={}|pub={}|dropOld={}|dropOver={}|rawTrace={}",
            sw.ms, &sw.new_run.to_string()[..8], sw.new_run != sw.old_run, sw.old_before_first,
            sw.native_old, sw.native_new, first_dims.0, first_dims.1,
            sw.d_rx, sw.d_pub, sw.d_drop_old, sw.d_drop_over, sw.raw_trace,
        );
        ms_all.push(sw.ms);
    }
    let mut sorted = ms_all.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let l = &rig.producer.ledger;
    let (aborted, recoveries) = (l.runs_aborted.load(Ordering::Relaxed), l.recovery_attempts.load(Ordering::Relaxed));
    let late_total: usize = late.values().sum();
    println!(
        "QUAL|gap-summary|run={run}|switches={}|p50={:.1}|p95={:.1}|max={:.1}|lateOldTotal={late_total}|staleFirst={stale_first}|settleSkipsMax={}|runsAborted={aborted}|recoveryAttempts={recoveries}|acksFailed={}|state={:?}",
        sorted.len(), percentile(&sorted, 0.5), percentile(&sorted, 0.95), sorted[sorted.len() - 1],
        settle_skips.iter().max().unwrap(),
        l.acks_failed.load(Ordering::Relaxed), rig.producer.state().await,
    );
    // A run this test never requested can only come from a producer-side abort/recovery.
    let unplanned = rig.log.iter().filter(|e| !scale_of_run.contains_key(&e.run)).count();
    for e in rig.log.iter().filter(|e| scale_of_run.contains_key(&e.run)) {
        let scale = scale_of_run[&e.run];
        assert_eq!(e.trusted, scale >= 1000, "input trust of a run-{scale} frame");
    }
    // Generous safety bounds only: the producer is never retired and no old-run frame outlives its run.
    assert!(sorted.iter().all(|ms| *ms < 5000.0), "every first frame within 5 s");
    assert_eq!(late_total, 0, "an old-run frame was delivered after a newer run began");
    assert_eq!(rig.producer.state().await, ScreencastState::Streaming);
    assert!(rig.producer.current_run().await.is_some(), "producer still has a live run");
    rig.finish().await;
    GapOutcome { ms: ms_all, stale_first, aborted, unplanned_frames: unplanned }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_capture_tier_switch_gap_over_serialized_native_restarts() {
    if require_browser_executable().is_none() {
        return;
    }
    for run in 1..=3 {
        qual_load("gap", &run.to_string(), "before");
        let out = gap_run(run).await;
        qual_load("gap", &run.to_string(), "after");
        assert_eq!(out.ms.len(), 32);
    }
}

/// Strict session-admission receipt over the same serialized switches: a fresh native session's
/// first published frame must have the target size and no switch may abort the run into recovery.
/// Chromium can deliver a frame of the previous session (or one at the previous size) right after
/// a restart; this fails whenever the producer admits it (see `rawTrace` in the gap lines).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_native_restart_admits_only_target_session_frames() {
    if require_browser_executable().is_none() {
        return;
    }
    let mut bad = Vec::new();
    for run in 1..=2 {
        let out = gap_run(run).await;
        if (out.stale_first, out.aborted, out.unplanned_frames) != (0, 0, 0) {
            bad.push(format!("run {run}: staleFirst={} aborted={} unplannedFrames={}", out.stale_first, out.aborted, out.unplanned_frames));
        }
    }
    assert!(bad.is_empty(), "previous-session frame admitted after a native restart: {bad:?}");
}

/// Corner/centre hot-zone colours as (zone id, predicate over RGB).
type ZonePredicate = (&'static str, fn(u8, u8, u8) -> bool);
const ZONES: [ZonePredicate; 5] = [
    ("tl", |r, g, b| r > 200 && g < 70 && b < 70),
    ("tr", |r, g, b| g > 150 && r < 70 && b < 70),
    ("bl", |r, g, b| b > 200 && r < 70 && g < 70),
    ("br", |r, g, b| r > 200 && b > 200 && g < 70),
    ("c", |r, g, b| r > 200 && g > 150 && b < 70),
];

/// Normalized image position of a zone's centroid (pixel centres), from the decoded frame.
fn zone_centroid(rgb: &[u8], w: usize, h: usize, pred: fn(u8, u8, u8) -> bool) -> (f64, f64) {
    let (mut sx, mut sy, mut n) = (0.0, 0.0, 0usize);
    for y in 0..h {
        for x in 0..w {
            let p = &rgb[(y * w + x) * 3..(y * w + x) * 3 + 3];
            if pred(p[0], p[1], p[2]) {
                (sx, sy, n) = (sx + x as f64 + 0.5, sy + y as f64 + 0.5, n + 1);
            }
        }
    }
    assert!(n >= 4, "zone not visible in the decoded frame");
    (sx / n as f64 / w as f64, sy / n as f64 / h as f64)
}

/// Decodes the JPEG and locates every hot zone's centroid on the blocking pool. A debug-build
/// decode plus the per-pixel scans take hundreds of milliseconds of CPU; run on an async worker
/// (four layouts do this in lock-step) they starve the production run tasks, the capacity-2
/// screencast ingress overflows and the producer aborts the run into recovery (which re-attaches
/// the page session the rig still addresses).
async fn decode_zone_centroids(jpeg: Vec<u8>) -> Vec<(&'static str, f64, f64)> {
    let work = tokio::task::spawn_blocking(move || {
        let (w, h, rgb) = decode_rgb(&jpeg);
        ZONES.map(|(name, pred)| {
            let (u, v) = zone_centroid(&rgb, w, h, pred);
            (name, u, v)
        })
    });
    match work.await {
        Ok(zones) => zones.to_vec(),
        Err(e) => std::panic::resume_unwind(e.into_panic()),
    }
}

/// The viewer's aspect-fit mapping (same arithmetic as the UI input controller): canvas backing
/// store `round(css * dpr)`, image drawn aspect-fit and centred, pointer -> image fractions.
/// Returns the centre and the four corners inset by 4 CSS px.
fn letterbox_points(canvas_css: (f64, f64), dpr: f64, img: (u32, u32)) -> [(&'static str, f64, f64); 5] {
    let (cw, ch) = ((canvas_css.0 * dpr).round(), (canvas_css.1 * dpr).round());
    let image_aspect = f64::from(img.0) / f64::from(img.1);
    let (dw, dh, dx, dy) = if cw / ch > image_aspect {
        let dw = ch * image_aspect;
        (dw, ch, (cw - dw) / 2.0, 0.0)
    } else {
        let dh = cw / image_aspect;
        (cw, dh, 0.0, (ch - dh) / 2.0)
    };
    let inset = 4.0 * dpr;
    [
        ("c", dx + dw / 2.0, dy + dh / 2.0),
        ("tl", dx + inset, dy + inset),
        ("tr", dx + dw - inset, dy + inset),
        ("bl", dx + inset, dy + dh - inset),
        ("br", dx + dw - inset, dy + dh - inset),
    ]
    .map(|(name, x, y)| (name, (x - dx) / dw, (y - dy) / dh))
}

/// Real pointer press/release through the production projection; returns the DOM-observed click.
async fn click_fraction(rig: &EngineRig, u: f64, v: f64) -> ((f64, f64), String) {
    let geometry = rig.producer.geometry().await;
    let (mx, my) = map_fraction_to_css_coords(u, v, &geometry).expect("fraction maps");
    assert!((mx - u * geometry.css_width).abs() < 1e-6 && (my - v * geometry.css_height).abs() < 1e-6);
    for event in [
        InputEvent::PointerDown { button: MouseButton::Left, u, v, modifiers: 0 },
        InputEvent::PointerUp { button: MouseButton::Left, u, v, modifiers: 0 },
    ] {
        if let Err(e) = dispatch_input_event_to_cdp(&rig.producer.cdp_client, &rig.page_sid, &geometry, &event).await {
            panic!("input dispatch failed ({e:?}); {}", abort_summary(&rig.producer));
        }
    }
    let raw = rig.eval("JSON.stringify(window.__clicks.splice(0))").await;
    let clicks: Vec<(f64, f64, String)> = serde_json::from_str(raw.as_str().expect("clicks")).unwrap();
    assert_eq!(clicks.len(), 1, "exactly one DOM click per press: {clicks:?}");
    ((clicks[0].0, clicks[0].1), clicks[0].2.clone())
}

/// Run-abort counters of the production producer, to name the cause when the rig's page session is lost.
fn abort_summary(producer: &ScreencastProducer) -> String {
    let l = &producer.ledger;
    format!(
        "runs_aborted={} ingress_lagged={} recovery_attempts={}",
        l.runs_aborted.load(Ordering::Relaxed),
        l.ingress_lagged.load(Ordering::Relaxed),
        l.recovery_attempts.load(Ordering::Relaxed),
    )
}

struct Layout {
    name: &'static str,
    css: (f64, f64),
    dpr: f64,
    canvas: (f64, f64),
}

/// Receipt 2, one layout: click oracle at 1000/750/500, then qualification on the real data.
async fn oracle_layout(l: Layout) {
    let (cw, ch) = l.css;
    let mut rig = EngineRig::start(MARKER_HTML, qual_geometry(cw, ch, l.dpr)).await.expect("rig");
    let plan = [
        (1000u16, None),
        (750, Some(tier_stage(&rig, CaptureTier::Low))),
        (500, Some(tier_stage(&rig, CaptureTier::Constrained))),
    ];
    let mut by_scale: Vec<Vec<DownscaleObservation>> = Vec::new();
    for (scale, stage) in plan {
        let expect = expected_dims(cw, ch, scale);
        let frame = match stage {
            Some(stage) => {
                let first = rig.switch_to_stage(stage).await.first;
                rig.settled(first, expect).await.0
            }
            None => rig.next_frame(Duration::from_secs(5)).await,
        };
        let (inner_w, inner_h, page_dpr) = rig.page_metrics().await;
        let (hdr, sof) = (&frame.header, sof_dims(frame.jpeg()));
        assert_eq!(hdr.input_trusted, scale >= 1000, "pre-qualification trust at scale {scale}");
        let zones = decode_zone_centroids(frame.jpeg().to_vec()).await;
        let mut points = Vec::new();
        for (name, u, v) in letterbox_points(l.canvas, l.dpr, (hdr.width, hdr.height)) {
            let (got, hit) = click_fraction(&rig, u, v).await;
            points.push(("A", name, (u, v), (u * cw, v * ch), got, hit));
        }
        for (name, u, v) in zones {
            let want = match name {
                "tl" => (24.0, 24.0),
                "tr" => (cw - 24.0, 24.0),
                "bl" => (24.0, ch - 24.0),
                "br" => (cw - 24.0, ch - 24.0),
                _ => (cw / 2.0, ch / 2.0),
            };
            let (got, hit) = click_fraction(&rig, u, v).await;
            points.push(("B", name, (u, v), want, got, hit));
        }
        let tol_px = 1.0 + 1000.0 / f64::from(scale);
        let (mut max_u, mut max_v, mut max_px) = (0.0f64, 0.0f64, 0.0f64);
        let mut observations = Vec::new();
        for (set, name, (u, v), want, got, hit) in points {
            let (err_u, err_v) = ((got.0 - want.0) / cw, (got.1 - want.1) / ch);
            let err_px = (got.0 - want.0).hypot(got.1 - want.1);
            println!(
                "QUAL|oracle|layout={}|dpr={}|css={cw}x{ch}|canvas={}x{}|scale={scale}|set={set}|pt={name}|u={u:.5}|v={v:.5}|wantCss={:.2},{:.2}|gotCss={:.2},{:.2}|hit={hit}|errU={err_u:.5}|errV={err_v:.5}|errPx={err_px:.3}",
                l.name, l.dpr, l.canvas.0, l.canvas.1, want.0, want.1, got.0, got.1,
            );
            assert_eq!(hit, name, "click landed on the wrong element ({set}/{name} at scale {scale})");
            assert!(err_px <= tol_px, "click {set}/{name} off by {err_px}px at scale {scale}");
            (max_u, max_v, max_px) = (max_u.max(err_u.abs()), max_v.max(err_v.abs()), max_px.max(err_px));
            observations.push(DownscaleObservation {
                scale_permille: scale,
                dom_inner: (inner_w, inner_h),
                dom_dpr: page_dpr,
                meta_css: (hdr.geometry.css_width, hdr.geometry.css_height),
                jpeg: sof,
                click_expected_uv: (want.0 / cw, want.1 / ch),
                click_observed_uv: (got.0 / cw, got.1 / ch),
            });
        }
        println!(
            "QUAL|oracle-max|layout={}|scale={scale}|points={}|maxErrU={max_u:.5}|maxErrV={max_v:.5}|maxErrPx={max_px:.3}|trustedBefore={}",
            l.name, observations.len(), hdr.input_trusted
        );
        by_scale.push(observations);
    }

    // Qualification runs on the real observations, one call per click point.
    let state = rig.producer.capture_state().clone();
    assert!(!state.downscale_input_qualified());
    let sets: Vec<[DownscaleObservation; 3]> =
        (0..by_scale[0].len()).map(|k| [by_scale[0][k], by_scale[1][k], by_scale[2][k]]).collect();
    for (k, set) in sets.iter().enumerate() {
        state.qualify_downscale(cw, ch, l.dpr, set).unwrap_or_else(|e| panic!("point {k}: {e}"));
    }
    assert!(state.downscale_input_qualified());
    println!("QUAL|oracle-qualify|layout={}|points={}|result=ok|qualified=true", l.name, sets.len());

    // Negative controls: the oracle must be able to fail, and each failure revokes qualification.
    let mut bad_dpr = sets[0];
    bad_dpr[1].dom_dpr += 0.5;
    let mut bad_click = sets[0];
    bad_click[2].click_observed_uv.0 += 0.02;
    let mut bad_jpeg = sets[0];
    bad_jpeg[1].jpeg = (cw as u32, ch as u32);
    let mut bad_inner = sets[0];
    bad_inner[0].dom_inner.0 += 20.0;
    for (label, set, needle) in [
        ("dpr", bad_dpr, "devicePixelRatio changed"),
        ("click", bad_click, "click mapping drifted"),
        ("jpeg", bad_jpeg, "JPEG size not scaled"),
        ("inner", bad_inner, "DOM inner size changed"),
    ] {
        let err = state.qualify_downscale(cw, ch, l.dpr, &set).expect_err("corrupted observation must fail");
        println!("QUAL|oracle-negative|layout={}|corrupt={label}|result=err|msg={err}|qualified={}", l.name, state.downscale_input_qualified());
        assert!(err.contains(needle), "{err}");
        assert!(!state.downscale_input_qualified());
    }
    let missing = state.qualify_downscale(cw, ch, l.dpr, &sets[0][..2]).expect_err("missing scale must fail");
    assert!(missing.contains("missing observation"), "{missing}");

    // Consumer-visible effect: the downscaled run's frames follow the qualification flag.
    async fn trust_of_next_frame(rig: &mut EngineRig) -> bool {
        sleep(Duration::from_millis(400)).await;
        while let Ok(r) = rig.frames.try_recv() {
            rig.note(&r);
        }
        rig.next_frame(Duration::from_secs(5)).await.header.input_trusted
    }
    let revoked = trust_of_next_frame(&mut rig).await;
    state.qualify_downscale(cw, ch, l.dpr, &sets[0]).expect("re-qualify");
    let granted = trust_of_next_frame(&mut rig).await;
    println!("QUAL|oracle-trust|layout={}|scale=500|afterNegative={revoked}|afterQualify={granted}", l.name);
    assert!(!revoked && granted, "scale-500 frames must follow the qualification flag");
    assert_eq!(rig.producer.ledger.runs_aborted.load(Ordering::Relaxed), 0, "the producer must not abort its run mid-oracle: {}", abort_summary(&rig.producer));
    rig.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_engine_dom_click_oracle_qualifies_downscaled_input_and_can_fail() {
    if require_browser_executable().is_none() {
        return;
    }
    qual_load("oracle", "all", "before");
    let layouts = [
        Layout { name: "native-16x9", css: (1280.0, 720.0), dpr: 1.0, canvas: (1280.0, 720.0) },
        Layout { name: "pillarbox-4x3-dpr1.5", css: (1280.0, 720.0), dpr: 1.5, canvas: (1024.0, 768.0) },
        Layout { name: "ultrawide-21x9", css: (1280.0, 720.0), dpr: 1.0, canvas: (1680.0, 720.0) },
        Layout { name: "square-odd-css-dpr2", css: (1366.0, 768.0), dpr: 2.0, canvas: (900.0, 900.0) },
    ];
    let handles: Vec<_> = layouts.into_iter().map(|l| (l.name, tokio::spawn(oracle_layout(l)))).collect();
    let mut failed = Vec::new();
    for (name, handle) in handles {
        if let Err(e) = handle.await {
            failed.push(format!("{name}: {e}"));
        }
    }
    assert!(failed.is_empty(), "layouts failed: {failed:?}");
    qual_load("oracle", "all", "after");
}

/// Synthetic 1280x720 legibility page: two themes (dark left, light right), monospaced code at
/// 12/14/16 px with syntax colours, sans body text at 12/14/16 px, 1 px borders and tables.
/// Review regions (CSS px, per theme panel at x=0 / x=640): code12 (16,40,608,96), code14
/// (16,150,608,120), code16 (16,284,608,132), body12 (16,430,608,32), body14 (16,470,608,40),
/// body16 (16,520,608,44), borders (16,568,608,144).
const LEGIBILITY_HTML: &str = r##"<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:1280px;height:720px;overflow:hidden;font-family:sans-serif}
.p{position:absolute;top:0;width:640px;height:720px}
.dark{left:0;background:#1e1e1e;color:#d4d4d4}.light{left:640px;background:#fff;color:#24292f}
.h{position:absolute;left:16px;top:8px;font:600 14px sans-serif}
pre,.t{position:absolute;left:16px;margin:0;white-space:pre}
pre{font-family:monospace}
.c12{top:40px;font-size:12px;line-height:16px}.c14{top:150px;font-size:14px;line-height:20px}
.c16{top:284px;font-size:16px;line-height:22px}
.b12{top:430px;font-size:12px;line-height:16px}.b14{top:470px;font-size:14px;line-height:20px}
.b16{top:520px;font-size:16px;line-height:22px}
.dark .k{color:#569cd6}.dark .s{color:#ce9178}.dark .m{color:#6a9955}.dark .n{color:#b5cea8}.dark .f{color:#dcdcaa}
.light .k{color:#0000ff}.light .s{color:#a31515}.light .m{color:#008000}.light .n{color:#098658}.light .f{color:#795e26}
.bx{position:absolute;top:572px;width:68px;height:40px}
.tb{position:absolute;top:624px;border-collapse:collapse;font-size:12px}
.tb td{padding:4px 10px}
.dark .bx:nth-child(1){border:1px solid #fff}.dark .bx:nth-child(2){border:1px solid #bbb}
.dark .bx:nth-child(3){border:1px solid #888}.dark .bx:nth-child(4){border:1px solid #444}
.light .bx:nth-child(1){border:1px solid #000}.light .bx:nth-child(2){border:1px solid #444}
.light .bx:nth-child(3){border:1px solid #888}.light .bx:nth-child(4){border:1px solid #ccc}
.bx:nth-child(5){border:1px solid #f00}.bx:nth-child(6){border:1px solid #00f}
.bx:nth-child(7){border:1px solid #080}.bx:nth-child(8){border:1px dashed #888}
.t1{left:16px}.t2{left:300px}
.t1 td{border:1px solid #888}.t2 td{border:1px solid #d00}
</style></head><body>
<div class="p dark"><div class="h">dark theme</div>
<pre class="c12"><span class="m">// synthetic fixture: sum of items</span>
<span class="k">function</span> <span class="f">sum</span>(items) {
  <span class="k">let</span> total = <span class="n">0</span>;
  <span class="k">for</span> (<span class="k">const</span> x <span class="k">of</span> items) total += x.<span class="f">v</span> * <span class="n">1.5</span>;
  <span class="k">return</span> <span class="s">"total="</span> + total;
}</pre>
<pre class="c14"><span class="m">// synthetic fixture: sum of items</span>
<span class="k">function</span> <span class="f">sum</span>(items) {
  <span class="k">let</span> total = <span class="n">0</span>;
  <span class="k">for</span> (<span class="k">const</span> x <span class="k">of</span> items) total += x.<span class="f">v</span> * <span class="n">1.5</span>;
  <span class="k">return</span> <span class="s">"total="</span> + total;
}</pre>
<pre class="c16"><span class="m">// synthetic fixture: sum of items</span>
<span class="k">function</span> <span class="f">sum</span>(items) {
  <span class="k">let</span> total = <span class="n">0</span>;
  <span class="k">for</span> (<span class="k">const</span> x <span class="k">of</span> items) total += x.<span class="f">v</span>;
  <span class="k">return</span> <span class="s">"t="</span> + total;
}</pre>
<div class="t b12">The quick brown fox jumps over the lazy dog, 0123456789 {}[]()
Pack my box with five dozen liquor jugs. Il1 O0 rn m cl d</div>
<div class="t b14">The quick brown fox jumps over the lazy dog, 0123456789
Pack my box with five dozen liquor jugs. Il1 O0 rn m cl d</div>
<div class="t b16">The quick brown fox jumps over the lazy dog 0123456789
Pack my box with five dozen liquor jugs. Il1 O0 rn</div>
<div class="bx" style="left:16px"></div><div class="bx" style="left:92px"></div><div class="bx" style="left:168px"></div><div class="bx" style="left:244px"></div><div class="bx" style="left:320px"></div><div class="bx" style="left:396px"></div><div class="bx" style="left:472px"></div><div class="bx" style="left:548px"></div>
<table class="tb t1"><tr><td>id</td><td>name</td><td>qty</td></tr><tr><td>1</td><td>alpha</td><td>10</td></tr><tr><td>2</td><td>beta</td><td>20</td></tr></table>
<table class="tb t2"><tr><td>id</td><td>name</td><td>qty</td></tr><tr><td>3</td><td>gamma</td><td>30</td></tr><tr><td>4</td><td>delta</td><td>40</td></tr></table>
</div>
<div class="p light"><div class="h">light theme</div>
<pre class="c12"><span class="m">// synthetic fixture: sum of items</span>
<span class="k">function</span> <span class="f">sum</span>(items) {
  <span class="k">let</span> total = <span class="n">0</span>;
  <span class="k">for</span> (<span class="k">const</span> x <span class="k">of</span> items) total += x.<span class="f">v</span> * <span class="n">1.5</span>;
  <span class="k">return</span> <span class="s">"total="</span> + total;
}</pre>
<pre class="c14"><span class="m">// synthetic fixture: sum of items</span>
<span class="k">function</span> <span class="f">sum</span>(items) {
  <span class="k">let</span> total = <span class="n">0</span>;
  <span class="k">for</span> (<span class="k">const</span> x <span class="k">of</span> items) total += x.<span class="f">v</span> * <span class="n">1.5</span>;
  <span class="k">return</span> <span class="s">"total="</span> + total;
}</pre>
<pre class="c16"><span class="m">// synthetic fixture: sum of items</span>
<span class="k">function</span> <span class="f">sum</span>(items) {
  <span class="k">let</span> total = <span class="n">0</span>;
  <span class="k">for</span> (<span class="k">const</span> x <span class="k">of</span> items) total += x.<span class="f">v</span>;
  <span class="k">return</span> <span class="s">"t="</span> + total;
}</pre>
<div class="t b12">The quick brown fox jumps over the lazy dog, 0123456789 {}[]()
Pack my box with five dozen liquor jugs. Il1 O0 rn m cl d</div>
<div class="t b14">The quick brown fox jumps over the lazy dog, 0123456789
Pack my box with five dozen liquor jugs. Il1 O0 rn m cl d</div>
<div class="t b16">The quick brown fox jumps over the lazy dog 0123456789
Pack my box with five dozen liquor jugs. Il1 O0 rn</div>
<div class="bx" style="left:16px"></div><div class="bx" style="left:92px"></div><div class="bx" style="left:168px"></div><div class="bx" style="left:244px"></div><div class="bx" style="left:320px"></div><div class="bx" style="left:396px"></div><div class="bx" style="left:472px"></div><div class="bx" style="left:548px"></div>
<table class="tb t1"><tr><td>id</td><td>name</td><td>qty</td></tr><tr><td>1</td><td>alpha</td><td>10</td></tr><tr><td>2</td><td>beta</td><td>20</td></tr></table>
<table class="tb t2"><tr><td>id</td><td>name</td><td>qty</td></tr><tr><td>3</td><td>gamma</td><td>30</td></tr><tr><td>4</td><td>delta</td><td>40</td></tr></table>
</div></body></html>"##;

/// Receipt 4: the exact JPEG bytes Chromium delivers at every distinct ladder quality/scale pair,
/// written for human review (crops/contact sheets are built from these files, never judged here).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_capture_ladder_stages_write_legibility_fixtures_for_human_review() {
    let Some(mut rig) = EngineRig::start(LEGIBILITY_HTML, qual_geometry(1280.0, 720.0, 1.0)).await else {
        return;
    };
    let out = std::path::PathBuf::from(
        std::env::var("DAM_HOPPER_QUAL_LEGIBILITY_DIR").unwrap_or_else(|_| "/tmp/dh-qual/legibility".into()),
    );
    std::fs::create_dir_all(&out).unwrap();
    // Stage indexes of the distinct (quality, scale) pairs; the run starts at Medium (stage 2),
    // so it is captured last (every step changes the native key).
    let stages = [(0usize, 80u8, 1000u16), (4, 60, 1000), (5, 60, 750), (7, 55, 750), (8, 55, 500), (2, 65, 1000)];
    let mut sizes = HashMap::new();
    for (idx, quality, scale) in stages {
        let st = rig.producer.capture_state().ladder().stage(idx);
        assert_eq!((st.jpeg_quality, st.scale_permille), (quality, scale), "ladder stage {idx}");
        let first = rig.switch_to_stage(idx).await.first;
        let (frame, skipped) = rig.settled(first, expected_dims(1280.0, 720.0, scale)).await;
        let jpeg = frame.jpeg();
        let (w, h, rgb) = decode_rgb(jpeg);
        // Content sanity only: the dark panel (left) must be darker than the light panel (right).
        let mean = |x0: usize, x1: usize| {
            let (mut sum, mut n) = (0u64, 0u64);
            for y in 0..h {
                for x in x0..x1 {
                    let p = &rgb[(y * w + x) * 3..(y * w + x) * 3 + 3];
                    sum += u64::from(p[0]) + u64::from(p[1]) + u64::from(p[2]);
                    n += 3;
                }
            }
            sum as f64 / n as f64
        };
        let (left, right) = (mean(0, w / 2), mean(w / 2, w));
        assert!(right > left + 60.0, "fixture panels not captured: {left} vs {right}");
        let file = out.join(format!("full-{quality}-{scale}.jpg"));
        std::fs::write(&file, jpeg).unwrap();
        sizes.insert((quality, scale), jpeg.len());
        println!(
            "QUAL|legibility|stage={idx}|q={quality}|scale={scale}|bytes={}|sof={w}x{h}|skippedStale={skipped}|meanLeft={left:.1}|meanRight={right:.1}|file={}",
            jpeg.len(), file.display()
        );
    }
    assert!(sizes[&(80, 1000)] > sizes[&(55, 500)], "the finest stage is larger than the coarsest");
    rig.finish().await;
}
