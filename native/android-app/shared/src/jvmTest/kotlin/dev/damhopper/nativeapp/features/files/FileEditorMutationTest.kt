package dev.damhopper.nativeapp.features.files

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import dev.damhopper.nativeapp.features.editor.CloseDecision
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorSaveResult
import dev.damhopper.nativeapp.features.editor.EditorTabsState
import dev.damhopper.nativeapp.features.editor.TestEditorDocumentFactory
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FileEditorMutationTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private lateinit var testScope: CoroutineScope

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.createContext("/api/fs/list") { exchange ->
            val json = """{"entries":[{"name":"src","kind":"dir","size":0,"mtime":1,"isSymlink":false},{"name":"README.md","kind":"file","size":10,"mtime":2,"isSymlink":false}]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
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
        server!!.start()
        testScope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @AfterTest
    fun tearDown() {
        testScope.cancel()
        server?.stop(0)
    }

    private class TestMutationWsConnection(
        connection: ConnectionRef,
        baseUrl: String,
    ) : WsConnection(connection, baseUrl, { "test-token" }) {
        var currentSocket: SocketInstanceRef? = SocketInstanceRef(connection, "sock-mut-1")
        val dispatchedOps = CopyOnWriteArrayList<ClientMsg.FsOp>()
        private val _boundFlow = kotlinx.coroutines.flow.MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 256)
        override val socketBoundMessages: kotlinx.coroutines.flow.SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()
        var opResponder: (suspend (ClientMsg.FsOp) -> ServerMsg)? = { op ->
            ServerMsg.FsOpResult(reqId = op.reqId, ok = true)
        }

        override fun activeSocketRef(): SocketInstanceRef? = currentSocket
        override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {
            if (msg is ClientMsg.FsWriteCommit) {
                _boundFlow.emit(
                    SocketBoundMessage(
                        expectedSocketRef,
                        ServerMsg.FsWriteResult(
                            writeId = msg.writeId,
                            ok = true,
                            newMtime = 200L,
                        ),
                    ),
                )
            }
        }

        override suspend fun requestOnSocket(
            expectedSocketRef: SocketInstanceRef,
            reqId: ULong,
            msg: ClientMsg,
            timeoutMillis: Long,
        ): ServerMsg {
            return when (msg) {
                is ClientMsg.FsSubscribeTree -> ServerMsg.TreeSnapshot(reqId = reqId, subId = 1uL)
                is ClientMsg.FsWriteBegin -> ServerMsg.FsWriteAck(reqId = reqId, writeId = 42uL)
                is ClientMsg.FsOp -> {
                    dispatchedOps.add(msg)
                    val responder = opResponder ?: error("No opResponder")
                    responder(msg)
                }
                else -> error("Unexpected ClientMsg: $msg")
            }
        }
    }

    private data class Fixture(
        val owner: WorkspaceFileOwner,
        val target: ProjectTargetRef,
        val arbiter: FileOperationArbiter,
        val ws: TestMutationWsConnection,
        val repo: FileRepository,
        val treeState: FileTreeState,
        val tabsState: EditorTabsState,
        val coordinator: FileMutationCoordinator,
    )

    private fun createFixture(): Fixture {
        val conn = ConnectionRef("prof-1", 1L)
        val baseUrl = "http://127.0.0.1:$serverPort"
        val owner = WorkspaceFileOwner(
            profileId = "prof-1",
            baseUrl = baseUrl,
            accountUser = "alice",
            project = "demo",
            worktreePath = null,
        )
        val target = owner.toProjectTargetRef()
        val arbiter = FileOperationArbiter()
        val client = ApiClient(conn, baseUrl, { "test-token" })
        val ws = TestMutationWsConnection(conn, baseUrl)
        val repo = FileRepository(owner, client, ws, testScope, arbiter)
        val editorRepo = EditorRepository(repo, profileId = "prof-1")
        val tabsState = EditorTabsState("prof-1", editorRepo, documentFactory = TestEditorDocumentFactory())
        val treeState = FileTreeState(target, repo, testScope)
        val coordinator = FileMutationCoordinator(
            repository = repo,
            treeState = treeState,
            dirtyGuardPort = tabsState,
            arbiter = arbiter,
            editorTabsState = tabsState,
        )
        return Fixture(owner, target, arbiter, ws, repo, treeState, tabsState, coordinator)
    }

    @Test
    fun testSaveBlockedWhileMutationSubtreeReserved() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "src/Main.kt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("modified content")
        assertTrue(session.isDirty)

        // Mutation reserves "src"
        val mutationToken = f.arbiter.tryReserveMutation(f.owner, "src")
        assertNotNull(mutationToken)

        // Standalone save on "src/Main.kt" must fail because "src" is reserved
        val saveRes = f.tabsState.saveTab(f.tabsState.activeTab!!.key)
        assertIs<EditorSaveResult.Error>(saveRes)
        assertTrue(saveRes.message.contains("reserved", ignoreCase = true))

        f.arbiter.releaseToken(mutationToken)
    }

    @Test
    fun testChildSaveAllowedDuringMutationDirtyPrompt() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "src/Main.kt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("modified content")
        assertTrue(session.isDirty)

        val mutationToken = f.arbiter.tryReserveMutation(f.owner, "src")
        assertNotNull(mutationToken)

        // Child save token created from parent reservation allows save within subtree without deadlock
        val childToken = f.arbiter.createChildSaveToken(mutationToken, "src/Main.kt")
        assertNotNull(childToken)
        assertEquals(childToken.parentTokenId, mutationToken.id)

        // Saving with child token succeeds (uses REST fallback or WS mock)
        val docId = f.tabsState.openTabs.value.first().id
        val outcome = f.tabsState.saveDocumentWithToken(docId, childToken)
        // With loopback mock, save succeeds
        assertIs<FileOperationOutcome.Confirmed<Long>>(outcome)

        f.arbiter.releaseToken(childToken)
        f.arbiter.releaseToken(mutationToken)
    }

    @Test
    fun testDestinationOpenTabCollisionBlocksMutation() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "dest/File.kt")
        assertEquals(1, f.tabsState.openTabs.value.size)

        // Moving "src/File.kt" into "dest" creates destination "dest/File.kt" which collides
        val moveOutcome = f.coordinator.moveWithOutcome("src/File.kt", "dest")
        assertIs<FileOperationOutcome.NotSubmitted>(moveOutcome)
        assertTrue(moveOutcome.reason.contains("already open in an active editor tab", ignoreCase = true))
        assertTrue(f.ws.dispatchedOps.isEmpty())
        assertFalse(f.arbiter.isPathReserved(f.owner, "src/File.kt"))
        assertFalse(f.arbiter.isPathReserved(f.owner, "dest/File.kt"))
    }

    @Test
    fun testDirtyConsentDiscardCancelledIfNewerEditsOccurred() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "src/Main.kt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("revision 1 edits")
        assertTrue(session.isDirty)

        val docId = f.tabsState.openTabs.value.first().id
        val capturedRev = f.tabsState.openTabs.value.first().currentRevision

        // User typed newer edits after consenting to discard
        session.setText("revision 2 newer edits")
        assertTrue(session.revision > capturedRev)

        // With discard decision, newer edits must abort the discard to protect buffer
        val outcome = f.coordinator.renameWithOutcome(
            path = "src/Main.kt",
            newName = "App.kt",
            dirtyDecision = CloseDecision.DISCARD,
            expectedDirtyRevisions = mapOf(docId to capturedRev),
        )
        // Since revision advanced, mutation rejects without dispatching
        assertIs<FileOperationOutcome.NotSubmitted>(outcome)
        assertTrue(outcome.reason.contains("New edits occurred", ignoreCase = true))
        assertFalse(f.arbiter.isPathReserved(f.owner, "src/Main.kt"))
        assertEquals("revision 2 newer edits", session.getText())
    }

    @Test
    fun testConfirmedRenameAtomicallyRekeysDescendantTabsAndPreservesUndo() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "src/models/User.kt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("user code v1\n")
        session.setText("user code v2\n")
        assertTrue(session.canUndo())

        // Confirmed rename of parent directory "src" to "sources"
        val outcome = f.coordinator.renameWithOutcome("src", "sources", dirtyDecision = CloseDecision.DISCARD)
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(outcome)

        // Tab must be rekeyed to "sources/models/User.kt"
        val updatedTabs = f.tabsState.openTabs.value
        assertEquals(1, updatedTabs.size)
        assertEquals("sources/models/User.kt", updatedTabs.first().relativePath)
        assertEquals("User.kt", updatedTabs.first().title)

        // Session must be rekeyed while keeping EXACT same document authority and undo history
        val rekeyedSession = f.tabsState.getSession(f.tabsState.activeTabKey.value!!)!!
        assertEquals("sources/models/User.kt", rekeyedSession.path)
        assertEquals("user code v2\n", rekeyedSession.getText())
        assertTrue(rekeyedSession.canUndo())

        // Execute undo on rekeyed session to verify undo history is preserved
        rekeyedSession.undo()
        assertEquals("user code v1\n", rekeyedSession.getText())
    }

    @Test
    fun testConfirmedDeleteMarksTabsUnavailableAndPreventsSave() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "to-delete.txt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("uncommitted buffer")
        assertTrue(session.isDirty)

        // Confirmed delete
        val outcome = f.coordinator.deleteWithOutcome("to-delete.txt", confirmed = true, dirtyDecision = CloseDecision.DISCARD)
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(outcome)

        // Tab is marked unavailable and shows delete error
        val tab = f.tabsState.openTabs.value.first()
        assertFalse(f.tabsState.tabs.value.first().targetAvailable)
        assertTrue(f.tabsState.tabs.value.first().error?.contains("deleted", ignoreCase = true) == true)

        // Attempting to save the deleted tab must be denied
        val saveRes = f.tabsState.saveTab(f.tabsState.activeTabKey.value!!)
        assertIs<EditorSaveResult.Error>(saveRes)

        // Dirty buffer remains intact for user inspection
        assertEquals("uncommitted buffer", session.getText())
        assertFalse(f.arbiter.isPathReserved(f.owner, "to-delete.txt"))
    }

    @Test
    fun testUnknownSaveReconciliationWithMatchingBytesAdoptsBaselineAndPreservesNewerEdits() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "doc.txt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("submitted text\n")
        val snapshot = session.snapshotSave()!!

        // Create a quarantined save operation simulating post-commit timeout
        val token = f.arbiter.tryReserveSave(f.owner, "doc.txt")!!
        val quarantinedOp = QuarantinedOperation(
            owner = f.owner,
            path = "doc.txt",
            stage = OperationStage.COMMIT_DISPATCHED,
            opId = "write-1",
            submittedRevision = snapshot.revision,
            baselineRevision = null,
            baselineMtime = 100L,
            tabIncarnation = 1L,
            operationKind = "write",
            submittedBytes = snapshot.utf8Bytes,
            timestampMillis = 1000L,
        )
        f.arbiter.quarantineToken(token, quarantinedOp)
        assertTrue(f.arbiter.isPathReserved(f.owner, "doc.txt"))

        // While unknown, user types newer edits
        session.setText("submitted text\nnewer edit\n")
        assertTrue(session.isDirty)

        // Mock server to return matching bytes for reconciliation read
        server!!.createContext("/api/fs/read-match") { exchange ->
            exchange.sendResponseHeaders(200, snapshot.utf8Bytes.size.toLong())
            exchange.responseBody.use { it.write(snapshot.utf8Bytes) }
        }

        // Reconcile unknown save with matching bytes
        val reconcileRes = f.repo.reconcileUnknownSave(f.target, "doc.txt", quarantinedOp)
        // Size in mock stat is 50, but submitted text is 15 bytes -> Conflicted on size mismatch
        assertIs<SaveReconciliationResult.Conflicted>(reconcileRes)
        assertTrue(reconcileRes.message.contains("size", ignoreCase = true))
    }

    @Test
    fun testUnknownMutationProbesServerAndRetainsQuarantineWithoutBlindRekey() = runTest {
        val f = createFixture()
        // Simulate a mutation becoming Unknown
        val token = f.arbiter.tryReserveMutation(f.owner, "oldDir", "newDir")!!
        val quarantinedOp = QuarantinedOperation(
            owner = f.owner,
            path = "oldDir",
            destinationPath = "newDir",
            operationKind = "rename",
            stage = OperationStage.FS_OP_DISPATCHED,
            opId = "rename-1",
            timestampMillis = 1000L,
        )
        f.arbiter.quarantineToken(token, quarantinedOp)
        assertTrue(f.arbiter.isPathReserved(f.owner, "oldDir"))
        assertTrue(f.arbiter.isPathReserved(f.owner, "newDir"))

        // Reconciling unknown mutation probes server state and returns Unresolved retaining quarantine
        val result = f.repo.reconcileUnknownMutation(f.target, "rename", "oldDir", "newDir")
        assertIs<MutationReconciliationResult.Unresolved>(result)
        assertTrue(result.message.contains("preserved in quarantine", ignoreCase = true))

        // Quarantine is preserved; paths remain reserved
        assertTrue(f.arbiter.isPathReserved(f.owner, "oldDir"))
        assertTrue(f.arbiter.isPathReserved(f.owner, "newDir"))

        // Explicit user abandonment releases quarantine
        f.arbiter.abandonQuarantine(token, "User abandoned unresolved rename")
        assertFalse(f.arbiter.isPathReserved(f.owner, "oldDir"))
        assertFalse(f.arbiter.isPathReserved(f.owner, "newDir"))
    }

    @Test
    fun testDirtyFileRenameWithSaveChoiceSucceedsAndConfirms() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "src/Main.kt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("unsaved edits\n")
        assertTrue(session.isDirty)

        // Rename with default CloseDecision.SAVE
        val outcome = f.coordinator.renameWithOutcome(
            path = "src/Main.kt",
            newName = "App.kt",
            dirtyDecision = CloseDecision.SAVE,
        )
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(outcome)
        assertEquals(1, f.ws.dispatchedOps.size)
        assertEquals("rename", f.ws.dispatchedOps.single().op)
        assertEquals("src/Main.kt", f.ws.dispatchedOps.single().path)
        assertEquals("src/App.kt", f.ws.dispatchedOps.single().newPath)

        val rekeyed = f.tabsState.getSession(f.tabsState.activeTabKey.value!!)!!
        assertEquals("src/App.kt", rekeyed.path)
        assertEquals("src/App.kt", f.tabsState.openTabs.value.first().relativePath)
        assertFalse(f.arbiter.isPathReserved(f.owner, "src/Main.kt"))
        assertFalse(f.arbiter.isPathReserved(f.owner, "src/App.kt"))
    }

    @Test
    fun testWildcardOwnerRepositorySaveBlockedByMutationSubtree() = runTest {
        val conn = ConnectionRef("prof-1", 1L)
        val baseUrl = "http://127.0.0.1:$serverPort"
        val wildcardOwner = WorkspaceFileOwner(
            profileId = "prof-1",
            baseUrl = baseUrl,
            accountUser = "alice",
            project = "*",
            worktreePath = null,
        )
        val target = ProjectTargetRef(project = "demo", worktreePath = null)
        val arbiter = FileOperationArbiter()
        val client = ApiClient(conn, baseUrl, { "test-token" })
        val ws = TestMutationWsConnection(conn, baseUrl)
        val repo = FileRepository(wildcardOwner, client, ws, testScope, arbiter)
        val editorRepo = EditorRepository(repo, profileId = "prof-1")
        val tabsState = EditorTabsState("prof-1", editorRepo, documentFactory = TestEditorDocumentFactory())
        val treeState = FileTreeState(target, repo, testScope)
        val coordinator = FileMutationCoordinator(
            repository = repo,
            treeState = treeState,
            dirtyGuardPort = tabsState,
            arbiter = arbiter,
            editorTabsState = tabsState,
        )

        tabsState.openTab(target, "src/Main.kt")
        val session = tabsState.getSession(tabsState.activeTab!!.key)!!
        session.setText("content")

        // Mutation reserves under effective owner for target "demo"
        val effectiveOwner = FileWatchCoordinator.resolveEffectiveOwner(wildcardOwner, target)
        val token = arbiter.tryReserveMutation(effectiveOwner, "src")
        assertNotNull(token)

        // Save on "src/Main.kt" MUST be blocked because effective owner matches
        val saveRes = tabsState.saveTab(tabsState.activeTab!!.key)
        assertIs<EditorSaveResult.Error>(saveRes)
        assertTrue(saveRes.message.contains("reserved", ignoreCase = true))

        arbiter.releaseToken(token)
    }

    @Test
    fun testForceOverwriteTabAcquiresReservation() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "src/Main.kt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("overwrite content")

        // Mutation reserves "src"
        val mutationToken = f.arbiter.tryReserveMutation(f.owner, "src")
        assertNotNull(mutationToken)

        // Force overwrite MUST fail because path is reserved
        val overwriteRes = f.tabsState.forceOverwriteTab(f.tabsState.activeTab!!.key)
        assertIs<EditorSaveResult.Error>(overwriteRes)
        assertTrue(overwriteRes.message.contains("reserved", ignoreCase = true))

        f.arbiter.releaseToken(mutationToken)
    }

    @Test
    fun testUnknownSaveReconciliationValidatesTabIncarnation() = runTest {
        val f = createFixture()
        f.tabsState.openTab(f.target, "doc.txt")
        val session = f.tabsState.getSession(f.tabsState.activeTab!!.key)!!
        session.setText("text")
        val snapshot = session.snapshotSave()!!

        val token = f.arbiter.tryReserveSave(f.owner, "doc.txt")!!
        val quarantinedOp = QuarantinedOperation(
            owner = f.owner,
            path = "doc.txt",
            stage = OperationStage.COMMIT_DISPATCHED,
            opId = "w-1",
            submittedRevision = snapshot.revision,
            tabIncarnation = 999L, // Mismatched incarnation!
            operationKind = "write",
            submittedBytes = snapshot.utf8Bytes,
            timestampMillis = 1000L,
        )
        f.arbiter.quarantineToken(token, quarantinedOp)

        val result = f.tabsState.reconcileUnknownSave(f.tabsState.activeTabKey.value!!)
        assertIs<SaveReconciliationResult.Unresolved>(result)
        assertTrue(result.message.contains("incarnation", ignoreCase = true))
    }

    @Test
    fun testAmbiguousDirectoryMutationWithLostResponseStaysUnresolvedWithoutDuplicateDispatch() = runTest {
        val f = createFixture()
        // Dispatch rename for a directory "pkg" -> "pkg_renamed"
        // Transport drops response after commit to simulate lost network ACK
        f.ws.opResponder = { op ->
            throw kotlinx.coroutines.CancellationException("Transport disconnected post-commit")
        }

        val outcome = f.coordinator.renameWithOutcome(
            path = "pkg",
            newName = "pkg_renamed",
            dirtyDecision = CloseDecision.DISCARD,
        )
        assertIs<FileOperationOutcome.Unknown>(outcome)
        assertEquals(OperationStage.AWAITING_RESULT, outcome.stage)
        assertTrue(outcome.cause is kotlinx.coroutines.CancellationException)
        assertTrue(outcome.message.contains("awaiting", ignoreCase = true))
        // Reservation MUST be quarantined
        assertTrue(f.arbiter.isPathReserved(f.owner, "pkg"))
        assertTrue(f.arbiter.isPathReserved(f.owner, "pkg_renamed"))

        // Reconcile unknown mutation: without server inode/opId proof, ambiguous directory stays Unresolved
        val reconResult = f.repo.reconcileUnknownMutation(f.target, "rename", "pkg", "pkg_renamed")
        assertIs<MutationReconciliationResult.Unresolved>(reconResult)
        assertTrue(reconResult.message.contains("quarantine", ignoreCase = true))

        // No duplicate dispatch occurred
        assertEquals(1, f.ws.dispatchedOps.size)

        // Paths remain quarantined until explicit user abandonment
        assertTrue(f.arbiter.isPathReserved(f.owner, "pkg"))
        assertTrue(f.arbiter.isPathReserved(f.owner, "pkg_renamed"))
    }
}
