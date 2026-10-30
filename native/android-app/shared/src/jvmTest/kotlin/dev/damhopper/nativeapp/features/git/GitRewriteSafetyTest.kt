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
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class GitRewriteSafetyTest {

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
    fun testEditMessageProducesRewriteReceiptOnSuccess() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitRewriteActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        // Mock GET and POST commit message
        server!!.createContext("/api/git/demo/commit/c1/message") { exchange ->
            if (exchange.requestMethod == "GET") {
                val json = """{"message":"original message\n","branch":"refs/heads/feature","headOid":"head-1"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                exchange.requestBody.readBytes()
                val json = """{
                    "ok":true,
                    "branch":"refs/heads/feature",
                    "oldHeadOid":"head-1",
                    "newHeadOid":"head-2",
                    "newTargetOid":"target-2",
                    "rewrittenCount":1,
                    "noOp":false
                }"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        controller.loadMessageSnapshot("c1", branch = "refs/heads/feature", onLoaded = {}, onError = {}).join()
        assertNotNull(controller.frozenMessageSnapshot.value)

        var actionResult: GitActionResult? = null
        controller.editCommitMessage("c1", "new message") { actionResult = it }.join()
        assertNotNull(actionResult)
        assertTrue(actionResult!!.ok)

        val receipt = controller.lastRewriteReceipt.value
        assertNotNull(receipt)
        assertEquals("refs/heads/feature", receipt.branch)
        assertEquals("head-2", receipt.sourceOid)
        assertEquals("head-1", receipt.oldHeadOid)
        assertEquals("target-2", receipt.targetOid)
        assertEquals(1, receipt.rewrittenCount)
        assertEquals(scope, receipt.scope)
    }

    @Test
    fun testEditMessageNoOpEmitsNoReceipt() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitRewriteActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/commit/c1/message") { exchange ->
            if (exchange.requestMethod == "GET") {
                val json = """{"message":"unchanged\n","branch":"refs/heads/main","headOid":"head-1"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                exchange.requestBody.readBytes()
                val json = """{
                    "ok":true,
                    "branch":"refs/heads/main",
                    "oldHeadOid":"head-1",
                    "newHeadOid":"head-1",
                    "newTargetOid":"target-1",
                    "rewrittenCount":0,
                    "noOp":true
                }"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        controller.loadMessageSnapshot("c1", branch = "refs/heads/main", onLoaded = {}, onError = {}).join()
        controller.editCommitMessage("c1", "unchanged") {}.join()

        assertNull(controller.lastRewriteReceipt.value)
    }

    @Test
    fun testEditMessagePublicationUncertainClearsReceiptAndSnapshot() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitRewriteActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/commit/c1/message") { exchange ->
            if (exchange.requestMethod == "GET") {
                val json = """{"message":"test\n","branch":"refs/heads/main","headOid":"head-1"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                exchange.requestBody.readBytes()
                val json = """{
                    "ok":false,
                    "blockedReason":"publication-uncertain",
                    "message":"Local transaction commit uncertainty"
                }"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        controller.loadMessageSnapshot("c1", branch = "refs/heads/main", onLoaded = {}, onError = {}).join()
        controller.editCommitMessage("c1", "updated") {}.join()

        assertNull(controller.frozenMessageSnapshot.value)
        assertNull(controller.lastRewriteReceipt.value)
    }

    @Test
    fun testSquashCommitsProducesReceiptWithExactCounts() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = GitRewriteActionController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/commit/c1/message") { exchange ->
            val json = """{"message":"base\n","branch":"refs/heads/main","headOid":"head-1"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        server!!.createContext("/api/git/demo/squash") { exchange ->
            exchange.requestBody.readBytes()
            val json = """{
                "ok":true,
                "branch":"refs/heads/main",
                "oldHeadOid":"head-1",
                "newHeadOid":"head-squashed",
                "newTargetOid":"target-squashed",
                "rewrittenCount":3,
                "noOp":false
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.loadMessageSnapshot("c1", branch = "refs/heads/main", onLoaded = {}, onError = {}).join()

        var outcome: GitActionResult? = null
        controller.squashCommits(listOf("c1", "c2", "c3"), "combined message") { outcome = it }.join()

        assertNotNull(outcome)
        assertTrue(outcome!!.ok)

        val receipt = controller.lastRewriteReceipt.value
        assertNotNull(receipt)
        assertEquals("refs/heads/main", receipt.branch)
        assertEquals("head-squashed", receipt.sourceOid)
        assertEquals("head-1", receipt.oldHeadOid)
        assertEquals("target-squashed", receipt.targetOid)
        assertEquals(3, receipt.rewrittenCount)
        assertEquals(scope, receipt.scope)
    }

    @Test
    fun testScopeSwitchClearsReceiptAndSnapshot() = runTest {
        val repo = createRepository()
        val scope1 = testScope("p1", 1L, "demo1")
        val scope2 = testScope("p2", 2L, "demo2")
        val controller = GitRewriteActionController(repo, this, createTestHost { scope1 })
        controller.updateScope(scope1)

        server!!.createContext("/api/git/demo1/commit/c1/message") { exchange ->
            val json = """{"message":"msg\n","branch":"refs/heads/b","headOid":"h1"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.loadMessageSnapshot("c1", branch = "refs/heads/b", onLoaded = {}, onError = {}).join()
        assertNotNull(controller.frozenMessageSnapshot.value)

        // Switch scope
        controller.updateScope(scope2)
        assertNull(controller.frozenMessageSnapshot.value)
        assertNull(controller.lastRewriteReceipt.value)
    }

    @Test
    fun testScopeSwitchDuringRewriteFailsClosed() = runTest {
        val repo = createRepository()
        val scope1 = testScope("p1", 1L, "demo1")
        val scope2 = testScope("p2", 2L, "demo2")
        val controller = GitRewriteActionController(repo, this, createTestHost { scope1 })
        controller.updateScope(scope1)

        server!!.createContext("/api/git/demo1/commit/c1/message") { exchange ->
            if (exchange.requestMethod == "GET") {
                val json = """{"message":"msg\n","branch":"refs/heads/b","headOid":"h1"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                // Switch scope while rewrite is in-flight
                controller.updateScope(scope2)
                exchange.requestBody.readBytes()
                val json = """{"ok":true,"branch":"refs/heads/b","oldHeadOid":"h1","newHeadOid":"h2","newTargetOid":"t2","rewrittenCount":1,"noOp":false}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        controller.loadMessageSnapshot("c1", branch = "refs/heads/b", onLoaded = {}, onError = {}).join()

        var outcome: GitActionResult? = null
        controller.editCommitMessage("c1", "new msg") { outcome = it }.join()

        assertNotNull(outcome)
        assertFalse(outcome!!.ok)
        assertTrue(outcome!!.message!!.contains("Scope changed"))
        assertNull(controller.lastRewriteReceipt.value)
    }
}
