package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class GitChangesBehaviorTest {

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

    private fun testScope(project: String = "test-proj"): GitOperationScope {
        val owner = WorkspaceFileOwner(
            profileId = "test-profile",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = project,
        )
        return GitOperationScope(owner = owner, generation = 1L)
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
    fun testPartitioningStagedUnstagedAndUntracked() = runTest {
        server!!.createContext("/api/git/test-proj/diff") { exchange ->
            val json = """
                {
                    "entries": [
                        {
                            "path": "staged.txt",
                            "status": "modified",
                            "staged": true,
                            "additions": 3,
                            "deletions": 1
                        },
                        {
                            "path": "unstaged.txt",
                            "status": "modified",
                            "staged": false,
                            "additions": 5,
                            "deletions": 2
                        },
                        {
                            "path": "untracked.txt",
                            "status": "added",
                            "staged": false,
                            "additions": 0,
                            "deletions": 0
                        }
                    ],
                    "untrackedTruncated": false,
                    "untrackedTotal": 1
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = GitChangesController(repo, this, createTestHost())
        val scope = testScope()

        controller.updateScope(scope)
        controller.refreshChanges().join()

        assertEquals(1, controller.stagedFiles.value.size)
        assertEquals("staged.txt", controller.stagedFiles.value[0].path)

        assertEquals(1, controller.unstagedFiles.value.size)
        assertEquals("unstaged.txt", controller.unstagedFiles.value[0].path)

        assertEquals(1, controller.untrackedFiles.value.size)
        assertEquals("untracked.txt", controller.untrackedFiles.value[0].path)
        assertEquals(1, controller.untrackedTotal.value)
        assertFalse(controller.untrackedTruncated.value)
    }

    @Test
    fun testDualStateFileCanAppearStagedAndUnstaged() = runTest {
        server!!.createContext("/api/git/test-proj/diff") { exchange ->
            val json = """
                {
                    "entries": [
                        {
                            "path": "dual.txt",
                            "status": "modified",
                            "staged": true,
                            "additions": 2,
                            "deletions": 0
                        },
                        {
                            "path": "dual.txt",
                            "status": "modified",
                            "staged": false,
                            "additions": 4,
                            "deletions": 1
                        }
                    ],
                    "untrackedTruncated": false,
                    "untrackedTotal": 0
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = GitChangesController(repo, this, createTestHost())
        controller.updateScope(testScope())
        controller.refreshChanges().join()

        assertEquals(1, controller.stagedFiles.value.size)
        assertEquals("dual.txt", controller.stagedFiles.value[0].path)
        assertTrue(controller.stagedFiles.value[0].staged)

        assertEquals(1, controller.unstagedFiles.value.size)
        assertEquals("dual.txt", controller.unstagedFiles.value[0].path)
        assertFalse(controller.unstagedFiles.value[0].staged)
    }

    @Test
    fun testUntrackedPagination() = runTest {
        server!!.createContext("/api/git/test-proj/diff") { exchange ->
            val json = """
                {
                    "entries": [
                        {
                            "path": "untracked-1.txt",
                            "status": "added",
                            "staged": false,
                            "additions": 0,
                            "deletions": 0
                        }
                    ],
                    "untrackedTruncated": true,
                    "untrackedTotal": 2
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/untracked") { exchange ->
            val json = """
                {
                    "entries": [
                        {
                            "path": "untracked-2.txt",
                            "status": "added",
                            "staged": false,
                            "additions": 0,
                            "deletions": 0
                        }
                    ],
                    "untrackedTruncated": false,
                    "untrackedTotal": 2
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = GitChangesController(repo, this, createTestHost())
        controller.updateScope(testScope())
        controller.refreshChanges().join()

        assertEquals(1, controller.untrackedFiles.value.size)
        assertTrue(controller.untrackedTruncated.value)

        val loadJob = controller.loadMoreUntracked()
        loadJob.join()

        assertEquals(2, controller.untrackedFiles.value.size)
        assertEquals("untracked-1.txt", controller.untrackedFiles.value[0].path)
        assertEquals("untracked-2.txt", controller.untrackedFiles.value[1].path)
        assertFalse(controller.untrackedTruncated.value)
    }

    @Test
    fun testDiscardOnlyInvalidatesOnOkTrue() = runTest {
        var diffFetchCount = 0
        server!!.createContext("/api/git/test-proj/diff") { exchange ->
            diffFetchCount++
            val json = """{"entries":[],"untrackedTruncated":false,"untrackedTotal":0}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/discard") { exchange ->
            val json = """{"ok":false,"error":"discard locked"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val controller = GitChangesController(repo, this, createTestHost())
        controller.updateScope(testScope())
        controller.refreshChanges().join()
        assertEquals(1, diffFetchCount)

        val discardJob = controller.discardFile("file.txt")
        discardJob.join()

        // diff was NOT refetched because discard returned false
        assertEquals(1, diffFetchCount)
        assertNotNull(controller.error.value)
    }
}
