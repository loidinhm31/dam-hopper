# Phase 07 Code Review — Cycle 2

## Assessment
**Score: 4/10 — request changes; phase acceptance incomplete.** Seven advertised changes are present at the source level: UUID creation key, live store getters, negotiated viewer ID, authoritative navigation result publication, fresh restore tickets, explicit target DELETE, and PIN/Cognito suppression. Their presence and the reported passing checks do not establish the complete lifecycle contract. Findings below are static source conclusions, not runtime reproductions. No source/test/plan edits; task tracking intentionally left unchanged under assigned ownership.

## Critical issues
- No confirmed critical security vulnerability or data-loss exploit found in the reviewed scope. High-priority functional/security-lifecycle blockers follow.

## Warnings

### W1 — High: Authoritative navigation revisions now break the request wire contract
- Evidence: `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:376-384` stores `created.navigationRevision`; `packages/ui/src/api/browser-host-types.ts:91-96` and `server/src/browser_host/session.rs:195-198` establish that it is a decimal **string**. `packages/ui/src/os/apps/BrowserApp.tsx:169,218-221,236,249-252,267-270` sends it unchanged. `packages/ui/src/api/browser-host-client.ts:112-116` directly JSON-stringifies requests, while `server/src/api/browser_host.rs:435-449,482-496,524-537` requires a JSON `u64` number with plain Serde deserialization.
- Impact: normally created targets send `"navigationRevision":"1"`; navigate/history/reload reject deserialization before operation handling. Defaulting to numeric 1 does not fix the normal path. No runtime reproduction performed.
- Correction: reconcile producer/consumer wire types centrally against the binding canonical decimal-string contract, including lossless u64 handling; do not paper over with `Number(...)`. Backend/client boundary repair requires owner approval outside Phase 07's integration files. Confidence: high.

### W2 — High: Persisted live targets still cannot be adopted
- Evidence: `packages/ui/src/os/persistence.ts:56-61` correctly strips incarnation/profile epoch. Host attachment at `BrowserStreamKeepAliveHost.tsx:326-334,395-403` does no authenticated get/list reconciliation, substituting incarnation `"1"` and epoch 0. No OS consumer of `listBrowserSessions` or `getBrowserSession` found; persisted `logicalSessionId` is not consumed.
- Impact: SPA reload retains session ID but cannot negotiate current valid attachment identity; missing/restarted targets have no explicit Restore/reloaded flow.
- Correction: get/list exact logical session under current owner, adopt authoritative identity without navigation; only explicitly restore missing targets with a new creation key and truthful reloaded label. Confidence: high.

### W3 — High: Restore tickets are fresh, but attachment is neither demand-fenced nor generation-reactive
- Evidence: `BrowserStreamKeepAliveHost.tsx:200-206` memoizes owner only by profile ID; connection generation changes do not refresh it. Main connection effect (`:320-442`) ignores effective visibility. Restore effect (`:444-473`) has no cancellation/operation token and no post-await window/session/visibility check. Privacy/visibility layout effects (`:234-248`) run before controller construction (`:250-318`); controllers default to visible/non-private (`stream-controller.ts:89-96`).
- Impact: a hide/privacy transition during ticket mint can be followed by late socket attachment; initially hidden/private windows may start demand with default controller flags. Closing/replacing a window or switching generation while restore is pending cannot reliably retire that completion. Same-owner reconnect leaves the root runtime captured to an old generation.
- Correction: one small owner/session/viewer attachment reconciler: initialize suppression before attaching, capture an operation token, abort superseded ticket work, recheck exact owner/target/demand after awaits; subscribe to generation changes. Confidence: high.

### W4 — High: Lease state remains stale after pause and expires without renewal
- Evidence: `BrowserApp.tsx:282-297` acquires and stores a lease but discards its deadline; no OS calls to `renewBrowserControl` or `releaseBrowserControl` found. Pause closes the old control socket (`stream-controller.ts:544-605`); backend revokes the matching viewer's lease on teardown (`server/src/browser_host/media.rs:914-925`). Restore installs a new viewer ID but does not clear `isController`/`leaseToken` (`BrowserStreamKeepAliveHost.tsx:456-465`). Badge/control-button selection depends solely on `isController` (`BrowserApp.tsx:369-391`).
- Impact: after restore, UI may show Controlling with the previous viewer's revoked token and no acquisition button. Continuous control also expires at 30 seconds without the required 5-second renewal. Late acquisition may publish against a replaced/paused viewer.
- Correction: bind lease state and renewal/release to exact negotiated viewer/target lifetime; clear on pause/socket loss, fence acquisition completion, show deadline/conflict/failure truthfully. Confidence: high.

### W5 — High: Required input/privacy arbitration and deliberate text focus remain incomplete
- Evidence: suppression is only Cognito or PIN (`BrowserStreamKeepAliveHost.tsx:196-198,231-248`), with no document visibility or shell-modal integration. Privacy calls `setPrivacyMode` (which disconnects sockets) before releasing local held input (`:237-239`; `stream-controller.ts:539-540`). Hide does not locally release held state; teardown disposes stream before input (`:482-483`). `textInputProxyRef` is only declared/assigned (`:184,572-575`); canvas handlers never focus it (`:525-543`).
- Impact: background/modal viewers retain demand or keyboard/IME eligibility; original held state cannot reliably be explicitly released over its captured channel. Canvas click cannot deliberately focus the hidden text proxy; mobile keyboard/ordinary text entry remains unwired. CSS pointer suppression is not a keyboard/IME dispatch guard.
- Correction: aggregate document and shell-modal demand/input policy, gate dispatch and blur text focus, release original input/lease before disconnect, and expose deliberate text focus on an authorized canvas gesture/control. Confidence: high.

### W6 — High: Explicit close still loses pending-create and failed-delete ownership
- Evidence: `window-store.ts:153-170` resolves current generation at close, dispatches DELETE fire-and-forget, removes window immediately, logs failures only. Creation key is generated before request but retained only after success (`BrowserStreamKeepAliveHost.tsx:353-385`); cancelled success returns without finalization (`:370`).
- Impact: close during an ambiguously committed create has no captured target/finalizer; failed DELETE leaves a live remote target with no visible retry owner. Remount/retry before successful creation cannot recover the original idempotency key. Shared-target close dispatch is corrected, but sibling viewers have no explicit closed-state UI.
- Correction: retain creation key before dispatch and a captured-owner operation finalizer through ambiguous outcomes; close the captured target once, retain visible pending/failure state, and project target closure to remaining viewers. Confidence: high.

### W7 — High: Popup/dialog policy remains incomplete
- Evidence: no popup-to-window projection/list reconciliation/overflow notice in host event handling (`BrowserStreamKeepAliveHost.tsx:259-283`). Dialog (`:99-165`) is a custom div, not shared Radix/focus-trapped/shell-registered modal. View-only viewers receive actionable buttons (`:576-581`); responses are fire-and-forget and dismiss immediately (`:489-522`).
- Impact: native popup targets lack the required visible OS ownership; modal keyboard isolation and explicit controller-qualified responses are unestablished. A rejected dialog response silently removes the only local response UI and can cause an unhandled rejection.
- Correction: implement bounded native-popup projection/overflow notification; reuse shared Radix modal and shell registration; qualify by exact controller/dialog identity and retain actionable response errors. Confidence: high on missing integration; native popup delivery not exercised.

### W8 — High: Green component tests do not prove the claimed integration fixes
- Evidence: `host-browser-lifecycle.browser.tsx:61-171` checks only store/container removal/existence, not DELETE calls or remote target states. Its “unmount” test (`:174-231`) switches desktops only. `os-lifecycle.browser.tsx:232-328` checks canvas identity/dataset; `:367-388` injects unsupportedReason manually. `os-input-isolation.browser.tsx:203-239` checks CSS, not input frames, IME, canvas pixels or PIN behavior. No corresponding new behavioral tests for the seven Cycle 2 paths appear in those suites.
- Impact: reported 206 passing tests + two typechecks are valid scoped results, but cannot substantiate “all seven completely resolved” or phase acceptance. The tester report's shared-target-preservation description (`tester-261109-1516-phase-07-cycle-2-verification.md:81`) is also stale relative to the renamed test/current close contract.
- Correction: connected-boundary tests for real create/ticket/navigation payloads, lease renewal/resume, exact DELETE and failures, reload adoption, late operations, PIN/document/modal dispatch and bitmap fencing. Preserve separate real frame-denying-page/SPA continuity evidence. Confidence: high.

### W9 — Medium: Root reparenting still moves React-owned DOM
- Evidence: host moves/removes its JSX-rendered container (`BrowserStreamKeepAliveHost.tsx:220-229,475-481,549-552`) instead of reusing the imperatively owned host + stable React portal convention (`MonacoKeepAliveHost.tsx:182-207,247-266`).
- Impact: diverges from explicit ownership-safe portal requirement; teardown/reconciliation safety remains unproved. No runtime teardown exception claimed.
- Correction: create the movable host imperatively, portal stable React content into it, and keep disposal with the owning runtime. Confidence: high on contract divergence.

### W10 — Medium: Capability and transport failures still disappear into logs
- Evidence: `BrowserStreamKeepAliveHost.tsx:338-351,386-424` swallows capability errors with production test-environment comments and logs failed create/ticket requests; protocol/engine compatibility is not checked. Root does not subscribe to stream status changes. `BrowserApp.tsx:228-230,241-243,259-261,277-279,294-296` only logs operation failures.
- Impact: unavailable/unsupported/disconnected/stale paths leave blank or misleading windows; old/mismatched backends do not fail closed with actionable UI as contracted.
- Correction: honor capability/version admission and expose bounded loading/error/disconnected states; keep test accommodations in tests. Confidence: high.

## Suggestions — performance, architecture, YAGNI/KISS/DRY
- Implement existing required viewport control, not a new resize framework: `CanvasView` resizes local backing canvas only (`canvas-view.tsx:45-84`); no OS `setBrowserViewport` consumer exists, and host geometry callback is empty (`BrowserStreamKeepAliveHost.tsx:258`). Reconcile authoritative viewport epoch after native agent geometry changes so live getters do not keep returning an old appState epoch.
- Consolidate the two attachment paths into a small typed runtime snapshot keyed by owner/session/viewer; avoid another generic lifecycle/task abstraction. This also removes duplicate ticket requests and loose appState casts.
- Share URL-only Browser recipe projection at `recipe-engine.ts:250-253` and `schema.ts:293-300,431-436`; do not first copy secret-bearing appState only to discard it.
- Deduplicate identical browser:open/browser:preview handlers (`OsShell.tsx:667-695`) and use a typed optional URL input rather than cast-record probing (`action-executor.ts:516-524`).
- Preserve the bounded decoder/transport and no React per-frame state. Performance measurements/CPU/RSS/soak were not performed; initially hidden attachment and duplicate ticket work are the observed source-level performance concerns.

## Positive observations
- UUID create-format blocker corrected; dynamic getters and negotiated viewer ID are meaningful improvements.
- No obsolete iframe symbols found in production UI/browser tests; independent HtmlPreview/cooperative workflow removal was not introduced by reviewed changes.
- Viewer-local claims permit duplicate target presentations. Persistence/recipe allowlists exclude runtime capabilities; recipes strip live session IDs.

## Reviewed files
Primary changed/new files (all 12; approximately 2,000 relevant source/test lines inspected):
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/OsResourceHost.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/os/OsShell.tsx` (changed launch sections)
- `packages/ui/src/os/action-executor.ts` (launch diff)
- `packages/ui/src/os/window-store.ts` (close integration)
- `packages/ui/src/os/persistence.ts` (projection)
- `packages/ui/src/os/recipes/recipe-engine.ts` (projection)
- `packages/ui/src/os/recipes/schema.ts` (validation/export projection)
- `packages/ui/browser-tests/os-lifecycle.browser.tsx` (changed Browser cases)
- `packages/ui/browser-tests/os-input-isolation.browser.tsx` (added Browser case)
- `packages/ui/browser-tests/host-browser-lifecycle.browser.tsx`
Supporting: `packages/ui/src/browser-host/{stream-controller.ts,input-controller.ts,text-input-proxy.tsx,canvas-view.tsx}`, `packages/ui/src/api/{browser-host-client.ts,browser-host-types.ts}`, `packages/ui/src/os/{MonacoKeepAliveHost.tsx,shell-input-context.tsx}`, backend `server/src/{api/browser_host.rs,browser_host/session.rs,browser_host/media.rs}`, scoped intent/deep-link/PortsTunnels/recipe-context searches; README, PDR, code standards, review skill/workflows, phase07/architecture contracts, prior review/tester reports. Supporting inspection is bounded, not a full server audit.

## Validation commands/results
Reviewer executed `git diff --stat`, `git status --short`, and scoped `git diff -- ...` — exit 0. Read/search evidence above. Retired-symbol search across `packages/ui/src` and `packages/ui/browser-tests` returned no matches.

Build/tests **not rerun**; accepted supplied Cycle 2 results from `plans/reports/tester-261109-1516-phase-07-cycle-2-verification.md:40-47`:
- `pnpm --filter @dam-hopper/ui build` — exit 0.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck` — exit 0.
- `pnpm --filter @dam-hopper/ui test src/os/resource-registry.test.ts src/os/deep-links.test.ts src/os/persistence.test.ts src/os/recipes/recipe-source-context.test.ts src/os/recipes/recipe-engine.test.ts src/os/recipes/schema.test.ts src/os/window-ops.test.ts` — 124 passing.
- `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/host-browser-lifecycle.browser.tsx` — 22 passing.
- `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts src/browser-host/stream-controller.test.ts src/browser-host/input-controller.test.ts` — 60 passing.
- Total supplied: 206 tests + 2 typechecks; zero failures/skips. No lint, production web build, live-server smoke, performance or physical-device validation exercised by reviewer. Type/test coverage percentages unavailable.

## Acceptance and unresolved questions
- All three phase tasks remain technically incomplete: working stream continuity/reload adoption, explicit close outcomes, popup/dialog and full input policy lack required implementation/evidence. Plan left intentionally unchanged; no TODO/task-state updates under assignment constraints.
- Shared-target destructive-close policy is now settled by §9 line 138; no remaining product ambiguity there.
- Cross-phase owner needed for canonical counter request/response repair (W1); current JSON number backend versus decimal-string response/contract is not a UI-only fix.
- Real frame-denying-page continuity, SPA reconnect/restart Restore, human/agent coexistence, late-operation races and PIN/document/modal behavior remain unobserved in supplied Phase 07 evidence. No additional product questions identified.
