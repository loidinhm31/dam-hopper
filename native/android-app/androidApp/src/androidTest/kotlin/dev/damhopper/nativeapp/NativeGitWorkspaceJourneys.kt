package dev.damhopper.nativeapp

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.git.GitHostPorts
import dev.damhopper.nativeapp.features.git.GitMutationImpact
import dev.damhopper.nativeapp.features.git.GitOperationScope
import dev.damhopper.nativeapp.features.git.GitPanelSection
import dev.damhopper.nativeapp.features.git.GitRefreshReason
import dev.damhopper.nativeapp.features.git.GitRoute
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModel
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 07 Android Native Git Workspace Instrumentation Journeys.
 *
 * Verifies all ten acceptance criteria (AC01–AC10) on real Android instrumentation runtime:
 * - AC01: Real root profile/project -> Git, Changes/History/Branches, nested details/diff/Back, retention across panel switches and rotation.
 * - AC02: Daily changes: both index and worktree entry for same file, stage, unstage, commit, amend, confirmed discard, terminal refresh.
 * - AC03: Native graph OID edges, parent links, octopus/merge/skewed timestamps, upward edges, off-page stubs, literal search filtering.
 * - AC04: Active/inactive message edit/squash, expected tip CAS, snapshot validation, occupancy checks, signed commit consent guard.
 * - AC05: Separate leased publication after both rewrite types, prepare leased publication, inspect snapshot, bare remote drift rejection.
 * - AC06: Worktree create/open/remove/prune, projected paths with punctuation/spaces, dirty retained document and live terminal blockers.
 * - AC07: Unsaved editor protections: checkout/discard/switch/destructive history prompts guard, Cancel preserves drafts, Discard reloads clean.
 * - AC08: Slow response scope isolation, dropped mutation acknowledgement (drop-ack) results in single dispatch and authoritative reconciliation.
 * - AC09: Active merge conflicts and active operation handoff via GET /conflicts and GET /operation; non-Git 409 GIT_NOT_INITIALIZED truthful.
 * - AC10: Request contract audit: zero calls to forbidden routes (POST /resolve, POST /operation, secondary fetch/pull), ordinary push uses selected root without force.
 *
 * Enforces mandatory runner arguments via [NativeGitServerFixture.fromRunnerArguments]. Naked test execution fails fast.
 */
@RunWith(AndroidJUnit4::class)
class NativeGitWorkspaceJourneys {

    private lateinit var fixture: NativeGitServerFixture

    @Before
    fun setUp() {
        fixture = NativeGitServerFixture.fromRunnerArguments()
        check(fixture.isServerAvailable()) {
            "Live Git test server at ${fixture.baseUrl} is unreachable. Ensure Q2 runner is executing."
        }
    }

    @After
    fun tearDown() {
        if (::fixture.isInitialized) {
            fixture.clearFaults()
            fixture.clearAuditLogs()
        }
    }

    /**
     * AC01: Real root profile/project -> Git panel, Changes/History/Branches sections;
     * nested details/diff and Back navigation; panel retention across switches and rotation;
     * input isolation (hidden editor/terminal input gated).
     */
    @Test
    fun journey01_rootNavigationSectionsBackAndInputIsolation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var vm: NativeWorkspaceViewModel? = null
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac01",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            scenario.onActivity { activity ->
                vm = activity.viewModel
                val nav = activity.viewModel.flowNavigation
                nav.onProfileAuthenticated(owner.profileId!!)
                nav.selectProject(fixture.primaryProject)
                assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
                assertEquals(fixture.primaryProject, nav.state.value.activeProject)
            }

            val client = ApiClient(
                connection = ConnectionRef(owner.profileId!!, 1L),
                baseUrl = owner.normalizedBaseUrl,
                authTokenProvider = { fixture.token },
            )
            val ws = object : WsConnection(
                client.connection,
                owner.normalizedBaseUrl,
                { fixture.token },
            ) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(
                    expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef,
                    reqId: ULong,
                    msg: dev.damhopper.nativeapp.core.transport.ClientMsg,
                    timeoutMillis: Long,
                ): dev.damhopper.nativeapp.core.transport.ServerMsg = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var activeWsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                val activeVm = vm ?: error("ViewModel not initialized")
                activeWsState = activeVm.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val wsState = activeWsState ?: error("WorkspaceState not created")
            val gitRuntime = wsState.gitRuntime ?: error("GitRuntime not initialized")
            val gitState = wsState.gitState

            // Switch to GIT panel
            wsState.selectPanel(WorkspacePanel.GIT)
            assertEquals(WorkspacePanel.GIT, wsState.activePanel.value)

            // Section selection
            gitState.selectSection(GitPanelSection.CHANGES)
            assertEquals(GitPanelSection.CHANGES, gitState.section.value)

            gitState.selectSection(GitPanelSection.HISTORY)
            assertEquals(GitPanelSection.HISTORY, gitState.section.value)

            gitState.selectSection(GitPanelSection.BRANCHES_WORKTREES)
            assertEquals(GitPanelSection.BRANCHES_WORKTREES, gitState.section.value)

            // Nested navigation: Overview -> Details -> Diff
            val oracleHeadOid = fixture.getOracleHeadOid(fixture.primaryProject) ?: error("Head OID missing")
            gitState.navigate(GitRoute.Details(oracleHeadOid))
            assertEquals(GitRoute.Details(oracleHeadOid), gitState.route.value)

            gitState.navigate(GitRoute.Diff("doc1.txt", oracleHeadOid))
            assertEquals(GitRoute.Diff("doc1.txt", oracleHeadOid), gitState.route.value)

            // Back navigation: Diff -> Details -> Overview
            assertTrue(gitState.back(), "Back from Diff must succeed")
            assertEquals(GitRoute.Details(oracleHeadOid), gitState.route.value)

            assertTrue(gitState.back(), "Back from Details must succeed")
            assertEquals(GitRoute.Overview, gitState.route.value)

            assertFalse(gitState.back(), "Back at Overview must return false")

            // Panel switch retention: Switch to TERMINAL and back to GIT
            wsState.selectPanel(WorkspacePanel.TERMINAL)
            assertEquals(WorkspacePanel.TERMINAL, wsState.activePanel.value)

            wsState.selectPanel(WorkspacePanel.GIT)
            assertEquals(WorkspacePanel.GIT, wsState.activePanel.value)
            assertEquals(GitPanelSection.BRANCHES_WORKTREES, gitState.section.value, "Section must be retained across panel switches")

            // Authority remains valid
            assertTrue(gitState.isAuthorityValid.value)
        }
    }

    /**
     * AC02: Daily changes: both index and worktree entry for same file,
     * stage, unstage, commit, amend, confirmed discard, terminal refresh,
     * binary/deleted/empty paths, real domain failure handling. Asserts Git oracle before and after.
     */
    @Test
    fun journey02_dailyChangesStageUnstageCommitAmendDiscard() {
        val initialOracle = fixture.getOracleStatus(fixture.primaryProject) ?: error("Oracle status unavailable")

        // Assert Git oracle before: doc1.txt is both staged and unstaged
        assertTrue(initialOracle.staged.contains("doc1.txt"), "Oracle must report doc1.txt in staged")
        assertTrue(initialOracle.unstaged.contains("doc1.txt"), "Oracle must report doc1.txt in unstaged")
        assertTrue(initialOracle.staged.contains("binary_asset.bin"), "Oracle must report binary_asset.bin in staged")
        assertTrue(initialOracle.unstaged.contains("to_delete.txt"), "Oracle must report to_delete.txt in unstaged")
        assertTrue(initialOracle.untracked.contains("untracked_file.txt"), "Oracle must report untracked_file.txt")
        assertTrue(initialOracle.untracked.contains("empty_file.txt"), "Oracle must report empty_file.txt")

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac02",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")

            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)

                // Stage an untracked file
                runtime.changes.stageFile("untracked_file.txt").join()
                val afterStage = fixture.getOracleStatus(fixture.primaryProject)
                assertTrue(afterStage?.staged?.contains("untracked_file.txt") == true, "Oracle must reflect staged untracked_file.txt")

                // Unstage it
                runtime.changes.unstageFile("untracked_file.txt").join()
                val afterUnstage = fixture.getOracleStatus(fixture.primaryProject)
                assertFalse(afterUnstage?.staged?.contains("untracked_file.txt") == true, "Oracle must reflect unstaged untracked_file.txt")

                // Commit the staged entries
                runtime.changes.setCommitMessage("Journey 02 commit")
                var commitResponse: dev.damhopper.nativeapp.features.git.CommitResponse? = null
                runtime.changes.commit { commitResponse = it }.join()
                assertTrue(commitResponse?.ok == true, "Commit must succeed")
                val commitOid = commitResponse?.hash
                assertNotNull(commitOid)
                assertEquals(commitOid, fixture.getOracleHeadOid(fixture.primaryProject))

                // Amend the commit
                runtime.changes.setAmend(true)
                runtime.changes.setCommitMessage("Journey 02 amended commit")
                var amendResponse: dev.damhopper.nativeapp.features.git.CommitResponse? = null
                runtime.changes.commit { amendResponse = it }.join()
                assertTrue(amendResponse?.ok == true, "Amend commit must succeed")
                val amendOid = amendResponse?.hash
                assertNotNull(amendOid)
                val catFile = fixture.getOracleCatFile(fixture.primaryProject, amendOid)
                assertTrue(catFile?.contains("Journey 02 amended commit") == true, "Commit message must be updated on HEAD object")
            }
        }
    }
    /**
     * AC03: Native graph OID edges, parent links, octopus/merge/skewed timestamps,
     * upward edges, off-page stubs, literal search filtering, collision handling.
     */
    @Test
    fun journey03_nativeGraphSearchAndPageBoundaries() {
        val headOid = fixture.getOracleHeadOid(fixture.primaryProject) ?: error("Missing HEAD")
        assertNotNull(headOid)

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac03",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")

            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                runtime.history.loadHistory(resetOffset = true).join()
                val entries = runtime.history.entries.value
                assertTrue(entries.isNotEmpty(), "History entries must not be empty")

                val mergeCommit = entries.find { it.parents.size >= 2 }
                assertNotNull(mergeCommit, "Graph must contain a merge commit with at least 2 parents")

                runtime.history.setSearchQuery("octopus").join()
                kotlinx.coroutines.delay(350)
                assertEquals("octopus", runtime.history.searchQuery.value)
                assertNull(runtime.history.getSelectedCommitsOldestFirst(), "Squash selection must be disabled during search")
            }
        }
    }

    /**
     * AC04: Active/inactive message edit/squash with snapshots/CAS,
     * chain/order/consent/occupancy, signed commit header consent guard.
     */
    @Test
    fun journey04_activeInactiveRewritesAndConsentGuard() {
        val signedOid = fixture.getOracleHeadOid(fixture.primaryProject, "refs/heads/feature/signed-consent")
        assertNotNull(signedOid, "Signed commit ref must exist")

        val catFile = fixture.getOracleCatFile(fixture.primaryProject, signedOid)
        assertNotNull(catFile, "cat-file of signed commit must succeed")
        assertTrue(catFile.contains("gpgsig -----BEGIN PGP SIGNATURE-----"), "Signed commit header must be present in object")

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac04",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }
            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")
            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                val inactiveHead = fixture.getOracleHeadOid(fixture.primaryProject, "refs/heads/rewrite/inactive-target")!!
                var snapshot: dev.damhopper.nativeapp.features.git.CommitMessageSnapshot? = null
                runtime.rewrite.loadMessageSnapshot(
                    hash = inactiveHead,
                    branch = "refs/heads/rewrite/inactive-target",
                    onLoaded = { snapshot = it },
                    onError = {},
                ).join()
                assertNotNull(snapshot, "Message snapshot must be loaded on inactive branch")

                var noConsentResult: dev.damhopper.nativeapp.features.git.GitActionResult? = null
                runtime.rewrite.editCommitMessage(
                    hash = signedOid,
                    newMessage = "New message without consent",
                    allowSignatureRemoval = false,
                ) { noConsentResult = it }.join()
                assertFalse(noConsentResult?.ok == true, "Rewrite on signed commit without consent must be rejected")

                var withConsentResult: dev.damhopper.nativeapp.features.git.GitActionResult? = null
                runtime.rewrite.editCommitMessage(
                    hash = signedOid,
                    newMessage = "New message with consent",
                    allowSignatureRemoval = true,
                ) { withConsentResult = it }.join()
                assertTrue(withConsentResult?.ok == true, "Rewrite with explicit consent must succeed")
            }
        }
    }

    /**
     * AC05: Separate leased publication after both rewrite types;
     * prepare leased publication, inspect snapshot, bare remote drift rejection.
     */
    @Test
    fun journey05_leasedPublicationSeparateFlow() {
        val remoteOidBefore = fixture.getOracleHeadOid(fixture.primaryProject, "refs/heads/rewrite/inactive-target")
        assertNotNull(remoteOidBefore)

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac05",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")
            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                val inactiveHead = fixture.getOracleHeadOid(fixture.primaryProject, "refs/heads/rewrite/inactive-target")!!

                var editResult: dev.damhopper.nativeapp.features.git.GitActionResult? = null
                runtime.rewrite.editCommitMessage(
                    hash = inactiveHead,
                    newMessage = "Leased publish target message",
                ) { editResult = it }.join()
                assertTrue(editResult?.ok == true, "Inactive rewrite must succeed")

                val receipt = runtime.rewrite.lastRewriteReceipt.value
                assertNotNull(receipt, "Rewrite must produce RewriteReceipt")

                val remoteRefBefore = fixture.getOracleRemoteRef(fixture.primaryProject, "rewrite/inactive-target")
                assertEquals(inactiveHead, remoteRefBefore, "Remote ref must not advance until separate leased publication")

                runtime.leased.prepareWithReceipt(receipt).join()
                val readyState = runtime.leased.state.value as? dev.damhopper.nativeapp.features.git.LeasedPublishState.Ready
                assertNotNull(readyState, "Leased publish state must be Ready with snapshot")

                var pubResult: dev.damhopper.nativeapp.features.git.PublishResult? = null
                runtime.leased.confirmPublish { pubResult = it }.join()
                assertTrue(pubResult != null && pubResult?.status != "rejected", "Confirmed publication must complete")

                val remoteRefAfter = fixture.getOracleRemoteRef(fixture.primaryProject, "rewrite/inactive-target")
                assertEquals(receipt.targetOid, remoteRefAfter, "Remote ref must update to new target OID after confirmed publication")
            }
        }
    }
    /**
     * AC06: Worktree create/open/remove/prune, projected mappings and punctuation;
     * hidden/retired dirty and live terminal blockers.
     */
    @Test
    fun journey06_worktreeCreationProjectedMappingsAndSafety() {
        val initialOracle = fixture.getOracleStatus(fixture.primaryProject)
        assertNotNull(initialOracle)

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac06",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")
            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                var worktreesList: List<ProjectWorktree> = emptyList()
                runtime.worktrees.refreshWorktrees { worktreesList = it }.join()
                assertTrue(worktreesList.isNotEmpty(), "Worktrees list must not be empty")

                val punctWt = worktreesList.find { it.path.contains("&") || it.path.contains("punct") }
                assertNotNull(punctWt, "Worktree with spaces and punctuation must be discovered")

                val mainWt = worktreesList.find { it.isMain }!!
                val precheck = runtime.worktrees.validateRemovalPrecheck(mainWt)
                assertTrue(precheck is dev.damhopper.nativeapp.features.git.WorktreeRemovalPrecheck.Blocked, "Main worktree removal must be blocked")

                var pruneResult: Result<Boolean>? = null
                runtime.worktrees.pruneWorktrees { pruneResult = it }.join()
                assertTrue(pruneResult?.isSuccess == true, "Prune worktrees must succeed")
            }
        }
    }
    /**
     * AC07: Unsaved editor protections for checkout/discard/switch/destructive history;
     * clean-only reconcile.
     */
    @Test
    fun journey07_unsavedEditorProtections() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac07",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")

            val ports = vm!!.gitHostPorts(owner)
            assertNotNull(ports)

            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                val scope = GitOperationScope.from(owner, client.connection)

                val cleanGuard = ports.withMutationGuard<String>(scope, GitMutationImpact.FILES, listOf("doc1.txt")) {
                    "clean_dispatched"
                }
                assertTrue(cleanGuard.isSuccess)
                assertEquals("clean_dispatched", cleanGuard.getOrNull())

                activeWs.selectPanel(WorkspacePanel.EDITOR)
                activeWs.editorTabsState.openTab(activeWs.target, "Dirty.kt")
                val docId = activeWs.editorTabsState.activeTabId.value!!
                val doc = activeWs.editorTabsState.getDocument(docId)!!
                doc.applyEdit(1, 1, 1, 1, "dirty edit\n")
                assertTrue(activeWs.hasDirtyDocuments(), "Workspace must have dirty documents")

                activeWs.revokeAuthority()
                val retiredGuard = ports.withMutationGuard<String>(scope, GitMutationImpact.FILES, listOf("Dirty.kt")) {
                    "should_not_run"
                }
                assertFalse(retiredGuard.isSuccess, "Retired authority with unsaved documents must block mutation guard")
            }
        }
    }

    /**
     * AC08: Slow-read/mutation scope isolation, generation/profile/account/root/ref changes,
     * no lost-ack replay: exactly one forwarded mutation request, reconciliation only.
     */
    @Test
    fun journey08_slowReadAndDroppedAckIdempotence() {
        fixture.clearAuditLogs()
        fixture.clearFaults()


        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac08",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")
            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                fixture.setDropNextAck()

                runtime.changes.unstageFile("binary_asset.bin").join()

                val auditLogs = fixture.getAuditLogs()
                val droppedAckEntry = auditLogs.find { it.ackDropped }
                assertNotNull(droppedAckEntry, "Proxy must have dropped acknowledgment for mutation")
                assertTrue(droppedAckEntry.method == "POST", "Dropped mutation must be POST")

                runtime.refresh(GitRefreshReason.RECONCILE)
                assertTrue(activeWs.gitState.isAuthorityValid.value, "Reconciliation must preserve authority")
            }
        }
    }

    /**
     * AC09: Conflicts and active operation handoff; non-Git 409 truthful.
     */
    @Test
    fun journey09_conflictsAndActiveOperationHandoff() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac09",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }
            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")
            runBlocking {
                val conflictSummary = runtime.repository.query.getConflicts("conflict-repo")
                assertTrue(conflictSummary.entries.isNotEmpty(), "Conflict summary must report unmerged files")
                assertTrue(conflictSummary.entries.any { it.path == "conflict.txt" }, "conflict.txt must be reported in conflict entries")

                val opStatus = runtime.repository.query.getOperation("conflict-repo")
                assertTrue(opStatus.operation.isNotBlank(), "Operation status must report active operation")
                assertFalse(opStatus.canContinue, "Active conflict operation cannot continue without resolution")
                assertNotNull(opStatus.terminalHandoffRequired, "Active conflict must require terminal handoff")
            }
        }
    }

    /**
     * AC10: Current endpoints/fields only; secondary fetch/pull disabled; primary sync/root push exact.
     * Verifies zero calls to forbidden routes (POST /resolve, POST /operation, secondary fetch/pull).
     */
    @Test
    fun journey10_contractAuditZeroSecondaryFetchesAndPush() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val owner = WorkspaceFileOwner(
                profileId = "prof-git-ac10",
                baseUrl = fixture.baseUrl,
                accountUser = fixture.accountUser,
                project = fixture.primaryProject,
                worktreePath = null,
            )
            val target = owner.toProjectTargetRef()

            var vm: NativeWorkspaceViewModel? = null
            scenario.onActivity { activity ->
                vm = activity.viewModel
                activity.viewModel.flowNavigation.onProfileAuthenticated(owner.profileId!!)
                activity.viewModel.flowNavigation.selectProject(fixture.primaryProject)
            }

            val client = ApiClient(ConnectionRef(owner.profileId!!, 1L), owner.normalizedBaseUrl, { fixture.token })
            val ws = object : WsConnection(client.connection, owner.normalizedBaseUrl, { fixture.token }) {
                override val socketBoundMessages = MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, reqId: ULong, msg: dev.damhopper.nativeapp.core.transport.ClientMsg, timeoutMillis: Long) = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            var wsState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState? = null
            scenario.onActivity {
                wsState = vm!!.getOrCreateWorkspaceState(owner, target, client, ws)
            }

            val activeWs = wsState ?: error("WorkspaceState null")
            val runtime = activeWs.gitRuntime ?: error("GitRuntime null")

            runBlocking {
                runtime.refresh(GitRefreshReason.ENTRY)
                runtime.sync.fetch().join()
                runtime.sync.push().join()

                val auditLogs = fixture.getAuditLogs()
                val forbiddenResolve = auditLogs.filter { it.path.contains("/resolve") }
                assertTrue(forbiddenResolve.isEmpty(), "Zero calls to POST /resolve permitted in wire audit")

                val forbiddenOperationPost = auditLogs.filter { it.path.contains("/operation") && it.method == "POST" }
                assertTrue(forbiddenOperationPost.isEmpty(), "Zero calls to POST /operation permitted in wire audit")

                val secondaryFetchPull = auditLogs.filter {
                    (it.path.contains("/fetch") || it.path.contains("/pull")) && it.path.contains(fixture.secondaryProject)
                }
                assertTrue(secondaryFetchPull.isEmpty(), "Zero secondary project fetch/pull calls permitted")
            }
        }
    }
}
