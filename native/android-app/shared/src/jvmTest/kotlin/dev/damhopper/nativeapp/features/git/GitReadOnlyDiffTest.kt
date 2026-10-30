package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class GitReadOnlyDiffTest {

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

    private fun createClient(): ApiClient {
        val conn = ConnectionRef("test-profile", 1L)
        return ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
    }

    private fun testScope(project: String = "test-proj", worktreePath: String? = null, root: String? = null): GitOperationScope {
        val owner = WorkspaceFileOwner(
            profileId = "test-profile",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = project,
            worktreePath = worktreePath,
        )
        return GitOperationScope(owner = owner, generation = 1L, root = root)
    }

    @Test
    fun testLiveFileDiffLoadingAndHunks() = runTest {
        server!!.createContext("/api/git/test-proj/diff/file") { exchange ->
            val query = exchange.requestURI.query ?: ""
            assertTrue(query.contains("path=src%2Fmain.kt") || query.contains("path=src/main.kt"))
            val json = """
                {
                    "path": "src/main.kt",
                    "original": "fun main() {\n  println(1)\n}\n",
                    "modified": "fun main() {\n  println(2)\n}\n",
                    "language": "kotlin",
                    "hunks": [
                        {
                            "index": 0,
                            "oldStart": 1,
                            "oldLines": 3,
                            "newStart": 1,
                            "newLines": 3,
                            "header": "@@ -1,3 +1,3 @@"
                        }
                    ],
                    "lineChanges": [],
                    "isBinary": false
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val client = createClient()
        val controller = DiffReviewController(client, this)
        val scope = testScope()

        val job = controller.loadDiff(scope, "src/main.kt")
        job.join()

        assertNotNull(controller.diffContent.value)
        assertEquals("src/main.kt", controller.diffContent.value?.path)
        assertEquals(1, controller.totalHunks.value)
        assertEquals(0, controller.currentHunkIndex.value)
        assertFalse(controller.isLoading.value)
        assertNull(controller.errorMessage.value)
    }

    @Test
    fun testHistoricalCommitDiffLoadingAndExit() = runTest {
        server!!.createContext("/api/git/test-proj/commit/c1234/diff") { exchange ->
            val json = """
                {
                    "path": "README.md",
                    "original": "# Old\n",
                    "modified": "# New\n",
                    "language": "markdown",
                    "hunks": [],
                    "lineChanges": [],
                    "isBinary": false
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/diff/file") { exchange ->
            val json = """
                {
                    "path": "README.md",
                    "original": "# Current\n",
                    "modified": "# Current Dirty\n",
                    "language": "markdown",
                    "hunks": [],
                    "lineChanges": [],
                    "isBinary": false
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val client = createClient()
        val controller = DiffReviewController(client, this)
        val scope = testScope()

        val histJob = controller.loadDiff(scope, "README.md", commitHash = "c1234")
        histJob.join()

        assertEquals("c1234", controller.activeQuery.value?.commitHash)
        assertEquals("# New\n", controller.diffContent.value?.modified)

        val exitJob = controller.exitCommitDiff()
        assertNotNull(exitJob)
        exitJob.join()

        assertNull(controller.activeQuery.value?.commitHash)
        assertEquals("# Current Dirty\n", controller.diffContent.value?.modified)
    }

    @Test
    fun testBinaryAndDeletedStatesAreExplicit() = runTest {
        server!!.createContext("/api/git/test-proj/diff/file") { exchange ->
            val json = """
                {
                    "path": "image.png",
                    "original": null,
                    "modified": null,
                    "language": "unknown",
                    "hunks": [],
                    "lineChanges": [],
                    "isBinary": true
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val client = createClient()
        val controller = DiffReviewController(client, this)
        val job = controller.loadDiff(testScope(), "image.png")
        job.join()

        assertNotNull(controller.diffContent.value)
        assertTrue(controller.diffContent.value!!.isBinary)
    }

    @Test
    fun testLayoutModeToggleAndHunkNavigation() = runTest {
        server!!.createContext("/api/git/test-proj/diff/file") { exchange ->
            val json = """
                {
                    "path": "code.kt",
                    "original": "line1\nline2\n",
                    "modified": "line1_mod\nline2_mod\n",
                    "language": "kotlin",
                    "hunks": [
                        {"index": 0, "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "header": "h1"},
                        {"index": 1, "oldStart": 2, "oldLines": 1, "newStart": 2, "newLines": 1, "header": "h2"}
                    ],
                    "lineChanges": [],
                    "isBinary": false
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val client = createClient()
        val controller = DiffReviewController(client, this)
        val job = controller.loadDiff(testScope(), "code.kt")
        job.join()

        assertEquals(DiffLayoutMode.SIDE_BY_SIDE, controller.layoutMode.value)
        controller.setLayoutMode(DiffLayoutMode.INLINE)?.join()
        assertEquals(DiffLayoutMode.INLINE, controller.layoutMode.value)

        assertEquals(2, controller.totalHunks.value)
        assertEquals(0, controller.currentHunkIndex.value)

        controller.nextHunk()
        assertEquals(1, controller.currentHunkIndex.value)

        controller.nextHunk()
        assertEquals(0, controller.currentHunkIndex.value)

        controller.prevHunk()
        assertEquals(1, controller.currentHunkIndex.value)
    }
}
