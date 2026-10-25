package dev.damhopper.nativeapp.features.terminal

/**
 * Pure effective-availability and per-row presentation derivation for the Traditional terminal Agents roster.
 *
 * Runtime/registry/auth/socket truth always overrides a cached `READY`; this object never mutates the reducer and
 * never produces attention or notification effects.
 */
object TerminalAgentsPresenter {
    const val DONE_TURN_ENDED_LABEL: String = "Done (turn ended)"
    const val HOOK_COVERAGE_HINT: String =
        "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)"

    /**
     * Effective availability precedence. `null` means the logical identity is lost and the runtime's rows MUST be
     * purged (no rows, no cached display):
     *  1. identity lost => purge;
     *  2. not the current connected socket, or inventory not CURRENT => UNAVAILABLE;
     *  3. current typed snapshot HTTP 404 => UNSUPPORTED;
     *  4. other snapshot failure, or no installed baseline => UNAVAILABLE;
     *  5. installed wire PLATFORM_UNQUALIFIED => PLATFORM_UNQUALIFIED; installed wire UNAVAILABLE => UNAVAILABLE;
     *  6. only an installed wire READY => READY.
     */
    fun availability(snapshot: TerminalAgentsRuntimeSnapshot): TerminalAgentsAvailability? {
        if (!snapshot.isCurrentIdentity) return null
        if (!snapshot.isCurrentConnectedSocket || snapshot.inventoryHealth != TerminalAgentsInventoryHealth.CURRENT) {
            return TerminalAgentsAvailability.UNAVAILABLE
        }
        if (snapshot.snapshotFailure == TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND) {
            return TerminalAgentsAvailability.UNSUPPORTED
        }
        if (snapshot.snapshotFailure != null || !snapshot.statusBaselineInstalled || snapshot.status.isSnapshotLoading) {
            return TerminalAgentsAvailability.UNAVAILABLE
        }
        return when (snapshot.status.availability) {
            AgentStatusAvailability.PLATFORM_UNQUALIFIED -> TerminalAgentsAvailability.PLATFORM_UNQUALIFIED
            AgentStatusAvailability.UNAVAILABLE -> TerminalAgentsAvailability.UNAVAILABLE
            AgentStatusAvailability.READY -> TerminalAgentsAvailability.READY
        }
    }

    /**
     * Presentation of one observed agent under the given effective [availability]. Status, reason and the Done
     * secondary only come from the observation when availability is READY; source/coverage always describe the
     * observation itself.
     */
    fun present(availability: TerminalAgentsAvailability, observation: TerminalAgentStatusRow): TerminalAgentsPresentation {
        var status = TerminalAgentsStatus.UNAVAILABLE
        var reason: BlockedReason? = null
        var doneTurnEnded = false
        when (availability) {
            TerminalAgentsAvailability.UNAVAILABLE -> Unit
            TerminalAgentsAvailability.PLATFORM_UNQUALIFIED -> status = TerminalAgentsStatus.PLATFORM_UNQUALIFIED
            TerminalAgentsAvailability.UNSUPPORTED -> status = TerminalAgentsStatus.UNSUPPORTED
            TerminalAgentsAvailability.READY -> when (observation.state) {
                AgentState.UNKNOWN -> status = TerminalAgentsStatus.UNKNOWN
                AgentState.WORKING -> status = TerminalAgentsStatus.WORKING
                AgentState.BLOCKED -> {
                    status = TerminalAgentsStatus.NEEDS_ATTENTION
                    reason = observation.reason
                }
                AgentState.IDLE -> {
                    status = TerminalAgentsStatus.IDLE
                    doneTurnEnded = observation.lastOutcome == TurnOutcome.ENDED && observation.turnId == null
                }
            }
        }
        return TerminalAgentsPresentation(
            status = status,
            reason = reason,
            doneTurnEnded = doneTurnEnded,
            source = observation.source,
            coverageHint = coverageHint(observation.source),
        )
    }

    fun statusLabel(status: TerminalAgentsStatus): String = when (status) {
        TerminalAgentsStatus.NEEDS_ATTENTION -> "Needs attention"
        TerminalAgentsStatus.WORKING -> "Working"
        TerminalAgentsStatus.IDLE -> "Idle"
        TerminalAgentsStatus.UNKNOWN -> "Unknown"
        TerminalAgentsStatus.UNAVAILABLE -> "Unavailable"
        TerminalAgentsStatus.PLATFORM_UNQUALIFIED -> "Platform unqualified"
        TerminalAgentsStatus.UNSUPPORTED -> "Unsupported"
    }

    fun reasonLabel(reason: BlockedReason): String = when (reason) {
        BlockedReason.APPROVAL -> "Approval"
        BlockedReason.QUESTION -> "Question"
        BlockedReason.ERROR -> "Error"
    }

    fun sourceLabel(source: AgentObservationSource): String = when (source) {
        AgentObservationSource.LIFECYCLE -> "Lifecycle observation"
        AgentObservationSource.HOOK -> "Hook observation"
    }

    fun coverageHint(source: AgentObservationSource): String? = when (source) {
        AgentObservationSource.HOOK -> HOOK_COVERAGE_HINT
        AgentObservationSource.LIFECYCLE -> null
    }
}
