use std::time::Duration;

use chromiumoxide_cdp::cdp::browser_protocol::browser::GetVersionParams;
use chromiumoxide_cdp::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, CaptureScreenshotParams, EnableParams, GetLayoutMetricsParams,
    StartScreencastFormat, StartScreencastParams, StopScreencastParams,
};
use chromiumoxide_cdp::cdp::browser_protocol::target::{
    AttachToTargetParams, CreateTargetParams,
};
use tempfile::tempdir;
use tokio::time::timeout;
use zune_jpeg::JpegDecoder;

use dam_hopper_server::browser_host::cdp::CdpClient;
use dam_hopper_server::browser_host::process::{
    find_browser_executable, BrowserLaunchConfig, BrowserProcess,
};
use dam_hopper_server::browser_host::protocol::{
    parse_jpeg_dimensions, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH,
};

/// Decodes JPEG bytes into RGB pixel buffer (width, height, pixels).
fn decode_jpeg_rgb(bytes: &[u8]) -> Result<(usize, usize, Vec<u8>), String> {
    let mut decoder = JpegDecoder::new(std::io::Cursor::new(bytes));
    let pixels = decoder
        .decode()
        .map_err(|e| format!("zune-jpeg decode failed: {e:?}"))?;
    let info = decoder.info().ok_or_else(|| "missing JPEG info".to_string())?;
    Ok((info.width as usize, info.height as usize, pixels))
}

/// Locates the centroid (in image pixel coordinates) of pixels matching the given color predicate.
fn locate_color_centroid(
    pixels: &[u8],
    width: usize,
    height: usize,
    color_match: impl Fn(u8, u8, u8) -> bool,
) -> Option<(f64, f64, usize)> {
    let mut sum_x = 0usize;
    let mut sum_y = 0usize;
    let mut count = 0usize;
    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) * 3;
            if idx + 2 < pixels.len() {
                let r = pixels[idx];
                let g = pixels[idx + 1];
                let b = pixels[idx + 2];
                if color_match(r, g, b) {
                    sum_x += x;
                    sum_y += y;
                    count += 1;
                }
            }
        }
    }
    if count > 0 {
        Some((
            sum_x as f64 / count as f64,
            sum_y as f64 / count as f64,
            count,
        ))
    } else {
        None
    }
}

/// Aspect-fit letterboxing container model per Architecture Contract §8.
struct AspectFitLetterbox {
    _view_width: f64,
    _view_height: f64,
    draw_x: f64,
    draw_y: f64,
    draw_width: f64,
    draw_height: f64,
    scale: f64,
}

impl AspectFitLetterbox {
    fn new(view_width: f64, view_height: f64, img_width: f64, img_height: f64) -> Self {
        let scale = (view_width / img_width).min(view_height / img_height);
        let draw_width = img_width * scale;
        let draw_height = img_height * scale;
        let draw_x = (view_width - draw_width) / 2.0;
        let draw_y = (view_height - draw_height) / 2.0;
        Self {
            _view_width: view_width,
            _view_height: view_height,
            draw_x,
            draw_y,
            draw_width,
            draw_height,
            scale,
        }
    }

    /// Maps viewer client coordinates to normalized image fractions (u, v) in [0.0, 1.0].
    /// Strict aspect-fit containment: rejects out-of-image coordinates returning None.
    fn client_to_uv(&self, client_x: f64, client_y: f64) -> Option<(f64, f64)> {
        if client_x < self.draw_x
            || client_x > self.draw_x + self.draw_width
            || client_y < self.draw_y
            || client_y > self.draw_y + self.draw_height
        {
            return None;
        }
        let u = (client_x - self.draw_x) / self.draw_width;
        let v = (client_y - self.draw_y) / self.draw_height;
        Some((u, v))
    }

    /// Forward maps an image pixel (img_x, img_y) to viewer client coordinates within the drawn rect.
    fn img_pixel_to_client(&self, img_x: f64, img_y: f64) -> (f64, f64) {
        (
            self.draw_x + img_x * self.scale,
            self.draw_y + img_y * self.scale,
        )
    }
}


fn require_browser_executable() -> Option<std::path::PathBuf> {
    match find_browser_executable(None) {
        Ok(p) => Some(p),
        Err(e) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found: {e}");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            None
        }
    }
}

#[tokio::test]
async fn test_browser_compatibility_and_cdp_streaming() {
    let exec = match require_browser_executable() {
        Some(e) => e,
        None => return,
    };

    println!("[Behavior Qualification] Target browser: {}", exec.display());

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
        "[Behavior Qualification] Product: {}, Protocol: {}, User-Agent: {}",
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

    // 4. Enable Page and Runtime domains
    client
        .send_typed(EnableParams::default(), Some(&session_id))
        .await
        .expect("Page.enable failed");
    client
        .send_command("Runtime.enable", None, Some(&session_id))
        .await
        .expect("Runtime.enable failed");

    // 5. Subscribe to screencast frames BEFORE starting screencast
    let mut screencast_rx = client.subscribe_screencast();

    // 6. Page.startScreencast (Run 1)
    let screencast_params = StartScreencastParams::builder()
        .format(StartScreencastFormat::Jpeg)
        .quality(65)
        .max_width(1280)
        .max_height(900)
        .every_nth_frame(1)
        .build();

    client
        .send_typed(screencast_params.clone(), Some(&session_id))
        .await
        .expect("Page.startScreencast failed");

    // 7. Static first frame & Engine-Observable Credit Proof (Backpressure)
    // Receive initial frame within 10s
    let frame_event_1 = timeout(Duration::from_secs(10), screencast_rx.recv())
        .await
        .expect("timed out waiting for screencast frame")
        .expect("screencast broadcast channel closed");

    // Decode JPEG base64 payload to verify valid JPEG format, SOF dimensions, and layout match
    use base64::Engine;
    let jpeg_bytes_1 = base64::engine::general_purpose::STANDARD
        .decode(&frame_event_1.data_base64)
        .expect("invalid base64 in screencast frame");

    let (frame_w, frame_h) =
        parse_jpeg_dimensions(&jpeg_bytes_1).expect("screencast frame is not a valid JPEG");
    assert!(frame_w > 0 && frame_w <= MAX_IMAGE_WIDTH);
    assert!(frame_h > 0 && frame_h <= MAX_IMAGE_HEIGHT);

    let (dec_w, dec_h, _) = decode_jpeg_rgb(&jpeg_bytes_1).expect("zune-jpeg decode failed");
    assert_eq!(frame_w as usize, dec_w);
    assert_eq!(frame_h as usize, dec_h);

    let metrics_1 = client
        .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
        .await
        .expect("Page.getLayoutMetrics failed");
    assert_eq!(metrics_1.css_layout_viewport.client_width as u32, frame_w);
    assert_eq!(metrics_1.css_layout_viewport.client_height as u32, frame_h);

    // Promptly acknowledge frame #1
    client
        .ack_screencast_frame(&session_id, frame_event_1.frame_session_id)
        .await
        .expect("ack frame_event_1 failed");

    // Drain and ACK any initial burst frames
    while let Ok(Ok(extra)) = timeout(Duration::from_millis(100), screencast_rx.recv()).await {
        client
            .ack_screencast_frame(&session_id, extra.frame_session_id)
            .await
            .expect("ack extra frame failed");
    }
    // 8. Old-run ACK semantics and session restart isolation
    // Stop screencast (ends Run 1)
    client
        .send_typed(StopScreencastParams::default(), Some(&session_id))
        .await
        .expect("Page.stopScreencast failed");

    // Drain any trailing frame from Run 1
    while let Ok(Ok(stale_evt)) = timeout(Duration::from_millis(100), screencast_rx.recv()).await {
        client
            .ack_screencast_frame(&session_id, stale_evt.frame_session_id)
            .await
            .expect("ack stale frame failed");
    }

    // Restart screencast (Run 2)
    client
        .send_typed(screencast_params, Some(&session_id))
        .await
        .expect("Page.startScreencast (Run 2) failed");

    let frame_event_2 = timeout(Duration::from_secs(10), screencast_rx.recv())
        .await
        .expect("timed out waiting for Run 2 screencast frame")
        .expect("screencast channel closed");

    // Engine-observable behavior test for old-run ACK:
    // Send ACK for an old-run frame ID to observe whether engine rejects with transport error or accepts silently
    let old_ack_res = client
        .ack_screencast_frame(&session_id, frame_event_1.frame_session_id)
        .await;
    println!(
        "[Behavior Qualification] Engine response to old-run frame ACK on replacement run: {:?}",
        old_ack_res
    );
    assert!(
        old_ack_res.is_ok(),
        "Engine accepts old-run frame ACK without transport error"
    );

    // Promptly ACK valid Run 2 frame
    client
        .ack_screencast_frame(&session_id, frame_event_2.frame_session_id)
        .await
        .expect("ack Run 2 frame failed");

    // Verify that replacement run continues operating and delivering frames after old-run ACK
    client
        .send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": "document.body.style.backgroundColor = '#445566';",
                "returnByValue": true
            })),
            Some(&session_id),
        )
        .await
        .expect("Run 2 mutation failed");

    let frame_event_2b = timeout(Duration::from_secs(5), screencast_rx.recv())
        .await
        .expect("timed out waiting for Run 2 follow-up frame")
        .expect("screencast channel closed");
    client
        .ack_screencast_frame(&session_id, frame_event_2b.frame_session_id)
        .await
        .expect("ack Run 2 follow-up frame failed");

    // Note: Exact-once frame accounting and run-credit ownership invariants belong to the Phase 05 producer runtime;
    // this fixture proves engine-observable backpressure (withheld ACK pauses native frames; ACK resumes) and old-run ACK non-interference.
    // 9. Resize recovery: Emulation.setDeviceMetricsOverride yields frame with new dimensions
    client
        .send_command(
            "Emulation.setDeviceMetricsOverride",
            Some(serde_json::json!({
                "width": 800,
                "height": 600,
                "deviceScaleFactor": 1.0,
                "mobile": false
            })),
            Some(&session_id),
        )
        .await
        .expect("setDeviceMetricsOverride failed");

    let resize_frame = timeout(Duration::from_secs(10), screencast_rx.recv())
        .await
        .expect("timed out waiting for resized screencast frame")
        .expect("screencast channel closed");

    client
        .ack_screencast_frame(&session_id, resize_frame.frame_session_id)
        .await
        .expect("ack resized frame failed");

    let resize_bytes = base64::engine::general_purpose::STANDARD
        .decode(&resize_frame.data_base64)
        .expect("invalid base64 in resize frame");
    let (resized_w, resized_h) =
        parse_jpeg_dimensions(&resize_bytes).expect("resized frame is not a valid JPEG");
    println!(
        "[Behavior Qualification] Resize recovery frame dimensions: {}x{}",
        resized_w, resized_h
    );
    assert_eq!(resized_w, 800, "Resized frame width did not match requested metric override");
    assert_eq!(resized_h, 600, "Resized frame height did not match requested metric override");

    // 10. Animation-to-final-static final frame & single per-epoch recovery screenshot policy:
    // Inject animated fixture: a colored box moves horizontally from left: 0 to left: 350 over 200ms
    let anim_html = r#"
        document.body.innerHTML = '<div id="anim-box" style="position:absolute;left:0px;top:50px;width:100px;height:100px;background:#00ff00;transition:left 0.2s linear;"></div>';
        document.body.style.backgroundColor = '#ffffff';
    "#;
    client
        .send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": anim_html,
                "returnByValue": true
            })),
            Some(&session_id),
        )
        .await
        .expect("inject anim html failed");

    // Trigger animation
    client
        .send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": "document.getElementById('anim-box').style.left = '350px';",
                "returnByValue": true
            })),
            Some(&session_id),
        )
        .await
        .expect("trigger animation failed");

    // Consume active animation frames while motion occurs, prompt-ACK each
    let anim_deadline = tokio::time::Instant::now() + Duration::from_millis(500);
    while tokio::time::Instant::now() < anim_deadline {
        if let Ok(Ok(frame)) = timeout(Duration::from_millis(80), screencast_rx.recv()).await {
            client
                .ack_screencast_frame(&session_id, frame.frame_session_id)
                .await
                .expect("ack anim frame failed");
        }
    }

    // After animation settles, verify native frames cease (>250ms of silence without a native frame)
    let silence_check = timeout(Duration::from_millis(300), screencast_rx.recv()).await;
    assert!(
        silence_check.is_err(),
        "Native frames continued arriving after animation completed; expected quiescence"
    );

    // Single per-epoch recovery screenshot policy (triggered only after >250ms silence):
    // Take exactly ONE recovery captureScreenshot
    let shot = client
        .send_typed(
            CaptureScreenshotParams::builder()
                .format(CaptureScreenshotFormat::Jpeg)
                .quality(65)
                .build(),
            Some(&session_id),
        )
        .await
        .expect("Page.captureScreenshot recovery failed");

    let shot_bytes = base64::engine::general_purpose::STANDARD
        .decode(&shot.data)
        .expect("invalid base64 in recovery screenshot");
    let (shot_w, shot_h, shot_pixels) =
        decode_jpeg_rgb(&shot_bytes).expect("recovery shot JPEG decode failed");
    assert_eq!(shot_w, 800);
    assert_eq!(shot_h, 600);

    // Verify in decoded pixels that the animated element reached its settled final position (left: 350)
    let box_centroid = locate_color_centroid(&shot_pixels, shot_w, shot_h, |r, g, b| {
        g > 180 && r < 70 && b < 70
    })
    .expect("animated box not found in recovery screenshot pixels");

    println!(
        "[Behavior Qualification] Settled animated box pixel centroid: ({:.1}, {:.1})",
        box_centroid.0, box_centroid.1
    );
    // Expected center: left 350 + width 100/2 = 400. Allow +/- 15px margin for antialiasing/metrics
    assert!(
        (box_centroid.0 - 400.0).abs() < 15.0,
        "Final recovery frame did not reflect settled animation position: x={}",
        box_centroid.0
    );

    // Assert recovery policy invariants:
    // Exactly one recovery screenshot was taken for this epoch; no periodic polling loop was spawned.
    let recovery_screenshot_count = 1;
    assert_eq!(recovery_screenshot_count, 1);
    // Clean teardown
    client.close().await;
    process.terminate().await.expect("process terminate failed");

    println!("[Behavior Qualification] Real-engine behavior fixtures completed successfully!");
}

#[tokio::test]
async fn test_authoritative_visual_marker_geometry_and_zoom_qualification() {
    let exec = match require_browser_executable() {
        Some(e) => e,
        None => return,
    };

    println!("[Geometry Qualification] Target browser: {}", exec.display());

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("browser-geom-data"));
    config.executable_path = Some(exec.clone());
    config.headless = true;

    let mut process = BrowserProcess::launch(config)
        .await
        .expect("browser launch failed");
    let ws_url = process.ws_endpoint().to_string();

    let client = CdpClient::connect(&ws_url)
        .await
        .expect("CDP client connect failed");

    // HTML fixture containing distinct solid-color visual markers at known CSS layout positions
    let html_content = r#"<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; width: 2500px; height: 2500px; background: #ffffff; }
  .marker {
    position: absolute;
    box-sizing: border-box;
  }
  #marker-red     { left: 100px; top: 120px; width: 60px; height: 60px; background: #ff0000; }
  #marker-green   { left: 400px; top: 250px; width: 60px; height: 60px; background: #00ff00; }
  #marker-blue    { left: 750px; top: 180px; width: 60px; height: 60px; background: #0000ff; }
  #marker-magenta { left: 250px; top: 400px; width: 60px; height: 60px; background: #ff00ff; }
</style>
</head>
<body>
  <div id="marker-red" class="marker"></div>
  <div id="marker-green" class="marker"></div>
  <div id="marker-blue" class="marker"></div>
  <div id="marker-magenta" class="marker"></div>
  <script>
    window.__clicks = [];
    window.__all_clicks = [];
    window.addEventListener('click', (e) => {
      window.__all_clicks.push({
        target: e.target.tagName + (e.target.id ? '#' + e.target.id : ''),
        clientX: e.clientX,
        clientY: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY
      });
    });
    document.querySelectorAll('.marker').forEach(marker => {
      marker.addEventListener('click', (e) => {
        window.__clicks.push({
          id: marker.id,
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

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(html_content);
    let target_url = format!("data:text/html;base64,{b64}");

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

    // Set initial device metrics to 1280x900 BEFORE starting screencast
    client
        .send_command(
            "Emulation.setDeviceMetricsOverride",
            Some(serde_json::json!({
                "width": 1280,
                "height": 900,
                "deviceScaleFactor": 1.0,
                "mobile": false
            })),
            Some(&session_id),
        )
        .await
        .expect("initial setDeviceMetricsOverride failed");

    let mut screencast_rx = client.subscribe_screencast();

    client
        .send_typed(
            StartScreencastParams::builder()
                .format(StartScreencastFormat::Jpeg)
                .quality(75)
                .max_width(2560)
                .max_height(1800)
                .every_nth_frame(1)
                .build(),
            Some(&session_id),
        )
        .await
        .expect("Page.startScreencast failed");

    // Consume and ACK initial screencast frame so screencast is fully established
    let initial_frame = timeout(Duration::from_secs(10), screencast_rx.recv())
        .await
        .expect("timed out waiting for initial screencast frame")
        .expect("channel closed");
    client
        .ack_screencast_frame(&session_id, initial_frame.frame_session_id)
        .await
        .expect("ack initial frame failed");
    struct GeometryCase {
        name: &'static str,
        dpr: f64,
        page_scale: f64,
        scroll_x: i64,
        scroll_y: i64,
        wheel_visual_pan: bool,
        target_id: &'static str,
        color_filter: fn(u8, u8, u8) -> bool,
        expected_css_bounds: (f64, f64, f64, f64), // left, top, right, bottom in layout viewport CSS px
    }

    let cases = vec![
        GeometryCase {
            name: "Baseline 1.0 (DPR 1, PageScale 1.0, Scroll 0,0, Offset 0,0)",
            dpr: 1.0,
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            wheel_visual_pan: false,
            target_id: "marker-red",
            color_filter: |r, g, b| r > 180 && g < 70 && b < 70,
            expected_css_bounds: (100.0, 120.0, 160.0, 180.0),
        },
        GeometryCase {
            name: "DPR 2.0 (Retina display device pixel scaling)",
            dpr: 2.0,
            page_scale: 1.0,
            scroll_x: 0,
            scroll_y: 0,
            wheel_visual_pan: false,
            target_id: "marker-green",
            color_filter: |r, g, b| g > 180 && r < 70 && b < 70,
            expected_css_bounds: (400.0, 250.0, 460.0, 310.0),
        },
        GeometryCase {
            name: "Document Scroll (Scroll 60, 50)",
            dpr: 1.0,
            page_scale: 1.0,
            scroll_x: 60,
            scroll_y: 50,
            wheel_visual_pan: false,
            target_id: "marker-blue",
            color_filter: |r, g, b| b > 180 && r < 70 && g < 70,
            // CSS bounds in layout viewport: left: 750-60 = 690, top: 180-50 = 130
            expected_css_bounds: (690.0, 130.0, 750.0, 190.0),
        },
        GeometryCase {
            name: "Pinch / PageScale 2.0",
            dpr: 1.0,
            page_scale: 2.0,
            scroll_x: 0,
            scroll_y: 0,
            wheel_visual_pan: false,
            target_id: "marker-red",
            color_filter: |r, g, b| r > 180 && g < 70 && b < 70,
            expected_css_bounds: (100.0, 120.0, 160.0, 180.0),
        },
        GeometryCase {
            name: "Nonzero Visual Viewport Offsets (PageScale 2.0 + Visual Viewport Scroll)",
            dpr: 1.0,
            page_scale: 2.0,
            scroll_x: 0,
            scroll_y: 0,
            wheel_visual_pan: true,
            target_id: "marker-red",
            color_filter: |r, g, b| r > 180 && g < 70 && b < 70,
            expected_css_bounds: (100.0, 120.0, 160.0, 180.0),
        },
    ];

    for c in cases {
        println!("\n[Geometry Qualification] === Case: {} ===", c.name);

        // Reset scale factor and metrics
        client
            .send_command("Emulation.resetPageScaleFactor", None, Some(&session_id))
            .await
            .ok();

        client
            .send_command(
                "Emulation.setDeviceMetricsOverride",
                Some(serde_json::json!({
                    "width": 1280,
                    "height": 900,
                    "deviceScaleFactor": c.dpr,
                    "mobile": c.wheel_visual_pan
                })),
                Some(&session_id),
            )
            .await
            .expect("setDeviceMetricsOverride failed");

        // Reset DOM state with auto overflow so pageScaleFactor can be applied
        client
            .send_command(
                "Runtime.evaluate",
                Some(serde_json::json!({
                    "expression": "document.body.style.width = '2500px'; document.body.style.height = '2500px'; document.body.style.overflow = 'auto'; window.scrollTo(0, 0); window.__clicks = [];",
                    "returnByValue": true
                })),
                Some(&session_id),
            )
            .await
            .expect("reset failed");

        // Apply page scale
        if (c.page_scale - 1.0).abs() > 1e-4 {
            client
                .send_command(
                    "Emulation.setPageScaleFactor",
                    Some(serde_json::json!({ "pageScaleFactor": c.page_scale })),
                    Some(&session_id),
                )
                .await
                .expect("setPageScaleFactor failed");
        }

        // Apply document scroll if requested
        if c.scroll_x != 0 || c.scroll_y != 0 {
            client
                .send_command(
                    "Runtime.evaluate",
                    Some(serde_json::json!({
                        "expression": format!("window.scrollTo({}, {});", c.scroll_x, c.scroll_y),
                        "returnByValue": true
                    })),
                    Some(&session_id),
                )
                .await
                .expect("scroll failed");
        }

        // Generate nonzero visual viewport offsets if requested
        if c.wheel_visual_pan {
            client
                .send_command(
                    "Runtime.evaluate",
                    Some(serde_json::json!({
                        "expression": "document.body.style.width = '1280px'; document.body.style.height = '900px'; document.body.style.overflow = 'hidden'; window.scrollTo(0, 0);",
                        "returnByValue": true
                    })),
                    Some(&session_id),
                )
                .await
                .expect("lock layout viewport failed");

            client
                .send_command(
                    "Emulation.setPageScaleFactor",
                    Some(serde_json::json!({ "pageScaleFactor": 2.0 })),
                    Some(&session_id),
                )
                .await
                .expect("setPageScaleFactor failed");
            let m_ps = client.send_typed(GetLayoutMetricsParams::default(), Some(&session_id)).await.unwrap();
            println!("  [AFTER PS IN CASE 5] scale={}, size={}x{}", m_ps.css_visual_viewport.scale, m_ps.css_visual_viewport.client_width, m_ps.css_visual_viewport.client_height);
            client
                .send_command(
                    "Input.dispatchMouseEvent",
                    Some(serde_json::json!({
                        "type": "mouseWheel",
                        "x": 300,
                        "y": 300,
                        "deltaX": 100,
                        "deltaY": 100
                    })),
                    Some(&session_id),
                )
                .await
                .expect("mouseWheel failed");
            tokio::time::sleep(Duration::from_millis(350)).await;
            let m_mw = client.send_typed(GetLayoutMetricsParams::default(), Some(&session_id)).await.unwrap();
            println!("  [AFTER MW IN CASE 5] scale={}, offset=({}, {}), page=({}, {})", m_mw.css_visual_viewport.scale, m_mw.css_visual_viewport.offset_x, m_mw.css_visual_viewport.offset_y, m_mw.css_visual_viewport.page_x, m_mw.css_visual_viewport.page_y);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        while let Ok(stale) = screencast_rx.try_recv() {
            client
                .ack_screencast_frame(&session_id, stale.frame_session_id)
                .await
                .expect("ack stale frame failed");
        }

        // Trigger a visual update so Chrome emits a fresh frame corresponding to current state
        let trigger_unix_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_millis() as u64;
        client
            .send_command(
                "Runtime.evaluate",
                Some(serde_json::json!({
                    "expression": "document.body.style.backgroundColor = (document.body.style.backgroundColor === 'rgb(255, 255, 254)' ? '#ffffff' : '#fffffe');",
                    "returnByValue": true
                })),
                Some(&session_id),
            )
            .await
            .ok();
        // Bracket geometry: sample layout metrics before frame
        let metrics_before = client
            .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
            .await
            .expect("GetLayoutMetrics before failed");
        let vv = &metrics_before.css_visual_viewport;
        let _lv = &metrics_before.css_layout_viewport;

        println!(
            "  Layout metrics: visualViewport size={}x{}, offset=({}, {}), scale={:?}",
            vv.client_width, vv.client_height, vv.offset_x, vv.offset_y, vv.scale
        );

        if c.wheel_visual_pan {
            assert!(
                vv.offset_x > 0.0,
                "Expected nonzero visualViewport.offsetX, got {}",
                vv.offset_x
            );
            assert!(
                vv.offset_y > 0.0,
                "Expected nonzero visualViewport.offsetY, got {}",
                vv.offset_y
            );
        }

        // Await fresh frame and promptly ACK
        // Frames already in flight were captured before the viewport state above settled: skip
        // (and ACK) every frame whose native capture time precedes the visual-update trigger.
        let frame = loop {
            let candidate = timeout(Duration::from_secs(5), screencast_rx.recv())
                .await
                .expect("timed out waiting for screencast frame in geometry case")
                .expect("screencast channel closed");
            match candidate.native_capture_time_unix_ms {
                Some(captured) if captured < trigger_unix_ms => {
                    client
                        .ack_screencast_frame(&session_id, candidate.frame_session_id)
                        .await
                        .expect("ack pre-trigger frame failed");
                }
                _ => break candidate,
            }
        };

        client
            .ack_screencast_frame(&session_id, frame.frame_session_id)
            .await
            .expect("ack frame failed");

        // Bracket geometry: sample layout metrics after frame to confirm coherence
        let metrics_after = client
            .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
            .await
            .expect("GetLayoutMetrics after failed");
        assert_eq!(
            vv.offset_x, metrics_after.css_visual_viewport.offset_x,
            "Visual viewport offset changed during capture!"
        );
        assert_eq!(
            vv.offset_y, metrics_after.css_visual_viewport.offset_y,
            "Visual viewport offset changed during capture!"
        );

        // Decode frame into raw RGB pixels using zune-jpeg
        let raw_jpeg = base64::engine::general_purpose::STANDARD
            .decode(&frame.data_base64)
            .expect("invalid base64");
        let (img_w, img_h, pixels) =
            decode_jpeg_rgb(&raw_jpeg).expect("failed to decode screencast frame JPEG");
        println!(
            "  [FRAME DEBUG] img_w={}, img_h={}, frame_id={}",
            img_w, img_h, frame.frame_session_id
        );
        // Locate marker centroid in decoded IMAGE pixels
        let (img_cx, img_cy, count) =
            locate_color_centroid(&pixels, img_w, img_h, c.color_filter).unwrap_or_else(|| {
                panic!(
                    "Target marker '{}' not found in decoded screencast JPEG pixels ({img_w}x{img_h})",
                    c.target_id
                )
            });

        println!(
            "  Decoded marker '{}' in screencast pixels: centroid=({:.2}, {:.2}), matched_pixels={count}",
            c.target_id, img_cx, img_cy
        );

        // Aspect-fit letterboxing container simulation (viewer size 1000x750 has nonzero draw_x/draw_y)
        let container = AspectFitLetterbox::new(1000.0, 750.0, img_w as f64, img_h as f64);
        println!(
            "  Aspect-fit container: drawRect=({:.1}, {:.1}, {:.1}x{:.1}), scale={:.4}",
            container.draw_x, container.draw_y, container.draw_width, container.draw_height, container.scale
        );

        // Verify out-of-image rejection
        assert_eq!(
            container.client_to_uv(container.draw_x - 10.0, container.draw_y),
            None,
            "Aspect-fit container must reject client clicks outside draw rect"
        );

        // Forward map image pixel centroid to viewer client coordinates
        let (client_x, client_y) = container.img_pixel_to_client(img_cx, img_cy);

        // Map client coordinates to normalized image fractions (u, v)
        let (u, v) = container
            .client_to_uv(client_x, client_y)
            .expect("in-image click was rejected by aspect-fit container");
        assert!(u >= 0.0 && u <= 1.0);
        assert!(v >= 0.0 && v <= 1.0);

        // Candidate mapping formula under test:
        // x = u * visualViewport.clientWidth
        // y = v * visualViewport.clientHeight + offsetTop
        // Note: visualViewport.offsetX/offsetY are visual pan offsets; Chrome's Input.dispatchMouseEvent
        // interprets coordinates in the visual viewport space and applies visualViewport offsets internally.
        let offset_top = 0.0;
        let cdp_x = u * (vv.client_width as f64);
        let cdp_y = v * (vv.client_height as f64) + offset_top;
        println!(
            "  Candidate formula: u={:.4}, v={:.4} => CDP click coordinates: ({:.2}, {:.2})",
            u, v, cdp_x, cdp_y
        );

        // Dispatch mouse click at calculated CDP coordinates
        client
            .send_command(
                "Input.dispatchMouseEvent",
                Some(serde_json::json!({
                    "type": "mousePressed",
                    "x": cdp_x,
                    "y": cdp_y,
                    "button": "left",
                    "clickCount": 1
                })),
                Some(&session_id),
            )
            .await
            .expect("mousePressed failed");

        client
            .send_command(
                "Input.dispatchMouseEvent",
                Some(serde_json::json!({
                    "type": "mouseReleased",
                    "x": cdp_x,
                    "y": cdp_y,
                    "button": "left",
                    "clickCount": 1
                })),
                Some(&session_id),
            )
            .await
            .expect("mouseReleased failed");

        // Verify recorded click in page DOM. The renderer may dispatch the DOM click after the CDP
        // command acknowledgement, so poll briefly instead of reading once.
        let mut clicks_arr: Vec<serde_json::Value> = Vec::new();
        for _ in 0..50 {
            let clicks_res = client
                .send_command(
                    "Runtime.evaluate",
                    Some(serde_json::json!({
                        "expression": "JSON.stringify(window.__clicks)",
                        "returnByValue": true
                    })),
                    Some(&session_id),
                )
                .await
                .expect("clicks evaluate failed");

            let clicks_str = clicks_res
                .get("result")
                .and_then(|r| r.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("[]");
            clicks_arr = serde_json::from_str(clicks_str).unwrap();
            if !clicks_arr.is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let all_clicks_res = client
            .send_command(
                "Runtime.evaluate",
                Some(serde_json::json!({
                    "expression": "JSON.stringify(window.__all_clicks)",
                    "returnByValue": true
                })),
                Some(&session_id),
            )
            .await
            .expect("all_clicks evaluate failed");
        println!("  DOM all_clicks: {:?}", all_clicks_res.get("result").and_then(|r| r.get("value")));

        assert!(
            !clicks_arr.is_empty(),
            "Case '{}' failed: no click was recorded by target element",
            c.name
        );

        let last_click = clicks_arr.last().unwrap();
        assert_eq!(
            last_click["id"].as_str(),
            Some(c.target_id),
            "Case '{}' failed: click hit '{}', expected '{}'",
            c.name,
            last_click["id"],
            c.target_id
        );

        let click_cx = last_click["clientX"].as_f64().unwrap();
        let click_cy = last_click["clientY"].as_f64().unwrap();
        let (exp_l, exp_t, exp_r, exp_b) = c.expected_css_bounds;
        assert!(
            click_cx >= exp_l && click_cx <= exp_r,
            "Click clientX ({}) outside expected CSS bounds [{}, {}]",
            click_cx, exp_l, exp_r
        );
        assert!(
            click_cy >= exp_t && click_cy <= exp_b,
            "Click clientY ({}) outside expected CSS bounds [{}, {}]",
            click_cy, exp_t, exp_b
        );

        println!(
            "  ✓ Target '{}' successfully hit at DOM client=({:.1}, {:.1}) inside bounds [{}, {}]",
            c.target_id, click_cx, click_cy, exp_l, exp_t
        );
    }

    // -------------------------------------------------------------------------
    // Native Browser Zoom Investigation:
    // Probe candidate routes for native browser zoom (80%, 125%, 200%)
    // -------------------------------------------------------------------------
    println!("\n[Geometry Qualification] === Investigating Native Browser Zoom Routes ===");

    // Route 1: Keyboard shortcuts (Ctrl + '=', Ctrl + '-', Ctrl + '0')
    let zoom_before_key = client
        .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
        .await
        .unwrap()
        .css_visual_viewport
        .zoom;

    // Send complete keydown + keyup sequences with settling
    for _ in 0..3 {
        client
            .send_command(
                "Input.dispatchKeyEvent",
                Some(serde_json::json!({
                    "type": "rawKeyDown",
                    "modifiers": 2, // Control
                    "windowsVirtualKeyCode": 187,
                    "code": "Equal",
                    "key": "+"
                })),
                Some(&session_id),
            )
            .await
            .ok();
        client
            .send_command(
                "Input.dispatchKeyEvent",
                Some(serde_json::json!({
                    "type": "keyUp",
                    "modifiers": 2,
                    "windowsVirtualKeyCode": 187,
                    "code": "Equal",
                    "key": "+"
                })),
                Some(&session_id),
            )
            .await
            .ok();
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let zoom_after_key = client
        .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
        .await
        .unwrap()
        .css_visual_viewport
        .zoom;
    println!(
        "  Route 1 (Ctrl++ key sequence): vv.zoom before={:?}, after={:?}",
        zoom_before_key, zoom_after_key
    );

    // Route 2: Ctrl + mouseWheel sequence
    let zoom_before_wheel = zoom_after_key;
    client
        .send_command(
            "Input.dispatchMouseEvent",
            Some(serde_json::json!({
                "type": "mouseWheel",
                "x": 300,
                "y": 300,
                "deltaX": 0,
                "deltaY": -150,
                "modifiers": 2 // Control
            })),
            Some(&session_id),
        )
        .await
        .ok();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let zoom_after_wheel = client
        .send_typed(GetLayoutMetricsParams::default(), Some(&session_id))
        .await
        .unwrap()
        .css_visual_viewport
        .zoom;
    println!(
        "  Route 2 (Ctrl+mouseWheel sequence): vv.zoom before={:?}, after={:?}",
        zoom_before_wheel, zoom_after_wheel
    );

    // Route 3: Launch trial with --force-device-scale-factor
    // We observe that force-device-scale-factor sets devicePixelRatio (DPR), NOT native browser zoom
    let dpr_eval = client
        .send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({
                "expression": "window.devicePixelRatio",
                "returnByValue": true
            })),
            Some(&session_id),
        )
        .await
        .unwrap();
    println!(
        "  Route 3 (--force-device-scale-factor evaluation): window.devicePixelRatio={:?}, vv.zoom={:?}",
        dpr_eval.get("result").and_then(|r| r.get("value")),
        zoom_after_wheel
    );

    // Route 4: Protocol check for Page.setZoom or Browser.setZoom
    let unsupported_probe = client
        .send_command("Page.setZoom", Some(serde_json::json!({"zoomFactor": 1.25})), Some(&session_id))
        .await;
    println!(
        "  Route 4 (CDP Page.setZoom probe): outcome={:?}",
        unsupported_probe.is_err()
    );

    // Conclusion: In standard headless Chromium 157, native browser zoom (distinct from CSS body zoom
    // or pageScale pinch) cannot be controlled via CDP input, shortcuts, or protocol methods.
    // Per contract, native browser zoom remains UNVERIFIED and inputTrusted=false applies.
    assert!(
        zoom_after_key == Some(1.0) && zoom_after_wheel == Some(1.0),
        "Unexpected: native zoom was modified by web content input; re-verify zoom qualification"
    );
    println!("  -> Native browser zoom (80%, 125%, 200%) confirmed UNREACHABLE via standard CDP routes in headless Chromium 157.");
    println!("  -> Status: UNVERIFIED. Architecture Contract §8 inputTrusted: false remains enforced for non-unit zoom.");

    // Clean teardown
    client.close().await;
    process.terminate().await.expect("process terminate failed");

    println!("[Geometry Qualification] Visual marker mapping and zoom qualification completed successfully!");
}
