package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
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
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsFilterCodec
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsProjector
import dev.damhopper.nativeapp.features.terminal.TerminalAgentStatusRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationResult
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterStore
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRegistration
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The actual retained service over the real inventory/activation coordinators, reducers and profile registry:
 * multi-profile/worktree retained membership (including inactive registered workspaces), same-generation equal-socket
 * object replacement, inactive freshness from one shared list, exact identity retirement and filter persistence.
 */
class RetainedTerminalAgentsIntegrationTest {

    private lateinit var scope: CoroutineScope
    private lateinit var registry: ConnectionRegistry
    private lateinit var profiles: ProfileRepository

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

    private class CountingStore(private var value: TerminalAgentsFilterSelection = TerminalAgentsFilterSelection.All) :
        TerminalAgentsFilterStore {
        val saves = AtomicInteger(0)
        val loads = AtomicInteger(0)
        override fun load(): TerminalAgentsFilterSelection = value.also { loads.incrementAndGet() }
        override fun save(selection: TerminalAgentsFilterSelection) {
            saves.incrementAndGet()
            value = selection
        }
    }

    private class Runtime(
        val profile: ServerProfile,
        val connection: ConnectionRef,
        val endpoint: String,
        val socket: SocketInstanceRef,
        val attachment: TerminalAgentsAttachment,
        val list: FakeList,
    )

    private class FakeList {
        val calls = AtomicInteger(0)
        var sessions: List<TerminalSessionDetailed> = emptyList()
        suspend fun list(): List<TerminalSessionDetailed> {
            calls.incrementAndGet()
            return sessions
        }
    }

    private fun session(id: String, project: String, worktree: String? = null, incarnation: ULong = 1uL) =
        TerminalSessionDetailed(id = id, incarnation = incarnation, project = project, worktreePath = worktree, command = "sh", cwd = "/w")

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

    private val inventory = TerminalAgentsInventoryCoordinator()

    private suspend fun <T : Any> eventually(block: () -> T?): T = withTimeout(20_000) {
        var value = block()
        while (value == null) {
            delay(10)
            value = block()
        }
        checkNotNull(value)
    }

    private suspend fun runtime(name: String, user: String, sessions: List<TerminalSessionDetailed>): Runtime {
        val profile = profiles.addProfile(name, "https://${name.lowercase()}.example.com", user)
        profiles.applyAuthenticatedSession(profile.id, AuthSession("jwt-$name", user, "user", "2026-11-01T00:00:00Z"), null)
        val connection = assertNotNull(registry.getCurrentConnection(profile.id))
        val endpoint = WorkspaceFileOwner.normalizeBaseUrl(profile.baseUrl)
        val socket = SocketInstanceRef(connection, "sock-1")
        val reducer = AgentStatusReducer()
        reducer.bindRuntime(connection, socket)
        val capture = assertNotNull(reducer.captureSnapshot(connection, socket))
        reducer.applySnapshot(
            capture,
            AgentStatusSnapshotV1(1u, 5uL, 10uL, AgentStatusAvailability.READY, sessions.map { agentRow(it.id) }),
        )
        val list = FakeList().apply { this.sessions = sessions }
        val attachment = inventory.attach(
            TerminalAgentsRuntimeBinding(connection, endpoint, user, WsConnection(connection, endpoint), reducer, scope) { list.list() },
        )
        inventory.onSocketState(attachment, socket, TerminalAgentsRefreshReason.CONNECTED)
        eventually { inventory.inventories.value.keys.firstOrNull { it.connection == connection } }
        return Runtime(profile, connection, endpoint, socket, attachment, list)
    }

    private fun owner(rt: Runtime, user: String, project: String, worktree: String? = null) =
        WorkspaceFileOwner(profileId = rt.profile.id, baseUrl = rt.endpoint, accountUser = user, project = project, worktreePath = worktree)

    private class Fixture(
        val service: RetainedTerminalAgentsCoordinator,
        val store: CountingStore,
        val flow: AppFlowNavigation,
    )

    private fun service(store: CountingStore = CountingStore()): Fixture {
        val flow = AppFlowNavigation()
        val selection = object : TerminalAgentsSelectionPort {
            override fun canCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) = true
            override fun commit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {}
            override fun afterCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {}
        }
        val activation = TerminalAgentsActivationCoordinator(
            scope = scope,
            inventory = inventory,
            flow = flow,
            profiles = profiles,
            selection = selection,
            mainContext = Dispatchers.Unconfined,
            gates = PassThroughSocketGatesForService,
        )
        val codec = DefaultTerminalAgentsFilterCodec()
        val service = RetainedTerminalAgentsCoordinator(
            scope = scope,
            inventory = inventory,
            activation = activation,
            projector = DefaultTerminalAgentsProjector(codec),
            filterStore = store,
            codec = codec,
            profileLabels = { profiles.profiles.value.associate { it.id to it.name } },
        )
        return Fixture(service, store, flow)
    }

    private fun rowIds(fixture: Fixture): List<String> =
        fixture.service.state.value.projection.rows.map { it.target.instance.terminalId }

    /** A and B retained workspaces, two of A's being inactive worktrees/projects, all published once. */
    private suspend fun twoProfiles(): Triple<Runtime, Runtime, List<TerminalAgentsRegistration>> {
        profiles.initialize()
        val a = runtime("A", "alice", listOf(session("a1", "projA"), session("a2", "projA", "wt-1")))
        val b = runtime("B", "bob", listOf(session("b1", "projB")))
        val regs = listOf(
            inventory.registerWorkspace(owner(a, "alice", "projA")),
            inventory.registerWorkspace(owner(a, "alice", "projA", "wt-1")),
            inventory.registerWorkspace(owner(b, "bob", "projB")),
        )
        val receiptA = eventually { inventory.inventories.value.values.firstOrNull { it.runtime.connection == a.connection } }
        val receiptB = eventually { inventory.inventories.value.values.firstOrNull { it.runtime.connection == b.connection } }
        val tabsA = listOf(session("a1", "projA"), session("a2", "projA", "wt-1"))
        inventory.publishWorkspaceTabs(regs[0], receiptA, tabsA, emptySet())
        inventory.publishWorkspaceTabs(regs[1], receiptA, tabsA, emptySet())
        inventory.publishWorkspaceTabs(regs[2], receiptB, listOf(session("b1", "projB")), emptySet())
        return Triple(a, b, regs)
    }

    @Test
    fun retainedRosterIncludesInactiveRegisteredWorkspacesAcrossProfilesAndWorktreesInRegistrationOrder() = runBlocking {
        val (_, _, _) = twoProfiles()
        val fixture = service()
        eventually { rowIds(fixture).takeIf { it.size == 3 } }

        assertEquals(listOf("a1", "a2", "b1"), rowIds(fixture), "registration order, not map iteration or the active workspace")
        val counts = fixture.service.state.value.projection.counts
        assertEquals(3, counts.all)
        assertEquals(3, counts.byStatus.getValue(TerminalAgentsStatus.WORKING))
        assertEquals(listOf("A", "A", "B"), fixture.service.state.value.projection.rows.map { it.profileLabel })
        assertEquals(inventory.inventories.value, fixture.service.inventories.value)
    }

    @Test
    fun terminalsOfUnregisteredOrUnpublishedWorkspacesNeverAppearAndNothingIsDiscovered() = runBlocking {
        profiles.initialize()
        val a = runtime("A", "alice", listOf(session("a1", "projA"), session("stranger", "projZ")))
        val registered = inventory.registerWorkspace(owner(a, "alice", "projA"))
        val receipt = eventually { inventory.inventories.value.values.firstOrNull() }
        val fixture = service()
        // Registered but never published: inventory acceptance alone never manufactures tabs.
        delay(200)
        assertTrue(rowIds(fixture).isEmpty())
        inventory.publishWorkspaceTabs(registered, receipt, listOf(session("a1", "projA")), emptySet())
        eventually { rowIds(fixture).takeIf { it.isNotEmpty() } }
        assertEquals(listOf("a1"), rowIds(fixture), "a terminal of a project without a registered workspace is not discovered")
    }

    @Test
    fun filterIsLoadedWithoutWritingAndOnlyUserActionsSaveTheNormalizedSelection() = runBlocking {
        val store = CountingStore()
        val fixture = service(store)
        assertEquals(1, store.loads.get())
        delay(200)
        assertEquals(0, store.saves.get(), "mount/load never writes")

        fixture.service.setFilter(TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.IDLE, TerminalAgentsStatus.WORKING, TerminalAgentsStatus.IDLE)))
        assertEquals(1, store.saves.get())
        val saved = assertIs<TerminalAgentsFilterSelection.Selected>(fixture.service.state.value.filter.let {
            eventually { fixture.service.state.value.filter.takeIf { f -> f is TerminalAgentsFilterSelection.Selected } }
        })
        assertEquals(listOf(TerminalAgentsStatus.WORKING, TerminalAgentsStatus.IDLE), saved.statuses, "canonical order, deduplicated")
        fixture.service.setFilter(TerminalAgentsFilterSelection.All)
        assertEquals(2, store.saves.get())
    }

    @Test
    fun sameGenerationEqualSocketObjectReplacementRejectsTheOldTargetAndOldPublicationAndKeepsTheSuccessor() = runBlocking {
        val (a, _, regs) = twoProfiles()
        val fixture = service()
        eventually { rowIds(fixture).takeIf { it.size == 3 } }
        val oldRow = fixture.service.state.value.projection.rows.first { it.target.instance.terminalId == "a1" }
        val oldReceipt = eventually { inventory.inventories.value.values.firstOrNull { it.runtime.connection == a.connection } }

        // Replace A's connection object: same ConnectionRef, equal sock-1, new attachment token.
        val replacement = inventory.attach(
            TerminalAgentsRuntimeBinding(
                a.connection, a.endpoint, "alice", WsConnection(a.connection, a.endpoint),
                AgentStatusReducer(), scope,
            ) { a.list.list() },
        )
        assertTrue(replacement.incarnation > oldRow.target.runtime.attachmentIncarnation, "a replaced object gets a new monotonic token")
        inventory.onSocketState(replacement, a.socket, TerminalAgentsRefreshReason.CONNECTED)
        val newReceipt = eventually {
            inventory.inventories.value.values.firstOrNull { it.runtime.connection == a.connection && it.runtime.attachmentIncarnation == replacement.incarnation }
        }
        assertEquals(oldReceipt.runtime.socket, newReceipt.runtime.socket)

        // The old click target is refused, never upgraded to the successor.
        val refused = withTimeout(30_000) { fixture.service.activate(oldRow.target) }
        assertIs<TerminalAgentsActivationResult.Refused>(refused.result)
        assertTrue(fixture.flow.state.value.requiredTerminalInstance == null)

        // The old receipt cannot publish tabs into the successor's roster.
        inventory.publishWorkspaceTabs(regs[0], oldReceipt, emptyList(), emptySet())
        assertFalse(inventory.snapshotInput(emptyMap()).input.workspaces.first { it.registration == regs[0] }.visibleTabs.isEmpty())
    }

    @Test
    fun inactiveRegisteredWorkspacesRefreshFromOneSharedServerListWithoutPerWorkspaceFetches() = runBlocking {
        val (a, _, _) = twoProfiles()
        val fixture = service()
        eventually { rowIds(fixture).takeIf { it.size == 3 } }
        val callsBefore = a.list.calls.get()

        // A new worktree terminal appears on A's server; refreshing the ONE runtime list updates the inactive workspace.
        a.list.sessions = a.list.sessions + session("a3", "projA", "wt-1")
        val runtime = inventory.currentRuntimeKeys().first { it.connection == a.connection }
        assertNotNull(fixture.service.refreshInventory(runtime, TerminalAgentsRefreshReason.SIDEBAR_OPENED))
        assertEquals(callsBefore + 1, a.list.calls.get(), "one list per runtime refresh, not one per registered workspace")
        val tabs = inventory.snapshotInput(emptyMap()).input.workspaces.map { ws -> ws.registration.owner.normalizedWorktreePath to ws.visibleTabs.map { it.id } }
        assertTrue(tabs.any { it.first == "wt-1" && "a3" in it.second }, "the inactive worktree workspace sees the new terminal: $tabs")
    }

    @Test
    fun explicitCloseAndIdentityLossPurgeExactlyTheAffectedMembership() = runBlocking {
        val (a, b, regs) = twoProfiles()
        val fixture = service()
        eventually { rowIds(fixture).takeIf { it.size == 3 } }

        fixture.service.closeWorkspace(regs[1])
        eventually { rowIds(fixture).takeIf { it == listOf("a1", "b1") } }

        inventory.retireIdentity(a.connection)
        eventually { rowIds(fixture).takeIf { it == listOf("b1") } }
        assertEquals(setOf(b.connection), inventory.inventories.value.keys.map { it.connection }.toSet())
    }

    @Test
    fun contradictoryAcceptedMetadataMarksTheInventoryConflictAndOffersARefresh() = runBlocking {
        profiles.initialize()
        val a = runtime("A", "alice", listOf(session("a1", "projA")))
        val reg = inventory.registerWorkspace(owner(a, "alice", "projA"))
        val receipt = eventually { inventory.inventories.value.values.firstOrNull() }
        inventory.publishWorkspaceTabs(reg, receipt, listOf(session("a1", "projA")), emptySet())
        val fixture = service()
        eventually { rowIds(fixture).takeIf { it == listOf("a1") } }

        // The next accepted list contains one ID twice with different incarnations.
        a.list.sessions = listOf(session("a1", "projA", incarnation = 1uL), session("a1", "projA", incarnation = 2uL))
        val runtime = inventory.currentRuntimeKeys().single()
        val second = assertNotNull(fixture.service.refreshInventory(runtime, TerminalAgentsRefreshReason.USER_RETRY))
        inventory.publishWorkspaceTabs(reg, second, listOf(session("a1", "projA")), emptySet())
        val notice = eventually { fixture.service.state.value.refreshNotice?.takeIf { it.contains("contradictory") } }
        assertTrue(notice.contains("Refresh"))
        assertTrue(rowIds(fixture).none { it == "a1" } || fixture.service.state.value.projection.rows.all {
            it.presentation.status == TerminalAgentsStatus.UNAVAILABLE
        })
    }
}

private object PassThroughSocketGatesForService : TerminalAgentsAdmissionGates {
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
