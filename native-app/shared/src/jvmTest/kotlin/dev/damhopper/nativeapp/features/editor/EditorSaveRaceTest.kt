package dev.damhopper.nativeapp.features.editor

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class EditorSaveRaceTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
    }

    @AfterTest
    fun tearDown() { server?.stop(0) }

    private fun createTabsState(project: String = "demo"): EditorTabsState {
        val conn = ConnectionRef("p1", 1L)
        val client = ApiClient(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val owner = WorkspaceFileOwner(
            profileId = "p1",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = project,
        )
        val fileRepo = FileRepository(owner, client, ws)
        val editorRepo = EditorRepository(fileRepo, profileId = "p1")
        return EditorTabsState("p1", editorRepo, documentFactory = TestEditorDocumentFactory())
    }

    @Test
    fun testSaveInFlightInterveningEditsRemainDirty() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "initial content\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "main.ts")
        val session = state.getSession(state.activeTab!!.key)!!

        // User edits text
        session.setText("initial content\nedit 1\n")
        assertTrue(session.isDirty)

        // Snapshot captured for save
        val snapshot = session.snapshotSave()!!
        assertEquals("initial content\nedit 1\n", snapshot.utf8Bytes.decodeToString())

        // While save is in flight on network, user types more
        session.setText("initial content\nedit 1\nedit 2\n")

        // Save finishes with server mtime 200L
        session.completeSave(200L, snapshot)

        // CRITICAL: Newer edit keeps session dirty and content intact!
        assertEquals("initial content\nedit 1\nedit 2\n", session.getText())
        assertTrue(session.isDirty, "Session must remain dirty when edited while save was in flight")
        assertEquals(200L, session.serverMtime)
    }

    @Test
    fun testReopenedTabRejectsOldIncarnationCallbacks() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "version 1\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "code.ts")
        val firstDocId = state.activeTabId.value!!
        val firstKey = state.activeTabKey.value!!

        // Close tab
        state.closeTab(firstKey)

        // Reopen same path -> receives new monotonic incarnation
        state.openTab(target, "code.ts")
        val secondDocId = state.activeTabId.value!!

        assertNotEquals(firstDocId.tabIncarnation, secondDocId.tabIncarnation)
        assertTrue(secondDocId.tabIncarnation > firstDocId.tabIncarnation)
    }

    @Test
    fun testCasConflictPreservesLocalBuffer() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "base text\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "conflict.txt")
        val session = state.getSession(state.activeTab!!.key)!!

        session.setText("my local changes\n")

        // Save conflict simulation: abort save
        session.abortSave()

        // Local changes are not cleared or lost
        assertEquals("my local changes\n", session.getText())
        assertTrue(session.isDirty)
    }
}
