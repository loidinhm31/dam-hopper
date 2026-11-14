---
title: "Repair Android Stale Contracts and Runtime Breakages"
description: "Repair stale AppFlowStage.TERMINAL gates, global workspace target mapping, FileWatchCoordinator target sync, and coroutine supervisor safety in native Android client."
status: completed
priority: P1
effort: 6h
branch: feat/ai-os-redesign
tags: [android, bugfix, contracts, filesystem, lifecycle, agents]
created: 2026-11-08
---

# Master Plan: Repair Android Stale Contracts & Runtime Breakages

## Executive Overview
Investigation in `plans/reports/debugger-261108-1827-android-stale-contracts.md` revealed three critical contract and runtime breakages in `@native/android-app`:
1. **Agents Section Failure (P0)**: Legacy gate `flowState.stage == AppFlowStage.TERMINAL` in `DamHopperMobileApp.kt` lines 437 and 484 starves `agentsRegistration`, leaving `TerminalAgentsContext.registration == null` and preventing active terminal tab publication to the retained Agents roster.
2. **Global Workspace File Explorer Failure (P0)**: `FileTreeState.kt` line 117 maps `FilesystemTargetRef.Workspace` to `project = "workspace"` instead of `project = "*"`, causing cross-owner rejections in `WorkspaceFileOwner.kt` / `FileRepository.kt` and HTTP 404 / WebSocket `NOT_FOUND` on the server. In addition, unobserved `activeWorkspaceState.activePanel.value` in `DamHopperMobileApp.kt` line 847 drops the UI back to `AgentHubEmptyRoot`.
3. **Project File Tree & Scope Failure (P1)**: `FileWatchCoordinator` binds immutably to its constructor target, ignoring dynamic `currentProjectRef` updates during browsing, while `ProjectWorkspaceState.create` lacks `SupervisorJob()`, allowing watcher or network failures to cascade and cancel the entire workspace coroutine scope.

## Architecture & System Invariants

### 1. Workspace Target Alignment (`project = "*"`)
- The server contract (`server/src/api/fs.rs` & `server/src/api/ws.rs`) defines a workspace-level target as `targetType=workspace` (or `type: "workspace"` on WebSocket).
- In the Android shared client, `FilesystemTargetRef.Workspace` translates to `ProjectTargetRef(profileId = ..., project = "*")`.
- `WorkspaceFileOwner.matchesTarget(target)` must treat `target.project == "*"` as universal for the matching `profileId`, allowing repository operations (`listDirectory`, `languageFiles`) without cross-owner assertion rejections.

### 2. Reactive UI State Observation
- In Jetpack Compose, reading a raw `StateFlow.value` does not register a snapshot state read unless collected via `collectAsState()`.
- `currentPanel` is already collected on `DamHopperMobileApp.kt:562`. Line 847 must read `currentPanel` rather than `activeWorkspaceState.activePanel.value` so switching panels to `FILES` or `EDITOR` cleanly triggers recomposition to `ProjectWorkspaceScreen`.

### 3. Dynamic Watcher Scoping & Supervisor Isolation
- Directory fetching and WebSocket subscription in `FileWatchCoordinator` must accept an optional `targetOverride: ProjectTargetRef? = null` so operations execute against the active browsing target (`currentProjectRef`), not the initial construction target.
- `ProjectWorkspaceState` must initialize `coroutineScope` with `SupervisorJob() + Dispatchers.Main.immediate` to ensure child coroutine exceptions do not cancel sibling editor, terminal, or git operations.

---

## Phases & File Ownership

| Phase | Title | Scope & File Ownership | Effort | Status |
|---|---|---|---|---|
| [Phase 01](./phase-01-shared-contracts.md) | Shared Contracts & Scope Isolation | `FileTreeState.kt`, `WorkspaceFileOwner.kt`, `FileRepository.kt`, `ProjectWorkspaceState.kt` | 1.5h | completed |
| [Phase 02](./phase-02-file-watch-coordinator.md) | FileWatchCoordinator Target Synchronization | `FileWatchCoordinator.kt`, `FileTreeState.kt` | 1.5h | completed |
| [Phase 03](./phase-03-lifecycle-and-routing.md) | Flow Lifecycle, Panel Observation & Routing | `DamHopperMobileApp.kt`, `NativeWorkspaceViewModel.kt` | 1.5h | completed |
| [Phase 04](./phase-04-unit-tests-and-verification.md) | Unit Tests & Verification | `:shared:jvmTest`, `:androidApp:testDebugUnitTest` | 1.5h | completed |

---

## File Ownership Matrix

```
native/android-app/
├── shared/src/commonMain/kotlin/dev/damhopper/nativeapp/
│   ├── features/
│   │   ├── files/
│   │   │   ├── FileTreeState.kt            --> Phase 01 & Phase 02
│   │   │   ├── FileRepository.kt           --> Phase 01
│   │   │   └── FileWatchCoordinator.kt     --> Phase 02
│   │   └── workspace/
│   │       ├── WorkspaceFileOwner.kt       --> Phase 01
│   │       └── ProjectWorkspaceState.kt    --> Phase 01
│   └── ui/screens/
│       └── DamHopperMobileApp.kt           --> Phase 03
├── androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/
│   └── NativeWorkspaceViewModel.kt         --> Phase 03
├── shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/
│   └── features/files/
│       ├── FileTreeStateTest.kt            --> Phase 04
│       └── FileRepositoryTest.kt           --> Phase 04
└── androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/
    └── NativeWorkspaceViewModelTest.kt     --> Phase 04
```

---

## Risk Analysis & Rollback Strategy

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| Permissive `matchesTarget` allows cross-profile leak | Security/State corruption | Validate `target.profileId != null && target.profileId != profileId` returns `false` *before* checking `target.project == "*"`. |
| Target override disrupts socket event replay | Event loss during directory reload | Keep sequence watermark and incarnation checks keyed by canonical relative path; only wire subscription and REST list adopt `effectiveTarget`. |
| Unfocused background publication clobbers active project | Roster display flutter | Maintain strict check: focused workspace (`stage == HUB && project == selectedProj`) publishes from screen; background reconciler skips focused workspace. |
| Coroutine scope cancellation regression | Memory leak or hanging jobs | Retain `ProjectWorkspaceState.revokeAuthority()` and `dispose()` explicit cancellation of child components. |

**Rollback:**
Each phase is strictly isolated. Git commit per phase allows immediate revert of individual components without invalidating sibling phase fixes.

---

## Acceptance Criteria

1. **Agents Section**:
   - `agentsRegistration` is non-null when `flowState.stage == AppFlowStage.HUB` with an active project.
   - `TerminalAgentsContext.registration` is provided to `TerminalAgentsSidebarHost`.
   - `ProjectTerminalScreen` publishes active terminal tabs with correct destroying keys to the Agents roster.
2. **Global Workspace File Explorer**:
   - Tapping "Files" or "Editor" on global workspace from `AgentHubEmptyRoot` transitions UI to `ProjectWorkspaceScreen` displaying files.
   - Secondary constructor of `FileTreeState` maps `FilesystemTargetRef.Workspace` to `ProjectTargetRef(project = "*")`.
   - `FileRepository.listDirectory` sends REST query `targetType=workspace` without throwing cross-owner exception.
3. **Project File Tree & Scope Isolation**:
   - Directory expansion in `FileTreeState` passes `currentProjectRef` to `FileWatchCoordinator.fetchDirectoryOrdered`, subscribing to the active target.
   - `ProjectWorkspaceState.create` uses `SupervisorJob() + Dispatchers.Main.immediate`; watcher child failures do not cancel editor or terminal scopes.
4. **Verification**:
   - `./gradlew.bat :shared:jvmTest` passes cleanly.
   - `./gradlew.bat :androidApp:testDebugUnitTest` passes cleanly.
   - Deprecated `AppFlowStage.TERMINAL` warnings eliminated or minimized.
