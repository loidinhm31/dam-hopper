package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.HubTerminalRow
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

/**
 * Pure grouping and exact-target cycling over already-qualified rows; mirrors the web roster semantics.
 */
object TerminalAgentsGrouping {
    /**
     * Collapses [rows] into one group per (workspace owner, status, reason).
     *
     * Order: workspaces by first encounter in [rows], statuses in enum order, reasons by rendered English label with
     * `null` first. Members keep the given (tab) order; harnesses use enum order OMP/CODEX/CLAUDE; source/coverage
     * hints are unique in encounter order; `doneTurnEnded` is true only when every member is. Never emits empty groups.
     */
    fun group(rows: List<TerminalAgentsRow>): List<TerminalAgentsGroup> {
        val buckets = LinkedHashMap<TerminalAgentsGroupKey, MutableList<TerminalAgentsRow>>()
        val workspaceOrder = HashMap<WorkspaceFileOwner, Int>()
        for (row in rows) {
            val owner = row.target.registration.owner
            val key = TerminalAgentsGroupKey(owner, row.presentation.status, row.presentation.reason)
            buckets.getOrPut(key) { ArrayList() }.add(row)
            if (owner !in workspaceOrder) workspaceOrder[owner] = workspaceOrder.size
        }
        val groups = buckets.map { (key, members) ->
            val first = members.first()
            val kinds = members.mapTo(HashSet()) { it.agentKind }
            TerminalAgentsGroup(
                key = key,
                projectLabel = first.projectLabel,
                profileLabel = first.profileLabel,
                members = members.toList(),
                agentKinds = AgentKind.entries.filter { it in kinds },
                sources = members.map { it.presentation.source }.distinct(),
                coverageHints = members.mapNotNull { it.presentation.coverageHint }.distinct(),
                doneTurnEnded = members.all { it.presentation.doneTurnEnded },
            )
        }
        return groups.sortedWith(
            compareBy<TerminalAgentsGroup>(
                { workspaceOrder.getValue(it.key.workspace) },
                { it.key.status.ordinal },
            ).thenBy { group -> group.key.reason?.let { TerminalAgentsPresenter.reasonLabel(it) } ?: "" },
        )
    }

    /**
     * Next member after [active] (wrapping); the first member when [active] is null or outside the group; `null`
     * only for a defensively empty group. Comparison uses the full qualified instance key, never a bare ID.
     */
    fun nextTarget(group: TerminalAgentsGroup, active: TerminalAgentsInstanceKey?): TerminalAgentsTarget? {
        val members = group.members
        if (members.isEmpty()) return null
        val index = if (active == null) -1 else members.indexOfFirst { it.target.instance == active }
        return members[(index + 1) % members.size].target
    }

    /**
     * Pure predicate evaluating whether a project target can be safely dismissed from the Hub.
     *
     * Dismissal is ENABLED ONLY WHEN:
     * 1. The inventory for this target is authoritative and loaded ([isInventoryAuthoritativeLoaded] is true), AND
     * 2. [isConnected] is true (unavailable or disconnected inventory blocks dismissal), AND
     * 3. There are ZERO deduplicated live, hidden, restartPending, and admitted-or-unknown-create refs.
     *
     * Missing, refreshing, conflicting, or stale authority fails closed (returns false).
     */
    fun canDismissProjectTarget(
        isInventoryAuthoritativeLoaded: Boolean,
        isConnected: Boolean,
        terminals: Collection<HubTerminalRow> = emptyList(),
        agentGroups: Collection<TerminalAgentsGroup> = emptyList(),
        hiddenTerminalIds: Set<String> = emptySet(),
        restartPendingTerminalIds: Set<String> = emptySet(),
        pendingCreateIntents: Collection<UncertainCreateRecord> = emptyList(),
    ): Boolean {
        if (!isInventoryAuthoritativeLoaded || !isConnected) return false
        if (agentGroups.isNotEmpty()) return false
        if (hiddenTerminalIds.isNotEmpty()) return false
        if (restartPendingTerminalIds.isNotEmpty()) return false
        if (pendingCreateIntents.isNotEmpty()) return false
        for (t in terminals) {
            if (t.alive || t.isHidden) return false
        }
        return true
    }

    /**
     * Pure predicate evaluating dismissal from raw detailed session inventory.
     */
    fun canDismissOwnerInventory(
        isInventoryAuthoritativeLoaded: Boolean,
        isConnected: Boolean = true,
        sessions: Collection<TerminalSessionDetailed> = emptyList(),
        hiddenSessionIds: Set<String> = emptySet(),
        pendingCreateIntentIds: Set<String> = emptySet(),
    ): Boolean {
        if (!isInventoryAuthoritativeLoaded || !isConnected) return false
        val activeTerminalIds = HashSet<String>()
        for (s in sessions) {
            if (s.alive || s.id in hiddenSessionIds || s.terminationState == "restartPending") {
                activeTerminalIds.add(s.id)
            }
        }
        activeTerminalIds.addAll(hiddenSessionIds)
        return activeTerminalIds.isEmpty() && pendingCreateIntentIds.isEmpty()
    }

    /**
     * Pure composition of project/worktree rows from observed session groups plus explicit
     * zero-session open targets.
     *
     * Requirements:
     * - Open zero-session projects/worktrees coexist with real PTY groups without implicit spawn/connect.
     * - Badges disambiguate profiles.
     * - Unavailable owners keep pins/selections; pruned ONLY from authoritative owner inventory.
     * - Independent selectable row and sibling >=48dp create/dismiss controls.
     */
    fun composeProjectRows(
        openTargets: List<ProjectTargetRef>,
        openOwners: List<WorkspaceFileOwner> = emptyList(),
        observedGroups: List<TerminalAgentsGroup> = emptyList(),
        terminalRows: List<HubTerminalRow> = emptyList(),
        selectedTarget: ProjectTargetRef? = null,
        pinnedTargets: Set<ProjectTargetRef> = emptySet(),
        profileLabels: Map<ProfileId?, String> = emptyMap(),
        isInventoryLoaded: Boolean = false,
        isConnected: Boolean = false,
        hiddenTerminalIds: Set<String> = emptySet(),
        restartPendingTerminalIds: Set<String> = emptySet(),
        pendingCreateIntents: List<UncertainCreateRecord> = emptyList(),
        unavailableTargets: Set<ProjectTargetRef> = emptySet(),
        unsupportedTargets: Set<ProjectTargetRef> = emptySet(),
    ): List<AgentHubProjectRowState> {
        val targets = LinkedHashSet<ProjectTargetRef>()
        // 1. Explicit open targets (including zero-session open refs)
        targets.addAll(openTargets)
        // 2. Discovered targets from observed groups
        for (group in observedGroups) {
            val owner = group.key.workspace
            targets.add(
                ProjectTargetRef(
                    profileId = owner.profileId,
                    project = owner.project,
                    worktreePath = owner.worktreePath,
                )
            )
        }
        // 3. Targets from terminals
        for (term in terminalRows) {
            term.projectTarget?.let { targets.add(it) }
        }
        // 4. Preserve pinned and selected targets even if unavailable/disconnected
        targets.addAll(pinnedTargets)
        selectedTarget?.let { targets.add(it) }

        val rows = ArrayList<AgentHubProjectRowState>()
        for (target in targets) {
            val matchingTerminals = terminalRows.filter { it.projectTarget == target }
            val matchingGroups = observedGroups.filter { group ->
                val owner = group.key.workspace
                owner.project == target.project &&
                    owner.worktreePath == target.worktreePath &&
                    owner.profileId == target.profileId
            }
            val matchingCreates = pendingCreateIntents.filter {
                it.project == target.project &&
                    it.worktreePath == target.worktreePath &&
                    it.profileId == (target.profileId ?: "")
            }
            val isAvailable = isConnected && (target !in unavailableTargets)
            val isUnsupported = target in unsupportedTargets
            val sessionCount = maxOf(matchingTerminals.size, if (matchingGroups.isNotEmpty()) 1 else 0)
            val agentCount = matchingGroups.sumOf { it.members.size }
            val isSelected = (target == selectedTarget)
            val isPinned = (target in pinnedTargets)

            val statusLabel = when {
                !isAvailable -> "Disconnected"
                isUnsupported -> "Unsupported"
                sessionCount == 0 -> "0 sessions"
                sessionCount == 1 -> "1 session"
                else -> "$sessionCount sessions"
            }

            val matchingTerminalIds = matchingTerminals.map { it.id }.toSet()
            val canDismiss = canDismissProjectTarget(
                isInventoryAuthoritativeLoaded = isInventoryLoaded,
                isConnected = isAvailable,
                terminals = matchingTerminals,
                agentGroups = matchingGroups,
                hiddenTerminalIds = hiddenTerminalIds.intersect(matchingTerminalIds),
                restartPendingTerminalIds = restartPendingTerminalIds.intersect(matchingTerminalIds),
                pendingCreateIntents = matchingCreates,
            )

            // Capture and preserve exact WorkspaceFileOwner identity
            val matchingOwner = openOwners.firstOrNull {
                it.project == target.project &&
                    it.worktreePath == target.worktreePath &&
                    it.profileId == target.profileId
            } ?: matchingGroups.firstOrNull()?.key?.workspace

            // Handle profile disambiguation where two distinct profiles have identical labels
            val baseLabel = profileLabels[target.profileId] ?: target.profileId ?: "Default"
            val duplicateLabelCount = profileLabels.entries.count { it.value == baseLabel && it.key != target.profileId }
            val profileLabel = if (duplicateLabelCount > 0 && target.profileId != null) {
                "$baseLabel (${target.profileId})"
            } else {
                baseLabel
            }

            rows.add(
                AgentHubProjectRowState(
                    target = target,
                    projectLabel = target.project,
                    profileLabel = profileLabel,
                    worktreeLabel = target.worktreePath,
                    sessionCount = sessionCount,
                    agentCount = agentCount,
                    isSelected = isSelected,
                    isPinned = isPinned,
                    isAvailable = isAvailable,
                    isUnsupported = isUnsupported,
                    canDismiss = canDismiss,
                    statusLabel = statusLabel,
                    agentGroups = matchingGroups,
                    owner = matchingOwner,
                )
            )
        }

        // Pinned rows sort first, then preserving encounter order
        return rows.sortedWith(
            compareByDescending<AgentHubProjectRowState> { it.isPinned }
        )
    }
}
