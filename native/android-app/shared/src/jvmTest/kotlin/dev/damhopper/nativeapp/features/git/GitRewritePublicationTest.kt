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
class GitRewritePublicationTest {

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
    fun testPrepareWithReceiptScopeMismatchFails() = runTest {
        val repo = createRepository()
        val scope1 = testScope("p1", 1L, "demo1")
        val scope2 = testScope("p2", 2L, "demo2")
        val controller = LeasedPublishController(repo, this, createTestHost { scope1 })
        controller.updateScope(scope1)

        val receipt = RewriteReceipt(
            branch = "refs/heads/feature",
            sourceOid = "new-tip",
            oldHeadOid = "old-head",
            targetOid = "target",
            rewrittenCount = 2,
            scope = scope2, // mismatching scope!
        )

        val job = controller.prepareWithReceipt(receipt)
        job.join()

        val state = controller.state.value
        assertTrue(state is LeasedPublishState.Error)
        assertTrue((state as LeasedPublishState.Error).message.contains("does not match active operation scope"))
    }

    @Test
    fun testPrepareWithReceiptSuccessTransitionsToReady() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = LeasedPublishController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/push/prepare") { exchange ->
            val json = """{
                "status":"ready",
                "snapshot":{
                    "branch":"refs/heads/feature",
                    "sourceOid":"new-tip",
                    "remoteName":"origin",
                    "destinationRef":"refs/heads/feature",
                    "expectedRemoteOid":"remote-tip"
                }
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val receipt = RewriteReceipt(
            branch = "refs/heads/feature",
            sourceOid = "new-tip",
            oldHeadOid = "old-head",
            targetOid = "target",
            rewrittenCount = 1,
            scope = scope,
        )

        controller.prepareWithReceipt(receipt).join()

        val state = controller.state.value
        assertTrue(state is LeasedPublishState.Ready)
        val ready = state as LeasedPublishState.Ready
        assertEquals("refs/heads/feature", ready.preview.snapshot?.branch)
        assertEquals("new-tip", ready.preview.snapshot?.sourceOid)
    }

    @Test
    fun testConfirmPublishSuccess() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = LeasedPublishController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/push/prepare") { exchange ->
            val json = """{
                "status":"ready",
                "snapshot":{
                    "branch":"refs/heads/feature",
                    "sourceOid":"new-tip",
                    "remoteName":"origin",
                    "destinationRef":"refs/heads/feature",
                    "expectedRemoteOid":"remote-tip"
                }
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        server!!.createContext("/api/git/demo/push/publish") { exchange ->
            val json = """{
                "status":"published",
                "message":"Successfully pushed to origin"
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val receipt = RewriteReceipt(
            branch = "refs/heads/feature",
            sourceOid = "new-tip",
            oldHeadOid = "old-head",
            targetOid = "target",
            rewrittenCount = 1,
            scope = scope,
        )

        controller.prepareWithReceipt(receipt).join()
        assertTrue(controller.state.value is LeasedPublishState.Ready)

        var publishResult: PublishResult? = null
        controller.confirmPublish { publishResult = it }.join()

        assertNotNull(publishResult)
        assertTrue(publishResult!!.isPublished)
        assertTrue(controller.state.value is LeasedPublishState.Success)
    }

    @Test
    fun testConfirmPublishStaleRemoteTransitionsToBlocked() = runTest {
        val repo = createRepository()
        val scope = testScope()
        val controller = LeasedPublishController(repo, this, createTestHost { scope })
        controller.updateScope(scope)

        server!!.createContext("/api/git/demo/push/prepare") { exchange ->
            val json = """{
                "status":"ready",
                "snapshot":{
                    "branch":"refs/heads/feature",
                    "sourceOid":"new-tip",
                    "remoteName":"origin",
                    "destinationRef":"refs/heads/feature",
                    "expectedRemoteOid":"remote-tip"
                }
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        server!!.createContext("/api/git/demo/push/publish") { exchange ->
            val json = """{
                "status":"stale-remote",
                "message":"Remote reference advanced concurrently"
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val receipt = RewriteReceipt(
            branch = "refs/heads/feature",
            sourceOid = "new-tip",
            oldHeadOid = "old-head",
            targetOid = "target",
            rewrittenCount = 1,
            scope = scope,
        )

        controller.prepareWithReceipt(receipt).join()

        var publishResult: PublishResult? = null
        controller.confirmPublish { publishResult = it }.join()

        assertNotNull(publishResult)
        assertFalse(publishResult!!.isPublished)
        assertTrue(publishResult!!.isStaleRemote)
        assertTrue(controller.state.value is LeasedPublishState.Blocked)
        val blocked = controller.state.value as LeasedPublishState.Blocked
        assertTrue(blocked.reason.contains("stale remote"))
    }
}
