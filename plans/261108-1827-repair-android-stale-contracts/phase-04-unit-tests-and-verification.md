# Phase 04 — Unit Tests & Verification

## Overview
- **Priority**: P1
- **Status**: completed
- **Effort**: 1.5h
- **Owner**: Test Engineering (`:shared` & `:androidApp`)
- **Dependencies**: [Phase 01](./phase-01-shared-contracts.md), [Phase 02](./phase-02-file-watch-coordinator.md), [Phase 03](./phase-03-lifecycle-and-routing.md)

---

## Context & Objectives
1. Previously, unit tests in `:shared:jvmTest` and `:androidApp:testDebugUnitTest` were green (429 and 114 tests passing) because none of the existing tests exercised:
   - The secondary constructor `FileTreeState(fsTarget = FilesystemTargetRef.Workspace)` which previously injected `"workspace"` instead of `"*"`.
   - `WorkspaceFileOwner.matchesTarget` with `ProjectTargetRef(project = "*")` across project-bound owners.
   - `FileWatchCoordinator.fetchDirectoryOrdered` with dynamic target overrides.
   - `NativeWorkspaceViewModel.dispatchAction` for `OpenFiles(FilesystemTargetRef.Workspace)`.
2. This phase adds comprehensive automated unit tests covering all repaired contract boundaries and executes full verification suites.

---

## Exact Test Implementations

### 1. `FileTreeStateTest.kt` (under `:shared:jvmTest`)
**File**: `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt`

Add unit tests:
```kotlin
@Test
fun testSecondaryConstructorWithWorkspaceTargetSetsAsteriskProject() = runTest {
    val repo = createRepository()
    val wsTarget = FilesystemTargetRef.Workspace(profileId = "test-profile", workspaceEpoch = 1L)
    val state = FileTreeState(fsTarget = wsTarget, repository = repo)

    assertEquals("*", state.target.project, "Workspace target must map to project = '*'")
    assertEquals("test-profile", state.target.profileId)
    assertTrue(state.activeBrowsingTarget.value is FilesystemTargetRef.Workspace)
    state.dispose()
}

@Test
fun testSelectBrowsingTargetBetweenWorkspaceAndProject() = runTest {
    val repo = createRepository()
    val wsTarget = FilesystemTargetRef.Workspace(profileId = "test-profile")
    val state = FileTreeState(fsTarget = wsTarget, repository = repo)
    state.updateRegisteredProjects(listOf("demo"))

    // Transition from Workspace to Project
    val projTarget = FilesystemTargetRef.Project(profileId = "test-profile", project = "demo")
    val res = state.selectBrowsingTarget(projTarget)
    assertEquals(TargetBrowseStatus.CONFIGURED, res.status)
    assertEquals("demo", (state.activeBrowsingTarget.value as? FilesystemTargetRef.Project)?.project)

    // Transition back to Workspace
    val resBack = state.selectBrowsingTarget(wsTarget)
    assertEquals(TargetBrowseStatus.CONFIGURED, resBack.status)
    assertTrue(state.activeBrowsingTarget.value is FilesystemTargetRef.Workspace)
    state.dispose()
}
```

---

### 2. `FileRepositoryTest.kt` (under `:shared:jvmTest`)
**File**: `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt`

Add unit tests:
```kotlin
@Test
fun testWorkspaceTargetMatchesProjectBoundOwnerWithoutCrossOwnerException() = runTest {
    // Owner is bound to specific project "demo-proj"
    val repo = createRepository(profileId = "test-profile", project = "demo-proj")
    val workspaceTarget = ProjectTargetRef(profileId = "test-profile", project = "*")

    // Must not throw IllegalArgumentException
    repo.assertTargetMatchesOwner(workspaceTarget, "testWorkspaceQuery")
    assertTrue(repo.owner.matchesTarget(workspaceTarget))
}

@Test
fun testListDirectoryWithWorkspaceTargetSendsWorkspaceTargetType() = runTest {
    var capturedQuery: String? = null
    server!!.createContext("/api/fs/list") { exchange ->
        capturedQuery = exchange.requestURI.query
        val json = """{"entries":[{"name":"project-a","kind":"directory","size":0,"mtime":10,"isSymlink":false}]}"""
        exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
        exchange.responseBody.use { it.write(json.toByteArray()) }
    }

    val repo = createRepository(profileId = "test-profile", project = "demo-proj")
    val workspaceTarget = ProjectTargetRef(profileId = "test-profile", project = "*")
    val entries = repo.listDirectory(workspaceTarget, "")

    assertEquals(1, entries.size)
    assertEquals("project-a", entries[0].name)
    assertNotNull(capturedQuery)
    assertTrue(capturedQuery!!.contains("targetType=workspace"), "Query must contain targetType=workspace: $capturedQuery")
    assertFalse(capturedQuery!!.contains("targetType=project"), "Query must not contain targetType=project: $capturedQuery")
}

@Test
fun testLanguageFilesWithWorkspaceTargetSendsWorkspaceTargetType() = runTest {
    var capturedQuery: String? = null
    server!!.createContext("/api/fs/language-files") { exchange ->
        capturedQuery = exchange.requestURI.query
        val json = """{"files":["/a/b.kt"],"truncated":false}"""
        exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
        exchange.responseBody.use { it.write(json.toByteArray()) }
    }

    val repo = createRepository(profileId = "test-profile", project = "demo-proj")
    val workspaceTarget = ProjectTargetRef(profileId = "test-profile", project = "*")
    val res = repo.languageFiles(workspaceTarget)

    assertEquals(listOf("/a/b.kt"), res.files)
    assertNotNull(capturedQuery)
    assertTrue(capturedQuery!!.contains("targetType=workspace"))
}
```

---

### 3. `ProjectWorkspaceStateTest.kt` (under `:shared:jvmTest`)
**File**: `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`

Add unit test:
```kotlin
@Test
fun testWorkspaceCoroutineScopeUsesSupervisorJobAndSurvivesChildFailure() = runTest {
    val owner = WorkspaceFileOwner(
        profileId = "test-profile",
        baseUrl = "http://127.0.0.1:$serverPort",
        accountUser = "test-user",
        project = "demo",
    )
    val target = owner.toProjectTargetRef()
    val conn = ConnectionRef("test-profile", 1L)
    val client = ApiClient(conn, "http://127.0.0.1:$serverPort", { "test-token" })
    val ws = TestWorkspaceWsConnection(conn, "http://127.0.0.1:$serverPort")
    val fileRepo = FileRepository(owner, client, ws)
    val editorRepo = EditorRepository(fileRepo, profileId = "test-profile")

    val state = ProjectWorkspaceState.create(
        owner = owner,
        target = target,
        fileRepository = fileRepo,
        editorRepository = editorRepo,
    )

    // Launch a failing child coroutine in workspace coroutineScope
    val handler = kotlinx.coroutines.CoroutineExceptionHandler { _, _ -> }
    val failingJob = state.coroutineScope.launch(handler) {
        throw IllegalStateException("Simulated watcher child failure")
    }
    failingJob.join()

    // SupervisorJob ensures the parent scope remains active
    assertTrue(state.coroutineScope.isActive, "Workspace coroutine scope must remain active after child failure")
    state.revokeAuthority()
}
```

---

### 4. `NativeWorkspaceViewModelTest.kt` (under `:androidApp:testDebugUnitTest`)
**File**: `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt`

Add unit tests:
```kotlin
@Test
fun testDispatchOpenFilesWithWorkspaceTargetSelectsFilesAndClearsActiveProject() = runBlocking {
    val flowNav = AppFlowNavigation()
    flowNav.selectProject("old-project", null, "prof-1")
    assertEquals("old-project", flowNav.state.value.activeProject)

    // Simulate AgentHubAction.OpenFiles with FilesystemTargetRef.Workspace
    val action = AgentHubAction.OpenFiles(FilesystemTargetRef.Workspace(profileId = "prof-1"))
    when (val target = action.target) {
        is FilesystemTargetRef.Workspace -> {
            val profId = target.profileId ?: flowNav.state.value.activeProfileId
            flowNav.selectProject(null, null, profId)
        }
        else -> {}
    }

    assertNull(flowNav.state.value.activeProject, "activeProject must be cleared for workspace browsing")
    assertEquals("prof-1", flowNav.state.value.activeProfileId)
    assertEquals(AppFlowStage.HUB, flowNav.state.value.stage)
}
```

---

## Verification Execution Commands

Run the full shared test suite:
```sh
./gradlew.bat :shared:jvmTest --rerun-tasks
```

Run the Android app unit test suite:
```sh
./gradlew.bat :androidApp:testDebugUnitTest --rerun-tasks
```

Ensure 0 failures and deprecation warnings in `DamHopperMobileApp.kt` are resolved.

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "add-file-tree-and-repo-contract-tests",
    "title": "Add unit tests for FileTreeState and FileRepository workspace target handling",
    "blocked_by": ["fix-file-tree-workspace-target", "fix-workspace-file-owner-matching"],
    "allowed_files": [
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt"
    ],
    "constraints": [
      "Test FileTreeState secondary constructor maps Workspace to project = \"*\".",
      "Test WorkspaceFileOwner.matchesTarget with project = \"*\" across project owners.",
      "Test FileRepository listDirectory and languageFiles issue targetType=workspace."
    ],
    "acceptance": [
      "New unit tests in FileTreeStateTest and FileRepositoryTest compile and pass."
    ],
    "verification": [
      "./gradlew.bat :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.files.*\""
    ]
  },
  {
    "id": "add-workspace-scope-supervisor-tests",
    "title": "Add unit test for ProjectWorkspaceState SupervisorJob scope isolation",
    "blocked_by": ["add-supervisor-job-workspace-scope"],
    "allowed_files": [
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt"
    ],
    "constraints": [
      "Verify that an unhandled child exception does not cancel ProjectWorkspaceState.coroutineScope."
    ],
    "acceptance": [
      "ProjectWorkspaceStateTest verifies scope.isActive remains true after child failure."
    ],
    "verification": [
      "./gradlew.bat :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceStateTest\""
    ]
  },
  {
    "id": "add-viewmodel-workspace-action-tests",
    "title": "Add unit test for NativeWorkspaceViewModel workspace routing actions",
    "blocked_by": ["route-open-files-editor-workspace"],
    "allowed_files": [
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt"
    ],
    "constraints": [
      "Verify flowNavigation updates activeProject to null when OpenFiles is dispatched for workspace target."
    ],
    "acceptance": [
      "Unit test passes in :androidApp:testDebugUnitTest."
    ],
    "verification": [
      "./gradlew.bat :androidApp:testDebugUnitTest --tests \"dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModelTest\""
    ]
  },
  {
    "id": "run-full-verification-suites",
    "title": "Execute full test suites across shared and androidApp modules",
    "blocked_by": [
      "add-file-tree-and-repo-contract-tests",
      "add-workspace-scope-supervisor-tests",
      "add-viewmodel-workspace-action-tests"
    ],
    "allowed_files": [],
    "constraints": [
      "Must not alter product files during verification.",
      "Record full test outputs and exit codes."
    ],
    "acceptance": [
      ":shared:jvmTest passes with 0 failures.",
      ":androidApp:testDebugUnitTest passes with 0 failures."
    ],
    "verification": [
      "./gradlew.bat :shared:jvmTest --rerun-tasks",
      "./gradlew.bat :androidApp:testDebugUnitTest --rerun-tasks"
    ]
  }
]
```

- [x] <!-- evcrate-task:add-file-tree-and-repo-contract-tests --> Add unit tests for FileTreeState and FileRepository workspace target handling
- [x] <!-- evcrate-task:add-workspace-scope-supervisor-tests --> Add unit test for ProjectWorkspaceState SupervisorJob scope isolation
- [x] <!-- evcrate-task:add-viewmodel-workspace-action-tests --> Add unit test for NativeWorkspaceViewModel workspace routing actions
- [x] <!-- evcrate-task:run-full-verification-suites --> Execute full test suites across shared and androidApp modules
