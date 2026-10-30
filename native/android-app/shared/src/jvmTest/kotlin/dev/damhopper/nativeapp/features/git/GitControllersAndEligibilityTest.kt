package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class GitControllersAndEligibilityTest {

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

    private fun testScope(profileId: String, generation: Long, project: String, worktreePath: String? = null, root: String? = null): GitOperationScope {
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "test-user",
            project = project,
            worktreePath = worktreePath,
        )
        return GitOperationScope(owner, generation, root)
    }

    private fun createTestHost(
        isDirty: () -> Boolean = { false },
        hasTerm: () -> Boolean = { false },
    ): GitHostPorts {
        return object : GitHostPorts {
            override suspend fun <T> withMutationGuard(
                scope: GitOperationScope,
                impact: GitMutationImpact,
                paths: List<String>,
                dispatch: suspend () -> T,
            ): Result<T> = try {
                Result.success(dispatch())
            } catch (e: Exception) {
                Result.failure(e)
            }

            override suspend fun preflightRemoval(
                scope: GitOperationScope,
                worktree: ProjectWorktree,
            ): WorktreeRemovalPrecheck {
                if (worktree.isMain) return WorktreeRemovalPrecheck.Blocked(listOf("Cannot remove the primary/main worktree."))
                val blockers = mutableListOf<String>()
                if (isDirty()) blockers.add("unsaved editor tabs")
                if (hasTerm()) blockers.add("active terminal sessions")
                return if (blockers.isEmpty()) WorktreeRemovalPrecheck.Allowed else WorktreeRemovalPrecheck.Blocked(blockers)
            }

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
    fun testHistoryControllerEligibilityAndBranchSelection() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)

        val scope = testScope("profile-1", 1L, "demo")

        val mainBranch = GitBranch("main", isCurrent = true, isRemote = false)
        val featureBranch = GitBranch("feature/x", isCurrent = false, isRemote = false)
        val remoteBranch = GitBranch("origin/main", isCurrent = false, isRemote = true)

        // 1. Viewing active local branch
        controller.updateScope(scope, viewed = mainBranch, active = mainBranch)
        assertTrue(controller.isViewingLocalBranch)
        assertTrue(controller.isViewingActiveBranch)

        // 2. Viewing inactive local branch via selectViewedBranch
        server!!.createContext("/api/git/demo/log") { exchange ->
            val json = """[]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        controller.selectViewedBranch(featureBranch)
        assertTrue(controller.isViewingLocalBranch)
        assertFalse(controller.isViewingActiveBranch)

        // 3. Viewing remote branch
        controller.selectViewedBranch(remoteBranch)
        assertFalse(controller.isViewingLocalBranch)
        assertFalse(controller.isViewingActiveBranch)
    }

    @Test
    fun testWorktreeRemovalPrechecks() = runTest {
        val repo = createRepository()
        var isDirty = false
        var hasTerm = false

        val controller = WorktreeMutationController(
            repository = repo,
            coroutineScope = this,
            host = createTestHost({ isDirty }, { hasTerm }),
        )
        val scope = testScope("prof-1", 1L, "proj-1")
        controller.updateScope(scope)

        val mainWorktree = ProjectWorktree(path = "/root", repositoryPath = "/root", branch = "main", commitHash = "c1", isMain = true)
        val featWorktree = ProjectWorktree(path = "/wt-feat", repositoryPath = "/root", branch = "feat", commitHash = "c2", isMain = false)

        // Main worktree cannot be removed
        val mainCheck = controller.validateRemovalPrecheck(mainWorktree)
        assertTrue(mainCheck is WorktreeRemovalPrecheck.Blocked)

        // Clean secondary worktree allowed
        isDirty = false
        hasTerm = false
        val cleanCheck = controller.validateRemovalPrecheck(featWorktree)
        assertTrue(cleanCheck is WorktreeRemovalPrecheck.Allowed)

        // Dirty tabs block removal
        isDirty = true
        val dirtyCheck = controller.validateRemovalPrecheck(featWorktree)
        assertTrue(dirtyCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue((dirtyCheck as WorktreeRemovalPrecheck.Blocked).reasons.any { it.contains("unsaved editor tabs") })

        // Live terminal sessions block removal
        isDirty = false
        hasTerm = true
        val termCheck = controller.validateRemovalPrecheck(featWorktree)
        assertTrue(termCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue((termCheck as WorktreeRemovalPrecheck.Blocked).reasons.any { it.contains("active terminal sessions") })
    }

    @Test
    fun testSquashContiguousRequirement() = runTest {
        val repo = createRepository()
        val controller = GitRewriteActionController(repo, this, createTestHost())
        val scope = testScope("prof-1", 1L, "proj-1")
        controller.updateScope(scope)

        server!!.createContext("/api/git/proj-1/commit/hash-1/message") { exchange ->
            val json = """{"message":"old msg","branch":"refs/heads/feat","headOid":"head-oid"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val loadJob = controller.loadMessageSnapshot("hash-1", "refs/heads/feat", {}, {})
        loadJob.join()

        // Squash with < 2 commits must be rejected
        var failResult: GitActionResult? = null
        val squashJob = controller.squashCommits(listOf("hash-1"), "combined") { res ->
            failResult = res
        }
        squashJob.join()
        assertNotNull(failResult)
        assertFalse(failResult!!.ok)
        assertTrue(failResult!!.message!!.contains("at least 2 contiguous commits"))
    }

    @Test
    fun testLeasedPublishPreviewMismatch() = runTest {
        val repo = createRepository()
        val controller = LeasedPublishController(repo, this, createTestHost())
        val scope = testScope("prof-1", 1L, "proj-1")
        controller.updateScope(scope)

        // Server returns preview with different branch than requested
        server!!.createContext("/api/git/proj-1/push/prepare") { exchange ->
            val json = """{
                "status":"ready",
                "snapshot":{
                    "branch":"refs/heads/other-branch",
                    "sourceOid":"oid-other",
                    "remoteName":"origin",
                    "destinationRef":"refs/heads/other-branch",
                    "expectedRemoteOid":"remote-oid"
                }
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val receipt = RewriteReceipt(
            branch = "refs/heads/expected-branch",
            sourceOid = "oid-expected",
            oldHeadOid = "oid-old",
            targetOid = "oid-expected",
            rewrittenCount = 1,
            scope = scope,
        )
        val prepJob = controller.prepareWithReceipt(receipt)
        prepJob.join()

        val state = controller.state.value
        assertTrue(state is LeasedPublishState.Blocked)
        assertTrue((state as LeasedPublishState.Blocked).reason.contains("Prepared snapshot mismatch"))
    }
}
