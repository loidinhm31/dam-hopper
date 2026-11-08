# Host Browser Engine Qualification Report

- Date: 2026-11-08
- Phase: Phase 01 — Qualify adapter and freeze contracts
- Qualification Fixtures & Reported Test Counts:
  - Unit/Adapter tests: `server/tests/browser_host_adapter.rs` (see slice reports)
  - Colocated lib unit tests: `server/src/browser_host/` (`cdp.rs` + `command_budget.rs`, see slice reports)
  - Process containment tests: `server/tests/browser_host_process.rs` (see slice reports)
  - Live engine compatibility & geometry tests: `server/tests/browser_host_compatibility.rs` (2 tests passing: `test_browser_compatibility_and_cdp_streaming`, `test_authoritative_visual_marker_geometry_and_zoom_qualification`)
  - Auth qualification example: `server/examples/browser_host_qualification.rs` (see slice reports)
  - Playwright E2E compatibility spec: `packages/ui/e2e/os-host-browser/compatibility.spec.ts` (see slice reports)
  - Raw evidence retention: `plans/261108-0237-host-browser-cdp-streaming/reports/evidence/real-engine-geometry-qualification.json`

## 1. Engine & Environment Identification

- **Host OS**: Linux 7.2.15-200.fc44.x86_64 (Fedora 44)
- **Browser Binary**: `/usr/bin/google-chrome`
- **Browser Binary SHA-256**: `aea09d69ce7f24d5901f6bfb15dd44d0c856e793e0a498f8d8393ec7d2c308ec`
- **Engine Version**: `Google Chrome 157.0.8103.38`
- **CDP Protocol Version**: `1.3`
- **Pinned CDP Crates**: `chromiumoxide_cdp = "=0.9.1"`, `chromiumoxide_types = "=0.9.1"` (CDP Revision 1566079)
- **Runtime WebSocket Dependency**: `tokio-tungstenite = "0.28"`.
- **JPEG Decoding Dev-Dependency**: `zune-jpeg = "=0.5.15"`.
- **User-Agent Observed**: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36`

## 2. Bounded Protocol & Framing Verification

*(See Phase 01 Adapter / Process slice reports for mock harness details, buffer limits, and budget assertions).*

## 3. Real-Engine Behavioral Observations (`browser_host_compatibility.rs`)

1. **Static First Frame & Initial Dimensions**:
   - `Page.startScreencast` requested JPEG, quality 65, maxWidth 1280, maxHeight 900, everyNthFrame 1.
   - Initial frame received with JPEG SOF dimensions 780x493 (matching Chrome's default `about:blank` layout viewport).
   - Promptly acknowledged before decoding; verified SOF dimensions <= MAX_IMAGE_WIDTH/HEIGHT.
   - Status: **PASS**.
2. **Screencast Restart & Old-Run ACK Semantics**:
   - Screencast stopped (`Page.stopScreencast`) and restarted (`Page.startScreencast`).
   - Chrome emitted Run 2 initial frame with incremented screencast session ID.
   - Sending an ACK for the Run 1 session ID was accepted by Chrome without transport error or connection drop.
   - Replacement run continued operating normally, with follow-up visual changes yielding fresh frames.
   - *Limitation / Disclaimer*: Exact-once frame accounting and run-credit ownership invariants belong to the Phase 05 producer runtime; this test verifies engine-level prompt ACK handling and old-run ACK non-interference.
   - Status: **PASS** (Engine behavior) / **UNVERIFIED** (Phase 05 producer invariants).
3. **Resize Recovery**:
   - Dispatched `Emulation.setDeviceMetricsOverride(width: 800, height: 600)`.
   - Awaited screencast frame; verified JPEG SOF dimensions matched 800x600.
   - Status: **PASS**.
4. **Animation-to-Final-Static Frame & Single Per-Epoch Recovery Budget**:
   - Animated box moved horizontally from 0px to 350px over 200ms CSS transition.
   - Active animation frames consumed and acknowledged during motion.
   - Upon animation completion, native frames ceased (>250ms of silence observed).
   - Executed exactly ONE recovery `Page.captureScreenshot(format=Jpeg, quality=65)`.
   - Decoded screenshot via `zune-jpeg`: verified animated box reached settled pixel centroid at $x = 399.5$ (matching expected 350 + 50).
   - Zero periodic screenshot polling loops spawned.
   - Status: **PASS**.

## 4. Coordinate Mapping Status

- **Authoritative Visual-Marker Fixture**:
  - Rendered HTML page with distinct solid-color markers (`#marker-red`, `#marker-green`, `#marker-blue`, `#marker-magenta`) at known layout positions.
  - Screencast JPEG frames decoded via `zune-jpeg` to raw RGB pixels; marker centroids located in IMAGE pixels.
  - Simulated viewer aspect-fit letterbox container (1000x750); verified out-of-image click rejection.
  - Mapped image pixel centroids through contract formula:
    $$u = \frac{\text{clientX} - \text{drawX}}{\text{drawWidth}}, \quad v = \frac{\text{clientY} - \text{drawY}}{\text{drawHeight}}$$
    $$x = u \times \text{visualViewport.clientWidth}$$
    $$y = v \times \text{visualViewport.clientHeight} + \text{offsetTop}$$
  - Dispatched `Input.dispatchMouseEvent` (mousePressed, mouseReleased) and asserted DOM click recorded on the expected marker element with matching client coordinates.

- **Observed Geometry Cases**:
  1. **Baseline 1.0** (DPR 1, PageScale 1.0, Scroll 0,0, Offset 0,0): Centroid (129.5, 149.5) -> Target `marker-red` hit at DOM client (127.0, 147.0). **PASS**.
  2. **DPR 2.0** (Retina display device scaling): Centroid (429.5, 279.5) -> Target `marker-green` hit at DOM client (424.0, 274.0), recorded `dpr: 2.0`. **PASS**.
  3. **Document Scroll** (Scroll 60, 50): Centroid (719.5, 159.5) -> Target `marker-blue` hit at DOM client (711.0, 156.0), recorded `page: (771, 206)`. **PASS**.
  4. **Pinch / PageScale 2.0**: Centroid (259.5, 299.5) -> Target `marker-red` hit at DOM client (128.0, 147.0), recorded `scale: 2.0`. **PASS**.
  5. **Nonzero Visual Viewport Offsets** (PageScale 2.0 + Visual Viewport Scroll, offset=(50, 50)): Centroid (159.5, 199.5) -> Target `marker-red` hit at DOM client (129.0, 149.0), recorded `offset: (50, 50)`. **PASS**.

- **Coordinate Mapping Finding on Visual Offsets**:
  - Chrome's `Input.dispatchMouseEvent` interprets $(x, y)$ in the visual viewport space and internally applies visual viewport pan offsets to produce DOM `clientX/Y`.
  - Therefore, visual pan offsets must NOT be added to CDP input coordinates (adding them shifts the click twice). Document scroll offsets are metadata and must NOT be added.

- **Native Browser Zoom Investigation (80%, 125%, 200%)**:
  - Route 1: Keyboard shortcuts (Ctrl+=, Ctrl+-, Ctrl+0) dispatched with full key-down and key-up sequences and settling time; `visualViewport.zoom` remained `Some(1.0)`.
  - Route 2: Ctrl + mouseWheel sequence; `visualViewport.zoom` remained `Some(1.0)`.
  - Route 3: `--force-device-scale-factor=1.25` launch flag; alters `window.devicePixelRatio`, but `visualViewport.zoom` remained `Some(1.0)`.
  - Route 4: CDP protocol inspection; standard CDP 1.3 protocol does not provide `Page.setZoom` or `Browser.setZoom`.
  - **Conclusion**: Native browser zoom is UNREACHABLE via standard CDP/launch in headless Chromium 157.
  - **Disposition**: Native browser zoom remains **UNVERIFIED**. Per Architecture Contract §8, `inputTrusted: false` remains enforced for non-unit native zoom geometry.

## 5. Platform Qualification Summary

- **Linux (x86_64)**: **QUALIFIED FOR GEOMETRY & COMPATIBILITY CONTRACTS**
  - Real Chrome 157.0.8103.38 executed on Fedora 44 (`Linux 7.2.15-200.fc44.x86_64`).
  - Authoritative visual-marker coordinate mapping verified for DPR 1/2, document scroll, pageScale 1/2, and nonzero visual viewport offsets.
  - Real behavior fixtures verified for static first frame, resize recovery, prompt ACK, old-run restart, and animation-to-final-static recovery budget.
  - *Retained Blockers*: Native browser zoom (CDP protocol limitation; `inputTrusted: false` stays).
  - *(See process containment slice report for Linux supervisor watcher / group cleanup status).*

- **Windows (x86_64)**: **UNSUPPORTED / UNQUALIFIED (Gate Blocked)**
  - Host runner environment is Linux (`Linux 7.2.15-200.fc44.x86_64`).
  - Native Windows Job Object containment and PowerShell E2E qualification cannot execute on this host.
  - On non-Unix platforms, `BrowserProcess::launch` fails closed immediately with `ProcessError::ContainmentUnavailable`.
  - Windows qualification remains blocked until execution on a native Windows runner.

## 6. Open Items & Missing Evidence (Phase 01 Status: BLOCKED)

1. **Windows Platform Containment**: Host runner is Linux; native Windows Job Object containment and PowerShell E2E specs cannot run. Non-Unix launch fails closed with `ProcessError::ContainmentUnavailable`.
2. **Native Browser Zoom**: Headless Chromium 157 does not support native browser zoom via standard CDP commands (`inputTrusted: false` stays).
3. **Producer Invariants (Phase 05)**: Sustained multi-frame throughput, continuous animation/video stability, and ACK pacing remain unverified (deferred to Phase 05 producer fanout).
4. **Gateway Concurrency & Relay Limits (Phase 04)**: Production gateway 2-connection cap and metadata hardcoding removal remain open (Phase 04).
5. **Other Slices**: See respective slice reports for process containment, TS fixture, and gateway relay qualification.
