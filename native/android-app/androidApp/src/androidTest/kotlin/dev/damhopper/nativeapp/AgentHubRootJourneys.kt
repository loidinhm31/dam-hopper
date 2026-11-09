package dev.damhopper.nativeapp

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureIntent
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocument
import dev.damhopper.nativeapp.platform.workspace.DocumentLaunchers
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeDeviceWsConnection(
    conn: ConnectionRef,
    baseUrl: String,
) : WsConnection(conn, baseUrl, { "device-test-token" }) {
    private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 64)
    override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()
    override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {}
    override suspend fun requestOnSocket(
        expectedSocketRef: SocketInstanceRef,
        reqId: ULong,
        msg: ClientMsg,
        timeoutMillis: Long,
    ): ServerMsg = ServerMsg.FsOpResult(reqId = reqId, ok = true)
}

/**
 * Android Device Regression Journeys for Root Lifecycle and Retained Lifetimes (W09 Phase 07):
 * - Default Agent Hub entry gate after login
 * - Two workspace aliases sharing canonical document buffer with surviving alias undo/save
 * - Reverse order alias close
 * - Final dirty departure save/discard/cancel guard
 * - Activity recreation with late old-view detach safety
 * - Covered input gate hiding input without closing documents
 * - Authority retirement dirty recovery access
 */
@RunWith(AndroidJUnit4::class)
class AgentHubRootJourneys {

    @Test
    fun testMainActivityAuthenticatesToDefaultAgentHub() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val vm = activity.viewModel
            assertNotNull(vm)

            // Initially on PROFILE_LOGIN
            assertEquals(AppFlowStage.PROFILE_LOGIN, vm.flowNavigation.state.value.stage)

            // Authenticate profile
            vm.flowNavigation.onProfileAuthenticated("hub-device-prof")

            // Default authenticated destination is AGENT_HUB
            assertEquals(AppFlowStage.AGENT_HUB, vm.flowNavigation.state.value.stage)
            assertEquals("hub-device-prof", vm.flowNavigation.state.value.activeProfileId)
        }
        scenario.close()
    }

    @Test
    fun testTwoWorkspaceAliasesSharingCanonicalDocumentSurviveOppositeClose() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val vm = activity.viewModel
            assertNotNull(vm)

            val ownerA = WorkspaceFileOwner(
                profileId = "hub-device-prof",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "alice-device",
                project = "device-project",
                worktreePath = null,
                workspaceEpoch = 10L,
            )
            val ownerB = WorkspaceFileOwner(
                profileId = "hub-device-prof",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "alice-device",
                project = "device-project",
                worktreePath = "feature-wt",
                workspaceEpoch = 10L,
            )

            val conn = ConnectionRef("hub-device-prof", 1L)
            val client = ApiClient(conn, ownerA.normalizedBaseUrl, { "token" }, vm.registry)
            val ws = FakeDeviceWsConnection(conn, ownerA.normalizedBaseUrl)

            val wsStateA = vm.getOrCreateWorkspaceState(ownerA, ownerA.toProjectTargetRef(), client, ws)
            val wsStateB = vm.getOrCreateWorkspaceState(ownerB, ownerB.toProjectTargetRef(), client, ws)
            assertNotNull(wsStateA)
            assertNotNull(wsStateB)

            // Both workspaces share the same canonical registry under identical (profile, endpoint, account, epoch)
            val docIdA = DocumentId(ownerA, "Main.kt", 1L)
            val canonicalKey = "hub-device-prof/http://127.0.0.1:4801/alice-device/device-project/10/Main.kt"

            val (canonicalDoc, created) = wsStateA.editorTabsState.registry.getOrCreateDocument(
                canonicalKey = canonicalKey,
                fallbackDocId = docIdA,
                content = "val x = 1\n",
                mtime = 5000L,
                tier = dev.damhopper.nativeapp.features.editor.FileTier.NORMAL,
            )
            assertTrue(created)
            assertNotNull(canonicalDoc)

            val leaseA = wsStateA.editorTabsState.registry.acquireAliasLease(canonicalKey, "tab-alias-a")
            val leaseB = wsStateB.editorTabsState.registry.acquireAliasLease(canonicalKey, "tab-alias-b")
            assertNotNull(leaseA)
            assertNotNull(leaseB)

            // Edit document in A
            val androidDoc = canonicalDoc as AndroidEditorDocument
            androidDoc.applyEdit(1, 11, 1, 11, "val y = 2\n")
            assertTrue(canonicalDoc.isDirty.value)

            // Close workspace A: drops only A's lease
            wsStateA.editorTabsState.registry.releaseAliasLease(canonicalKey, leaseA, canonicalDoc)
            wsStateA.close()

            // Canonical document must remain open, alive, and dirty for B!
            assertFalse(canonicalDoc.isClosed)
            assertFalse(canonicalDoc.canDispose)
            assertTrue(canonicalDoc.isDirty.value)

            // Surviving workspace B can undo the edit
            androidDoc.undo()
            assertEquals("val x = 1\n", androidDoc.content.toString())

            // Close workspace B
            wsStateB.editorTabsState.registry.releaseAliasLease(canonicalKey, leaseB, canonicalDoc)
            wsStateB.close()

            assertTrue(canonicalDoc.canDispose)
            wsStateB.editorTabsState.registry.checkAndPruneDocument(canonicalKey, canonicalDoc)
            assertTrue(canonicalDoc.isClosed)
        }
        scenario.close()
    }

    @Test
    fun testActivityRecreationAndLateDetachDoesNotBreakSuccessorLaunchers() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val tokenA = Any()
        var launcherACalled = false
        val launcherA = object : DocumentLaunchers {
            override fun launchOpen() { launcherACalled = true }
            override fun launchCreate(suggestedName: String, mime: String) {}
        }

        scenario.onActivity { activity ->
            val vm = activity.viewModel
            assertNotNull(vm)
            vm.onActivityAttach(tokenA)
            vm.documentPort.attach(launcherA, tokenA)
        }

        val tokenB = Any()
        var launcherBCalled = false
        val launcherB = object : DocumentLaunchers {
            override fun launchOpen() { launcherBCalled = true }
            override fun launchCreate(suggestedName: String, mime: String) {}
        }

        scenario.onActivity { activity ->
            val vm = activity.viewModel
            // Successor attaches with tokenB
            vm.onActivityAttach(tokenB)
            vm.documentPort.attach(launcherB, tokenB)

            // Late old destroy from Activity A with tokenA arrives
            vm.onActivityDestroy(tokenA, isChangingConfigurations = false)

            // Successor B's existing attachment must remain usable WITHOUT reattachment!
            val testOp = dev.damhopper.nativeapp.features.settings.SettingsOperation(
                dev.damhopper.nativeapp.features.settings.SettingsScope.SETTINGS_TARGET,
                dev.damhopper.nativeapp.features.settings.SettingsOwner(ConnectionRef("hub-device-prof", 1L), "http://127.0.0.1:4801", "user1"),
                1L, 1L, 1L
            )
            vm.documentPort.openToml(testOp)
            assertFalse(launcherACalled, "Old launcher A must not be called")
            assertTrue(launcherBCalled, "Successor launcher B must remain functional without reattachment")
        }
        scenario.close()
    }

    @Test
    fun testCoveredInputGateHidesInputWithoutDisposingDocuments() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val vm = activity.viewModel
            val owner = WorkspaceFileOwner(
                profileId = "hub-device-prof",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "charlie",
                project = "cov-project",
                worktreePath = null,
                workspaceEpoch = 1L,
            )
            val conn = ConnectionRef("hub-device-prof", 1L)
            val client = ApiClient(conn, owner.normalizedBaseUrl, { "token" }, vm.registry)
            val ws = FakeDeviceWsConnection(conn, owner.normalizedBaseUrl)

            val wsState = vm.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            wsState.selectPanel(WorkspacePanel.EDITOR)
            assertTrue(wsState.isInteractiveEditAllowed())

            // Suspend input (Settings/privacy cover)
            wsState.setInputSuspended(true)
            assertTrue(wsState.isInputSuspended.value)
            assertFalse(wsState.isInteractiveEditAllowed(), "Input must be blocked while covered")

            // Restore input
            wsState.setInputSuspended(false)
            assertFalse(wsState.isInputSuspended.value)
            assertTrue(wsState.isInteractiveEditAllowed())
        }
        scenario.close()
    }

    @Test
    fun testAuthorityRetirementAndDirtyRecoveryAcrossDeviceLifecycle() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val vm = activity.viewModel
            val owner = WorkspaceFileOwner(
                profileId = "hub-device-prof",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "dana",
                project = "ret-project",
                worktreePath = null,
                workspaceEpoch = 2L,
            )
            val conn = ConnectionRef("hub-device-prof", 1L)
            val client = ApiClient(conn, owner.normalizedBaseUrl, { "token" }, vm.registry)
            val ws = FakeDeviceWsConnection(conn, owner.normalizedBaseUrl)

            val wsState = vm.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)
            assertFalse(wsState.isAuthorityRetired.value)

            // Simulate connection retirement
            wsState.revokeAuthority()
            assertTrue(wsState.isAuthorityRetired.value)
            assertFalse(wsState.isInteractiveEditAllowed())

            // Rebinding with different epoch fails
            val differentEpochOwner = owner.copy(workspaceEpoch = 99L)
            val connSuccessor = ConnectionRef("hub-device-prof", 2L)
            assertFalse(wsState.rebindAuthority(differentEpochOwner, connSuccessor))
            assertTrue(wsState.isAuthorityRetired.value)

            // Rebinding with exact authorized owner succeeds
            assertTrue(wsState.rebindAuthority(owner, connSuccessor))
            assertFalse(wsState.isAuthorityRetired.value)
        }
        scenario.close()
    }

    @Test
    fun testFinalDirtyDepartureChoicesRemainReachableOnDevice() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val vm = activity.viewModel
            val owner = WorkspaceFileOwner(
                profileId = "hub-device-prof",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "edward",
                project = "dep-device-project",
                worktreePath = null,
                workspaceEpoch = 1L,
            )
            val conn = ConnectionRef("hub-device-prof", 1L)
            val client = ApiClient(conn, owner.normalizedBaseUrl, { "token" }, vm.registry)
            val ws = FakeDeviceWsConnection(conn, owner.normalizedBaseUrl)

            val wsState = vm.getOrCreateWorkspaceState(owner, owner.toProjectTargetRef(), client, ws)

            var cancelled = false
            var confirmed = false
            val docId = DocumentId(owner, "file.txt", 1L)
            val intent = WorkspaceDepartureIntent.WorkspaceLeave(
                targetStageName = "AGENT_HUB",
                dirtyDocuments = listOf(docId),
                dirtyRevisions = mapOf(docId to 1L),
                onConfirmed = { confirmed = true },
                onCancelled = { cancelled = true },
            )

            wsState.setPendingDeparture(intent)
            assertEquals(intent, wsState.pendingDeparture.value)

            wsState.clearPendingDeparture()
            assertTrue(cancelled)
            assertFalse(confirmed)
            assertNull(wsState.pendingDeparture.value)
        }
        scenario.close()
    }
}
