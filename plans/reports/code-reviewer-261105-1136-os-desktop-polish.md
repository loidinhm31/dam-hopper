# OS Desktop Polish — Code Review

## Score and disposition

- **Score: 5/10**
- **critical_count: 0**
- **Critical issues: []** — no confirmed Critical-severity exploit or data-loss case within inspected evidence. This is not acceptance: owner routing and ordinary-launch safety have High-priority defects.
- **Recommendation: request changes.**

## Scope and evidence

Reviewed changed production paths for actions/executor/root input, UI preferences and Rust JSON/TOML handling, launch journal, Dock/Apps/pins, canvas/frame/viewport, background menu/cursors, palette, chooser apps, Settings delivery, supporting producers, and representative unit/browser/E2E tests. Read PDR, standards, architecture contracts C1–C14, implementation handoff and qualification reports. No production code or plan status edited; only this report added.

Findings are deterministic source/call-path analysis; runtime consequences described below are source-derived inferences, not reviewer-executed live reproductions.

## Warnings

### W1 — High: Dock launch can substitute the ambient server for the selected desktop server

**Evidence:** `packages/ui/src/os/OsShell.tsx:1480-1500`; `packages/ui/src/os/Dock.tsx:61-71`; `packages/ui/src/os/TopBar.tsx:116-125`; `packages/ui/src/os/action-executor.ts:399-412`.

Dock captures its desktop context, but the mounted `handleLaunchApp` ignores its second argument. It takes `targetCtx` from desktop defaults while obtaining `owner` from the globally active `profileId`. TopBar changes desktop profile without changing that global profile. Executor prefers `owner.profileId` over `windowContext.profileId`, combining one server's owner with another server's project/worktree. It also copies only `request.context.target`, not `windowContext.target`.

**Impact:** choose server B in the desktop selector while global profile remains A, then launch an app: the new window is scoped to A, potentially with B's project name. This violates explicit target ownership; subsequent editor reads use the resulting target (`EditorApp.tsx:173-185,234-245`).

**Correction:** consume the captured context end-to-end; derive owner from that exact target profile; reject inconsistent owner/target tuples rather than reconstructing them from ambient selections. **Confidence: high.**

### W2 — High: explicit deep links are overwritten by unrelated ambient project/target

**Evidence:** `packages/ui/src/os/OsShell.tsx:210-225`; `packages/ui/src/os/deep-links.ts:466-478,521-531`; `packages/ui/src/stores/editor.ts:787-791,861-868`.

Root correctly looks up the link's profile, but constructs `defaultTarget` and `capture.projectId` from the current global profile/project. Qualification then prefers that target and project over the parsed URL. Example: explicit editor link to B/project-Y while A/project-X is selected produces owner B with target A/project-X. Editor opening resolves its transport from that target, not the link owner.

**Impact:** a qualified link can open the wrong server/project/file instead of its explicit destination; a captured workspace target can also remove project scoping.

**Correction:** qualify the URL's explicit project/worktree/target under its explicit profile; never supply unrelated ambient selections as authoritative capture. **Confidence: high.**

### W3 — High: ordinary-launch journal is not connected to actual terminal creation/settlement

**Evidence:** `packages/ui/src/os/action-executor.ts:273-313`; `packages/ui/src/os/apps/TerminalsApp.tsx:34-38,77-127`; `packages/ui/src/os/OsResourceHost.tsx:216-234`; `packages/ui/src/os/OsShell.tsx:348-423`.

New Terminal reserves an attempt and stores `requestedTerminalId`/`attemptId`, then only opens a window. Both runtime consumers ignore those fields and use `sessionId`, `terminalId`, or `${profileId}:${window.id}`. No production caller settles the ordinary journal; `settleTerminalLaunch` is imported but unused in the executor. The existing `terminal:open` consumer still sends `terminal.create` directly without this reservation path.

**Impact:** New Terminal is not an end-to-end journaled create; reservations remain unresolved and block later compatible New requests, while ordinary intent creation bypasses the promised guard. Reserved ID, directory semantics, outcome provenance and runtime ID are disconnected. Duplicate creation is not claimed as a live-observed outcome.

**Correction:** one owner-bound create path for all ordinary launch producers, using the reserved ID and complete target/directory payload; settle from exact originating outcome and recheck destination/owner after awaits. **Confidence: high.**

### W4 — High: journal does not enforce its fail-closed capability/schema/bounds contract

**Evidence:** `packages/ui/src/os/persistence.ts:1012-1063,1107-1112,1172-1194`; `packages/ui/src/os/action-executor.ts:255`; contract `plans/261105-0711-os-desktop-polish/architecture-contracts.md:64-80`.

Missing Web Locks falls back to a per-process Promise chain, allowing independent tabs to race the same persisted document. Reads validate only envelope version/array, then cast records without validating their state or identity. The declared 8,192-byte record limit is not enforced; document bounds count JS code units, not UTF-8 bytes. Executor always uses `"default-endpoint"`, not configured endpoint identity; alias/identity-change ambiguity is not examined.

**Impact:** unsupported locking or malformed stored metadata is treated as usable launch authority; non-ASCII/oversized records exceed documented limits; endpoint-alias safeguards are absent.

**Correction:** block when durable cross-tab authority is unavailable; validate the complete document and UTF-8 bounds under lock; bind to verified configured endpoint identity and conservatively handle ambiguity. **Confidence: high.**

### W5 — High: chooser promotion ignores captured owner generation/token and exact editor identity

**Evidence:** `packages/ui/src/os/action-executor.ts:339-345,375-381`; `packages/ui/src/os/apps/EditorApp.tsx:53-86,171-196`; `packages/ui/src/os/apps/BrowserApp.tsx:28-72`; `packages/ui/src/os/window-context.tsx:42-45`.

Chooser metadata captures `ownerGeneration`/`deliveryToken`, but neither chooser checks them when accepting a selection. Both use the live owner supplied by WindowContext, which adopts a reconnect's latest generation. Editor collision detection compares profile + raw path only, ignoring project/worktree and canonical document identity. The promised authorized Files/FileTree selection flow is replaced with a free-text path form.

**Impact:** a chooser opened before reconnect can promote a selection under a different owner lifetime rather than requiring a fresh choice; equal paths in distinct project/worktree targets incorrectly focus another resource. Server filesystem authorization is not claimed bypassed.

**Correction:** fence the captured chooser transaction through selection/loading/promotion and use existing target-bound canonical document identity/authorized file selection. **Confidence: high.**

### W6 — Medium: explicit null shortcut bindings are resurrected

**Evidence:** `packages/ui/src/stores/settings.ts:472-485`; `packages/ui/src/os/action-dispatch.ts:262-276`.

Hydration uses `?? DEFAULT` for nullable palette, focus-cycle and terminal-font shortcuts, restoring defaults after saving null. Coordinator also uses `??` for palette/focus-cycle, so even in-memory null cannot disable them. The pure resolver correctly preserves null; its consumers do not.

**Correction:** distinguish absent from explicitly unbound at every boundary; use the canonical binding resolver. Cover unbind → save → hydrate → native event. **Confidence: high.**

### W7 — Medium: DoubleShift is hardcoded to the wrong action and ignores remapping

**Evidence:** `packages/ui/src/os/action-dispatch.ts:246-259,369-382`; `packages/ui/src/lib/shortcuts.ts:305-331`; `packages/ui/src/os/actions.ts:405-448`.

DoubleShift always executes `app.search.open` rather than the configured filename-search action; it still fires after filename search is unbound/remapped. Other actions configured to DoubleShift never match `matchesKeyboardShortcut`. Blur calls the detector with Escape rather than resetting it; non-Shift/composition/owned events do not reset its timestamp.

**Correction:** resolve gesture bindings through the same action catalog and expose/reset detector state at ownership/composition/blur boundaries. **Confidence: high.**

### W8 — Medium: Applications Catalog is modal in markup only

**Evidence:** `packages/ui/src/os/AppLauncher.tsx:40-64,127-155`; `packages/ui/src/os/Dock.tsx:249-254`; `packages/ui/src/os/action-dispatch.ts:190-196`.

Launcher adds `aria-modal` and a private Escape listener but never registers shell modal ownership, traps focus, restores the opener or marks background content inert. Its state is local to Dock, invisible to the coordinator's modal checks. Configured actions can therefore execute behind the catalog. Keyboard events from the nested pin button also bubble to the card's Enter/Space launch handler (`AppLauncher.tsx:197-223`).

**Correction:** reuse the established modal/focus lifecycle and separate card launch/pin keyboard activation. **Confidence: high.**

### W9 — Medium: mounted background-menu actions are incompletely wired

**Evidence:** `packages/ui/src/os/DesktopCanvas.tsx:205`; `packages/ui/src/os/DesktopContextMenu.tsx:80-94,179-192,258-278`; `packages/ui/src/os/action-executor.ts:165-168`.

Canvas supplies only `desktopId`: no palette callback, context provider or notice sink. Command Palette invokes an executor branch that returns success without toggling anything. Default background capture uses only the focused window, not the desktop's selected/default context; on an empty desktop New Terminal has no owner and silently returns through missing `onNotice`.

**Correction:** wire real shell capabilities and desktop context at the mounting boundary; deliver disabled/error outcomes visibly. **Confidence: high.**

### W10 — Medium: Appearance sender and consumer use different state fields

**Evidence:** `packages/ui/src/os/action-executor.ts:463-470,490-497`; `packages/ui/src/os/apps/SettingsApp.tsx:20-29,82-87`.

Executor writes `section: "appearance"`; SettingsApp reads `settingsSection`. General tab can open, but the page never receives the Appearance request and cannot expand/scroll/focus it. Isolated tests encode opposite shapes (`action-executor.test.ts:155`, `SettingsApp.test.tsx:79-82`), masking the integration failure.

**Correction:** one typed delivery shape shared by executor and consumer; test a real repeated action through SettingsPage. **Confidence: high.**

### W11 — Medium: reference-counted coordinator cleanup removes the wrong listener closures

**Evidence:** `packages/ui/src/os/action-dispatch.ts:358-403`; `packages/ui/src/hooks/use-cognito-mode-input-guard.ts:246`; `packages/ui/src/embed/dam-hopper-app.tsx:297-300`.

Every installation creates fresh closures, but only the first installs them. If first and second installers clean up in registration order, the last cleanup removes its own never-installed closures, leaving the first listener set attached. Root currently calls the installer through both the Cognito hook and its own layout effect.

**Correction:** keep one shared installed listener/teardown pair, or one owning installation; test two consumers and both cleanup orders, including StrictMode remount. **Confidence: high.**

### W12 — High acceptance gap: qualification claims exceed executable evidence

**Evidence:** `packages/ui/e2e/os-desktop-polish/os-desktop-polish.spec.ts:19-20,50-61,63-83`; `packages/ui/browser-tests/os-desktop-polish.browser.tsx:131-171`; `plans/261105-0711-os-desktop-polish/reports/live-terminal-qualification.md:4-24`; `plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md:5-20`.

E2E creates a terminal observer only to reset viewport/zoom; no physical PTY-byte, attach/replay, iframe-context, Monaco undo/selection, two-tab or restart assertions. Maximize checks are conditional and may be skipped. Screenshot capture helper is imported but never called; the E2E directory contains only spec and pending review ledger. Component test named Escape dismissal directly calls `dismissContextMenu`; shortcut test clicks the TopBar instead of sending the shortcut. The “live” report supplies architecture prose, not live measurements. Yet handoff marks automated acceptance completed/passed.

**Correction:** qualify the named boundaries with real observers/artifacts and preserve pending status until then; do not infer runtime continuity from stable container markup. **Confidence: high for evidence gap, not a claim that every runtime invariant fails.**

## Suggestions — architecture, performance, KISS/DRY

1. Reuse one immutable action-context resolver for Dock, palette, background and keyboard, retaining explicit owner/target/destination. Current duplicated construction caused W1/W2/W9.
2. Remove the no-op backward-compatibility hook (`packages/ui/src/hooks/use-browser-shortcut-guard.ts:1-7`) and dead imports/launch Promise scaffolding, rather than advertising a second inactive pathway. Keep scalar action effects in one executor instead of duplicating font/palette/focus dispatch rules.
3. Apply cursor theme to actual owned portal targets: `OsShell.tsx:81-85` supplies only shellRoot; ContextMenu body portals are marked owned but never receive cursor attributes/variables. Keep forced-colors and native text/resize/grab behavior.
4. Prefer boundary integration tests over structure assertions: the mismatch in W10 and unused journal demonstrate that individually passing producer/consumer tests are insufficient.
5. Precompute static descriptor lists/binding projections rather than rebuilding `Object.values`/reparsing every action on ordinary keydown (`action-dispatch.ts:315-320`). Not a measured bottleneck; correctness fixes come first.
6. Surface returned persistence/action failures at UI boundaries. Pin buttons currently ignore `toggleDockPin` failure results, and most `void executeAction` callers discard blocked/disabled outcomes.

## Positive observations

- Pure manifest-backed catalog and presence-aware resolver offer a good central contract.
- Canonical immutable dock-pin snapshots suit `useSyncExternalStore`; explicit empty pin sets are retained.
- Finite appearance bounds and targeted TOML null encoding are sensible backend boundaries.
- Stable presentation containers and browser-vs-canvas viewport separation are appropriate designs; live continuity remains a separate qualification gate.
- Human review ledger correctly remains `PENDING_HUMAN_REVIEW`.

## Validation status

Reviewer ran no builds/tests/linters; the designated tester owns execution. Tester reported UI build and E2E typecheck exit 0, browser 6 suites/38 tests passed, and targeted Rust 263 tests passed.

Inspected `artifact://223`: earlier full UI suite **349 passed / 1 failed suites; 3,339 passed / 1 failed tests**, failure in ContextMenu export-contract expectation. Current source `ContextMenu.test.tsx:135-147` already includes new submenu exports; no rerun requested/performed, so this remains prior-snapshot evidence, not a confirmed current failure or clean-current-suite claim. Coverage percentages unavailable; no invented metrics.

## Unresolved evidence

No reviewer-exercised live multi-profile dispatch, cross-tab launch, physical PTY byte probe, runtime continuity or visual qualification. Existing test success does not settle W1–W12. No unresolved product question is required to correct these contracts.
