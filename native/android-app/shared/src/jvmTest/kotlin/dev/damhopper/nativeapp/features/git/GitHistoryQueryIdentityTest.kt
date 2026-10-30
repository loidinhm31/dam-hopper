package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class GitHistoryQueryIdentityTest {

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

    private fun testScope(
        profileId: String = "profile-1",
        generation: Long = 10L,
        project: String = "demo",
        worktreePath: String? = null,
        root: String? = "sub-root",
    ): GitOperationScope {
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "test-user",
            project = project,
            worktreePath = worktreePath,
        )
        return GitOperationScope(owner, generation, root)
    }

    @Test
    fun testRequestIdentityCaptureAndSequenceAdvancement() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope(generation = 42L, root = "src/core")

        server!!.createContext("/api/git/demo/log") { exchange ->
            val json = """[
                {"hash":"c1","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"init","refs":[],"isPushed":false}
            ]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val branch = GitBranch("feature/query", isCurrent = true, isRemote = false)
        controller.updateScope(scope, viewed = branch, active = branch)
        val job = controller.loadHistory(resetOffset = true)
        job.join()

        val identity = controller.lastRequestIdentity
        assertNotNull(identity)
        assertEquals(scope.owner, identity.owner)
        assertEquals(42L, identity.generation)
        assertEquals("src/core", identity.root)
        assertEquals("refs/heads/feature/query", identity.ref)
        assertEquals("", identity.search)
        assertEquals(0, identity.offset)
        assertEquals(2L, identity.sequence) // 1 from updateScope reset, 2 from explicit loadHistory
    }

    @Test
    fun testCanonicalBranchRefDisambiguation() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope()

        val localMain = GitBranch("main", isCurrent = true, isRemote = false)
        val remoteMain = GitBranch("main", isCurrent = false, isRemote = true)

        controller.updateScope(scope, viewed = remoteMain, active = localMain)
        assertFalse(controller.isViewingLocalBranch)
        // remoteMain fullRef is refs/remotes/main, localMain is refs/heads/main: must not collide
        assertFalse(controller.isViewingActiveBranch)
    }

    @Test
    fun testRawOffsetTrackingAndDeduplication() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope()

        val requestOffsets = mutableListOf<Int>()
        server!!.createContext("/api/git/demo/log") { exchange ->
            val query = exchange.requestURI.query ?: ""
            val offsetParam = query.split("&").find { it.startsWith("offset=") }?.substringAfter("offset=")?.toIntOrNull() ?: 0
            val limitParam = query.split("&").find { it.startsWith("limit=") }?.substringAfter("limit=")?.toIntOrNull() ?: 100
            requestOffsets.add(offsetParam)

            val json = if (offsetParam == 0 && limitParam == 1) {
                // Tip check
                """[{"hash":"c1","parents":["c2"],"authorName":"A","authorEmail":"a@x","timestamp":300,"message":"tip","refs":[],"isPushed":false}]"""
            } else if (offsetParam == 0) {
                // Page 1: returns c1 and c2
                """[
                    {"hash":"c1","parents":["c2"],"authorName":"A","authorEmail":"a@x","timestamp":300,"message":"c1","refs":[],"isPushed":false},
                    {"hash":"c2","parents":["c3"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"c2","refs":[],"isPushed":false}
                ]"""
            } else {
                // Page 2: returns c2 (overlap) and c3
                """[
                    {"hash":"c2","parents":["c3"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"c2","refs":[],"isPushed":false},
                    {"hash":"c3","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"c3","refs":[],"isPushed":false}
                ]"""
            }
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.updateScope(scope, viewed = GitBranch("main", isCurrent = true), active = GitBranch("main", isCurrent = true))
        controller.loadHistory(resetOffset = true).join()
        assertEquals(2, controller.entries.value.size)

        // Append next page
        controller.loadHistory(resetOffset = false).join()

        // raw offset requested for page 2 was 2 (actual returned count from page 1)
        assertTrue(requestOffsets.contains(2))
        // Dedup: c2 was returned in page 2 but already in dataset, total distinct entries = 3 (c1, c2, c3)
        assertEquals(listOf("c1", "c2", "c3"), controller.entries.value.map { it.hash })
    }

    @Test
    fun testBoundedTipCheckResetsDatasetWhenTipChanges() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope()

        val callCount = AtomicInteger(0)
        server!!.createContext("/api/git/demo/log") { exchange ->
            val count = callCount.incrementAndGet()
            val query = exchange.requestURI.query ?: ""
            val limit = query.split("&").find { it.startsWith("limit=") }?.substringAfter("limit=")?.toIntOrNull() ?: 100

            val json = when {
                count == 1 -> {
                    // Initial load page 1: tip is c1
                    """[{"hash":"c1","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"c1","refs":[],"isPushed":false}]"""
                }
                limit == 1 -> {
                    // Bounded tip check: observed tip is NEW commit cNew!
                    """[{"hash":"cNew","parents":["c1"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"cNew","refs":[],"isPushed":false}]"""
                }
                else -> {
                    // Reset reload from offset 0
                    """[
                        {"hash":"cNew","parents":["c1"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"cNew","refs":[],"isPushed":false},
                        {"hash":"c1","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"c1","refs":[],"isPushed":false}
                    ]"""
                }
            }
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.updateScope(scope, viewed = GitBranch("main", isCurrent = true), active = GitBranch("main", isCurrent = true))
        controller.loadHistory(resetOffset = true).join()
        assertEquals(1, controller.entries.value.size)
        assertEquals("c1", controller.entries.value.first().hash)

        // Attempt page append; tip check will observe cNew and reset dataset
        controller.loadHistory(resetOffset = false).join()
        assertEquals(2, controller.entries.value.size)
        assertEquals(listOf("cNew", "c1"), controller.entries.value.map { it.hash })
    }

    @Test
    fun testSearchDebounceAndSquashDisabling() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope()

        server!!.createContext("/api/git/demo/log") { exchange ->
            val json = """[
                {"hash":"c1","parents":["c0"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"feat: search","refs":[],"isPushed":false},
                {"hash":"c0","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"init","refs":[],"isPushed":false}
            ]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.updateScope(scope, viewed = GitBranch("main", isCurrent = true), active = GitBranch("main", isCurrent = true))
        controller.loadHistory(resetOffset = true).join()

        controller.toggleCommitSelection("c0")
        controller.toggleCommitSelection("c1")
        assertEquals(listOf("c0", "c1"), controller.getSelectedCommitsOldestFirst())

        // Active search disables squash immediately and clears selection
        controller.setSearchQuery("feat")
        assertEquals(emptyList(), controller.selectedCommitHashes.value)
        assertNull(controller.getSelectedCommitsOldestFirst())

        advanceTimeBy(350)
        assertNull(controller.getSelectedCommitsOldestFirst())
    }

    @Test
    fun testSelectedCommitsOldestFirstDAGChain() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope()

        server!!.createContext("/api/git/demo/log") { exchange ->
            val json = """[
                {"hash":"c4","parents":["c3"],"authorName":"A","authorEmail":"a@x","timestamp":400,"message":"c4","refs":[],"isPushed":false},
                {"hash":"c3","parents":["c2"],"authorName":"A","authorEmail":"a@x","timestamp":300,"message":"c3","refs":[],"isPushed":false},
                {"hash":"c2","parents":["c1"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"c2","refs":[],"isPushed":false},
                {"hash":"c1","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"c1","refs":[],"isPushed":false},
                {"hash":"m1","parents":["c2","c3"],"authorName":"A","authorEmail":"a@x","timestamp":350,"message":"merge","refs":[],"isPushed":false},
                {"hash":"forkA","parents":["c2"],"authorName":"A","authorEmail":"a@x","timestamp":250,"message":"forkA","refs":[],"isPushed":false},
                {"hash":"forkB","parents":["c2"],"authorName":"A","authorEmail":"a@x","timestamp":250,"message":"forkB","refs":[],"isPushed":false}
            ]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.updateScope(scope, viewed = GitBranch("main", isCurrent = true), active = GitBranch("main", isCurrent = true))
        controller.loadHistory(resetOffset = true).join()

        // 1. Valid linear chain c2, c3, c4 selected in arbitrary order
        controller.clearSelection()
        controller.toggleCommitSelection("c3")
        controller.toggleCommitSelection("c4")
        controller.toggleCommitSelection("c2")
        assertEquals(listOf("c2", "c3", "c4"), controller.getSelectedCommitsOldestFirst())

        // 2. Linear chain down to root commit c1
        controller.clearSelection()
        controller.toggleCommitSelection("c2")
        controller.toggleCommitSelection("c1")
        assertEquals(listOf("c1", "c2"), controller.getSelectedCommitsOldestFirst())

        // 3. Gap: c2 and c4 selected, c3 missing
        controller.clearSelection()
        controller.toggleCommitSelection("c2")
        controller.toggleCommitSelection("c4")
        assertNull(controller.getSelectedCommitsOldestFirst())

        // 4. Merge: m1 has 2 parents
        controller.clearSelection()
        controller.toggleCommitSelection("m1")
        controller.toggleCommitSelection("c2")
        assertNull(controller.getSelectedCommitsOldestFirst())

        // 5. Fork: c2 is parent of both forkA and forkB, both selected
        controller.clearSelection()
        controller.toggleCommitSelection("c2")
        controller.toggleCommitSelection("forkA")
        controller.toggleCommitSelection("forkB")
        assertNull(controller.getSelectedCommitsOldestFirst())
    }

    @Test
    fun nonTopologicalChainConsumerSmoke() = runTest {
        val repo = createRepository()
        val controller = GitHistoryController(repo, this)
        val scope = testScope()

        // Server returns commits in non-topological/shuffled order
        server!!.createContext("/api/git/demo/log") { exchange ->
            val json = """[
                {"hash":"c1","parents":[],"authorName":"A","authorEmail":"a@x","timestamp":100,"message":"init","refs":[],"isPushed":false},
                {"hash":"c3","parents":["c2"],"authorName":"A","authorEmail":"a@x","timestamp":300,"message":"step 2","refs":[],"isPushed":false},
                {"hash":"c2","parents":["c1"],"authorName":"A","authorEmail":"a@x","timestamp":200,"message":"step 1","refs":[],"isPushed":false}
            ]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        controller.updateScope(scope, viewed = GitBranch("main", isCurrent = true), active = GitBranch("main", isCurrent = true))
        controller.loadHistory(resetOffset = true).join()

        // Select c1, c2, c3
        controller.toggleCommitSelection("c1")
        controller.toggleCommitSelection("c3")
        controller.toggleCommitSelection("c2")

        // DAG chain must correctly assemble oldest-first [c1, c2, c3] regardless of log array order
        val chain = controller.getSelectedCommitsOldestFirst()
        assertEquals(listOf("c1", "c2", "c3"), chain)
    }
}
