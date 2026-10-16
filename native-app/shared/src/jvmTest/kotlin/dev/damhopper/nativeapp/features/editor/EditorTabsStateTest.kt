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

class EditorTabsStateTest {

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

    private fun createTabsState(): EditorTabsState {
        val conn = ConnectionRef("p1", 1L)
        val client = ApiClient(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val fileRepo = FileRepository(client, ws)
        val editorRepo = EditorRepository(fileRepo, profileId = "p1")
        return EditorTabsState("p1", editorRepo)
    }

    @Test
    fun testOpenSelectAndCloseTabs() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":100,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "content of file\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "a.txt")
        assertEquals(1, state.tabs.value.size)
        assertEquals("a.txt", state.activeTab?.name)

        state.openTab(target, "b.txt")
        assertEquals(2, state.tabs.value.size)
        assertEquals("b.txt", state.activeTab?.name)

        val firstKey = state.tabs.value[0].key
        state.selectTab(firstKey)
        assertEquals("a.txt", state.activeTab?.name)

        state.closeTab(firstKey)
        assertEquals(1, state.tabs.value.size)
        assertEquals("b.txt", state.activeTab?.name)
    }

    @Test
    fun testIsDirtyFileSuppliesReplaceCoordinator() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "hello world\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "foo.txt")
        assertFalse(state.isDirtyFile(target, "foo.txt"))

        val session = state.getSession(state.activeTab!!.key)!!
        session.setText("hello universe\n")
        assertTrue(state.isDirtyFile(target, "foo.txt"))
    }

    @Test
    fun testWatcherEventReloadsCleanTabAutomatically() = runTest {
        var readCounter = 1
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":${100 + readCounter},"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "version $readCounter\n"
            readCounter++
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "doc.txt")
        assertEquals("version 1\n", state.activeTab?.content)

        state.handleRemoteFileModified(target, "doc.txt")
        assertEquals("version 2\n", state.activeTab?.content)
        assertFalse(state.activeTab?.isStale ?: true)
    }

    @Test
    fun testWatcherEventMarksDirtyTabStaleWithoutOverwriting() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "remote v1\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "doc.txt")

        val session = state.getSession(state.activeTab!!.key)!!
        session.setText("local unsaved edits\n")
        state.handleRemoteFileModified(target, "doc.txt")

        assertEquals("local unsaved edits\n", state.activeTab?.content)
        assertTrue(state.activeTab?.isStale ?: false)
    }

    @Test
    fun testDiscardAndReloadTab() = runTest {
        var readCounter = 1
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":${100 + readCounter},"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "server copy $readCounter\n"
            readCounter++
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "doc.txt")

        val session = state.getSession(state.activeTab!!.key)!!
        session.setText("unsaved local buffer\n")
        assertTrue(state.activeTab?.isDirty ?: false)

        state.discardAndReloadTab(state.activeTab!!.key)
        assertEquals("server copy 2\n", state.activeTab?.content)
        assertFalse(state.activeTab?.isDirty ?: true)
        assertFalse(state.activeTab?.isConflicted ?: true)
    }

    @Test
    fun testCloseAllDisposesSessions() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "dummy\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "file1.txt")
        val session = state.getSession(state.activeTab!!.key)!!
        assertFalse(session.isDisposed)

        state.closeAll()
        assertTrue(state.tabs.value.isEmpty())
        assertNull(state.activeTabKey.value)
        assertTrue(session.isDisposed)
    }
}
