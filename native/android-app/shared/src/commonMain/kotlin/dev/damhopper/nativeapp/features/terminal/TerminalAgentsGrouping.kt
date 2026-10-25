package dev.damhopper.nativeapp.features.terminal

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
}
