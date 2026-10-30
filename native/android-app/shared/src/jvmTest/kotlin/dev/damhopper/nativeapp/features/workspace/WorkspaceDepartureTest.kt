package dev.damhopper.nativeapp.features.workspace

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import kotlinx.coroutines.async
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.CloseDecision
import dev.damhopper.nativeapp.features.editor.CloseIntent
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.TestEditorDocumentFactory
import dev.damhopper.nativeapp.features.files.FileOperationArbiter
import dev.damhopper.nativeapp.features.files.FileOperationOutcome
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
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
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class TestDepartureWsConnection(
    connection: ConnectionRef,
    baseUrl: String,
) : WsConnection(connection, baseUrl, { "test-token" }) {
    var currentSocket: SocketInstanceRef? = SocketInstanceRef(connection, "sock-dep-1")
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()

    var shouldSaveFail: Boolean = false

    override fun activeSocketRef(): SocketInstanceRef? = currentSocket

    override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {
        if (msg is ClientMsg.FsWriteCommit) {
            _boundFlow.emit(
                SocketBoundMessage(
                    expectedSocketRef,
                    if (shouldSaveFail) {
                        ServerMsg.FsError(reqId = 1uL, code = "WRITE_FAILED", message = "Disk full")
                    } else {
                        ServerMsg.FsWriteResult(writeId = msg.writeId, ok = true, newMtime = 200L)
                    },
                )
            )
        }
    }

    @OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
    override suspend fun requestOnSocket(
        expectedSocketRef: SocketInstanceRef,
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long,
    ): ServerMsg {
        return when (msg) {
            is ClientMsg.FsSubscribeTree -> ServerMsg.TreeSnapshot(reqId = reqId, subId = 1uL)
            is ClientMsg.FsWriteBegin -> {
                if (shouldSaveFail) {
                    ServerMsg.FsError(reqId = reqId, code = "WRITE_DENIED", message = "No space")
                } else {
                    ServerMsg.FsWriteAck(reqId = reqId, writeId = 99uL)
                }
            }
            is ClientMsg.FsRead -> ServerMsg.FsReadResult(
                reqId = reqId,
                ok = true,
                mime = "text/plain",
                binary = false,
                mtime = 10L,
                size = 15uL,
                data = kotlin.io.encoding.Base64.encode("initial text\n".encodeToByteArray()),
            )
            else -> ServerMsg.FsOpResult(reqId = reqId, ok = true)
        }
    }
}

class WorkspaceDepartureTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private lateinit var testScope: CoroutineScope
    private lateinit var wsConnection: TestDepartureWsConnection

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.createContext("/api/fs/list") { exchange ->
            val json = """{"entries":[{"name":"doc.txt","kind":"file","size":15,"mtime":10,"isSymlink":false}]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":15,"mtime":10,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.start()
        testScope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
        testScope.cancel()
    }

    private fun createFixture(): Pair<ProjectWorkspaceState, AppFlowNavigation> {
        val conn = ConnectionRef("prof-dep", 1L)
        val baseUrl = "http://127.0.0.1:$serverPort"
        val owner = WorkspaceFileOwner(
            profileId = "prof-dep",
            baseUrl = baseUrl,
            accountUser = "charlie",
            project = "guarded-proj",
            worktreePath = null,
        )
        val target = owner.toProjectTargetRef()
        val arbiter = FileOperationArbiter()
        val client = ApiClient(conn, baseUrl, { "test-token" })
        wsConnection = TestDepartureWsConnection(conn, baseUrl)
        val fileRepo = FileRepository(owner, client, wsConnection, testScope, arbiter)
        val editorRepo = EditorRepository(fileRepo, profileId = "prof-dep")
        val docFactory = TestEditorDocumentFactory()

        val workspaceState = ProjectWorkspaceState.create(
            owner = owner,
            target = target,
            fileRepository = fileRepo,
            editorRepository = editorRepo,
            documentFactory = docFactory,
            coroutineScope = testScope,
        )

        val nav = AppFlowNavigation()
        nav.onProfileAuthenticated("prof-dep")
        nav.selectProject("guarded-proj")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)

        // Install departure guard hook (as ProjectWorkspaceScreen does)
        nav.departureGuard = { request ->
            if (workspaceState.hasDirtyDocuments() && !workspaceState.isAuthorityRetired.value) {
                val dirtyIds = workspaceState.getDirtyDocumentIds()
                val dirtyRevs = workspaceState.getDirtyRevisions()
                workspaceState.setPendingDeparture(
                    WorkspaceDepartureIntent.WorkspaceLeave(
                        targetStageName = request.targetStage.name,
                        dirtyDocuments = dirtyIds,
                        dirtyRevisions = dirtyRevs,
                        onConfirmed = request.onProceed,
                        onCancelled = request.onCancelled,
                    )
                )
                true // Intercept!
            } else {
                false // Allow immediate exit
            }
        }

        return Pair(workspaceState, nav)
    }

    @Test
    fun testCleanWorkspacePermitsImmediateBackNavigation() {
        val (state, nav) = createFixture()
        assertFalse(state.hasDirtyDocuments())

        val handled = nav.handleBackPress()
        assertTrue(handled)
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
        assertNull(state.pendingDeparture.value)
    }

    @Test
    fun testDirtyWorkspaceInterceptsNavigation() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        assertNotNull(doc)
        doc.applyEdit(1, 1, 1, 1, "dirty edit\n")
        assertTrue(state.hasDirtyDocuments())

        // Press back
        val handled = nav.handleBackPress()
        assertTrue(handled)
        // Navigation intercepted: remains in TERMINAL/WORKSPACE
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)

        val pending = state.pendingDeparture.value
        assertNotNull(pending)
        assertIs<WorkspaceDepartureIntent.WorkspaceLeave>(pending)
        assertEquals(1, pending.dirtyDocuments.size)
        assertEquals("doc.txt", pending.dirtyDocuments.first().relativePath)
    }

    @Test
    fun testCancelDepartureKeepsRouteAndSession() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "unsaved line\n")

        nav.handleBackPress()
        assertNotNull(state.pendingDeparture.value)

        // User cancels
        state.clearPendingDeparture()
        assertNull(state.pendingDeparture.value)
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
        assertTrue(state.hasDirtyDocuments())
    }

    @Test
    fun testDiscardDepartureNavigatesImmediately() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "discardable line\n")

        nav.handleBackPress()
        val pending = state.pendingDeparture.value as WorkspaceDepartureIntent.WorkspaceLeave

        // User clicks Discard & Leave
        state.completePendingDeparture(pending)
        pending.onConfirmed()

        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
    }

    @Test
    fun testSaveFailurePreventsDepartureAndRetainsDraft() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "unsaved line\n")

        nav.handleBackPress()
        assertNotNull(state.pendingDeparture.value)

        // Make save fail
        wsConnection.shouldSaveFail = true
        val outcome = state.editorRepository.saveDocument(state.editorTabsState.activeTabId.value!!)
        assertTrue(outcome !is FileOperationOutcome.Confirmed)

        // Departure blocked: still at TERMINAL, draft preserved
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
        assertTrue(state.hasDirtyDocuments())
        assertTrue(doc.isDirty.value)
    }

    @Test
    fun testEditAfterSaveSnapshotPreventsDeparture() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "line 1\n")

        nav.handleBackPress()
        val pending = state.pendingDeparture.value as WorkspaceDepartureIntent.WorkspaceLeave

        val initialRev = doc.revision.value
        // User types another edit while save is being processed
        doc.applyEdit(2, 1, 2, 1, "newer edit\n")
        val currentRev = doc.revision.value

        // Verification check during departure commit
        val revisionsMatch = (initialRev == currentRev)
        assertFalse(revisionsMatch, "Revision mismatch must abort departure")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
    }

    @Test
    fun testForcedAuthLossRevokesAuthorityWithoutSaveDialog() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "dirty edit\n")
        assertTrue(state.hasDirtyDocuments())

        // Forced auth loss: synchronously revoke writes
        state.revokeAuthority()
        assertTrue(state.isAuthorityRetired.value)
        assertFalse(state.editorTabsState.isInputAllowed())

        // Force navigate to profiles without waiting for Save
        nav.navigateToProfiles()
        assertEquals(AppFlowStage.PROFILE_LOGIN, nav.state.value.stage)

        // In-memory drafts remain preserved under exact owner
        assertTrue(state.hasDirtyDocuments())
        assertEquals(1, state.getDirtyDocumentIds().size)
    }
    @Test
    fun testSaveFromTerminalPanelSucceedsWithoutInputBlocked() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "dirty edit\n")

        // Switch to TERMINAL panel
        state.selectPanel(WorkspacePanel.TERMINAL)
        assertEquals(WorkspacePanel.TERMINAL, state.activePanel.value)
        // Interactive editor typing is blocked
        assertFalse(state.isInteractiveEditAllowed())
        // But save authority is granted
        assertTrue(state.editorTabsState.isInputAllowed())

        val outcome = state.editorRepository.saveDocument(state.editorTabsState.activeTabId.value!!)
        assertIs<FileOperationOutcome.Confirmed<Long>>(outcome)
    }

    @Test
    fun testMultiDocumentDepartureTransactionCatchesInterveningEdit() = runTest {
        val (state, nav) = createFixture()
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc1 = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc1!!.applyEdit(1, 1, 1, 1, "edit doc 1\n")

        state.editorTabsState.openTab(state.target, "doc2.txt")
        val doc2 = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc2!!.applyEdit(1, 1, 1, 1, "edit doc 2\n")

        // Trigger departure guard
        nav.handleBackPress()
        val departure = state.pendingDeparture.value as WorkspaceDepartureIntent.WorkspaceLeave
        assertEquals(2, departure.dirtyDocuments.size)

        // Save doc1
        state.editorRepository.saveDocument(doc1.id)
        // doc1 is modified again before departure transaction completes
        doc1.applyEdit(2, 1, 2, 1, "new uncommitted line\n")

        // Exercise production departure commit transaction
        val committed = state.commitDepartureSave(departure)
        assertFalse(committed, "Intervening edit must fail the production departure commit transaction")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
    }

    private fun leave(state: ProjectWorkspaceState, log: MutableList<String>, tag: String = "") =
        WorkspaceDepartureIntent.WorkspaceLeave(
            targetStageName = "TERMINAL",
            dirtyDocuments = state.getDirtyDocumentIds(),
            dirtyRevisions = state.getDirtyRevisions(),
            onConfirmed = { log += "${tag}confirmed" },
            onCancelled = { log += "${tag}cancelled" },
        )

    private suspend fun makeDirty(state: ProjectWorkspaceState) {
        state.editorTabsState.openTab(state.target, "doc.txt")
        val doc = state.editorTabsState.getDocument(state.editorTabsState.activeTabId.value!!)
        doc!!.applyEdit(1, 1, 1, 1, "dirty edit\n")
    }

    @Test
    fun testCancelInvokesCancellationExactlyOnceWhileDiscardNeverCancelsItsOwnContinuation() = runTest {
        val (state, _) = createFixture()
        makeDirty(state)
        val log = mutableListOf<String>()

        val cancelled = leave(state, log)
        state.setPendingDeparture(cancelled)
        state.clearPendingDeparture()
        state.clearPendingDeparture()
        assertEquals(listOf("cancelled"), log, "cancel/dismiss notifies once")
        assertNull(state.pendingDeparture.value)

        log.clear()
        val discarded = leave(state, log)
        state.setPendingDeparture(discarded)
        state.completePendingDeparture(discarded)
        discarded.onConfirmed()
        assertEquals(listOf("confirmed"), log, "successful completion is not a cancellation")
        assertNull(state.pendingDeparture.value)
    }

    @Test
    fun testCoalescedRequestIsCancelledAndNeverHijacksTheFirstPrompt() = runTest {
        val (state, _) = createFixture()
        makeDirty(state)
        val log = mutableListOf<String>()
        val first = leave(state, log, "first-")
        val second = leave(state, log, "second-")

        state.setPendingDeparture(first)
        state.setPendingDeparture(second)
        assertEquals(listOf("second-cancelled"), log)
        assertTrue(state.pendingDeparture.value === first, "the active prompt is never overwritten")

        state.clearPendingDeparture()
        assertEquals(listOf("second-cancelled", "first-cancelled"), log)
    }

    @Test
    fun testFailedSaveSpendsTheRequestButKeepsThePromptAndNeverCancelsTwice() = runTest {
        val (state, _) = createFixture()
        makeDirty(state)
        val log = mutableListOf<String>()
        val intent = leave(state, log)
        state.setPendingDeparture(intent)

        wsConnection.shouldSaveFail = true
        assertFalse(state.commitDepartureSave(intent), "a rejected save fails the departure")
        assertTrue(state.pendingDeparture.value === intent, "the dirty prompt and its error UI stay")
        assertNotNull(state.departureError)
        assertEquals(listOf("cancelled"), log, "the roster-style continuation is spent by the failed save")

        // A second failed attempt and the user's Cancel never notify again.
        assertFalse(state.commitDepartureSave(intent))
        state.clearPendingDeparture()
        assertEquals(listOf("cancelled"), log)
        assertTrue(state.hasDirtyDocuments(), "the draft is retained")
    }

    @Test
    fun testAuthorityRetirementSpendsTheContinuationButKeepsTheDirtyPrompt() = runTest {
        val (state, _) = createFixture()
        makeDirty(state)
        val log = mutableListOf<String>()
        val intent = leave(state, log)
        state.setPendingDeparture(intent)

        state.revokeAuthority()
        assertEquals(listOf("cancelled"), log)
        assertTrue(state.pendingDeparture.value === intent, "dirty data stays protected by the prompt")
        state.clearPendingDeparture()
        assertEquals(listOf("cancelled"), log)
    }

    @Test
    fun testDepartureWithTargetTransitionAndCleanReconciliation() = runTest {
        val (state, nav) = createFixture()
        makeDirty(state)
        assertTrue(state.hasDirtyDocuments())

        var guardProceed: (() -> Unit)? = null
        nav.departureGuard = { req ->
            guardProceed = req.onProceed
            true
        }

        val target = ProjectTargetRef("prof-test", "dam-hopper", "worktrees/feat")
        var committed = false
        val job = async {
            nav.requestWorkspaceTarget(
                target = target,
                revalidate = { true },
                onCommitted = { committed = true }
            )
        }

        // Before guard: not committed
        assertFalse(committed)
        // Save dirty documents
        val docId = state.editorTabsState.activeTabId.value!!
        state.editorRepository.saveDocument(docId)
        assertFalse(state.hasDirtyDocuments())

        // Confirm departure
        guardProceed?.invoke()
        val res = job.await()
        assertTrue(res.isSuccess)
        assertTrue(committed)
        assertEquals("worktrees/feat", nav.state.value.activeWorktreePath)
    }
}
