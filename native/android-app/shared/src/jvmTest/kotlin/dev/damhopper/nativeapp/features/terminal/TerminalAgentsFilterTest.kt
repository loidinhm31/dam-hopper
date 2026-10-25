package dev.damhopper.nativeapp.features.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TerminalAgentsFilterTest {
    private val f = TerminalAgentsTestFixtures
    private val codec = DefaultTerminalAgentsFilterCodec()
    private val projector = DefaultTerminalAgentsProjector(codec)

    private fun selected(vararg statuses: TerminalAgentsStatus) =
        TerminalAgentsFilterSelection.Selected(statuses.toList())

    @Test
    fun normalizeDeduplicatesOrdersCanonicallyAndCollapsesEmptyAndAllSeen() {
        assertEquals(TerminalAgentsFilterSelection.All, codec.normalize(emptyList()))
        assertEquals(TerminalAgentsFilterSelection.All, codec.normalize(TerminalAgentsStatus.entries.reversed()))
        assertEquals(TerminalAgentsFilterSelection.All, codec.normalize(TerminalAgentsStatus.entries + TerminalAgentsStatus.entries))
        assertEquals(
            selected(TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.IDLE, TerminalAgentsStatus.UNSUPPORTED),
            codec.normalize(
                listOf(
                    TerminalAgentsStatus.UNSUPPORTED,
                    TerminalAgentsStatus.IDLE,
                    TerminalAgentsStatus.NEEDS_ATTENTION,
                    TerminalAgentsStatus.IDLE,
                ),
            ),
        )
        // Six of seven stays a selection.
        assertEquals(
            TerminalAgentsStatus.entries.drop(1),
            (codec.normalize(TerminalAgentsStatus.entries.drop(1).reversed()) as TerminalAgentsFilterSelection.Selected).statuses,
        )
    }

    @Test
    fun decodeHandlesAllScalarAndArray() {
        assertEquals(TerminalAgentsFilterSelection.All, codec.decode("all"))
        for (status in TerminalAgentsStatus.entries) {
            assertEquals(selected(status), codec.decode(TerminalAgentsPresenter.statusLabel(status)), "$status")
        }
        assertEquals(
            selected(TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.WORKING),
            codec.decode("""["Working","Needs attention"]"""),
        )
        // Whitespace inside JSON is accepted, duplicates collapse.
        assertEquals(
            selected(TerminalAgentsStatus.IDLE, TerminalAgentsStatus.UNKNOWN),
            codec.decode(""" [ "Unknown" , "Idle", "Idle" ] """),
        )
        // Singleton array stays a single selection.
        assertEquals(selected(TerminalAgentsStatus.IDLE), codec.decode("""["Idle"]"""))
    }

    @Test
    fun decodeRetainsOnlyValidArrayMembers() {
        assertEquals(
            selected(TerminalAgentsStatus.WORKING),
            codec.decode("""["bogus", 3, null, true, ["Idle"], {"a":1}, "Working", "working"]"""),
        )
        assertEquals(TerminalAgentsFilterSelection.All, codec.decode("""["bogus", 1]"""))
        assertEquals(TerminalAgentsFilterSelection.All, codec.decode("[]"))
    }

    @Test
    fun decodeInvalidOrMissingFallsBackToAll() {
        val invalid = listOf<String?>(
            null, "", " ", "ALL", "All", "working", "Working ", "Nonsense", "{", "[", """["Idle"""",
            "null", "42", "true", """{"status":"Working"}""", """"Working"""", "Working,Idle",
        )
        for (raw in invalid) {
            assertEquals(TerminalAgentsFilterSelection.All, codec.decode(raw), "raw=$raw")
        }
    }

    @Test
    fun decodeAllSevenInArrayIsAll() {
        val raw = TerminalAgentsStatus.entries.joinToString(",", "[", "]") { "\"${TerminalAgentsPresenter.statusLabel(it)}\"" }
        assertEquals(TerminalAgentsFilterSelection.All, codec.decode(raw))
    }

    @Test
    fun encodeWritesAllScalarOrCanonicalArray() {
        assertEquals("all", codec.encode(TerminalAgentsFilterSelection.All))
        assertEquals("Working", codec.encode(selected(TerminalAgentsStatus.WORKING)))
        assertEquals("Platform unqualified", codec.encode(selected(TerminalAgentsStatus.PLATFORM_UNQUALIFIED)))
        assertEquals(
            """["Needs attention","Working"]""",
            codec.encode(selected(TerminalAgentsStatus.WORKING, TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.WORKING)),
        )
        assertEquals("all", codec.encode(selected()))
        assertEquals("all", codec.encode(TerminalAgentsFilterSelection.Selected(TerminalAgentsStatus.entries.reversed())))
        // A duplicated singleton is still the scalar form.
        assertEquals("Idle", codec.encode(selected(TerminalAgentsStatus.IDLE, TerminalAgentsStatus.IDLE)))
    }

    @Test
    fun encodeDecodeRoundTripsEveryNonEmptySubset() {
        val entries = TerminalAgentsStatus.entries
        for (mask in 0 until (1 shl entries.size)) {
            val chosen = entries.filterIndexed { index, _ -> mask and (1 shl index) != 0 }
            val expected = codec.normalize(chosen)
            assertEquals(expected, codec.decode(codec.encode(TerminalAgentsFilterSelection.Selected(chosen))), "mask=$mask")
        }
    }

    // --- projector: counts before filter, grouping after ------------------------------------------------------

    /** Eight agents covering all seven presentation statuses. */
    private fun allStatusesInput(): TerminalAgentsProjectionInput {
        val rt1 = f.runtime("p1")
        val s1 = listOf("a", "b", "c", "d", "e").map { f.session(it) }
        val o1 = listOf(
            f.observation("a", kind = AgentKind.OMP, state = AgentState.BLOCKED, reason = BlockedReason.APPROVAL),
            f.observation("b", kind = AgentKind.CODEX, state = AgentState.BLOCKED, reason = BlockedReason.ERROR),
            f.observation("c", kind = AgentKind.CLAUDE, state = AgentState.WORKING, source = AgentObservationSource.HOOK),
            f.observation("d", state = AgentState.IDLE, lastOutcome = TurnOutcome.ENDED),
            f.observation("e", state = AgentState.UNKNOWN),
        )
        val x = f.session("x")
        val ox = listOf(f.observation("x"))
        val rt2 = f.runtime("p2")
        val rt3 = f.runtime("p3")
        val rt4 = f.runtime("p4")
        return f.input(
            listOf(
                f.workspace(f.registration(f.owner("p1"), 1), rt1, s1),
                f.workspace(f.registration(f.owner("p2"), 2), rt2, listOf(x)),
                f.workspace(f.registration(f.owner("p3"), 3), rt3, listOf(x)),
                f.workspace(f.registration(f.owner("p4"), 4), rt4, listOf(x)),
            ),
            listOf(
                f.snapshot(rt1, s1, o1),
                f.snapshot(rt2, listOf(x), ox, connected = false),
                f.snapshot(rt3, listOf(x), ox, wire = AgentStatusAvailability.PLATFORM_UNQUALIFIED),
                f.snapshot(rt4, listOf(x), ox, failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND),
            ),
        )
    }

    @Test
    fun allSelectionCountsAllSevenStatusesAndGroupsEverything() {
        val projection = projector.project(allStatusesInput(), TerminalAgentsFilterSelection.All)
        assertEquals(8, projection.rows.size)
        assertEquals(8, projection.filteredCount)
        assertEquals(8, projection.counts.all)
        assertEquals(TerminalAgentsStatus.entries, projection.counts.byStatus.keys.toList())
        assertEquals(
            mapOf(
                TerminalAgentsStatus.NEEDS_ATTENTION to 2,
                TerminalAgentsStatus.WORKING to 1,
                TerminalAgentsStatus.IDLE to 1,
                TerminalAgentsStatus.UNKNOWN to 1,
                TerminalAgentsStatus.UNAVAILABLE to 1,
                TerminalAgentsStatus.PLATFORM_UNQUALIFIED to 1,
                TerminalAgentsStatus.UNSUPPORTED to 1,
            ),
            projection.counts.byStatus,
        )
        assertEquals(
            listOf(
                Triple("p1", TerminalAgentsStatus.NEEDS_ATTENTION, BlockedReason.APPROVAL),
                Triple("p1", TerminalAgentsStatus.NEEDS_ATTENTION, BlockedReason.ERROR),
                Triple("p1", TerminalAgentsStatus.WORKING, null),
                Triple("p1", TerminalAgentsStatus.IDLE, null),
                Triple("p1", TerminalAgentsStatus.UNKNOWN, null),
                Triple("p2", TerminalAgentsStatus.UNAVAILABLE, null),
                Triple("p3", TerminalAgentsStatus.PLATFORM_UNQUALIFIED, null),
                Triple("p4", TerminalAgentsStatus.UNSUPPORTED, null),
            ),
            projection.groups.map { Triple(it.key.workspace.profileId, it.key.status, it.key.reason) },
        )
        val idle = projection.groups.single { it.key.status == TerminalAgentsStatus.IDLE }
        assertTrue(idle.doneTurnEnded)
        val working = projection.groups.single { it.key.status == TerminalAgentsStatus.WORKING }
        assertEquals(listOf(AgentKind.CLAUDE), working.agentKinds)
        assertEquals(listOf(TerminalAgentsPresenter.HOOK_COVERAGE_HINT), working.coverageHints)
    }

    @Test
    fun selectionFiltersGroupsAndFilteredCountButNotCountsOrRows() {
        val input = allStatusesInput()
        val all = projector.project(input, TerminalAgentsFilterSelection.All)
        val projection = projector.project(
            input,
            selected(TerminalAgentsStatus.UNAVAILABLE, TerminalAgentsStatus.NEEDS_ATTENTION),
        )
        assertEquals(all.rows, projection.rows)
        assertEquals(all.counts, projection.counts)
        assertEquals(3, projection.filteredCount)
        assertEquals(
            listOf(
                TerminalAgentsStatus.NEEDS_ATTENTION to BlockedReason.APPROVAL,
                TerminalAgentsStatus.NEEDS_ATTENTION to BlockedReason.ERROR,
                TerminalAgentsStatus.UNAVAILABLE to null,
            ),
            projection.groups.map { it.key.status to it.key.reason },
        )
        // Counts are not recomputed from the filtered set.
        assertEquals(1, projection.counts.byStatus.getValue(TerminalAgentsStatus.WORKING))
    }

    @Test
    fun projectOrderFollowsFirstFilteredEncounter() {
        val input = allStatusesInput()
        val projection = projector.project(input, selected(TerminalAgentsStatus.UNSUPPORTED, TerminalAgentsStatus.UNAVAILABLE))
        assertEquals(listOf("p2", "p4"), projection.groups.map { it.key.workspace.profileId })
    }

    @Test
    fun emptySelectionAndAllSevenNormalizeToAll() {
        val input = allStatusesInput()
        val all = projector.project(input, TerminalAgentsFilterSelection.All)
        assertEquals(all, projector.project(input, selected()))
        assertEquals(all, projector.project(input, TerminalAgentsFilterSelection.Selected(TerminalAgentsStatus.entries.reversed())))
    }

    @Test
    fun filteredEmptyDiffersFromNoAgentsAtAll() {
        val noAgents = projector.project(f.input(emptyList(), emptyList()), TerminalAgentsFilterSelection.All)
        assertTrue(noAgents.rows.isEmpty())
        assertTrue(noAgents.groups.isEmpty())
        assertEquals(0, noAgents.counts.all)
        assertEquals(0, noAgents.filteredCount)
        assertEquals(TerminalAgentsStatus.entries, noAgents.counts.byStatus.keys.toList())
        assertTrue(noAgents.counts.byStatus.values.all { it == 0 })

        val onlyWorking = f.simple(
            listOf(f.session("t")),
            listOf(f.observation("t", state = AgentState.WORKING)),
        )
        val filteredEmpty = projector.project(onlyWorking, selected(TerminalAgentsStatus.IDLE))
        assertEquals(1, filteredEmpty.rows.size)
        assertEquals(1, filteredEmpty.counts.all)
        assertEquals(0, filteredEmpty.filteredCount)
        assertTrue(filteredEmpty.groups.isEmpty())
    }

    @Test
    fun filterNeverMatchesByCachedStatusWhenAvailabilityOverrides() {
        val s = f.session("t")
        val rt = f.runtime()
        val offline = f.input(
            listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))),
            listOf(f.snapshot(rt, listOf(s), listOf(f.observation("t", state = AgentState.WORKING)), connected = false)),
        )
        assertEquals(0, projector.project(offline, selected(TerminalAgentsStatus.WORKING)).filteredCount)
        assertEquals(1, projector.project(offline, selected(TerminalAgentsStatus.UNAVAILABLE)).filteredCount)
    }

    @Test
    fun projectionRowsKeepRegistrationThenInventoryOrderUnderPermutedInput() {
        val rt = f.runtime()
        val sessions = listOf("a", "b", "c").map { f.session(it) }
        val observations = sessions.map { f.observation(it.id) }
        val owner = f.owner()
        val base = f.input(
            listOf(f.workspace(f.registration(owner), rt, sessions.reversed())),
            listOf(f.snapshot(rt, sessions, observations.reversed())),
        )
        // Published tab order and observation order are irrelevant; accepted inventory order wins.
        assertEquals(listOf("a", "b", "c"), projector.rows(base).map { it.target.instance.terminalId })
        val group = projector.project(base, TerminalAgentsFilterSelection.All).groups.single()
        assertEquals(listOf("a", "b", "c"), group.members.map { it.target.instance.terminalId })
    }
}
