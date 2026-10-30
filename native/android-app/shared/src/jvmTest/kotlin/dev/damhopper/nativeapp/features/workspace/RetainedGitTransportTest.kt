package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
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
import dev.damhopper.nativeapp.ui.screens.ProjectTerminalState
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private class FakeWsConnection(
    conn: ConnectionRef,
    baseUrl: String,
) : WsConnection(conn, baseUrl, { "test-token" }) {
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()
    override fun activeSocketRef(): SocketInstanceRef? = SocketInstanceRef(connection, "sock-1")
    override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {}
    @OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
    override suspend fun requestOnSocket(
        expectedSocketRef: SocketInstanceRef,
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long,
    ): ServerMsg = when (msg) {
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

class RetainedGitTransportTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
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
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createFixture(generation: Long = 1L): Pair<ProjectWorkspaceState, ConnectionRef> {
        val owner = WorkspaceFileOwner(
            profileId = "prof-test",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "dev-user",
            project = "test-proj",
        )
        val target = owner.toProjectTargetRef()
        val conn = ConnectionRef("prof-test", generation)
        val registry = ConnectionRegistry()
        kotlinx.coroutines.runBlocking { registry.getOrCreateConnection("prof-test") }
        val apiClient = ApiClient(conn, owner.normalizedBaseUrl, { "token" }, registry)
        val ws = FakeWsConnection(conn, owner.normalizedBaseUrl)

        val fileRepo = FileRepository(owner, apiClient, ws)
        val editorRepo = EditorRepository(fileRepo, registry, "prof-test")
        val tabsState = EditorTabsState("prof-test", editorRepo, TestEditorDocumentFactory())
        val treeState = FileTreeState(target, fileRepo)
        val mutationCoordinator = FileMutationCoordinator(fileRepo, treeState, tabsState, fileRepo.arbiter, tabsState)
        val terminalState = ProjectTerminalState(target.project, conn, ownerScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined), owner = owner)

        val workspaceState = ProjectWorkspaceState(
            owner = owner,
            target = target,
            initialFileRepository = fileRepo,
            initialEditorRepository = editorRepo,
            editorTabsState = tabsState,
            fileTreeState = treeState,
            fileMutationCoordinator = mutationCoordinator,
            terminalState = terminalState,
            coroutineScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
        )
        return workspaceState to conn
    }

    @Test
    fun rebindTransportsPreservesDraftsUndoAndTabs() = runTest {
        val (state, initialConn) = createFixture(1L)
        state.selectPanel(WorkspacePanel.EDITOR)

        // Open a tab and make an uncommitted edit
        state.editorTabsState.openTab(state.target, "Source.kt")
        val activeDocId = state.editorTabsState.activeTabId.value
        assertNotNull(activeDocId)
        val doc = state.editorTabsState.getDocument(activeDocId)
        assertNotNull(doc)
        doc.applyEdit(1, 1, 1, 1, "fun test() = 42\n")
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertTrue(state.hasDirtyDocuments())

        // Revoke authority on connection drop
        state.revokeAuthority()
        assertTrue(state.isAuthorityRetired.value)
        // Buffers & undo retained
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertTrue(state.hasDirtyDocuments())

        // Reconnect with new connection generation
        val registry = state.fileRepository.apiClient.registry ?: ConnectionRegistry()
        val newConn = kotlinx.coroutines.runBlocking { registry.retireConnection(state.fileRepository.apiClient.connection) }
        val newApiClient = ApiClient(newConn, state.owner.normalizedBaseUrl, { "token" }, registry)
        val newWs = FakeWsConnection(newConn, state.owner.normalizedBaseUrl)
        val newFileRepo = FileRepository(state.owner, newApiClient, newWs, arbiter = state.fileRepository.arbiter)
        val newEditorRepo = EditorRepository(newFileRepo, registry, "prof-test")

        val rebindSuccess = state.rebindTransports(newFileRepo, newEditorRepo, newConn)
        assertTrue(rebindSuccess, "rebindTransports must succeed for same owner")
        assertFalse(state.isAuthorityRetired.value)

        // Verify documents, dirty state, undo, tabs are preserved
        assertEquals(1, state.editorTabsState.tabs.value.size)
        assertEquals(activeDocId, state.editorTabsState.activeTabId.value)
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertTrue(state.hasDirtyDocuments())

        // Undo edit after transport rebind
        doc.undo()
        assertFalse(doc.canUndo.value)
    }

    @Test
    fun rebindAuthorityRejectsMismatchedOwner() {
        val (state, conn) = createFixture(1L)
        val otherOwner = state.owner.copy(accountUser = "other-user")
        val result = state.rebindAuthority(otherOwner, ConnectionRef("prof-test", 2L))
        assertFalse(result, "rebindAuthority must reject mismatched owner")
    }
}
