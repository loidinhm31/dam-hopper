package dev.damhopper.nativeapp.core.notifications

import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.features.settings.TerminalAgentPolicy
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.terminal.AcceptedLiveAttention
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AttentionKind
import dev.damhopper.nativeapp.features.terminal.BlockedReason
import dev.damhopper.nativeapp.features.terminal.IntegrationOwner
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessProvider
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject

/** One in-app history entry. [key] is the canonical [NotificationKey] (history identity == OS tag). */
data class NotificationRecord(
    val key: String,
    val target: NotificationTarget,
    val title: String,
    val body: String,
    val receivedAtMs: Long,
    val read: Boolean,
)

/** Bounded process-memory feed (newest first). [transients] hold record keys for the foreground toast. */
data class NotificationFeedState(
    val records: List<NotificationRecord> = emptyList(),
    val transients: List<String> = emptyList(),
)

/**
 * Owns the process-memory notification feed and every user-visible side effect of an accepted live
 * attention event (history, foreground transient, OS post, foreground audio), per the C4 decision table:
 *
 * | state | history | transient | OS post | audio |
 * |---|---|---|---|---|
 * | policy disabled / unsupported remote policy / unverified integration / unaccepted | none | none | none | none |
 * | foreground | yes | iff toast | iff browser && OS allows, always silent | iff policy.sound && local soundEnabled && volume>0, once |
 * | background | yes | none | iff browser && OS allows; silent iff !policy.sound or volume==0 | never (channel-controlled) |
 *
 * Effects run only inside [IntegrationReadinessProvider.withVerified] (exact VERIFIED owner, registry
 * availability, provider gate), synchronously and without network, registry or profile access. A failed OS
 * post or audio call never removes the history entry. Lock order is provider gate -> [lock]; nothing here
 * calls the provider while holding [lock].
 *
 * The coordinator never touches reducer high-water: [markRead], [markAllRead], [dismissTransient] and
 * [clear] only change the in-app feed, so history clear cannot resurrect an old attention.
 */
class NotificationCoordinator(
    private val provider: IntegrationReadinessProvider,
    private val sink: NotificationSink,
    private val audio: NotificationAudioPort,
    private val platform: NotificationPlatformPort,
    private val lifecycle: StateFlow<LifecycleState>,
    private val preferences: () -> WorkbenchPreferences,
    /** Non-null when the remote policy has an unsupported version: delivery is suppressed. */
    private val unsupportedPolicy: () -> JsonObject?,
    /** Synchronous exact-owner/socket recheck (e.g. `registry.connectionsState.value`), never a suspend lookup. */
    private val isCurrentOwner: (IntegrationOwner) -> Boolean,
    private val processInstanceId: String,
    private val nowMs: () -> Long,
) {
    init {
        require(processInstanceId.isNotBlank()) { "processInstanceId cannot be blank" }
    }

    private val lock = Any()
    private val _feed = MutableStateFlow(NotificationFeedState())
    val feed: StateFlow<NotificationFeedState> = _feed.asStateFlow()

    // Guarded by [lock]. Posted OS keys are tracked separately from the bounded feed so clearing/evicting
    // history can never lose the ability to cancel an old owner's shade entry; keys whose cancel failed stay.
    private val osPosted = LinkedHashMap<String, ConnectionRef>()
    private val retiredGeneration = HashMap<ProfileId, Long>()
    private var audioOwner: ConnectionRef? = null

    /**
     * Admits one reducer-accepted event. [readinessOwner] must be the exact runtime captured by the caller
     * BEFORE reducer suspension; null, a different socket/owner than the event, Codex, an invalid counter
     * or anything the provider does not currently verify is consumed silently (no replay, no effects).
     */
    suspend fun admit(event: AcceptedLiveAttention, readinessOwner: IntegrationOwner?) {
        if (readinessOwner == null) return
        if (readinessOwner.owner != event.owner || readinessOwner.socket != event.socket) return
        val agent = event.row.agentKind
        if (agent == AgentKind.CODEX) return
        val attention = event.attention
        val row = event.row
        if (attention.terminalId != row.id || attention.incarnation != row.incarnation ||
            attention.agentKind != agent || attention.agentSessionId != row.agentSessionId ||
            attention.attentionRevision != row.attentionRevision || attention.id.isBlank()
        ) {
            return
        }
        val serverEpoch = event.serverEpoch.toServerSafeLongOrNull() ?: return
        event.revision.toServerSafeLongOrNull() ?: return
        val incarnation = row.incarnation.toServerSafeLongOrNull() ?: return
        val attentionRevision = attention.attentionRevision.toServerSafeLongOrNull() ?: return
        val target = try {
            NotificationTarget(
                profileId = event.owner.profileId,
                generation = event.owner.generation,
                serverEpoch = serverEpoch,
                terminalId = row.id,
                incarnation = incarnation,
                attentionRevision = attentionRevision,
                processInstanceId = processInstanceId,
                endpoint = readinessOwner.endpoint,
                accountId = readinessOwner.accountId,
                agentSessionId = row.agentSessionId,
                agentKind = agent.wireName(),
            )
        } catch (_: IllegalArgumentException) {
            return
        }
        val key = NotificationKey.of(
            processInstanceId = processInstanceId,
            profileId = target.profileId,
            generation = target.generation,
            serverEpoch = serverEpoch,
            terminalId = row.id,
            incarnation = incarnation,
            agentSessionId = row.agentSessionId,
            agentKind = target.agentKind,
            attentionRevision = attentionRevision,
            semanticEventId = attention.id,
        )

        provider.withVerified(readinessOwner, agent) { readiness ->
            if (readiness.state != IntegrationReadinessState.VERIFIED ||
                readiness.owner != readinessOwner || readiness.agent != agent
            ) {
                return@withVerified
            }
            if (!isCurrentOwner(readinessOwner)) return@withVerified
            deliver(event.owner, agent, attention.kind, attention.reason, target, key)
        }
    }

    /** Marks one record read (in-app only). */
    fun markRead(key: String) = updateFeed { state ->
        state.copy(records = state.records.map { if (it.key == key && !it.read) it.copy(read = true) else it })
    }

    fun markAllRead() = updateFeed { state ->
        state.copy(records = state.records.map { if (it.read) it else it.copy(read = true) })
    }

    fun dismissTransient(key: String) = updateFeed { state ->
        state.copy(transients = state.transients.filterNot { it == key })
    }

    /**
     * Clears the in-app history and transients and cancels this app's posted attention entries. Does not
     * (and cannot) alter the reducer's per-terminal high-water, so cleared history never replays.
     */
    fun clear() {
        synchronized(lock) {
            _feed.value = NotificationFeedState()
            cancelPostedLocked(osPosted.keys.toList())
        }
    }

    /**
     * Retires exactly [owner]: later events of that generation (or older) are ignored, and through
     * [IntegrationReadinessProvider.invalidate] (which first lets an already-admitted effect finish, then
     * runs the cleanup inside its gate) every feed record/transient/OS entry/audio of *exactly that owner*
     * is pruned. Every cleanup step is attempted even if one fails; the aggregate (cancellation preferred as
     * primary, others suppressed) is thrown so the registry barrier latches unavailable. Another generation
     * or profile is never touched. If the provider fails before running the cleanup the failure propagates
     * unchanged: no ungated cleanup is invented.
     */
    suspend fun retire(owner: ConnectionRef) {
        synchronized(lock) {
            val known = retiredGeneration[owner.profileId]
            if (known == null || known < owner.generation) retiredGeneration[owner.profileId] = owner.generation
        }
        provider.invalidate(owner) { cleanupOwner(owner) }
    }

    /**
     * Temporarily invalidates runtime readiness and prunes old transients, OS notifications and audio
     * for [owner] WITHOUT watermarking the generation against future delivery. Used for Settings path/config
     * mutations and agent install/uninstall where the same connection will re-verify after settling.
     */
    suspend fun invalidateRuntime(owner: ConnectionRef) {
        provider.invalidate(owner) { cleanupOwner(owner) }
    }

    // ---- effect (runs inside provider.withVerified) ----

    private fun deliver(
        owner: ConnectionRef,
        agent: AgentKind,
        kind: AttentionKind,
        reason: BlockedReason?,
        target: NotificationTarget,
        key: String,
    ) {
        synchronized(lock) {
            val retired = retiredGeneration[owner.profileId]
            if (retired != null && owner.generation <= retired) return
            if (unsupportedPolicy() != null) return
            val prefs = preferences()
            if (!prefs.terminalAgentNotifications.isValid()) return
            val policy = policyFor(prefs, agent)
            if (!policy.enabled) return
            if (_feed.value.records.any { it.key == key }) return // at most once per identity

            val foreground = lifecycle.value == LifecycleState.FOREGROUND
            val record = NotificationRecord(
                key = key,
                target = target,
                title = titleFor(agent, kind),
                body = bodyFor(kind, reason),
                receivedAtMs = nowMs(),
                read = false,
            )
            val combined = listOf(record) + _feed.value.records
            val kept = combined.take(MAX_RECORDS)
            val evicted = combined.drop(MAX_RECORDS).map { it.key }
            val keptKeys = kept.mapTo(HashSet()) { it.key }
            val transients = if (foreground && policy.toast) {
                (listOf(key) + _feed.value.transients).filter { it in keptKeys }.take(MAX_TRANSIENTS)
            } else {
                _feed.value.transients.filter { it in keptKeys }
            }
            _feed.value = NotificationFeedState(kept, transients)
            if (evicted.isNotEmpty()) cancelPostedLocked(evicted)

            // Tracking of OS entries is bounded without ever evicting an entry that might still be in the
            // shade: when failed cancellations filled the tracker, no further OS post is made (history stays).
            if (policy.browser && osPosted.size < MAX_TRACKED_POSTED && canPostToOs()) {
                val silent = foreground || !policy.sound || policy.volume == 0.0
                try {
                    val posted = sink.postNotification(
                        AppNotification(
                            key = key,
                            channel = NotificationChannelId.TERMINAL_ATTENTION,
                            target = target,
                            title = record.title,
                            body = record.body,
                            silent = silent,
                        ),
                    )
                    if (posted) osPosted[key] = owner
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Failed OS post (permission race, SecurityException, ...): history above stays.
                }
            }

            if (foreground && policy.sound && prefs.soundEnabled && policy.volume > 0.0) {
                try {
                    audio.play(policy.pattern, policy.volume)
                    audioOwner = owner
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Audio failure never affects history or the OS post.
                }
            }
        }
    }

    private fun canPostToOs(): Boolean {
        val status = platform.status.value
        return (status.permission == NotificationPermissionState.NOT_REQUIRED ||
            status.permission == NotificationPermissionState.GRANTED) &&
            !status.appBlocked &&
            status.channels[NotificationChannelId.TERMINAL_ATTENTION]?.blocked != true &&
            sink.areNotificationsEnabled()
    }

    // ---- retirement cleanup (runs inside provider.invalidate) ----

    private fun cleanupOwner(owner: ConnectionRef) {
        val failures = ArrayList<Throwable>()
        val keys = synchronized(lock) {
            try {
                val s = _feed.value
                val remaining = s.records.filterNot { it.target.profileId == owner.profileId && it.target.generation == owner.generation }
                val remainingKeys = remaining.mapTo(HashSet()) { it.key }
                _feed.value = NotificationFeedState(remaining, s.transients.filter { it in remainingKeys })
            } catch (t: Throwable) {
                failures += t
            }
            osPosted.entries.filter { it.value == owner }.map { it.key }
        }
        for (key in keys) {
            try {
                sink.cancelNotification(key)
                synchronized(lock) { osPosted.remove(key) }
            } catch (t: Throwable) {
                failures += t
            }
        }
        try {
            // Owner is released only after stop succeeded, so a failed stop is retried by the next
            // retirement attempt. Check+stop is atomic against deliver (same lock), so a late N cleanup
            // can never stop audio that already belongs to N+1.
            synchronized(lock) {
                if (audioOwner == owner) {
                    audio.stop()
                    audioOwner = null
                }
            }
        } catch (t: Throwable) {
            failures += t
        }
        if (failures.isEmpty()) return
        val primary = failures.firstOrNull { it is CancellationException } ?: failures.first()
        for (other in failures) {
            if (other !== primary) primary.addSuppressed(other)
        }
        throw primary
    }

    // ---- helpers ----

    private fun updateFeed(transform: (NotificationFeedState) -> NotificationFeedState) {
        synchronized(lock) { _feed.value = transform(_feed.value) }
    }

    /** Best-effort per-key cancel; a key whose cancel throws stays tracked so retirement can retry it. */
    private fun cancelPostedLocked(keys: List<String>) {
        for (key in keys) {
            if (key !in osPosted) continue
            try {
                sink.cancelNotification(key)
                osPosted.remove(key)
            } catch (_: Exception) {
                // stays in osPosted
            }
        }
    }

    private fun policyFor(prefs: WorkbenchPreferences, agent: AgentKind): TerminalAgentPolicy {
        val agents = prefs.terminalAgentNotifications.agents
        return when (agent) {
            AgentKind.OMP -> agents.omp
            AgentKind.CLAUDE -> agents.claude
            AgentKind.CODEX -> agents.codex
        }
    }

    private fun AgentKind.wireName(): String = when (this) {
        AgentKind.OMP -> "omp"
        AgentKind.CLAUDE -> "claude"
        AgentKind.CODEX -> "codex"
    }

    private fun displayName(agent: AgentKind): String = when (agent) {
        AgentKind.OMP -> "OMP"
        AgentKind.CLAUDE -> "Claude"
        AgentKind.CODEX -> "Codex"
    }

    // Fixed text only: never interpolates commands, output, paths or external titles.
    private fun titleFor(agent: AgentKind, kind: AttentionKind): String = when (kind) {
        AttentionKind.NEEDS_ATTENTION -> "${displayName(agent)} needs attention"
        AttentionKind.TURN_ENDED -> "${displayName(agent)} turn ended"
    }

    private fun bodyFor(kind: AttentionKind, reason: BlockedReason?): String = when (kind) {
        AttentionKind.TURN_ENDED -> "The agent turn ended. Task success is not verified."
        AttentionKind.NEEDS_ATTENTION -> when (reason) {
            BlockedReason.APPROVAL -> "Approval requested"
            BlockedReason.QUESTION -> "A question is waiting for your answer"
            BlockedReason.ERROR -> "An error needs review"
            null -> "Attention required"
        }
    }

    companion object {
        const val MAX_RECORDS = 50
        const val MAX_TRANSIENTS = 3
        private const val MAX_TRACKED_POSTED = 100
    }
}
