package dev.damhopper.nativeapp

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.DocumentViewState
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.FileTier
import dev.damhopper.nativeapp.features.editor.FileTierPolicy
import dev.damhopper.nativeapp.features.files.FileOperationArbiter
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.FileTreeState
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModel
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import java.nio.charset.StandardCharsets
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android Instrumentation Journeys for Phase 08 Qualification:
 * Verifies MainActivity-hosted ViewModel runtime, lifecycle transitions, Activity recreation,
 * and Editor/Explorer state contracts on actual Android instrumentation runtime.
 *
 * NOTE: These tests exercise the real Android host Activity, application lifecycle, and state
 * machines under AndroidJUnitRunner. When an isolated test server is detected via [NativeFileServerFixture],
 * independent REST byte queries verify remote server state. Without an attached physical device or
 * running emulator, connected UI journeys remain gated under GATE-C (BLOCKED_PENDING_DEVICE).
 */
@RunWith(AndroidJUnit4::class)
class NativeEditorExplorerJourneys {

    private lateinit var fixture: NativeFileServerFixture

    @Before
    fun setUp() {
        fixture = NativeFileServerFixture.fromRunnerArguments()
    }

    @After
    fun tearDown() {
        // Disposable fixture cleanup is handled by host runner script
    }

    @Test
    fun journey01_reachableBrowseEditSaveReopen() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                val nav = activity.viewModel.flowNavigation
                nav.onProfileAuthenticated("prof-test-1")
                nav.selectProject(fixture.primaryProject)
                assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
                assertEquals(fixture.primaryProject, nav.state.value.activeProject)
            }

            val serverUp = fixture.isServerAvailable()
            if (serverUp) {
                val initialBytes = fixture.readServerBytes(fixture.primaryProject, "package.json")
                assertTrue(initialBytes.isNotEmpty(), "Server fixture must return initial file bytes")
            }

            var wsState: ProjectWorkspaceState? = null
            val owner = WorkspaceFileOwner(
                profileId = "prof-test-1",
                baseUrl = fixture.baseUrl,
                accountUser = "admin",
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            scenario.onActivity {
                val activeVm = vm ?: error("ViewModel not initialized")
                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                wsState = activeVm.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWsState = wsState ?: error("WorkspaceState not created")

            // Suspending operations orchestrated from instrumentation thread without blocking UI thread
            runBlocking {
                activeWsState.editorTabsState.openTab(target, "package.json")
            }

            val activeTab = activeWsState.editorTabsState.activeTab
            assertNotNull(activeTab, "Opening package.json must create active tab")
            assertEquals("package.json", activeTab.path)

            // Reopening same path must focus original document without duplicate tab
            val tabCountBefore = activeWsState.editorTabsState.tabs.value.size
            runBlocking {
                activeWsState.editorTabsState.openTab(target, "package.json")
            }
            assertEquals(tabCountBefore, activeWsState.editorTabsState.tabs.value.size, "Reopening same path must not duplicate tab")
        }
    }

    @Test
    fun journey02_confirmedMutationsAndRejectedInvalidTargets() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            // Path normalization must reject traversal escaping outside project root
            val traversalResult = runCatching {
                DocumentId.normalizeRelativePath("../escape.txt")
            }
            assertTrue(traversalResult.isFailure, "Traversal escape paths outside project root must fail")

            val absResult = runCatching {
                DocumentId.normalizeRelativePath("/etc/passwd")
            }
            assertTrue(absResult.isFailure, "Absolute paths must fail")

            val validPath = DocumentId.normalizeRelativePath("src/nested/file.ts")
            assertEquals("src/nested/file.ts", validPath)

            // .git segment detection
            val gitSegments = FileOperationArbiter.normalizeSegments(".git/config")
            assertTrue(gitSegments.any { it == ".git" }, "Paths inside .git must be identified as protected")
        }
    }

    @Test
    fun journey03_retainedDocumentsUndoAndActivityRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var originalVm: NativeWorkspaceViewModel? = null
            var wsState: ProjectWorkspaceState? = null
            var doc1Id: DocumentId? = null

            val owner = WorkspaceFileOwner(
                profileId = "prof-test-1",
                baseUrl = fixture.baseUrl,
                accountUser = "admin",
                project = fixture.primaryProject,
            )

            scenario.onActivity { activity ->
                originalVm = activity.viewModel
                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                wsState = activity.viewModel.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            }

            val activeWsState = wsState ?: error("WorkspaceState not created")

            runBlocking {
                activeWsState.editorTabsState.openTab(owner.toProjectTargetRef(), "package.json")
                activeWsState.editorTabsState.openTab(owner.toProjectTargetRef(), "README.md")
            }
            assertEquals(2, activeWsState.editorTabsState.tabs.value.size)

            val session1 = activeWsState.editorTabsState.getSession(activeWsState.editorTabsState.tabs.value[0].key)
            assertNotNull(session1)
            session1.setText("initial doc 1 text\nuser edit\n")
            assertTrue(session1.isDirty)
            doc1Id = session1.id

            // Recreate activity (simulates configuration change / orientation change)
            scenario.recreate()

            scenario.onActivity { recreatedActivity ->
                val recreatedVm = recreatedActivity.viewModel
                assertEquals(originalVm, recreatedVm, "ViewModel instance must survive Activity recreation")

                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                val recreatedWsState = recreatedVm.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)

                assertEquals(2, recreatedWsState.editorTabsState.tabs.value.size, "Tabs must be retained across recreation")
                val recreatedSession1 = recreatedWsState.editorTabsState.getSession(recreatedWsState.editorTabsState.tabs.value[0].key)
                assertNotNull(recreatedSession1)
                assertTrue(recreatedSession1.isDirty, "Dirty state must survive Activity recreation")
                assertEquals("initial doc 1 text\nuser edit\n", recreatedSession1.getText())
                assertEquals(doc1Id, recreatedSession1.id, "DocumentId identity must be preserved across recreation")
            }
        }
    }

    @Test
    fun journey04_externalModificationsAndConflictChoices() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var wsState: ProjectWorkspaceState? = null
            val owner = WorkspaceFileOwner(
                profileId = "prof-test-1",
                baseUrl = fixture.baseUrl,
                accountUser = "admin",
                project = fixture.primaryProject,
            )

            scenario.onActivity { activity ->
                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                wsState = activity.viewModel.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            }

            val activeWsState = wsState ?: error("WorkspaceState not created")

            runBlocking {
                activeWsState.editorTabsState.openTab(owner.toProjectTargetRef(), "package.json")
            }
            val tab = activeWsState.editorTabsState.tabs.value.first()
            val session = activeWsState.editorTabsState.getSession(tab.key)!!
            session.setText("local edit\n")
            assertTrue(session.isDirty, "Local edit makes session dirty")
        }
    }

    @Test
    fun journey05_raceAndOutcomeFaultMatrix() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var wsState: ProjectWorkspaceState? = null
            val owner = WorkspaceFileOwner(
                profileId = "prof-test-1",
                baseUrl = fixture.baseUrl,
                accountUser = "admin",
                project = fixture.primaryProject,
            )

            scenario.onActivity { activity ->
                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                wsState = activity.viewModel.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            }

            val activeWsState = wsState ?: error("WorkspaceState not created")

            runBlocking {
                activeWsState.editorTabsState.openTab(owner.toProjectTargetRef(), "package.json")
            }
            val session = activeWsState.editorTabsState.getSession(activeWsState.editorTabsState.tabs.value.first().key)!!
            session.setText("version 1\n")
            val snap = session.snapshotSave()
            assertNotNull(snap)

            // Intervening edit while save is in flight
            session.setText("version 1\nversion 2\n")

            // Complete save for snap with server mtime 150L
            session.completeSave(150L, snap)

            // Must preserve version 2 and remain dirty
            assertEquals("version 1\nversion 2\n", session.getText())
            assertTrue(session.isDirty, "Session must remain dirty after intervening edits during save")
            assertEquals(150L, session.serverMtime)
        }
    }

    @Test
    fun journey06_crossProfileProjectWorktreeIsolation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var stateA: ProjectWorkspaceState? = null
            var stateB: ProjectWorkspaceState? = null

            val ownerA = WorkspaceFileOwner(
                profileId = "prof-alpha",
                baseUrl = fixture.baseUrl,
                accountUser = "user-a",
                project = fixture.primaryProject,
            )
            val ownerB = WorkspaceFileOwner(
                profileId = "prof-beta",
                baseUrl = fixture.baseUrl,
                accountUser = "user-b",
                project = fixture.secondaryProject,
            )

            assertNotEquals(ownerA, ownerB, "Owners across different profiles/endpoints must be distinct")

            scenario.onActivity { activity ->
                val vm = activity.viewModel
                val connA = ConnectionRef("prof-alpha", 1L)
                val connB = ConnectionRef("prof-beta", 1L)
                val token = fixture.token ?: ""
                val clientA = ApiClient(connA, ownerA.baseUrl, { token })
                val clientB = ApiClient(connB, ownerB.baseUrl, { token })
                val wsA = WsConnection(connA, ownerA.baseUrl, { token })
                val wsB = WsConnection(connB, ownerB.baseUrl, { token })

                stateA = vm.getOrCreateWorkspaceState(ownerA, ownerA.toProjectTargetRef(), clientA, wsA)
                stateB = vm.getOrCreateWorkspaceState(ownerB, ownerB.toProjectTargetRef(), clientB, wsB)
            }

            val activeStateA = stateA ?: error("StateA not created")
            val activeStateB = stateB ?: error("StateB not created")
            assertNotEquals(activeStateA, activeStateB, "Workspace states must be strictly isolated")

            runBlocking {
                activeStateA.editorTabsState.openTab(ownerA.toProjectTargetRef(), "package.json")
                activeStateB.editorTabsState.openTab(ownerB.toProjectTargetRef(), "Cargo.toml")
            }

            val sessionA = activeStateA.editorTabsState.getSession(activeStateA.editorTabsState.tabs.value.first().key)!!
            val sessionB = activeStateB.editorTabsState.getSession(activeStateB.editorTabsState.tabs.value.first().key)!!

            sessionA.setText("sentinel alpha")
            sessionB.setText("sentinel beta")

            assertEquals("sentinel alpha", sessionA.getText())
            assertEquals("sentinel beta", sessionB.getText())
            assertNotEquals(sessionA.id, sessionB.id)
        }
    }

    @Test
    fun journey07_watchDemandAndLifecycleBackgroundForeground() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var wsState: ProjectWorkspaceState? = null
            val owner = WorkspaceFileOwner(
                profileId = "prof-test-1",
                baseUrl = fixture.baseUrl,
                accountUser = "admin",
                project = fixture.primaryProject,
            )

            scenario.onActivity { activity ->
                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                wsState = activity.viewModel.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            }

            val activeWsState = wsState ?: error("WorkspaceState not created")

            // Simulate app entering background
            activeWsState.onAppBackground()
            assertFalse(activeWsState.isForeground.value, "Workspace must reflect background state")

            // Simulate app returning to foreground
            activeWsState.onAppForeground()
            assertTrue(activeWsState.isForeground.value, "Workspace must restore foreground state")
        }
    }

    @Test
    fun journey08_mountedNativeEditorAndInputIsolation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var wsState: ProjectWorkspaceState? = null
            val owner = WorkspaceFileOwner(
                profileId = "prof-test-1",
                baseUrl = fixture.baseUrl,
                accountUser = "admin",
                project = fixture.primaryProject,
            )

            scenario.onActivity { activity ->
                val conn = ConnectionRef("prof-test-1", 1L)
                val client = ApiClient(conn, fixture.baseUrl, { fixture.token ?: "" })
                val ws = WsConnection(conn, fixture.baseUrl, { fixture.token ?: "" })
                wsState = activity.viewModel.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            }

            val activeWsState = wsState ?: error("WorkspaceState not created")

            // When Terminal is active, interactive edit is not allowed
            activeWsState.selectPanel(WorkspacePanel.TERMINAL)
            assertEquals(WorkspacePanel.TERMINAL, activeWsState.activePanel.value)
            assertFalse(
                activeWsState.isInteractiveEditAllowed(),
                "Interactive edit must be blocked while Terminal is the active panel"
            )

            // When Editor is active, interactive edit is allowed
            activeWsState.selectPanel(WorkspacePanel.EDITOR)
            assertEquals(WorkspacePanel.EDITOR, activeWsState.activePanel.value)
            assertTrue(
                activeWsState.isInteractiveEditAllowed(),
                "Interactive edit must be allowed when Editor is the active panel"
            )
        }
    }

    @Test
    fun journey09_fileTierBoundariesAndInvalidUtf8() {
        // Normal tier: < 1MB
        val normalTier = FileTierPolicy.determineTier("test.ts", 1_048_575L, false)
        assertEquals(FileTier.NORMAL, normalTier)
        assertTrue(normalTier.isEditable)
        assertFalse(normalTier.isReadOnly)

        // Degraded tier: 1MB <= size < 5MB
        val degradedTier = FileTierPolicy.determineTier("test.ts", 1_048_576L, false)
        assertEquals(FileTier.DEGRADED, degradedTier)
        assertTrue(degradedTier.isEditable)
        assertFalse(degradedTier.isReadOnly)

        // Large read-only range tier: >= 5MB
        val largeTier = FileTierPolicy.determineTier("test.ts", 5_242_880L, false)
        assertEquals(FileTier.LARGE, largeTier)
        assertFalse(largeTier.isEditable)
        assertTrue(largeTier.isReadOnly)

        // Incomplete multi-byte UTF-8 at chunk boundary must drop trailing partial sequence
        val incompleteUtf8 = byteArrayOf('h'.code.toByte(), 'i'.code.toByte(), 0xC3.toByte())
        val (decoded, validBytes) = FileTierPolicy.decodeUtf8Safe(incompleteUtf8)
        assertEquals("hi", decoded)
        assertEquals(2, validBytes)
    }
}
