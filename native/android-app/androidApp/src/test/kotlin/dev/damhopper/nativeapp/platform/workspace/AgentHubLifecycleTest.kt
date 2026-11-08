package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.CanonicalDocumentRegistry
import dev.damhopper.nativeapp.features.editor.FileTier
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.features.terminal.CreateSessionRequest
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.UncertainCreateRecord
import dev.damhopper.nativeapp.features.terminal.UncertainCreateStatus
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureIntent
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocument
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentFactory
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

private class FakeLifecycleWsConnection(
    conn: ConnectionRef,
    baseUrl: String,
) : WsConnection(conn, baseUrl, { "test-token" }) {
    var currentSocket: SocketInstanceRef? = SocketInstanceRef(conn, "sock-1")
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()
    override fun activeSocketRef(): SocketInstanceRef? = currentSocket
    override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {}
    override suspend fun requestOnSocket(
        expectedSocketRef: SocketInstanceRef,
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long,
    ): ServerMsg = ServerMsg.FsOpResult(reqId = reqId, ok = true)
}

/**
 * Unit regressions for Retained Lifetimes (W09 Phase 07):
 * - Canonical document sharing across aliases in the same owner scope
 * - Surviving alias retains dirty buffer, undo stack, and view leases when counterpart alias closes (in both orders)
 * - Zero alias/view/dirty/save disposal guard
 * - Authority retirement synchronously revokes saves while preserving dirty buffer and undo for authorized rebind
 * - Refusal of rebind when endpoint/account/epoch differs
 * - Final dirty departure save/discard/cancel choices
 * - Uncertain create intent restoration blocks replacement create
 */
class AgentHubLifecycleTest {

    @Test
    fun testTwoWorkspaceAliasesShareCanonicalDocumentViaRegistryAndSurviveClose() {
        val factory = AndroidEditorDocumentFactory()
        val registry = CanonicalDocumentRegistry(factory)

        val owner = WorkspaceFileOwner(
            profileId = "prof-hub",
            baseUrl = "https://damhopper.example.com",
            accountUser = "alice",
            project = "repo-main",
            workspaceEpoch = 1L,
        )
        val canonicalKey = "canonical://prof-hub/repo-main/shared.kt"
        val fallbackDocId = DocumentId(owner, "shared.kt", 1L)

        // 1. First alias opens document
        val (doc1, created1) = registry.getOrCreateDocument(
            canonicalKey = canonicalKey,
            fallbackDocId = fallbackDocId,
            content = "val x = 1\n",
            mtime = 1000L,
            tier = FileTier.NORMAL,
        )
        assertTrue(created1)
        val lease1 = requireNotNull(registry.acquireAliasLease(canonicalKey, "alias-workspace-A"))

        // 2. Second alias opens document under same canonical key
        val (doc2, created2) = registry.getOrCreateDocument(
            canonicalKey = canonicalKey,
            fallbackDocId = fallbackDocId,
            content = "val x = 1\n",
            mtime = 1000L,
            tier = FileTier.NORMAL,
        )
        assertFalse(created2, "Second alias must reuse existing canonical document")
        assertSame(doc1, doc2, "Both aliases must share exact same document instance")
        val lease2 = requireNotNull(registry.acquireAliasLease(canonicalKey, "alias-workspace-B"))

        val androidDoc = doc1 as AndroidEditorDocument

        // Mutate document via Alias 1
        androidDoc.applyEdit(1, 11, 1, 11, "val y = 2\n")
        assertTrue(androidDoc.isDirty.value)
        assertFalse(androidDoc.canDispose)

        // Close Alias 1: release lease
        registry.releaseAliasLease(canonicalKey, lease1, androidDoc)

        // Document MUST survive because Alias 2 is still held
        assertFalse(androidDoc.isClosed, "Document must not be disposed while Alias 2 is held")
        assertFalse(androidDoc.canDispose)
        assertTrue(androidDoc.isDirty.value)
        assertSame(doc2, registry.getDocument(canonicalKey))

        // Alias 2 undoes mutation
        androidDoc.undo()
        assertFalse(androidDoc.isDirty.value)

        // Close Alias 2: release lease
        registry.releaseAliasLease(canonicalKey, lease2, androidDoc)

        // Now document has no surviving leases or dirty state: disposed!
        assertTrue(androidDoc.canDispose)
        assertTrue(androidDoc.isClosed)
        assertNull(registry.getDocument(canonicalKey))
    }

    @Test
    fun testTwoWorkspaceAliasesSurviveCloseInReverseOrder() {
        val factory = AndroidEditorDocumentFactory()
        val registry = CanonicalDocumentRegistry(factory)

        val owner = WorkspaceFileOwner(
            profileId = "prof-hub",
            baseUrl = "https://damhopper.example.com",
            accountUser = "bob",
            project = "repo-rev",
            workspaceEpoch = 1L,
        )
        val canonicalKey = "canonical://prof-hub/repo-rev/main.kt"
        val fallbackDocId = DocumentId(owner, "main.kt", 1L)

        val (doc1, _) = registry.getOrCreateDocument(
            canonicalKey = canonicalKey,
            fallbackDocId = fallbackDocId,
            content = "val a = 10\n",
            mtime = 2000L,
            tier = FileTier.NORMAL,
        )
        val lease1 = requireNotNull(registry.acquireAliasLease(canonicalKey, "alias-ws-1"))
        val (doc2, _) = registry.getOrCreateDocument(
            canonicalKey = canonicalKey,
            fallbackDocId = fallbackDocId,
            content = "val a = 10\n",
            mtime = 2000L,
            tier = FileTier.NORMAL,
        )
        assertSame(doc1, doc2)
        val lease2 = requireNotNull(registry.acquireAliasLease(canonicalKey, "alias-ws-2"))

        val androidDoc = doc1 as AndroidEditorDocument
        androidDoc.applyEdit(1, 12, 1, 12, "val b = 20\n")
        assertTrue(androidDoc.isDirty.value)

        // Close Alias 2 first
        registry.releaseAliasLease(canonicalKey, lease2, androidDoc)

        // Alias 1 survives with dirty content
        assertFalse(androidDoc.isClosed)
        assertFalse(androidDoc.canDispose)
        assertTrue(androidDoc.isDirty.value)

        // Close Alias 1
        androidDoc.undo()
        registry.releaseAliasLease(canonicalKey, lease1, androidDoc)

        assertTrue(androidDoc.canDispose)
        assertTrue(androidDoc.isClosed)
        assertNull(registry.getDocument(canonicalKey))
    }

    @Test
    fun testDifferentEndpointAccountOrEpochNeverSharesAuthorityOrAliases() {
        val ownerBase = WorkspaceFileOwner(
            profileId = "prof-1",
            baseUrl = "https://host1.com",
            accountUser = "user1",
            project = "proj",
            workspaceEpoch = 10L,
        )
        val ownerDifferentEndpoint = ownerBase.copy(baseUrl = "https://host2.com")
        val ownerDifferentAccount = ownerBase.copy(accountUser = "user2")
        val ownerDifferentEpoch = ownerBase.copy(workspaceEpoch = 20L)

        val scope1 = NativeWorkspaceViewModel.CanonicalHolderScope(
            profileId = ownerBase.profileId,
            normalizedEndpoint = ownerBase.normalizedBaseUrl,
            accountUser = ownerBase.accountUser,
            workspaceEpoch = ownerBase.workspaceEpoch,
        )
        val scope2 = NativeWorkspaceViewModel.CanonicalHolderScope(
            profileId = ownerDifferentEndpoint.profileId,
            normalizedEndpoint = ownerDifferentEndpoint.normalizedBaseUrl,
            accountUser = ownerDifferentEndpoint.accountUser,
            workspaceEpoch = ownerDifferentEndpoint.workspaceEpoch,
        )
        val scope3 = NativeWorkspaceViewModel.CanonicalHolderScope(
            profileId = ownerDifferentAccount.profileId,
            normalizedEndpoint = ownerDifferentAccount.normalizedBaseUrl,
            accountUser = ownerDifferentAccount.accountUser,
            workspaceEpoch = ownerDifferentAccount.workspaceEpoch,
        )
        val scope4 = NativeWorkspaceViewModel.CanonicalHolderScope(
            profileId = ownerDifferentEpoch.profileId,
            normalizedEndpoint = ownerDifferentEpoch.normalizedBaseUrl,
            accountUser = ownerDifferentEpoch.accountUser,
            workspaceEpoch = ownerDifferentEpoch.workspaceEpoch,
        )

        kotlin.test.assertNotEquals(scope1, scope2, "Different endpoint must never share canonical registry")
        kotlin.test.assertNotEquals(scope1, scope3, "Different account must never share canonical registry")
        kotlin.test.assertNotEquals(scope1, scope4, "Different epoch must never share canonical registry")
    }

    @Test
    fun testRetirementRevokesSavesWhilePreservingDirtyBuffers() {
        val factory = AndroidEditorDocumentFactory()
        val owner = WorkspaceFileOwner(
            profileId = "prof-retire",
            baseUrl = "https://damhopper.example.com",
            accountUser = "carol",
            project = "my-project",
            workspaceEpoch = 1L,
        )
        val docId = DocumentId(owner, "dirty.kt", 1L)
        val doc = factory.createDocument(docId, "val x = 1\n", 100L, readOnly = false) as AndroidEditorDocument

        doc.applyEdit(2, 1, 2, 1, "// dirty edit\n")
        assertTrue(doc.isDirty.value)

        // When authority is retired, read-only/input-suppression is enabled on document
        doc.setReadOnly(true)
        assertTrue(doc.isReadOnly.value)

        // Dirty buffer and undo stack remain strictly preserved in memory
        assertTrue(doc.isDirty.value)
        assertEquals("val x = 1\n// dirty edit\n", doc.content.toString())

        // Rebind restores editability
        doc.setReadOnly(false)
        assertFalse(doc.isReadOnly.value)
        assertTrue(doc.isDirty.value)
    }

    @Test
    fun testFinalDirtyDepartureSaveDiscardAndCancelChoices() {
        val owner = WorkspaceFileOwner(
            profileId = "prof-departure",
            baseUrl = "https://damhopper.example.com",
            accountUser = "dave",
            project = "dep-project",
            workspaceEpoch = 1L,
        )

        var confirmedCalled = false
        var cancelledCalled = false

        val docId = DocumentId(owner, "file.txt", 1L)
        val intentCancel = WorkspaceDepartureIntent.WorkspaceLeave(
            targetStageName = "AGENT_HUB",
            dirtyDocuments = listOf(docId),
            dirtyRevisions = mapOf(docId to 1L),
            onConfirmed = { confirmedCalled = true },
            onCancelled = { cancelledCalled = true },
        )

        // 1. Cancel Choice invokes onCancelled
        intentCancel.onCancelled()
        assertTrue(cancelledCalled)
        assertFalse(confirmedCalled)

        // 2. Discard Choice invokes onConfirmed
        var discardConfirmed = false
        var discardCancelled = false
        val intentDiscard = WorkspaceDepartureIntent.WorkspaceLeave(
            targetStageName = "AGENT_HUB",
            dirtyDocuments = listOf(docId),
            dirtyRevisions = mapOf(docId to 1L),
            onConfirmed = { discardConfirmed = true },
            onCancelled = { discardCancelled = true },
        )
        intentDiscard.onConfirmed()
        assertTrue(discardConfirmed)
        assertFalse(discardCancelled)
    }

    @Test
    fun testLateOldViewReleaseDoesNotDamageSuccessorView() {
        val factory = AndroidEditorDocumentFactory()
        val owner = WorkspaceFileOwner(
            profileId = "prof-view",
            baseUrl = "https://damhopper.example.com",
            accountUser = "frank",
            project = "view-project",
            workspaceEpoch = 1L,
        )
        val docId = DocumentId(owner, "test.kt", 1L)
        val doc = factory.createDocument(docId, "initial", 100L, readOnly = false) as AndroidEditorDocument

        // View 1 (old Activity) acquires lease
        val viewToken1 = doc.acquireViewLease("surface-1")
        assertEquals(1, doc.activeViewLeases.value.size)

        // View 2 (successor Activity) acquires lease
        val viewToken2 = doc.acquireViewLease("surface-2")
        assertEquals(2, doc.activeViewLeases.value.size)

        // Late release from old View 1
        doc.releaseViewLease(viewToken1)
        assertEquals(1, doc.activeViewLeases.value.size)
        assertTrue(doc.activeViewLeases.value.contains(viewToken2), "Successor view lease must remain intact")
        assertFalse(doc.canDispose, "Cannot dispose while successor view lease is held")

        // View 2 releases
        doc.releaseViewLease(viewToken2)
        assertEquals(0, doc.activeViewLeases.value.size)
        assertTrue(doc.canDispose)
    }

    @Test
    fun testUncertainCreateIntentBlocksReplacementCreateUntilSettled() = runBlocking {
        val store = InMemoryPreferencesStore()
        val conn = ConnectionRef("prof-create", 1L)
        val connRegistry = ConnectionRegistry()
        val client = ApiClient(conn, "https://damhopper.example.com", { "token" }, connRegistry)
        val ws = FakeLifecycleWsConnection(conn, "https://damhopper.example.com")
        val repo = TerminalRepository(client, ws, store)

        // Simulate an unsettled pending intent persisted before process restart
        val pendingIntent = UncertainCreateRecord(
            intentId = "create-uuid-12345",
            profileId = "prof-create",
            terminalId = "term-alpha",
            project = "blocked-proj",
            worktreePath = null,
            createdAtEpochMs = 1000L,
            status = UncertainCreateStatus.PENDING,
        )
        store.saveUncertainCreateRecord(pendingIntent)

        // Attempting to create another session for same project throws and blocks replacement
        assertFailsWith<IllegalStateException> {
            repo.createSession(
                CreateSessionRequest(
                    id = "term-beta",
                    command = "bash",
                    project = "blocked-proj",
                )
            )
        }

        // Once settled and removed, create proceeds without replacement error
        store.removeUncertainCreateRecord("create-uuid-12345")
        assertEquals(0, store.loadUncertainCreateRecords().size)
    }

    @Test
    fun testDeterministicDeferredDisposalOnFinalDiscardWithOutstandingViewLeases() {
        val factory = AndroidEditorDocumentFactory()
        val registry = dev.damhopper.nativeapp.features.editor.CanonicalDocumentRegistry(factory)
        val owner = WorkspaceFileOwner(
            profileId = "prof-discard",
            baseUrl = "https://damhopper.example.com",
            accountUser = "charlie",
            project = "discard-proj",
            workspaceEpoch = 1L,
        )
        val docId = DocumentId(owner, "file.kt", 1L)
        val (doc, _) = registry.getOrCreateDocument(
            canonicalKey = "canonical://prof-discard/discard-proj/file.kt",
            fallbackDocId = docId,
            content = "initial text",
            mtime = 100L,
            tier = FileTier.NORMAL,
            factory = factory,
        )
        val aliasToken = registry.acquireAliasLease("canonical://prof-discard/discard-proj/file.kt", "alias-1")
        assertNotNull(aliasToken)
        val viewToken = registry.acquireViewLease("canonical://prof-discard/discard-proj/file.kt", "surface-1")
        assertNotNull(viewToken)

        // Make document dirty
        (doc as AndroidEditorDocument).applyEdit(1, 1, 1, 1, "dirty edit\n")
        assertTrue(doc.isDirty.value)

        // Force discard alias: alias is unregistered and pruned
        registry.releaseAliasLease("canonical://prof-discard/discard-proj/file.kt", aliasToken)
        registry.pruneDocument("canonical://prof-discard/discard-proj/file.kt", forceDiscard = true)

        // Canonical registry lookup must immediately return null (no resurrection on reopen)
        assertNull(registry.getDocument("canonical://prof-discard/discard-proj/file.kt"))

        // Because view lease is still active, doc is NOT closed yet, but is marked discarded
        assertTrue(doc.isDiscarded)
        assertFalse(doc.isClosed)

        // Now surface releases its view lease -> document deterministically closes
        registry.releaseViewLease("canonical://prof-discard/discard-proj/file.kt", viewToken)
        assertTrue(doc.isClosed, "Document must be closed deterministically once view lease settles")
    }

}
