# Phase 07 Floating Monaco Surface — Verification Test Report (Cycle 3)

**Date:** 2026-10-21  
**Cycle:** Phase 07 Cycle 3 Validation (Unified Panel Stacking & Qualification Refinements)  
**Scope:** Phase 07 Floating Monaco surface verification — UI TypeScript check, 11 target UI unit suites (160 tests), 3 Chromium browser suites (9 tests), server backend conflict regressions (40 matching tests across 63 test binaries, 39 tests across 5 targeted suites).  
**Branch:** `feat/git-conflict-resolver`  
**Overall Status:** PASS across targeted test suites (248 total test executions: 160 UI unit, 9 UI browser, 40 Cargo conflict-filter, 39 Cargo targeted suites; 0 failed, 0 skipped, 0 TypeScript compilation errors).

---

## 1. Test Execution Summary

| Command | Type | Target Scope | Passed | Failed | Skipped | Exit Code | Runner Time | Wall Time |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 1. UI Typecheck | `tsc` | `@dam-hopper/ui` (`tsc --noEmit`) | Clean | 0 | 0 | 0 | — | 7.90s |
| 2. UI Unit Suites | Vitest | 11 target unit test files | 160 | 0 | 0 | 0 | 4.68s | 5.22s |
| 3. UI Browser Tests | Vitest (Chromium) | 3 browser test files | 9 | 0 | 0 | 0 | 7.39s | 8.08s |
| 4. Server Conflict Tests | Cargo | `server/Cargo.toml` (`conflict` filter across 63 suites) | 40 | 0 | 0 | 0 | 0.00s | 34.71s |
| 5. Targeted Backend Suites | Cargo | 5 git conflict integration suites (`exact_staging`, `lifecycle`, `discovery`, etc.) | 39 | 0 | 0 | 0 | 0.08s | 1.08s |

**Total Test Executions Across Suites:** 248 test executions (160 + 9 + 40 + 39).  
- UI Unit Tests: 160 passed across 11 files (0 failed, 0 skipped).
- UI Browser Tests (Chromium): 9 passed across 3 files (0 failed, 0 skipped).
- Server Conflict Filter Tests: 40 passed across 63 test binaries (1,961 non-conflict tests filtered out).
- Targeted Backend Suites: 39 passed across 5 integration suites (partially overlapping with the 40 filtered conflict tests).
- TypeScript Typecheck: 0 errors, 0 warnings.
- Test Warnings: 1 non-fatal console warning in `WorkspacePage.test.tsx` (`Received 'false' for a non-boolean attribute 'loading'`).

---

## 2. Command Details & Execution Metrics

### Command 1: TypeScript Check
```bash
pnpm --filter @dam-hopper/ui exec tsc --noEmit
```
- **Exit Code:** `0` | **Wall Time:** 7.90s
- **Output:** Clean (0 errors, 0 warnings).

### Command 2: UI Unit Test Suite (11 Files / 160 Tests)
```bash
pnpm --filter @dam-hopper/ui test \
  src/lib/terminal-workspace-panel.test.ts \
  src/lib/conflict-resolver-panel-state.test.ts \
  src/components/organisms/MergeConflictEditor.test.tsx \
  src/components/organisms/ConflictResolverPanel.test.tsx \
  src/lib/conflict-draft-store.test.ts \
  src/lib/conflict-draft-capacity.test.ts \
  src/lib/conflict-merge-model.test.ts \
  src/lib/joint-history-authority.test.ts \
  src/hooks/use-conflict-resolver.test.tsx \
  src/api/ws-transport.test.ts \
  src/components/pages/WorkspacePage.test.tsx
```
- **Exit Code:** `0` | **Runner Duration:** 4.68s | **Wall Time:** 5.22s
- **File Breakdown (160 passed, 0 failed across 11 files):**
  - `src/lib/terminal-workspace-panel.test.ts` (5 tests): z-index front/back arbitration (1ms), topmost detection (0ms), ordered stack maintenance (1ms), hierarchical z-index calculation (0ms), workspace panel toggle (0ms).
  - `src/lib/conflict-draft-capacity.test.ts` (3 tests): prospective edit draft budget guard (5ms), clean draft eviction preserving dirty drafts (1ms), refusal of new drafts when max dirty drafts reached (0ms).
  - `src/lib/conflict-resolver-panel-state.test.ts` (6 tests): viewport layout clamping (2ms), min width/height constraints (0ms), oversized panel clamping (0ms), maximize expansion with margin (0ms), small/phone viewport capping (0ms), keydown topmost arbitration (1ms).
  - `src/components/organisms/ConflictResolverPanel.test.tsx` (2 tests): toolbar title/badge/options rendering (10ms), restore icon on maximize (1ms).
  - `src/lib/conflict-draft-store.test.ts` (21 tests): deterministic draft keys (2ms), stable snapshot publishing (3ms), reload dirty modification retention (1ms), undo/redo transactions (2ms), typing coalescing (3ms), discard confirmation policy (1ms), applied draft history exclusion (3ms), repeat apply blocking & recovery migration (1ms), in-flight edit preservation (0ms), non-applied outcome recovery (2ms), stale attempt ID rejection (1ms), generation retire recovery tagging (0ms), same-owner snapshot change recovery (1ms), missing conflict retention (1ms), recovery replay rejection (1ms), cross-profile recovery rejection (1ms), atomic decision & text undo/redo (2ms), ignore side metadata undo (2ms), identical text side accept undo (1ms), action blocking on recovery/applied drafts (1ms).
  - `src/lib/conflict-merge-model.test.ts` (31 tests): CRLF/LF/mixed tokenization round-trips (2ms), empty file diff3 combinations (2ms), identical change clean merge (0ms), repeated line stability (0ms), worktree partial import preservation (1ms), diff3 scaling line counts performance (55ms), BOM detection/stripping/reapplication (0ms), 2-way marker exact mapping (1ms), diff3 marker mapping (0ms), ambiguous repeated line match flag (0ms), add/add absent base stage (0ms), side acceptance & replacement (0ms), ignore side without text mutation (0ms), both orders acceptance (1ms), destructive block action rejection on ambiguous mapping (1ms), preview & confirm accept-all-ours/theirs (0ms), drift revision confirm rejection (0ms), read-only base comparison (0ms), conflict region navigation (0ms), empty string reviewed text (0ms), colliding line range prevention (0ms), trailing newline preservation (0ms), BOM line 1 conflict parsing (0ms), BOM offset stability across rebuild/accept/manual edits (0ms), advisory marker readiness (0ms).
  - `src/components/organisms/MergeConflictEditor.test.tsx` (3 tests): memory-only recovery fresh review requirement (17ms), Android Chrome read-only input suppression (4ms), per-conflict accept action disablement when read-only (1ms).
  - `src/api/ws-transport.test.ts` (54 tests): terminal attach offset/metadata (23ms), lifecycle snapshot session isolation (0ms), terminal rename REST PATCH (5ms), usage setup/session routes (2ms), bulk Git worktree target serialization (2ms), explorer language scan routes (2ms), commit message root scope (1ms), leased push branch parameter encoding (11ms), owner-bound squash REST boundary (4ms), git log options (1ms), typed API error mapping (1ms), profile credential binding (2ms), diagnostics export & WebSocket event aggregations (3ms), workflow operations & target sanitization (3ms), idle suspend system routes (2ms), settings TOML export/import (1ms), terminal output authoritative offsets (2ms), host-resource streaming & drop handling (7ms), host:uiConnection receipt lifecycle (1ms), git conflict resolve REST discriminator projection (1ms).
  - `src/hooks/use-conflict-resolver.test.tsx` (3 tests): cross-profile draft retention & invalidation retirement (19ms), stale cursor inventory pagination single restart (5ms), snapshot rejection on owner change during operation status read (5ms).
  - `src/components/pages/WorkspacePage.test.tsx` (28 tests): mobile shell IDE/terminal surfaces (38ms), terminal auto-switch preference (3ms), desktop IDE/terminal shells (8ms), project target references & remounting (13ms), floating file panel state & stacking controls (9ms), diff opening & fallbacks (3ms), active file reveal across modes (0ms), workflow context shell integrations (24ms), surviving right-rail tool filtering (12ms).
  - `src/lib/joint-history-authority.test.ts` (4 tests): atomic text & decision undo/redo (2ms), redo stack clearing on new edit (0ms), maxDepth bounds enforcement (0ms), history snapshot capture & restoration across remounts (0ms).

### Command 3: UI Chromium Browser Test Suite (3 Files / 9 Tests)
```bash
pnpm --filter @dam-hopper/ui test:browser \
  browser-tests/git-conflict-resolver.browser.tsx \
  browser-tests/conflict-monaco-history.browser.tsx \
  browser-tests/conflict-resolver-history.browser.tsx \
  --reporter=verbose
```
- **Exit Code:** `0` | **Runner Duration:** 7.39s | **Wall Time:** 8.08s
- **Browser Breakdown (9 passed, 0 failed across 3 files in real Chromium):**
  - `browser-tests/git-conflict-resolver.browser.tsx` (6 tests in 1027ms):
    - renders floating ConflictResolverPanel with title, rebase badge, and editors (225ms)
    - applies per-conflict accept action targeting conflict region even with stable prefix (180ms)
    - toggles maximize layout and restores prior geometry (240ms) — asserts exact `panel.offsetWidth === initialWidth`
    - hides resolver when Escape is pressed while topmost and focused (107ms)
    - activates narrow tabbed mode in narrow viewport and switches tabs (178ms)
    - does not hide resolver on Escape when not topmost or when focus is outside (97ms)
  - `browser-tests/conflict-monaco-history.browser.tsx` (2 tests in 191ms):
    - proves single joint undo/redo authority across native typing and metadata decisions (183ms)
    - proves atomic text and metadata transaction undo/redo with snapshot restoration in real Chromium (8ms)
  - `browser-tests/conflict-resolver-history.browser.tsx` (1 test in 153ms):
    - routes Ctrl+Z and Ctrl+Shift+Z through the retained draft history (153ms)

### Command 4: Server Backend Conflict Regressions
```bash
cargo test --manifest-path server/Cargo.toml conflict
```
- **Exit Code:** `0` | **Wall Time:** 34.71s | **Results:** 40 passed; 0 failed; 0 ignored; 1,961 filtered out across 63 test suites.
- **Key Suites Breakdown:**
  - `server/src/lib.rs` (15 tests passed): lossless line tokens invariants, conflict marker boundary detection, bounded rejections, lossless ID encoding/decoding, snapshot version sensitivity, commit cherry-pick/rebase/revert conflict handling.
  - `tests/git_conflict_discovery_api.rs` (11 tests passed): non-utf8 path, legacy resolve fail-close, cursor rejection, staged rejection, delete/modify, resolve endpoint stale checks, symlinks, binary files, pagination bounds.
  - `tests/git_conflict_exact_staging.rs` (7 tests passed): delete action, binary staging, stale precondition rejection, reviewed text empty/executable, index side binary, preserve unrelated files.
  - `tests/git_conflict_operation_api.rs` (1 test passed): get operation status during merge conflict.
  - Ancillary filtered conflict suites (6 tests passed across auth, fs, idle, release suites).

### Command 5: Targeted Backend Conflict Suites Verification
```bash
cargo test --manifest-path server/Cargo.toml \
  --test git_conflict_discovery_api \
  --test git_conflict_exact_staging \
  --test git_conflict_operation_api \
  --test git_conflict_operation_lifecycle \
  --test git_conflict_operation_metadata
```
- **Exit Code:** `0` | **Duration:** 0.08s | **Wall Time:** 1.08s | **Results:** 39 passed / 0 failed:
  - `git_conflict_discovery_api`: 11 passed
  - `git_conflict_exact_staging`: 10 passed
  - `git_conflict_operation_api`: 5 passed
  - `git_conflict_operation_lifecycle`: 11 passed
  - `git_conflict_operation_metadata`: 2 passed

---

## 3. Verified Cycle 3 Changes & Observable Scope

### 1. Unified Floating Panel Stack Across WorkspacePage and TerminalWorkspaceShell
- **Implementation:** Lifted `floatingPanelStack` state to `WorkspacePage`, passing stack and `onActivateFloatingPanel` into `TerminalWorkspaceShell`. `TerminalWorkspaceShell` calculates `effectiveFront` and resolves hierarchical z-indices via `resolveFloatingPanelStackZIndex`. `ConflictResolverPanel` receives dynamic `zIndex` and `isTopmost` derived from the stack. `WorkspacePage` memoizes `handleHideResolver` with `useCallback`.
- **Observable Scope:** Terminal workspace panel unit tests (5/5 passed) and WorkspacePage unit tests (28/28 passed) verify stacking logic. Full end-to-end multi-panel stacking integration (e.g. resolver open -> tool open -> tool closed -> resolver is topmost again) remains an integration test item for Phase 08.

### 2. Tool Panel Escape Scoping & Section tabIndex
- **Implementation:** Added `event.defaultPrevented` check and focus containment verification (`panelRef.current.contains(activeEl)`) before dispatching `handleTerminalFloatingToolPanelKeyDown`. Added `tabIndex={-1}` to `<section>` elements in both `TerminalFloatingToolPanel` and `ConflictResolverPanel` to ensure valid programmatic focus target.
- **Observable Scope:** Unit tests and browser tests verifying Escape isolation pass (107ms focused/topmost, 97ms unfocused/non-topmost).

### 3. Narrow Pane Switch Decoration Hook Binding
- **Implementation:** Bound `applyDecorations()` to `[applyDecorations, activeNarrowPane]` in `MergeConflictEditor.tsx`. Decorations are re-evaluated whenever the active narrow pane switches or editors mount.
- **Observable Scope:** Narrow tabbed mode browser test switches between panes without crashing or throwing DOM errors (178ms). Direct DOM inspection of Monaco decoration glyphs across pane switches remains a browser assertion refinement.

### 4. Navigation Direct Line Targeting
- **Implementation:** Switched `navigateToConflict` to directly read `navRegions[index].startLine` from the pre-computed `navRegions` memo instead of reparsing conflict markers on every navigation step.
- **Observable Scope:** Navigation runs execute without error. Note: In narrow mode, if an editor other than Result is active, `navigateToConflict` reveals lines on the Result editor without automatically switching tabs (see Section 5).

### 5. Exact Width Restoration Assertion
- **Implementation:** Updated `browser-tests/git-conflict-resolver.browser.tsx` to assert exact equality `expect(panel.offsetWidth).toBe(initialWidth)`.
- **Observable Scope:** Browser test asserts exact width restoration on unmaximize (240ms). Height and position coordinate assertions are not yet explicitly captured in the browser test assertion.

---

## 4. Performance Metrics

- **TypeScript Typecheck:** 7.90s total wall time.
- **UI Unit Test Execution (11 files / 160 tests):** 4.68s runner duration / 5.22s wall time.
  - Slowest unit test: Diff3 scaling performance test in `conflict-merge-model.test.ts` (55ms).
  - All other 159 tests executed in <= 38ms each.
- **UI Browser Tests (3 files / 9 tests in real Chromium):** 7.39s runner duration / 8.08s wall time.
  - Max browser test duration: `toggles maximize layout and restores prior geometry` (240ms).
- **Cargo Conflict Regressions (63 test suites / 40 tests):** 34.71s wall time.
- **Targeted Cargo Conflict Suites (5 suites / 39 tests):** 1.08s wall time (0.08s execution).

---

## 5. Critical Issues, Remaining Risks & Qualification Gaps

1. **Panel-Stack Lifecycle on Panel Close / Mode Switch:**
   - `WorkspacePage` removes `"resolver"` from `floatingPanelStack` when hidden, but `TerminalWorkspaceShell` currently receives only `onActivateFloatingPanel`—not a removal/deactivation callback for `"files"` or `"tool"`. If `"tool"` or `"files"` is closed or the user switches out of terminal mode, an inactive panel could remain at the top of `floatingPanelStack`, suppressing resolver Escape handling.
   - **Recommendation:** Add `onDeactivateFloatingPanel` callback to `TerminalWorkspaceShell` or prune closed panels in `WorkspacePage` during Phase 08 integration.
2. **Narrow-Mode Navigation Auto-Tab Switching:**
   - `navigateToConflict()` reveals and focuses the Result editor (`resultEditorRef.current?.revealLineInCenter(...)`). In narrow viewport mode, if the user is currently viewing the "Theirs", "Ours", or "Base" tab, the Result editor is hidden from DOM/view.
   - **Recommendation:** Update `navigateToConflict` to automatically call `setActiveNarrowPane("result")` when navigating in narrow mode so the navigated line is immediately visible.
3. **Browser Assertion Qualification Depth:**
   - The stable-prefix acceptance browser test verifies that clicking accept does not trigger the "stable region" error alert; it does not assert exact resulting editor text tokens or decision state changes (covered at unit level in `conflict-merge-model.test.ts` and `joint-history-authority.test.ts`).
   - The maximize browser test asserts exact restored width (`panel.offsetWidth === initialWidth`), but does not assert restored height or top/left coordinates.
   - Tab-switch browser test validates tab click transitions without crashing; direct inspection of Monaco delta decoration IDs is not asserted via browser test DOM.
4. **Synchronous Guarding (No Debounce):**
   - Mutation and readiness guards in `MergeConflictEditor` MUST remain strictly synchronous to prevent race windows where `Apply` could be submitted with stale eligibility. Do NOT introduce debounced readiness calculations.
5. **Multi-Shell Canvas Focus Release:**
   - Terminal canvas keyboard focus release/reclaim upon resolver panel focus is scheduled for Phase 08 integration.
6. **Android Chrome Physical Touchscreen Qualification:**
   - Result editor honors `readOnly: true` under `isAndroidChromeNativeInputSuppressed`. Automated unit and Chromium browser tests verify read-only behavior; physical touchscreen qualification is deferred to release validation.
7. **Vitest V8 Coverage Tooling:**
   - `packages/ui` currently lacks `@vitest/coverage-v8` in devDependencies; automated line/branch coverage reporting is not enabled.
8. **Working Tree Scope:**
   - The repository working tree contains pre-existing modified/untracked files from prior backend/agent phases (176 tracked modifications). Phase 07 validation is strictly scoped to UI floating Monaco surface and backend conflict regression suites without modifying unrelated changes.

---

## 6. Recommendations & Next Steps

1. **Phase 08 Integration — Panel Stack Lifecycle:** Thread an `onDeactivateFloatingPanel` callback to `TerminalWorkspaceShell` so closing tool or files panels immediately removes them from `floatingPanelStack`.
2. **Phase 08 Integration — Narrow Tab Auto-Switch:** In `navigateToConflict`, add `if (isNarrow && activeNarrowPane !== "result") setActiveNarrowPane("result");` so conflict navigation automatically brings the editable result pane into view.
3. **Phase 08 Integration — Wire Git Panel Clicks:** Connect `WorkspaceGitPanel` conflicted row clicks directly to `useConflictResolver.openFile(path)` and bring resolver to top of stack.
4. **CI Tooling:** Add `@vitest/coverage-v8` to `packages/ui` devDependencies for automated branch/line coverage reporting.

---

## 7. Unresolved Questions

1. Should `navigateToConflict` automatically set `activeNarrowPane = "result"` whenever a user clicks next/previous conflict in narrow mode?
2. Should `TerminalWorkspaceShell` expose `onDeactivateFloatingPanel` or should `floatingPanelStack` be pruned via a `useEffect` keyed on `activePanelId` and `terminalFilePanelOpen`?
3. Should Phase 08 add `@vitest/coverage-v8` to `packages/ui/devDependencies` for CI coverage gating?
