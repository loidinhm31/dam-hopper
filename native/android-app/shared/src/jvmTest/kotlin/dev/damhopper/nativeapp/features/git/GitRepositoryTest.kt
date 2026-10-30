package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class GitRepositoryTest {

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
    fun testListBranchesAndRoots() = runTest {
        server!!.createContext("/api/git/test-proj/branches") { exchange ->
            val json = """[{"name":"main","isCurrent":true,"isRemote":false,"trackingBranch":"origin/main"}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/roots") { exchange ->
            val json = """[{"rootId":".","path":".","kind":"primary"}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val branches = repo.listBranches("test-proj")
        assertEquals(1, branches.size)
        assertEquals("main", branches[0].name)
        assertTrue(branches[0].isCurrent)

        val roots = repo.listRoots("test-proj")
        assertEquals(1, roots.size)
        assertEquals("primary", roots[0].kind)
    }

    @Test
    fun testGetLogWithLiteralMessageQuery() = runTest {
        server!!.createContext("/api/git/test-proj/log") { exchange ->
            val query = exchange.requestURI.query ?: ""
            assertTrue(query.contains("messageQuery=feature"))
            val json = """[{"hash":"abc1234","authorName":"Dev","authorEmail":"dev@test.com","timestamp":1000,"message":"feature: new flow","isPushed":false}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val log = repo.getLog("test-proj", messageQuery = "feature")
        assertEquals(1, log.size)
        assertEquals("feature: new flow", log[0].message)
    }

    @Test
    fun testStagingAndCommitWithWorktreeTarget() = runTest {
        server!!.createContext("/api/git/test-proj/stage") { exchange ->
            val body = exchange.requestBody.readBytes().decodeToString()
            assertTrue(body.contains("\"worktreePath\":\"/worktrees/wt-1\""))
            assertTrue(body.contains("\"paths\":[\"src/main.kt\"]"))
            val json = """{"ok":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/commit") { exchange ->
            val body = exchange.requestBody.readBytes().decodeToString()
            assertTrue(body.contains("\"worktreePath\":\"/worktrees/wt-1\""))
            val json = """{"ok":true,"hash":"commit-hash-777"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val stageOk = repo.stage("test-proj", listOf("src/main.kt"), worktreePath = "/worktrees/wt-1")
        assertTrue(stageOk)

        val commitRes = repo.commit("test-proj", "feat: my commit", worktreePath = "/worktrees/wt-1")
        assertTrue(commitRes.ok)
        assertEquals("commit-hash-777", commitRes.hash)
    }

    @Test
    fun testGetDiffSummaryAndUntracked() = runTest {
        server!!.createContext("/api/git/test-proj/diff") { exchange ->
            val json = """{"entries":[{"path":"README.md","status":"modified","staged":false,"additions":1,"deletions":0}],"untrackedTruncated":false,"untrackedTotal":0}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/untracked") { exchange ->
            val json = """{"entries":[{"path":"new.txt","status":"added","staged":false,"additions":0,"deletions":0}],"untrackedTruncated":false,"untrackedTotal":1}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val diff = repo.getDiffSummary("test-proj")
        assertEquals(1, diff.entries.size)
        assertEquals("README.md", diff.entries[0].path)
        assertEquals(1, diff.entries[0].additions)

        val untracked = repo.getUntracked("test-proj")
        assertEquals(1, untracked.entries.size)
        assertEquals("new.txt", untracked.entries[0].path)
        assertEquals(1, untracked.untrackedTotal)
    }

    @Test
    fun testGetConflictsAndOperation() = runTest {
        server!!.createContext("/api/git/test-proj/conflicts") { exchange ->
            val json = """{"targetRevision":"rev-1","entries":[{"conflictId":"c1","path":"conflict.txt","status":"bothModified","isBinary":false}],"truncated":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/git/test-proj/operation") { exchange ->
            val json = """{"operation":"merge","canContinue":false,"canAbort":true,"operationFingerprint":"op1","fullIndexFingerprint":"idx1","blockers":["conflict"]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val conflicts = repo.getConflicts("test-proj")
        assertEquals("rev-1", conflicts.targetRevision)
        assertEquals("c1", conflicts.entries[0].conflictId)

        val op = repo.getOperation("test-proj")
        assertEquals("merge", op.operation)
        assertTrue(op.canAbort)
        assertFalse(op.canContinue)
    }

    @Test
    fun testGitNotInitialized409Propagates() = runTest {
        server!!.createContext("/api/git/non-git-proj/branches") { exchange ->
            val json = """{"error":"Git is not initialized for this project","code":"GIT_NOT_INITIALIZED"}"""
            exchange.sendResponseHeaders(409, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val err = assertFailsWith<ApiRequestError> {
            repo.listBranches("non-git-proj")
        }
        assertEquals(409, err.status)
        assertEquals("GIT_NOT_INITIALIZED", err.code)
    }
}
