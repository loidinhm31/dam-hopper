# Audit Report: Phase 03 UI Upstream Remediation Tasks

**Audit Date:** 2026-11-13  
**Target:** Plan 1 Phase 03 remediation tasks (`repair-browser-portals`, `reconcile-browser-ownership`, `fence-client-input-decoding`, `wire-browser-interaction`)  
**Scope:** Source inspection across `packages/ui/src/os/`, `packages/ui/src/browser-host/`, `packages/ui/browser-tests/`, and `server/src/browser_host/`. No edits, builds, or test runs.

---

## 1. Task: `repair-browser-portals`
- **Verdict:** DONE
- **Acceptance Bullet:**
  - OSQ:O1 addressed: closing actual connected Browser never throws/enters shell ErrorBoundary; canvas/controller/remote target survive placements; explicit close disposes local host exactly once and unrelated shell resources remain live. → **PASS**

### Evidence
- **Imperative movable host creation:** `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:930–951` imperatively creates `hostEl` (`document.createElement("div")`), appends to `parkingHost`, and stores in state via `setHostEl(el)`.
- **Portal subtree ownership:** `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:2243–2305` portals `CanvasView`, `TextInputProxy`, and error/dialog overlays into `hostEl` via `createPortal(..., hostEl)`.
- **Placement & reparenting:** `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:968–975` reparents `hostEl` via DOM `destination.appendChild(hostEl)` between slot element and parking host. React does not manage parentage of `hostEl`.
- **Deterministic teardown without removeChild error:** `BrowserStreamKeepAliveHost.tsx:947–950` cleans up with `el.remove(); setHostEl(null)`. React fiber unmount never invokes `commitDeletionEffectsOnFiber` / `removeChild` on `hostEl`. Unrelated Monaco/PTY resources in `OsResourceHost.tsx:238–246` remain unaffected.
- **Single close disposition:** `packages/ui/src/os/browser/browser-close-lifecycle.ts:70–120` (`reserveCloseOrRelease`, `countRetainedNativeReferences`) ensures target DELETE is only issued on final reference close. Verified by tests `packages/ui/browser-tests/host-browser-lifecycle.browser.tsx:197–247` and `os-lifecycle.browser.tsx:347–438`.

### Concrete Remaining Gap
None. Acceptance criteria satisfied.

---

## 2. Task: `reconcile-browser-ownership`
- **Verdict:** PARTIAL
- **Acceptance Bullets:**
  1. Reload adopts exact live target or explicit restore → **PASS**
  2. Initially/late hidden-private attach cannot gain demand → **PASS**
  3. Logout blackens before disconnect → **FAIL (MISSING)**
  4. Lost create/failed delete retains finalizer/retry → **PASS**
  5. Stale reset results cannot alter replacement-owner pending state → **FAIL (MISSING)**

### Evidence
- **Bullet 1 (Reload adoption / explicit restore):** `packages/ui/src/os/persistence.ts:75–90` & `browser-persistence.ts:130–170` load persisted session with `phase: "connecting"`. `BrowserStreamKeepAliveHost.tsx:1745–1810` fetches exact runtime snapshot via `getBrowserSession` adopting authoritative `browserIncarnation` and `profileEpoch` (never defaults to `"1"`/`0`). Missing target (404) transitions to `phase: "unavailable"`, and `BrowserApp.tsx:977–985` renders explicit reload button (`browser-unavailable-reload-btn`).
- **Bullet 2 (Hidden-private demand check):** `BrowserStreamKeepAliveHost.tsx:978–990` derives `isEffectiveVisible` enforcing `!isSuppressed`, `!minimized`, `!closing`. `BrowserStreamKeepAliveHost.tsx:1428–1436` initializes `streamCtrl.setPrivacyMode` and `setVisibility` before attach. Currency checked before and after all ticket awaits (`:1752, :1790, :1820`). Suppression layout effect (`:1002–1015`) synchronously cancels gestures, blurs proxy, flushes audio, and releases held input.
- **Bullet 3 (Logout blackening before disconnect - OSQ:O4):** In both `packages/ui/src/components/organisms/ServerProfilesDialog.tsx:467–476` and `ServerSettingsDialog.tsx:1864–1873`, `disconnectProfile(captured.profileId)` is executed BEFORE `fenceBrowserViewsForProfile(captured.profileId, ..., captured.generation)`. `disconnectProfile` (`api/connections.ts:784`) increments generation (`entry.generation += 1`). Consequently, `fenceBrowserViewsForProfile` (`BrowserStreamKeepAliveHost.tsx:212–216`) rejects `captured.generation` (`gen !== expectedGeneration` is true) and immediately returns as a no-op! Views are not blackened or fenced prior to disconnect.
- **Bullet 4 (Lost create / failed delete recovery - OSQ:O6):** `packages/ui/src/os/browser/browser-create-lifecycle.ts:80–195` captures `creationKey` and stages operations in `browser-recovery-store.ts`. Late created sessions are tracked in `withheldCleanups` and closed. Failed DELETE retains `status: "unknown"` with operationId for user retry via recovery tools (`BrowserApp.tsx:858, 991`).
- **Bullet 5 (Reset context mutation fencing - OSQ:L2):** `ServerSettingsDialog.tsx:987–997` (`isCurrentBrowserResetAttempt`) checks only dialog session, reset op, URL, and profile ID; it omits `capturedToken` and `capturedGeneration`. At lines `1088, 1135, 1155, 1178`, `setPendingBrowserResetContext` mutates state keyed only by `profileId: string` (`packages/ui/src/api/browser-host-client.ts:464–480`), with no owner generation qualification. Old reset completions on the same profile mutate replacement owner context.

### Concrete Remaining Gap
1. Re-order logout: call `fenceBrowserViewsForProfile(captured.profileId, ..., captured.generation)` before `disconnectProfile(captured.profileId)` in `ServerProfilesDialog.tsx` and `ServerSettingsDialog.tsx`.
2. Qualify reset context: key `pendingBrowserResetByProfile` by `(profileId, generation)` and operation ID in `browser-host-client.ts`; update `isCurrentBrowserResetAttempt` in `ServerSettingsDialog.tsx` to assert matching captured generation and token.

---

## 3. Task: `fence-client-input-decoding`
- **Verdict:** PARTIAL
- **Acceptance Bullets:**
  1. Pending movement cannot cause release gap → **FAIL (MISSING)**
  2. Saturation closes/revokes reliably → **FAIL (PARTIAL)**
  3. Old owner pixels/status/hit rectangle never survive reattach → **FAIL (MISSING)**
  4. Old-epoch decode never draws after new geometry → **FAIL (MISSING)**
  5. Complete native composition sequences commit once while repeated genuine identical edits both commit → **PASS**

### Evidence
- **Bullet 1 (Movement barrier flush - SI:SI-03):** `packages/ui/src/browser-host/input-controller.ts:691–695`: `releaseAllHeldInput()` clears `this.pendingCoalescable = null;`, dropping queued movements rather than flushing an ordered barrier prior to releasing held keys and pointer buttons.
- **Bullet 2 (Saturation and release on prior lease - SI:SI-03):** In `input-controller.ts:639–642`, output queue saturation (`bufferedAmount > 256 * 1024`) fires `this.onError` and returns `false` without closing the socket. (Rate saturation at line 655 closes socket, but queue buffer does not). In `input-controller.ts:607–623`, `syncLeaseState()` sets `this.lastLeaseToken = currentLease; this.inputSeq = 0;` before calling `this.releaseAllHeldInput()`, causing releases to be transmitted over the replacement lease with reset sequence 0.
- **Bullet 3 (Reattach pixel / hit rectangle retention - SI:SI-09):** `packages/ui/src/browser-host/stream-controller.ts:245–285`: `attach()` updates credentials and sockets but does NOT close or clear `this.lastCachedBitmap`, `this.lastDrawnRect`, or `this.lastFrameHeader`. If a resize/redraw occurs (`:1091–1100`) before the new target's first frame arrives, the previous target's image and hit testing rectangle are painted.
- **Bullet 4 (Old-epoch decode drawing over new geometry - SI:SI-10):** `packages/ui/src/browser-host/stream-controller.ts:787–802`: `isOriginatingOwnerValid()` checks `decodeEpoch`, `mediaWs`, `subscriptionEpoch`, and `producerRun`, but does NOT validate `viewportEpoch`. When a frame with a newer `viewportEpoch` arrives (`:760–775`) while a decode is in progress, the active decode still completes and calls `drawBitmapToCanvas` (`:901–933`), overwriting the canvas with obsolete pixels and resetting `lastDrawnRect.viewportEpoch` to the older epoch after the geometry callback already advertised the new geometry.
- **Bullet 5 (IME transaction deduplication - SI:SI-11):** `packages/ui/src/browser-host/text-input-proxy.tsx:40–120`: replaced arbitrary 100ms time suppression with explicit transaction tracking (`pendingCommitRef`). `handleCompositionEnd` registers the commit and consumes synthetic trailing `beforeInput` and `input` events. Sequential identical edits (e.g. typing "aa") undergo discrete cycles and both commit. Plain-text paste preserved.

### Concrete Remaining Gap
1. `input-controller.ts`: in `releaseAllHeldInput()`, call `this.flushCoalescable(true)` before releasing held keys/buttons; in `sendInputEvent()`, close socket fail-closed on `bufferedAmount > 256KB`; in `syncLeaseState()`, dispatch releases on prior lease token before assigning replacement lease and zeroing sequence.
2. `stream-controller.ts`: in `attach()`, close and null `this.lastCachedBitmap`, clear `this.lastDrawnRect` and `this.lastFrameHeader`, and blacken canvas.
3. `stream-controller.ts`: in `isOriginatingOwnerValid()`, verify that decoding frame's `viewportEpoch` matches latest active viewport epoch; discard completions from prior epochs.

---

## 4. Task: `wire-browser-interaction`
- **Verdict:** PARTIAL
- **Acceptance Bullets:**
  1. Controlling survives valid renewals beyond 30s and clears on revocation/pause → **FAIL (PARTIAL)**
  2. Canvas/keyboard activation focuses real proxy, suppression blurs → **FAIL (PARTIAL)**
  3. Native alert/confirm/prompt round-trip explicitly and loss dismisses → **FAIL (MISSING)**
  4. Admitted popup yields one window and overflow notice → **FAIL (PARTIAL)**

### Evidence
- **Bullet 1 (Lease renewal / clearance - OSQ:O5):** `packages/ui/src/os/apps/BrowserApp.tsx:630–675` runs a renewal loop calling `renewBrowserControl(...)`, clearing state on error. `BrowserStreamKeepAliveHost.tsx:806–819, 1308–1320` clears and releases on pause/unmount/detachment. However, `BrowserApp.tsx:647` renews every 10,000ms (10s) instead of the contractually required 5s within 30s TTL. Furthermore, `ServerControlEvent::LeaseRevoked` push from backend media WebSocket is not handled in the UI control loop.
- **Bullet 2 (Text proxy focus on canvas gesture - OSQ:O7):** In `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:2062–2065` and `2160–2175`, `handlePointerDown` on canvas NEVER calls `textInputProxyRef.current?.focus()`. Clicking the canvas dispatches pointer events but leaves `document.activeElement` on `DIV`/`BODY`, breaking keyboard/IME/paste input unless the toolbar "Control" button is explicitly clicked (`BrowserApp.tsx:582`). (Vitest suite `host-browser-input.browser.tsx:77` bypassed this by calling `proxyRef.current?.focus()` in test harness).
- **Bullet 3 (Native dialog handling - OSQ:O8):**
  - Backend CDP (`server/src/browser_host/cdp.rs`): has NO handler or subscription for `Page.javascriptDialogOpening` or `Page.javascriptDialogClosed`.
  - Backend session (`server/src/browser_host/session.rs:246`): `active_dialog` field is never populated.
  - Backend REST API (`server/src/api/browser_host.rs:1176–1217`): `handle_dialog` is a stub that validates the lease and returns `{ "status": "handled" }`; it NEVER dispatches `Page.handleJavaScriptDialog` to Chromium.
  - Frontend modal (`BrowserStreamKeepAliveHost.tsx:368–440`): implemented as a custom `div` overlay rather than using the existing shared Radix focus trap modal.
- **Bullet 4 (Popup projection):** `packages/ui/src/os/browser/browser-popup-tabs.ts:165–195` admits popups and projects them as tabs (`kind: "popup"`) inside the existing Browser window, rather than creating a separate OS window via `openWindow(...)`. `BrowserApp.tsx:875–878` correctly renders the popup blocked notice banner when capacity is reached.

### Concrete Remaining Gap
1. `BrowserApp.tsx`: change renewal interval from 10s to 5s; handle `LeaseRevoked` control event to immediately clear controlling badge.
2. `BrowserStreamKeepAliveHost.tsx`: invoke `textInputProxyRef.current?.focus()` on authorized canvas pointer down gestures (`handlePointerDown`).
3. Backend dialog pipeline: add CDP event mapping for `Page.javascriptDialogOpening`/`closed`, set `active_dialog` in `BrowserSession`, send `DialogOpened`/`DialogClosed` over media control WebSocket, and issue `Page.handleJavaScriptDialog` CDP command in `handle_dialog`. Replace custom frontend overlay with shared Radix dialog component.
4. Popup projection: project admitted popup targets to separate OS windows via `openWindow` when required by multi-window OS specification.

---

## Audit Summary Matrix

| Task | Verdict | Passes | Failures / Gaps |
| :--- | :---: | :---: | :--- |
| **repair-browser-portals** | **DONE** | Imperative host, portal subtree, placement survival, single close | None |
| **reconcile-browser-ownership** | **PARTIAL** | Session reload adoption, hidden-private suppression, lost create/delete recovery | Logout fence called after disconnect (O4); reset context unkeyed by owner generation (L2) |
| **fence-client-input-decoding** | **PARTIAL** | IME commit transaction deduplication (SI-11) | Release movement barrier dropped (SI-03); socket unclosed on buffer saturation (SI-03); stale bitmap/rect on attach (SI-09); old-epoch decode painted over new geometry (SI-10) |
| **wire-browser-interaction** | **PARTIAL** | Popup blocked banner, lease release on pause/detachment | Canvas click does not focus proxy (O7); dialogs completely stubbed out on backend (O8); 10s renew instead of 5s (O5); popup projected as tab not separate OS window |

---

## Unresolved Questions
1. Should popup targets be projected as in-window tabs (current `browser-popup-tabs.ts` design) or separate OS windows (`openWindow`), or should both modes be configurable?
2. Does the backend CDP client require a dedicated Page session domain for `Page.handleJavaScriptDialog`, or should dialog responses route through the screencast Page session?
