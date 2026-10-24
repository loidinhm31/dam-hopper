package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class GitHistoryAndBranchRepositoryTest {

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

    @Test
    fun testHistoryActionsQueryVsBodyRouting() = runTest {
        var undoQuery: String? = null
        var dropQuery: String? = null
        var cpBody: String? = null

        server!!.createContext("/api/git/test-proj/undo-last-commit") { exchange ->
            exchange.requestBody.readBytes()
            undoQuery = exchange.requestURI.query
            val json = """{"ok":true,"message":"Undid last commit","destructive":true,"dirty":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/commit/hash-1/drop") { exchange ->
            exchange.requestBody.readBytes()
            dropQuery = exchange.requestURI.query
            val json = """{"ok":true,"message":"Dropped commit"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/cherry-pick") { exchange ->
            cpBody = exchange.requestBody.readBytes().decodeToString()
            val json = """{"ok":true,"message":"Cherry-picked"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val undoRes = repo.history.undoLastCommit("test-proj", worktreePath = "/worktrees/wt-1")
        assertTrue(undoRes.ok)
        assertNotNull(undoQuery)
        assertTrue(undoQuery!!.contains("worktreePath="))

        val dropRes = repo.history.dropCommit("test-proj", "hash-1", worktreePath = "/worktrees/wt-1")
        assertTrue(dropRes.ok)
        assertNotNull(dropQuery)
        assertTrue(dropQuery!!.contains("worktreePath="))

        val cpRes = repo.history.cherryPick("test-proj", "hash-2", worktreePath = "/worktrees/wt-1")
        assertTrue(cpRes.ok)
        assertNotNull(cpBody)
        assertTrue(cpBody!!.contains("\"worktreePath\":\"/worktrees/wt-1\""))
    }

    @Test
    fun testBranchMutationWireContracts() = runTest {
        var deleteBody: String? = null
        var updateBody: String? = null

        server!!.createContext("/api/git/test-proj/branches") { exchange ->
            if (exchange.requestMethod == "DELETE") {
                deleteBody = exchange.requestBody.readBytes().decodeToString()
                val json = """{"ok":true,"message":"Deleted branch"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        server!!.createContext("/api/git/test-proj/branches/update") { exchange ->
            updateBody = exchange.requestBody.readBytes().decodeToString()
            val json = """{"branch":"main","success":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val delRes = repo.branchWorktree.deleteBranch("test-proj", DeleteBranchRequest(name = "old-feat", worktreePath = "/worktrees/wt-1"))
        assertTrue(delRes.ok)
        assertNotNull(deleteBody)
        assertTrue(deleteBody!!.contains("\"name\":\"old-feat\""))
        assertTrue(deleteBody!!.contains("\"worktreePath\":\"/worktrees/wt-1\""))

        val upRes = repo.branchWorktree.updateBranch("test-proj", UpdateBranchRequest(branch = "main", worktreePath = "/worktrees/wt-1"))
        assertTrue(upRes.success)
        assertNotNull(updateBody)
        assertTrue(updateBody!!.contains("\"branch\":\"main\""))
        assertTrue(updateBody!!.contains("\"worktreePath\":\"/worktrees/wt-1\""))
    }

    @Test
    fun testLeasedPushPrepareAndPublish() = runTest {
        server!!.createContext("/api/git/test-proj/push/prepare") { exchange ->
            exchange.requestBody.readBytes()
            val json = """{
                "status":"ready",
                "snapshot":{
                    "branch":"refs/heads/feature",
                    "sourceOid":"1111111111111111111111111111111111111111",
                    "remoteName":"origin",
                    "destinationRef":"refs/heads/feature",
                    "expectedRemoteOid":"2222222222222222222222222222222222222222"
                }
            }"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/push/publish") { exchange ->
            exchange.requestBody.readBytes()
            val json = """{"status":"stale-remote","message":"Remote changed concurrently"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val preview = repo.publish.prepareLeasedPush("test-proj", PrepareLeasedPushRequest(branch = "refs/heads/feature"))
        assertTrue(preview.isReady)

        val pubRes = repo.publish.publishLeasedPush("test-proj", PublishLeasedPushRequest(snapshot = preview.snapshot!!))
        assertFalse(pubRes.isPublished)
        assertTrue(pubRes.isStaleRemote)
        assertEquals("Remote changed concurrently", pubRes.message)
    }
    @Test
    fun testFetchAndPullWithExactServerWireJson() = runTest {
        var capturedFetchBody: String? = null
        server!!.createContext("/api/git/fetch") { exchange ->
            capturedFetchBody = exchange.requestBody.readBytes().decodeToString()
            val json = """[
                {
                    "projectName": "test-proj",
                    "operation": "fetch",
                    "success": true,
                    "summary": "Fetched origin/main",
                    "durationMs": 142,
                    "worktreePath": "/worktrees/wt-1",
                    "targetUnavailable": false
                }
            ]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val results = repo.mutation.fetch(targets = listOf(GitOpTarget("test-proj", "/worktrees/wt-1")))
        assertEquals(1, results.size)
        val res = results[0]
        assertEquals("test-proj", res.projectName)
        assertEquals("test-proj", res.project)
        assertTrue(res.success)
        assertEquals("Fetched origin/main", res.summary)
        assertEquals("Fetched origin/main", res.message)
        assertEquals("/worktrees/wt-1", res.worktreePath)
        assertNotNull(capturedFetchBody)
        assertTrue(capturedFetchBody!!.contains("\"project\":\"test-proj\""))
        assertTrue(capturedFetchBody!!.contains("\"worktreePath\":\"/worktrees/wt-1\""))
    }
}
