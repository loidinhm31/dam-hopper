package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.core.transport.WsSocketAdmission
import dev.damhopper.nativeapp.features.profiles.AuthSession
import dev.damhopper.nativeapp.features.profiles.InMemoryCredentialVault
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentObservationSource
import dev.damhopper.nativeapp.features.terminal.AgentRouteAdmission
import dev.damhopper.nativeapp.features.terminal.AgentState
import dev.damhopper.nativeapp.features.terminal.AgentStatusAvailability
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.AgentStatusSnapshotV1
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsProjector
import dev.damhopper.nativeapp.features.terminal.TerminalAgentStatusRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationResult
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsTarget
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.flow.AppFlowState
import dev.damhopper.nativeapp.ui.flow.DepartureRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.CoroutineContext
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Retained activation: post-confirmation fresh validation, the nested profile -> registry -> try-roster -> try-socket
 * -> try-reducer admission, explicit BUSY vs STALE refusal without any premature effect, request-token spending and
 * the truthful immutable Committed receipt. Uses the real ProfileRepository/registry, flow navigation, inventory
 * coordinator and reducer; only the transport object and the retained panel/session seam are controlled.
 */
class TerminalAgentsActivationCoordinatorTest {

    private lateinit var scope: CoroutineScope
    private lateinit var registry: ConnectionRegistry
    private lateinit var profiles: ProfileRepository
    private val projector = DefaultTerminalAgentsProjector()

    @BeforeTest
    fun setUp() {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        registry = ConnectionRegistry()
        profiles = ProfileRepository(vault = InMemoryCredentialVault(), registry = registry)
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
    }

    private class FakeList {
        val calls = AtomicInteger(0)
        var script: suspend (Int) -> List<TerminalSessionDetailed> = { emptyList() }
        suspend fun list(): List<TerminalSessionDetailed> = script(calls.getAndIncrement())
    }

    /** Runs dispatched blocks inline after a hook, so a test can act exactly before a given `withContext(main)`. */
    private class HookDispatcher : CoroutineDispatcher() {
        var onDispatch: (Int) -> Unit = {}
        private val count = AtomicInteger(0)
        override fun dispatch(context: CoroutineContext, block: Runnable) {
            onDispatch(count.getAndIncrement())
            block.run()
        }
    }

    private class RecordingSelection(private val flow: () -> AppFlowNavigation) : TerminalAgentsSelectionPort {
        val mutations = CopyOnWriteArrayList<String>()
        var projectAtCommit: String? = null
        var onCommit: () -> Unit = {}
        override fun canCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey): Boolean = true
        override fun commit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {
            projectAtCommit = flow().state.value.activeProject
            mutations += "commit"
            onCommit()
        }

        override fun afterCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {
            mutations += "afterCommit"
        }
    }

    private class Env(
        val profileA: ServerProfile,
        val profileB: ServerProfile,
        val connection: ConnectionRef,
        val endpoint: String,
        val socket: SocketInstanceRef,
        val inventory: TerminalAgentsInventoryCoordinator,
        val attachment: TerminalAgentsAttachment,
        val reducer: AgentStatusReducer,
        val list: FakeList,
        val target: TerminalAgentsTarget,
        val flow: AppFlowNavigation,
        val selection: RecordingSelection,
        val activation: TerminalAgentsActivationCoordinator,
    )

    private fun session(id: String, incarnation: ULong = 1uL, project: String = "proj") =
        TerminalSessionDetailed(id = id, incarnation = incarnation, project = project, command = "sh", cwd = "/work")

    private fun agentRow(id: String) = TerminalAgentStatusRow(
        id = id,
        incarnation = 1uL,
        agentKind = AgentKind.OMP,
        agentSessionId = "sess-$id",
        reporterEpoch = 1uL,
        state = AgentState.WORKING,
        source = AgentObservationSource.LIFECYCLE,
        attentionRevision = 1uL,
    )

    private suspend fun <T : Any> eventually(block: () -> T?): T = withTimeout(20_000) {
        var value = block()
        while (value == null) {
            delay(10)
            value = block()
        }
        checkNotNull(value)
    }

    private fun authSession(user: String) = AuthSession("jwt-$user", user, "user", "2026-11-01T00:00:00Z")

    private suspend fun newEnv(
        mainContext: CoroutineContext = Dispatchers.Unconfined,
        gates: TerminalAgentsAdmissionGates = PassThroughSocketGates,
    ): Env {
        profiles.initialize()
        val a = profiles.addProfile("A", "https://a.example.com", "alice")
        val b = profiles.addProfile("B", "https://b.example.com", "bob")
        profiles.applyAuthenticatedSession(a.id, authSession("alice"), null)
        profiles.applyAuthenticatedSession(b.id, authSession("bob"), null)
        profiles.selectProfile(a.id)
        val connection = assertNotNull(registry.getCurrentConnection(b.id))
        val endpoint = WorkspaceFileOwner.normalizeBaseUrl(b.baseUrl)
        val socket = SocketInstanceRef(connection, "sock-1")

        val reducer = AgentStatusReducer()
        reducer.bindRuntime(connection, socket)
        val capture = assertNotNull(reducer.captureSnapshot(connection, socket))
        reducer.applySnapshot(
            capture,
            AgentStatusSnapshotV1(1u, 5uL, 10uL, AgentStatusAvailability.READY, listOf(agentRow("term-1"))),
        )

        val list = FakeList().apply { script = { listOf(session("term-1")) } }
        val inventory = TerminalAgentsInventoryCoordinator()
        val attachment = inventory.attach(
            TerminalAgentsRuntimeBinding(connection, endpoint, "bob", WsConnection(connection, endpoint), reducer, scope) { list.list() },
        )
        inventory.onSocketState(attachment, socket, TerminalAgentsRefreshReason.CONNECTED)
        val owner = WorkspaceFileOwner(profileId = b.id, baseUrl = endpoint, accountUser = "bob", project = "proj")
        val registration = inventory.registerWorkspace(owner)
        val receipt = eventually { inventory.inventories.value.values.singleOrNull() }
        inventory.publishWorkspaceTabs(registration, receipt, listOf(session("term-1")), emptySet())
        val row = projector.rows(inventory.snapshotInput(mapOf(a.id to "A", b.id to "B")).input).single()

        val flow = AppFlowNavigation(
            AppFlowState(stage = AppFlowStage.TERMINAL, activeProfileId = a.id, activeProject = "other", activeSessionId = "x"),
        )
        val selection = RecordingSelection { flow }
        val activation = TerminalAgentsActivationCoordinator(
            scope = scope,
            inventory = inventory,
            flow = flow,
            profiles = profiles,
            selection = selection,
            mainContext = mainContext,
            gates = gates,
        )
        return Env(a, b, connection, endpoint, socket, inventory, attachment, reducer, list, row.target, flow, selection, activation)
    }

    private fun assertNothingMutated(env: Env) {
        assertTrue(env.selection.mutations.isEmpty(), "no premature panel/session selection: ${env.selection.mutations}")
        assertEquals("other", env.flow.state.value.activeProject, "no route mutation")
        assertNull(env.flow.state.value.requiredTerminalInstance)
        assertEquals(env.profileA.id, profiles.activeProfileId.value, "no active-profile mutation")
    }

    private fun assertRefused(receipt: TerminalAgentsActivationReceipt, contains: String? = null): String {
        val refused = assertIs<TerminalAgentsActivationResult.Refused>(receipt.result)
        if (contains != null) assertTrue(refused.reason.contains(contains), "Expected to contain '$contains', but was '${refused.reason}'")
        return refused.reason
    }

    // ---- happy path and linearization ----

    @Test
    fun immediateValidCommitLinearizesSelectionRouteAndActiveProfileAndPublishesTheMatchingReceipt() = runBlocking {
        val env = newEnv()
        val receipt = withTimeout(30_000) { env.activation.activate(env.target) }

        assertEquals(TerminalAgentsActivationResult.Committed, receipt.result)
        assertEquals(env.profileB.id, profiles.activeProfileId.value)
        val state = env.flow.state.value
        assertEquals(AppFlowStage.TERMINAL, state.stage)
        assertEquals(env.profileB.id, state.activeProfileId)
        assertEquals("proj", state.activeProject)
        assertEquals("term-1", state.activeSessionId)
        assertFalse(state.notificationRouteActive, "manual routes never claim the notification route")
        assertEquals(TerminalAgentsInstanceKey(env.profileB.id, "term-1", 1uL), state.requiredTerminalInstance)
        assertEquals(listOf("commit", "afterCommit"), env.selection.mutations.toList())
        assertEquals("other", env.selection.projectAtCommit, "selection is written inside the leaf before the flow route")
        assertEquals(receipt, env.activation.lastActivation.value)
        assertNull(env.activation.pendingRequestId.value)
    }

    @Test
    fun aGuardDeferralIsNotSuccessAndConfirmationStartsAFreshInventoryRequestAfterTheDialog() = runBlocking {
        val env = newEnv()
        var captured: DepartureRequest? = null
        env.flow.departureGuard = { request -> captured = request; true }

        val deferred = env.activation.activate(env.target)
        assertEquals(TerminalAgentsActivationResult.Deferred(deferred.requestId), deferred.result)
        assertNothingMutated(env)
        assertEquals(deferred.requestId, env.activation.pendingRequestId.value)
        val callsBeforeConfirmation = env.list.calls.get()

        captured!!.onProceed() // the user confirmed the dirty prompt
        val committed = eventually { env.activation.lastActivation.value?.takeIf { it.requestId == deferred.requestId } }
        assertEquals(TerminalAgentsActivationResult.Committed, committed.result)
        assertEquals(callsBeforeConfirmation + 1, env.list.calls.get(), "exactly one NEW list request started after the confirmation")
        assertEquals(listOf("commit", "afterCommit"), env.selection.mutations.toList())
    }

    @Test
    fun guardCancellationReplacementAndOrdinaryNavigationSpendTheRequestToken() = runBlocking {
        // 1. Cancel/dismiss: the continuation is inert afterwards.
        val env = newEnv()
        var captured: DepartureRequest? = null
        env.flow.departureGuard = { request -> captured = request; true }
        val first = env.activation.activate(env.target)
        captured!!.onCancelled()
        assertEquals(first.requestId, env.activation.lastActivation.value?.requestId)
        assertRefused(env.activation.lastActivation.value!!)
        val calls = env.list.calls.get()
        captured!!.onProceed() // a stale confirmation after cancellation
        delay(300)
        assertEquals(calls, env.list.calls.get(), "a spent request starts no fetch")
        assertNothingMutated(env)

        // 2. A newer request supersedes an older deferred one without overwriting the already-open prompt.
        var oldPrompt: DepartureRequest? = null
        env.flow.departureGuard = { request -> oldPrompt = request; true }
        val older = env.activation.activate(env.target)
        assertIs<TerminalAgentsActivationResult.Deferred>(older.result)
        env.flow.departureGuard = { request -> request.onCancelled(); true } // coalesced behind the open prompt
        val newer = env.activation.activate(env.target)
        assertRefused(newer)
        val olderRefusal = assertRefused(TerminalAgentsActivationReceipt(older.requestId, env.activation.lastActivation.value!!.result))
        assertTrue(olderRefusal.isNotBlank())
        oldPrompt!!.onProceed()
        delay(300)
        assertNothingMutated(env)

        // 3. Ordinary navigation spends a pending activation at request time.
        var activationPrompt: DepartureRequest? = null
        env.flow.departureGuard = { request -> activationPrompt = request; true }
        env.flow.onOrdinaryNavigationRequested = { env.activation.cancelPending("Superseded by navigation.") }
        val pending = env.activation.activate(env.target)
        assertIs<TerminalAgentsActivationResult.Deferred>(pending.result)
        env.flow.departureGuard = { _ -> true } // the ordinary request is intercepted by the same open prompt
        env.flow.navigateToProfiles()
        assertEquals(pending.requestId, env.activation.lastActivation.value?.requestId)
        assertRefused(env.activation.lastActivation.value!!, "navigation")
        activationPrompt!!.onProceed()
        delay(300)
        assertNothingMutated(env)
    }

    // ---- authority: BUSY vs STALE, never a premature effect ----

    @Test
    fun contendedRosterGateIsAnExplicitBusyRefusalAndAFreshClickLaterCommits() = runBlocking {
        val hook = HookDispatcher()
        val env = newEnv(mainContext = hook)
        val started = CountDownLatch(1)
        hook.onDispatch = { index ->
            // Dispatch #1 is the final nested admission: another thread holds the roster gate right before it
            // (and releases shortly after, so the refusal bookkeeping that follows is not blocked forever).
            if (index == 1) {
                Thread {
                    env.inventory.rosterLock.lock()
                    try {
                        started.countDown()
                        Thread.sleep(600)
                    } finally {
                        env.inventory.rosterLock.unlock()
                    }
                }.apply { isDaemon = true }.start()
                started.await()
            }
        }
        val receipt = withTimeout(30_000) { env.activation.activate(env.target) }
        assertEquals("Terminal state is busy. Try again.", assertRefused(receipt))
        assertNothingMutated(env)

        // No spin and no automatic retry: only an explicit new click captures and fetches afresh.
        hook.onDispatch = {}
        val retry = withTimeout(30_000) { env.activation.activate(env.target) }
        assertEquals(TerminalAgentsActivationResult.Committed, retry.result)
    }

    @Test
    fun contendedSocketOrReducerGateIsBusyAndPropagatesThroughTheNestedBooleanCallbacks() = runBlocking {
        val socketBusy = object : TerminalAgentsAdmissionGates {
            override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean) = WsSocketAdmission.BUSY
            override fun admitReducer(
                reducer: AgentStatusReducer, owner: ConnectionRef, socket: SocketInstanceRef,
                expectedEpoch: ULong?, expectedAuthorityRevision: Long, commit: () -> Boolean,
            ) = RealTerminalAgentsAdmissionGates.admitReducer(reducer, owner, socket, expectedEpoch, expectedAuthorityRevision, commit)
        }
        val first = newEnv(gates = socketBusy)
        assertEquals("Terminal state is busy. Try again.", assertRefused(withTimeout(30_000) { first.activation.activate(first.target) }))
        assertNothingMutated(first)
    }

    @Test
    fun aBusyReducerGateInsideTheSocketCallbackStillSurfacesAsBusyNotStale() = runBlocking {
        val reducerBusy = object : TerminalAgentsAdmissionGates {
            override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean) =
                if (commit()) WsSocketAdmission.COMMITTED else WsSocketAdmission.STALE

            override fun admitReducer(
                reducer: AgentStatusReducer, owner: ConnectionRef, socket: SocketInstanceRef,
                expectedEpoch: ULong?, expectedAuthorityRevision: Long, commit: () -> Boolean,
            ) = AgentRouteAdmission.BUSY
        }
        val env = newEnv(gates = reducerBusy)
        assertEquals("Terminal state is busy. Try again.", assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }))
        assertNothingMutated(env)
    }

    @Test
    fun invalidationRightBeforeAdmissionAndSameValueAttachmentReplacementAreStaleRefusals() = runBlocking {
        // Inventory invalidated after the fresh fetch but before admission.
        lateinit var envRef: Env
        val invalidatingGates = object : TerminalAgentsAdmissionGates {
            override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission {
                envRef.inventory.invalidate(envRef.attachment, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
                return ws.tryAdmitCurrentSocket(expected, commit)
            }
            override fun admitReducer(
                reducer: AgentStatusReducer, owner: ConnectionRef, socket: SocketInstanceRef,
                expectedEpoch: ULong?, expectedAuthorityRevision: Long, commit: () -> Boolean,
            ): AgentRouteAdmission = reducer.tryAdmitTerminalAgentsRoute(owner, socket, expectedEpoch, expectedAuthorityRevision, commit)
        }
        val env = newEnv(gates = invalidatingGates)
        envRef = env
        assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }, "changed")
        assertNothingMutated(env)

        // A replacement connection OBJECT with the same ConnectionRef and an equal sock-1 value is still stale.
        lateinit var secondRef: Env
        val replacingGates = object : TerminalAgentsAdmissionGates {
            override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission {
                secondRef.inventory.attach(
                    TerminalAgentsRuntimeBinding(
                        secondRef.connection, secondRef.endpoint, "bob", WsConnection(secondRef.connection, secondRef.endpoint),
                        AgentStatusReducer(), scope,
                    ) { secondRef.list.list() },
                )
                return ws.tryAdmitCurrentSocket(expected, commit)
            }
            override fun admitReducer(
                reducer: AgentStatusReducer, owner: ConnectionRef, socket: SocketInstanceRef,
                expectedEpoch: ULong?, expectedAuthorityRevision: Long, commit: () -> Boolean,
            ): AgentRouteAdmission = reducer.tryAdmitTerminalAgentsRoute(owner, socket, expectedEpoch, expectedAuthorityRevision, commit)
        }
        val second = newEnv(gates = replacingGates)
        secondRef = second
        assertRefused(withTimeout(30_000) { second.activation.activate(second.target) }, "The terminal changed before it could be opened.")
        assertNothingMutated(second)
    }

    @Test
    fun aReducerAuthorityChangeBeforeAdmissionIsStaleAndNeverMutates() = runBlocking {
        lateinit var envRef: Env
        val invalidatingReducerGates = object : TerminalAgentsAdmissionGates {
            override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission =
                ws.tryAdmitCurrentSocket(expected, commit)
            override fun admitReducer(
                reducer: AgentStatusReducer, owner: ConnectionRef, socket: SocketInstanceRef,
                expectedEpoch: ULong?, expectedAuthorityRevision: Long, commit: () -> Boolean,
            ): AgentRouteAdmission {
                runBlocking(Dispatchers.Default) {
                    envRef.reducer.applyStatusInvalidated(envRef.connection, envRef.socket, ServerMsg.AgentStatusInvalidated(5uL, 11uL))
                }
                return reducer.tryAdmitTerminalAgentsRoute(owner, socket, expectedEpoch, expectedAuthorityRevision, commit)
            }
        }
        val env = newEnv(gates = invalidatingReducerGates)
        envRef = env
        assertEquals("The terminal changed before it could be opened.", assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }))
        assertNothingMutated(env)
    }

    @Test
    fun theProfileMutexIsAwaitedNotTriedAndAnIdentityChangeWhileWaitingIsStale() = runBlocking {
        val env = newEnv()
        val gate = CompletableDeferred<Unit>()
        registry.addRetirementBarrier { gate.await() }
        // The endpoint edit holds the profile mutex across its awaited registry drain.
        val edit = async(Dispatchers.Default) {
            profiles.updateProfile(env.profileB.id, "B", "https://b2.example.com", "bob")
        }
        delay(200)
        val activation = async(Dispatchers.Default) { env.activation.activate(env.target) }
        delay(500)
        assertFalse(activation.isCompleted, "the admission awaits the profile mutex (it is not a try-gate)")
        assertTrue(env.selection.mutations.isEmpty())
        gate.complete(Unit)
        edit.await()
        assertRefused(withTimeout(30_000) { activation.await() })
        assertTrue(env.selection.mutations.isEmpty())
        assertEquals(env.profileA.id, profiles.activeProfileId.value)
    }

    @Test
    fun aMissingOrRestartedTargetAfterTheFreshFetchIsRefusedWithoutUpgrading() = runBlocking {
        val env = newEnv()
        env.list.script = { listOf(session("term-1", incarnation = 2uL)) }
        assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }, "restarted")
        assertNothingMutated(env)

        env.list.script = { emptyList() }
        assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }, "no longer exists")
        assertNothingMutated(env)

        env.list.script = { listOf(session("term-1", project = "elsewhere")) }
        assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }, "moved")
        assertNothingMutated(env)
    }

    @Test
    fun aCachedDisplayTargetOfALostSocketIsRefusedOnClickNeverUpgradedToASuccessor() = runBlocking {
        val env = newEnv()
        env.inventory.onSocketState(env.attachment, null, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        assertRefused(withTimeout(30_000) { env.activation.activate(env.target) }, "connection changed")
        assertNothingMutated(env)
    }

    // ---- truthful immutable receipt ----

    @Test
    fun reentrantCancellationAndPostCommitInvalidationNeverRewriteTheCommittedReceipt() = runBlocking {
        val env = newEnv()
        env.selection.onCommit = {
            // Inside the admitted leaf (all gates held): reentrant self-cancel and an inventory invalidation.
            env.activation.cancelPending("reentrant")
            env.inventory.invalidate(env.attachment, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        }
        val receipt = withTimeout(30_000) { env.activation.activate(env.target) }
        assertEquals(TerminalAgentsActivationResult.Committed, receipt.result)
        assertEquals(listOf("commit", "afterCommit"), env.selection.mutations.toList())
        assertEquals(receipt, env.activation.lastActivation.value)

        // Post-commit cancellation/invalidation/navigation cannot reclassify what was truly committed.
        env.activation.cancelPending("late cancellation")
        env.inventory.invalidate(env.attachment, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        env.flow.onOrdinaryNavigationRequested = { env.activation.cancelPending("navigation") }
        env.flow.selectSession("term-1")
        assertEquals(receipt, env.activation.lastActivation.value)
        assertEquals(env.profileB.id, profiles.activeProfileId.value)
    }
}

/**
 * The unconnected test transport cannot hold a real connected lifecycle gate, so the socket step simply runs the next
 * admission step; the reducer step stays the REAL captured-reducer try-gate.
 */
private object PassThroughSocketGates : TerminalAgentsAdmissionGates {
    override fun admitSocket(ws: WsConnection, expected: SocketInstanceRef, commit: () -> Boolean): WsSocketAdmission =
        if (commit()) WsSocketAdmission.COMMITTED else WsSocketAdmission.STALE

    override fun admitReducer(
        reducer: AgentStatusReducer,
        owner: ConnectionRef,
        socket: SocketInstanceRef,
        expectedEpoch: ULong?,
        expectedAuthorityRevision: Long,
        commit: () -> Boolean,
    ): AgentRouteAdmission =
        RealTerminalAgentsAdmissionGates.admitReducer(reducer, owner, socket, expectedEpoch, expectedAuthorityRevision, commit)
}
