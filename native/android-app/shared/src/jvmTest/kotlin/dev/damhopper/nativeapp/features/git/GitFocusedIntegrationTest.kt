package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class GitFocusedIntegrationTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createOwner(): WorkspaceFileOwner = WorkspaceFileOwner(
        profileId = "test-prof",
        baseUrl = "http://127.0.0.1:$serverPort",
        accountUser = "test-account",
        project = "focused-proj",
        worktreePath = null,
    )

    private fun createRuntime(testScope: TestScope, owner: WorkspaceFileOwner = createOwner()): GitWorkspaceRuntime {
        val conn = ConnectionRef("test-prof", 1L)
        val client = ApiClient(conn, owner.normalizedBaseUrl, { "test-token" })
        val repo = GitRepository(client)
        val state = GitWorkspaceState()
        val safety = WorkspaceGitSafety(
            boundOwner = owner,
            connectionGetter = { conn },
            fileRepositoryGetter = { null },
            editorRepositoryGetter = { null },
            terminalRepositoryGetter = { null },
            workspaceStateGetter = { null },
            retainedDirtyDocsProvider = { emptyList() },
        )
        return GitWorkspaceRuntime(
            owner = owner,
            connection = conn,
            repository = repo,
            presentation = state,
            safety = safety,
            coroutineScope = testScope,
        )
    }

    @Test
    fun testRuntimeInitializationAndControllerWiring() = runTest {
        val runtime = createRuntime(this)
        assertNotNull(runtime.changes)
        assertNotNull(runtime.branches)
        assertNotNull(runtime.history)
        assertNotNull(runtime.worktrees)
        assertNotNull(runtime.rewrite)
        assertNotNull(runtime.actions)
        assertNotNull(runtime.leased)
        assertNotNull(runtime.sync)
        assertNotNull(runtime.diff)

        val scope = runtime.scope.value
        assertNotNull(scope)
        assertEquals("focused-proj", scope.project)
        assertEquals("test-prof", scope.profileId)
        assertEquals(1L, scope.generation)
        assertEquals(scope, runtime.changes.activeScope)
        assertEquals(scope, runtime.branches.activeScope)
    }

    @Test
    fun testSelectRootPropagatesScopeToAllControllers() = runTest {
        val runtime = createRuntime(this)
        runtime.selectRoot("sub-root-path")

        val newScope = runtime.scope.value
        assertNotNull(newScope)
        assertEquals("sub-root-path", newScope.root)
        assertEquals(newScope, runtime.changes.activeScope)
        assertEquals(newScope, runtime.branches.activeScope)
        assertEquals(newScope, runtime.sync.activeScope)
        assertEquals(newScope, runtime.worktrees.activeScope)
        assertEquals(newScope, runtime.rewrite.activeScope)
        assertEquals(newScope, runtime.actions.activeScope)
    }

    @Test
    fun testMutationOutcomeTriggersRefreshOnSuccess() = runTest {
        val runtime = createRuntime(this)
        val event = GitMutationEvent(
            scope = runtime.scope.value!!,
            impact = GitMutationImpact.INDEX,
            kind = GitOutcomeKind.SUCCEEDED,
            paths = listOf("fileA.txt"),
            message = null,
        )
        runtime.onMutationOutcome(event)
        assertTrue(runtime.presentation.isAuthorityValid.value)
    }

    @Test
    fun testRevokeInvalidatesAllControllersAndPresentation() = runTest {
        val runtime = createRuntime(this)
        runtime.presentation.selectSection(GitPanelSection.HISTORY)
        runtime.presentation.updateModal(GitModalState(showCreateBranchDialog = true))

        runtime.revoke()

        assertFalse(runtime.presentation.isAuthorityValid.value)
        assertEquals(GitModalState(), runtime.presentation.modal.value)
        assertNull(runtime.changes.activeScope)
        assertNull(runtime.branches.activeScope)
        assertNull(runtime.history.activeScope)
    }
}
