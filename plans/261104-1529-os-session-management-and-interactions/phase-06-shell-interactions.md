# P06 — Coordinated dismissal, geometry and titlebar gestures

Priority P2 · Status pending · Effort 20h · Owner ShellOwner.

## Context, prerequisites and parallelization
Read [C5](architecture-contracts.md), [shell evidence](reports/recipe-interaction-evidence.md), [P01 interfaces](phase-01-shared-contracts.md), existing `TopBar`, `WindowList`, `NotificationCenter`, `CommandPalette`, custom server dialogs, `input-arbiter.ts:83-140`, `OsShell.tsx:191-197`, `window-ops.ts:23-46,200,394-443`, `DesktopCanvas` ResizeObserver and `WindowFrame` drag/header.
After `freeze-shared-contracts`, these two disjoint tasks may run concurrently within the ShellOwner branch or sequentially; one named owner coordinates both. P02/P03/P05 concurrent and disjoint. P04 waits BOTH. ShellOwner releases every shared file before IntegrationOwner in P07; no integration/frame Close wiring while shell task live. No blanket primitive or theme refactor.

## Requirements and architecture
Reuse installed Radix Dialog/Select/context-menu primitives and existing confirmation styles, not a generalized overlay stack. One small explicit shell input context exposes current named controlled nonmodal state, actual modal count and Cognito suppression; Radix nested portal event/focus ownership handles topmost dismissal. Geometry uses actual destination canvas; saved geometry remains original while display projection adapts to shrink/zoom.

### Task `dismiss-shell-layers`
**Modify:** `packages/ui/src/os/TopBar.tsx`, `packages/ui/src/os/WindowList.tsx`, `packages/ui/src/os/NotificationCenter.tsx`, `packages/ui/src/os/CommandPalette.tsx`, `packages/ui/src/os/OsShell.tsx`, `packages/ui/src/os/input-arbiter.ts`, `packages/ui/src/os/input-arbiter.test.ts`, `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`, `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`, `packages/ui/browser-tests/os-shell.browser.tsx`, `packages/ui/browser-tests/os-input-isolation.browser.tsx`. **Create:** `packages/ui/src/os/shell-input-context.tsx`. **Delete:** no files; remove obsolete document listeners/timed-focus code within modified components. ShellOwner only; transfer OsShell/WindowList/context to IntegrationOwner after terminal result.

1. Implement finite named state for Target selector / Window List / Notification Center / Command Palette in shell, with explicit callbacks and modal lifecycle accounting for custom profiles/settings/Close confirmations. Not an arbitrary registered-layer framework. Adopt installed primitives directly where they fit; reuse existing confirmation UI. Each nonmodal dismisses on outside pointer, remains open on mouse leave; opening another shell nonmodal closes previous intentionally. Notification Center must not claim modal semantics without trapping/backdrop; implement it as nonmodal transient with correct semantics.
2. Replace Target selector hand-rolled dismissal, WindowList document mousedown and NotificationCenter close-only behavior with controlled accessible primitive dismissal/focus. Handle inside/outside by actual root/content ownership, not `[data-radix-portal]` catch-all. Nonmodal outside pointer dismisses while preserving intended clicked target. Escape closes ONLY topmost actual dismissible content; nested Select/context menu consumes first, parent remains. Stop terminal/OS shortcut delivery only for consumed interaction, not every key globally.
3. Palette: remove 50ms delayed focus. Use synchronous auto-focus on mount, actual focus trap, invoking-element restoration on keyboard close, backdrop pointer dismissal that consumes pointer before it can activate underlying PTY. Retain search/command behavior and accessible keyboard navigation; no duplicate global Escape listeners or synthetic key forwarding.
4. ServerProfilesDialog/ServerSettingsDialog adopt controlled accessible modal roots, portals and valid return focus. Track dirty form against last saved values (including profile add/edit/remove drafts and settings panes). Backdrop/X/Escape/Cancel request save/discard/cancel confirmation when dirty; initial safe Cancel. Nested confirmation Escape cancels ONLY confirmation, retaining form. Save failure keeps draft/form; discard explicit; awaiting dispatched mutation cannot become falsely cancelled by dismiss. Ensure actual nested Radix dialog/select layering prevents parent dismissal. No generic change to all repository dialogs.
5. Thread actual `useCognitoModeStore.active` into shell arbitration instead of hardcoded false. Cognito remains highest priority, IME/real modal/layer ownership next, existing OS/frame/app precedence afterward. Current modal count comes from mounted controlled dialogs, not DOM matching. Consume appropriate shell keys before xterm without stealing unowned app keys; real modal focus trap is required, not `app-passthrough` as sole safety. Expose suppression state for P07 generic TerminalPanel integration; all lifecycle increments/decrements paired, including nested/unmount/retirement.
6. Browser tests act on DOM/physical focus for named layers, nested portaled selector Escape, palette immediate focus/trap/restore, nonmodal outside target preservation, modal backdrop consumption, dirty draft retention and dispatched-mutation status. Replace synthetic-arbiter-only input claims with DOM listener/browser behavior; pure arbiter tests remain supporting logic only. P08 real PTY-byte oracle is required to prove no stdin escape; this branch does not claim that from component mocks.

### Task `canvas-placement-gestures`
**Modify:** `packages/ui/src/os/window-ops.ts`, `packages/ui/src/os/window-ops.test.ts`, `packages/ui/src/os/window-store.ts`, `packages/ui/src/os/DesktopCanvas.tsx`, `packages/ui/src/os/WindowFrame.tsx`, `packages/ui/browser-tests/os-lifecycle.browser.tsx`. **Create/Delete:** none. ShellOwner only; these paths disjoint from dismissal task. P07 then takes store/frame for qualified routing/Close wiring; do not modify OsShell or WindowList from this task.

1. Implement frozen pure destination placement seam using ResizeObserver canvas dimensions (excludes bars/dock), not window.innerWidth/Height. Unpositioned new float starts at fitted origin and cascades deterministic 28px steps from existing eligible origins; wrap when next title/control area falls outside usable canvas. Fit dimensions to supported canvas, including small canvas below nominal min; ensure titlebar/controls reachable. No optimizer or overlap-free promise; never move existing windows.
2. Store `openWindow` passes destination viewport/placement inputs while preserving `defaultWindowPlacement ?? "float"`, explicit caller mode/bounds, restored/user geometry. First tile -> float with no prior float bounds uses same initial placement; prior bounds reused. Do not reset mode default to tile or change layout:v3/os:v1 schema for incidental convenience.
3. On resize/shrink/zoom render `projectFloatBounds(saved,viewport)` instead of mutating saved floatBounds/tree. `setViewport` updates measurement only. Widen restores saved positions/sizes; explicit user drag/resize may intentionally save new bounds. Preserve topology and restored geometry through compact viewport/reload. Derived clamp should allow all title controls to be reached at 1024x640 and zoom probes without destructive reflow.
4. Implement atomic `toggleWindowMode(windowId)` pure op and one Zustand set: exit maximization and switch tile/float together using existing docking/float logic. Focus, desktop/pane membership and runtime identity preserved; no transient intermediate maximized/new-mode state. Existing Maximize/Restore and keyboard mode controls remain independent/accessibly operable.
5. Header gestures: primary button only; noninteractive titlebar background only. Exclude buttons/selects/links/inputs/contenteditable/ARIA controls, resize handles/app content. Track pointer start and movement; actual drag begins only after 4 CSS px threshold and suppresses subsequent double-click toggle for that sequence. Double-click toggles exactly once including maximized case; ignore secondary and privacy-blocked input. Do not turn a double-click into two drags or maximize. Capture/release/cancel listeners correctly; active drag/resize aborts immediately on Cognito activation/unmount and cannot write geometry afterward.
6. Pure tests assert independent expected 28px origins, wrap/fit, explicit/restored preservation, first float/prior float reuse, shrink->widen geometry continuity and atomic maximized toggle with valid pane topology. Browser tests prove event exclusions/threshold/focus and mode controls; P08 live xterm counter and physical privacy checks remain final oracle. Replace tests pinned to old default coordinates or wording; no trivial wiring-only tests.

## Consumer-visible acceptance and exact future checks
- Every named layer obeys outside/Escape/focus/dirty rules, nested portals close one layer, no delayed palette focus gap.
- New unpositioned floats cascade when space permits and controls stay reachable; explicit/restored bounds and float preference preserved; shrink/widen reversible.
- Primary background double-click changes mode once; controls/secondary/drags/Cognito do not; mode switch from maximized is atomic.
- P08: `pnpm --filter @dam-hopper/ui test -- src/os/input-arbiter.test.ts src/os/window-ops.test.ts src/os/persistence.test.ts`; `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-shell.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/os-lifecycle.browser.tsx`; actual authenticated rows 5/6/7 and live PTY oracle afterward.

## Failure, rollback, security and resources
Leaks of consumed keys/pointers to PTY, silently discarded dirty drafts, stale modal count or privacy-active gesture writes block integration. Primitive adoption alone is not input proof. Bound listeners to mounted component/gesture; remove timers and listeners made obsolete. Rollback only scoped UI changes without changing persisted geometry or resetting preferences; do not restore false modal semantics while claiming qualification. No broad registry, polling or new dependencies.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "dismiss-shell-layers",
    "title": "Unify named-layer dismissal, focus and actual input ownership",
    "blocked_by": [
      "freeze-shared-contracts"
    ],
    "allowed_files": [
      "packages/ui/src/os/TopBar.tsx",
      "packages/ui/src/os/WindowList.tsx",
      "packages/ui/src/os/NotificationCenter.tsx",
      "packages/ui/src/os/CommandPalette.tsx",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/input-arbiter.ts",
      "packages/ui/src/os/input-arbiter.test.ts",
      "packages/ui/src/components/organisms/ServerProfilesDialog.tsx",
      "packages/ui/src/components/organisms/ServerSettingsDialog.tsx",
      "packages/ui/browser-tests/os-shell.browser.tsx",
      "packages/ui/browser-tests/os-input-isolation.browser.tsx",
      "packages/ui/src/os/shell-input-context.tsx"
    ],
    "constraints": [
      "ShellOwner only; serialized handoff to IntegrationOwner before P07.",
      "No generalized overlay registry, global portal selector or unrelated dialog refactor."
    ],
    "acceptance": [
      "All six named surfaces handle topmost Escape/outside/focus correctly and dirty forms keep save/discard/cancel protection.",
      "Actual Cognito/modal state governs shell and exposes owner-bound terminal suppression; palette focuses synchronously."
    ],
    "verification": [
      "P08 run P06 exact unit/browser commands; authenticated physical PTY-byte oracle and dirty/nested-modal cases."
    ]
  },
  {
    "id": "canvas-placement-gestures",
    "title": "Implement reversible float cascade and atomic titlebar mode gesture",
    "blocked_by": [
      "freeze-shared-contracts"
    ],
    "allowed_files": [
      "packages/ui/src/os/window-ops.ts",
      "packages/ui/src/os/window-ops.test.ts",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/DesktopCanvas.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/browser-tests/os-lifecycle.browser.tsx"
    ],
    "constraints": [
      "ShellOwner only; no OsShell/WindowList writes from this task.",
      "Keep float preference, saved geometry/topology and resource identity; no packing optimizer."
    ],
    "acceptance": [
      "Unpositioned floats cascade 28px within actual canvas; explicit/restored bounds survive shrink/widen.",
      "Primary background double-click toggles exactly once atomically out of maximize; interactive/secondary/drag/privacy inputs do not."
    ],
    "verification": [
      "P08 run P06 unit/browser commands and authenticated viewports/zoom/gesture cases with same xterm and zero placement attach/replay/reset."
    ]
  }
]
```

- [x] <!-- evcrate-task:dismiss-shell-layers --> Unify named-layer dismissal, focus and actual input ownership
- [x] <!-- evcrate-task:canvas-placement-gestures --> Implement reversible float cascade and atomic titlebar mode gesture
