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
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.FileTreeState
import dev.damhopper.nativeapp.features.git.GitMutationImpact
import dev.damhopper.nativeapp.features.git.GitOperationScope
import dev.damhopper.nativeapp.features.git.WorkspaceGitSafety
import dev.damhopper.nativeapp.features.git.WorktreeRemovalPrecheck
import dev.damhopper.nativeapp.features.git.GitMutationEvent
import dev.damhopper.nativeapp.features.git.GitOutcomeKind
import dev.damhopper.nativeapp.features.git.VcsRoot
import dev.damhopper.nativeapp.features.terminal.TerminalQualifiedKey
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.terminal.UncertainCreateRecord
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.screens.ProjectTerminalState
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
private class SafetyTestWsConnection(
    conn: ConnectionRef,
    baseUrl: String,
) : WsConnection(conn, baseUrl, { "test-token" }) {
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()
    override fun activeSocketRef(): SocketInstanceRef? = SocketInstanceRef(connection, "sock-safety-1")
    override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {
        if (msg is ClientMsg.FsWriteCommit) {
            _boundFlow.emit(
                SocketBoundMessage(
                    expectedSocketRef,
                    ServerMsg.FsWriteResult(writeId = msg.writeId, ok = true, newMtime = 200L),
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
    ): ServerMsg = when (msg) {
        is ClientMsg.FsWriteBegin -> ServerMsg.FsWriteAck(reqId = reqId, writeId = 99uL)
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

class GitWorkspaceSafetyTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private var terminalDetailedResponse: String = "[]"

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        val identityHeader = """{"workspaceId":"ws-git","workspaceEpoch":1,"canonicalPath":"/Main.kt"}"""
        server!!.createContext("/api/fs/stat") { exchange ->
            val json = """{"kind":"file","size":25,"mtime":10,"mime":"text/plain","isBinary":false,"fileIdentity":{"workspaceId":"ws-git","workspaceEpoch":1,"canonicalPath":"/Main.kt"}}"""
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/fs/read") { exchange ->
            val text = "fun main() = println()\n"
            exchange.responseHeaders.set("X-File-Identity", identityHeader)
            exchange.sendResponseHeaders(200, text.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(text.toByteArray()) }
        }
        server!!.createContext("/api/terminal/detailed") { exchange ->
            val json = terminalDetailedResponse
            exchange.responseHeaders.set("X-DamHopper-PTY-Epoch", "00000000-0000-0000-0000-000000000000")
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.start()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createFixture(): Pair<ProjectWorkspaceState, WorkspaceGitSafety> {
        val owner = WorkspaceFileOwner(
            profileId = "prof-safety",
            baseUrl = "http://127.0.0.1:$serverPort",
            accountUser = "test-user",
            project = "safety-proj",
            worktreePath = null,
        )
        val target = owner.toProjectTargetRef()
        val conn = ConnectionRef("prof-safety", 1L)
        val registry = ConnectionRegistry()
        kotlinx.coroutines.runBlocking { registry.getOrCreateConnection("prof-safety") }
        val apiClient = ApiClient(conn, owner.normalizedBaseUrl, { "token" }, registry)
        val ws = SafetyTestWsConnection(conn, owner.normalizedBaseUrl)

        val fileRepo = FileRepository(owner, apiClient, ws)
        val editorRepo = EditorRepository(fileRepo, registry, "prof-safety")
        val tabsState = EditorTabsState("prof-safety", editorRepo, TestEditorDocumentFactory())
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

        val targetStore = ProjectTargetStore()
        val flowNav = AppFlowNavigation()
        flowNav.onProfileAuthenticated("prof-safety")
        flowNav.selectProject("safety-proj")

        val safety = WorkspaceGitSafety(
            boundOwner = owner,
            connectionGetter = { conn },
            fileRepositoryGetter = { fileRepo },
            editorRepositoryGetter = { editorRepo },
            terminalRepositoryGetter = { TerminalRepository(apiClient, ws) },
            workspaceStateGetter = { workspaceState },
            retainedDirtyDocsProvider = { o ->
                if (o == owner) workspaceState.getDirtyDocumentIds() else emptyList()
            },
            targetStore = targetStore,
            flowNavigation = flowNav,
        )

        return workspaceState to safety
    }

    @Test
    fun guardedTargetTransitionSmoke() = runTest {
        val (workspace, safety) = createFixture()
        val nav = safety.flowNavigation!!
        val store = safety.targetStore!!

        // Open a tab and make it dirty
        workspace.selectPanel(WorkspacePanel.EDITOR)
        workspace.editorTabsState.openTab(workspace.target, "Dirty.kt")
        val docId = workspace.editorTabsState.activeTabId.value!!
        val doc = workspace.editorTabsState.getDocument(docId)!!
        doc.applyEdit(1, 1, 1, 1, "dirty edit\n")
        assertTrue(doc.isDirty.value)
        assertTrue(workspace.hasDirtyDocuments())

        var guardProceed: (() -> Unit)? = null
        var guardCancel: (() -> Unit)? = null
        nav.departureGuard = { req ->
            guardProceed = req.onProceed
            guardCancel = req.onCancelled
            true
        }

        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))
        val newTarget = ProjectTargetRef("prof-safety", "safety-proj", "worktrees/feature-1")

        // 1. First attempt: user cancels departure
        val cancelJob = async {
            safety.requestWorktreeSwitch(scope, newTarget)
        }

        // Before guard: no premature flow or store commit
        testScheduler.runCurrent()
        assertEquals(null, nav.state.value.activeWorktreePath)
        assertEquals(null, store.state.value.activeTargetByProject[ProjectTargetStore.projectScopeKey("prof-safety", null, "safety-proj")])

        // Cancel departure
        guardCancel?.invoke()
        testScheduler.runCurrent()
        val cancelResult = cancelJob.await()
        assertTrue(cancelResult.isFailure)
        assertEquals(null, nav.state.value.activeWorktreePath)

        // 2. Second attempt: user saves dirty doc and confirms departure
        val confirmJob = async {
            safety.requestWorktreeSwitch(scope, newTarget)
        }

        val saveOutcome = workspace.editorRepository.saveDocument(docId)
        assertTrue(saveOutcome is dev.damhopper.nativeapp.features.files.FileOperationOutcome.Confirmed)
        assertFalse(workspace.hasDirtyDocuments())

        testScheduler.runCurrent()
        guardProceed?.invoke()
        testScheduler.runCurrent()
        val confirmResult = confirmJob.await()
        // Flow and store committed after revalidation
        assertEquals("worktrees/feature-1", nav.state.value.activeWorktreePath)
        assertEquals("worktrees/feature-1", store.state.value.activeTargetByProject[ProjectTargetStore.projectScopeKey("prof-safety", null, "safety-proj")])
    }

    @Test
    fun preflightRemovalValidations() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        // 1. Primary worktree blocked
        val mainWorktree = ProjectWorktree(path = "main", repositoryPath = "safety-proj", branch = "main", commitHash = "abc1234", isMain = true)
        val mainCheck = safety.preflightRemoval(scope, mainWorktree)
        assertTrue(mainCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue(mainCheck.reasons.any { it.contains("primary/main") })

        // 2. Secondary clean worktree allowed
        val featWorktree = ProjectWorktree(path = "worktrees/feat", repositoryPath = "safety-proj", branch = "feat", commitHash = "def5678", isMain = false)
        val cleanCheck = safety.preflightRemoval(scope, featWorktree)
        assertTrue(cleanCheck is WorktreeRemovalPrecheck.Allowed)
    }

    @Test
    fun withMutationGuardRejectsMismatchedScope() = runTest {
        val (workspace, safety) = createFixture()
        val mismatchedScope = GitOperationScope(
            owner = workspace.owner.copy(profileId = "other-profile"),
            generation = 1L,
        )

        var dispatched = false
        val result = safety.withMutationGuard(mismatchedScope, GitMutationImpact.FILES, emptyList()) {
            dispatched = true
        }

        assertTrue(result.isFailure)
        assertFalse(dispatched)
    }
    @Test
    fun withMutationGuardBlocksWhenDirtyEditorDocumentsExist() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        // Open tab and make dirty
        workspace.editorTabsState.openTab(workspace.target, "Dirty.kt")
        val docId = workspace.editorTabsState.activeTabId.value!!
        val doc = workspace.editorTabsState.getDocument(docId)!!
        doc.applyEdit(1, 1, 1, 1, "dirty edit\n")
        assertTrue(doc.isDirty.value)

        var dispatched = false
        // Mutation on FILES affecting whole target or Dirty.kt must be blocked
        val blockedResult = safety.withMutationGuard(scope, GitMutationImpact.FILES, listOf("Dirty.kt")) {
            dispatched = true
        }
        assertTrue(blockedResult.isFailure)
        assertFalse(dispatched)
        assertTrue(blockedResult.exceptionOrNull()?.message?.contains("unsaved editor changes") == true)

        // Mutation on unaffected file proceeds
        var cleanDispatched = false
        val cleanResult = safety.withMutationGuard(scope, GitMutationImpact.FILES, listOf("Clean.kt")) {
            cleanDispatched = true
            "ok"
        }
        assertTrue(cleanResult.isSuccess)
        assertTrue(cleanDispatched)
        assertEquals("ok", cleanResult.getOrNull())
    }
    @Test
    fun destructiveHistoryMutationsLikeDropBlockedWhenDirtyDocumentsExist() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        // Open tab and make dirty
        workspace.editorTabsState.openTab(workspace.target, "ImportantWork.kt")
        val docId = workspace.editorTabsState.activeTabId.value!!
        val doc = workspace.editorTabsState.getDocument(docId)!!
        doc.applyEdit(1, 1, 1, 1, "unsaved work\n")
        assertTrue(doc.isDirty.value)

        var dropDispatched = false
        // Drop commit is a whole-target HISTORY mutation that must be blocked
        val dropResult = safety.withMutationGuard(scope, GitMutationImpact.HISTORY, emptyList()) {
            dropDispatched = true
            "dropped"
        }
        assertTrue(dropResult.isFailure, "Drop must fail when dirty documents exist in target")
        assertFalse(dropDispatched, "Drop dispatch must be blocked")
        val errMsg = dropResult.exceptionOrNull()?.message ?: ""
        assertTrue(errMsg.contains("unsaved editor changes in ImportantWork.kt"))
        assertTrue(errMsg.contains("Save or discard changes first"))
    }

    @Test
    fun invalidPathTranslationFailsClosedWithoutDispatch() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        workspace.editorTabsState.openTab(workspace.target, "Normal.kt")
        val docId = workspace.editorTabsState.activeTabId.value!!
        val doc = workspace.editorTabsState.getDocument(docId)!!
        doc.applyEdit(1, 1, 1, 1, "dirty\n")

        var dispatched = false
        val invalidPathResult = safety.withMutationGuard(
            scope,
            GitMutationImpact.FILES,
            listOf("/absolute/escape.kt")
        ) {
            dispatched = true
        }
        assertTrue(invalidPathResult.isFailure)
        assertFalse(dispatched)
        assertTrue(invalidPathResult.exceptionOrNull()?.message?.contains("invalid path translation") == true)
    }

    @Test
    fun openWorkspaceFileOpensTabInEditor() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        val result = safety.openWorkspaceFile(scope, "NewFile.kt")
        assertTrue(result.isSuccess)
        assertEquals(WorkspacePanel.EDITOR, workspace.activePanel.value)
        assertEquals(1, workspace.editorTabsState.tabs.value.size)
        assertEquals("NewFile.kt", workspace.editorTabsState.tabs.value.first().path)
    }

    @Test
    fun testUnregisteredProjectTargetRefusesGitEntryWithExactReason() = runTest {
        val (workspace, baseSafety) = createFixture()
        val safety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = baseSafety.connectionGetter,
            fileRepositoryGetter = baseSafety.fileRepositoryGetter,
            editorRepositoryGetter = baseSafety.editorRepositoryGetter,
            terminalRepositoryGetter = baseSafety.terminalRepositoryGetter,
            workspaceStateGetter = baseSafety.workspaceStateGetter,
            retainedDirtyDocsProvider = baseSafety.retainedDirtyDocsProvider,
            targetStore = baseSafety.targetStore,
            flowNavigation = baseSafety.flowNavigation,
            registeredProjectsProvider = { listOf("safety-proj") },
        )

        // 1. Literal whole-workspace target rejected
        val workspaceTargetOwner = workspace.owner.copy(project = "workspace")
        val workspaceScope = GitOperationScope.from(workspaceTargetOwner, ConnectionRef("prof-safety", 1L))
        val workspaceResult = safety.withMutationGuard(workspaceScope, GitMutationImpact.FILES, emptyList()) { "ok" }
        assertTrue(workspaceResult.isFailure)
        val wsMsg = workspaceResult.exceptionOrNull()?.message ?: ""
        assertTrue(wsMsg.contains("target 'workspace' is not a registered project"))

        // 2. Unregistered folder target rejected
        val unregisteredOwner = workspace.owner.copy(project = "unregistered-folder")
        val unregisteredScope = GitOperationScope.from(unregisteredOwner, ConnectionRef("prof-safety", 1L))
        val unregisteredResult = safety.withMutationGuard(unregisteredScope, GitMutationImpact.FILES, emptyList()) { "ok" }
        assertTrue(unregisteredResult.isFailure)
        val unregMsg = unregisteredResult.exceptionOrNull()?.message ?: ""
        assertTrue(unregMsg.contains("target 'unregistered-folder' is not a registered project"))
    }

    @Test
    fun testWrongVcsRootRejectsMutationWithoutFallback() = runTest {
        val (workspace, baseSafety) = createFixture()
        val safety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = baseSafety.connectionGetter,
            fileRepositoryGetter = baseSafety.fileRepositoryGetter,
            editorRepositoryGetter = baseSafety.editorRepositoryGetter,
            terminalRepositoryGetter = baseSafety.terminalRepositoryGetter,
            workspaceStateGetter = baseSafety.workspaceStateGetter,
            retainedDirtyDocsProvider = baseSafety.retainedDirtyDocsProvider,
            targetStore = baseSafety.targetStore,
            flowNavigation = baseSafety.flowNavigation,
            vcsRootsProvider = { listOf(VcsRoot(rootId = "primary-root", path = ".", kind = "primary")) },
        )

        val wrongRootScope = GitOperationScope(
            owner = workspace.owner,
            generation = 1L,
            root = "non-existent-submodule-root",
        )

        var dispatched = false
        val result = safety.withMutationGuard(wrongRootScope, GitMutationImpact.FILES, emptyList()) {
            dispatched = true
            "dispatched"
        }
        assertTrue(result.isFailure)
        assertFalse(dispatched)
        val msg = result.exceptionOrNull()?.message ?: ""
        assertTrue(msg.contains("root 'non-existent-submodule-root' does not match any existing VcsRoot"))
    }

    @Test
    fun testDirtyAliasBlocksWorktreeSwitchBranchDeletionAndReset() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        // Open tab on target and make dirty
        workspace.editorTabsState.openTab(workspace.target, "SharedAlias.kt")
        val docId = workspace.editorTabsState.activeTabId.value!!
        val doc = workspace.editorTabsState.getDocument(docId)!!
        doc.applyEdit(1, 1, 1, 1, "dirty edit\n")
        assertTrue(doc.isDirty.value)

        // Retained dirty docs provider queries canonical owner, matching all aliases of that file
        val dirtyList = safety.retainedDirtyDocsProvider(workspace.owner)
        assertEquals(1, dirtyList.size)
        assertEquals("SharedAlias.kt", dirtyList[0].relativePath)

        // 1. Branch deletion (REFS) blocked
        var branchDeleteDispatched = false
        val deleteResult = safety.withMutationGuard(scope, GitMutationImpact.REFS, emptyList()) {
            branchDeleteDispatched = true
        }
        assertTrue(deleteResult.isFailure)
        assertFalse(branchDeleteDispatched)
        assertTrue(deleteResult.exceptionOrNull()?.message?.contains("unsaved editor changes in SharedAlias.kt") == true)

        // 2. Whole-target reset (FILES with empty paths) blocked
        var resetDispatched = false
        val resetResult = safety.withMutationGuard(scope, GitMutationImpact.FILES, emptyList()) {
            resetDispatched = true
        }
        assertTrue(resetResult.isFailure)
        assertFalse(resetDispatched)
        assertTrue(resetResult.exceptionOrNull()?.message?.contains("unsaved editor changes in SharedAlias.kt") == true)

        // 3. Worktree switch without departure guard blocked immediately
        val navWithoutGuard = AppFlowNavigation()
        val directSafety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = safety.connectionGetter,
            fileRepositoryGetter = safety.fileRepositoryGetter,
            editorRepositoryGetter = safety.editorRepositoryGetter,
            terminalRepositoryGetter = safety.terminalRepositoryGetter,
            workspaceStateGetter = safety.workspaceStateGetter,
            retainedDirtyDocsProvider = safety.retainedDirtyDocsProvider,
            flowNavigation = navWithoutGuard,
        )
        val switchResult = directSafety.requestWorktreeSwitch(scope, ProjectTargetRef("prof-safety", "safety-proj", "wt-target"))
        assertTrue(switchResult.isFailure)
        assertTrue(switchResult.exceptionOrNull()?.message?.contains("unsaved editor changes in SharedAlias.kt") == true)
    }

    @Test
    fun testActiveHiddenRestartPendingAndUnknownPtysBlockTransition() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))
        val targetWt = ProjectWorktree(path = "feature-wt", repositoryPath = "safety-proj", branch = "feat", commitHash = "c1", isMain = false)

        // 1. Active terminal session blocks preflight removal
        terminalDetailedResponse = """[
            {"id":"term-live-1","project":"safety-proj","worktreePath":"feature-wt","command":"bash","cwd":"/ws/feature-wt","alive":true,"processState":"running","serverPtyEpoch":"00000000-0000-0000-0000-000000000000","incarnation":1,"incarnationExact":"1"},
            {"id":"term-unrelated","project":"unrelated-proj","worktreePath":"feature-wt","command":"bash","cwd":"/ws/unrelated","alive":true,"processState":"running","serverPtyEpoch":"00000000-0000-0000-0000-000000000000","incarnation":1,"incarnationExact":"1"}
        ]""".trimIndent()
        val activeSafety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = safety.connectionGetter,
            fileRepositoryGetter = safety.fileRepositoryGetter,
            editorRepositoryGetter = safety.editorRepositoryGetter,
            terminalRepositoryGetter = { TerminalRepository(workspace.fileRepository.apiClient) },
            workspaceStateGetter = safety.workspaceStateGetter,
            retainedDirtyDocsProvider = { emptyList() },
        )

        val activeCheck = activeSafety.preflightRemoval(scope, targetWt)
        assertTrue(activeCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue(activeCheck.reasons.any { it.contains("Active terminal session (session term-live-1)") })
        assertFalse(activeCheck.reasons.any { it.contains("term-unrelated") }, "Unrelated project session must not block target")

        // 2. Restart-pending terminal session blocks
        terminalDetailedResponse = """[
            {"id":"term-restart-2","project":"safety-proj","worktreePath":"feature-wt","command":"bash","cwd":"/ws/feature-wt","alive":false,"processState":"running","serverPtyEpoch":"00000000-0000-0000-0000-000000000000","incarnation":1,"incarnationExact":"1","terminationState":"restartPending"}
        ]""".trimIndent()
        val restartSafety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = safety.connectionGetter,
            fileRepositoryGetter = safety.fileRepositoryGetter,
            editorRepositoryGetter = safety.editorRepositoryGetter,
            terminalRepositoryGetter = { TerminalRepository(workspace.fileRepository.apiClient) },
            workspaceStateGetter = safety.workspaceStateGetter,
            retainedDirtyDocsProvider = { emptyList() },
        )

        val restartCheck = restartSafety.preflightRemoval(scope, targetWt)
        assertTrue(restartCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue(restartCheck.reasons.any { it.contains("Restart-pending terminal session (session term-restart-2)") })

        // 3. Unknown state terminal session blocks
        terminalDetailedResponse = """[
            {"id":"term-unknown-3","project":"safety-proj","worktreePath":"feature-wt","command":"bash","cwd":"/ws/feature-wt","alive":false,"processState":"running","serverPtyEpoch":"00000000-0000-0000-0000-000000000000","incarnation":1,"incarnationExact":"1","terminationState":"unknown"}
        ]""".trimIndent()
        val unknownSafety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = safety.connectionGetter,
            fileRepositoryGetter = safety.fileRepositoryGetter,
            editorRepositoryGetter = safety.editorRepositoryGetter,
            terminalRepositoryGetter = { TerminalRepository(workspace.fileRepository.apiClient) },
            workspaceStateGetter = safety.workspaceStateGetter,
            retainedDirtyDocsProvider = { emptyList() },
        )

        val unknownCheck = unknownSafety.preflightRemoval(scope, targetWt)
        assertTrue(unknownCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue(unknownCheck.reasons.any { it.contains("Terminal session in unknown state (session term-unknown-3)") })

        // 4. Hidden session absent from inventory and uncertain create both block
        terminalDetailedResponse = "[]"
        val termState = workspace.terminalState!!
        termState.hiddenSessions.add(
            TerminalQualifiedKey(
                profileId = "prof-safety",
                project = "safety-proj",
                worktreePath = "feature-wt",
                terminalId = "term-hidden-absent",
            )
        )
        termState.uncertainCreates.add(
            UncertainCreateRecord(
                intentId = "intent-1",
                profileId = "prof-safety",
                terminalId = "term-uncertain-create",
                project = "safety-proj",
                worktreePath = "feature-wt",
                createdAtEpochMs = 1000L,
            )
        )

        val emptyInvSafety = WorkspaceGitSafety(
            boundOwner = workspace.owner,
            connectionGetter = safety.connectionGetter,
            fileRepositoryGetter = safety.fileRepositoryGetter,
            editorRepositoryGetter = safety.editorRepositoryGetter,
            terminalRepositoryGetter = { TerminalRepository(workspace.fileRepository.apiClient) },
            workspaceStateGetter = safety.workspaceStateGetter,
            retainedDirtyDocsProvider = { emptyList() },
        )

        val hiddenCheck = emptyInvSafety.preflightRemoval(scope, targetWt)
        assertTrue(hiddenCheck is WorktreeRemovalPrecheck.Blocked)
        assertTrue(hiddenCheck.reasons.any { it.contains("Hidden terminal session absent from inventory (session term-hidden-absent)") })
        assertTrue(hiddenCheck.reasons.any { it.contains("Uncertain pending terminal creation (terminal term-uncertain-create)") })
    }

    @Test
    fun testUnknownMutationOutcomeFailsSafelyWithoutSuccessInvalidation() = runTest {
        val (workspace, safety) = createFixture()
        val scope = GitOperationScope.from(workspace.owner, ConnectionRef("prof-safety", 1L))

        var dispatched = false
        val failResult = safety.withMutationGuard(scope, GitMutationImpact.FILES, listOf("Target.kt")) {
            dispatched = true
            throw RuntimeException("Network pipe broken during Git execution")
        }

        assertTrue(failResult.isFailure)
        assertTrue(dispatched)
        assertEquals("Network pipe broken during Git execution", failResult.exceptionOrNull()?.message)

        // Unknown mutation outcome event does NOT trigger reloadCleanBuffers or corrupt state
        val unknownEvent = GitMutationEvent(
            scope = scope,
            impact = GitMutationImpact.FILES,
            kind = GitOutcomeKind.UNKNOWN,
            paths = listOf("Target.kt"),
            message = "Uncertain transport outcome",
        )
        safety.onMutationOutcome(unknownEvent)
        // Verify workspace is still accessible
        assertNotNull(safety.workspaceStateGetter())
    }
}
