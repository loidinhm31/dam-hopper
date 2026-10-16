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
        serverPort = server!!.address.port
        server!!.start()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createEditorRepository(): EditorRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val fileRepo = FileRepository(client, ws)
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

        val repo = createEditorRepository()
        val target = ProjectTargetRef(project = "missing")
        val result = repo.loadFile(target, "file.txt")

        assertTrue(result is EditorLoadResult.TargetUnavailable)
    }
}
