package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorTabsState
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentFactory
import dev.damhopper.nativeapp.features.files.FileMutationCoordinator
import dev.damhopper.nativeapp.features.files.FileOperationArbiter
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.FileTreeState
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.ui.screens.ProjectTerminalState
import dev.damhopper.nativeapp.features.git.GitOperationScope
import dev.damhopper.nativeapp.features.git.GitWorkspaceRuntime
import dev.damhopper.nativeapp.features.git.GitRepository
import dev.damhopper.nativeapp.features.git.WorkspaceGitSafety
import kotlin.test.assertFailsWith
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeTestWsConnection(
    conn: ConnectionRef,
    baseUrl: String,
) : WsConnection(conn, baseUrl, { "test-token" }) {
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()
    override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: ClientMsg) {}
    override suspend fun requestOnSocket(
        expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef,
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long,
    ): ServerMsg = ServerMsg.FsOpResult(reqId = reqId, ok = true)
}

class GitWorkspaceRuntimeBindingTest {

    @Test
    fun sameOwnerAcrossGenerationsRetainsSharedArbiterAndDocumentBuffers() = runBlocking {
        val owner = WorkspaceFileOwner(
            profileId = "prof-git",
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "verified-user",
            project = "git-repo",
        )
        val target = owner.toProjectTargetRef()
        val conn1 = ConnectionRef("prof-git", 1L)
        val registry = ConnectionRegistry()
        val client1 = ApiClient(conn1, owner.normalizedBaseUrl, { "token" }, registry)
        val ws1 = FakeTestWsConnection(conn1, owner.normalizedBaseUrl)

        val sharedArbiter = FileOperationArbiter()
        val fileRepo1 = FileRepository(owner, client1, ws1, arbiter = sharedArbiter)
        val editorRepo1 = EditorRepository(fileRepo1, registry, "prof-git")
        val tabsState = EditorTabsState("prof-git", editorRepo1)
        val treeState = FileTreeState(target, fileRepo1)
        val mutationCoordinator = FileMutationCoordinator(fileRepo1, treeState, tabsState, sharedArbiter, tabsState)
        val terminalState = ProjectTerminalState(target.project, conn1, ownerScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined), owner = owner)

        val workspaceState = ProjectWorkspaceState(
            owner = owner,
            target = target,
            initialFileRepository = fileRepo1,
            initialEditorRepository = editorRepo1,
            editorTabsState = tabsState,
            fileTreeState = treeState,
            fileMutationCoordinator = mutationCoordinator,
            terminalState = terminalState,
            coroutineScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
        )

        val token = sharedArbiter.tryReserveSave(owner, "README.md")
        assertNotNull(token)
        assertTrue(sharedArbiter.isPathReserved(owner, "README.md"))

        // Generation bump: rebind transports retaining same owner and shared arbiter
        val conn2 = ConnectionRef("prof-git", 2L)
        val client2 = ApiClient(conn2, owner.normalizedBaseUrl, { "token" }, registry)
        val ws2 = FakeTestWsConnection(conn2, owner.normalizedBaseUrl)
        val fileRepo2 = FileRepository(owner, client2, ws2, arbiter = sharedArbiter)
        val editorRepo2 = EditorRepository(fileRepo2, registry, "prof-git")

        val rebindOk = workspaceState.rebindTransports(fileRepo2, editorRepo2, conn2)
        assertTrue(rebindOk)

        // Verify arbiter reservation is intact
        assertTrue(sharedArbiter.isPathReserved(owner, "README.md"))
        assertFalse(workspaceState.isAuthorityRetired.value)
    }

    @Test
    fun rebindWithMismatchedOwnerIsRejectedAndRevoked() = runBlocking {
        val owner1 = WorkspaceFileOwner(
            profileId = "prof-git",
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "alice",
            project = "git-repo",
        )
        val conn1 = ConnectionRef("prof-git", 1L)
        val registry = ConnectionRegistry()
        val client1 = ApiClient(conn1, owner1.normalizedBaseUrl, { "token" }, registry)
        val ws1 = FakeTestWsConnection(conn1, owner1.normalizedBaseUrl)

        val fileRepo1 = FileRepository(owner1, client1, ws1)
        val editorRepo1 = EditorRepository(fileRepo1, registry, "prof-git")
        val tabsState = EditorTabsState("prof-git", editorRepo1)
        val treeState = FileTreeState(owner1.toProjectTargetRef(), fileRepo1)
        val mutationCoordinator = FileMutationCoordinator(fileRepo1, treeState, tabsState, fileRepo1.arbiter, tabsState)
        val terminalState = ProjectTerminalState(owner1.project, conn1, ownerScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined), owner = owner1)
        val workspaceState = ProjectWorkspaceState(
            owner = owner1,
            target = owner1.toProjectTargetRef(),
            initialFileRepository = fileRepo1,
            initialEditorRepository = editorRepo1,
            editorTabsState = tabsState,
            fileTreeState = treeState,
            fileMutationCoordinator = mutationCoordinator,
            terminalState = terminalState,
            coroutineScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
        )

        val owner2 = owner1.copy(accountUser = "bob")
        val conn2 = ConnectionRef("prof-git", 2L)
        val client2 = ApiClient(conn2, owner2.normalizedBaseUrl, { "token" }, registry)
        val ws2 = FakeTestWsConnection(conn2, owner2.normalizedBaseUrl)
        val fileRepo2 = FileRepository(owner2, client2, ws2)
        val editorRepo2 = EditorRepository(fileRepo2, registry, "prof-git")

        val rebindOk = workspaceState.rebindTransports(fileRepo2, editorRepo2, conn2)
        assertFalse(rebindOk, "Rebind with mismatched owner must fail")
    }

    @Test
    fun gitOperationScopeEnforcesExactOwnerAndGeneration() {
        val owner = WorkspaceFileOwner(
            profileId = "prof-scope",
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "verified-user",
            project = "git-project",
            worktreePath = "worktree-1",
        )
        val conn1 = ConnectionRef("prof-scope", 1L)
        val scope1 = GitOperationScope.from(owner, conn1)

        assertEquals("prof-scope", scope1.profileId)
        assertEquals("git-project", scope1.project)
        assertEquals("worktree-1", scope1.worktreePath)
        assertEquals(1L, scope1.generation)
        assertTrue(scope1.matches(scope1.copy()))

        // Generation advance yields non-matching scope
        val conn2 = ConnectionRef("prof-scope", 2L)
        val scope2 = GitOperationScope.from(owner, conn2)
        assertFalse(scope1.matches(scope2))

        // Mismatched account user yields non-matching scope
        val otherOwner = owner.copy(accountUser = "other-user")
        val otherScope = GitOperationScope.from(otherOwner, conn1)
        assertFalse(scope1.matches(otherScope))

        // Profile mismatch in from() factory throws
        val mismatchedConn = ConnectionRef("other-profile", 1L)
        assertFailsWith<IllegalArgumentException> {
            GitOperationScope.from(owner, mismatchedConn)
        }
    }

    @Test
    fun gitWorkspaceRuntimeLifecycleAndRebinding() = runBlocking {
        val owner = WorkspaceFileOwner(
            profileId = "prof-git-rt",
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "verified-user",
            project = "git-project",
        )
        val target = owner.toProjectTargetRef()
        val conn1 = ConnectionRef("prof-git-rt", 1L)
        val client1 = ApiClient(conn1, owner.normalizedBaseUrl, { "token" })
        val ws1 = FakeTestWsConnection(conn1, owner.normalizedBaseUrl)
        val fileRepo = FileRepository(owner, client1, ws1)
        val editorRepo = EditorRepository(fileRepo, profileId = "prof-git-rt")
        val testScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined)
        val tabsState = EditorTabsState("prof-git-rt", editorRepo)
        val treeState = FileTreeState(target, fileRepo)
        val mutationCoordinator = FileMutationCoordinator(fileRepo, treeState, tabsState, FileOperationArbiter(), tabsState)
        val wsState = ProjectWorkspaceState(
            owner = owner,
            target = target,
            initialFileRepository = fileRepo,
            initialEditorRepository = editorRepo,
            editorTabsState = tabsState,
            fileTreeState = treeState,
            fileMutationCoordinator = mutationCoordinator,
            coroutineScope = testScope,
        )

        val safety1 = WorkspaceGitSafety(
            boundOwner = owner,
            connectionGetter = { conn1 },
            fileRepositoryGetter = { fileRepo },
            editorRepositoryGetter = { editorRepo },
            terminalRepositoryGetter = { null },
            workspaceStateGetter = { wsState },
            retainedDirtyDocsProvider = { emptyList() },
        )
        val runtime1 = GitWorkspaceRuntime(
            owner = owner,
            connection = conn1,
            repository = GitRepository(client1),
            presentation = wsState.gitState,
            safety = safety1,
            coroutineScope = this,
        )

        assertTrue(wsState.bindGitRuntime(runtime1))
        assertEquals(runtime1, wsState.gitRuntime)

        // Panel selection
        wsState.selectPanel(WorkspacePanel.GIT)
        assertEquals(WorkspacePanel.GIT, wsState.activePanel.value)

        // Rebind with new generation revokes old gitRuntime
        val conn2 = ConnectionRef("prof-git-rt", 2L)
        wsState.rebindAuthority(owner, conn2)
        assertNull(wsState.gitRuntime, "Old git runtime must be revoked and unseated on generation change")
        assertFalse(wsState.gitState.isAuthorityValid.value)

        // Rebinding with mismatched owner is rejected
        val wrongOwner = owner.copy(profileId = "wrong-prof")
        val connWrong = ConnectionRef("wrong-prof", 1L)
        val safety2 = WorkspaceGitSafety(
            boundOwner = wrongOwner,
            connectionGetter = { connWrong },
            fileRepositoryGetter = { fileRepo },
            editorRepositoryGetter = { editorRepo },
            terminalRepositoryGetter = { null },
            workspaceStateGetter = { wsState },
            retainedDirtyDocsProvider = { emptyList() },
        )
        val runtimeWrong = GitWorkspaceRuntime(
            owner = wrongOwner,
            connection = connWrong,
            repository = GitRepository(client1),
            presentation = wsState.gitState,
            safety = safety2,
            coroutineScope = this,
        )
        assertFalse(wsState.bindGitRuntime(runtimeWrong))
    }
}
