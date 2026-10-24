package dev.damhopper.nativeapp.features.editor

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.files.FileRepository
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class EditorRepositoryTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server!!.executor = java.util.concurrent.Executors.newCachedThreadPool()
        serverPort = server!!.address.port
        server!!.start()
    }
    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createEditorRepository(project: String = "demo"): EditorRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val owner = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
            profileId = "test-profile",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = project,
        )
        val fileRepo = FileRepository(owner, client, ws)
        return EditorRepository(fileRepo, profileId = "test-profile")
    }

    @Test
    fun testLoadNormalFile() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":500,"mtime":1710000000,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val content = "console.log('hello');\n"
            exchange.sendResponseHeaders(200, content.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(content.toByteArray()) }
        }

        val repo = createEditorRepository()
        val target = ProjectTargetRef(project = "demo")
        val result = repo.loadFile(target, "main.ts")

        assertTrue(result is EditorLoadResult.Success)
        assertEquals("console.log('hello');\n", result.content)
        assertEquals(FileTier.NORMAL, result.tier)
        assertEquals(500L, result.size)
        assertEquals(1710000000L, result.mtime)
    }

    @Test
    fun testLoadLargeFileTriggersRangeChunk() = runTest {
        // Size >= 5 MiB (5,242,880 bytes) triggers LARGE tier
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":6000000,"mtime":1710000000,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val query = exchange.requestURI.query
            assertTrue(query.contains("offset=0") || query.contains("len=65536"))
            val chunk = "first 64k chunk of large file\n"
            exchange.sendResponseHeaders(200, chunk.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(chunk.toByteArray()) }
        }

        val repo = createEditorRepository()
        val target = ProjectTargetRef(project = "demo")
        val result = repo.loadFile(target, "huge.log", offset = 0L)

        assertTrue(result is EditorLoadResult.Success)
        assertEquals(FileTier.LARGE, result.tier)
        assertEquals("first 64k chunk of large file\n", result.content)
        assertEquals(6000000L, result.size)
    }

    @Test
    fun testEncryptedSaveRequiresPhase11CryptoSession() = runTest {
        val repo = createEditorRepository()
        val target = ProjectTargetRef(project = "demo")
        val result = repo.saveFile(target, "secret.txt", "content", 100L, encryptedRequested = true)

        assertTrue(result is EditorSaveResult.Error)
        assertTrue(result.message.contains("Phase 11"))
    }

    @Test
    fun testTargetUnavailableErrorDetected() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val err = """{"error":"WORKSPACE_PROJECT_NOT_FOUND"}"""
            exchange.sendResponseHeaders(404, err.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(err.toByteArray()) }
        }

        val repo = createEditorRepository(project = "missing")
        val target = ProjectTargetRef(project = "missing")
        val result = repo.loadFile(target, "file.txt")

        assertTrue(result is EditorLoadResult.TargetUnavailable)
    }

    @Test
    fun testSaveFileReturnsErrorWhenWsNotConnected() = runTest {
        val repo = createEditorRepository(project = "demo")
        val target = ProjectTargetRef(project = "demo")
        val result = repo.saveFile(target, "file.txt", "content", 100L)
        assertTrue(result is EditorSaveResult.Error)
        assertTrue(result.message.contains("not connected"))
    }

    @Test
    fun testFileGrowthReclassifiesToLargeRange() = runTest {
        var statCount = 0
        server!!.createContext("/api/fs/stat") { exchange ->
            statCount++
            val size = if (statCount == 1) 500L else 6_000_000L
            val json = """{"kind":"file","size":$size,"mtime":1710000000,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val query = exchange.requestURI.query ?: ""
            if (query.contains("len=65536")) {
                val chunk = "first 64k after reclassification"
                exchange.sendResponseHeaders(200, chunk.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(chunk.toByteArray()) }
            } else {
                val bigData = ByteArray(5_300_000) { 'A'.code.toByte() }
                exchange.sendResponseHeaders(200, bigData.size.toLong())
                try {
                    exchange.responseBody.write(bigData)
                } catch (_: Exception) {}
                exchange.close()
            }
        }
        val repo = createEditorRepository()
        val target = ProjectTargetRef(project = "demo")
        val result = repo.loadFile(target, "grew.log")
        assertTrue(result is EditorLoadResult.Success, "Expected Success but got $result")
        assertEquals(FileTier.LARGE, result.tier)
        assertNotNull(result.rangeWindow)
        assertEquals("first 64k after reclassification", result.content)
    }
    @Test
    fun testInvalidUtf8FailsClosedWithoutEditableText() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":100,"mtime":1710000000,"mime":"application/octet-stream","isBinary":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val binaryJson = """{"binary":true,"mime":"application/octet-stream"}"""
            exchange.sendResponseHeaders(200, binaryJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(binaryJson.toByteArray()) }
        }

        val repo = createEditorRepository()
        val target = ProjectTargetRef(project = "demo")
        val result = repo.loadFile(target, "corrupt.dat")

        assertTrue(result is EditorLoadResult.Success)
        assertEquals(FileTier.BINARY, result.tier)
        assertTrue(result.isBinary)
        assertEquals("", result.content)
    }

    private fun docId(path: String = "test.kt") = dev.damhopper.nativeapp.features.workspace.DocumentId(
        dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
            profileId = "test-profile",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = "demo",
        ),
        path,
        1L,
    )

    @Test
    fun testSaveDocumentWithoutGateFailsClosedBeforeTransport() = runTest {
        val repo = createEditorRepository(project = "demo")
        val id = docId()
        val doc = TestEditorDocument(id, "val answer = 42", 100L)
        repo.documentProvider = { if (it == id) doc else null }

        val outcome = repo.saveDocument(id)
        assertTrue(outcome is dev.damhopper.nativeapp.features.files.FileOperationOutcome.NotSubmitted)
        assertTrue(outcome.reason.contains("gate"))
    }

    @Test
    fun testSaveDocumentDeniesReadOnlyAndGateRejectedDocuments() = runTest {
        val repo = createEditorRepository(project = "demo")
        val roId = docId("preview.log")
        val roDoc = TestEditorDocument(roId, "prefix only", 100L, readOnly = true)
        val liveId = docId("live.kt")
        val liveDoc = TestEditorDocument(liveId, "text", 100L)
        repo.documentProvider = { when (it) { roId -> roDoc; liveId -> liveDoc; else -> null } }
        repo.saveGate = { if (it == liveId) "Input blocked" else null }

        val ro = repo.saveDocument(roId, explicitOverwrite = true)
        assertTrue(ro is dev.damhopper.nativeapp.features.files.FileOperationOutcome.NotSubmitted)
        assertTrue(ro.reason.contains("read-only"))

        val gated = repo.saveDocument(liveId)
        assertTrue(gated is dev.damhopper.nativeapp.features.files.FileOperationOutcome.NotSubmitted)
        assertEquals("Input blocked", gated.reason)
    }

    @Test
    fun testCappedSuccessThroughEveryRetryNeverPublishesEditablePrefix() = runTest {
        // Stat claims NORMAL; server returns capped (successful) windows for the NORMAL and DEGRADED
        // reads because the real file is 6 MB. Neither capped window may be published as editable.
        var statCalls = 0
        server!!.createContext("/api/fs/stat") { exchange ->
            statCalls++
            val size = if (statCalls == 1) 900_000L else 6_000_000L
            val json = """{"kind":"file","size":$size,"mtime":1710000000,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val len = Regex("len=(\\d+)").find(exchange.requestURI.query.orEmpty())?.groupValues?.get(1)?.toInt() ?: 0
            val body = ByteArray(len) { 'A'.code.toByte() }
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }

        val result = createEditorRepository().loadFile(ProjectTargetRef(project = "demo"), "grew.log")
        assertTrue(result is EditorLoadResult.Success, "Expected Success but got $result")
        assertEquals(FileTier.LARGE, result.tier)
        assertNotNull(result.rangeWindow)
        assertEquals(FileTierPolicy.LARGE_CHUNK_BYTES.toInt(), result.content.length)
    }
}
