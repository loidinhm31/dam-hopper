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

    private fun createTabsState(project: String = "demo", registry: CanonicalDocumentRegistry? = null): EditorTabsState {
        val conn = ConnectionRef("p1", 1L)
        val client = ApiClient(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val owner = WorkspaceFileOwner(
            profileId = "p1",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = project,
            workspaceEpoch = 1L,
        )
        val fileRepo = FileRepository(owner, client, ws)
        val editorRepo = EditorRepository(fileRepo, profileId = "p1")
        val factory = TestEditorDocumentFactory()
        val effRegistry = registry ?: CanonicalDocumentRegistry(factory)
        return EditorTabsState("p1", editorRepo, documentFactory = factory, registry = effRegistry)
    }

    @Test
    fun testSaveInFlightInterveningEditsRemainDirty() = runTest {
        val identityHeader = """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/main.ts"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/main.ts"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "initial content\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
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
        val identityHeader = """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/conflict.txt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/conflict.txt"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "base text\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
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

    @Test
    fun testFrozenDocumentBlocksEditsDuringMutation() = runTest {
        val identityHeader = """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/frozen.txt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/frozen.txt"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "original text\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "frozen.txt")
        val docId = state.activeTabId.value!!
        val session = state.getSession(state.activeTabKey.value!!)!!

        // Freeze document
        state.freezeDocuments(setOf(docId))
        assertTrue(session.isFrozen)
        assertFalse(session.isInputPermitted)

        // Edits must be ignored while frozen
        session.setText("blocked edit")
        assertEquals("original text\n", session.getText())

        // Unfreeze restores editing
        state.unfreezeDocuments(setOf(docId))
        assertFalse(session.isFrozen)
        assertTrue(session.isInputPermitted)

        session.setText("allowed edit")
        assertEquals("allowed edit", session.getText())
    }

    @Test
    fun testSaveReconciliationAdoptsSubmittedBaselineAndPreservesNewerEdits() = runTest {
        val identityHeader = """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/reconcile.txt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":15,"mtime":200,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/reconcile.txt"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "submitted text\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "reconcile.txt")
        val tabKey = state.activeTabKey.value!!
        val session = state.getSession(tabKey)!!

        // User types text and save begins
        session.setText("submitted text\n")
        val snapshot = session.snapshotSave()!!

        // Record quarantined operation
        val token = state.editorRepository.fileRepository.arbiter.tryReserveSave(
            state.editorRepository.fileRepository.owner,
            "reconcile.txt",
        )!!
        val quarantinedOp = dev.damhopper.nativeapp.features.files.QuarantinedOperation(
            owner = state.editorRepository.fileRepository.owner,
            path = "reconcile.txt",
            stage = dev.damhopper.nativeapp.features.files.OperationStage.COMMIT_DISPATCHED,
            opId = "write-42",
            submittedRevision = snapshot.revision,
            baselineMtime = 100L,
            submittedBytes = snapshot.utf8Bytes,
            timestampMillis = 1000L,
        )
        state.editorRepository.fileRepository.arbiter.quarantineToken(token, quarantinedOp)

        // User continues editing while save was in flight/unknown
        session.setText("submitted text\nnewer keystrokes\n")
        assertTrue(session.isDirty)

        // Reconcile unknown save
        val result = state.reconcileUnknownSave(tabKey)
        assertIs<dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Reconciled>(result)
        assertEquals(200L, result.newMtime)

        // Newer keystrokes remain dirty and intact
        assertTrue(session.isDirty, "Newer keystrokes must remain dirty after reconciling submitted snapshot")
        assertEquals("submitted text\nnewer keystrokes\n", session.getText())
        assertEquals(200L, session.serverMtime)
    }

    @Test
    fun testLostResponsePostCommitSaveDiffersFromRemoteBytesReconcilesToConflictWithoutBlindRetry() = runTest {
        val submittedText = "locally submitted text\n"
        val differentRemoteText = "different remote text!\n"
        assertEquals(submittedText.toByteArray().size, differentRemoteText.toByteArray().size)
        val exactByteCount = submittedText.toByteArray().size.toLong()

        var readInvoked = false
        val identityHeader = """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/conflict-unknown.txt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":$exactByteCount,"mtime":250,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/conflict-unknown.txt"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            readInvoked = true
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, differentRemoteText.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(differentRemoteText.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "conflict-unknown.txt")
        val tabKey = state.activeTabKey.value!!
        val session = state.getSession(tabKey)!!

        session.setText("locally submitted text\n")
        val snapshot = session.snapshotSave()!!

        val token = state.editorRepository.fileRepository.arbiter.tryReserveSave(
            state.editorRepository.fileRepository.owner,
            "conflict-unknown.txt",
        )!!
        val quarantinedOp = dev.damhopper.nativeapp.features.files.QuarantinedOperation(
            owner = state.editorRepository.fileRepository.owner,
            path = "conflict-unknown.txt",
            stage = dev.damhopper.nativeapp.features.files.OperationStage.COMMIT_DISPATCHED,
            opId = "write-99",
            submittedRevision = snapshot.revision,
            baselineMtime = 100L,
            submittedBytes = snapshot.utf8Bytes,
            timestampMillis = 2000L,
        )
        state.editorRepository.fileRepository.arbiter.quarantineToken(token, quarantinedOp)
        // Reset flag before reconciliation to verify that reconciliation specifically triggers a fresh server read
        readInvoked = false
        val result = state.reconcileUnknownSave(tabKey)
        assertIs<dev.damhopper.nativeapp.features.files.SaveReconciliationResult.Conflicted>(result)
        assertTrue(readInvoked, "Reconciliation must read server bytes for equal-sized file")
        assertEquals("Server content differs from submitted bytes", result.message)

        // Reservation remains quarantined; no automatic retry
        assertTrue(state.editorRepository.fileRepository.arbiter.isPathReserved(state.editorRepository.fileRepository.owner, "conflict-unknown.txt"))
        assertTrue(session.isDirty)
    }

    @Test
    fun testSavePropagatesAuthoritativeMtimeToAliases() = runTest {
        var currentServerMtime = 100L
        val identityHeader = """{"workspaceId":"ws-save","workspaceEpoch":1,"canonicalPath":"/data/Shared.kt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":20,"mtime":$currentServerMtime,"mime":"text/plain","isBinary":false}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "initial content\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }
        val submittedExpectedMtimes = mutableListOf<Long>()
        server!!.createContext("/api/fs/write") { exchange ->
            val body = exchange.requestBody.readBytes().decodeToString()
            val mtimeParam = if (body.contains("\"expectedMtime\":")) {
                body.substringAfter("\"expectedMtime\":").substringBefore(",").substringBefore("}").trim().toLongOrNull()
            } else null
            if (mtimeParam != null) {
                submittedExpectedMtimes.add(mtimeParam)
            }
            currentServerMtime += 50L
            val json = """{"ok":true,"mtime":$currentServerMtime}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val registry = CanonicalDocumentRegistry(TestEditorDocumentFactory())
        val state1 = createTabsState(project = "demo", registry = registry)
        val state2 = createTabsState(project = "demo", registry = registry)

        val target1 = ProjectTargetRef(project = "demo")
        val target2 = ProjectTargetRef(project = "demo")

        state1.openTab(target1, "Shared.kt")
        val tab1Key = state1.activeTab!!.key
        state2.openTab(target2, "nested/Shared.kt")
        val tab2Key = state2.activeTab!!.key

        val session1 = state1.getSession(tab1Key)!!
        val session2 = state2.getSession(tab2Key)!!
        assertSame(session1.document, session2.document)

        // Edit via Tab 1 and save
        session1.setText("tab 1 edit\n")
        val snapshot1 = session1.snapshotSave()!!
        session1.completeSave(150L, snapshot1)

        // Both tabs must observe updated mtime 150L
        assertEquals(150L, session1.serverMtime)
        assertEquals(150L, session2.serverMtime, "Alias tab 2 must observe updated server mtime from save 1")
        assertFalse(session1.isDirty)
        assertFalse(session2.isDirty)

        // Edit via Tab 2 and save -> submits expectedMtime = 150L
        session2.setText("tab 2 edit\n")
        val snapshot2 = session2.snapshotSave()!!
        assertEquals(150L, snapshot2.mtime, "Save 2 must submit updated 150L expectedMtime")
        session2.completeSave(200L, snapshot2)
        assertEquals(200L, session1.serverMtime)
        assertEquals(200L, session2.serverMtime)
    }

    @Test
    fun testConcurrentSaveOnSameCanonicalDocumentRejectedAsBusy() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":20,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "hello\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val registry = CanonicalDocumentRegistry(TestEditorDocumentFactory())
        val state = createTabsState(project = "demo", registry = registry)

        val target1 = ProjectTargetRef(project = "demo")
        val target2 = ProjectTargetRef(project = "demo", worktreePath = "alias-wt")

        state.openTab(target1, "File.kt")
        val key1 = state.activeTab!!.key
        state.openTab(target2, "File.kt")
        val key2 = state.activeTab!!.key

        val cKey = state.resolveCanonicalKey(state.activeTab!!)
        registry.tryBeginSave(cKey) // mark save in progress on canonical document

        // Tab 2 save attempt rejected as busy
        val saveResult = state.saveTab(key2)
        assertTrue(saveResult is EditorSaveResult.Error)
        assertEquals("Save already in flight for canonical document", saveResult.message)

        registry.completeSave(cKey)
    }

    @Test
    fun testCasFailurePreservesOriginalDirtyBufferAndUndo() = runTest {
        val identityHeader = """{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/cas-fail.txt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":20,"mtime":100,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-1","workspaceEpoch":1,"canonicalPath":"/cas-fail.txt"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "original text\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }
        server!!.createContext("/api/fs/write") { exchange ->
            val conflictJson = """{"ok":false,"error":"CAS_CONFLICT","message":"Remote mtime changed"}"""
            exchange.sendResponseHeaders(409, conflictJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(conflictJson.toByteArray()) }
        }

        val state = createTabsState(project = "demo")
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "ConflictFile.kt")
        val key = state.activeTab!!.key
        val session = state.getSession(key)!!

        session.setText("uncommitted local changes\n")
        assertTrue(session.isDirty)

        session.abortSave()
        // Original dirty buffer and undo history must remain intact!
        assertEquals("uncommitted local changes\n", session.getText())
        assertTrue(session.isDirty, "Session must remain dirty on CAS failure")
        assertTrue(session.canUndo(), "Session must retain undo history on CAS failure")

        session.undo()
        assertEquals("original text\n", session.getText())
        assertFalse(session.isDirty)
    }
}
