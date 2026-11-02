# Phase 01: P1 — Lifecycle prototype first

Estimate: 64h; implementation status: **DONE (2026-11-02)**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; status: **DONE (2026-11-02)**. PROTOTYPE FIRST: Phase01 core starts immediately after `remove-native-ui` shared-host pruning, concurrently with native build cleanup, Usage server/web/Android/docs and P0 release. No P0 docs/manual/version/publication prerequisite. Route integration completed with hidden authenticated `/os` route in `dam-hopper-app.tsx` following Usage web retirement. Task 4 authoring completed in browser lifecycle and E2E fixtures; live-stream container qualification carried to Phase 09. URL-only `/os` ships without old navigation/build flag; old UI default until08. [Design](../reports/brainstorm-261101-1738-ai-dev-os-redesign.md), [ownership](ownership.md).

## Architecture and requirements
- Generalize existing recursive tree and renderer, not a parallel dockview/layout implementation. Canonical `TileTree<T>` uses pane `items`/`active`; terminal codec preserves every `terminal-layout:v3:*` key and its existing `{version:2,root}` payload with `sessionIds`/`activeSessionId`. Key version and payload version differ today; neither changes. Preserve node IDs, ratios, active tabs and owner-qualified terminal routing IDs.
- Static minimal registry; manifests expose app ID, instancing, minimum ctx, placement, min size, intents and lazy loader. No plugins. Window store owns only stable session state and pure operations, not transports or editor text.
- `OsSessionV1`: schema=1, desktops (ID/name/defaultCtx/tree/floating/focus), active desktop, windows keyed by ID (appId/immutable ctx/mode/maximized/appState). Add stable desktop membership and restore-placement metadata for minimized windows so a minimized window has one owner desktop even when absent from tree/float arrays. Enforce exactly-one-placement, valid focus and nonempty sibling collapse; maximize preserves original placement.
- Root resource host stays mounted above desktop/window render branches. Window bodies supply slots, not resources; inactive desktop app bodies can unmount. Reuse `TerminalKeepAliveHost`, `MonacoHost`, `BrowserDebugKeepAliveHost` and terminal attachment/fit registries. Introduce Monaco parking ownership; preserving text alone is insufficient: model, undo/view state and editor instance remain alive across moves.
- For every placement-only tile/float/maximize/minimize/desktop operation after initial attach: preserve the SAME xterm instance, send ZERO additional outbound `terminal:attach`, and perform ZERO new buffer replay/reset. Unchanged PTY identity/output alone cannot prove this: a replacement xterm can attach/replay the same PTY. Real transport disconnect/reconnect is a separate scenario: owner revalidation and necessary stream attach/replay are allowed, but the parked xterm/resource instance is not destroyed.
- Central visible-slot claim key includes profile/resource identity, runtime generation and concrete terminal incarnation (plus epoch where provided). A profile-wide and project-scoped Terminals window cannot show the same PTY twice; second claim offers focus-existing, never steals/duplicates attach. Editor and iframe claims similarly unique.
- Explicit `useWindowOwner()` captures current `{profileId,generation}` per action; keep a verified concrete identity separately. Disconnect preserves scrollback/dirty editor/iframe DOM but disables writes/input and revokes stale bridge/media capabilities. Reconnect revalidates the same profile/project/worktree/terminal incarnation; changed ID incarnation/epoch remains unavailable with explicit recovery, never silent rebinding. Generation changes must not by themselves destroy parked DOM. Bridge credentials may be renewed without iframe reload when required by existing protocol.
- Persistence only `dam-hopper:os:v1:session`, debounced; stable refs and allowlisted app view state, no generations/epochs/incarnations, credentials, output or dirty text. Invalid/unknown schema -> clean in-memory default plus notice without touching terminal v3 keys; preserve unreadable original OS bytes and suspend autosave until explicit reset/import approval. Storage denied/full -> usable in-memory session plus notice. JSON import validates registry IDs, targets, tree references and geometry before atomic replacement; inert, never spawns.
- Minimal frame toolbar exposes tile/float/maximize/minimize/restore/move-desktop and context badge. Basic input precedence: Cognito first, IME/dead/repeat/AltGr bypass, shortcut-capture bypass, focused frame vs app, then terminal passthrough. `Ctrl+Alt+Escape` changes focus without PTY bytes. Terminal split/cycle remains inside Terminals unless frame is focused.
- Hidden/minimized/background resources do not fit or allocate WebGL; active visible terminals only get WebGL; retain DOM fallback already in terminal-renderer. Close-window != kill-PTY; dirty editor close uses existing save/discard guard.
- Legacy UI remains default except completed removal changes. `/os` is authenticated/lazy/URL-only, no old nav/palette discovery or build flag; host root mounts only there. Prototype can land/qualify before P0 release. `embed/dam-hopper-app.tsx` and its test are the ONLY prototype/Usage-web shared paths: removed from core ownership and owned by the separately ordered route task below.

## Ordered implementation by task ID
### generalize-tile-tree
1. Extract generic split/pane traversal, docking/collapse and sizing into `types/tile-tree.ts`, `lib/tile-tree.ts`; adapt existing terminal modules to it through explicit wire codec, not a second algorithm or persistent migration.
2. Extract generic recursive rendering/drop geometry in SplitLayout; terminal entry retains its current API while every terminal caller continues using the same renderer/ops. New OS renderer supplies item/tab rendering, IDs and callbacks.
3. Add fixture regressions for actual v3-key payloads, tab ordering/active IDs, nesting, resizing and drag targets. Preserve terminal browser reserved-pane semantics.
### implement-os-lifecycle
1. Add OS types/store/pure operations, minimal registry, root `OsShell`, `DesktopCanvas`/`WindowFrame`, three app adapters and explicit context provider. One store transaction per placement change; clamp float bounds on zoom/viewport resize.
2. Put long-lived controllers and hosts in `OsResourceHost`; adapt EditorTabs/Monaco and terminal/browser slot attachments so moving a body never remounts a live resource. Keep old WorkspacePage resource path untouched; use its existing hooks as extracted reusable behavior only if needed and coordinator grants additional files.
3. Implement core persistence/import-export/input without editing embed route files. Native host pruning is already complete; all remaining P0 work may continue in disjoint files. Root services remain single instances when route is later integrated.
4. Terminals adapter reuses Traditional display and manager with explicit context filtering; Browser adapter uses existing web preview/controller; Editor adapter uses existing owner-bound editor store and memory-only dirty buffers.
### integrate-os-prototype-route
1. After lifecycle core AND `retire-usage-web`, exclusively modify only `embed/dam-hopper-app.tsx` and its test to add authenticated lazy URL-only `/os` while keeping old root/default and no discovery/build flag.
2. This is a two-file handoff, NOT a wait for Usage backend/Android/docs/manual cleanup/version or release. Coordinator pins P0 versions of shared hosts/embed at writer handoff for isolated P0 artifact qualification; no tests against half-edited live prototype files.
### qualify-prototype-gate
1. Author a real application E2E journey at `/os` with isolated server/profile fixtures, live streaming PTY, dirty Monaco and running browser preview; add browser tests for host identity and keyboard precedence.
2. After relevant prototype source writers join, main captures real settled xterm/editor/model/iframe identities and attach/replay/reset counters. Use a source-pinned coherent prototype fixture/artifact; P0 qualification uses its own isolated P0 snapshot and does not impose a prototype/release receipt dependency.
3. For EACH placement-only tile -> float -> maximize/restore -> minimize/restore -> desktop move and inactive-desktop unmount, assert the SAME xterm instance and ZERO deltas in outbound terminal:attach/buffer replay/reset after that baseline; Monaco undo/model and browser JS/iframe identity unchanged. Separately disconnect/reconnect with new generation: permit only necessary owner-revalidated stream attach/replay, retain the parked xterm, preserve sibling resources and block changed incarnation. Report placement and reconnect evidence separately.
4. Prove Cognito blocks physical input/paste/pointer to terminal/editor/preview, frame chords produce zero PTY bytes, app splits do not split OS tree, IME/AltGr and remapped escape work. Reload restores layout but does not promise dirty text survives browser reload.

## File actions / success
Task arrays below are the literal ownership authority. New `os/` files are created; listed existing terminal/layout/editor/host/route files modified; nothing deleted. AC5/6/9/11 begin here; AC4 remains `/os` only until cutover. Prototype gate was planned before full chrome/app work; by default, failing lifecycle evidence blocks progression. Per user approval (2026-11-02), the component DOM continuity checkpoint was accepted to unblock Phase 04 progression, with the live container daemon E2E lifecycle qualification gate carried forward to Phase 09.

### Verification Record — Phase 01 Completion (2026-11-02)
- **Status:** Phase 01 marked **DONE per user approval (2026-11-02)**; technical acceptance incomplete; component DOM continuity checkpoint accepted; live daemon E2E gate carried to Phase 09.
- **Task Dispositions:**
  - `generalize-tile-tree` (Task 1): **Completed**. Generic `TileTree<T>` data model, pure layout ops, and lossless wire codec for `terminal-layout:v3:*` delivered and regression tested.
  - `implement-os-lifecycle` (Task 2): **Completed**. Core OS types, pure window operations, Zustand window-store, app registry, central `ResourceRegistry` with single-visible-slot enforcement, persistence validation, input arbiter, `OsShell`, `DesktopCanvas`, `WindowFrame`, `MonacoKeepAliveHost`, `OsResourceHost`, and three app adapters (`TerminalsApp`, `EditorApp`, `BrowserApp`) implemented in source.
  - `integrate-os-prototype-route` (Task 3): **DONE**. Authenticated lazy `/os` route integrated into `packages/ui/src/embed/dam-hopper-app.tsx` with `AuthenticatedOsRoute`, client profile/token presence gating, unauthenticated fallback banner, and `GlobalShortcuts` isolation (`Ctrl+Backquote` suppressed on `/os`, retained on `/`). Verified by 10/10 tests in `dam-hopper-app.test.tsx`.
  - `qualify-prototype-gate` (Task 4): **Component DOM continuity checkpoint accepted with Cycle 4 review (score 7/10, 86 tests passed across 11 files + Vite web build); carried live daemon E2E gate**. Browser component lifecycle test `packages/ui/browser-tests/os-lifecycle.browser.tsx` verifies synthetic slot containment and DOM element reference continuity (cast DOM terminal, null-editor Monaco element) across the full transition matrix (tile, float, max, restore, min, desktop move) for terminal and editor instances (9/9 passed). Playwright E2E journey structure authored in `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts` with clean static compilation (`test:e2e:typecheck`, 0 errors). Full live daemon E2E qualification (live container daemon PTY socket streaming, outbound zero-attach/replay counters, live Monaco undo/model preservation under container daemon, behavioral input isolation under Cognito mode, and reconnect incarnation fencing) carried forward to Phase 09 (`OS app/visual qualification`).
- **Phase 01 Final Validation Evidence (recorded in `tester-cycle4-261102-1120-lifecycle-prototype.md`):**
  - Tester reports 86 passed / 86 total across 11 test files (all exit 0; not independently executed here):
    - 10 embed route tests (`dam-hopper-app.test.tsx`).
    - 26 OS core unit tests (`src/os/*`).
    - 9 synthetic browser lifecycle tests (`browser-tests/os-lifecycle.browser.tsx`).
    - 41 keep-alive and layout regression tests (`tile-tree`, `docking`, `MonacoHost`, `TerminalKeepAliveHost`, `BrowserDebugKeepAliveHost`).
    - Playwright E2E static compilation check clean (`tsc -p tsconfig.e2e.json`, 0 errors).
    - Production web build clean (Vite web build, 6,118 modules transformed, `OsShell` chunk generated).
- **Cycle 4 Code Review & Carried Technical Acceptance Items (`code-review-261102-1123-phase-01-cycle-4.md`):**
  - Score: 7/10 (request changes for technical acceptance; component DOM continuity checkpoint accepted with Cycle 4 review; carried live daemon E2E gate). Narrow remediations verified: mandatory terminal surface attachment with 15s timeout, legacy `Ctrl+Backquote` navigation verified on `/` alongside `/os` isolation, `authType: "basic"` enum alignment, and intermediate registry-element comparisons added across minimized/inactive-desktop intervals.
  - **Carried to Phase 09 Gate (Requiring Authorized Source Remediation):**
    - **H1:** Live lifecycle and streaming oracle: live container daemon PTY streaming, outbound zero-attach/replay/reset counters, dirty Monaco model/undo preservation, and controlled preview JS state continuity across window operations.
    - **H2:** Behavioral privacy and input oracle under Cognito mode verifying received PTY bytes, editor text, preview events, and restored input after mask removal.
    - **C1:** Editor save generation fencing & potential plaintext writes: encryption policy lookup hard-coding generation 1, asynchronous save completion clearing newer edits typed during upload, and fabricated empty tab state on owner-bound file loading (Cycle 3 finding W1).
    - **C2:** Terminal owner retirement & potential cross-profile access: ambient transport fallback (`ambient:<generation>`) for retired profile connections risking cross-profile read/write across equal raw terminal IDs, and retained-focus keyboard/paste exposure under CSS pointer suppression.
    - **Cycle 3 Carried Warnings (W2–W4):** Monaco DOM reparenting cleanup during unmount (Cycle 3 W2), real resource controller integration (Cycle 3 W3), and rendered-slot/shortcut-capture input regressions (Cycle 3 W4).
    - **Cycle 4 Carried Warnings (W1–W4):** Connected parking-host containment assertions (Cycle 4 W1; registry retention alone permits detached DOM), reactive profile notification boundary without explicit test re-render (Cycle 4 W2), human visual inspection ledger (`review.md`; Cycle 4 W3), and React 19 test harness `act(...)` warning elimination (Cycle 4 W4).
    - **Source Remediation Ownership Note:** Resolving C1/C2, H1/H2, and Cycle 3 & Cycle 4 carried warnings requires an explicitly authorized source-remediation handoff prior to final Phase 09 lifecycle gate qualification.
## Risks / security / rollback
DOM lifetime is highest risk; live-identity gate precedes polish. Request generations must not destroy parked resources/reuse capabilities; stable iframe parent if needed. Roll back prototype-only route/modules/extraction without reverting P0 removal work or killing sessions. P0 and prototype use source-pinned isolated qualification artifacts during concurrent work. Phase04 progression is unblocked by the user-approved Phase 01 component DOM continuity checkpoint; live-stream container qualification carries to Phase 09; Phase08 root cutover also requires independent P0 release receipt.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `generalize-tile-tree` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/types/tile-tree.ts` |
| Modify | `packages/ui/src/types/terminal-layout.ts` |
| Create | `packages/ui/src/lib/tile-tree.ts` |
| Create | `packages/ui/src/lib/tile-tree.test.ts` |
| Modify | `packages/ui/src/lib/terminal-layout-tree.ts` |
| Modify | `packages/ui/src/lib/terminal-layout-docking.ts` |
| Modify | `packages/ui/src/lib/terminal-layout-docking.test.ts` |
| Modify | `packages/ui/src/hooks/use-terminal-layout.ts` |
| Modify | `packages/ui/src/components/organisms/SplitLayout.tsx` |
| Modify | `packages/ui/src/components/organisms/SplitLayout.test.ts` |

### `implement-os-lifecycle` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/os/types.ts` |
| Create | `packages/ui/src/os/window-ops.ts` |
| Create | `packages/ui/src/os/window-ops.test.ts` |
| Create | `packages/ui/src/os/window-store.ts` |
| Create | `packages/ui/src/os/app-registry.ts` |
| Create | `packages/ui/src/os/window-context.tsx` |
| Create | `packages/ui/src/os/resource-registry.ts` |
| Create | `packages/ui/src/os/resource-registry.test.ts` |
| Create | `packages/ui/src/os/persistence.ts` |
| Create | `packages/ui/src/os/persistence.test.ts` |
| Create | `packages/ui/src/os/input-arbiter.ts` |
| Create | `packages/ui/src/os/input-arbiter.test.ts` |
| Create | `packages/ui/src/os/OsShell.tsx` |
| Create | `packages/ui/src/os/OsResourceHost.tsx` |
| Create | `packages/ui/src/os/MonacoKeepAliveHost.tsx` |
| Create | `packages/ui/src/os/DesktopCanvas.tsx` |
| Create | `packages/ui/src/os/WindowFrame.tsx` |
| Create | `packages/ui/src/os/apps/TerminalsApp.tsx` |
| Create | `packages/ui/src/os/apps/EditorApp.tsx` |
| Create | `packages/ui/src/os/apps/BrowserApp.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/MonacoHost.tsx` |
| Modify | `packages/ui/src/components/organisms/MonacoHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/EditorTabs.tsx` |
| Modify | `packages/ui/src/components/organisms/EditorTabs.test.tsx` |
| Modify | `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` |
| Modify | `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` |
| Modify | `packages/ui/src/components/organisms/PaneContainer.tsx` |
| Modify | `packages/ui/src/lib/browser-debug-keep-alive.ts` |
| Modify | `packages/ui/src/lib/terminal-host-attachment.ts` |
| Modify | `packages/ui/src/lib/terminal-fit-scheduler.ts` |
| Modify | `packages/ui/src/stores/editor.ts` |
| Modify | `packages/ui/src/hooks/use-terminal-manager.ts` |
| Modify | `packages/ui/src/hooks/use-terminal-manager.test.ts` |
| Modify | `packages/ui/src/hooks/use-browser-debug.ts` |
| Modify | `packages/ui/src/hooks/use-browser-debug.test.ts` |
| Modify | `packages/ui/src/lib/terminal-registry.ts` |

### `integrate-os-prototype-route` file actions

| Action | Literal writable path |
|---|---|
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Modify | `packages/ui/src/embed/dam-hopper-app.test.tsx` |

### `qualify-prototype-gate` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/browser-tests/os-lifecycle.browser.tsx` |
| Create | `packages/ui/e2e/os-lifecycle` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "generalize-tile-tree",
    "title": "Generalize shared tiling primitives without terminal JSON drift",
    "blocked_by": ["remove-native-ui"],
    "allowed_files": [
      "packages/ui/src/types/tile-tree.ts",
      "packages/ui/src/types/terminal-layout.ts",
      "packages/ui/src/lib/tile-tree.ts",
      "packages/ui/src/lib/tile-tree.test.ts",
      "packages/ui/src/lib/terminal-layout-tree.ts",
      "packages/ui/src/lib/terminal-layout-docking.ts",
      "packages/ui/src/lib/terminal-layout-docking.test.ts",
      "packages/ui/src/hooks/use-terminal-layout.ts",
      "packages/ui/src/components/organisms/SplitLayout.tsx",
      "packages/ui/src/components/organisms/SplitLayout.test.ts"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Generic tree and renderer host terminal items or OS window IDs; all v3-key payloads roundtrip unchanged.",
      "No second tiling algorithm; terminal browser pane and current split gestures unchanged."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/SplitLayout.test.ts",
      "pnpm --filter @dam-hopper/ui build"
    ]
  },
  {
    "id": "implement-os-lifecycle",
    "title": "Implement three-app OS lifecycle and parked resource hosts",
    "blocked_by": [
      "generalize-tile-tree"
    ],
    "allowed_files": [
      "packages/ui/src/os/types.ts",
      "packages/ui/src/os/window-ops.ts",
      "packages/ui/src/os/window-ops.test.ts",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/window-context.tsx",
      "packages/ui/src/os/resource-registry.ts",
      "packages/ui/src/os/resource-registry.test.ts",
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/os/input-arbiter.ts",
      "packages/ui/src/os/input-arbiter.test.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/OsResourceHost.tsx",
      "packages/ui/src/os/MonacoKeepAliveHost.tsx",
      "packages/ui/src/os/DesktopCanvas.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/src/os/apps/TerminalsApp.tsx",
      "packages/ui/src/os/apps/EditorApp.tsx",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx",
      "packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx",
      "packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx",
      "packages/ui/src/components/organisms/MonacoHost.tsx",
      "packages/ui/src/components/organisms/MonacoHost.test.tsx",
      "packages/ui/src/components/organisms/EditorTabs.tsx",
      "packages/ui/src/components/organisms/EditorTabs.test.tsx",
      "packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx",
      "packages/ui/src/components/organisms/MultiTerminalDisplay.tsx",
      "packages/ui/src/components/organisms/PaneContainer.tsx",
      "packages/ui/src/lib/browser-debug-keep-alive.ts",
      "packages/ui/src/lib/terminal-host-attachment.ts",
      "packages/ui/src/lib/terminal-fit-scheduler.ts",
      "packages/ui/src/stores/editor.ts",
      "packages/ui/src/hooks/use-terminal-manager.ts",
      "packages/ui/src/hooks/use-terminal-manager.test.ts",
      "packages/ui/src/hooks/use-browser-debug.ts",
      "packages/ui/src/hooks/use-browser-debug.test.ts",
      "packages/ui/src/lib/terminal-registry.ts"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Three lifecycle app adapters and root resource core complete; embed-route ownership is separate so Usage web/P0 work can proceed concurrently.",
      "All placement-only operations preserve the same parked xterm/Monaco/preview instances with zero additional terminal:attach or buffer replay/reset; single visible PTY slot globally.",
      "Dirty models remain memory-only; reconnect is generation-fenced, context badges explicit and writes fail closed."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/BrowserDebugKeepAliveHost.test.tsx src/components/organisms/MonacoHost.test.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  },
  {
    "id": "integrate-os-prototype-route",
    "title": "Integrate hidden OS route after exact two-file Usage web handoff",
    "blocked_by": ["implement-os-lifecycle", "retire-usage-web"],
    "allowed_files": [
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/embed/dam-hopper-app.test.tsx"
    ],
    "constraints": [
      "Only these two shared embed files writable; core host/store work runs independently in implement-os-lifecycle.",
      "No dependency on P0 backend/Android/docs/manual/version/release; serialize only Usage web's actual embed-file overlap.",
      "Pin P0 embed version at handoff for isolated P0 release artifact; never verify partial live concurrent prototype sources."
    ],
    "acceptance": [
      "Authenticated lazy /os ships URL-only with three real apps, old UI default, no discovery link/build flag or duplicated root services.",
      "Usage web and prototype never concurrently write either embed file; prototype does not wait for P0 publication."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/embed/dam-hopper-app.test.tsx",
      "pnpm --filter @dam-hopper/ui build",
      "On coherent prototype artifact verify direct authenticated /os, old default root, zero old navigation discovery links/build flag."
    ]
  },
  {
    "id": "qualify-prototype-gate",
    "title": "Author and exercise real prototype lifecycle acceptance",
    "blocked_by": [
      "integrate-os-prototype-route"
    ],
    "allowed_files": [
      "packages/ui/browser-tests/os-lifecycle.browser.tsx",
      "packages/ui/e2e/os-lifecycle"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Every placement-only operation preserves the same xterm instance and causes zero additional outbound terminal:attach and zero buffer replay/reset after initial attach; Monaco undo/model and preview identity survive.",
      "Real disconnect/reconnect is tested separately: only necessary owner-revalidated attach/replay allowed, parked xterm not destroyed, changed incarnation blocked.",
      "Cognito/frame/app/terminal isolation proven against physical PTY and real preview, not only mocked callbacks."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-lifecycle.browser.tsx",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle",
      "Record real xterm identity and outbound attach/replay/reset counter deltas per placement operation separately from legitimate reconnect; human inspection is separate and no qualification is inferred during authoring."
    ]
  }
]
```

- [x] <!-- evcrate-task:generalize-tile-tree --> Generalize shared tiling primitives without terminal JSON drift
- [x] <!-- evcrate-task:implement-os-lifecycle --> Implement three-app OS lifecycle and parked resource hosts
- [x] <!-- evcrate-task:integrate-os-prototype-route --> Integrate hidden OS route after exact two-file Usage web handoff
- [x] <!-- evcrate-task:qualify-prototype-gate --> Author and exercise real prototype lifecycle acceptance
