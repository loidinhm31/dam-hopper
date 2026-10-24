# Code Review: Phase 06 — TERMINAL Traditional Shell, Projects & Remote Configuration

- Date: 2026-10-16
- Reviewer: EvcReviewerPhase06 (Senior Software Engineer)
- Scope: Phase 06 TERMINAL Traditional shell invariants, 12-panel navigation row, back-stack precedence, project target store revision fencing, remote config lossless editor, wire contracts, and UI modals.
- Result: **REVIEW COMPLETE; IMPLEMENTATION REMEDIATION & RUNTIME ACCEPTANCE PENDING**
- Score: **7.8 / 10** (Penalized for UI cross-project data corruption risk and missing async fencing)

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - *Navigation & Shell*:
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelRegistry.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelNavigationRow.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelHost.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/WorkbenchNavigation.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/PanelNavigationRow.kt` (dead shim)
  - *Workspace & Target Domain*:
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceModels.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt`
  - *Remote Config & Settings*:
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigModels.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt`
  - *UI Integration*:
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkbenchHeader.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`
    - `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Color.kt`
  - *Transport*:
    - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt`
  - *Unit & Invariant Tests*:
    - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepositoryTest.kt`
    - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStoreTest.kt`
    - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt`
    - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/navigation/WorkbenchNavigationTest.kt`
    - `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/WorkbenchShellPhase06Test.kt`
    - `tests/test-phase-06-shell-workspace.sh`
- **Lines of code analyzed**: ~3,200 LOC across 20 source and test files.
- **Review focus**: Phase 06 implementation of Traditional TERMINAL shell, single-row 12-panel navigation, workspace/worktree target store, remote config lossless editor, wire contracts, and shell invariants.
- **Updated plans**:
  - `plans/261015-1647-android-native-app/plan.md` (status: `in-review`)
  - `plans/261015-1647-android-native-app/phase-06-adaptive-shell-projects-worktrees-and-config.md` (status: `review-completed; remediation-pending`)

### Overall Assessment
The architectural foundation of Phase 06 is well-structured: sole TERMINAL mode, TRADITIONAL presentation, zero floating buttons, single content area, and a docked top navigation row. Wire contracts correctly parse bare JSON arrays (`/api/projects` and `/api/git/:project/worktrees`), URL segment encoding, and nullable workspace fields. Target revision fencing in `ProjectTargetStore` guarantees isolation across profiles. The remote configuration editor preserves full raw document fidelity and detects external server conflicts.

However, substantive UI and concurrency defects exist that compromise data integrity:
1. Target picker cross-project worktree contamination.
2. Unselectable/prunable worktree clickability oversight.
3. Stale asynchronous worktree responses racing with workspace switching.
4. Sibling prefix matching bug in workspace path detection.

---

## Critical Issues (MUST FIX)

1. **Cross-Project Target Contamination in `ProjectTargetPickerModal` (`WorkspaceScreens.kt:55-204`)**
   - *Problem*: `ProjectTargetPickerModal` maintains local state `var activeProj by remember { mutableStateOf(currentProject) }`. Tapping a project chip updates `activeProj`, but the `worktrees` parameter passed into the modal remains the worktree list of `currentProject` (fetched only for `navState.activeProject` in `WorkbenchScreen.kt`). The modal renders the previous project's worktrees under `Targets for '$activeProj'`. Selecting a worktree calls `onSelectTarget(activeProj, wt.path)`, associating project A's worktree path with project B in `ProjectTargetStore`.
   - *Impact*: Corrupts project target state in the store; subsequent remote Git operations for project B receive worktree paths belonging to project A.
   - *Fix*: Bind worktree results to an explicit project and workspace revision. Either trigger worktree reloading when project chip changes (clearing stale results while loading), or restrict target selection to `currentProject` and make tapping a project chip immediately switch the active project.

2. **Unselectable/Prunable Worktree Clickability in `ProjectTargetPickerModal` (`WorkspaceScreens.kt:185-199`)**
   - *Problem*: `val isClickable = wt.isSelectable` is calculated to dim text color, but the enclosing `Box` sets `.clickable { onSelectTarget(activeProj, wt.path); onDismiss() }` without `enabled = isClickable`.
   - *Impact*: Users can tap prunable/unavailable worktrees. Although `ProjectTargetStore` fails closed by marking it unavailable, the UI allows invalid selection.
   - *Fix*: Pass `enabled = isClickable` to `Modifier.clickable`.

3. **Inadequate Workspace Switch Concurrency & Fencing (`WorkbenchScreen.kt:109-120` & `293-311`)**
   - *Problem*:
     1. Switching workspaces calls `repo.switchWorkspace(targetPath)`, but does not clear `currentWorktrees` or cancel any in-flight `/api/git/{project}/worktrees` requests.
     2. A late-arriving worktree response from the previous workspace can land after the switch completes, overwriting the new workspace state.
     3. If the new workspace has a project with the same name as the previous workspace (e.g. "dam-hopper"), `navState.activeProject` does not change, and `LaunchedEffect(navState.activeProject, workspaceRepo)` does not re-trigger.
   - *Impact*: Corrupts in-memory target state with cross-workspace worktree paths.
   - *Fix*:
     - Invalidate and clear `currentWorktrees` immediately upon initiating workspace switch.
     - Capture `workspaceRevision` before asynchronous worktree fetching and reject completions if `store.getWorkspaceRevision(...)` or `activeProject` changed while the call was in flight.
     - Include `workspaceStatus?.configPath` or `store.getWorkspaceRevision(activeProfileId)` as a key in the worktree loading `LaunchedEffect`.

---

## Warnings (SHOULD FIX)

1. **Sibling Prefix Match False-Positive in `WorkspaceSwitcherModal` (`WorkspaceScreens.kt:342`)**
   - *Problem*: `status?.configPath?.startsWith(kw.path) == true` matches sibling path prefixes (e.g., `/work/app` will match `/work/application/dam-hopper.toml`).
   - *Impact*: Incorrectly flags sibling workspace as active in the switcher UI.
   - *Fix*: Use boundary-aware path matching: `status?.path == kw.path || status?.configPath == kw.path || status?.configPath?.startsWith("${kw.path.trimEnd('/')}/") == true`.

2. **Heuristic Button Reveal in `PanelNavigationRow.kt:50` Fails Explicit Requirement**
   - *Problem*: `(index * 90).coerceAtMost(scrollState.maxValue)` hardcodes button width to ~90dp.
   - *Impact*: Under custom system font sizes, high-density displays, or localization, buttons exceed 90dp, causing `animateScrollTo` to stop short and leaving the active button partially hidden off-screen, violating the explicit requirement ("automatically reveals the active button into viewport on selection").
   - *Fix*: Use Compose `BringIntoViewRequester` attached to each panel button or calculate layout-exact child coordinates.

3. **Project Chip Horizontal Row Clipping in `ProjectTargetPickerModal` (`WorkspaceScreens.kt:95-115`)**
   - *Problem*: The `Row` displaying project chips lacks `Modifier.horizontalScroll(rememberScrollState())`.
   - *Impact*: Workspaces with 4+ projects will clip chips off-screen on phones and narrow viewports.
   - *Fix*: Add `.horizontalScroll(rememberScrollState())` to the chip `Row`.

4. **Obsolete Re-export Shim `ui/components/PanelNavigationRow.kt`**
   - *Problem*: Violates clean cutover rule ("remove obsolete code/comments/aliases/re-exports/deprecated paths; no shims"). All consumers and tests have migrated to `ui.navigation.PanelNavigationRow`. The 33-line forwarding file in `ui/components/` contains unused imports and is dead code.
   - *Impact*: Violates DRY and clean cutover policy; risk of accidental re-import.
   - *Fix*: Delete `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/PanelNavigationRow.kt`.

---

## Suggestions (NICE TO HAVE)

1. **UI Preference Input Sanitization in `RemoteConfigScreen.kt:120-147`**
   - Direct `toIntOrNull()` assignment resets preference values to null upon empty/invalid intermediate keystrokes. Local string state buffers user typing before conversion.
2. **Modal Decomposition in `WorkspaceScreens.kt`**
   - At 478 LOC, `WorkspaceScreens.kt` combines three distinct modals. Extracting `ProjectTargetPickerModal`, `WorkspaceSwitcherModal`, and `WorkspaceSwitchWarningDialog` into dedicated files will improve modularity ahead of Phase 12 worktree mutations.

---

## Validation Evidence & Scope Limitations

### Executed Host Checks
1. **Rust Crypto Bridge Unit Tests**:
   - `cargo test --manifest-path native-app/crypto-bridge/Cargo.toml`: 5/5 passed (0.15s).
2. **Shared KMP JVM Unit Tests**:
   - `cd native-app && ./gradlew :shared:jvmTest`: Passed (verified clean re-execution).
3. **Android Debug Unit Tests**:
   - `cd native-app && ./gradlew :androidApp:testDebugUnitTest`: Passed (verified clean re-execution).
4. **Android Debug APK Assembly**:
   - `cd native-app && ./gradlew assembleDebug`: Succeeded (65 actionable tasks).
5. **Static Shell Invariant Assertions**:
   - `./tests/test-phase-06-shell-workspace.sh`: 64 assertions passed.
   - `./tests/test-phase-05-proof-gates.sh`: 66 assertions passed.
   - `./tests/test-phase-04-profiles-auth.sh`: 57 assertions passed.
   - `./tests/test-phase-03-transport.sh`: 48 assertions passed.
   - `./tests/test-phase-02-foundation.sh`: 47 assertions passed.
   - **Total Static Shell Assertions**: 282 passed, 0 failed.

### Open Validation & Hardware Acceptance Limits
- **Static Assertions vs. Runtime Proof**: The 282 shell assertions establish static AST patterns, file presence, and string matches. They do not validate dynamic Compose rendering or event dispatch.
- **Physical Device Execution**: Physical Android soft-keyboard (`windowSoftInputMode="adjustResize"`) push behavior, physical back-button integration, and multi-window split ergonomics are deferred to Phase 18 hardware qualification.
- **Async Concurrency Gaps**: Existing unit test suites test synchronous or isolated flows; they demonstrably did not catch the target picker project cross-contamination or workspace-switch race conditions identified above.

---

## Recommended Actions

1. **Remediate `ProjectTargetPickerModal`**:
   - Ensure worktree selection is bound strictly to `(profileId, workspaceRevision, activeProj)`. Clear old worktree state when switching project chips.
   - Add `enabled = isClickable` to worktree item `.clickable`.
   - Add `.horizontalScroll(rememberScrollState())` to project chips `Row`.
2. **Remediate `WorkbenchScreen.kt`**:
   - Invalidate `currentWorktrees` on workspace switch.
   - Add revision/configPath keys to worktree `LaunchedEffect`.
   - Reject late-arriving worktree responses if workspace revision changed during network transit.
3. **Fix Path Prefix Matching**:
   - In `WorkspaceSwitcherModal`, enforce boundary-aware path comparison (`status?.configPath?.startsWith("${kw.path}/")`).
4. **Fix Navigation Reveal**:
   - Replace `index * 90` heuristic with layout-based visibility (`BringIntoViewRequester`).
5. **Clean Cutover**:
   - Delete obsolete `ui/components/PanelNavigationRow.kt`.

---

## Unresolved Questions

1. Should dirty buffer state in the Editor panel intercept the system back button and prompt for save/discard before dismissing back to the TERMINAL panel?
2. Does the team require stress test coverage for rapid asynchronous workspace switching racing with in-flight worktree discovery requests before Phase 18?
3. What is the target timeline for provisioning a physical Android test device to validate soft-keyboard `adjustResize` behavior with native terminal input?
