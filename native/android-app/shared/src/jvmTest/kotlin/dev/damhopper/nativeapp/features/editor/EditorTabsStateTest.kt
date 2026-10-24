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

    private fun createTabsState(project: String = "demo"): EditorTabsState {
        val conn = ConnectionRef("p1", 1L)
        val client = ApiClient(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        val owner = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
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
        assertEquals(1, state.openTabs.value.size)
        assertEquals("a.txt", state.openTabs.value[0].title)

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
        assertFalse(state.isFileDirty(target, "foo.txt"))

        val session = state.getSession(state.activeTab!!.key)!!
        session.setText("hello universe\n")
        assertTrue(state.isFileDirty(target, "foo.txt"))
        assertTrue(state.hasDirtyDescendants(target, ""))
        assertEquals(1, state.getDirtyDocumentIds(target, "foo.txt").size)
    }

    @Test
    fun testCloseIntentGuardsDirtyTabs() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "clean text\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "notes.txt")
        val docId = state.activeTabId.value!!

        // Clean close returns null and immediately closes tab
        val cleanIntent = state.requestCloseTab(docId)
        assertNull(cleanIntent)
        assertEquals(0, state.tabs.value.size)

        // Reopen and dirty tab
        state.openTab(target, "notes.txt")
        val newDocId = state.activeTabId.value!!
        val session = state.getSession(state.activeTab!!.key)!!
        session.setText("modified text\n")

        // Dirty close requires intent
        val dirtyIntent = state.requestCloseTab(newDocId)
        assertNotNull(dirtyIntent)
        assertEquals(CloseDecision.SAVE, dirtyIntent.decision)
        assertEquals(1, state.tabs.value.size)

        // Cancel decision keeps tab open
        state.confirmClose(dirtyIntent.copy(decision = CloseDecision.CANCEL))
        assertEquals(1, state.tabs.value.size)

        // Discard decision closes tab and discards edits
        state.confirmClose(dirtyIntent.copy(decision = CloseDecision.DISCARD))
        assertEquals(0, state.tabs.value.size)
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

        assertEquals("local unsaved edits\n", session.getText())
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
        assertEquals("server copy 2\n", session.getText())
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

    @Test
    fun testDiscardIntentProtectsNewerEdits() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":50,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "original text\n"
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "protected.txt")
        val docId = state.activeTabId.value!!
        val session = state.getSession(state.activeTab!!.key)!!

        session.setText("user edit 1\n")
        val intent = state.requestCloseTab(docId)!!
        assertEquals(CloseDecision.SAVE, intent.decision)

        // User types another keystroke AFTER intent created
        session.setText("user edit 1 plus newer keystroke\n")

        // Confirming discard with stale intent is rejected!
        state.confirmClose(intent.copy(decision = CloseDecision.DISCARD))
        assertEquals(1, state.tabs.value.size, "Tab must not be closed when newer edits occurred after consent")
    }

    @Test
    fun testReloadAfterGrowthToLargeReplacesAuthorityWithReadOnlyPreview() = runTest {
        var large = false
        server!!.createContext("/api/fs/stat") { exchange ->
            val size = if (large) 6_000_000L else 50L
            val json = """{"kind":"file","size":$size,"mtime":${if (large) 200 else 100},"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val len = Regex("len=(\\d+)").find(exchange.requestURI.query.orEmpty())?.groupValues?.get(1)?.toInt() ?: 0
            val text = if (large) "P".repeat(len) else "small\n"
            val bytes = text.toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "grow.log")
        val key = state.activeTab!!.key
        val oldSession = state.getSession(key)!!
        assertFalse(oldSession.isReadOnly)

        large = true
        state.reloadTab(key)

        val tab = state.activeTab!!
        assertEquals(FileTier.LARGE, tab.tier)
        val newSession = state.getSession(key)!!
        assertTrue(oldSession.isDisposed)
        assertTrue(newSession.isReadOnly)
        assertNull(newSession.beginSave(), "read-only preview must never be saveable")
        val saved = state.saveTab(key)
        assertTrue(saved is EditorSaveResult.Error)
    }

    @Test
    fun testAuthorityReplaceOnTierChangeInvalidatesPriorCloseIntent() = runTest {
        var degraded = false
        server!!.createContext("/api/fs/stat") { exchange ->
            val size = if (degraded) 2_000_000L else 50L
            val json = """{"kind":"file","size":$size,"mtime":${if (degraded) 200 else 100},"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val bytes = (if (degraded) "D".repeat(2_000_000) else "small\n").toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "tier.txt")
        val key = state.activeTab!!.key
        val oldId = state.activeTabId.value!!
        val s1 = state.getSession(key)!!
        s1.setText("e1")
        s1.setText("e2")
        s1.setText("e3")
        val staleIntent = state.requestCloseTab(oldId)!!
        assertEquals(4L, staleIntent.dirtyRevision)

        // Forced reload across NORMAL -> DEGRADED replaces authority (new revision counter starts at 1).
        degraded = true
        state.discardAndReloadTab(key)
        val s2 = state.getSession(key)!!
        s2.setText("post-reload edit")
        assertEquals(2L, s2.revision)
        assertNotEquals(oldId, state.activeTabId.value)

        // Stale intent from the replaced authority must NOT close the new dirty buffer even though 2 <= 4.
        state.confirmClose(staleIntent.copy(decision = CloseDecision.DISCARD))
        assertEquals(1, state.tabs.value.size)
        assertEquals("post-reload edit", state.getSession(key)!!.getText())
    }

    @Test
    fun testSaveDocumentPortDeniesEncryptedRequiredTabAndForceOverwriteHonorsPrivacy() = runTest {
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":10,"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val bytes = "secret\n".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        val state = createTabsState()
        val target = ProjectTargetRef(project = "demo")
        state.openTab(target, "sec.txt")
        val key = state.activeTab!!.key
        val id = state.activeTabId.value!!
        state.getSession(key)!!.setText("updated secret\n")

        state.toggleEncryptedSession(key)
        val outcome = state.editorRepository.saveDocument(id)
        assertTrue(outcome is dev.damhopper.nativeapp.features.files.FileOperationOutcome.NotSubmitted)
        assertTrue(outcome.reason.contains("Encrypted"))

        state.toggleEncryptedSession(key)
        state.isInputAllowed = { false }
        val ow = state.forceOverwriteTab(key)
        assertTrue(ow is EditorSaveResult.Error)
    }

    private fun serveFile(text: String) {
        val bytes = text.toByteArray()
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":${bytes.size},"mtime":100,"mime":"text/plain","isBinary":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
    }

    @Test
    fun testTogglePreviewFlipsModeWithoutMutatingTextRevisionOrDirtyState() = runTest {
        serveFile("# Title\n\nbody\n")
        val state = createTabsState()
        state.openTab(ProjectTargetRef(project = "demo"), "README.md")
        val key = state.activeTab!!.key
        state.getSession(key)!!.setText("# Edited\n")

        val before = state.activeTab!!
        val metaBefore = state.openTabs.value.single()
        assertTrue(before.isDirty)
        assertFalse(before.previewMode)

        state.togglePreview(key)
        val during = state.activeTab!!
        assertTrue(during.previewMode)
        assertTrue(during.markdownPreviewMode)
        assertEquals(before, during.copy(markdownPreviewMode = false))
        assertEquals(before.content, during.content)
        assertEquals(before.isDirty, during.isDirty)
        assertEquals(before.modelVersion, during.modelVersion)
        assertEquals(before.editEpoch, during.editEpoch)
        assertEquals(before.mtime, during.mtime)
        assertEquals(before.savedContent, during.savedContent)
        val metaDuring = state.openTabs.value.single()
        assertEquals(metaBefore.currentRevision, metaDuring.currentRevision)
        assertEquals(metaBefore.savedRevision, metaDuring.savedRevision)
        assertEquals(metaBefore.isDirty, metaDuring.isDirty)
        assertTrue(state.getSession(key)!!.canUndo())

        state.toggleMarkdownPreview(key)
        assertFalse(state.activeTab!!.previewMode)
        assertEquals(before, state.activeTab)
    }

    @Test
    fun testPreviewSnapshotRejectsSupersededRevision() = runTest {
        serveFile("<p>one</p>\n")
        val state = createTabsState()
        state.openTab(ProjectTargetRef(project = "demo"), "index.html")
        val key = state.activeTab!!.key
        val docId = state.activeTabId.value!!

        val first = state.previewSnapshot(key)!!
        assertEquals(docId, first.documentId)
        assertEquals("<p>one</p>\n", first.text)
        assertFalse(first.isTruncated)
        assertTrue(first.isCurrentFor(docId, state.activeTab!!.modelVersion))

        state.getSession(key)!!.setText("<p>two</p>\n")
        val currentRevision = state.activeTab!!.modelVersion
        assertNotEquals(first.revision, currentRevision)
        assertFalse(first.isCurrentFor(docId, currentRevision), "stale snapshot must be rejected")

        val second = state.previewSnapshot(key)!!
        assertEquals("<p>two</p>\n", second.text)
        assertTrue(second.isCurrentFor(docId, currentRevision))
        assertFalse(second.isCurrentFor(docId, first.revision))
        assertNull(state.previewSnapshot("missing-key"))
    }

    @Test
    fun testPreviewSnapshotTruncatesAtCodeUnitCapAndNeverSplitsSurrogates() = runTest {
        serveFile("a".repeat(20) + "\n")
        val state = createTabsState()
        state.openTab(ProjectTargetRef(project = "demo"), "big.html")
        val key = state.activeTab!!.key

        val truncated = state.previewSnapshot(key, maxChars = 8)!!
        assertTrue(truncated.isTruncated)
        assertEquals("a".repeat(8), truncated.text)
        val whole = state.previewSnapshot(key)!!
        assertFalse(whole.isTruncated)
        assertEquals(21, whole.text.length)

        val docId = state.activeTabId.value!!
        val emoji = "\uD83D\uDE00" // 2 UTF-16 code units
        val cut = buildPreviewSnapshot(docId, 1L, "ab" + emoji + "cd", maxChars = 3)
        assertTrue(cut.isTruncated)
        assertEquals("ab", cut.text)
        assertEquals("ab$emoji", buildPreviewSnapshot(docId, 1L, "ab" + emoji + "cd", maxChars = 4).text)

        val huge = buildPreviewSnapshot(docId, 1L, "x".repeat(PREVIEW_SNAPSHOT_MAX_CHARS + 1), PREVIEW_SNAPSHOT_MAX_CHARS)
        assertTrue(huge.isTruncated)
        assertEquals(1_048_576, huge.text.length)
        assertEquals(1_048_576, PREVIEW_SNAPSHOT_MAX_CHARS)
        assertEquals(
            "Preview truncated to 262,144 characters; view source for complete file.",
            PREVIEW_TRUNCATION_NOTICE,
        )
        val exact = buildPreviewSnapshot(docId, 1L, "x".repeat(PREVIEW_SNAPSHOT_MAX_CHARS), PREVIEW_SNAPSHOT_MAX_CHARS)
        assertFalse(exact.isTruncated)
    }
}
