# Host Browser review — fresh runtime evidence

Date: 2026-11-09. Reviewed commits `3f20a8a9..cdfa9c6b`; product source unchanged.

## Environment and isolation
- Linux x64; system `/usr/bin/google-chrome`; exact-source Vite UI on `127.0.0.1:5174`; freshly compiled production Rust binary on `127.0.0.1:46885`.
- Temporary HOME/config/profile/SQLite root `/tmp/dh-browser-review-jn2faghy`; no-auth mode restricted to loopback. No production user/profile accessed.
- Config `[server.browser] enabled=true`, executable `/usr/bin/google-chrome`, temporary `profile_root`, `allowed_dev_origins=["http://127.0.0.1:46885"]`.
- Initial backend CORS: `http://127.0.0.1:46885`; actual-UI pass additionally allowed `http://127.0.0.1:5174`.
- Runtime probes executed through Eval HTTP, Bun WebSocket, native Playwright CDP, and browser-tool UI interactions. No probes added to product/test source.

## Fresh automated checks
| Check | Observed result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter --test browser_host_process --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input --test browser_host_gateway --test browser_host_screencast --test browser_host_media --test browser_host_bounds --test browser_host_selection --test browser_host_logout --test browser_host_security --test browser_host_platform` | 125 passed, 2 ignored, 15 suites |
| `pnpm --filter @dam-hopper/ui test src/browser-host src/api/browser-host-client.test.ts` | 61 passed, 4 files |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-decoder.browser.tsx browser-tests/host-browser-input.browser.tsx browser-tests/host-browser-lifecycle.browser.tsx browser-tests/host-browser-selection.browser.tsx browser-tests/host-browser-logout.browser.tsx browser-tests/host-browser-android.browser.tsx` | 23 passed, 6 files |
| `cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --no-auth --config <temporary-config> --host 127.0.0.1 --port 46885 --cors-origins <loopback-origins>` | Compiled and served actual production routes; existing unrelated Rust warnings |

These checks are not full-suite/full-app/platform qualification.

## Observed production behavior

### R1 — Actual Browser Close crashes the OS shell
1. Launch exact-source Vite: `VITE_DAM_HOPPER_SERVER_URL=http://127.0.0.1:46885 pnpm --filter @dam-hopper/web exec vite --host 127.0.0.1 --port 5174 --strictPort`.
2. Browser tool opens app; edit Default Server to temporary backend, select No Auth, Test connection, Save profile. App enters OS.
3. Dock Browser Preview → complete URL chooser with `http://127.0.0.1:46885/api/auth/status` → observe real streamed JSON page.
4. Click Control, canvas, then window Close.
5. Entire shell enters ErrorBoundary: `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.`
6. Console stack: React `commitDeletionEffectsOnFiber`, `ParkedBrowserStreamItem`, `BrowserStreamKeepAliveHost`. Native session deletion succeeds (`GET /api/browser/sessions` returns `[]`).

Cause source: React owns returned div under parking parent; imperative `appendChild` moves it elsewhere (`BrowserStreamKeepAliveHost.tsx:303–312,558–570,632–667,690–723`).

Visual evidence: [live Browser](261109-2251-host-browser-evidence/live-browser.png), [shell crash](261109-2251-host-browser-evidence/close-crash.png). Images contain isolated dev fixture only.

### R2 — Canvas gesture does not activate text proxy
- Same real UI after Control → canvas click: `document.activeElement.tagName === 'DIV'`; textarea not focused.
- This confirms missing local input focus, not a physical Android keyboard result.

### R3 — Raw-agent viewport changes retain epoch and misproject input
- Paired real `/api/browser/media` and `/api/browser/control` sockets received/ACKed valid BHJF JPEG publications; fixed protocol plus one-use ticket subprotocols, exact Origin.
- Apply managed viewport `900x700`, numeric viewportEpoch `1` → HTTP200 / returned epoch `"2"`.
- Keep external flattened CDP Page session alive; `Emulation.setDeviceMetricsOverride` to `1000x800` and force visible DOM change.
- Native `innerWidth/innerHeight = [1000,800]`; current BHJF geometry `[1000,800]`, `inputTrusted:true`, viewportEpoch still `"2"`; REST registry epoch still `"2"`.
- Old epoch2 keyDown accepted (`['down:Shift']` observed in remote page).
- Control pointer at fractions `(0.5,0.5)` reaches remote DOM `(450,350)` rather than displayed/native center `(500,400)`.
- Production uses metadata for displayed header but stale producer geometry for CDP dispatch; raw flattened session/target mapping does not fence the epoch.

### R4 — Successful lease release omits native key release
- Acquire fresh lease, send valid numeric input seq1 / current epoch keyDown Shift.
- Remote page records `['down:Shift']`.
- `POST .../control/release` returns HTTP200 `{status:'released'}`.
- Remote page still records only `['down:Shift']`, no keyUp. Probe explicitly releases Shift via native CDP afterward.
- API discards returned release events (`api/browser_host.rs:907–910`).

### R5 — Viewport DTO cannot be round-tripped as its declared string epoch
- `PUT .../viewport` with `viewportEpoch:"1"` → HTTP422: `invalid type: string "1", expected u64`.
- Same request numeric `1` → HTTP200, returned viewportEpoch `"2"`.
- Numeric resize continued streaming in this run (8 frames at resize →18 after1.2s). **Unconditional resize-freeze hypothesis rejected**, not a confirmed finding.

### R6 — CDP discovery trusts request Host
- `GET /api/browser/cdp/json/version` with approved Origin and `Host: review-attacker.example`, no public-origin env override.
- HTTP200 `webSocketDebuggerUrl:"ws://review-attacker.example/api/browser/cdp/ws"`.
- Confirms reflected discovery destination; no actual bearer exfiltration attempted or claimed.

### R7 — Configured development origin policy does not constrain real page requests
- Config allowed only backend origin; CORS allowed backend and UI origins.
- Start two ephemeral HTTP servers on other loopback ports: target page contains image pointing at second server.
- REST create using unapproved target origin `http://127.0.0.1:36191` returns201.
- Second unapproved origin receives one image request from managed Chromium.
- No raw CDP command used to create/inject these requests. Demonstrates ordinary-page navigation/subresource policy bypass in guarded development path; production metadata access was not attempted.

## Scope limits
- Did not execute full Playwright app suite, authenticated production role/demotion interleavings, native Windows containment, physical Android/human acceptance, power-loss injection, or matched CPU/RSS/latency soak baseline.
- Source-backed races remain explicitly unexecuted; green unit/component suites do not establish these gates.
- Temporary target servers stopped; sockets/tabs/processes closed after evidence collection.

## Additional fresh type checks
- `pnpm --filter @dam-hopper/ui build` — passed (`tsc -p tsconfig.json`).
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck` — passed (`tsc -p tsconfig.e2e.json`).
- Neither command executes the application E2E scenarios.

## Unresolved questions
None requiring a user decision for the confirmed findings. Hardware/platform/soak receipts remain unavailable in this review.
