package dev.damhopper.nativeapp.features.workspace

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.FilesystemTargetRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.features.editor.AliasLeaseToken
import dev.damhopper.nativeapp.features.editor.ViewLeaseToken
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
import kotlin.test.assertSame
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
                fileIdentity = ServerMsg.FileIdentity("ws-1", 1L, "/Main.kt"),
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
            val json = """{"kind":"file","size":25,"mtime":10,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/Main.kt"}}"""
            exchange.responseHeaders.set("X-File-Identity", """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/Main.kt"}""")
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "fun main() = println()\n"
            exchange.responseHeaders.set("X-File-Identity", """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/Main.kt"}""")
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
        epoch: Long? = null,
        registry: dev.damhopper.nativeapp.features.editor.CanonicalDocumentRegistry? = null,
    ): ProjectWorkspaceState {
        val conn = ConnectionRef(profileId, 1L)
        val baseUrl = "http://127.0.0.1:$serverPort"
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = baseUrl,
            accountUser = user,
            project = project,
            worktreePath = null,
            workspaceEpoch = epoch,
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
            registry = registry,
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

        val success = state.rebindAuthority(state.owner, ConnectionRef(state.owner.profileId ?: "prof-test", 2L))
        assertTrue(success)
        assertFalse(state.isAuthorityRetired.value)
    }

    @Test
    fun testRebindDifferentOwnerFails() {
        val state = createWorkspaceState(user = "alice")
        state.revokeAuthority()

        val otherOwner = state.owner.copy(accountUser = "bob")
        val success = state.rebindAuthority(otherOwner, ConnectionRef(state.owner.profileId ?: "prof-test", 2L))
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

    @Test
    fun testGitGatedOnProjectSelected() = runTest {
        val state = createWorkspaceState()
        // Initial state is project target -> isProjectSelected is true
        assertTrue(state.isProjectSelected)
        state.selectPanel(WorkspacePanel.GIT)
        assertEquals(WorkspacePanel.GIT, state.activePanel.value)

        // Switch to whole workspace browsing -> isProjectSelected becomes false
        state.selectBrowsingTarget(FilesystemTargetRef.Workspace(profileId = "prof-test"))
        assertFalse(state.isProjectSelected)

        // Switch to FILES first
        state.selectPanel(WorkspacePanel.FILES)
        assertEquals(WorkspacePanel.FILES, state.activePanel.value)

        // Attempting to select GIT when whole workspace is selected must be refused
        state.selectPanel(WorkspacePanel.GIT)
        assertEquals(WorkspacePanel.FILES, state.activePanel.value, "GIT must not be entered when whole-workspace browsing is active")
        state.close()
    }

    @Test
    fun testCloseReleasesWorkspaceViewLeasesWithoutDisposingSurvivingAliases() = runTest {
        val state = createWorkspaceState()
        state.editorTabsState.openTab(state.target, "Main.kt")
        val tab = state.editorTabsState.openTabs.value.first()
        val doc = state.editorTabsState.getDocument(tab.id)
        assertNotNull(doc)

        // Acquire a second alias lease to simulate another workspace or tool retaining the document
        val externalAliasLease = doc.acquireAliasLease("external-alias-99")
        assertFalse(doc.canDispose)

        // Acquire a workspace view lease through ProjectWorkspaceState
        val canonicalKey = requireNotNull(tab.canonicalKey) { "tab.canonicalKey must not be null" }
        val viewLease = state.acquireWorkspaceViewLease(canonicalKey, "editor-surface-1")
        assertNotNull(viewLease)
        assertFalse(doc.canDispose)

        // Close the workspace: releases this workspace's alias and view leases
        state.close()
        assertTrue(state.isAuthorityRetired.value)
        assertEquals(0, state.editorTabsState.tabs.value.size)

        // The document must NOT be closed because externalAliasLease is still held!
        assertFalse(doc.isClosed)
        assertFalse(doc.canDispose)

        // Releasing the final external alias lease permits disposal
        doc.releaseAliasLease(externalAliasLease)
        assertTrue(doc.canDispose)
        doc.close()
        assertTrue(doc.isClosed)
    }

    @Test
    fun testOneFileSharesNativeBufferAcrossWorkspacesInSameOwner() = runTest {
        val sharedRegistry = dev.damhopper.nativeapp.features.editor.CanonicalDocumentRegistry(TestEditorDocumentFactory())
        val ws1 = createWorkspaceState(project = "demo-proj", registry = sharedRegistry)
        val ws2 = createWorkspaceState(project = "demo-proj", registry = sharedRegistry)

        ws1.editorTabsState.openTab(ws1.target, "Main.kt")
        ws2.editorTabsState.openTab(ws2.target, "Main.kt")

        val tab1 = ws1.editorTabsState.activeTab!!
        val tab2 = ws2.editorTabsState.activeTab!!

        val session1 = ws1.editorTabsState.getSession(tab1.key)!!
        val session2 = ws2.editorTabsState.getSession(tab2.key)!!

        assertSame(session1.document, session2.document, "Cross-workspace aliases must share canonical document")

        session1.setText("fun main() = println(\"hello\")\n")
        assertTrue(session1.isDirty)
        assertTrue(session2.isDirty)
        assertEquals("fun main() = println(\"hello\")\n", session2.getText())

        // Close Workspace 1: Workspace 2 survives with dirty edits
        ws1.close()
        assertTrue(ws1.isAuthorityRetired.value)
        assertFalse(session2.document.isClosed, "Closing ws1 must not close document used by ws2")
        assertTrue(session2.isDirty)
        assertEquals("fun main() = println(\"hello\")\n", session2.getText())

        session2.undo()
        assertEquals("fun main() = println()\n", session2.getText())
        assertFalse(session2.isDirty)
    }

    @Test
    fun testAuthorityRetirementRetainsDraftsAndDisablesStaleSaves() = runTest {
        val ws = createWorkspaceState(project = "demo-proj", epoch = 1L)
        ws.editorTabsState.openTab(ws.target, "Main.kt")
        val tab = ws.editorTabsState.activeTab!!
        val session = ws.editorTabsState.getSession(tab.key)!!

        session.setText("draft content\n")
        assertTrue(session.isDirty)

        // Revoke authority (auth loss or disconnect)
        ws.revokeAuthority()
        assertTrue(ws.isAuthorityRetired.value)

        // In-memory drafts and undo chains are retained!
        assertEquals(1, ws.editorTabsState.tabs.value.size)
        assertEquals("draft content\n", session.getText())
        assertTrue(session.isDirty)

        // Saves are disabled while authority is retired
        assertFalse(session.isInputPermitted)
        val saveRes = ws.editorTabsState.saveTab(tab.key)
        assertTrue(saveRes is dev.damhopper.nativeapp.features.editor.EditorSaveResult.Error)

        // Rebind with mismatched epoch refuses adoption
        val mismatchedOwner = ws.owner.copy(workspaceEpoch = 999L)
        val rebindEpochMismatch = ws.rebindAuthority(mismatchedOwner, ConnectionRef("prof-test", 2L))
        assertFalse(rebindEpochMismatch, "Mismatched epoch must reject rebind")

        // Rebind with mismatched account user refuses adoption
        val mismatchedUser = ws.owner.copy(accountUser = "bob")
        val rebindUserMismatch = ws.rebindAuthority(mismatchedUser, ConnectionRef("prof-test", 2L))
        assertFalse(rebindUserMismatch, "Mismatched user must reject rebind")

        // Exact authorized identity rebind succeeds
        val freshConn = ConnectionRef("prof-test", 2L)
        val rebindExact = ws.rebindAuthority(ws.owner, freshConn)
        assertTrue(rebindExact, "Exact authorized owner permits rebind")
        assertFalse(ws.isAuthorityRetired.value)

        // Retained dirty document must be tracked in unauthorizedDirtyDocIds post-rebind
        val dirtyDocId = ws.editorTabsState.getDocumentId(tab.key)
        assertNotNull(dirtyDocId)
        assertTrue(
            ws.unauthorizedDirtyDocIds.value.contains(dirtyDocId),
            "Retained dirty document must remain unauthorized after rebind until fresh server baseline verification"
        )

        // Actual save attempt MUST be rejected by saveGate
        val saveAttempt = ws.editorTabsState.saveTab(tab.key)
        assertTrue(saveAttempt is dev.damhopper.nativeapp.features.editor.EditorSaveResult.Error)
        assertTrue(
            saveAttempt.message.contains("fresh server baseline reauthorization"),
            "Save must be rejected with baseline reauthorization reason"
        )

        // Document dirty state and undo history remain strictly preserved
        assertEquals("draft content\n", session.getText())
        assertTrue(session.isDirty)

        // Reauthorize retained documents against fresh server baseline
        val reauthOk = ws.reauthorizeRetainedDocuments()
        assertTrue(reauthOk, "Fresh baseline matching canonical identity must reauthorize documents")
        assertTrue(
            ws.unauthorizedDirtyDocIds.value.isEmpty(),
            "Unauthorized document set must be cleared after successful reauthorization"
        )
    }
}
