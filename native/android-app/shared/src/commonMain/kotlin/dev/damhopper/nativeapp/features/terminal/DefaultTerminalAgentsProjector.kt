package dev.damhopper.nativeapp.features.terminal

/**
 * Pure projector: membership join -> presentation -> unfiltered counts -> status filter -> stable groups.
 * Never touches storage/network and never produces notification effects.
 */
class DefaultTerminalAgentsProjector(
    private val codec: TerminalAgentsFilterCodec = DefaultTerminalAgentsFilterCodec(),
) : TerminalAgentsProjector {

    override fun rows(input: TerminalAgentsProjectionInput): List<TerminalAgentsRow> =
        TerminalAgentsMembership.join(input).members.map { toRow(it) }

    override fun project(
        input: TerminalAgentsProjectionInput,
        selection: TerminalAgentsFilterSelection,
    ): TerminalAgentsProjection = project(TerminalAgentsMembership.join(input), selection)

    fun project(
        membership: TerminalAgentsMembershipResult,
        selection: TerminalAgentsFilterSelection,
    ): TerminalAgentsProjection {
        val rows = membership.members.map { toRow(it) }
        val byStatus = LinkedHashMap<TerminalAgentsStatus, Int>()
        for (status in TerminalAgentsStatus.entries) byStatus[status] = 0
        for (row in rows) byStatus[row.presentation.status] = byStatus.getValue(row.presentation.status) + 1

        val effective = when (selection) {
            TerminalAgentsFilterSelection.All -> selection
            is TerminalAgentsFilterSelection.Selected -> codec.normalize(selection.statuses)
        }
        val filtered = when (effective) {
            TerminalAgentsFilterSelection.All -> rows
            is TerminalAgentsFilterSelection.Selected -> {
                val allowed = effective.statuses.toSet()
                rows.filter { it.presentation.status in allowed }
            }
        }
        return TerminalAgentsProjection(
            rows = rows,
            groups = TerminalAgentsGrouping.group(filtered),
            counts = TerminalAgentsCounts(all = rows.size, byStatus = byStatus),
            filteredCount = filtered.size,
        )
    }

    override fun nextTarget(group: TerminalAgentsGroup, active: TerminalAgentsInstanceKey?): TerminalAgentsTarget? =
        TerminalAgentsGrouping.nextTarget(group, active)

    private fun toRow(member: TerminalAgentsMember): TerminalAgentsRow = TerminalAgentsRow(
        target = member.target,
        projectLabel = member.projectLabel,
        profileLabel = member.profileLabel,
        terminalTitle = member.session.displayName,
        agentKind = member.observation.agentKind,
        presentation = TerminalAgentsPresenter.present(member.availability, member.observation),
    )
}
