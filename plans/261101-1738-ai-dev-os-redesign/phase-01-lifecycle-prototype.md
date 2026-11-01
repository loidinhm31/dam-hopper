# Phase 01: P1 — Lifecycle prototype first

Estimate: 64h; implementation status: **pending**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; pending. PROTOTYPE FIRST: Phase01 core starts immediately after `remove-native-ui` shared-host pruning, concurrently with native build cleanup, Usage server/web/Android/docs and P0 release. No P0 docs/manual/version/publication prerequisite. Only route-integration subtask waits for Usage web's two shared embed files. URL-only `/os` ships without old navigation/build flag; old UI default until08. [Design](../reports/brainstorm-261101-1738-ai-dev-os-redesign.md), [ownership](ownership.md).

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
Task arrays below are the literal ownership authority. New `os/` files are created; listed existing terminal/layout/editor/host/route files modified; nothing deleted. AC5/6/9/11 begin here; AC4 remains `/os` only until cutover. Prototype gate is mandatory before full chrome/app work; failing lifecycle evidence blocks progression, not papered over by screenshot/component success.

## Risks / security / rollback
DOM lifetime is highest risk; live-identity gate precedes polish. Request generations must not destroy parked resources/reuse capabilities; stable iframe parent if needed. Roll back prototype-only route/modules/extraction without reverting P0 removal work or killing sessions. P0 and prototype use source-pinned isolated qualification artifacts during concurrent work. Phase04 waits prototype gate only; Phase08 root cutover also requires independent P0 release receipt.

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

- [ ] <!-- evcrate-task:generalize-tile-tree --> Generalize shared tiling primitives without terminal JSON drift
- [ ] <!-- evcrate-task:implement-os-lifecycle --> Implement three-app OS lifecycle and parked resource hosts
- [ ] <!-- evcrate-task:integrate-os-prototype-route --> Integrate hidden OS route after exact two-file Usage web handoff
- [ ] <!-- evcrate-task:qualify-prototype-gate --> Author and exercise real prototype lifecycle acceptance
