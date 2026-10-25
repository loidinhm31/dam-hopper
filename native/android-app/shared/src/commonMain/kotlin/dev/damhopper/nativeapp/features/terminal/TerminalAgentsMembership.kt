package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

/** One qualified agent-bearing terminal: exact captured [target], joined server metadata and observation. */
data class TerminalAgentsMember(
    val target: TerminalAgentsTarget,
    val session: TerminalSessionDetailed,
    val observation: TerminalAgentStatusRow,
    /** Effective availability; always UNAVAILABLE for display-only cached membership. */
    val availability: TerminalAgentsAvailability,
    val projectLabel: String,
    val profileLabel: String,
)

/** A terminal ID whose accepted metadata was contradictory; the instance is excluded (fail closed). */
data class TerminalAgentsMembershipConflict(
    val runtime: TerminalAgentsRuntimeKey,
    val terminalId: String,
)

data class TerminalAgentsMembershipResult(
    val members: List<TerminalAgentsMember>,
    /** Non-empty means the owning runtime inventory should be marked CONFLICT and a refresh offered. */
    val conflicts: List<TerminalAgentsMembershipConflict>,
)

/**
 * Pure join of explicitly registered workspaces, accepted server inventory, published visible/selectable tabs and
 * agent observations.
 *
 * - Registrations are iterated by `order`; members follow the accepted inventory (tab-list) order.
 * - A fresh candidate needs the workspace runtime to equal the current runtime snapshot, the accepted inventory to
 *   come from that runtime at the workspace's inventory ticket, matching ID+incarnation in inventory and published
 *   tab, alive, traditional, not `targetUnavailable`, not excluded, exact project and normalized worktree.
 * - Same-logical-owner (profile + normalized endpoint + account) workspaces whose runtime/ticket is no longer
 *   current retain display-only members built from the previously published tabs and `cachedObservations`, always
 *   UNAVAILABLE, targeting their captured old runtime (never upgraded to a successor) with a never-matching fence.
 * - Pure: conflicts are returned, not applied. The owning service MUST feed a non-empty
 *   [TerminalAgentsMembershipResult.conflicts] into the runtime's `inventoryHealth = CONFLICT` (and offer refresh).
 * - No matching observation means no member; harness is never inferred from the process.
 * - Conflicting duplicate metadata excludes the terminal and is reported in [TerminalAgentsMembershipResult.conflicts].
 */
object TerminalAgentsMembership {
    fun isTraditionalType(type: String): Boolean =
        type == "traditional" || type == "terminal" || type == "shell" || type == "free"

    /** Authority revision that no reducer ever holds; fences display-only targets. */
    const val NO_AUTHORITY: Long = -1L

    private data class Canonical(
        val incarnation: ULong,
        val project: String?,
        val worktree: String?,
        val sessionType: String,
        val alive: Boolean,
        val targetUnavailable: Boolean,
    )

    private fun canonical(session: TerminalSessionDetailed) = Canonical(
        incarnation = session.incarnation,
        project = session.project,
        worktree = WorkspaceFileOwner.normalizeWorktree(session.worktreePath),
        sessionType = session.sessionType,
        alive = session.alive,
        targetUnavailable = session.targetUnavailable,
    )

    fun join(input: TerminalAgentsProjectionInput): TerminalAgentsMembershipResult {
        val conflicts = LinkedHashSet<TerminalAgentsMembershipConflict>()
        val candidates = ArrayList<TerminalAgentsMember>()
        val observationCache = HashMap<Pair<Int, Boolean>, Map<String, List<TerminalAgentStatusRow>>>()
        val ordered = input.workspaces.sortedWith(
            compareBy({ it.registration.order }, { it.registration.registrationId }),
        )
        for (workspace in ordered) {
            joinWorkspace(workspace, input, candidates, conflicts, observationCache)
        }
        // Any reported conflict excludes that runtime/terminal ID everywhere, including candidates from other
        // registrations emitted before the conflict was discovered.
        val admissible = candidates.filter {
            TerminalAgentsMembershipConflict(it.target.runtime, it.session.id) !in conflicts
        }
        return TerminalAgentsMembershipResult(
            members = dedupe(admissible, conflicts),
            conflicts = conflicts.toList(),
        )
    }

    /** Runtime key must agree with the logical owner and be internally consistent. */
    private fun isValidRuntimeFor(runtime: TerminalAgentsRuntimeKey, owner: WorkspaceFileOwner): Boolean =
        owner.profileId != null &&
            runtime.connection.profileId == owner.profileId &&
            runtime.socket.connection == runtime.connection &&
            runtime.attachmentIncarnation > 0L &&
            WorkspaceFileOwner.normalizeBaseUrl(runtime.endpoint) == owner.normalizedBaseUrl &&
            runtime.accountUser == owner.accountUser

    private fun qualifies(session: TerminalSessionDetailed, owner: WorkspaceFileOwner): Boolean =
        session.alive &&
            isTraditionalType(session.sessionType) &&
            !session.targetUnavailable &&
            session.project == owner.project &&
            WorkspaceFileOwner.normalizeWorktree(session.worktreePath) == owner.normalizedWorktreePath

    /** First-occurrence order by terminal ID; an ID with differing canonical metadata is dropped and reported. */
    private fun uniqueById(
        sessions: List<TerminalSessionDetailed>,
        runtime: TerminalAgentsRuntimeKey,
        conflicts: MutableSet<TerminalAgentsMembershipConflict>,
    ): Map<String, TerminalSessionDetailed> {
        val byId = LinkedHashMap<String, TerminalSessionDetailed>()
        val conflicted = HashSet<String>()
        for (session in sessions) {
            val existing = byId[session.id]
            if (existing == null) {
                byId[session.id] = session
            } else if (canonical(existing) != canonical(session)) {
                conflicted.add(session.id)
            }
        }
        for (id in conflicted) {
            byId.remove(id)
            conflicts.add(TerminalAgentsMembershipConflict(runtime, id))
        }
        return byId
    }

    private fun joinWorkspace(
        workspace: TerminalAgentsWorkspaceSnapshot,
        input: TerminalAgentsProjectionInput,
        out: MutableList<TerminalAgentsMember>,
        conflicts: MutableSet<TerminalAgentsMembershipConflict>,
        observationCache: MutableMap<Pair<Int, Boolean>, Map<String, List<TerminalAgentStatusRow>>>,
    ) {
        val owner = workspace.registration.owner
        val profileId = owner.profileId ?: run { println("[membership] profileId is null"); return }
        val profileLabel = input.profileLabels[profileId]?.takeIf { it.isNotBlank() }
            ?: if (input.profileLabels.containsKey(profileId)) profileId else run { println("[membership] profileLabel missing for $profileId, profileLabels=${input.profileLabels}"); return }
        if (!isValidRuntimeFor(workspace.runtime, owner)) {
            println("[membership] isValidRuntimeFor failed for ${workspace.runtime} and $owner")
            return
        }
        val runtimeIndex = findRuntimeIndex(input.runtimes, workspace, owner)
        if (runtimeIndex < 0) {
            println("[membership] findRuntimeIndex < 0 for $owner")
            return
        }
        val snapshot = input.runtimes[runtimeIndex]
        val liveAvailability = TerminalAgentsPresenter.availability(snapshot) ?: run {
            println("[membership] availability returned null for snapshot: isCurrentIdentity=${snapshot.isCurrentIdentity}")
            return
        }
        val sameRuntime = snapshot.runtime == workspace.runtime
        val inventory = snapshot.inventory
        val fresh = sameRuntime &&
            inventory != null &&
            inventory.runtime == workspace.runtime &&
            inventory.requestTicket == workspace.inventoryTicket
        val availability = if (fresh) liveAvailability else TerminalAgentsAvailability.UNAVAILABLE
        val tabs = uniqueById(workspace.visibleTabs, workspace.runtime, conflicts)
        val ordered: List<TerminalSessionDetailed> = if (fresh) {
            val accepted = uniqueById(inventory!!.sessions, workspace.runtime, conflicts)
            accepted.values.mapNotNull { session ->
                val tab = tabs[session.id]
                if (tab != null && tab.incarnation == session.incarnation && qualifies(tab, owner)) session else null
            }
        } else {
            tabs.values.toList()
        }

        val useCurrentObservations = fresh && snapshot.statusBaselineInstalled
        val observations = observationCache.getOrPut(runtimeIndex to useCurrentObservations) {
            val rows = if (useCurrentObservations) snapshot.status.agents.values else snapshot.cachedObservations
            rows.groupBy { it.id }
        }
        val projectLabel = projectLabel(owner)
        // Display-only (non-fresh) targets carry a never-matching fence (null epoch, -1 authority revision) so they
        // can never be mistaken for a current target; successor epoch/authority is never mixed in either.
        val serverEpoch = if (fresh && snapshot.statusBaselineInstalled) snapshot.status.serverEpoch else null
        val authorityRevision = if (fresh) snapshot.statusAuthorityRevision else NO_AUTHORITY

        for (session in ordered) {
            if (session.id in workspace.excludedTerminalIds || !qualifies(session, owner)) {
                continue
            }
            val matching = observations[session.id].orEmpty().filter { it.incarnation == session.incarnation }.distinct()
            if (matching.isEmpty()) {
                continue
            }
            if (matching.size > 1) {
                conflicts.add(TerminalAgentsMembershipConflict(workspace.runtime, session.id))
                continue
            }
            out.add(
                TerminalAgentsMember(
                    target = TerminalAgentsTarget(
                        registration = workspace.registration,
                        runtime = workspace.runtime,
                        instance = TerminalAgentsInstanceKey(profileId, session.id, session.incarnation),
                        serverEpoch = serverEpoch,
                        statusAuthorityRevision = authorityRevision,
                    ),
                    session = session,
                    observation = matching.single(),
                    availability = availability,
                    projectLabel = projectLabel,
                    profileLabel = profileLabel,
                ),
            )
        }
    }

    /**
     * Index of the runtime snapshot for the workspace: the exact runtime if present, otherwise any snapshot of the
     * same logical owner (profile + normalized endpoint + account), preferring one with a current identity.
     */
    private fun findRuntimeIndex(
        runtimes: List<TerminalAgentsRuntimeSnapshot>,
        workspace: TerminalAgentsWorkspaceSnapshot,
        owner: WorkspaceFileOwner,
    ): Int {
        val exact = runtimes.indexOfFirst { it.runtime == workspace.runtime }
        if (exact >= 0) return exact
        val logical = runtimes.indices.filter { isValidRuntimeFor(runtimes[it].runtime, owner) }
        return logical.firstOrNull { runtimes[it].isCurrentIdentity } ?: logical.firstOrNull() ?: -1
    }

    private fun projectLabel(owner: WorkspaceFileOwner): String {
        val worktree = owner.normalizedWorktreePath ?: return owner.project
        return "${owner.project} ($worktree)"
    }

    /**
     * One member per `(profileId, terminalId, incarnation)`. Identical duplicates emit once (first registration);
     * duplicates owned by different workspaces or carrying different metadata fail closed.
     */
    private fun dedupe(
        candidates: List<TerminalAgentsMember>,
        conflicts: MutableSet<TerminalAgentsMembershipConflict>,
    ): List<TerminalAgentsMember> {
        val byKey = LinkedHashMap<TerminalAgentsInstanceKey, MutableList<TerminalAgentsMember>>()
        for (member in candidates) byKey.getOrPut(member.target.instance) { ArrayList() }.add(member)
        val conflictedKeys = HashSet<TerminalAgentsInstanceKey>()
        for ((key, members) in byKey) {
            val first = members.first()
            val consistent = members.all {
                it.target.registration.owner == first.target.registration.owner &&
                    canonical(it.session) == canonical(first.session)
            }
            if (!consistent) {
                conflictedKeys.add(key)
                for (member in members) {
                    conflicts.add(TerminalAgentsMembershipConflict(member.target.runtime, key.terminalId))
                }
            }
        }
        val seen = HashSet<TerminalAgentsInstanceKey>()
        return candidates.filter { member ->
            val key = member.target.instance
            key !in conflictedKeys && seen.add(key)
        }
    }
}
