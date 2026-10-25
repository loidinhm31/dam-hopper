package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Shared builders for the roster pure tests (same source set, no production hooks). */
internal object TerminalAgentsTestFixtures {
    const val ENDPOINT = "http://host-a:4803"

    val labels: Map<String, String> = mapOf("p1" to "Profile One", "p2" to "Profile Two", "p3" to "Profile Three", "p4" to "Profile Four")

    fun runtime(
        profileId: String = "p1",
        generation: Long = 1L,
        socketId: String = "sock-1",
        attachment: Long = 1L,
        endpoint: String = ENDPOINT,
        account: String = "alice",
    ): TerminalAgentsRuntimeKey {
        val connection = ConnectionRef(profileId, generation)
        return TerminalAgentsRuntimeKey(connection, SocketInstanceRef(connection, socketId), attachment, endpoint, account)
    }

    fun owner(
        profileId: String? = "p1",
        project: String = "proj",
        worktree: String? = null,
        endpoint: String = ENDPOINT,
        account: String = "alice",
    ) = WorkspaceFileOwner(profileId, endpoint, account, project, worktree)

    fun registration(owner: WorkspaceFileOwner, id: Long = 1L, order: Long = id) =
        TerminalAgentsRegistration(owner, id, order)

    fun session(
        id: String,
        incarnation: ULong = 1uL,
        project: String? = "proj",
        worktree: String? = null,
        type: String = "traditional",
        alive: Boolean = true,
        targetUnavailable: Boolean = false,
        name: String? = null,
    ) = TerminalSessionDetailed(
        id = id,
        incarnation = incarnation,
        project = project,
        command = "bash",
        cwd = "/work",
        worktreePath = worktree,
        name = name,
        sessionType = type,
        alive = alive,
        targetUnavailable = targetUnavailable,
    )

    fun observation(
        id: String,
        incarnation: ULong = 1uL,
        kind: AgentKind = AgentKind.OMP,
        state: AgentState = AgentState.WORKING,
        source: AgentObservationSource = AgentObservationSource.LIFECYCLE,
        reason: BlockedReason? = null,
        turnId: String? = null,
        lastOutcome: TurnOutcome? = null,
    ) = TerminalAgentStatusRow(
        id = id,
        incarnation = incarnation,
        agentKind = kind,
        agentSessionId = "agent-$id",
        reporterEpoch = 1uL,
        state = state,
        source = source,
        reason = reason,
        turnId = turnId,
        lastOutcome = lastOutcome,
    )

    fun receipt(runtime: TerminalAgentsRuntimeKey, sessions: List<TerminalSessionDetailed>, ticket: Long = 1L) =
        TerminalAgentsInventoryReceipt(runtime, ticket, invalidationRevision = ticket, sessions = sessions)

    fun workspace(
        registration: TerminalAgentsRegistration,
        runtime: TerminalAgentsRuntimeKey,
        tabs: List<TerminalSessionDetailed>,
        ticket: Long = 1L,
        excluded: Set<String> = emptySet(),
    ) = TerminalAgentsWorkspaceSnapshot(registration, runtime, ticket, tabs, excluded)

    /** Runtime snapshot with a current baseline, inventory ticket 1 and all-ready defaults. */
    fun snapshot(
        runtime: TerminalAgentsRuntimeKey,
        sessions: List<TerminalSessionDetailed>,
        observations: List<TerminalAgentStatusRow>,
        identity: Boolean = true,
        connected: Boolean = true,
        health: TerminalAgentsInventoryHealth = TerminalAgentsInventoryHealth.CURRENT,
        ticket: Long = 1L,
        withInventory: Boolean = true,
        baseline: Boolean = true,
        wire: AgentStatusAvailability = AgentStatusAvailability.READY,
        failure: TerminalAgentsSnapshotFailure? = null,
        cached: List<TerminalAgentStatusRow> = observations,
        authorityRevision: Long = 7L,
        epoch: ULong = 3uL,
    ) = TerminalAgentsRuntimeSnapshot(
        runtime = runtime,
        isCurrentIdentity = identity,
        isCurrentConnectedSocket = connected,
        inventoryHealth = health,
        inventory = if (withInventory) receipt(runtime, sessions, ticket) else null,
        statusBaselineInstalled = baseline,
        statusAuthorityRevision = authorityRevision,
        status = AgentStatusState(
            serverEpoch = epoch,
            availability = wire,
            agents = observations.associateBy { it.id },
            baselineInstalled = baseline,
        ),
        snapshotFailure = failure,
        cachedObservations = cached,
    )

    fun input(
        workspaces: List<TerminalAgentsWorkspaceSnapshot>,
        runtimes: List<TerminalAgentsRuntimeSnapshot>,
        profileLabels: Map<String, String> = labels,
    ) = TerminalAgentsProjectionInput(workspaces, runtimes, profileLabels)

    /**
     * Single fresh workspace owning [sessions] (inventory and published tabs identical) with [observations].
     */
    fun simple(
        sessions: List<TerminalSessionDetailed>,
        observations: List<TerminalAgentStatusRow>,
        owner: WorkspaceFileOwner = owner(),
        runtime: TerminalAgentsRuntimeKey = runtime(),
        tabs: List<TerminalSessionDetailed> = sessions,
    ) = input(
        listOf(workspace(registration(owner), runtime, tabs)),
        listOf(snapshot(runtime, sessions, observations)),
    )
}

class TerminalAgentsMembershipTest {
    private val f = TerminalAgentsTestFixtures

    private fun ids(result: TerminalAgentsMembershipResult) = result.members.map { it.target.instance.terminalId }

    @Test
    fun freshJoinFollowsInventoryOrderAndSkipsUnobservedTerminals() {
        val a = f.session("a")
        val b = f.session("b")
        val c = f.session("c") // open PTY without any agent observation
        val input = f.simple(
            sessions = listOf(b, c, a),
            tabs = listOf(a, b, c),
            observations = listOf(f.observation("a"), f.observation("b", kind = AgentKind.CODEX)),
        )
        val result = TerminalAgentsMembership.join(input)
        assertEquals(listOf("b", "a"), ids(result))
        assertEquals(AgentKind.CODEX, result.members[0].observation.agentKind)
        assertTrue(result.members.all { it.availability == TerminalAgentsAvailability.READY })
        assertTrue(result.conflicts.isEmpty())
        val target = result.members[0].target
        assertEquals(f.runtime(), target.runtime)
        assertEquals(3uL, target.serverEpoch)
        assertEquals(7L, target.statusAuthorityRevision)
        assertEquals("p1", target.instance.profileId)
    }

    @Test
    fun equalTerminalIdsOnDifferentProfilesStayIsolated() {
        val rt1 = f.runtime("p1")
        val rt2 = f.runtime("p2")
        val s = f.session("shared")
        val input = f.input(
            listOf(
                f.workspace(f.registration(f.owner("p1"), 1, 1), rt1, listOf(s)),
                f.workspace(f.registration(f.owner("p2"), 2, 2), rt2, listOf(s)),
            ),
            listOf(
                f.snapshot(rt1, listOf(s), listOf(f.observation("shared", state = AgentState.WORKING))),
                f.snapshot(rt2, listOf(s), listOf(f.observation("shared", state = AgentState.IDLE))),
            ),
        )
        val members = TerminalAgentsMembership.join(input).members
        assertEquals(listOf("p1", "p2"), members.map { it.target.instance.profileId })
        assertEquals(listOf(AgentState.WORKING, AgentState.IDLE), members.map { it.observation.state })
        assertEquals(listOf("Profile One", "Profile Two"), members.map { it.profileLabel })
    }

    @Test
    fun restartedIncarnationNeverJoinsOldTabOrOldObservation() {
        val tab = f.session("t", incarnation = 1uL)
        val restarted = f.session("t", incarnation = 2uL)
        // published tab still old, inventory already restarted
        var result = TerminalAgentsMembership.join(
            f.simple(listOf(restarted), listOf(f.observation("t", 2uL)), tabs = listOf(tab)),
        )
        assertTrue(result.members.isEmpty())
        // inventory and tab agree on 2 but the observation is still the old incarnation
        result = TerminalAgentsMembership.join(
            f.simple(listOf(restarted), listOf(f.observation("t", 1uL)), tabs = listOf(restarted)),
        )
        assertTrue(result.members.isEmpty())
        result = TerminalAgentsMembership.join(
            f.simple(listOf(restarted), listOf(f.observation("t", 2uL)), tabs = listOf(restarted)),
        )
        assertEquals(2uL, result.members.single().target.instance.incarnation)
    }

    @Test
    fun equalValueSocketReplacementWithNewAttachmentIsDisplayOnlyAndKeepsOldTarget() {
        val old = f.runtime(attachment = 1L) // same ConnectionRef and sock-1
        val replacement = f.runtime(attachment = 2L)
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), old, listOf(s))),
            listOf(f.snapshot(replacement, listOf(s), listOf(f.observation("t")), cached = listOf(f.observation("t")))),
        )
        val member = TerminalAgentsMembership.join(input).members.single()
        assertEquals(TerminalAgentsAvailability.UNAVAILABLE, member.availability)
        assertEquals(old, member.target.runtime)
        assertEquals(1L, member.target.runtime.attachmentIncarnation)
        assertEquals(null, member.target.serverEpoch)
        assertEquals(TerminalAgentsMembership.NO_AUTHORITY, member.target.statusAuthorityRevision)
    }

    @Test
    fun cachedDisplayAcrossGenerationUsesOldTabsAndNeverMixesNewMetadata() {
        val old = f.runtime(generation = 1L, socketId = "sock-1", attachment = 1L)
        val current = f.runtime(generation = 2L, socketId = "sock-9", attachment = 2L)
        val oldTab = f.session("t", incarnation = 1uL, name = "old title")
        val newSession = f.session("t", incarnation = 2uL)
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), old, listOf(oldTab))),
            listOf(
                f.snapshot(
                    current,
                    listOf(newSession),
                    observations = listOf(f.observation("t", 2uL)),
                    cached = listOf(f.observation("t", 1uL, state = AgentState.WORKING)),
                ),
            ),
        )
        val member = TerminalAgentsMembership.join(input).members.single()
        assertEquals(1uL, member.target.instance.incarnation)
        assertEquals(old, member.target.runtime)
        assertEquals(TerminalAgentsAvailability.UNAVAILABLE, member.availability)
        assertEquals("old title", member.session.displayName)
    }

    @Test
    fun disconnectedSameRuntimeKeepsCachedReadyDisplayUnavailable() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
            listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")), connected = false)),
        )
        val member = TerminalAgentsMembership.join(input).members.single()
        assertEquals(TerminalAgentsAvailability.UNAVAILABLE, member.availability)
        assertEquals(rt, member.target.runtime)
    }

    @Test
    fun staleInventoryTicketIsDisplayOnly() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s), ticket = 1L)),
            listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")), ticket = 2L)),
        )
        val member = TerminalAgentsMembership.join(input).members.single()
        assertEquals(TerminalAgentsAvailability.UNAVAILABLE, member.availability)
        assertEquals(null, member.target.serverEpoch)
        assertEquals(TerminalAgentsMembership.NO_AUTHORITY, member.target.statusAuthorityRevision)
    }

    @Test
    fun missingInventoryFallsBackToDisplayOnlyCachedTabs() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
            listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")), withInventory = false)),
        )
        val member = TerminalAgentsMembership.join(input).members.single()
        assertEquals(TerminalAgentsAvailability.UNAVAILABLE, member.availability)
        assertEquals(null, member.target.serverEpoch)
        assertEquals(TerminalAgentsMembership.NO_AUTHORITY, member.target.statusAuthorityRevision)
    }

    @Test
    fun conflictInOneRegistrationExcludesSameTerminalFromOtherRegistrationsOnRuntime() {
        val rt = f.runtime()
        val good = f.session("t", incarnation = 1uL, project = "alpha")
        val conflicting = f.session("t", incarnation = 2uL, project = "alpha")
        val other = f.session("keep", project = "beta")
        val ownerA = f.owner(project = "alpha")
        val ownerB = f.owner(project = "beta")
        val input = f.input(
            listOf(
                // First registration publishes tabs that contradict each other for t...
                f.workspace(f.registration(ownerA, 1, 1), rt, listOf(good, conflicting)),
                // ...a later one has a clean, valid-looking beta tab that must still survive.
                f.workspace(f.registration(ownerB, 2, 2), rt, listOf(other)),
                // Same-owner second registration with a clean tab for t must not resurrect it.
                f.workspace(f.registration(ownerA, 3, 3), rt, listOf(good)),
            ),
            listOf(f.snapshot(rt, listOf(good, other), listOf(f.observation("t", 1uL), f.observation("keep")))),
        )
        val result = TerminalAgentsMembership.join(input)
        assertEquals(listOf("keep"), ids(result))
        assertEquals(listOf("t"), result.conflicts.map { it.terminalId })
    }

    @Test
    fun identityLostPurgesEvenWithCachedObservations() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
            listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")), identity = false)),
        )
        assertTrue(TerminalAgentsMembership.join(input).members.isEmpty())
    }

    @Test
    fun noRuntimeSnapshotOrMissingProfileLabelProducesNoRows() {
        val rt = f.runtime()
        val s = f.session("t")
        val ws = listOf(f.workspace(f.registration(f.owner()), rt, listOf(s)))
        assertTrue(TerminalAgentsMembership.join(f.input(ws, emptyList())).members.isEmpty())
        val snap = listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t"))))
        assertTrue(TerminalAgentsMembership.join(f.input(ws, snap, profileLabels = emptyMap())).members.isEmpty())
        assertEquals(1, TerminalAgentsMembership.join(f.input(ws, snap, profileLabels = mapOf("p1" to " "))).members.size)
        assertEquals("p1", TerminalAgentsMembership.join(f.input(ws, snap, profileLabels = mapOf("p1" to " "))).members[0].profileLabel)
    }

    @Test
    fun accountAndEndpointMismatchAgainstRegisteredOwnerFailClosed() {
        val s = f.session("t")
        val owner = f.owner()
        val badAccount = f.runtime(account = "bob")
        val badEndpoint = f.runtime(endpoint = "http://other:1")
        for (rt in listOf(badAccount, badEndpoint)) {
            val input = f.input(
                listOf(f.workspace(f.registration(owner), rt, listOf(s))),
                listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")))),
            )
            assertTrue(TerminalAgentsMembership.join(input).members.isEmpty(), "$rt")
        }
        // Trailing slash normalizes to the same logical endpoint.
        val slashed = f.runtime(endpoint = "${TerminalAgentsTestFixtures.ENDPOINT}/")
        val input = f.input(
            listOf(f.workspace(f.registration(owner), slashed, listOf(s))),
            listOf(f.snapshot(slashed, listOf(s), listOf(f.observation("t")))),
        )
        assertEquals(1, TerminalAgentsMembership.join(input).members.size)
    }

    @Test
    fun inconsistentRuntimeKeysFailClosed() {
        val conn = ConnectionRef("p1", 1L)
        val foreignSocket = SocketInstanceRef(ConnectionRef("p1", 2L), "sock-1")
        val mismatchedSocket = TerminalAgentsRuntimeKey(conn, foreignSocket, 1L, f.ENDPOINT, "alice")
        val zeroAttachment = f.runtime(attachment = 0L)
        val wrongProfile = TerminalAgentsRuntimeKey(
            ConnectionRef("p2", 1L), SocketInstanceRef(ConnectionRef("p2", 1L), "sock-1"), 1L, f.ENDPOINT, "alice",
        )
        val s = f.session("t")
        for (rt in listOf(mismatchedSocket, zeroAttachment, wrongProfile)) {
            val input = f.input(
                listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
                listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")))),
            )
            assertTrue(TerminalAgentsMembership.join(input).members.isEmpty(), "$rt")
        }
    }

    @Test
    fun exactProjectAndNormalizedNullableWorktreeDefineMembership() {
        val rt = f.runtime()
        data class Case(val ownerWorktree: String?, val sessionWorktree: String?, val sessionProject: String?, val member: Boolean)
        val cases = listOf(
            Case(null, null, "proj", true),
            Case(null, "  ", "proj", true),
            Case(null, "/", "proj", true),
            Case("wt/a", "wt/a", "proj", true),
            Case("wt/a", "\\wt\\a\\", "proj", true),
            Case("/wt/a/", " wt/a ", "proj", true),
            Case("wt/a", "WT/A", "proj", false),
            Case("wt/a", null, "proj", false),
            Case(null, "wt/a", "proj", false),
            Case("wt/a", "wt/b", "proj", false),
            Case(null, null, "other", false),
            Case(null, null, null, false),
        )
        for (case in cases) {
            val s = f.session("t", project = case.sessionProject, worktree = case.sessionWorktree)
            val owner = f.owner(worktree = case.ownerWorktree)
            val input = f.input(
                listOf(f.workspace(f.registration(owner), rt, listOf(s))),
                listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")))),
            )
            assertEquals(case.member, TerminalAgentsMembership.join(input).members.isNotEmpty(), "$case")
        }
    }

    @Test
    fun deadNonTraditionalTargetUnavailableAndExcludedTerminalsAreNotMembers() {
        val rt = f.runtime()
        val sessions = listOf(
            f.session("ok"),
            f.session("dead", alive = false),
            f.session("agentic", type = "agentic"),
            f.session("gone", targetUnavailable = true),
            f.session("destroying"),
        )
        val observations = sessions.map { f.observation(it.id) }
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, sessions, excluded = setOf("destroying"))),
            listOf(f.snapshot(rt, sessions, observations)),
        )
        assertEquals(listOf("ok"), ids(TerminalAgentsMembership.join(input)))
        // Same filters apply to display-only cached membership.
        val cachedInput = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, sessions, excluded = setOf("destroying"))),
            listOf(f.snapshot(rt, sessions, observations, ticket = 2L)),
        )
        assertEquals(listOf("ok"), ids(TerminalAgentsMembership.join(cachedInput)))
    }

    @Test
    fun tabMissingFromPublishedMembershipIsNotMember() {
        val a = f.session("a")
        val b = f.session("b")
        val input = f.simple(
            sessions = listOf(a, b),
            tabs = listOf(a),
            observations = listOf(f.observation("a"), f.observation("b")),
        )
        assertEquals(listOf("a"), ids(TerminalAgentsMembership.join(input)))
    }

    @Test
    fun workspaceOwnershipIsByMetadataNotRegistrationOrActiveWorkspace() {
        val rt = f.runtime()
        val inA = f.session("a", project = "alpha")
        val inB = f.session("b", project = "beta", worktree = "wt")
        val sessions = listOf(inA, inB)
        val ownerA = f.owner(project = "alpha")
        val ownerB = f.owner(project = "beta", worktree = "wt")
        val input = f.input(
            // Input list reversed relative to registration order.
            listOf(
                f.workspace(f.registration(ownerB, id = 5, order = 2), rt, sessions),
                f.workspace(f.registration(ownerA, id = 4, order = 1), rt, sessions),
            ),
            listOf(f.snapshot(rt, sessions, sessions.map { f.observation(it.id) })),
        )
        val members = TerminalAgentsMembership.join(input).members
        assertEquals(listOf("a", "b"), members.map { it.target.instance.terminalId })
        assertEquals(listOf(ownerA, ownerB), members.map { it.target.registration.owner })
        assertEquals(listOf("alpha", "beta (wt)"), members.map { it.projectLabel })
    }

    @Test
    fun sameOwnerRegisteredTwiceEmitsEachInstanceOnceFromFirstRegistration() {
        val rt = f.runtime()
        val s = f.session("t")
        val owner = f.owner()
        val first = f.registration(owner, id = 1, order = 1)
        val second = f.registration(owner, id = 2, order = 2)
        val input = f.input(
            listOf(f.workspace(second, rt, listOf(s)), f.workspace(first, rt, listOf(s))),
            listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t")))),
        )
        val result = TerminalAgentsMembership.join(input)
        assertEquals(1, result.members.size)
        assertEquals(first, result.members.single().target.registration)
        assertTrue(result.conflicts.isEmpty())
    }

    @Test
    fun identicalDuplicatesEmitOnce() {
        val s = f.session("t")
        val input = f.simple(sessions = listOf(s, s), tabs = listOf(s, s), observations = listOf(f.observation("t")))
        val result = TerminalAgentsMembership.join(input)
        assertEquals(1, result.members.size)
        assertTrue(result.conflicts.isEmpty())
    }

    @Test
    fun conflictingDuplicatesFailClosedAndAreReported() {
        val rt = f.runtime()
        val ok = f.session("ok")
        val simultaneous = listOf(f.session("dup", incarnation = 1uL), f.session("dup", incarnation = 2uL))
        val incompatible = listOf(f.session("inc", worktree = null), f.session("inc", worktree = "other"))
        val sessions = listOf(ok) + simultaneous + incompatible
        val observations = listOf(
            f.observation("ok"), f.observation("dup", 1uL), f.observation("dup", 2uL), f.observation("inc"),
        )
        val result = TerminalAgentsMembership.join(
            f.simple(sessions = sessions, tabs = listOf(ok), observations = observations, runtime = rt),
        )
        assertEquals(listOf("ok"), ids(result))
        assertEquals(
            setOf("dup", "inc"),
            result.conflicts.map { it.terminalId }.toSet(),
        )
        assertTrue(result.conflicts.all { it.runtime == rt })
    }

    @Test
    fun conflictingPublishedTabsFailClosed() {
        val a1 = f.session("a", incarnation = 1uL)
        val a2 = f.session("a", incarnation = 2uL)
        val result = TerminalAgentsMembership.join(
            f.simple(sessions = listOf(a1), tabs = listOf(a1, a2), observations = listOf(f.observation("a"))),
        )
        assertTrue(result.members.isEmpty())
        assertEquals(listOf("a"), result.conflicts.map { it.terminalId })
    }

    @Test
    fun conflictingObservationsFailClosedForThatTerminalOnly() {
        val a = f.session("a")
        val b = f.session("b")
        val rt = f.runtime()
        val duplicated = listOf(
            f.observation("a", state = AgentState.WORKING),
            f.observation("a", state = AgentState.IDLE),
            f.observation("b"),
            f.observation("b"),
        )
        // Cached list can carry duplicates; the reducer map cannot.
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(a, b))),
            listOf(f.snapshot(rt, listOf(a, b), emptyList(), baseline = false, cached = duplicated)),
        )
        val result = TerminalAgentsMembership.join(input)
        assertEquals(listOf("b"), ids(result))
        assertEquals(listOf("a"), result.conflicts.map { it.terminalId })
    }

    @Test
    fun sameKeyClaimedByDifferentOwnersFailsClosed() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(
                f.workspace(f.registration(f.owner(), 1, 1), rt, listOf(s)),
                // Same profile/endpoint/account/project/worktree string differs only by owner identity (account).
                f.workspace(f.registration(f.owner(account = "bob"), 2, 2), f.runtime(account = "bob"), listOf(s)),
            ),
            listOf(
                f.snapshot(rt, listOf(s), listOf(f.observation("t"))),
                f.snapshot(f.runtime(account = "bob"), listOf(s), listOf(f.observation("t"))),
            ),
        )
        val result = TerminalAgentsMembership.join(input)
        assertTrue(result.members.isEmpty())
        assertEquals(2, result.conflicts.size)
    }

    @Test
    fun loadingBaselineUsesCachedObservationsAsUnavailable() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
            listOf(
                f.snapshot(
                    rt,
                    listOf(s),
                    observations = emptyList(),
                    baseline = false,
                    cached = listOf(f.observation("t", state = AgentState.BLOCKED, reason = BlockedReason.APPROVAL)),
                ),
            ),
        )
        val member = TerminalAgentsMembership.join(input).members.single()
        assertEquals(TerminalAgentsAvailability.UNAVAILABLE, member.availability)
        assertEquals(null, member.target.serverEpoch)
    }

    @Test
    fun installedBaselineSupersedesCachedObservations() {
        val rt = f.runtime()
        val s = f.session("t")
        val input = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
            listOf(
                f.snapshot(
                    rt,
                    listOf(s),
                    observations = listOf(f.observation("t", state = AgentState.IDLE)),
                    cached = listOf(f.observation("t", state = AgentState.WORKING)),
                ),
            ),
        )
        assertEquals(AgentState.IDLE, TerminalAgentsMembership.join(input).members.single().observation.state)
    }
}
