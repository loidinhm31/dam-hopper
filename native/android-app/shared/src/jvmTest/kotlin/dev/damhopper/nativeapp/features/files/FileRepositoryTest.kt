package dev.damhopper.nativeapp.features.files

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FileRepositoryTest {

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

    private fun createRepository(
        profileId: String = "test-profile",
        project: String = "demo-proj",
        worktreePath: String? = null,
    ): FileRepository {
        val conn = ConnectionRef(profileId, 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val owner = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = project,
            worktreePath = worktreePath,
        )
        return FileRepository(owner, client, ws)
    }

    @Test
    fun testListDirectoryRest() = runTest {
        server!!.createContext("/api/fs/list") { exchange ->
            val query = exchange.requestURI.query
            assertTrue(query.contains("project=demo-proj"))
            val json = """{"entries":[{"name":"src","kind":"dir","size":0,"mtime":1712577600,"isSymlink":false},{"name":"README.md","kind":"file","size":1024,"mtime":1712577601,"isSymlink":false}]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo-proj")
        val entries = repo.listDirectory(target, "")

        assertEquals(2, entries.size)
        assertEquals("src", entries[0].name)
        assertEquals("dir", entries[0].kind)
        assertEquals("README.md", entries[1].name)
        assertEquals("file", entries[1].kind)
        assertEquals(1024uL, entries[1].size)
    }

    @Test
    fun testStatRest() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":2048,"mtime":1712578000,"mime":"text/markdown","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository(worktreePath = "/tmp/wt")
        val target = ProjectTargetRef(project = "demo-proj", worktreePath = "/tmp/wt")
        val stat = repo.stat(target, "README.md")

        assertEquals("file", stat.kind)
        assertEquals(2048uL, stat.size)
        assertEquals(1712578000L, stat.mtime)
        assertEquals("text/markdown", stat.mime)
        assertFalse(stat.isBinary)
    }

    @Test
    fun testReadFileRestFallback() = runTest {
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "# Hello World"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo-proj")
        val result = repo.readFile(target, "README.md")

        assertTrue(result.ok)
        assertFalse(result.isBinary)
        assertEquals("# Hello World", result.textContent)
    }

    @Test
    fun testReadFileRestBinaryDetection() = runTest {
        server!!.createContext("/api/fs/read") { exchange ->
            val binaryJson = """{"binary":true,"mime":"application/octet-stream"}"""
            exchange.sendResponseHeaders(200, binaryJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(binaryJson.toByteArray()) }
        }

        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo-proj")
        val result = repo.readFile(target, "binary.bin")

        assertTrue(result.ok)
        assertTrue(result.isBinary)
        kotlin.test.assertNull(result.textContent)
    }

    @Test
    fun testCrossOwnerTargetRejected() = runTest {
        val repo = createRepository(project = "demo-proj")
        val mismatchedTarget = ProjectTargetRef(project = "other-proj")

        kotlin.test.assertFailsWith<IllegalArgumentException> {
            repo.listDirectory(mismatchedTarget, "")
        }
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            repo.stat(mismatchedTarget, "README.md")
        }
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            repo.readFile(mismatchedTarget, "README.md")
        }
    }

    @Test
    fun testPathTraversalRejected() = runTest {
        val repo = createRepository(project = "demo-proj")
        val target = ProjectTargetRef(project = "demo-proj")

        kotlin.test.assertFailsWith<IllegalArgumentException> {
            repo.readFile(target, "../escaped_secret.txt")
        }
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            repo.executeFsOp(target, "delete", "../escaped_secret.txt")
        }
    }

    @Test
    fun testStrictUtf8DecodeRejectsMalformedBytes() = runTest {
        server!!.createContext("/api/fs/read") { exchange ->
            // Invalid UTF-8 sequence (continuation byte without start)
            val malformedBytes = byteArrayOf(0x80.toByte(), 0x81.toByte(), 0xFF.toByte())
            exchange.sendResponseHeaders(200, malformedBytes.size.toLong())
            exchange.responseBody.use { it.write(malformedBytes) }
        }

        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo-proj")
        val result = repo.readFile(target, "malformed.txt")

        assertTrue(result.ok)
        // Must be classified as binary when UTF-8 decoding fails; never lossy decoded into text
        assertTrue(result.isBinary)
        kotlin.test.assertNull(result.textContent)
    }

    @Test
    fun testEditorContentLoaderRejectsInvalidUtf8() = runTest {
        server!!.createContext("/api/fs/read") { exchange ->
            val malformedBytes = byteArrayOf(0x80.toByte(), 0x81.toByte(), 0xFF.toByte())
            exchange.sendResponseHeaders(200, malformedBytes.size.toLong())
            exchange.responseBody.use { it.write(malformedBytes) }
        }

        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo-proj")
        val loader = dev.damhopper.nativeapp.features.editor.EditorContentLoader(repo)
        val loadResult = loader.loadFullText(target, "malformed.txt", 3L, dev.damhopper.nativeapp.features.editor.FileTier.NORMAL, 100L)

        assertTrue(loadResult is dev.damhopper.nativeapp.features.editor.EditorLoadResult.Error)
        assertFalse(loadResult is dev.damhopper.nativeapp.features.editor.EditorLoadResult.Success)
    }
}
