package dev.damhopper.nativeapp.features.files

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.EditorDirtyGuardPort
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

class FileMutationCoordinatorTest {

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
        server!!.start()
        testScope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @AfterTest
    fun tearDown() {
        testScope.cancel()
        server?.stop(0)
    }

    private class FakeMutationWsConnection(
        connection: ConnectionRef,
        baseUrl: String,
    ) : WsConnection(connection, baseUrl, { "test-token" }) {
        var currentSocket: SocketInstanceRef? = SocketInstanceRef(connection, "sock-mut-1")
        val dispatchedOps = CopyOnWriteArrayList<ClientMsg.FsOp>()
        var opResponder: (suspend (ClientMsg.FsOp) -> ServerMsg)? = { op ->
            ServerMsg.FsOpResult(reqId = op.reqId, ok = true)
        }

        override fun activeSocketRef(): SocketInstanceRef? = currentSocket

        override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {}

        override suspend fun requestOnSocket(
            expectedSocketRef: SocketInstanceRef,
            reqId: ULong,
            msg: ClientMsg,
            timeoutMillis: Long,
        ): ServerMsg {
            return when (msg) {
                is ClientMsg.FsSubscribeTree -> ServerMsg.TreeSnapshot(reqId = reqId, subId = 1uL)
                is ClientMsg.FsOp -> {
                    dispatchedOps.add(msg)
                    val responder = opResponder ?: error("No opResponder")
                    responder(msg)
                }
                else -> error("Unexpected ClientMsg: $msg")
            }
        }
    }

    private class FakeDirtyGuardPort(
        val dirtyFiles: MutableSet<String> = mutableSetOf(),
        val dirtyDescendantsOfDir: MutableSet<String> = mutableSetOf(),
    ) : EditorDirtyGuardPort {
        override fun isFileDirty(target: ProjectTargetRef, path: String): Boolean =
            dirtyFiles.contains(path.trim('/'))

        override fun hasDirtyDescendants(target: ProjectTargetRef, dirPath: String): Boolean =
            dirtyDescendantsOfDir.contains(dirPath.trim('/'))

        override fun getDirtyDocumentIds(target: ProjectTargetRef, path: String): List<DocumentId> =
            emptyList()
    }

    private fun createCoordinatorFixture(
        dirtyGuard: EditorDirtyGuardPort? = null,
        arbiter: FileOperationArbiter = FileOperationArbiter(),
    ): Triple<WorkspaceFileOwner, FakeMutationWsConnection, FileMutationCoordinator> {
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
        val client = ApiClient(conn, baseUrl, { "test-token" })
        val ws = FakeMutationWsConnection(conn, baseUrl)
        val repo = FileRepository(owner, client, ws, testScope, arbiter)
        val treeState = FileTreeState(target, repo, testScope)
        val coordinator = FileMutationCoordinator(
            repository = repo,
            treeState = treeState,
            dirtyGuardPort = dirtyGuard,
            arbiter = arbiter,
        )
        return Triple(owner, ws, coordinator)
    }

    @Test
    fun testValidationRootProtectionAndNoForceGitBypass() = runTest {
        val (_, ws, coordinator) = createCoordinatorFixture()

        // Root operations must be rejected before dispatch
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.renameWithOutcome("", "newroot"))
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.moveWithOutcome("", "sub"))
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.deleteWithOutcome("", confirmed = true))

        // Moving directory into itself or its own descendant must be rejected
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.moveWithOutcome("src", "src"))
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.moveWithOutcome("src", "src/main/kotlin"))

        // Protected .git path and force_git bypass must be rejected with zero wire dispatch
        val forceGitResult = coordinator.deleteWithOutcome("README.md", confirmed = true, forceGit = true)
        val rejectedForceGit = assertIs<FileOperationOutcome.Rejected>(forceGitResult)
        assertEquals("FORCE_GIT_PROHIBITED", rejectedForceGit.code)

        val gitDelete = coordinator.deleteWithOutcome(".git/config", confirmed = true)
        assertIs<FileOperationOutcome.Rejected>(gitDelete)

        val gitRename = coordinator.renameWithOutcome(".git", "git_backup")
        assertIs<FileOperationOutcome.Rejected>(gitRename)

        val gitMove = coordinator.moveWithOutcome("README.md", ".git/hooks")
        assertIs<FileOperationOutcome.Rejected>(gitMove)

        assertTrue(ws.dispatchedOps.isEmpty())
    }

    @Test
    fun testValidateNameRejectsColonAndSubmitDialogCatchesIllegalArgumentException() = runTest {
        val (_, ws, coordinator) = createCoordinatorFixture()

        // Name with colon must fail validateName
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            coordinator.validateName("foo:bar")
        }

        // Submitting create file with invalid name containing colon must return NotSubmitted and NOT crash dialog coroutine
        coordinator.openCreateFileDialog(parentPath = "src")
        coordinator.updateDialogDraft("bad:name.kt")
        val outcome = coordinator.submitCurrentDialog()
        val notSubmitted = assertIs<FileOperationOutcome.NotSubmitted>(outcome)
        assertTrue(notSubmitted.reason.contains("Invalid file or directory name") || notSubmitted.reason.contains("Invalid"))

        // Dialog must remain open with error message and isSubmitting = false
        val dialog = assertIs<ExplorerDialogState.CreateFile>(coordinator.dialogState.value)
        assertFalse(dialog.isSubmitting)
        assertNotNull(dialog.errorMessage)
        assertTrue(ws.dispatchedOps.isEmpty())
    }

    @Test
    fun testDeleteRequiresExplicitConfirmationBeforeDispatch() = runTest {
        val (_, ws, coordinator) = createCoordinatorFixture()

        val unconfirmed = coordinator.deleteWithOutcome("README.md", confirmed = false)
        assertIs<FileOperationOutcome.NotSubmitted>(unconfirmed)
        assertTrue(ws.dispatchedOps.isEmpty())

        val confirmed = coordinator.deleteWithOutcome("README.md", confirmed = true)
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(confirmed)
        assertEquals(1, ws.dispatchedOps.size)
        assertEquals("delete", ws.dispatchedOps.single().op)
        assertFalse(ws.dispatchedOps.single().forceGit)
    }

    @Test
    fun testOwnerAndPathQualifiedReservationsBlockConflictingSaveAndAllowNonConflictingSegments() = runTest {
        val arbiter = FileOperationArbiter()
        val (owner, ws, coordinator) = createCoordinatorFixture(arbiter = arbiter)

        // Active save reservation on "src/main/App.kt"
        val saveToken = arbiter.tryReserveSave(owner, "src/main/App.kt")
        assertNotNull(saveToken)

        // Ancestor directory rename/move/delete on "src" or "src/main" must be blocked
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.renameWithOutcome("src", "sources"))
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.moveWithOutcome("src/main", "backup"))
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.deleteWithOutcome("src", confirmed = true))
        assertTrue(ws.dispatchedOps.isEmpty())

        // Segment-aware check: reservation on "a" must NOT block "ab/file.kt"
        val tokenA = arbiter.tryReserveSave(owner, "a")
        assertNotNull(tokenA)
        val createInAb = coordinator.createFileWithOutcome("ab", "file.kt")
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(createInAb)
        assertEquals("ab/file.kt", ws.dispatchedOps.single().path)

        // Releasing saveToken allows "src" rename to proceed
        arbiter.releaseToken(saveToken)
        arbiter.releaseToken(tokenA)

        val renameSrc = coordinator.renameWithOutcome("src", "sources")
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(renameSrc)
        assertFalse(arbiter.isPathReserved(owner, "src"))
        assertFalse(arbiter.isPathReserved(owner, "sources"))
    }

    @Test
    fun testDirtyGuardPortBlocksMutationsOnDirtyFileOrDescendantsAndReleasesReservation() = runTest {
        val dirtyGuard = FakeDirtyGuardPort(
            dirtyFiles = mutableSetOf("README.md"),
            dirtyDescendantsOfDir = mutableSetOf("src"),
        )
        val arbiter = FileOperationArbiter()
        val (owner, ws, coordinator) = createCoordinatorFixture(dirtyGuard = dirtyGuard, arbiter = arbiter)

        // Dirty file blocks rename/move/delete
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.renameWithOutcome("README.md", "DOCS.md"))
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.deleteWithOutcome("README.md", confirmed = true))
        assertFalse(arbiter.isPathReserved(owner, "README.md"))

        // Directory with dirty descendants blocks rename/move/delete
        assertIs<FileOperationOutcome.NotSubmitted>(coordinator.moveWithOutcome("src", "archive"))
        assertFalse(arbiter.isPathReserved(owner, "src"))
        assertFalse(arbiter.isPathReserved(owner, "archive/src"))
        assertTrue(ws.dispatchedOps.isEmpty())

        // Clearing dirty state allows mutation
        dirtyGuard.dirtyFiles.clear()
        val renameClean = coordinator.renameWithOutcome("README.md", "DOCS.md")
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(renameClean)
        assertEquals(1, ws.dispatchedOps.size)
    }

    @Test
    fun testDefiniteFailureRetainsCapturedDialogInputsAndSelectionWithoutOptimisticRekey() = runTest {
        val (owner, ws, coordinator) = createCoordinatorFixture()
        ws.opResponder = { op ->
            ServerMsg.FsOpResult(reqId = op.reqId, ok = false, error = "Target already exists")
        }

        // Select "src/OldName.kt" and open retained Rename dialog
        coordinator.openRenameDialog("src/OldName.kt")
        coordinator.updateDialogDraft("NewName.kt")

        // Submit rename -> server rejects
        val outcome = coordinator.submitCurrentDialog()
        val rejected = assertIs<FileOperationOutcome.Rejected>(outcome)
        assertTrue(rejected.message.contains("Target already exists"))

        // Retained dialog stays open with captured sourcePath, user's draft input, and visible error
        val dialogAfter = assertIs<ExplorerDialogState.Rename>(coordinator.dialogState.value)
        assertEquals("src/OldName.kt", dialogAfter.sourcePath)
        assertEquals("NewName.kt", dialogAfter.draftNewName)
        assertFalse(dialogAfter.isSubmitting)
        assertNull(dialogAfter.unknownOutcome)
        assertNotNull(dialogAfter.errorMessage)
        assertTrue(dialogAfter.errorMessage!!.contains("Target already exists"))

        // Reservation was released so user can edit draft and retry
        assertFalse(coordinator.arbiter.isPathReserved(owner, "src/OldName.kt"))
        assertFalse(coordinator.arbiter.isPathReserved(owner, "src/NewName.kt"))
    }

    @Test
    fun testUnknownOutcomeQuarantinesReservationAndDisablesRetryEvenAfterDialogDismiss() = runTest {
        val (owner, ws, coordinator) = createCoordinatorFixture()
        ws.opResponder = { _ ->
            throw RuntimeException("Socket dropped after fs:op frame transmission")
        }

        coordinator.openMoveDialog(sourcePath = "src/Service.kt", initialDestDirPath = "lib")
        val outcome = coordinator.submitCurrentDialog()
        assertIs<FileOperationOutcome.Unknown>(outcome)

        // Dialog remains open in unresolved state with unknownOutcome populated
        val moveDialog = assertIs<ExplorerDialogState.Move>(coordinator.dialogState.value)
        assertNotNull(moveDialog.unknownOutcome)
        assertFalse(moveDialog.isSubmitting)
        assertTrue(moveDialog.errorMessage!!.contains("Retry is disabled"))

        // Attempting to submit again on the unresolved dialog is a no-op (zero duplicate wire dispatch)
        assertNull(coordinator.submitCurrentDialog())
        assertEquals(1, ws.dispatchedOps.size)

        // Both source and destination remain quarantined in arbiter and unresolvedOperations
        assertTrue(coordinator.isPathUnresolved("src/Service.kt"))
        assertTrue(coordinator.isPathUnresolved("lib/Service.kt"))
        assertTrue(coordinator.arbiter.isPathReserved(owner, "src/Service.kt"))
        assertTrue(coordinator.arbiter.isPathReserved(owner, "lib/Service.kt"))

        // Dismissing the dialog keeps quarantine active; new mutations on source or dest are blocked
        coordinator.dismissDialog()
        assertIs<ExplorerDialogState.None>(coordinator.dialogState.value)

        val retryAttempt = coordinator.moveWithOutcome("src/Service.kt", "lib")
        assertIs<FileOperationOutcome.NotSubmitted>(retryAttempt)
        assertEquals(1, ws.dispatchedOps.size)
    }

    @Test
    fun testConfirmedMutationFollowedByRefreshFailureRemainsConfirmedWithSeparateWarning() = runTest {
        val (_, ws, coordinator) = createCoordinatorFixture()
        ws.opResponder = { op ->
            ServerMsg.FsOpResult(reqId = op.reqId, ok = true)
        }

        // Configure HTTP /api/fs/list to fail with HTTP 500 during post-mutation refresh
        server!!.removeContext("/api/fs/list")
        server!!.createContext("/api/fs/list") { exchange ->
            val err = "Internal Server Error".toByteArray()
            exchange.sendResponseHeaders(500, err.size.toLong())
            exchange.responseBody.use { it.write(err) }
        }

        coordinator.openCreateFileDialog(parentPath = "src")
        coordinator.updateDialogDraft("Created.kt")

        val outcome = coordinator.submitCurrentDialog()
        assertIs<FileOperationOutcome.Confirmed<FsOpOutcome>>(outcome)
        // Dialog closed on confirmed server mutation
        assertIs<ExplorerDialogState.None>(coordinator.dialogState.value)
    }

    @Test
    fun testCopyRemotePathPreservesServerRelativeSemantics() = runTest {
        val (_, _, coordinator) = createCoordinatorFixture()
        var copiedText: String? = null

        val copiedFile = coordinator.copyRemotePath("/src/main/App.kt/") { copiedText = it }
        assertEquals("src/main/App.kt", copiedFile)
        assertEquals("src/main/App.kt", copiedText)

        val copiedRoot = coordinator.copyRemotePath("") { copiedText = it }
        assertEquals(".", copiedRoot)
        assertEquals(".", copiedText)

        val rejectedTraversal = coordinator.copyRemotePath("../outside/secret.txt")
        assertNull(rejectedTraversal)
    }
}
