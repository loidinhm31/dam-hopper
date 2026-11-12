use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use chromiumoxide_cdp::cdp::browser_protocol::target::CreateTargetParams;
use dam_hopper_server::browser_host::cdp::CdpClient;
use dam_hopper_server::browser_host::process::{find_browser_executable, BrowserLaunchConfig, BrowserProcess};
use dam_hopper_server::browser_host::protocol::{
    unpack_bhjf_frame, TargetGeometry, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH,
};
use dam_hopper_server::browser_host::screencast::{ScreencastProducer, ScreencastState};
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
