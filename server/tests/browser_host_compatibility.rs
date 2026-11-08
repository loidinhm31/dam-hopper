use std::time::Duration;

use chromiumoxide_cdp::cdp::browser_protocol::browser::GetVersionParams;
use chromiumoxide_cdp::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, CaptureScreenshotParams, EnableParams, GetLayoutMetricsParams,
    StartScreencastFormat, StartScreencastParams,
};
use chromiumoxide_cdp::cdp::browser_protocol::target::{
    AttachToTargetParams, CreateTargetParams,
};
use tempfile::tempdir;
use tokio::time::timeout;

use dam_hopper_server::browser_host::cdp::CdpClient;
use dam_hopper_server::browser_host::process::{
    find_browser_executable, BrowserLaunchConfig, BrowserProcess,
};
use dam_hopper_server::browser_host::protocol::{
    parse_jpeg_dimensions, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH,
};

#[tokio::test]
async fn test_browser_compatibility_and_cdp_streaming() {
    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(e) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found: {e}");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    println!("[Engine Qualification] Target browser: {}", exec.display());

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("browser-compat-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut process = BrowserProcess::launch(config)
        .await
        .expect("browser launch failed");
    let ws_url = process.ws_endpoint().to_string();

    let client = CdpClient::connect(&ws_url)
        .await
        .expect("CDP client connect failed");

    // 1. Browser.getVersion probe
    let version_res = client
        .send_typed(GetVersionParams::default(), None)
        .await
        .expect("Browser.getVersion failed");
    println!(
        "[Engine Qualification] Product: {}, Protocol: {}, User-Agent: {}",
        version_res.product, version_res.protocol_version, version_res.user_agent
    );
    assert!(!version_res.product.is_empty());

    // 2. Target.createTarget probe
    let create_target = CreateTargetParams::builder().url("about:blank").build().unwrap();
    let target_res = client
        .send_typed(create_target, None)
        .await
        .expect("Target.createTarget failed");
    let target_id = target_res.target_id;
    println!("[Engine Qualification] Created target: {:?}", target_id);

    // 3. Target.attachToTarget probe with flattened session
    let attach_params = AttachToTargetParams::builder()
        .target_id(target_id.clone())
        .flatten(true)
        .build()
        .unwrap();
    let attach_res = client
        .send_typed(attach_params, None)
        .await
        .expect("Target.attachToTarget failed");
    let session_id: String = attach_res.session_id.into();
    println!("[Engine Qualification] Attached session: {}", session_id);

    // 4. Page.enable
    client
        .send_typed(EnableParams::default(), Some(&session_id))
        .await
        .expect("Page.enable failed");

    // 5. Subscribe to screencast frames BEFORE starting screencast
    let mut screencast_rx = client.subscribe_screencast();

    // 6. Page.startScreencast
    let screencast_params = StartScreencastParams::builder()
        .format(StartScreencastFormat::Jpeg)
        .quality(65)
        .max_width(1280)
        .max_height(900)
        .every_nth_frame(1)
        .build();

    client
        .send_typed(screencast_params, Some(&session_id))
        .await
        .expect("Page.startScreencast failed");

    // 7. Receive initial frame within 10s
    let frame_event = timeout(Duration::from_secs(10), screencast_rx.recv())
        .await
        .expect("timed out waiting for screencast frame")
        .expect("screencast broadcast channel closed");

    println!(
        "[Engine Qualification] Received frame #{} for session {} (base64 len: {})",
        frame_event.frame_session_id, frame_event.session_id, frame_event.data_base64.len()
    );

    // Decode JPEG base64 payload to verify valid JPEG format and dimensions
    use base64::Engine;
    let jpeg_bytes = base64::engine::general_purpose::STANDARD
        .decode(&frame_event.data_base64)
        .expect("invalid base64 in screencast frame");

    let (frame_w, frame_h) =
        parse_jpeg_dimensions(&jpeg_bytes).expect("screencast frame is not a valid JPEG");
    println!(
        "[Engine Qualification] Screencast JPEG SOF dimensions: {}x{}",
        frame_w, frame_h
    );
    assert!(frame_w > 0 && frame_w <= MAX_IMAGE_WIDTH);
    assert!(frame_h > 0 && frame_h <= MAX_IMAGE_HEIGHT);

    // 8. Prompt exact-once ACK accounting via decoupled ack_screencast_frame
    client
        .ack_screencast_frame(&session_id, frame_event.frame_session_id)
        .await
        .expect("ack_screencast_frame failed");

    // 9. Query layout metrics: Page.getLayoutMetrics
    let metrics = client
        .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
        .await
        .expect("Page.getLayoutMetrics failed");

    println!(
        "[Engine Qualification] Layout metrics: cssLayoutViewSize={:?}",
        metrics.css_layout_viewport
    );

    // 10. Single per-epoch recovery screenshot verification: Page.captureScreenshot
    let capture_params = CaptureScreenshotParams::builder()
        .format(CaptureScreenshotFormat::Jpeg)
        .quality(65)
        .build();
    let shot = client
        .send_typed(capture_params, Some(&session_id))
        .await
        .expect("Page.captureScreenshot failed");

    let shot_bytes = base64::engine::general_purpose::STANDARD
        .decode(&shot.data)
        .expect("invalid base64 in captureScreenshot");
    let (shot_w, shot_h) = parse_jpeg_dimensions(&shot_bytes).expect("shot not valid JPEG");
    println!(
        "[Engine Qualification] Recovery screenshot dimensions: {}x{}",
        shot_w, shot_h
    );
    assert!(shot_w > 0 && shot_h > 0);

    // Clean teardown
    client.close().await;
    process.terminate().await.expect("process terminate failed");

    println!("[Engine Qualification] Real-engine qualification completed successfully!");
}

#[tokio::test]
async fn test_non_unit_zoom_dom_click_fixture() {
    use base64::Engine;

    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(e) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found: {e}");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    println!("[Zoom Qualification] Target browser: {}", exec.display());

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("browser-zoom-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut process = BrowserProcess::launch(config)
        .await
        .expect("browser launch failed");
    let ws_url = process.ws_endpoint().to_string();

    let client = CdpClient::connect(&ws_url)
        .await
        .expect("CDP client connect failed");

    // HTML fixture containing multiple distinct target elements at known layout positions
    let html_content = r#"<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; width: 3000px; height: 3000px; background: #fff; }
  .target-btn {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #000;
  }
  #btn-alpha { left: 100px; top: 120px; width: 150px; height: 60px; background: #ffaaaa; }
  #btn-beta  { left: 350px; top: 300px; width: 180px; height: 70px; background: #aaffaa; }
  #btn-gamma { left: 700px; top: 180px; width: 120px; height: 90px; background: #aaaaff; }
</style>
</head>
<body>
  <button id="btn-alpha" class="target-btn">Alpha</button>
  <button id="btn-beta" class="target-btn">Beta</button>
  <button id="btn-gamma" class="target-btn">Gamma</button>
  <script>
    window.__clicks = [];
    document.querySelectorAll('.target-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        window.__clicks.push({
          id: btn.id,
          clientX: e.clientX,
          clientY: e.clientY,
          pageX: e.pageX,
          pageY: e.pageY,
          dpr: window.devicePixelRatio
        });
      });
    });
  </script>
</body>
</html>"#;

    let b64 = base64::engine::general_purpose::STANDARD.encode(html_content);
    let target_url = format!("data:text/html;base64,{b64}");

    // Create target and attach
    let create_target = CreateTargetParams::builder().url(&target_url).build().unwrap();
    let target_res = client
        .send_typed(create_target, None)
        .await
        .expect("Target.createTarget failed");
    let target_id = target_res.target_id;

    let attach_params = AttachToTargetParams::builder()
        .target_id(target_id)
        .flatten(true)
        .build()
        .unwrap();
    let attach_res = client
        .send_typed(attach_params, None)
        .await
        .expect("Target.attachToTarget failed");
    let session_id: String = attach_res.session_id.into();

    client
        .send_typed(EnableParams::default(), Some(&session_id))
        .await
        .expect("Page.enable failed");
    client
        .send_command("Runtime.enable", None, Some(&session_id))
        .await
        .expect("Runtime.enable failed");

    struct TestCase {
        name: &'static str,
        dpr: f64,
        zoom: &'static str,
        page_scale: f64,
        scroll_x: i64,
        scroll_y: i64,
        target_id: &'static str,
    }

    let test_cases = vec![
        TestCase {
            name: "Baseline 1.0 (DPR 1, Zoom 100%, PageScale 1.0, Scroll 0,0)",
            dpr: 1.0,
            zoom: "1.0",
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            target_id: "btn-alpha",
        },
        TestCase {
            name: "DPR 2.0 (Retina display scaling)",
            dpr: 2.0,
            zoom: "1.0",
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            target_id: "btn-beta",
        },
        TestCase {
            name: "CSS Zoom 80% (body.style.zoom = '0.8')",
            dpr: 1.0,
            zoom: "0.8",
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            target_id: "btn-alpha",
        },
        TestCase {
            name: "CSS Zoom 125% (body.style.zoom = '1.25')",
            dpr: 1.0,
            zoom: "1.25",
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            target_id: "btn-gamma",
        },
        TestCase {
            name: "CSS Zoom 200% (body.style.zoom = '2.0')",
            dpr: 1.0,
            zoom: "2.0",
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            target_id: "btn-alpha",
        },
        TestCase {
            name: "Pinch / PageScale 2.0",
            dpr: 1.0,
            zoom: "1.0",
            page_scale: 2.0,
            scroll_x: 0,
            scroll_y: 0,
            target_id: "btn-alpha",
        },
        TestCase {
            name: "Document Scroll (scroll 50, 40)",
            dpr: 1.0,
            zoom: "1.0",
            page_scale: 1.0,
            scroll_x: 50,
            scroll_y: 40,
            target_id: "btn-beta",
        },
    ];

    for tc in test_cases {
        println!("\n[Zoom Qualification Case] === Running: {} ===", tc.name);

        // Reset overrides & clear clicks
        client.send_command("Emulation.clearDeviceMetricsOverride", None, Some(&session_id)).await.ok();
        client.send_command("Emulation.resetPageScaleFactor", None, Some(&session_id)).await.ok();
        client.send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": "document.body.style.zoom = '1.0'; window.scrollTo(0, 0); window.__clicks = [];",
                "returnByValue": true
            })),
            Some(&session_id)
        ).await.expect("reset failed");

        // Apply DPR via Emulation.setDeviceMetricsOverride
        client.send_command(
            "Emulation.setDeviceMetricsOverride",
            Some(serde_json::json!({
                "width": 1280,
                "height": 900,
                "deviceScaleFactor": tc.dpr,
                "mobile": false
            })),
            Some(&session_id)
        ).await.expect("setDeviceMetricsOverride failed");

        // Apply PageScale via Emulation.setPageScaleFactor
        if (tc.page_scale - 1.0).abs() > 1e-4 {
            client.send_command(
                "Emulation.setPageScaleFactor",
                Some(serde_json::json!({
                    "pageScaleFactor": tc.page_scale
                })),
                Some(&session_id)
            ).await.expect("setPageScaleFactor failed");
        }

        // Apply browser zoom and scroll via DOM
        client.send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": format!("document.body.style.zoom = '{}'; window.scrollTo({}, {});", tc.zoom, tc.scroll_x, tc.scroll_y),
                "returnByValue": true
            })),
            Some(&session_id)
        ).await.expect("apply zoom and scroll failed");

        // Give layout a brief moment to settle
        tokio::time::sleep(Duration::from_millis(100)).await;

        // 1. Query layout metrics
        let metrics = client
            .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
            .await
            .expect("getLayoutMetrics failed");

        let vv = &metrics.css_visual_viewport;
        let lv = &metrics.css_layout_viewport;
        println!(
            "  VisualViewport: size={}x{}, offset=({}, {}), page=({}, {}), scale={:?}, zoom={:?}",
            vv.client_width, vv.client_height, vv.offset_x, vv.offset_y, vv.page_x, vv.page_y, vv.scale, vv.zoom
        );
        println!(
            "  LayoutViewport: size={}x{}, page=({}, {})",
            lv.client_width, lv.client_height, lv.page_x, lv.page_y
        );

        // 2. Independently query the target element's bounding client rect from the DOM
        let rect_res = client.send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": format!(
                    "(() => {{ const r = document.getElementById('{}').getBoundingClientRect(); return {{ left: r.left, top: r.top, width: r.width, height: r.height }}; }})()",
                    tc.target_id
                ),
                "returnByValue": true
            })),
            Some(&session_id)
        ).await.expect("rect evaluation failed");

        let rect_val = rect_res.get("result").and_then(|r| r.get("value")).expect("missing rect value");
        let rect_left = rect_val["left"].as_f64().unwrap();
        let rect_top = rect_val["top"].as_f64().unwrap();
        let rect_width = rect_val["width"].as_f64().unwrap();
        let rect_height = rect_val["height"].as_f64().unwrap();

        println!(
            "  Element '{}' getBoundingClientRect: left={}, top={}, width={}, height={}",
            tc.target_id, rect_left, rect_top, rect_width, rect_height
        );

        // 3. Compute button center in visual viewport coordinates
        let target_cx = rect_left + rect_width / 2.0;
        let target_cy = rect_top + rect_height / 2.0;

        // 4. Normalized image fractions u, v on the screencast visual viewport
        let u = target_cx / (vv.client_width as f64);
        let v = target_cy / (vv.client_height as f64);

        // 5. Authoritative coordinate mapping formula under test:
        // x = visualViewport.offsetX + u * visualViewport.clientWidth
        // y = visualViewport.offsetY + v * visualViewport.clientHeight + offsetTop
        let offset_top = 0.0; // web content target without chrome header
        let cdp_x = vv.offset_x + u * (vv.client_width as f64);
        let cdp_y = vv.offset_y + v * (vv.client_height as f64) + offset_top;

        println!(
            "  Computed click: u={:.4}, v={:.4} => CDP coords: ({:.2}, {:.2})",
            u, v, cdp_x, cdp_y
        );

        // 6. Dispatch mouse click at calculated CDP coordinates
        client.send_command(
            "Input.dispatchMouseEvent",
            Some(serde_json::json!({
                "type": "mousePressed",
                "x": cdp_x,
                "y": cdp_y,
                "button": "left",
                "clickCount": 1
            })),
            Some(&session_id)
        ).await.expect("Input.dispatchMouseEvent pressed failed");

        client.send_command(
            "Input.dispatchMouseEvent",
            Some(serde_json::json!({
                "type": "mouseReleased",
                "x": cdp_x,
                "y": cdp_y,
                "button": "left",
                "clickCount": 1
            })),
            Some(&session_id)
        ).await.expect("Input.dispatchMouseEvent released failed");

        // 7. Verify recorded clicks in page
        let clicks_res = client.send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": "JSON.stringify(window.__clicks)",
                "returnByValue": true
            })),
            Some(&session_id)
        ).await.expect("clicks evaluation failed");

        let clicks_str = clicks_res
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("[]");

        let clicks_val: serde_json::Value = serde_json::from_str(clicks_str).unwrap();
        let clicks_arr = clicks_val.as_array().expect("window.__clicks should be array");

        println!("  Clicks recorded: {:?}", clicks_arr);
        assert!(
            !clicks_arr.is_empty(),
            "Case '{}' failed: expected click on '{}', but no clicks were recorded in window.__clicks",
            tc.name, tc.target_id
        );

        let last_click = clicks_arr.last().unwrap();
        assert_eq!(
            last_click["id"].as_str(),
            Some(tc.target_id),
            "Case '{}' failed: click registered on '{}', expected '{}'",
            tc.name, last_click["id"], tc.target_id
        );

        let click_cx = last_click["clientX"].as_f64().unwrap();
        let click_cy = last_click["clientY"].as_f64().unwrap();
        assert!(
            click_cx >= rect_left && click_cx <= rect_left + rect_width,
            "Click X ({}) outside target bounds [{}, {}]",
            click_cx, rect_left, rect_left + rect_width
        );
        assert!(
            click_cy >= rect_top && click_cy <= rect_top + rect_height,
            "Click Y ({}) outside target bounds [{}, {}]",
            click_cy, rect_top, rect_top + rect_height
        );

        println!("  ✓ Click successfully hit target '{}' at ({:.1}, {:.1}) within bounds!", tc.target_id, click_cx, click_cy);
    }

    // Clean teardown
    client.close().await;
    process.terminate().await.expect("process terminate failed");
    println!("[Zoom Qualification] All DOM target click mapping cases under CSS zoom, DPR, pageScale, and document scroll completed successfully!");
}
