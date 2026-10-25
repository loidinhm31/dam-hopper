package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TerminalAgentsGroupingTest {
    private val f = TerminalAgentsTestFixtures

    private val alpha = f.owner(project = "alpha")
    private val beta = f.owner(project = "beta")

    private fun row(
        owner: WorkspaceFileOwner,
        id: String,
        status: TerminalAgentsStatus,
        reason: BlockedReason? = null,
        kind: AgentKind = AgentKind.OMP,
        source: AgentObservationSource = AgentObservationSource.LIFECYCLE,
        done: Boolean = false,
        incarnation: ULong = 1uL,
    ): TerminalAgentsRow {
        val profileId = owner.profileId!!
        return TerminalAgentsRow(
            target = TerminalAgentsTarget(
                registration = f.registration(owner),
                runtime = f.runtime(profileId),
                instance = TerminalAgentsInstanceKey(profileId, id, incarnation),
                serverEpoch = 1uL,
                statusAuthorityRevision = 1L,
            ),
            projectLabel = owner.project,
            profileLabel = "label-$profileId",
            terminalTitle = "title-$id",
            agentKind = kind,
            presentation = TerminalAgentsPresenter.present(
                TerminalAgentsAvailability.READY,
                f.observation(id, source = source),
            ).copy(status = status, reason = reason, doneTurnEnded = done),
        )
    }

    private fun TerminalAgentsGroup.ids() = members.map { it.target.instance.terminalId }

    @Test
    fun emptyInputYieldsNoGroups() {
        assertTrue(TerminalAgentsGrouping.group(emptyList()).isEmpty())
    }

    @Test
    fun projectsKeepFirstEncounterAndStatusesFollowEnumOrder() {
        val rows = listOf(
            row(beta, "b1", TerminalAgentsStatus.UNSUPPORTED),
            row(alpha, "a1", TerminalAgentsStatus.IDLE),
            row(beta, "b2", TerminalAgentsStatus.NEEDS_ATTENTION, BlockedReason.ERROR),
            row(alpha, "a2", TerminalAgentsStatus.WORKING),
            row(alpha, "a3", TerminalAgentsStatus.UNKNOWN),
        )
        val groups = TerminalAgentsGrouping.group(rows)
        assertEquals(
            listOf(
                "beta" to TerminalAgentsStatus.NEEDS_ATTENTION,
                "beta" to TerminalAgentsStatus.UNSUPPORTED,
                "alpha" to TerminalAgentsStatus.WORKING,
                "alpha" to TerminalAgentsStatus.IDLE,
                "alpha" to TerminalAgentsStatus.UNKNOWN,
            ),
            groups.map { it.key.workspace.project to it.key.status },
        )
        assertTrue(groups.all { it.members.isNotEmpty() })
    }

    @Test
    fun everyStatusSortsInEnumOrderWithinAProject() {
        val rows = TerminalAgentsStatus.entries.reversed().map { row(alpha, "t-${it.name}", it) }
        assertEquals(TerminalAgentsStatus.entries, TerminalAgentsGrouping.group(rows).map { it.key.status })
    }

    @Test
    fun reasonsSortAlphabeticallyByRenderedLabelWithNullFirst() {
        val rows = listOf(
            row(alpha, "q", TerminalAgentsStatus.NEEDS_ATTENTION, BlockedReason.QUESTION),
            row(alpha, "e", TerminalAgentsStatus.NEEDS_ATTENTION, BlockedReason.ERROR),
            row(alpha, "n", TerminalAgentsStatus.NEEDS_ATTENTION, null),
            row(alpha, "a", TerminalAgentsStatus.NEEDS_ATTENTION, BlockedReason.APPROVAL),
        )
        val groups = TerminalAgentsGrouping.group(rows)
        assertEquals(listOf(null, BlockedReason.APPROVAL, BlockedReason.ERROR, BlockedReason.QUESTION), groups.map { it.key.reason })
        assertEquals(listOf("n", "a", "e", "q"), groups.map { it.ids().single() })
    }

    @Test
    fun nonAdjacentRowsMergeAndMemberTabOrderIsUnchanged() {
        val rows = listOf(
            row(alpha, "w3", TerminalAgentsStatus.WORKING),
            row(alpha, "i1", TerminalAgentsStatus.IDLE),
            row(alpha, "w1", TerminalAgentsStatus.WORKING),
            row(beta, "w9", TerminalAgentsStatus.WORKING),
            row(alpha, "w2", TerminalAgentsStatus.WORKING),
        )
        val groups = TerminalAgentsGrouping.group(rows)
        assertEquals(3, groups.size)
        assertEquals(listOf("w3", "w1", "w2"), groups[0].ids())
        assertEquals(listOf("i1"), groups[1].ids())
        assertEquals(listOf("w9"), groups[2].ids())
    }

    @Test
    fun equalProjectLabelsOnDifferentProfilesOrWorktreesStaySeparate() {
        val p1 = f.owner(profileId = "p1", project = "same")
        val p2 = f.owner(profileId = "p2", project = "same")
        val worktree = f.owner(profileId = "p1", project = "same", worktree = "wt")
        val rows = listOf(
            row(p1, "t", TerminalAgentsStatus.WORKING),
            row(p2, "t", TerminalAgentsStatus.WORKING),
            row(worktree, "t", TerminalAgentsStatus.WORKING),
        )
        val groups = TerminalAgentsGrouping.group(rows)
        assertEquals(3, groups.size)
        assertEquals(listOf("p1", "p2", "p1"), groups.map { it.key.workspace.profileId })
        assertEquals(listOf("label-p1", "label-p2", "label-p1"), groups.map { it.profileLabel })
    }

    @Test
    fun harnessesFollowFixedOrderAndAreUnique() {
        val rows = listOf(
            row(alpha, "1", TerminalAgentsStatus.WORKING, kind = AgentKind.CLAUDE),
            row(alpha, "2", TerminalAgentsStatus.WORKING, kind = AgentKind.CODEX),
            row(alpha, "3", TerminalAgentsStatus.WORKING, kind = AgentKind.CLAUDE),
            row(alpha, "4", TerminalAgentsStatus.WORKING, kind = AgentKind.OMP),
        )
        assertEquals(
            listOf(AgentKind.OMP, AgentKind.CODEX, AgentKind.CLAUDE),
            TerminalAgentsGrouping.group(rows).single().agentKinds,
        )
        assertEquals(
            listOf(AgentKind.CODEX),
            TerminalAgentsGrouping.group(listOf(row(alpha, "x", TerminalAgentsStatus.IDLE, kind = AgentKind.CODEX))).single().agentKinds,
        )
    }

    @Test
    fun sourceAndCoverageHintsAreUniqueInEncounterOrder() {
        val hook = AgentObservationSource.HOOK
        val lifecycle = AgentObservationSource.LIFECYCLE
        fun withHint(source: AgentObservationSource, id: String) =
            row(alpha, id, TerminalAgentsStatus.WORKING, source = source).let {
                it.copy(presentation = it.presentation.copy(coverageHint = TerminalAgentsPresenter.coverageHint(source)))
            }
        val groups = TerminalAgentsGrouping.group(
            listOf(withHint(hook, "1"), withHint(lifecycle, "2"), withHint(hook, "3")),
        )
        val group = groups.single()
        assertEquals(listOf(hook, lifecycle), group.sources)
        assertEquals(listOf(TerminalAgentsPresenter.HOOK_COVERAGE_HINT), group.coverageHints)

        val lifecycleOnly = TerminalAgentsGrouping.group(listOf(withHint(lifecycle, "1"), withHint(lifecycle, "2"))).single()
        assertEquals(listOf(lifecycle), lifecycleOnly.sources)
        assertTrue(lifecycleOnly.coverageHints.isEmpty())

        val lifecycleFirst = TerminalAgentsGrouping.group(listOf(withHint(lifecycle, "1"), withHint(hook, "2"))).single()
        assertEquals(listOf(lifecycle, hook), lifecycleFirst.sources)
    }

    @Test
    fun doneTurnEndedIsUnanimousOnly() {
        fun group(vararg done: Boolean) = TerminalAgentsGrouping.group(
            done.mapIndexed { i, d -> row(alpha, "t$i", TerminalAgentsStatus.IDLE, done = d) },
        ).single()

        assertTrue(group(true).doneTurnEnded)
        assertTrue(group(true, true, true).doneTurnEnded)
        assertFalse(group(true, false).doneTurnEnded)
        assertFalse(group(false, true).doneTurnEnded)
        assertFalse(group(false).doneTurnEnded)
    }

    @Test
    fun nextTargetCyclesWrapsAndStartsAtFirstWhenActiveIsElsewhere() {
        val rows = listOf("t1", "t2", "t3").map { row(alpha, it, TerminalAgentsStatus.WORKING) }
        val group = TerminalAgentsGrouping.group(rows).single()
        val projector = DefaultTerminalAgentsProjector()
        fun key(id: String, profile: String = "p1", incarnation: ULong = 1uL) = TerminalAgentsInstanceKey(profile, id, incarnation)

        assertEquals(rows[1].target, projector.nextTarget(group, key("t1")))
        assertEquals(rows[2].target, projector.nextTarget(group, key("t2")))
        assertEquals(rows[0].target, projector.nextTarget(group, key("t3")))
        // Active elsewhere / none => first member.
        assertEquals(rows[0].target, projector.nextTarget(group, key("other")))
        assertEquals(rows[0].target, projector.nextTarget(group, null))
        // Same bare ID on another profile, or another incarnation, is not the active member.
        assertEquals(rows[0].target, projector.nextTarget(group, key("t2", profile = "p2")))
        assertEquals(rows[0].target, projector.nextTarget(group, key("t2", incarnation = 2uL)))
    }

    @Test
    fun nextTargetOfSingleMemberReturnsItselfAndEmptyGroupReturnsNull() {
        val single = TerminalAgentsGrouping.group(listOf(row(alpha, "only", TerminalAgentsStatus.IDLE))).single()
        val projector = DefaultTerminalAgentsProjector()
        assertEquals(single.members[0].target, projector.nextTarget(single, TerminalAgentsInstanceKey("p1", "only", 1uL)))
        assertEquals(single.members[0].target, projector.nextTarget(single, null))
        assertNull(projector.nextTarget(single.copy(members = emptyList()), null))
    }

    @Test
    fun nextTargetReturnsExactCapturedTargetNotAnotherProfilesSameId() {
        val p1 = f.owner(profileId = "p1", project = "same")
        val p2 = f.owner(profileId = "p2", project = "same")
        val a = row(p1, "t", TerminalAgentsStatus.WORKING)
        val b = row(p2, "t", TerminalAgentsStatus.WORKING)
        // Hypothetical merged group (UI never builds one) must still compare by qualified key.
        val merged = TerminalAgentsGrouping.group(listOf(a)).single().copy(members = listOf(a, b))
        val projector = DefaultTerminalAgentsProjector()
        assertEquals(b.target, projector.nextTarget(merged, a.target.instance))
        assertEquals(a.target, projector.nextTarget(merged, b.target.instance))
    }
}
