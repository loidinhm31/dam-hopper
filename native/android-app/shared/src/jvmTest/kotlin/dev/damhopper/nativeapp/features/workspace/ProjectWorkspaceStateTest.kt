package dev.damhopper.nativeapp.features.workspace

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorTabsState
import dev.damhopper.nativeapp.features.editor.TestEditorDocumentFactory
import dev.damhopper.nativeapp.features.files.FileMutationCoordinator
import dev.damhopper.nativeapp.features.files.FileOperationArbiter
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.FileTreeState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private class TestWorkspaceWsConnection(
    connection: ConnectionRef,
    baseUrl: String,
) : WsConnection(connection, baseUrl, { "test-token" }) {
    var currentSocket: SocketInstanceRef? = SocketInstanceRef(connection, "sock-1")
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()

    override fun activeSocketRef(): SocketInstanceRef? = currentSocket

    override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {}

    @OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
    override suspend fun requestOnSocket(
        expectedSocketRef: SocketInstanceRef,
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long,
    ): ServerMsg {
        return when (msg) {
            is ClientMsg.FsSubscribeTree -> ServerMsg.TreeSnapshot(reqId = reqId, subId = 1uL)
            is ClientMsg.FsRead -> ServerMsg.FsReadResult(
                reqId = reqId,
                ok = true,
                mime = "text/plain",
                binary = false,
                mtime = 10L,
                size = 25uL,
                data = kotlin.io.encoding.Base64.encode("fun main() = println()\n".encodeToByteArray()),
            )
            else -> ServerMsg.FsOpResult(reqId = reqId, ok = true)
        }
    }
}

class ProjectWorkspaceStateTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private lateinit var testScope: CoroutineScope

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.createContext("/api/fs/list") { exchange ->
            val json = """{"entries":[{"name":"Main.kt","kind":"file","size":25,"mtime":10,"isSymlink":false}]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":25,"mtime":10,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "fun main() = println()\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }
        server!!.start()
        testScope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
        testScope.cancel()
    }

    private fun createWorkspaceState(
        profileId: String = "prof-test",
        user: String = "alice",
        project: String = "demo-proj",
    ): ProjectWorkspaceState {
        val conn = ConnectionRef(profileId, 1L)
        val baseUrl = "http://127.0.0.1:$serverPort"
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = baseUrl,
            accountUser = user,
            project = project,
            worktreePath = null,
        )
        val target = owner.toProjectTargetRef()
        val arbiter = FileOperationArbiter()
        val client = ApiClient(conn, baseUrl, { "test-token" })
        val ws = TestWorkspaceWsConnection(conn, baseUrl)
        val fileRepo = FileRepository(owner, client, ws, testScope, arbiter)
        val editorRepo = EditorRepository(fileRepo, profileId = profileId)
        val docFactory = TestEditorDocumentFactory()

        return ProjectWorkspaceState.create(
            owner = owner,
            target = target,
            fileRepository = fileRepo,
            editorRepository = editorRepo,
            documentFactory = docFactory,
            coroutineScope = testScope,
        )
    }

    @Test
    fun testInitializationInvariants() {
        val state = createWorkspaceState()
        assertEquals(WorkspacePanel.TERMINAL, state.activePanel.value)
        assertTrue(state.isForeground.value)
        assertFalse(state.isAuthorityRetired.value)
        assertFalse(state.hasDirtyDocuments())
        assertEquals("alice", state.owner.accountUser)
        assertEquals("demo-proj", state.owner.project)
    }

    @Test
    fun testPanelSelectionAndInputGating() {
        val state = createWorkspaceState()
        // Default is TERMINAL -> interactive editor typing not allowed
        assertFalse(state.isInteractiveEditAllowed())
        assertTrue(state.editorTabsState.isInputAllowed())

        // Switch to FILES -> interactive editor typing not allowed
        state.selectPanel(WorkspacePanel.FILES)
        assertEquals(WorkspacePanel.FILES, state.activePanel.value)
        assertFalse(state.isInteractiveEditAllowed())
        assertTrue(state.editorTabsState.isInputAllowed())

        // Switch to EDITOR -> interactive editor typing allowed when foreground
        state.selectPanel(WorkspacePanel.EDITOR)
        assertEquals(WorkspacePanel.EDITOR, state.activePanel.value)
        assertTrue(state.isInteractiveEditAllowed())
        assertTrue(state.editorTabsState.isInputAllowed())
    }

    @Test
    fun testForegroundBackgroundInputPolicy() {
        val state = createWorkspaceState()
        state.selectPanel(WorkspacePanel.EDITOR)
        assertTrue(state.isInteractiveEditAllowed())
        assertTrue(state.editorTabsState.isInputAllowed())

        // Background app -> input blocked
        state.onAppBackground()
        assertFalse(state.isForeground.value)
        assertFalse(state.isInteractiveEditAllowed())
        assertFalse(state.editorTabsState.isInputAllowed())

        // Foreground app -> input restored
        state.onAppForeground()
        assertTrue(state.isForeground.value)
        assertTrue(state.isInteractiveEditAllowed())
        assertTrue(state.editorTabsState.isInputAllowed())
    }

    @Test
    fun testAuthorityRevocationRetainsDirtyBuffers() = runTest {
        val state = createWorkspaceState()
        state.selectPanel(WorkspacePanel.EDITOR)
        state.editorTabsState.openTab(state.target, "Main.kt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        assertNotNull(doc)
        doc.applyEdit(1, 1, 1, 1, "val x = 1\n")
        assertTrue(doc.isDirty.value)
        assertTrue(state.hasDirtyDocuments())

        // Revoke authority
        state.revokeAuthority()
        assertTrue(state.isAuthorityRetired.value)
        assertFalse(state.editorTabsState.isInputAllowed())

        // Dirty documents and content remain retained in memory
        assertTrue(state.hasDirtyDocuments())
        val dirtyIds = state.getDirtyDocumentIds()
        assertEquals(1, dirtyIds.size)
        assertEquals("Main.kt", dirtyIds.first().relativePath)
    }

    @Test
    fun testRebindExactOwnerSucceeds() {
        val state = createWorkspaceState()
        state.revokeAuthority()
        assertTrue(state.isAuthorityRetired.value)

        val success = state.rebindAuthority(state.owner)
        assertTrue(success)
        assertFalse(state.isAuthorityRetired.value)
    }

    @Test
    fun testRebindDifferentOwnerFails() {
        val state = createWorkspaceState(user = "alice")
        state.revokeAuthority()

        val otherOwner = state.owner.copy(accountUser = "bob")
        val success = state.rebindAuthority(otherOwner)
        assertFalse(success, "Rebinding to different user must be rejected")
        assertTrue(state.isAuthorityRetired.value)
    }

    @Test
    fun testCloseTearsDownResources() = runTest {
        val state = createWorkspaceState()
        state.editorTabsState.openTab(state.target, "Main.kt")
        assertEquals(1, state.editorTabsState.tabs.value.size)

        state.close()
        assertTrue(state.isAuthorityRetired.value)
        assertEquals(0, state.editorTabsState.tabs.value.size)
    }

    @Test
    fun testVerifiedTerminalSelectionShowsTheTerminalPanelAndSelectsExactlyThatTerminal() {
        val state = createWorkspaceState()
        val terminal = assertNotNull(state.terminalState)
        state.selectPanel(WorkspacePanel.FILES)
        assertFalse(terminal.isPanelVisible)

        state.commitVerifiedTerminalSelection(TerminalAgentsInstanceKey("prof-test", "term-9", 4uL))
        assertEquals(WorkspacePanel.TERMINAL, state.activePanel.value)
        assertEquals("term-9", terminal.activeSessionId)
        // Mutation only: widget visibility/input policy follow through the post-release effects.
        assertFalse(terminal.isPanelVisible)
        state.applyVerifiedSelectionEffects()
        assertTrue(terminal.isPanelVisible)
        assertEquals("term-9", terminal.activeSessionId)
    }
}
