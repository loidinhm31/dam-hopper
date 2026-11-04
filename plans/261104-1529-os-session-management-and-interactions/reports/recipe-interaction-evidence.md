# Recipe Target, Shell Interaction, and Canvas Gestures Source Evidence

## 1. Ownership & Workstream Boundaries (Proposed)
- Shared Prerequisites (Freeze First): Shared terminal close contract (Close view vs End session vs Cancel) and atomic mode transitions must be settled before parallel file ownership begins.
- Workstream B (Recipes): `packages/ui/src/os/recipes/` (`RecipeEditor.tsx`, `recipe-engine.ts`, `types.ts`, `schema.ts`, `persistence.ts`, `LaunchReview.tsx`), `packages/ui/src/os/apps/RecipesApp.tsx`.
- Workstream C (Shell interactions & canvas): `packages/ui/src/os/TopBar.tsx`, `WindowList.tsx`, `NotificationCenter.tsx`, `CommandPalette.tsx`, `WindowFrame.tsx`, `window-ops.ts`, `input-arbiter.ts`, `DesktopCanvas.tsx`, and `packages/ui/src/components/organisms/` (`ServerProfilesDialog.tsx`, `ServerSettingsDialog.tsx`).
- Shared Integration Owner: `packages/ui/src/os/OsShell.tsx`, `window-store.ts`, `types.ts`. Close-action triggers in `WindowFrame.tsx:204` and `WindowList.tsx:89` overlap Workstream A's session termination contracts.

## 2. Workstream B: Recipe Capture, Targets, Discovery & Limits
- Props & Schema: `RecipeEditorProps` (`RecipeEditor.tsx:28-36`) takes single `desktop: OsDesktop`, lacking source desktop switching. Schema `RecipeV1` (`types.ts:29-41`) defines `profileId`, `project`, `terminalSteps`, `appSteps`, `layout`. Validation bounds (`schema.ts:12-18`): `MAX_STEPS=32`, `MAX_TREE_DEPTH=10`, `MAX_TREE_NODES=64`, key regex `/^[a-zA-Z0-9_-]+$/`.
- Target Selectors & Discovery: `RecipeEditor.tsx:54-59,255-276` uses raw `<input type="text">` for `chosenProfileId` and `chosenProjectId` with ambient fallbacks. No canonical dropdowns derived from desktop window contexts or project queries (`useProjects`).
- Authored Commands & Confirmation: `RecipeEditor.tsx:68-87,340-376` requires explicit command entry and confirmation checkboxes (`confirmedCommands: Record<RecipeStepKey, boolean>`) for terminals. Export warning in `schema.ts:17-18`.
- Subset Preview & Exclusions (`recipe-engine.ts:32-120`, `calculateSaveSubset`):
  * Excluded contextless apps (`:67`): `system-monitor`, `settings`, `agent-hub`. Defect: `recipes` app itself is NOT currently excluded.
  * Context filtering (`:79,91`): matches `profileId` and `projectId`. Same-project worktrees are included (`:90-100`).
- Executor AC8/F1 Unresolved Gates:
  * AC8 / W1 (`recipe-engine.ts:446-505`): `executeRecipeLaunch` launches terminal steps only (`:454-503`). It does NOT instantiate apps (`appSteps`), restore window topology into the Zustand store, or adopt verified alive PTYs.
  * F1 Durable Lifecycle (`launch-records.ts:10-64`, `recipe-engine.ts:459-501`): Transitions `pending -> dispatched -> confirmed | failed | outcomeUnknown` under per-launch lock (`:440`). Held create / lost response transitions to `outcomeUnknown` (`:498-501`). Unresolved predecessor limits: per-launch locks do not guarantee whole-storage synchronization, cross-tab run selection, or post-await epoch fencing.

## 3. Workstream C: Transient Layers, Primitives, Input Arbitration & Dirty Guards
- Named Components & Observed Divergence:
  * Target Selector (`TopBar.tsx:116-216`): Hand-rolled absolute menu (`:144`). No Radix portal, no backdrop, no outside-click or Escape listener.
  * WindowList (`WindowList.tsx:11-191`): Hand-rolled absolute menu (`:108`). Document `mousedown` outside click (`:28-41`), but NO Escape listener and no portal. Has editor dirty confirmation (`:55-88,172-188`), but terminal close calls `closeWindow` directly (`:89`) without Close/End/Cancel prompt.
  * NotificationCenter (`NotificationCenter.tsx:24-222`): Fixed container (`:120`), role="dialog" aria-modal="true" (`:117-118`), but NO backdrop, NO outside-click listener, NO Escape listener; only closes via `✕` (`:151-158`).
  * CommandPalette (`CommandPalette.tsx:42-550`): Fixed backdrop (`:439`), but backdrop lacks `onClick` dismissal. Focus has a 50ms setTimeout gap (`:79`), lacks trapped focus, and lacks focus restoration to invoking trigger on close.
  * ServerProfilesDialog (`ServerProfilesDialog.tsx:113-399`): Fixed backdrop click (`:187-193`), but NO Escape listener, NO portal, and NO focus trap/restoration.
  * ServerSettingsDialog (`ServerSettingsDialog.tsx:79-1100`): Fixed backdrop click (`:806-810`), but NO Escape listener, NO portal, NO focus trap/restoration. Silent discard on backdrop click (`:809`), X button (`:826`), or Cancel (`:1095`) without dirty-form check.
- Accessible Primitives: `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-context-menu` installed (`package.json:29-32`). Coordinated Radix portal adoption or shared dismiss layer recommended.
- Input Arbitration & Integration Risks:
  * `input-arbiter.ts:83-140`: Priority: 1. Cognito (`cognito-blocked`: 88); 2. IME (`ime-passthrough`: 93); 3. Modal active (`app-passthrough`: 98); 4. Palette chord (`os-palette-handled`: 115); 5. Focus cycle (`os-shortcut-handled`: 125); 6. Frame chrome (`frame-focused-handled`: 134); 7. App passthrough (`:139`).
  * Integration Risk: `isModalActive -> app-passthrough` relies entirely on focus trap containment. In `OsShell.tsx:191-197`, `isCognitoActive: false` is hardcoded at shell level (though `useCognitoModeInputGuard` runs at root), and modal states are not wired into `isModalActive`.

## 4. Workstream C: Canvas Geometry, Float Placement, Drag & Double-Click
- Usable Canvas: `DesktopCanvas.tsx:18-38,101-124`: `ResizeObserver` measures container into `viewport: { width, height }`. `use-os-viewport.ts:8-16` provides viewport.
- Float Bounds & Cascade:
  * Constants: `DEFAULT_FLOAT_BOUNDS = { x: 60, y: 60, width: 720, height: 520 }`, `MIN_FLOAT_WIDTH = 280`, `MIN_FLOAT_HEIGHT = 200` (`window-ops.ts:23-31`).
  * `openWindow` (`window-ops.ts:200`) assigns `windowConfig.floatBounds ?? { ...DEFAULT_FLOAT_BOUNDS }`. All new floats stack at `(60, 60)`. Defect: missing ~28px cascade on destination desktop and viewport wrap/clamp.
  * `setWindowMode` (`window-ops.ts:394`) preserves prior `floatBounds` if present, falling back to defaults only for first-time floats.
  * Persistence: `persistence.ts:1-135` stores `OsSessionV1` (`dam-hopper:os:v1:session`) including `floatBounds`, `mode`, `maximized`, `minimized`.
- Maximize, Drag & Titlebar Gestures:
  * Maximize: `toggleMaximizeWindow` (`window-ops.ts:428-443`) flips `maximized`. `WindowFrame.tsx:264-271` renders fixed full viewport (`inset: 0, zIndex: 50`).
  * Drag (`WindowFrame.tsx:82-127`): `handleStartDrag` on `data-os-frame-header` (`:325`). Defects: lacks primary-button check (`e.button === 0`), lacks `isCognitoActive` guard, and moves on initial mousedown without movement threshold.
  * Double-Click: Missing in `WindowFrame.tsx:323-331`. Header lacks `onDoubleClick`. Required: primary-button double-click on titlebar background toggles tile/float. If maximized, unmaximize and switch mode in one atomic action. Exclude buttons, selects, inputs, and actual drag gestures (via movement threshold).

## 5. Existing Tests & Validation Gaps
- Vitest Unit: `pnpm --filter @dam-hopper/ui test`
  * `packages/ui/src/os/window-ops.test.ts`, `input-arbiter.test.ts`, `recipes/recipe-engine.test.ts`, `recipes/schema.test.ts`, `recipes/launch-records.test.ts`.
- Browser Tests: `pnpm --filter @dam-hopper/ui test:browser`
  * `os-recipes.browser.tsx`: Covers happy-path catalog and editor rendering; does not cover multi-context desktop selection.
  * `os-input-isolation.browser.tsx`: Directly feeds synthetic events to `arbitrateKeyboardEvent` rather than exercising physical DOM listener suppression.
  * `os-shell.browser.tsx`: Validates shell landmarks and basic desktop switching; lacks transient dismissal checks.
- E2E Playwright: `pnpm --filter @dam-hopper/ui test:e2e`
  * `os-recipes.spec.ts`: Opens import tab only; does NOT import JSON or test subset saving.
  * `os-lifecycle.spec.ts`: Targets native `select` locator while `WindowFrame.tsx` uses Radix Select; DOM identity marker checks DOM element retention, not zero attach/replay counters.

## 6. Recommended Bounded Interfaces
- `RecipeSourceContext`: `{ sourceDesktopId: string; eligibleContexts: Array<{ profileId: string; profileName: string; projectId: string; windowCount: number }>; selectedContext: { profileId: string; projectId: string } }`.
- `TransientLayerRegistry`: Coordinated stack ensuring Escape dismisses topmost layer only and restores invoking focus without leaking shortcuts to xterm.
- `FloatPlacementCascade`: `calculateNextFloatBounds(destinationWindows: OsWindow[], viewport: { width: number; height: number }): FloatBounds` (cascade ~28px from latest unpositioned float; fit/wrap within usable canvas; preserve explicit/restored bounds).
- `TitlebarGestureGuard`: `handleHeaderDoubleClick(e: MouseEvent)` with `e.button === 0`, movement distance below threshold (e.g. <3px), target not inside interactive controls/ARIA roles (`button`, `select`, `input`), atomically exiting maximize and toggling mode.

## 7. Known Unknowns & Acceptance Probes
- Probe B1: Does recipe capture handle offline profile windows gracefully without network requests? (Pass: windows marked unavailable, local JSON captures intact).
- Probe B2: Are utility windows (`recipes`, `system-monitor`, `settings`, `agent-hub`) excluded from saved subset but displayed with reasons in the named/contextual exclusion preview?
- Probe C1: Does Escape on open Target selector close menu and return focus to trigger without emitting Escape byte to active PTY?
- Probe C2: Does clicking backdrop of `ServerSettingsDialog` with dirty fields open ConfirmDialog rather than silently discarding edits?
- Probe C3: Does primary double-click on maximized float restore window to tiled layout within canvas without creating new terminal PTY or replaying buffer?

COMPLETE: plans/261104-1529-os-session-management-and-interactions/reports/recipe-interaction-evidence.md
