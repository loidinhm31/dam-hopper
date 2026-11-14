package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.HubTerminalRow
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

    @Test
    fun zeroSessionOpenProjectsCoexistWithObservedGroups() {
        val targetZero = ProjectTargetRef(profileId = "p1", project = "zero-session-proj")
        val targetActive = ProjectTargetRef(profileId = "p1", project = "alpha")
        val activeRow = row(alpha, "t1", TerminalAgentsStatus.WORKING)
        val groups = TerminalAgentsGrouping.group(listOf(activeRow))

        val composed = TerminalAgentsGrouping.composeProjectRows(
            openTargets = listOf(targetZero, targetActive),
            observedGroups = groups,
            terminalRows = listOf(
                HubTerminalRow(
                    id = "t1",
                    displayName = "t1",
                    command = "bash",
                    projectTarget = targetActive,
                ),
            ),
            isInventoryLoaded = true,
            isConnected = true,
        )

        assertEquals(2, composed.size)
        val zeroRow = composed.first { it.target == targetZero }
        assertEquals("zero-session-proj", zeroRow.projectLabel)
        assertEquals(0, zeroRow.sessionCount)
        assertEquals(0, zeroRow.agentCount)
        assertEquals("0 sessions", zeroRow.statusLabel)
        assertTrue(zeroRow.canDismiss) // Zero sessions + authoritative loaded => dismiss enabled

        val activeProjRow = composed.first { it.target == targetActive }
        assertEquals("alpha", activeProjRow.projectLabel)
        assertEquals(1, activeProjRow.sessionCount)
        assertEquals(1, activeProjRow.agentCount)
        assertFalse(activeProjRow.canDismiss) // Active session => dismiss blocked
    }

    @Test
    fun multiProfileProjectsDisambiguatedByBadges() {
        val p1 = "profile-prod"
        val p2 = "profile-dev"
        val targetProd = ProjectTargetRef(profileId = p1, project = "dam-hopper")
        val targetDev = ProjectTargetRef(profileId = p2, project = "dam-hopper")

        val composed = TerminalAgentsGrouping.composeProjectRows(
            openTargets = listOf(targetProd, targetDev),
            profileLabels = mapOf(p1 to "Production", p2 to "Development"),
            isInventoryLoaded = true,
            isConnected = true,
        )

        assertEquals(2, composed.size)
        val prodRow = composed.first { it.target.profileId == p1 }
        val devRow = composed.first { it.target.profileId == p2 }
        assertEquals("Production", prodRow.profileLabel)
        assertEquals("Development", devRow.profileLabel)
        assertEquals("dam-hopper", prodRow.projectLabel)
        assertEquals("dam-hopper", devRow.projectLabel)
    }

    @Test
    fun unavailableOwnersRetainPinsAndSelectionsWithoutPruning() {
        val targetPinned = ProjectTargetRef(profileId = "p1", project = "pinned-offline")
        val targetSelected = ProjectTargetRef(profileId = "p1", project = "selected-offline")

        val composed = TerminalAgentsGrouping.composeProjectRows(
            openTargets = emptyList(), // Not in openTargets
            observedGroups = emptyList(), // Not in observed groups
            selectedTarget = targetSelected,
            pinnedTargets = setOf(targetPinned),
            unavailableTargets = setOf(targetPinned, targetSelected),
            isInventoryLoaded = false,
            isConnected = false,
        )

        assertEquals(2, composed.size)
        val pinnedRow = composed.first { it.target == targetPinned }
        assertTrue(pinnedRow.isPinned)
        assertFalse(pinnedRow.isAvailable)
        assertEquals("Disconnected", pinnedRow.statusLabel)
        assertFalse(pinnedRow.canDismiss) // Unavailable => cannot dismiss

        val selectedRow = composed.first { it.target == targetSelected }
        assertTrue(selectedRow.isSelected)
        assertFalse(selectedRow.isAvailable)
        assertEquals("Disconnected", selectedRow.statusLabel)
        assertFalse(selectedRow.canDismiss)
    }

    @Test
    fun dismissalPredicateEvaluatesAuthoritativeInventoryAndActiveRefs() {
        // Authoritative loaded and 0 refs => dismiss enabled
        assertTrue(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                terminals = emptyList(),
                hiddenTerminalIds = emptySet(),
                pendingCreateIntents = emptyList(),
            )
        )

        // Not loaded => fail closed
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = false,
                isConnected = true,
                terminals = emptyList(),
            )
        )

        // Disconnected => fail closed
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = false,
                terminals = emptyList(),
            )
        )

        // Live terminal => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                terminals = listOf(
                    HubTerminalRow(id = "live-1", displayName = "live", command = "sh", alive = true),
                ),
            )
        )

        // Hidden terminal in terminals => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                terminals = listOf(
                    HubTerminalRow(id = "hidden-1", displayName = "hidden", command = "sh", alive = false, isHidden = true),
                ),
            )
        )

        // Hidden terminal in hidden IDs => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                hiddenTerminalIds = setOf("hidden-2"),
            )
        )

        // Pending create intent => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                pendingCreateIntents = listOf(
                    UncertainCreateRecord(
                        intentId = "intent-1",
                        profileId = "p1",
                        terminalId = "term-1",
                        project = "proj",
                        createdAtEpochMs = 1000L,
                    ),
                ),
            )
        )

        // Active agent group without terminalRows => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                agentGroups = listOf(TerminalAgentsGrouping.group(listOf(row(alpha, "t1", TerminalAgentsStatus.WORKING))).single()),
            )
        )

        // Target restartPending => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                terminals = listOf(HubTerminalRow(id = "r1", displayName = "r1", command = "sh", alive = false)),
                restartPendingTerminalIds = setOf("r1"),
            )
        )

        // Raw inventory restartPending => blocked
        assertFalse(
            TerminalAgentsGrouping.canDismissOwnerInventory(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                sessions = listOf(
                    TerminalSessionDetailed(
                        id = "restart-1",
                        command = "sh",
                        cwd = "/tmp",
                        alive = false,
                        terminationState = "restartPending",
                    ),
                ),
            )
        )

        // Deduplicated refs: same terminal both live and in hidden set still blocks dismissal
        assertFalse(
            TerminalAgentsGrouping.canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = true,
                isConnected = true,
                terminals = listOf(
                    HubTerminalRow(id = "dup-1", displayName = "dup", command = "sh", alive = true),
                ),
                hiddenTerminalIds = setOf("dup-1"),
            )
        )
    }

    @Test
    fun composeProjectRowsPreservesWorkspaceFileOwnerAndHandlesDuplicateProfileLabels() {
        val p1 = "p1"
        val p2 = "p2"
        val owner1 = f.owner(profileId = "p1", project = "proj", worktree = "feat")
        val target1 = ProjectTargetRef(profileId = p1, project = "proj", worktreePath = "feat")
        val target2 = ProjectTargetRef(profileId = p2, project = "proj", worktreePath = "feat")

        // Both profiles configured with the same visible label string "Shared Server"
        val rows = TerminalAgentsGrouping.composeProjectRows(
            openTargets = listOf(target1, target2),
            openOwners = listOf(owner1),
            profileLabels = mapOf(p1 to "Shared Server", p2 to "Shared Server"),
            isInventoryLoaded = true,
            isConnected = true,
        )

        assertEquals(2, rows.size)
        val r1 = rows.first { it.target == target1 }
        val r2 = rows.first { it.target == target2 }
        // Captured owner faithfully preserved on r1
        assertEquals(owner1, r1.owner)
        assertEquals(owner1.baseUrl, r1.owner?.baseUrl)
        assertEquals(owner1.accountUser, r1.owner?.accountUser)
        // Identical labels disambiguated with profileId
        assertEquals("Shared Server (p1)", r1.profileLabel)
        assertEquals("Shared Server (p2)", r2.profileLabel)
    }
}
