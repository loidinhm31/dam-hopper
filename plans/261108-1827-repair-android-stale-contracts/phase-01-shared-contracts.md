# Phase 01 — Shared Contracts & Scope Isolation

## Overview
- **Priority**: P1
- **Status**: completed
- **Effort**: 1.5h
- **Owner**: Core Shared Module (`:shared`)
- **Dependencies**: None (foundational phase)

---

## Context & Objectives
1. `FileTreeState.kt` secondary constructor line 117 currently maps `FilesystemTargetRef.Workspace` to `ProjectTargetRef(profileId = fsTarget.profileId, project = "workspace")`. The server expects `targetType=workspace` (or `type: "workspace"` on WebSocket), which the Android client represents via `target.project == "*"`.
2. `WorkspaceFileOwner.kt` method `matchesTarget(target: ProjectTargetRef)` currently rejects `target.project == "*"` if the owner is tied to a specific project (`project != "*"`), triggering `IllegalArgumentException: Cross-owner target rejected in FileRepository.listDirectory`.
3. `FileRepository.kt` must allow `target.project == "*"` in `assertTargetMatchesOwner` and correctly generate REST query parameters (`targetType=workspace`) for `listDirectory` and `languageFiles`.
4. `ProjectWorkspaceState.kt` lines 94 and 652 default `coroutineScope` to `CoroutineScope(Dispatchers.Main.immediate)` without a `SupervisorJob()`. Any child coroutine failure (e.g. unhandled network exception or cancelled watcher) propagates upward and cancels the entire workspace scope.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`
**Location**: Secondary constructor, line 117.

**Before**:
```kotlin
constructor(
    fsTarget: FilesystemTargetRef,
    repository: FileRepository,
    coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    watchCoordinator: FileWatchCoordinator? = null,
) : this(
    target = when (fsTarget) {
        is FilesystemTargetRef.Project -> fsTarget.toProjectTargetRef()
        is FilesystemTargetRef.Workspace -> ProjectTargetRef(profileId = fsTarget.profileId, project = "workspace")
    },
    repository = repository,
    coroutineScope = coroutineScope,
    watchCoordinator = watchCoordinator,
    initialFsTarget = fsTarget,
)
```

**After**:
```kotlin
constructor(
    fsTarget: FilesystemTargetRef,
    repository: FileRepository,
    coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    watchCoordinator: FileWatchCoordinator? = null,
) : this(
    target = when (fsTarget) {
        is FilesystemTargetRef.Project -> fsTarget.toProjectTargetRef()
        is FilesystemTargetRef.Workspace -> ProjectTargetRef(profileId = fsTarget.profileId, project = "*")
    },
    repository = repository,
    coroutineScope = coroutineScope,
    watchCoordinator = watchCoordinator,
    initialFsTarget = fsTarget,
)
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`
**Location**: `matchesTarget(target: ProjectTargetRef)`, lines 37–43.

**Before**:
```kotlin
fun matchesTarget(target: ProjectTargetRef): Boolean {
    if (target.profileId != null && target.profileId != profileId) return false
    if (project.isNotBlank() && project != "*" && target.project != project) return false
    if (project == "*") return true
    val targetWorktree = normalizeWorktree(target.worktreePath)
    return targetWorktree == normalizedWorktreePath
}
```

**After**:
```kotlin
fun matchesTarget(target: ProjectTargetRef): Boolean {
    if (target.profileId != null && target.profileId != profileId) return false
    // Workspace-level query (project = "*") matches any workspace owner under the same profile
    if (target.project == "*") return true
    if (project.isNotBlank() && project != "*" && target.project != project) return false
    if (project == "*") return true
    val targetWorktree = normalizeWorktree(target.worktreePath)
    return targetWorktree == normalizedWorktreePath
}
```

---

### 3. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`
**Location**: `assertTargetMatchesOwner` (lines 63–69), `listDirectory` (lines 74–86), `languageFiles` (lines 93–104).

**Verification & Invariant**:
- `assertTargetMatchesOwner` calls `owner.matchesTarget(target)`. With the fix in `WorkspaceFileOwner.kt`, `target.project == "*"` is accepted across all owners sharing the profile ID.
- `listDirectory`:
  ```kotlin
  val queryParams = if (target.project == "*") {
      mutableMapOf("targetType" to "workspace", "path" to cleanPath)
  } else {
      val params = mutableMapOf("targetType" to "project", "project" to target.project, "path" to cleanPath)
      target.worktreePath?.let { params["worktreePath"] = it }
      params
  }
  ```
- `languageFiles`:
  ```kotlin
  val queryParams = if (target.project == "*") {
      mutableMapOf("targetType" to "workspace")
  } else {
      val params = mutableMapOf("targetType" to "project", "project" to target.project)
      target.worktreePath?.let { params["worktreePath"] = it }
      params
  }
  ```
Confirm that no other repository methods reject `target.project == "*"`.

---

### 4. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`
**Location**: Class primary constructor parameter (line 94) and companion factory `create` (line 652).

**Before**:
```kotlin
// Line 94:
val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),

// Line 652:
fun create(
    owner: WorkspaceFileOwner,
    target: ProjectTargetRef,
    fileRepository: FileRepository,
    editorRepository: EditorRepository,
    documentFactory: EditorDocumentFactory? = null,
    coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),
    lifecycleCoordinator: LifecycleCoordinator? = null,
...
```

**After**:
```kotlin
// Line 94:
val coroutineScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),

// Line 652:
fun create(
    owner: WorkspaceFileOwner,
    target: ProjectTargetRef,
    fileRepository: FileRepository,
    editorRepository: EditorRepository,
    documentFactory: EditorDocumentFactory? = null,
    coroutineScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
    lifecycleCoordinator: LifecycleCoordinator? = null,
...
```

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "fix-file-tree-workspace-target",
    "title": "Fix FileTreeState secondary constructor workspace target mapping",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt"
    ],
    "constraints": [
      "Map FilesystemTargetRef.Workspace to ProjectTargetRef(profileId = fsTarget.profileId, project = \"*\").",
      "Do not modify primary constructor or default parameter signatures."
    ],
    "acceptance": [
      "FileTreeState(FilesystemTargetRef.Workspace(profileId = \"prof-1\")) produces target.project == \"*\".",
      "activeBrowsingTarget initializes to FilesystemTargetRef.Workspace."
    ],
    "verification": [
      "FileTreeState secondary constructor unit test passes without throwing IllegalArgumentException."
    ]
  },
  {
    "id": "fix-workspace-file-owner-matching",
    "title": "Align WorkspaceFileOwner and FileRepository for workspace targets",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt"
    ],
    "constraints": [
      "Workspace target (target.project == \"*\") must match any owner sharing the profileId.",
      "Profile mismatch must still fail closed (return false).",
      "Preserve existing worktree normalization and project identity checks for non-workspace targets."
    ],
    "acceptance": [
      "owner.matchesTarget(ProjectTargetRef(project = \"*\")) returns true when profileId matches.",
      "FileRepository.assertTargetMatchesOwner does not throw on target.project == \"*\".",
      "FileRepository.listDirectory and languageFiles query params send targetType=workspace."
    ],
    "verification": [
      "Unit test calling matchesTarget with project = \"*\" across distinct project owners returns true."
    ]
  },
  {
    "id": "add-supervisor-job-workspace-scope",
    "title": "Add SupervisorJob to ProjectWorkspaceState coroutineScope",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt"
    ],
    "constraints": [
      "Add SupervisorJob() to both class parameter default (line 94) and companion factory default (line 652).",
      "Keep Dispatchers.Main.immediate as dispatcher."
    ],
    "acceptance": [
      "ProjectWorkspaceState.create() provides a coroutineScope backed by SupervisorJob.",
      "A failing child coroutine launched in coroutineScope does not cancel the parent scope."
    ],
    "verification": [
      "Unit test launching a failing child coroutine on workspaceState.coroutineScope verifies scope remains active."
    ]
  }
]
```

- [x] <!-- evcrate-task:fix-file-tree-workspace-target --> Fix FileTreeState secondary constructor workspace target mapping
- [x] <!-- evcrate-task:fix-workspace-file-owner-matching --> Align WorkspaceFileOwner and FileRepository for workspace targets
- [x] <!-- evcrate-task:fix-workspace-file-owner-matching --> Verify FileRepository listDirectory and languageFiles query parameters
- [x] <!-- evcrate-task:add-supervisor-job-workspace-scope --> Add SupervisorJob to ProjectWorkspaceState coroutineScope
