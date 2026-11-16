# Plan Review — Native Host Chromium Developer Tools in Browser App

## 1. Status

- **Status:** `complete`
- **Review Mode:** Plan-only, read-only security, lifecycle, concurrency, and contract review.
- **Plan Files Inspected:**
  - `plans/261116-0223-browser-native-chromium-devtools/plan.md:1-51`
  - `plans/261116-0223-browser-native-chromium-devtools/phase-01-backend-devtools-proxy.md:1-154`
  - `plans/261116-0223-browser-native-chromium-devtools/phase-02-ui-devtools-dock.md:1-153`
  - `plans/261116-0223-browser-native-chromium-devtools/phase-03-verification-and-docs.md:1-102`
- **Repository Files Inspected:**
  - `server/src/browser_host/cdp_gateway.rs:1-1030`
  - `server/src/browser_host/raw_geometry_fence.rs:1-108`
  - `server/src/browser_host/raw_session_targets.rs:1-112`
  - `server/src/browser_host/attachments.rs:1-800`
  - `server/src/browser_host/session.rs:1-2086`
  - `server/src/browser_host/auth.rs:1-503`
  - `server/src/browser_host/media.rs:1-1200`
  - `server/src/browser_host/screencast.rs:250-450`, `1350-2100`
  - `server/src/browser_host/mod.rs:1-27`
  - `server/src/api/browser_host.rs:1-2127`
  - `server/src/api/router.rs:1-993`
  - `packages/ui/src/os/apps/BrowserApp.tsx:1-1242`
  - `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:1-300`, `900-2711`
  - `packages/ui/src/os/browser/browser-address-bar.tsx:1-122`
  - `packages/ui/src/os/browser/browser-tools.tsx:1-300`
  - `packages/ui/src/os/browser/browser-navigation.ts:1-250`
  - `packages/ui/src/browser-host/canvas-view.tsx:1-136`
  - `packages/ui/src/api/browser-host-client.ts:1-760`
  - `packages/ui/src/api/server-config.ts:1-800`
- **Exclusions & Missing Evidence:** No builds, tests, or runtime mutations were executed per read-only review constraints. No missing repository evidence.

---

## 2. Material Findings

### Finding 1 — Forwarding `Emulation.*` geometry commands and invoking `raw_geometry_fence::handle_client_cdp_message` on the UI DevTools socket can permanently disable `input_available` and break managed viewport geometry
- **Plan Reference:** `plans/261116-0223-browser-native-chromium-devtools/plan.md:34`, `plans/261116-0223-browser-native-chromium-devtools/phase-01-backend-devtools-proxy.md:47`
- **Supporting Repository Evidence:**
  - `server/src/browser_host/raw_geometry_fence.rs:18-69`, `74-108`
  - `server/src/browser_host/raw_session_targets.rs:17-22`, `69-111`
  - `server/src/browser_host/session.rs:112-125`, `1705-1750`, `1836-1883`
  - `server/src/browser_host/screencast.rs:1397-1416`, `1470-1505`
- **Concrete Failure Scenario:**
  1. Phase 01 line 47 instructs `devtools_ws_handler` to forward `Emulation.*` commands upstream and call `raw_geometry_fence::handle_client_cdp_message`.
  2. When `devtools_app.html`'s `EmulationModel` initializes or clears device emulation (`Emulation.clearDeviceMetricsOverride`, `Emulation.setPageScaleFactor`, `Emulation.setVisibleSize`, or `Emulation.setDeviceMetricsOverride` with `width: 0`), `fence_geometry_and_advance_epoch` (`session.rs:1863-1874`) computes `adopted = None` and sets `s.input_available = false`.
  3. Unlike `ScreencastProducer::geometry_trusted`, `SessionRegistry::input_available` is never reset to `true` by subsequent screencast frames or by `apply_sanitized_viewport` (`session.rs:1742-1749`), permanently disabling viewer input (`BrowserStreamKeepAliveHost.tsx:1247`, `1502`) for that tab. Furthermore, `Emulation.clearDeviceMetricsOverride` clears `ScreencastProducer`'s metrics override while `begin_external_geometry_fence` sets `external_geometry_fenced = true` (`screencast.rs:1398`), suppressing `schedule_native_geometry_repair` (`screencast.rs:1503`).
  4. In addition, Phase 01 lines 48–49 do not call `RawSessionTargets::observe_upstream`. Any command carrying a child `sessionId` resolves to `RawTarget::Unmapped` (`raw_session_targets.rs:108`), which calls `fence_geometry_and_advance_epoch` with `target_id = None` (`raw_geometry_fence.rs:43`, `session.rs:123`) and sets `input_available = false` across **all** sessions owned by the principal.
- **Severity & Confidence:** `high` · High confidence
- **Smallest Actionable Correction:**
  In `devtools_filter.rs` (`inspect_devtools_client_message`), reject viewport-mutating `GEOMETRY_METHODS` (`Emulation.setDeviceMetricsOverride`, `Emulation.clearDeviceMetricsOverride`, `Emulation.setPageScaleFactor`, `Emulation.setVisibleSize`) on the UI DevTools socket with synthetic JSON-RPC error `-32601` instead of forwarding them or invoking `raw_geometry_fence::handle_client_cdp_message`. Keep `ScreencastProducer` and `PUT /api/browser/sessions/{id}/viewport` as the sole owner of tab geometry.

### Finding 2 — Target-isolation filter misses `Target.getTargets` / `Target.sendMessageToTarget` and cannot distinguish child targets from foreign pages in a stateless `inspect_devtools_client_message`
- **Plan Reference:** `plans/261116-0223-browser-native-chromium-devtools/phase-01-backend-devtools-proxy.md:46`, `49`, `91-92`, `117`
- **Supporting Repository Evidence:**
  - `server/src/browser_host/cdp_gateway.rs:518-527`, `700-715`
  - `server/src/browser_host/session.rs:1145-1165`
- **Concrete Failure Scenario:**
  1. Phase 01 line 46 requires rejecting `Target.attachToTarget` "targeting any top-level page other than `native_target_id`", while line 91 defines a stateless signature `inspect_devtools_client_message(raw: &str, native_target_id: &str)`.
  2. A client `Target.attachToTarget` request only carries `params.targetId` (an opaque hex ID), not `targetInfo.type`. A stateless check with only `native_target_id` cannot distinguish an OOPIF/worker target ID from another tab's `native_target_id`.
  3. On a page-level CDP socket (`/devtools/page/{native_target_id}`), Chromium also responds to `Target.getTargets` with `result.targetInfos` listing all pages/targets in the browser instance and accepts `Target.sendMessageToTarget`. If `Target.getTargets` and `Target.sendMessageToTarget` are not blocked, a client on `/api/browser/devtools/{token}/ws` can enumerate other tabs' `targetId`/`url`/`title` and attach to them.
- **Severity & Confidence:** `high` · High confidence
- **Smallest Actionable Correction:**
  In `inspect_devtools_client_message`, reject `Target.getTargets`, `Target.sendMessageToTarget`, and any `Target.attachToTarget` where `params.targetId != native_target_id` (Chromium's `Target.setAutoAttach` on `/devtools/page/{native_target_id}` attaches child frames/workers automatically without client-initiated `Target.attachToTarget`).

### Finding 3 — 300s DevTools lease TTL can expire while the DevTools WebSocket remains open, breaking lazy-loaded DevTools panel ES modules
- **Plan Reference:** `plans/261116-0223-browser-native-chromium-devtools/phase-01-backend-devtools-proxy.md:31`, `37`, `43`, `50`
- **Supporting Repository Evidence:**
  - `server/src/browser_host/attachments.rs:25`, `278-292`, `395-398`
  - `server/src/browser_host/cdp_gateway.rs:797-819`
- **Concrete Failure Scenario:**
  1. Phase 01 line 31 specifies a 300s lease TTL "refreshed on active asset/WS access, clipped to `admission.effective_deadline`".
  2. Chromium's `devtools_app.html` lazy-loads panel modules (`./panels/network/network.js`, `./panels/elements/elements.js`, `./panels/sources/sources.js`) via `GET /api/browser/devtools/{token}/{*path}` only when the user first switches to that panel.
  3. If `expires_at` is only refreshed on HTTP asset requests and the initial WS upgrade (not while the WebSocket stays open), a user who leaves DevTools open on `Console` for >300s on an idle page and then clicks `Network` or `Elements` will hit HTTP 401/404 on the lazy module imports while the WebSocket is still live.
- **Severity & Confidence:** `medium` · High confidence
- **Smallest Actionable Correction:**
  Refresh the lease's `expires_at` (clipped to `admission.effective_deadline`) on each 5-second live-auth check tick while the DevTools WebSocket is active (or exempt leases with an active WebSocket from idle TTL expiry until `effective_deadline` / WS close).

### Finding 4 — Server-side lease revocation hooks miss single-session auth logout (`revoke_auth_session_browser_resources`) and native target crash/loss (`release_session_viewers` / `SessionsRetired`)
- **Plan Reference:** `plans/261116-0223-browser-native-chromium-devtools/phase-01-backend-devtools-proxy.md:50`, `82`, `94`
- **Supporting Repository Evidence:**
  - `server/src/api/browser_host.rs:1730-1760` (`revoke_auth_session_browser_resources`)
  - `server/src/api/browser_host.rs:1765-1791` (`fence_principal_browser_resources_sync`)
  - `server/src/api/browser_host.rs:1827-1839` (`retire_session_native_resources`, `release_session_viewers`)
  - `server/src/browser_host/media.rs:695-699`, `777-782` (`close_native_session`, `NativePumpRequest::SessionsRetired`)
- **Concrete Failure Scenario:**
  1. Phase 01 line 50 only defines `revoke_by_browser_session` and `revoke_all_for_principal`, and line 94 wires revocation into `close_native_session`, `reset_profile`, and auth-session revocation.
  2. Single-device logout (`revoke_auth_session_browser_resources`, `api/browser_host.rs:1730`) revokes resources scoped to `(principal, auth_session_id)` so sibling logins of the same principal survive (`attachments.rs:676`). Without `auth_session_id: Option<String>` on `DevToolsLease` and `revoke_by_auth_session(principal, auth_session_id)`, device-session revocation either misses the DevTools lease or kills sibling logins' DevTools sessions.
  3. Hooking only `close_native_session` and `reset_profile` misses native target crash/destruction (`NativePumpRequest::SessionsRetired` in `media.rs:777` and `release_session_viewers` in `api/browser_host.rs:1832`) and principal-wide synchronous fencing (`fence_principal_browser_resources_sync` in `api/browser_host.rs:1765`).
- **Severity & Confidence:** `medium` · High confidence
- **Smallest Actionable Correction:**
  Record `auth_session_id: Option<String>` on `DevToolsLease` and add `revoke_by_auth_session(principal, auth_session_id)`. Invoke `revoke_by_browser_session` inside `release_session_viewers` (`api/browser_host.rs:1832`) and `NativePumpRequest::SessionsRetired` (`media.rs:777`), `revoke_all_for_principal` inside `fence_principal_browser_resources_sync` (`api/browser_host.rs:1765`), and `revoke_by_auth_session` inside `revoke_auth_session_browser_resources` (`api/browser_host.rs:1730`).

---

## 3. Checks Performed vs. Not Performed

- **Performed:**
  - Verified capability token entropy, hashing, path traversal rules, CSP `connect-src` rewrite, and Axum 0.8 route ordering (`/ws` before `/{*path}`).
  - Verified CDP target isolation, `raw_geometry_fence` interaction with `SessionRegistry::input_available` and `ScreencastProducer`, and stealth preservation (`stealth.rs`).
  - Verified UI privacy/visibility teardown (`privacyMasked`, `ownerMismatch`, `!isVisible`, tab switch/close) and `slotRef` / `BrowserStreamKeepAliveHost` F2 continuity in `BrowserApp.tsx`.
- **Not Performed:**
  - Runtime cargo/pnpm builds, unit tests, or live Chromium E2E execution (excluded by read-only review scope).

## 4. Unresolved Questions

- None.
