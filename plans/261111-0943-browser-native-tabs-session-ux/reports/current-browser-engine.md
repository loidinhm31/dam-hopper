# Current Browser engine and control stack

## Conclusion
- Repository architecture: **supervised headless Chrome/Chromium-compatible executable**, controlled by DamHopper's **custom Rust CDP stack**. Chrome DevTools Protocol is the automation/control protocol, not a renderer. Chromium uses Blink for rendering and V8 for JavaScript.
- Actual observed local development runtime: **Google Chrome 157.0.8103.38**, binary `/opt/google/chrome/chrome`.
- Not an Electron/WebView/iframe or Playwright-hosted Browser surface. `packages/browser-bridge` is a separate cooperative debugging subsystem; not the managed Browser engine.

## Static repository evidence
- `server/src/browser_host/process.rs:118-139`: executable selected from explicit configuration or `DAM_HOPPER_BROWSER_EXECUTABLE`; automatic PATH discovery disabled.
- `server/src/browser_host/process.rs:309-325`: browser spawned with managed user-data directory, random remote debugging port, `--headless=new`; default sandbox/TLS/web-security protection retained.
- `server/src/browser_host/manager.rs:552-560`: manager supplies configured executable, forces headless and invokes owned `BrowserProcess::launch` with timeout.
- `server/src/browser_host/cdp.rs`: custom bounded WebSocket/CDP actor, not a Playwright runtime.
- `server/Cargo.toml:176-179`: `chromiumoxide_cdp = =0.9.1`, `chromiumoxide_types = =0.9.1`, `tokio-tungstenite = 0.28`; protocol types/transport, not a replacement rendering engine.
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` + `packages/ui/src/browser-host/stream-controller.ts`: React root owns streamed canvas/media/control lifecycle. Existing BHJF+PCM protocol and session fences remain DamHopper contracts.

## Runtime checks actually exercised
1. Process-name-only inventory; no full process command lines, environment, profile data, cookie or credentials read.
2. `ps -o pid,ppid,comm -p 735006,817897,778244,3042531`:
   - Browser PID `817897` is direct child of dev server PID `778244`.
   - Browser PID `735006` has a different parent; not treated as DamHopper evidence.
3. `readlink /proc/735006/exe /proc/817897/exe /proc/778244/exe /proc/3042531/exe`:
   - Managed browser -> `/opt/google/chrome/chrome`.
   - Dev server -> `/home/loidinh/WS/dam-hopper/server/target/debug/dam-hopper-server`.
   - Separate installed server -> `/opt/dam-hopper/releases/v0.16.1/both/bin/dam-hopper-server`.
4. `/opt/google/chrome/chrome --version` (exit 0): `Google Chrome 157.0.8103.38`; warning identifies stable channel. This is a version query, not a page/session launch.

## Applicability and limits
- Verified local dev-managed child and its exact executable/version; not every connected remote profile or installed service's active engine. Executable is operator-configurable, so another server can use a different compatible Chrome build.
- No product source/config changed, browser target navigated/closed, agent-browser installed or integration test executed.
- Session finalization remains paused while agent-browser fit is researched. Current reviewed plan has no engine replacement phase; no expansion accepted yet.

Unresolved questions: none about the observed local development engine. Upstream agent-browser fit and exact authenticated-gateway compatibility are separately researched; runtime compatibility untested.
