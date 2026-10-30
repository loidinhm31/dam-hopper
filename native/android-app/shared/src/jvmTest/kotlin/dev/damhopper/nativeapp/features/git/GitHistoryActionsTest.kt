package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class GitHistoryActionsTest {

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

    private fun testScope(profileId: String = "profile-1", generation: Long = 1L, project: String = "demo"): GitOperationScope {
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "test-user",
            project = project,
        )
        return GitOperationScope(owner, generation)
    }

    private fun createTestHost(
        scopeGetter: () -> GitOperationScope = { testScope() }
    ): GitHostPorts {
        return object : GitHostPorts {
            override suspend fun <T> withMutationGuard(
                scope: GitOperationScope,
                impact: GitMutationImpact,
                paths: List<String>,
                dispatch: suspend () -> T,
            ): Result<T> {
                val bound = scopeGetter()
                if (scope.profileId != bound.profileId || scope.generation != bound.generation) {
                    return Result.failure(IllegalArgumentException("Scope generation/profile mismatch"))
                }
                return try {
                    Result.success(dispatch())
                } catch (e: Exception) {
                    Result.failure(e)
                }
            }

            override suspend fun preflightRemoval(
                scope: GitOperationScope,
                worktree: ProjectWorktree,
            ): WorktreeRemovalPrecheck = WorktreeRemovalPrecheck.Allowed

            override suspend fun requestWorktreeSwitch(
                scope: GitOperationScope,
                target: ProjectTargetRef,
            ): Result<Unit> = Result.success(Unit)

            override suspend fun openWorkspaceFile(
                scope: GitOperationScope,
                rootRelativePath: String,
            ): Result<Unit> = Result.success(Unit)

            override fun onMutationOutcome(event: GitMutationEvent) {}
            override fun refresh(reason: GitRefreshReason) {}
            override fun openRecoveryTerminal(scope: GitOperationScope) {}
        }
    }

    @Test
    fun testCherryPickSuccessAndFailure() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitHistoryActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/cherry-pick") { exchange ->
            val reqBody = exchange.requestBody.reader().readText()
            val json = if (reqBody.contains("c-good")) {
                """{"ok":true,"message":"Cherry-picked successfully"}"""
            } else {
                """{"ok":false,"conflict":true,"message":"Merge conflict in cherry-pick"}"""
            }
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        var successResult: GitActionResult? = null
        controller.cherryPick("c-good") { successResult = it }.join()
        assertNotNull(successResult)
        assertTrue(successResult!!.ok)

        var failResult: GitActionResult? = null
        controller.cherryPick("c-conflict") { failResult = it }.join()
        assertNotNull(failResult)
        assertFalse(failResult!!.ok)
        assertTrue(failResult!!.conflict)
        assertNotNull(failResult!!.recommendation)
        assertTrue(failResult!!.recommendation!!.contains("Resolve conflicts"))
    }

    @Test
    fun testCherryPickFilesSuccess() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitHistoryActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/commit/c1/cherry-pick-files") { exchange ->
            val json = """{"ok":true,"message":"Files cherry-picked"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        var result: GitActionResult? = null
        controller.cherryPickFiles("c1", listOf("fileA.kt")) { result = it }.join()
        assertNotNull(result)
        assertTrue(result!!.ok)
    }

    @Test
    fun testRevertAndRevertFiles() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitHistoryActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/commit/c1/revert") { exchange ->
            val json = """{"ok":true,"message":"Reverted"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/demo/commit/c1/revert-files") { exchange ->
            val json = """{"ok":true,"message":"Reverted files"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        var revertRes: GitActionResult? = null
        controller.revert("c1") { revertRes = it }.join()
        assertTrue(revertRes?.ok == true)

        var revertFilesRes: GitActionResult? = null
        controller.revertFiles("c1", listOf("fileA.kt")) { revertFilesRes = it }.join()
        assertTrue(revertFilesRes?.ok == true)
    }

    @Test
    fun testResetModes() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitHistoryActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        var requestedMode = ""
        server!!.createContext("/api/git/demo/reset") { exchange ->
            val reqBody = exchange.requestBody.reader().readText()
            if (reqBody.contains("hard")) requestedMode = "hard"
            else if (reqBody.contains("soft")) requestedMode = "soft"
            else requestedMode = "mixed"

            val json = """{"ok":true,"message":"Reset to commit"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.reset("c1", "hard") {}.join()
        assertEquals("hard", requestedMode)

        controller.reset("c1", "mixed") {}.join()
        assertEquals("mixed", requestedMode)
    }

    @Test
    fun testDropAndDropFiles() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitHistoryActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/commit/c1/drop") { exchange ->
            val json = """{"ok":true,"message":"Dropped"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/demo/commit/c1/drop-files") { exchange ->
            val json = """{"ok":true,"message":"Dropped files"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        var dropRes: GitActionResult? = null
        controller.drop("c1") { dropRes = it }.join()
        assertTrue(dropRes?.ok == true)

        var dropFilesRes: GitActionResult? = null
        controller.dropFiles("c1", listOf("fileA.kt")) { dropFilesRes = it }.join()
        assertTrue(dropFilesRes?.ok == true)
    }

    @Test
    fun testUndoLastCommit() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitHistoryActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/undo-last-commit") { exchange ->
            val json = """{"ok":true,"message":"Undone last commit"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        var undoRes: GitActionResult? = null
        controller.undoLastCommit { undoRes = it }.join()
        assertTrue(undoRes?.ok == true)
    }

    @Test
    fun testScopeMismatchRejectsAsyncCompletion() = runTest {
        val repo = createRepository()
        val scope1 = testScope("p1", 1L, "demo")
        val scope2 = testScope("p2", 2L, "demo")
        val controller = GitHistoryActionController(repo, this, createTestHost { scope1 })
        controller.updateScope(scope1)

        server!!.createContext("/api/git/demo/cherry-pick") { exchange ->
            // Simulate that while server processes, scope switches
            controller.updateScope(scope2)
            val json = """{"ok":true,"message":"Cherry-picked on old scope"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        var outcome: GitActionResult? = null
        val job = controller.cherryPick("c1") { outcome = it }
        job.join()

        assertNotNull(outcome)
        assertFalse(outcome!!.ok)
        assertTrue(outcome!!.message!!.contains("Scope changed"))
    }
}
