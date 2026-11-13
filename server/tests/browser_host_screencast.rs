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
