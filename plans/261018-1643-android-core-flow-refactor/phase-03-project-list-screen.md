# Phase 03: Project List Screen
Phase: 03
Dependencies: Phase 01

## Scope
Implement `ProjectListScreen.kt` in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt`:
1. Header:
   - Profile Name & Server URL badge.
   - "Profiles / Switch" button to navigate back to profile management.
   - Refresh icon/button.
2. State handling:
   - Loading: displays progress indicator while `workspaceRepo.listProjects()` is running.
   - Error: displays error card with "Retry" button on failure.
   - Empty: shows "No projects configured in workspace" if list is empty.
   - Content: list of `ProjectSummary` cards.
3. Project card:
   - Project name (prominent, bold).
   - Project path (monospace, secondary text).
   - Project type badge (e.g. "rust", "node", "android") if present.
   - Tags / commands badges.
4. Interaction:
   - Tapping a project card triggers `onSelectProject(project.name)`.

## Acceptance Criteria
- Seamlessly queries `WorkspaceRepository.listProjects()`.
- Responsive error, empty, loading, and populated states.
- Clean Compose card UI adhering to DamHopper theme colors.

## Implementation Status
Status: Complete
- [x] Header with profile name, server URL badge, "Profiles / Switch" button, and refresh button.
- [x] Loading, error with retry, empty, and populated list state handling.
- [x] Project card with prominent name, monospace path, type badge, and tags/commands badges.
- [x] Tap interaction triggering `onSelectProject`.
- [x] Zero WebView, zero FloatingActionButton, strictly styled with `DamHopperColors`.
- [x] Coroutine cancellation safety and repository/profile state fencing.
