package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class GitSyncWorktreeSafetyTest {

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

    private fun createRepository(): GitRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return GitRepository(client)
    }

    private fun testScope(root: String? = null): GitOperationScope {
        val owner = WorkspaceFileOwner(
            profileId = "test-profile",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = "test-proj",
            worktreePath = "/wt-1",
        )
        return GitOperationScope(owner = owner, generation = 1L, root = root)
    }

    private fun createTestHost(
        owner: WorkspaceFileOwner = testScope().owner,
        connection: ConnectionRef = ConnectionRef("test-profile", 1L)
    ): GitHostPorts {
        val safety = WorkspaceGitSafety(
            boundOwner = owner,
            connectionGetter = { connection },
            fileRepositoryGetter = { null },
            editorRepositoryGetter = { null },
            terminalRepositoryGetter = { null },
            workspaceStateGetter = { null },
            retainedDirtyDocsProvider = { emptyList() },
        )
        return object : GitHostPorts {
            override suspend fun <T> withMutationGuard(
                scope: GitOperationScope,
                impact: GitMutationImpact,
                paths: List<String>,
                dispatch: suspend () -> T,
            ): Result<T> = safety.withMutationGuard(scope, impact, paths, dispatch)

            override suspend fun preflightRemoval(
                scope: GitOperationScope,
                worktree: ProjectWorktree,
            ): WorktreeRemovalPrecheck = safety.preflightRemoval(scope, worktree)

            override suspend fun requestWorktreeSwitch(
                scope: GitOperationScope,
                target: ProjectTargetRef,
            ): Result<Unit> = safety.requestWorktreeSwitch(scope, target)

            override suspend fun openWorkspaceFile(
                scope: GitOperationScope,
                rootRelativePath: String,
            ): Result<Unit> = safety.openWorkspaceFile(scope, rootRelativePath)

            override fun onMutationOutcome(event: GitMutationEvent) {
                safety.onMutationOutcome(event)
            }

            override fun refresh(reason: GitRefreshReason) {}
            override fun openRecoveryTerminal(scope: GitOperationScope) {}
        }
    }

    @Test
    fun testSecondaryRootFetchAndPullAreRefusedBeforeRequest() = runTest {
        var networkHit = false
        server!!.createContext("/api/git/fetch") { exchange ->
            networkHit = true
            exchange.sendResponseHeaders(200, 2)
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }
        server!!.createContext("/api/git/pull") { exchange ->
            networkHit = true
            exchange.sendResponseHeaders(200, 2)
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }

        val repo = createRepository()
        val controller = GitSyncController(repo, this, createTestHost())

        // Secondary root scope
        val secondaryScope = testScope(root = "submodule-root")
        controller.updateScope(secondaryScope)

        // 1. Fetch refused
        val fetchJob = controller.fetch()
        fetchJob.join()
        assertFalse(networkHit)
        assertEquals("Secondary VCS roots do not support fetch or pull", controller.error.value)

        // 2. Pull refused
        val pullJob = controller.pull()
        pullJob.join()
        assertFalse(networkHit)
        assertEquals("Secondary VCS roots do not support fetch or pull", controller.error.value)
    }

    @Test
    fun testPrimaryRootFetchExecutesExactTarget() = runTest {
        var requestedBody = ""
        server!!.createContext("/api/git/fetch") { exchange ->
            requestedBody = exchange.requestBody.readBytes().decodeToString()
            val json = """[{"projectName":"test-proj","worktreePath":"/wt-1","success":true}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = GitSyncController(repo, this, createTestHost())
        controller.updateScope(testScope(root = null))

        val fetchJob = controller.fetch()
        fetchJob.join()

        assertNull(controller.error.value)
        assertTrue(requestedBody.contains("\"project\":\"test-proj\""))
        assertTrue(requestedBody.contains("\"worktreePath\":\"/wt-1\""))
        assertEquals(1, controller.lastOpResults.value?.size)
        assertTrue(controller.lastOpResults.value!![0].success)
    }

    @Test
    fun testWorktreeRemovalRefusesMissingStaleDiscovery() = runTest {
        server!!.createContext("/api/git/test-proj/worktrees") { exchange ->
            // Fresh discovery returns empty list: target worktree disappeared
            val json = """[]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = WorktreeMutationController(
            repository = repo,
            coroutineScope = this,
            host = createTestHost(),
        )
        controller.updateScope(testScope())

        val staleWorktree = ProjectWorktree(
            path = "stale-wt",
            repositoryPath = "/repo/stale-wt",
            branch = "stale-branch",
            commitHash = "abc",
            isMain = false,
        )

        var result: Result<Boolean>? = null
        val job = controller.removeWorktree(staleWorktree) { res ->
            result = res
        }
        job.join()

        assertNotNull(result)
        assertTrue(result!!.isFailure)
        assertTrue(result!!.exceptionOrNull()?.message!!.contains("no longer exists in fresh discovery"))
    }

    @Test
    fun testWorktreeRemovalRefusesLockedAndUnavailable() = runTest {
        val wtLocked = ProjectWorktree(
            path = "wt-locked",
            repositoryPath = "/repo/wt-locked",
            branch = "locked-branch",
            commitHash = "abc",
            isMain = false,
            isLocked = true,
        )
        val wtUnavailable = ProjectWorktree(
            path = "wt-unavail",
            repositoryPath = "/repo/wt-unavail",
            branch = "unavail-branch",
            commitHash = "def",
            isMain = false,
            isAvailable = false,
        )

        server!!.createContext("/api/git/test-proj/worktrees") { exchange ->
            val json = """[
                {"path":"wt-locked","repositoryPath":"/repo/wt-locked","branch":"locked-branch","commitHash":"abc","isMain":false,"isLocked":true,"isAvailable":true},
                {"path":"wt-unavail","repositoryPath":"/repo/wt-unavail","branch":"unavail-branch","commitHash":"def","isMain":false,"isLocked":false,"isAvailable":false}
            ]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = WorktreeMutationController(
            repository = repo,
            coroutineScope = this,
            host = createTestHost(),
        )
        controller.updateScope(testScope())

        var lockedRes: Result<Boolean>? = null
        controller.removeWorktree(wtLocked) { lockedRes = it }.join()
        assertTrue(lockedRes!!.isFailure)
        assertTrue(lockedRes!!.exceptionOrNull()?.message!!.contains("locked"))

        var unavailRes: Result<Boolean>? = null
        controller.removeWorktree(wtUnavailable) { unavailRes = it }.join()
        assertTrue(unavailRes!!.isFailure)
        assertTrue(unavailRes!!.exceptionOrNull()?.message!!.contains("unavailable"))
    }
}
