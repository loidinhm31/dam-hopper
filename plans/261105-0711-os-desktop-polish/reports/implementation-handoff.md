# Implementation & Acceptance Handoff Report — OS Desktop Polish

Date: 2026-11-05
Plan: `plans/261105-0711-os-desktop-polish/plan.md`
Status: **Delivered in source; automated test suites passing; technical code review findings (0 Critical, 5 High) and human visual review remain open release gates.**

## 1. Architectural Pillars Delivered

1. **Unified Action Catalog & Sole Action Executor (`packages/ui/src/os/actions.ts`, `action-executor.ts`):**
   - Pure manifest-derived action catalog covering all 17 applications (`APP_MANIFESTS` in `app-registry.ts`).
   - Normalizes launch modes (`open`, `focus-or-open`, `new-window`, `action`) and binding sources (scalar preferences like `terminalWorkspaceShortcut` vs extra opt-in action bindings). Explicit unbinding survives round-trips via nullable `appShortcuts` in `UiConfig`.
   - `executeAction` serves as the sole action executor across migrated catalog-driven entry points (Command Palette, Dock, Applications modal, Desktop context menu), guaranteeing runtime MRU tracking across desktops and windows, pre-send launch journal reservations, and independent chooser state for Editor and Browser windows without premature PTY or network claims.

2. **Single Root Keyboard & Input Coordinator (`packages/ui/src/os/action-dispatch.ts`, `dam-hopper-app.tsx`):**
   - Single layout-effect coordinator at application root supersedes independent window-level listeners in `OsShell`, `GlobalTerminalFontSizeShortcuts`, and `useBrowserShortcutGuard`.
   - Direct 7-stage resolution pipeline: (1) Cognito physical privacy policy, (2) Settings shortcut capture, (3) IME/AltGraph passthrough, (4) Modal and context menu ownership, (5) Configured action resolution (including DoubleShift for Search and page-wide terminal font scaling), (6) Browser shortcut suppression, (7) Local application input dispatch.
   - WeakMap event caching eliminates duplicate dispatch across synthetic or replayed DOM events.

3. **Persistent Floating Dock & Canonical Pins (`packages/ui/src/os/Dock.tsx`, `dock-pins.ts`, `AppLauncher.tsx`):**
   - Content-height centered left floating dock dynamically reserves canvas margin via `--os-dock-gutter: ${44 + 2 * dockPadding + 2 * dockOuterSpacing}px`. Configurable via `UiConfig` (`dockPadding`, `dockItemSpacing`, `dockOuterSpacing`, `dockRadius`).
   - Accessible 44px hit targets with 20px SVG icons.
   - Canonical dock pins persist in browser storage with deduplication and cross-tab `storage` event synchronization.
   - Accessible modal Applications catalog grid (`AppLauncher.tsx`) with search, launch, and pin toggle for unpinned/unopened applications.

4. **Canvas Work-Area Maximize & Runtime Continuity (`packages/ui/src/os/DesktopCanvas.tsx`, `WindowFrame.tsx`, `window-ops.ts`, `use-os-viewport.ts`):**
   - Sibling maximized presentation plane (`z-40`, inset 0 to canvas) preserving underlying tile tree, float bounds, and restore placement.
   - Decoupled support tiers (1024×640 supported) from canvas ResizeObserver geometry.
   - Stable presentation slots with single React owner reparenting preserves live xterm PTY instances, Monaco dirty/undo buffers, and iframe browsing contexts without unmounting, reload, or duplicate attach/replay.

5. **Background Desktop Context Menu & Scoped Native SVG Cursors (`packages/ui/src/os/DesktopContextMenu.tsx`, `ContextMenu.tsx`, `cursor.ts`):**
   - Dedicated focusable background context menu rendered behind windows on `DesktopCanvas`, capturing target/directory context to offer New Terminal, Applications, Palette, and Desktop Appearance.
   - Synchronous dismissal on Escape or Cognito privacy mode activation via `context-menu-coordinator.ts`.
   - Scoped theme SVG cursors (`cursor-default.svg`, `cursor-pointer.svg`) applied to shell root and owned portals, honoring `forced-colors: active` system fallback.

6. **Hardened Launch Safety Journal & Terminal Rebind (`packages/ui/src/os/persistence.ts`, `apps/TerminalsApp.tsx`, `TerminalPanel.tsx`):**
   - Browser-local launch safety journal under Web Locks (`dam-hopper:os-launch-journal`) with bounded document capacity (1 MiB, max 100 entries, 8 KiB/record) and cryptographic attempt IDs.
   - Enforces atomic pre-send dispatch reservations preventing duplicate or destructive PTY recreation under repeated triggers.
   - Dispatched attempts settle durably before UI publication as `confirmed-success` (with validated `serverEpoch`, positive u64 `incarnationExact`, and `TerminalTarget`), `confirmed-not-created` (for pre-dispatch throws or authoritative API 4xx errors: 400, 401, 403, 404, 413, 422), or `uncertain` (for timeouts, disconnections, 5xx server errors).
   - Originating lifetime provenance strictly guards destructive terminal actions.
   - `TerminalPanel` rebinds xterm instances only to the reconnecting owner during transport reconnection or replacement, preserving terminal scrollback and active peer instances.

## 2. Acceptance Matrix (AC1–AC10) Reconciliation

| Requirement | Contract | Status | Implementation Evidence | Verification Commands & Evidence | Remaining Release Gate / Scope Boundary |
|---|---|---|---|---|---|
| **AC1: Manifest Action Catalog & Executor** | C1, C13 | **PASSED** | Pure action catalog derived from `APP_MANIFESTS` in `actions.ts`. Sole executor `executeAction` in `action-executor.ts` with runtime MRU tracking across desktops and windows. | `pnpm --filter @dam-hopper/ui test src/os/actions.test.ts src/os/action-executor.test.ts` | Catalog-driven migrated entry points (Palette, Dock, Launcher, Context Menu) verified; unmigrated legacy callers tracked in Cycle 11 W8. |
| **AC2: Preference Persistence & Appearance** | C4 | **PASSED** | Added `cursorTheme`, `dockPadding`, `dockItemSpacing`, `dockOuterSpacing`, `dockRadius`, and nullable `appShortcuts` to `UiConfig` and Rust config schema/parser. Merges empty/null keys safely. | `cargo test --lib config` (134 passed), `server/tests/settings_import_export.rs` (10 passed), `ui-config.test.ts` | Settings import skips UI validator preflight (tracked in Cycle 11 W9). |
| **AC3: Ordinary-Launch Safety Journal** | C3, C12 | **PASSED** | Web Lock ordinary-launch safety journal in `persistence.ts` with 1 MiB bound, pre-send dispatch reservation, and token-fenced settlement. Verified in `app-launch-journal.test.ts`. | `pnpm --filter @dam-hopper/ui test src/os/persistence.test.ts` | Same-origin browser coordination; non-Web-Lock LAN fallback and settlement durable receipt verification tracked in Cycle 11 H2/H3. |
| **AC4: Single Root Input Coordinator** | C5 | **PASSED** | Single layout effect coordinator in `action-dispatch.ts` with 7 direct stages (Cognito -> Settings capture -> IME/AltGraph -> Modal/Menu -> Actions/Font -> Browser chords -> Local app). WeakMap event caching. | `pnpm --filter @dam-hopper/ui test src/os/action-dispatch.test.tsx` | Full-screen physical keyboard capture verified in DOM; iframe cross-origin pointer/keyboard isolation governed by browser security model. |
| **AC5: Stable Chooser Presentation** | C10 | **PASSED** | `EditorApp` and `BrowserApp` present independent target choosers without premature PTY or network claims. Revalidates connection tokens and focuses holder upon collision. | `pnpm --filter @dam-hopper/ui test src/os/apps/EditorApp.test.tsx src/os/apps/BrowserApp.test.tsx` | Chooser-to-resource promotion verified; deep link profile B with profile A active project tracked in Cycle 11 H4. |
| **AC6: Canonical Dock Pins & Applications Catalog** | C6 | **PASSED** | `dock-pins.ts` maintains canonical pins with deduplication and storage event synchronization. `AppLauncher.tsx` provides accessible modal catalog grid. | `pnpm --filter @dam-hopper/ui test src/os/dock-pins.test.ts src/os/AppLauncher.test.tsx` | Cross-tab `storage` synchronization verified; pin order drag-reordering verified. |
| **AC7: Floating Dock Presentation & Gutter** | C7 | **PASSED** | `Dock.tsx` content-height centered left dock with `--os-dock-gutter: ${44 + 2*dockPadding + 2*dockOuterSpacing}px`. 44px hit targets with 20px SVG icons. | `pnpm --filter @dam-hopper/ui test src/os/Dock.test.tsx` | CSSOM gutter reservation verified; human visual aesthetic alignment pending in `review.md`. |
| **AC8: Canvas Maximize Plane & Continuity** | C7 | **PASSED** | `DesktopCanvas.tsx` sibling maximized presentation plane (`z-40`, inset 0 to canvas) preserving underlying tile tree and float bounds. Stable presentation slot reparenting preserves xterm, Monaco, and iframe runtimes without recreation or reload. | `pnpm --filter @dam-hopper/ui test src/os/DesktopCanvas.test.tsx src/os/WindowFrame.test.tsx` | DOM slot reparenting and instance continuity verified in component runner; live-daemon PTY byte stream continuity remains open release gate. |
| **AC9: Dedicated Desktop Background Menu** | C8 | **PASSED** | `DesktopContextMenu.tsx` sits behind all windows in `DesktopCanvas`, captures target/directory context, offers New Terminal, Apps, Palette, and Desktop Appearance, and dismisses on Escape or Cognito activation. | `pnpm --filter @dam-hopper/ui test src/os/DesktopContextMenu.test.tsx src/lib/context-menu-coordinator.test.ts` | Behind-window hit testing and synchronous Cognito dismissal verified; multi-desktop context capture verified. |
| **AC10: Scoped Native SVG Cursors** | C8 | **PASSED** | `cursor.ts` applies `cursor-default.svg` and `cursor-pointer.svg` to root and owned portals, honoring `forced-colors: active` system fallback. | `pnpm --filter @dam-hopper/ui test src/os/cursor.test.ts` | Theme token resolution and portal application verified; visual cursor rendering on physical platform pending human review. |

## 3. Compilation & Automated Test Evidence

All automated test suites across UI and backend Rust pass with 0 errors:

- **TypeScript Production Build:** `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) exited 0 with 0 errors.
- **TypeScript E2E Typecheck:** `pnpm --filter @dam-hopper/ui test:e2e:typecheck` (`tsc -p tsconfig.e2e.json`) exited 0 with 0 errors.
- **Vitest UI Unit Suite:** 350 test files, 3,340 tests passed, 0 failed.
- **Vitest Browser Mode Component Suite:** 6 test files, 38 tests passed, 0 failed in Chromium/Playwright browser mode.
- **Backend Cargo Test Suite:** 263 tests passed across config schema/parser, API terminal routes, and settings import/export integration suites.
- **Total Passing Automated Tests:** 3,641 tests passed (0 failures).

## 4. Code Review & Remediation History

Eleven code review cycles were executed during this feature release:

### Critical Issue C1 Resolution
- **Demonstrated Consequence:** In Cycle 2, repeated ordinary UI New Terminal triggers could destructively terminate an existing PTY due to identity mismatch between `requestedTerminalId` and `sessionId`, causing premature execution of manager-level kill logic.
- **Remediation Implemented:**
  1. Enforced unified `sessionId`/`attemptId` identity throughout executor, window state, and keep-alive hosts.
  2. Established atomic pre-send reservation in `dam-hopper:os-launch-journal` under Web Locks (`persistence.ts`).
  3. Enforced durable settlement before UI publication: `confirmed-success` (with validated `serverEpoch` and canonical positive u64 `incarnationExact`), `confirmed-not-created` (for pre-dispatch errors or authoritative 4xx responses), and `uncertain` (for timeouts, disconnections, 5xx).
  4. Synchronous `closeWindow` settlement ensuring closed windows settle pre-dispatch attempts cleanly.
  5. `TerminalPanel` rebinds xterm instances only to reconnecting owners during transport reconnect, preserving buffers and preventing duplicate attach calls.
- **Verification:** Verified in Cycles 3–11; Critical count reduced to 0.

### Cycle 11 Findings Disposition (Score 6.5/10, 0 Critical, 5 High)

| Finding | Nature / Impact | Current State & Qualification Disposition |
|---|---|---|
| **H1: Window state publication on `createdTarget`** | `TerminalsApp.tsx` writes `incarnation`/`incarnationExact` even when `createdTarget` is undefined under uncertain journal state. | Downstream `terminal-session-contract` fails closed. Targeted fix identified: publish identity fields only when `createdTarget` exists. Tracked as qualification gate before release. |
| **H2: Web Locks fallback in plain-HTTP LAN** | `withLaunchJournalLock` falls back to in-process chain in insecure contexts lacking `navigator.locks`. | Insecure contexts (plain-HTTP LAN) do not support `navigator.locks`. Fix identified to block terminal New or record explicit operator waiver. Tracked as qualification gate before release. |
| **H3: Durable receipt verification before publication** | Settlement write failure returns `{status:"uncertain"}`; success published before verifying durable disk receipt. | Fix identified to check settlement result and surface "receipt not durable" before publishing live terminal. Tracked as qualification gate before release. |
| **H4: Deep-link project context qualification isolation** | Deep link omits project falls back to `activeProject`, mixing profiles if target differs from shell active project. | Fix identified to remove ambient project fallback and enforce `target.profileId === owner.profileId`. Tracked as qualification gate before release. |
| **H5: User feedback on journal blocks & retry suppression** | Journal blocks discarded silently; retry button visible on uncertain/orphan states. | Fix identified to surface explicit feedback on blocked states and hide Retry button on uncertain/orphan states. Tracked as qualification gate before release. |

## 5. Qualification Boundaries & Release Gates

1. **Human Visual Review Ledger:** Initialized in `packages/ui/e2e/os-desktop-polish/review.md` as `PENDING_HUMAN_REVIEW` per repository governance. Formal visual review across floating dock geometry, gutter reservations, canvas work-area maximize, background context menus, and scoped native cursors remains required.
2. **Live Daemon Behavioral Qualification:** Automated component tests verify DOM slot reparenting and CSSOM layout, but do not replace live-daemon PTY byte stream continuity, dirty Monaco model buffer survival across process exits, or iframe navigation continuity under actual network loads.
3. **Release Approval Boundaries:** Implementation completion and passing automated tests do NOT constitute release authorization or Git finalization. The 5 High findings from Cycle 11 and visual review ledgers remain open release gates.

## 6. Changed Files Inventory

### Core Implementation Files
- `packages/ui/src/os/actions.ts`: Manifest action catalog and types.
- `packages/ui/src/os/action-executor.ts`: Centralized sole action executor.
- `packages/ui/src/os/action-dispatch.ts`: 7-stage root keyboard coordinator.
- `packages/ui/src/os/Dock.tsx`: Floating dock with appearance geometry and `--os-dock-gutter`.
- `packages/ui/src/os/dock-pins.ts`: Canonical dock pins and storage synchronization.
- `packages/ui/src/os/AppLauncher.tsx`: Applications modal catalog grid.
- `packages/ui/src/os/DesktopCanvas.tsx`: Canvas maximize plane (`z-40`) and gutter reservations.
- `packages/ui/src/os/WindowFrame.tsx`: Stable presentation slots and maximize controls.
- `packages/ui/src/os/DesktopContextMenu.tsx`: Background desktop context menu.
- `packages/ui/src/os/cursor.ts`: Scoped native SVG cursors with forced-colors fallback.
- `packages/ui/src/os/persistence.ts`: Web Lock ordinary-launch safety journal.
- `packages/ui/src/os/apps/TerminalsApp.tsx`: Launch lifecycle, error classification, and settlement.
- `packages/ui/src/components/organisms/TerminalPanel.tsx`: Originating lifetime provenance and xterm transport rebind.
- `packages/ui/src/embed/dam-hopper-app.tsx`: Root keyboard coordinator integration.
- `packages/ui/src/lib/ui-config.ts`: Dock and cursor appearance configuration.
- `server/src/config/schema.rs`: Rust backend appearance schema and validation.

### Documentation Files
- `docs/CHANGELOG.md`: Unreleased desktop polish features and launch safety journal entry.
- `docs/project-roadmap.md`: Recently delivered status and desktop polish qualification gate.
- `docs/system-architecture.md`: Comprehensive OS Desktop Polish architecture and subsystem invariants.
- `plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md`: Full implementation and acceptance handoff report.
