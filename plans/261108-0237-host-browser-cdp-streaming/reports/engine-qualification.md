# Host Browser Engine Qualification Report

- Date: 2026-11-08
- Phase: Phase 01 — Qualify adapter and freeze contracts
- Qualification Fixtures & Reported Test Counts:
  - Unit/Adapter tests: `server/tests/browser_host_adapter.rs` (18 tests passing)
  - Colocated lib unit tests: `server/src/browser_host/` (`cdp.rs` + `command_budget.rs`, 7 tests passing)
  - Process containment tests: `server/tests/browser_host_process.rs` (12 tests passing)
  - Live engine compatibility tests: `server/tests/browser_host_compatibility.rs` (2 tests passing)
  - Auth qualification example: `server/examples/browser_host_qualification.rs`
  - Playwright E2E compatibility spec: `packages/ui/e2e/os-host-browser/compatibility.spec.ts` (8 tests passing)
  - Compilation and typing: `cargo check --all-targets` and `packages/ui` E2E typecheck pass. Total 39 Rust tests + 8 Playwright E2E tests reported passing.

## 1. Engine & Environment Identification

- **Host OS**: Linux 7.2.15-200.fc44.x86_64 (Fedora 44)
- **Browser Binary**: `/usr/bin/google-chrome`
- **Browser Binary SHA-256**: `aea09d69ce7f24d5901f6bfb15dd44d0c856e793e0a498f8d8393ec7d2c308ec`
- **Engine Version**: `Google Chrome 157.0.8103.38`
- **CDP Protocol Version**: `1.3`
- **Pinned CDP Crates**: `chromiumoxide_cdp = "=0.9.1"`, `chromiumoxide_types = "=0.9.1"` (CDP Revision 1566079)
- **Runtime WebSocket Dependency**: `tokio-tungstenite = "0.28"`. *Note on feature unification*: While `[dependencies]` declares no TLS features, Cargo feature unification with `[dev-dependencies]` activates `native-tls` during `cargo test` and `cargo run --example`.
- **User-Agent Observed**: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36`

## 2. Bounded Protocol & Framing Verification (Mock Adapter Harness)

- **BHJF Binary Envelope**:
  - 16-byte big-endian prefix: ASCII `BHJF`, version 1, flags 0, `header_len <= 1024`, `payload_len <= 2097152`. Max binary message size: 2,098,192 bytes.
  - Zero-decode JPEG SOF marker inspection verified (validates width, height, and max pixel ceiling 2,073,600).
  - Target-scoped JSON header contains no per-viewer or subscription data.
  - Strict decimal u64 validation for counters (`profileEpoch`, `viewportEpoch`, `frameSeq`): canonical positive decimals `[1-9][0-9]{0,19}` with numeric value <= u64::MAX (zero, leading zeros, signs, whitespace, and non-ASCII digits rejected).
  - Geometry validation: finite floats, rejects out-of-range DPR (`dpr < 0.1 || dpr > 10.0`), rejects out-of-range pageScale (`page_scale < 0.1 || page_scale > 10.0`), CSS layout viewport ceilings enforced (`cssWidth` in (0, 1920], `cssHeight` in (0, 1080]), offsets absolute <= 10,000,000 CSS px.
- **Actor Bounds & Budget Verification (Mock Adapter Harness)**:
  - Max pending commands: 64. The 65th concurrent command is rejected immediately with `TooManyPendingCommands`.
  - Command byte limit: 64 KiB. Larger commands rejected with `CommandTooLarge`.
  - WS read limit: 4 MiB. Messages > 4 MiB close connection with `MessageTooLarge`.
  - Unknown CDP events increment atomic counter without allocating unknown payload queues.
  - Command budget RAII reservation: shared 64-slot / 2 MiB byte allowance across queued + in-flight commands. Adapter tests verified byte budget saturation with large payload waves, returning `WriterQueueFull` before the command slot limit is reached, with peak queued bytes tracked and bounded.
  - RAII reservation release verified across exit paths: deadline sweep (simulated with expired instant), caller cancellation (`sender.is_closed()`), and connection teardown.
  - Stalled-sink saturation: mock sink saturation blocks new commands immediately with `TooManyPendingCommands`, and actor remains deadlock-free under a stalled sink.
  - Malformed handling policy: unrouteable framing, unparseable JSON, or malformed known `Page.screencastFrame` closes the actor with `MalformedResponse` (producer must start a fresh session); routeable command responses with invalid error/result fail only the owning request.
  - *Hedges & Unverified Limits*:
    - 10s command deadline is the configured timeout ceiling (`COMMAND_TIMEOUT_SECS = 10`), not a demonstrated exact wall-clock expiry; unit tests exercised periodic sweep logic on expired deadlines, but did not measure wall-clock 10s expiration.
    - The 32-message writer queue channel buffer was not independently isolated from the 64 pending command cap and 2 MiB byte budget in live traffic; callers saturate the byte budget or slot cap first.
    - While a write is stalled (<= 5s deadline), the actor pauses reads and sweeps (no independent read-during-write; callers maintain their own deadlines).
    - High-load live Chromium traffic, sustained multi-frame throughput, and continuous stream stability remain unverified (deferred to Phase 05 producer fanout).
## 3. Real-Engine Behavioral Observations

1. **Initial Frame & Geometry**:
   - `Page.startScreencast` requested JPEG, quality 65, maxWidth 1280, maxHeight 900, everyNthFrame 1.
   - Initial frame received with JPEG SOF dimensions 780x493 (matching Chrome's default unstyled `about:blank` layout viewport).
   - Layout metrics from `Page.getLayoutMetrics` reported `cssLayoutViewport` size 780x493.
2. **Single-Frame ACK**:
   - Sent `Page.screencastFrameAck(sessionId)` for frame #1.
   - *Unverified*: Sustained multi-frame throughput, ACK pacing, and buffer stability under continuous animations/video were NOT tested here (deferred to Phase 05 producer fanout).
3. **Recovery Screenshot**:
   - `Page.captureScreenshot(format=jpeg, quality=65)` executed successfully, returning a 780x493 JPEG.
   - *Unverified*: The single-per-epoch >250ms threshold policy and zero periodic polling rule belong to the Phase 05 producer implementation and are NOT exercised by this primitive qualification test.
4. **Playwright Trailing Slash Finding**:
   - Playwright's `chromium.connectOverCDP` requests `/json/version/` (with trailing slash) during discovery.
   - The Phase 04 gateway must explicitly route both `/json/version` and `/json/version/`.
5. **Test-Only Qualification Example Relay & Origin Policy (`server/examples/browser_host_qualification.rs`)**:
   - Exact single Origin policy: any Origin-bearing HTTP discovery or WebSocket request must match the exact approved Origin byte-for-byte; duplicate, `null`, or foreign origins are rejected (403 Forbidden).
   - Origin-less requests permitted for bearer-authenticated native/agent clients (Playwright from Node).
   - Transport relay bounds: 4 MiB message/frame limits, 5s write deadlines on both proxy directions. Read/write error, oversize message, or deadline timeout tears down both sockets.
   - *Boundary Note*: This demonstrates test-only example behavior; production gateway routing, discovery metadata hardcoding removal, and 2-connection concurrency enforcement belong to Phase 04.
## 4. Coordinate Mapping Status

- **Coordinate Mapping Formula (Candidate Under Qualification)**:
  $$u = \frac{\text{clientX} - \text{drawX}}{\text{drawWidth}}, \quad v = \frac{\text{clientY} - \text{drawY}}{\text{drawHeight}}$$
  $$x = \text{visualViewport.offsetX} + u \times \text{visualViewport.clientWidth}$$
  $$y = \text{visualViewport.offsetY} + v \times \text{visualViewport.clientHeight} + \text{offsetTop}$$
  - `scrollX` and `scrollY` are metadata only and must NOT be added to mouse coordinates.
  - `dpr` scales image pixel dimensions only and must NOT multiply CSS coordinates twice.
  - `offsetTop` accounts for any non-canvas host header offset (0.0 for direct web viewports).

- **Non-Unit Zoom / Page Scale Empirical Status**:
  - **STATUS: PARTIALLY EXERCISED / FORMULA REMAINS UNVERIFIED**.
  - The `test_non_unit_zoom_dom_click_fixture` executed 7 cases against DOM `<button>` elements:
    1. Baseline 1.0 (DPR 1, Zoom 1.0, PageScale 1.0, Scroll 0,0) -> Click hit target 'btn-alpha' at (175, 150).
    2. DPR 2.0 (Retina display scaling) -> Click hit target 'btn-beta' at (440, 335) with recorded `dpr: 2`.
    3. CSS Zoom 80% (`body.style.zoom = '0.8'`) -> Click hit target 'btn-alpha' at (140, 120). *Note*: `visualViewport.zoom` reported `Some(1.0)`; this exercises CSS zoom, not native browser zoom.
    4. CSS Zoom 125% (`body.style.zoom = '1.25'`) -> Click hit target 'btn-gamma' at (950, 281).
    5. CSS Zoom 200% (`body.style.zoom = '2.0'`) -> Click hit target 'btn-alpha' at (350, 300).
    6. Pinch / PageScale 2.0 -> Click hit target 'btn-alpha' at (175, 150) with `visualViewport.scale: 2.0`.
    7. Document Scroll (scroll 50, 40) -> Click hit target 'btn-beta' at (390, 295) with `page=(50, 40)`. *Note*: `visualViewport.offsetX/offsetY` remained `(0, 0)`; nonzero visual viewport offsets were NOT exercised.
  - **Qualification Limitations**:
    - Native browser zoom (distinct from CSS body zoom) was not exercised.
    - Nonzero visual viewport offsets (`visualViewport.offsetX != 0`, `visualViewport.offsetY != 0`) were not generated by document scroll.
    - Normalized coordinates $(u, v)$ were derived from DOM `getBoundingClientRect()` and scaled back by the same viewport dimensions, which proves CDP event delivery to DOM targets under layout transforms, but does not independently prove coordinate mapping from rendered screencast JPEG pixels to CDP input coordinates.
  - **Disposition**: Per Architecture Contract §8, native browser zoom, nonzero visual offsets, and full image-coordinate mapping remain **UNVERIFIED**. `inputTrusted` remains **`false`** for non-unit zoom and offset geometry until qualified by an authoritative visual marker fixture.

## 5. Platform Qualification Summary

- **Linux (x86_64)**: **PARTIALLY QUALIFIED (Phase 01 adapter & process primitives verified; full geometry unverified)**
  - Supervised launch in process group (`process_group(0)`).
  - Dual-stage process group emptiness proof: `nix::sys::signal::killpg(Pid, None)` kernel verification (`ESRCH`) plus robust non-zombie `procfs` scan.
  - Termination cleanly signals `SIGTERM` with 3s grace period, then `SIGKILL`.
  - Browser sandbox and web security remain active.
  - Incremental chunk-based stderr reader (1024-byte chunks, 64 KiB cap) prevents unbounded memory allocation on un-newline-delimited output.
  - Stale `DevToolsActivePort` removed prior to child spawn; endpoint parsed, validated for loopback, and corroborated against stderr `ws://` output.
  - Dequeue caller cancellation (`sender.is_closed()`) verified: abandoned queued commands are discarded before WebSocket send.
  - Transport helper `ack_screencast_frame` provides low-level CDP frame acknowledgment, but run-credit ownership invariants remain to be implemented in Phase 05.
  - *Pending*: Native browser zoom qualification, nonzero visual offset proof, and screencast-pixel coordinate validation.

- **Windows (x86_64)**: **UNSUPPORTED / UNQUALIFIED (Gate Blocked)**
  - Host runner environment is Linux (`Linux 7.2.15-200.fc44.x86_64`).
  - Native Windows Job Object containment (assign-before-resume) and PowerShell E2E qualification cannot execute on this host.
  - On non-Unix platforms, `BrowserProcess::launch` fails closed immediately with `ProcessError::ContainmentUnavailable`.
  - Per Phase 01 contract, Windows qualification remains blocked until execution on a native Windows runner. Dependent phases requiring Windows cannot proceed without native verification.

## 6. Open Items & Missing Evidence (Phase 01 Status: BLOCKED)

Phase 01 remains **BLOCKED**; dependents cannot proceed until required proof gates are resolved:

1. **Windows Platform Containment**: Host runner is Linux; native Windows Job Object containment (`assign-before-resume`) and PowerShell E2E specs cannot run. Non-Unix launch fails closed with `ProcessError::ContainmentUnavailable`.
2. **Parent-Death & Descendant Containment (`process.rs`)**: Supervised launch uses process group signaling (`killpg`) and procfs inspection, but kernel-enforced parent-death signals (`PR_SET_PDEATHSIG` or equivalent) and orphan adoption guarantees remain open.
3. **Coordinate Mapping & Native Browser Zoom**: Native browser zoom below 100% (CSS viewport ceiling 1920x1080 rejects expansion), nonzero visual viewport offsets (`visualViewport.offsetX/Y != 0`), and rendered screencast-pixel coordinate validation remain unproven (`inputTrusted: false`).
4. **High-Load Streaming & Producer Accounting**: Sustained multi-frame throughput, continuous animation/video stability, and ACK pacing remain unverified (deferred to Phase 05 producer fanout).
5. **Recovery Screenshot Invariants**: Single-per-epoch >250ms recovery threshold and zero periodic polling invariants remain unexercised in live streaming (Phase 05).
6. **Gateway Concurrency & Relay Limits**: Production gateway 2-connection cap, stalled-write relay teardown, discovery metadata hardcoding removal, and repeated simultaneous actor+agent session proof remain open (Phase 04).
7. **Engine Flag Allowlist & UUID Validation**: Provisioned-engine flag policy enforcement, endpoint path UUID validation, and raw qualification record retention remain to be finalized.
8. **TypeScript Fixture Bounds & Group Cleanup**: Fixture runner buffer bounds and cleanup guarantees under aborted runs require hardening.
