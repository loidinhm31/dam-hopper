# Phase 02 — FileWatchCoordinator Target Synchronization

## Overview
- **Priority**: P1
- **Status**: completed
- **Effort**: 1.5h
- **Owner**: Files Subsystem (`:shared`)
- **Dependencies**: [Phase 01](./phase-01-shared-contracts.md)

---

## Context & Objectives
1. In `FileTreeState.kt` (lines 406–423 and 506–520), the state resolves `currentProjectRef` from `_activeBrowsingTarget.value`. However, when fetching or subscribing to directories, it calls `watchCoordinator.fetchDirectoryOrdered("")` with no target argument.
2. `FileWatchCoordinator` binds immutably to its constructor-injected `val target: ProjectTargetRef`:
   - Line 443: `repository.assertTargetMatchesOwner(target, "subscribeTree")`
   - Line 445: `fallbackSubscriptionManager.subscribeQualified(target = target, ...)`
   - Line 496: `repository.listDirectory(target, cleanDir)`
3. When `FileTreeState` was constructed for `target = "*"` and browsing switches to project `"dam-hopper"` (or vice-versa), `watchCoordinator` fetches and subscribes to the stale constructor target, while `FileTreeHelpers.updateChildren` attaches the resulting entries to `currentProjectRef`.
4. We must make `FileWatchCoordinator.fetchDirectoryOrdered` and `ensureSubscribed` target-aware by introducing an optional `targetOverride: ProjectTargetRef? = null` parameter (defaulting to `this.target`).

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt`

#### A. Update `invokeSubscribePort`
Accept optional `targetOverride: ProjectTargetRef? = null` and use `val effectiveTarget = targetOverride ?: this.target`.

**Location**: Lines 431–452.

**Before**:
```kotlin
private suspend fun invokeSubscribePort(
    cleanDir: String,
    onSnapshot: (List<FileTreeItemDto>) -> Unit,
    onQualifiedEvent: (QualifiedEventNotification) -> Unit,
    onOverflow: (subId: UInt, incarnation: Long, msg: String) -> Unit,
): FileTreeSubscription {
    val customPort = subscribeDirectoryPort
    if (customPort != null) {
        return customPort(cleanDir, onSnapshot, onQualifiedEvent) { msg ->
            onOverflow(0uL, 0L, msg)
        }
    }
    repository.assertTargetMatchesOwner(target, "subscribeTree")
    return fallbackSubscriptionManager.subscribeQualified(
        target = target,
        path = cleanDir,
        watchOnly = true,
        onSnapshot = onSnapshot,
        onQualifiedEvent = onQualifiedEvent,
        onOverflow = onOverflow,
    )
}
```

**After**:
```kotlin
private suspend fun invokeSubscribePort(
    cleanDir: String,
    targetOverride: ProjectTargetRef? = null,
    onSnapshot: (List<FileTreeItemDto>) -> Unit,
    onQualifiedEvent: (QualifiedEventNotification) -> Unit,
    onOverflow: (subId: UInt, incarnation: Long, msg: String) -> Unit,
): FileTreeSubscription {
    val customPort = subscribeDirectoryPort
    if (customPort != null) {
        return customPort(cleanDir, onSnapshot, onQualifiedEvent) { msg ->
            onOverflow(0uL, 0L, msg)
        }
    }
    val effectiveTarget = targetOverride ?: this.target
    repository.assertTargetMatchesOwner(effectiveTarget, "subscribeTree")
    return fallbackSubscriptionManager.subscribeQualified(
        target = effectiveTarget,
        path = cleanDir,
        watchOnly = true,
        onSnapshot = onSnapshot,
        onQualifiedEvent = onQualifiedEvent,
        onOverflow = onOverflow,
    )
}
```

---

#### B. Update `ensureSubscribed`
Pass `targetOverride` through to `invokeSubscribePort`.

**Location**: Lines 343–384.

**Before**:
```kotlin
suspend fun ensureSubscribed(directoryPath: String): WatchSubscriptionState? {
    if (isDisposed || isPaused) return null
    val cleanDir = normalizeDirectoryPath(directoryPath)
    val activeSocket = repository.wsConnection.activeSocketRef() ?: return null
    ...
    val sub = invokeSubscribePort(
        cleanDir = cleanDir,
        onSnapshot = {},
        onQualifiedEvent = { qualified -> ... },
        onOverflow = { subId, incarnation, msg -> ... },
    )
    ...
```

**After**:
```kotlin
suspend fun ensureSubscribed(
    directoryPath: String,
    targetOverride: ProjectTargetRef? = null,
): WatchSubscriptionState? {
    if (isDisposed || isPaused) return null
    val cleanDir = normalizeDirectoryPath(directoryPath)
    val activeSocket = repository.wsConnection.activeSocketRef() ?: return null
    ...
    val sub = invokeSubscribePort(
        cleanDir = cleanDir,
        targetOverride = targetOverride,
        onSnapshot = {},
        onQualifiedEvent = { qualified -> ... },
        onOverflow = { subId, incarnation, msg -> ... },
    )
    ...
```

---

#### C. Update `fetchDirectoryOrdered`
Accept `targetOverride: ProjectTargetRef? = null` (defaulting to `null`) and use `val effectiveTarget = targetOverride ?: this.target` when calling `ensureSubscribed` and `repository.listDirectory`.

**Location**: Lines 458–500.

**Before**:
```kotlin
suspend fun fetchDirectoryOrdered(
    directoryPath: String,
    maxRefetchAttempts: Int = 2,
): OrderedDirectoryListingResult {
    val cleanDir = normalizeDirectoryPath(directoryPath)
    var attempt = 0

    while (attempt <= maxRefetchAttempts) {
        attempt++
        if (isDisposed || isPaused) return OrderedDirectoryListingResult.Superseded

        val isDemanded = synchronized(stateLock) { demands[cleanDir]?.isDemanded == true }
        if (isDemanded && repository.wsConnection.activeSocketRef() != null) {
            try {
                ensureSubscribed(cleanDir)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
            }
        }
        ...
        val rawEntries = try {
            repository.listDirectory(target, cleanDir)
        } catch (e: CancellationException) {
...
```

**After**:
```kotlin
suspend fun fetchDirectoryOrdered(
    directoryPath: String,
    targetOverride: ProjectTargetRef? = null,
    maxRefetchAttempts: Int = 2,
): OrderedDirectoryListingResult {
    val cleanDir = normalizeDirectoryPath(directoryPath)
    val effectiveTarget = targetOverride ?: this.target
    var attempt = 0

    while (attempt <= maxRefetchAttempts) {
        attempt++
        if (isDisposed || isPaused) return OrderedDirectoryListingResult.Superseded

        val isDemanded = synchronized(stateLock) { demands[cleanDir]?.isDemanded == true }
        if (isDemanded && repository.wsConnection.activeSocketRef() != null) {
            try {
                ensureSubscribed(cleanDir, targetOverride = effectiveTarget)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
            }
        }
        ...
        val rawEntries = try {
            repository.listDirectory(effectiveTarget, cleanDir)
        } catch (e: CancellationException) {
...
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`

**Locations**:
- Line 408: in `initTreeAndSubscriptionInternal`
- Line 509: in `expandDirectory`

**Before (Line 408)**:
```kotlin
val currentProjectRef = (currentTarget as? FilesystemTargetRef.Project)?.toProjectTargetRef() ?: target
watchCoordinator.acquireExplorerDemand("")
when (val result = watchCoordinator.fetchDirectoryOrdered("")) {
    is OrderedDirectoryListingResult.Published -> {
        if (capturedGen != browsingTargetGeneration || isDisposed) return
        _root.value = FileTreeHelpers.updateChildren(_root.value, "", result.entries, currentProjectRef)
...
```

**After (Line 408)**:
```kotlin
val currentProjectRef = (currentTarget as? FilesystemTargetRef.Project)?.toProjectTargetRef() ?: target
watchCoordinator.acquireExplorerDemand("")
when (val result = watchCoordinator.fetchDirectoryOrdered("", targetOverride = currentProjectRef)) {
    is OrderedDirectoryListingResult.Published -> {
        if (capturedGen != browsingTargetGeneration || isDisposed) return
        _root.value = FileTreeHelpers.updateChildren(_root.value, "", result.entries, currentProjectRef)
...
```

**Before (Line 509)**:
```kotlin
val currentProjectRef = (currentTarget as? FilesystemTargetRef.Project)?.toProjectTargetRef() ?: target
watchCoordinator.acquireExplorerDemand(cleanPath)
when (val result = watchCoordinator.fetchDirectoryOrdered(cleanPath)) {
    is OrderedDirectoryListingResult.Published -> {
        if (capturedGen != browsingTargetGeneration || isDisposed) return false
        _root.value = FileTreeHelpers.updateChildren(_root.value, cleanPath, result.entries, currentProjectRef)
...
```

**After (Line 509)**:
```kotlin
val currentProjectRef = (currentTarget as? FilesystemTargetRef.Project)?.toProjectTargetRef() ?: target
watchCoordinator.acquireExplorerDemand(cleanPath)
when (val result = watchCoordinator.fetchDirectoryOrdered(cleanPath, targetOverride = currentProjectRef)) {
    is OrderedDirectoryListingResult.Published -> {
        if (capturedGen != browsingTargetGeneration || isDisposed) return false
        _root.value = FileTreeHelpers.updateChildren(_root.value, cleanPath, result.entries, currentProjectRef)
...
```

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "file-watch-coordinator-target-override",
    "title": "Add targetOverride parameter to FileWatchCoordinator subscription and fetch methods",
    "blocked_by": ["fix-file-tree-workspace-target", "fix-workspace-file-owner-matching"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt"
    ],
    "constraints": [
      "Default targetOverride to null in fetchDirectoryOrdered and ensureSubscribed.",
      "Fallback to this.target when targetOverride is null.",
      "Keep existing watermark, epoch, and socket-incarnation fencing unchanged."
    ],
    "acceptance": [
      "fetchDirectoryOrdered passes targetOverride to repository.listDirectory and ensureSubscribed.",
      "ensureSubscribed passes targetOverride to invokeSubscribePort and fallbackSubscriptionManager.subscribeQualified."
    ],
    "verification": [
      "Unit test verifies calling fetchDirectoryOrdered with a targetOverride queries repository.listDirectory with the overridden target."
    ]
  },
  {
    "id": "file-tree-state-wire-target-sync",
    "title": "Pass currentProjectRef targetOverride from FileTreeState to watchCoordinator",
    "blocked_by": ["file-watch-coordinator-target-override"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt"
    ],
    "constraints": [
      "Pass currentProjectRef as targetOverride in initTreeAndSubscriptionInternal and expandDirectory.",
      "Preserve browsingTargetGeneration fencing and disposal checks."
    ],
    "acceptance": [
      "FileTreeState passes currentProjectRef to fetchDirectoryOrdered for root and expanded subdirectories.",
      "Switching active browsing target fetches and subscribes using the updated target."
    ],
    "verification": [
      "Unit test verifies browsing target switch from workspace (*) to project triggers listing with the project target ref."
    ]
  }
]
```

- [x] <!-- evcrate-task:file-watch-coordinator-target-override --> Add targetOverride parameter to FileWatchCoordinator subscription and fetch methods
- [x] <!-- evcrate-task:file-tree-state-wire-target-sync --> Pass currentProjectRef targetOverride from FileTreeState to watchCoordinator
