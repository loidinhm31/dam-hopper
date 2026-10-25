package dev.damhopper.nativeapp.core.notifications

import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.features.settings.AgentPolicies
import dev.damhopper.nativeapp.features.settings.TerminalAgentNotifications
import dev.damhopper.nativeapp.features.settings.TerminalAgentPolicy
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.terminal.AcceptedLiveAttention
import dev.damhopper.nativeapp.features.terminal.AgentAdmission
import dev.damhopper.nativeapp.features.terminal.AgentAttentionEvent
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentObservationSource
import dev.damhopper.nativeapp.features.terminal.AgentState
import dev.damhopper.nativeapp.features.terminal.AgentStatusAvailability
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.AgentStatusSnapshotV1
import dev.damhopper.nativeapp.features.terminal.AttentionKind
import dev.damhopper.nativeapp.features.terminal.BlockedReason
import dev.damhopper.nativeapp.features.terminal.IntegrationOwner
import dev.damhopper.nativeapp.features.terminal.IntegrationReadiness
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessProvider
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentStatusRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Integration tests of the coordinator with the REAL [AgentStatusReducer]: every effect below is driven by
 * reducer-accepted events, never by an injected fake acceptance alone.
 */
class NotificationCoordinatorTest {

    private val json = Json { ignoreUnknownKeys = true }

    // ---- fakes ----

    private class FakeProvider : IntegrationReadinessProvider {
        val verified = HashSet<Pair<IntegrationOwner, AgentKind>>()
        val retired = HashSet<ConnectionRef>()
        var verifyEverything = false
        var invalidateFailure: Throwable? = null

        /** Models the VM provider's single readiness/effect mutex: effects and invalidate are serialized. */
        private val gate = Mutex()
        var beforeEffect: (suspend () -> Unit)? = null

        private fun readiness(owner: IntegrationOwner, agent: AgentKind) =
            IntegrationReadiness(owner, agent, IntegrationReadinessState.VERIFIED, null, null, null)

        override fun current(owner: IntegrationOwner, agent: AgentKind): IntegrationReadiness? =
            if ((owner to agent) in verified) readiness(owner, agent) else null

        override suspend fun withVerified(owner: IntegrationOwner, agent: AgentKind, effect: (IntegrationReadiness) -> Unit): Boolean =
            gate.withLock {
                if (!verifyEverything && (owner.owner in retired || (owner to agent) !in verified)) return@withLock false
                beforeEffect?.invoke()
                effect(readiness(owner, agent))
                true
            }

        override suspend fun invalidate(owner: ConnectionRef, effect: () -> Unit) {
            gate.withLock {
                retired += owner
                verified.removeAll { it.first.owner == owner }
                invalidateFailure?.let { throw it }
                effect()
            }
        }
    }

    private class RecordingSink : NotificationSink {
        val posted = LinkedHashMap<String, AppNotification>()
        val cancelAttempts = ArrayList<String>()
        val failCancel = HashMap<String, Throwable>()
        var failPost: Throwable? = null
        var enabled = true
        var postResult = true
        var failAllCancels: Throwable? = null

        override fun postNotification(notification: AppNotification): Boolean {
            failPost?.let { throw it }
            if (!postResult) return false
            posted[notification.key] = notification
            return true
        }

        override fun cancelNotification(key: String) {
            cancelAttempts += key
            failAllCancels?.let { throw it }
            failCancel[key]?.let { throw it }
            posted.remove(key)
        }

        override fun cancelNotificationsForProfile(profileId: String): Unit = error("must never be used for owner-exact retirement")
        override fun cancelAll(): Unit = error("must never be used for owner-exact retirement")
        override fun areNotificationsEnabled(): Boolean = enabled
    }

    private class FakeAudio : NotificationAudioPort {
        val plays = ArrayList<Pair<String, Double>>()
        var stops = 0
        var failStop: Throwable? = null
        override fun play(pattern: String, volume: Double) { plays += pattern to volume }
        override fun stop() {
            stops++
            failStop?.let { throw it }
        }
    }

    private class FakePlatform : NotificationPlatformPort {
        override val status = MutableStateFlow(grantedStatus())
        override fun requestPermission() = Unit
        override fun openChannelSettings(channel: NotificationChannelId) = Unit
        override fun refreshStatus() = Unit

        companion object {
            fun grantedStatus() = NotificationPlatformStatus(
                NotificationPermissionState.GRANTED,
                appBlocked = false,
                channels = NotificationChannelId.entries.associateWith { NotificationChannelStatus(blocked = false, soundConfigured = true) },
            )
        }
    }

    // ---- fixture ----

    private val provider = FakeProvider()
    private val sink = RecordingSink()
    private val audio = FakeAudio()
    private val platform = FakePlatform()
    private val lifecycle = MutableStateFlow(LifecycleState.FOREGROUND)
    private var prefs = prefsOf()
    private var unsupported: JsonObject? = null
    private var currentOwnerCheck: (IntegrationOwner) -> Boolean = { true }
    private val coordinator = NotificationCoordinator(
        provider = provider,
        sink = sink,
        audio = audio,
        platform = platform,
        lifecycle = lifecycle,
        preferences = { prefs },
        unsupportedPolicy = { unsupported },
        isCurrentOwner = { currentOwnerCheck(it) },
        processInstanceId = "proc-1",
        nowMs = { 1_234L },
    )

    private fun policy(
        enabled: Boolean = true,
        toast: Boolean = true,
        browser: Boolean = true,
        sound: Boolean = true,
        volume: Double = 0.7,
        pattern: String = "two-tone",
    ) = TerminalAgentPolicy(enabled, toast, browser, sound, volume, pattern)

    private fun prefsOf(
        omp: TerminalAgentPolicy = policy(),
        claude: TerminalAgentPolicy = TerminalAgentPolicy(),
        soundEnabled: Boolean = true,
    ) = WorkbenchPreferences(
        soundEnabled = soundEnabled,
        terminalAgentNotifications = TerminalAgentNotifications(agents = AgentPolicies(omp = omp, claude = claude)),
    )

    private fun runSuspending(block: suspend () -> Unit) = runBlocking { block() }

    /** One retained runtime (owner+socket) with its own real reducer and silent baseline. */
    private inner class Runtime(val owner: ConnectionRef, socketId: String = "s1", pathRevision: Long = 1L) {
        val socket = SocketInstanceRef(owner, socketId)
        val integration = IntegrationOwner(owner, socket, "https://host", "acct", pathRevision)
        val reducer = AgentStatusReducer()
        var revision = 10uL

        suspend fun start(verify: Boolean = true): Runtime {
            reducer.bindRuntime(owner, socket)
            val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
            assertTrue(reducer.applySnapshot(capture, AgentStatusSnapshotV1(serverEpoch = 1uL, revision = revision, availability = AgentStatusAvailability.READY)))
            if (verify) {
                provider.verified += integration to AgentKind.OMP
                provider.verified += integration to AgentKind.CLAUDE
            }
            return this
        }

        fun row(terminalId: String, attentionRev: ULong, agent: AgentKind = AgentKind.OMP, session: String = "sess-$terminalId") =
            TerminalAgentStatusRow(
                id = terminalId, incarnation = 1uL, agentKind = agent, agentSessionId = session, reporterEpoch = 1uL,
                state = AgentState.BLOCKED, source = AgentObservationSource.LIFECYCLE, attentionRevision = attentionRev,
            )

        fun attention(row: TerminalAgentStatusRow, kind: AttentionKind = AttentionKind.NEEDS_ATTENTION) = AgentAttentionEvent(
            id = "1:${row.id}:${row.incarnation}:${row.attentionRevision}", kind = kind, terminalId = row.id,
            incarnation = row.incarnation, agentKind = row.agentKind, agentSessionId = row.agentSessionId,
            reason = BlockedReason.APPROVAL, attentionRevision = row.attentionRevision, timestampMs = 1uL,
        )

        suspend fun next(
            terminalId: String = "term-1",
            attentionRev: ULong = 1uL,
            agent: AgentKind = AgentKind.OMP,
            kind: AttentionKind = AttentionKind.NEEDS_ATTENTION,
        ): AgentAdmission {
            val row = row(terminalId, attentionRev, agent)
            revision += 1uL
            return reducer.applyStatusChanged(
                owner, socket,
                ServerMsg.AgentStatusChanged(1uL, revision, json.encodeToJsonElement(row), json.encodeToJsonElement(attention(row, kind))),
            )
        }

        /** Reducer verdict, then coordinator admission of an Accepted event (the retained runtime's job). */
        suspend fun fire(
            terminalId: String = "term-1",
            attentionRev: ULong = 1uL,
            agent: AgentKind = AgentKind.OMP,
            kind: AttentionKind = AttentionKind.NEEDS_ATTENTION,
        ): AgentAdmission = next(terminalId, attentionRev, agent, kind).also {
            if (it is AgentAdmission.Accepted) coordinator.admit(it.event, integration)
        }
    }

    private val ownerN = ConnectionRef("prof", 1L)

    // ---- tests ----

    @Test
    fun realAcceptedEventProducesHistoryTransientSilentPostAndForegroundSoundOnce() = runSuspending {
        val rt = Runtime(ownerN).start()
        val accepted = assertIs<AgentAdmission.Accepted>(rt.fire())

        val record = coordinator.feed.value.records.single()
        assertEquals("OMP needs attention", record.title)
        assertEquals("Approval requested", record.body)
        assertFalse(record.read)
        assertEquals(1_234L, record.receivedAtMs)
        assertEquals("prof", record.target.profileId)
        assertEquals(1L, record.target.generation)
        assertEquals("term-1", record.target.terminalId)
        assertEquals("proc-1", record.target.processInstanceId)
        assertEquals("https://host", record.target.endpoint)
        assertEquals(listOf(record.key), coordinator.feed.value.transients)
        // key is the canonical tuple: history identity, OS tag and attention id all agree
        val fields = assertNotNull(NotificationKey.fields(record.key))
        assertEquals("proc-1", fields[0])
        assertEquals(accepted.event.attention.id, fields[9])

        val note = sink.posted.getValue(record.key)
        assertTrue(note.silent, "foreground OS post must be silent")
        assertEquals(NotificationChannelId.TERMINAL_ATTENTION, note.channel)
        assertEquals("DamHopper", note.publicTitle)
        assertEquals("Attention required", note.publicBody)
        assertEquals(listOf("two-tone" to 0.7), audio.plays)

        // the same accepted event delivered again (e.g. a retry) is at-most-once
        coordinator.admit(accepted.event, rt.integration)
        assertEquals(1, coordinator.feed.value.records.size)
        assertEquals(1, sink.posted.size)
        assertEquals(1, audio.plays.size)
    }

    @Test
    fun snapshotReplayGapAndReconnectAreSilentEndToEnd() = runSuspending {
        val rt = Runtime(ownerN)
        // events before the baseline reach neither reducer acceptance nor coordinator
        rt.reducer.bindRuntime(rt.owner, rt.socket)
        provider.verified += rt.integration to AgentKind.OMP
        assertEquals(AgentAdmission.Reconcile, rt.fire())
        assertTrue(coordinator.feed.value.records.isEmpty())

        rt.start()
        assertIs<AgentAdmission.Accepted>(rt.fire(attentionRev = 1uL))
        assertEquals(1, coordinator.feed.value.records.size)
        // replay under fresh contiguous revisions: silent
        assertEquals(AgentAdmission.Silent, rt.fire(attentionRev = 1uL))
        // gap closes admission; the missed attention is never alerted, even after a silent reconcile
        rt.revision += 5uL
        assertEquals(AgentAdmission.Reconcile, rt.fire(attentionRev = 2uL))
        val capture = assertNotNull(rt.reducer.captureSnapshot(rt.owner, rt.socket))
        assertTrue(rt.reducer.applySnapshot(capture, AgentStatusSnapshotV1(serverEpoch = 1uL, revision = rt.revision, availability = AgentStatusAvailability.READY, terminals = listOf(rt.row("term-1", 2uL)))))
        assertEquals(AgentAdmission.Silent, rt.fire(attentionRev = 2uL))
        assertEquals(1, coordinator.feed.value.records.size)
        assertEquals(1, sink.posted.size)
        // a genuinely new attention after the baseline does alert
        assertIs<AgentAdmission.Accepted>(rt.fire(attentionRev = 3uL))
        assertEquals(2, coordinator.feed.value.records.size)
    }

    @Test
    fun disabledUnsupportedCodexAndUnverifiedIntegrationDeliverNothing() = runSuspending {
        val rt = Runtime(ownerN).start()
        // agent disabled
        prefs = prefsOf(omp = policy(enabled = false))
        assertIs<AgentAdmission.Accepted>(rt.fire("t-disabled"))
        // unsupported remote policy
        prefs = prefsOf()
        unsupported = buildJsonObject { put("version", 3) }
        assertIs<AgentAdmission.Accepted>(rt.fire("t-unsupported"))
        unsupported = null
        // invalid policy (volume out of range) is never delivered
        prefs = prefsOf(omp = policy(volume = 1.5))
        assertIs<AgentAdmission.Accepted>(rt.fire("t-invalid"))
        prefs = prefsOf()
        // Codex is status-only: the reducer never accepts it, and a forged Accepted is also ignored
        assertEquals(AgentAdmission.Silent, rt.fire("t-codex", agent = AgentKind.CODEX))
        val codexRow = rt.row("t-codex-forged", 1uL, AgentKind.CODEX)
        coordinator.admit(AcceptedLiveAttention(rt.owner, rt.socket, 1uL, 99uL, codexRow, rt.attention(codexRow)), rt.integration)
        // Claude accepted by the reducer but its integration is not verified
        provider.verified.remove(rt.integration to AgentKind.CLAUDE)
        prefs = prefsOf(claude = policy())
        assertIs<AgentAdmission.Accepted>(rt.fire("t-claude", agent = AgentKind.CLAUDE))

        assertTrue(coordinator.feed.value.records.isEmpty())
        assertTrue(sink.posted.isEmpty())
        assertTrue(audio.plays.isEmpty())
    }

    @Test
    fun sourceTargetEventRuntimeQualificationFrameEditsAndRevocation() = runSuspending {
        val rt = Runtime(ownerN).start(verify = false)
        // preference source A / settings target B verified a *different* runtime C-lookalike
        // (same profile, other socket and path revision): never qualifies event runtime C.
        val lookalike = IntegrationOwner(ownerN, SocketInstanceRef(ownerN, "other-socket"), "https://host", "acct", 1L)
        val staleRevision = rt.integration.copy(pathConfigRevision = 0L)
        provider.verified += lookalike to AgentKind.OMP
        provider.verified += staleRevision to AgentKind.OMP
        val accepted = assertIs<AgentAdmission.Accepted>(rt.next("t-a")).event
        coordinator.admit(accepted, rt.integration)
        assertTrue(coordinator.feed.value.records.isEmpty())

        // frame edits: readiness owner differing from the event frame, or a forged attention, are consumed silently
        provider.verified += rt.integration to AgentKind.OMP
        val b = assertIs<AgentAdmission.Accepted>(rt.next("t-b")).event
        coordinator.admit(b, null)
        coordinator.admit(b, lookalike)
        coordinator.admit(b.copy(socket = lookalike.socket), rt.integration)
        coordinator.admit(b.copy(owner = ConnectionRef("prof", 2L)), rt.integration)
        coordinator.admit(b.copy(attention = b.attention.copy(attentionRevision = 99uL)), rt.integration)
        coordinator.admit(b.copy(attention = b.attention.copy(id = " ")), rt.integration)
        coordinator.admit(b.copy(revision = ULong.MAX_VALUE), rt.integration)
        coordinator.admit(b.copy(row = b.row.copy(incarnation = ULong.MAX_VALUE), attention = b.attention.copy(incarnation = ULong.MAX_VALUE)), rt.integration)
        assertTrue(coordinator.feed.value.records.isEmpty())

        // lookup revocation: a display snapshot said verified, but the gate revoked before the effect
        assertNotNull(provider.current(rt.integration, AgentKind.OMP))
        provider.verified.remove(rt.integration to AgentKind.OMP)
        coordinator.admit(b, rt.integration)
        assertTrue(coordinator.feed.value.records.isEmpty())

        // registry/current-owner recheck inside the gate also blocks
        provider.verified += rt.integration to AgentKind.OMP
        currentOwnerCheck = { false }
        coordinator.admit(b, rt.integration)
        assertTrue(coordinator.feed.value.records.isEmpty())
        currentOwnerCheck = { true }
        coordinator.admit(b, rt.integration)
        assertEquals(1, coordinator.feed.value.records.size)
        assertTrue(sink.posted.size == 1)
    }

    @Test
    fun backgroundDeliversPolicyOnlyThroughSilentOrChannelControlledPost() = runSuspending {
        lifecycle.value = LifecycleState.BACKGROUND
        val rt = Runtime(ownerN).start()

        // sound enabled: channel-controlled, not silent, no manual audio, no queued transient
        rt.fire("t1")
        assertEquals(1, coordinator.feed.value.records.size)
        assertTrue(coordinator.feed.value.transients.isEmpty())
        assertFalse(sink.posted.values.single().silent)
        assertTrue(audio.plays.isEmpty())

        // sound=false and volume==0 are silent posts
        prefs = prefsOf(omp = policy(sound = false))
        rt.fire("t2")
        prefs = prefsOf(omp = policy(volume = 0.0))
        rt.fire("t3")
        val byTerminal = sink.posted.values.associateBy { it.target.terminalId }
        assertTrue(byTerminal.getValue("t2").silent)
        assertTrue(byTerminal.getValue("t3").silent)

        // browser=false: history only
        prefs = prefsOf(omp = policy(browser = false))
        rt.fire("t4")
        assertEquals(4, coordinator.feed.value.records.size)
        assertEquals(3, sink.posted.size)

        // OS blocked at app / channel / permission level: history only
        prefs = prefsOf()
        platform.status.value = FakePlatform.grantedStatus().copy(appBlocked = true)
        rt.fire("t5")
        platform.status.value = FakePlatform.grantedStatus().copy(
            channels = mapOf(NotificationChannelId.TERMINAL_ATTENTION to NotificationChannelStatus(blocked = true, soundConfigured = true)),
        )
        rt.fire("t6")
        platform.status.value = FakePlatform.grantedStatus().copy(permission = NotificationPermissionState.DENIED)
        rt.fire("t7")
        sink.enabled = false
        platform.status.value = FakePlatform.grantedStatus()
        rt.fire("t8")
        assertEquals(8, coordinator.feed.value.records.size)
        assertEquals(3, sink.posted.size)
        assertTrue(audio.plays.isEmpty())
    }

    @Test
    fun foregroundPermissionDeniedKeepsHistoryTransientAndIndependentSound() = runSuspending {
        platform.status.value = FakePlatform.grantedStatus().copy(permission = NotificationPermissionState.DENIED)
        val rt = Runtime(ownerN).start()
        rt.fire("t1")
        assertEquals(1, coordinator.feed.value.records.size)
        assertEquals(1, coordinator.feed.value.transients.size)
        assertTrue(sink.posted.isEmpty())
        assertEquals(1, audio.plays.size) // in-app sound independent of OS permission

        // toast=false: history without transient; local sound master off: no audio; zero volume: no audio
        prefs = prefsOf(omp = policy(toast = false), soundEnabled = false)
        rt.fire("t2")
        assertEquals(2, coordinator.feed.value.records.size)
        assertEquals(1, coordinator.feed.value.transients.size)
        prefs = prefsOf(omp = policy(volume = 0.0))
        rt.fire("t3")
        prefs = prefsOf(omp = policy(sound = false))
        rt.fire("t4")
        assertEquals(1, audio.plays.size)
    }

    @Test
    fun failedOsPostNeverDeletesAdmittedHistory() = runSuspending {
        val rt = Runtime(ownerN).start()
        sink.failPost = SecurityException("permission revoked after precheck")
        rt.fire("t1")
        assertEquals(1, coordinator.feed.value.records.size)
        assertEquals(1, audio.plays.size)
        // a failed post is not tracked as a shade entry, so retirement has nothing to cancel
        sink.failPost = null
        coordinator.retire(ownerN)
        assertTrue(sink.cancelAttempts.isEmpty())
        assertTrue(coordinator.feed.value.records.isEmpty())
    }

    @Test
    fun feedIsBoundedToFiftyRecordsAndThreeTransients() = runSuspending {
        val rt = Runtime(ownerN).start()
        repeat(60) { rt.fire("t$it") }
        val state = coordinator.feed.value
        assertEquals(NotificationCoordinator.MAX_RECORDS, state.records.size)
        assertEquals("t59", state.records.first().target.terminalId)
        assertEquals("t10", state.records.last().target.terminalId)
        assertEquals(NotificationCoordinator.MAX_TRANSIENTS, state.transients.size)
        assertEquals(state.records.take(3).map { it.key }, state.transients)
        // evicted entries do not linger in the shade
        assertEquals(50, sink.posted.size)
        assertEquals(10, sink.cancelAttempts.size)
    }

    @Test
    fun equalTerminalIdsAndEqualIntHashCodesNeverCollide() = runSuspending {
        assertEquals("Aa".hashCode(), "BB".hashCode())
        val rtA = Runtime(ConnectionRef("profile-A", 1L)).start()
        val rtB = Runtime(ConnectionRef("profile-B", 1L)).start()
        rtA.fire("term-1")
        rtB.fire("term-1") // equal terminal ids in different profiles
        rtA.fire("Aa")
        rtA.fire("BB") // equal Int hash codes
        val keys = coordinator.feed.value.records.map { it.key }
        assertEquals(4, keys.toSet().size)
        assertEquals(4, sink.posted.size)
        assertEquals(setOf("profile-A", "profile-B"), coordinator.feed.value.records.map { it.target.profileId }.toSet())
    }

    @Test
    fun readClearAndDismissOnlyChangeTheFeedNeverReplayAfterClear() = runSuspending {
        val rt = Runtime(ownerN).start()
        rt.fire("t1")
        rt.fire("t2")
        val keys = coordinator.feed.value.records.map { it.key }
        coordinator.markRead(keys[0])
        assertEquals(listOf(true, false), coordinator.feed.value.records.map { it.read })
        coordinator.markAllRead()
        assertTrue(coordinator.feed.value.records.all { it.read })
        coordinator.dismissTransient(keys[0])
        assertEquals(listOf(keys[1]), coordinator.feed.value.transients)

        coordinator.clear()
        assertEquals(NotificationFeedState(), coordinator.feed.value)
        assertTrue(sink.posted.isEmpty())
        // history clear never lowers the reducer's high-water: the same attention under fresh revisions stays silent
        assertEquals(AgentAdmission.Silent, rt.fire("t1", attentionRev = 1uL))
        assertEquals(AgentAdmission.Silent, rt.fire("t2", attentionRev = 1uL))
        assertTrue(coordinator.feed.value.records.isEmpty())
        assertIs<AgentAdmission.Accepted>(rt.fire("t1", attentionRev = 2uL))
    }

    @Test
    fun retirementIsExactOwnerAndIsolatesNextGenerationAndOtherProfiles() = runSuspending {
        val rtN = Runtime(ownerN).start()
        val ownerN1 = ConnectionRef("prof", 2L)
        val rtN1 = Runtime(ownerN1, "s2").start()
        val rtOther = Runtime(ConnectionRef("other", 1L)).start()
        rtN.fire("t1")
        rtN.fire("t2")
        rtOther.fire("t1")
        rtN1.fire("t1") // N+1 owns the most recent audio
        assertEquals(4, sink.posted.size)

        coordinator.retire(ownerN)
        val remaining = coordinator.feed.value.records
        assertEquals(setOf(ownerN1.generation to "prof", 1L to "other"), remaining.map { it.target.generation to it.target.profileId }.toSet())
        assertEquals(2, sink.posted.size)
        assertTrue(sink.posted.values.none { it.target.profileId == "prof" && it.target.generation == 1L })
        assertEquals(0, audio.stops, "late N cleanup must not stop N+1 audio")
        assertTrue(coordinator.feed.value.transients.all { t -> remaining.any { it.key == t } })

        // after completed retirement N is dead: nothing is recreated, even by a provider that would still verify it
        provider.verifyEverything = true
        rtN.fire("t3")
        assertEquals(2, sink.posted.size)
        assertEquals(2, coordinator.feed.value.records.size)

        // retiring the owner that played the last audio stops it; zero tags remain for it
        coordinator.retire(ownerN1)
        assertEquals(1, audio.stops)
        assertTrue(sink.posted.values.none { it.target.profileId == "prof" })
        assertEquals(listOf("other"), coordinator.feed.value.records.map { it.target.profileId })
    }

    @Test
    fun retireAttemptsEveryCleanupStepPropagatesAggregateAndKeepsFailedCancelRetryable() = runSuspending {
        val rt = Runtime(ownerN).start()
        rt.fire("t1")
        rt.fire("t2")
        rt.fire("t3")
        val keys = coordinator.feed.value.records.map { it.key } // newest first: t3, t2, t1
        sink.failCancel[keys[1]] = IllegalStateException("cancel t2 failed")
        audio.failStop = IllegalStateException("audio stop failed")

        val failure = assertFailsWith<IllegalStateException> { coordinator.retire(ownerN) }
        // every key was attempted, the healthy ones are gone, audio stop was attempted, history pruned
        assertEquals(keys.toSet(), sink.cancelAttempts.toSet())
        assertEquals(setOf(keys[1]), sink.posted.keys)
        assertEquals(1, audio.stops)
        assertTrue(coordinator.feed.value.records.isEmpty())
        assertEquals("cancel t2 failed", failure.message)
        assertEquals(listOf("audio stop failed"), failure.suppressedExceptions.map { it.message })

        // explicit recovery re-attempts only what still exists and succeeds once the fault clears
        sink.failCancel.clear()
        audio.failStop = null
        sink.cancelAttempts.clear()
        coordinator.retire(ownerN)
        assertEquals(listOf(keys[1]), sink.cancelAttempts)
        assertEquals(2, audio.stops, "a failed audio stop is retried by the next retirement attempt")
        assertTrue(sink.posted.isEmpty())
    }

    @Test
    fun cancellationPropagatesAsPrimaryAndProviderFailureDoesNotInventUngatedCleanup() = runSuspending {
        val rt = Runtime(ownerN).start()
        rt.fire("t1")
        rt.fire("t2")
        val keys = coordinator.feed.value.records.map { it.key }
        sink.failCancel[keys[0]] = IllegalStateException("plain failure")
        sink.failCancel[keys[1]] = CancellationException("cancelled during cleanup")
        val failure = assertFailsWith<CancellationException> { coordinator.retire(ownerN) }
        assertEquals("cancelled during cleanup", failure.message)
        assertEquals(listOf("plain failure"), failure.suppressedExceptions.map { it.message })
        assertEquals(keys.toSet(), sink.cancelAttempts.toSet())

        // provider fails before running the effect: failure propagates, no ungated cancel, still retired
        val rt2 = Runtime(ConnectionRef("prof2", 1L)).start()
        rt2.fire("t1")
        sink.cancelAttempts.clear()
        provider.invalidateFailure = IllegalStateException("provider failed")
        assertFailsWith<IllegalStateException> { coordinator.retire(rt2.owner) }
        assertTrue(sink.cancelAttempts.isEmpty())
        provider.verifyEverything = true
        rt2.fire("t2")
        assertEquals(1, coordinator.feed.value.records.count { it.target.profileId == "prof2" }, "retired generation never admits again")
    }

    @Test
    fun admittedPostFinishesThenRetirementLeavesZeroTags() = runSuspending {
        val rt = Runtime(ownerN).start()
        repeat(5) { rt.fire("t$it") }
        assertEquals(5, sink.posted.size)
        coordinator.retire(ownerN)
        assertTrue(sink.posted.isEmpty())
        assertTrue(coordinator.feed.value.records.isEmpty())
        assertTrue(coordinator.feed.value.transients.isEmpty())
        // no replay of the retired runtime's attentions through a fresh baseline of the same retired owner
        provider.verifyEverything = true
        rt.fire("late")
        assertTrue(sink.posted.isEmpty())
    }

    @Test
    fun retirementWaitsOnTheGateOfAnAdmittedEffectAndLeavesNoTags() = runSuspending {
        val rt = Runtime(ownerN).start()
        val event = assertIs<AgentAdmission.Accepted>(rt.next("t1")).event
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        provider.beforeEffect = {
            entered.complete(Unit)
            release.await()
        }
        coroutineScope {
            val admit = launch { coordinator.admit(event, rt.integration) }
            entered.await()
            val retire = launch { coordinator.retire(ownerN) }
            yield()
            assertTrue(retire.isActive, "retirement must wait on the gate held by the admitted effect")
            assertTrue(provider.retired.isEmpty(), "invalidate must not have entered the gate yet")
            release.complete(Unit)
            admit.join()
            retire.join()
        }
        assertTrue(provider.retired.contains(ownerN))
        assertTrue(sink.posted.isEmpty())
        assertTrue(coordinator.feed.value.records.isEmpty())
        assertTrue(coordinator.feed.value.transients.isEmpty())
    }

    @Test
    fun failedOsPostResultIsNotTrackedAsAShadeEntry() = runSuspending {
        val rt = Runtime(ownerN).start()
        sink.postResult = false
        rt.fire("t1")
        assertEquals(1, coordinator.feed.value.records.size)
        assertTrue(sink.posted.isEmpty())
        coordinator.retire(ownerN)
        assertTrue(sink.cancelAttempts.isEmpty())
    }

    @Test
    fun failedCancellationsNeverLoseTrackingAndTrackerStopsPostingInsteadOfEvicting() = runSuspending {
        val rt = Runtime(ownerN).start()
        sink.failAllCancels = IllegalStateException("cancel unavailable")
        repeat(160) { rt.fire("t$it") }
        assertEquals(NotificationCoordinator.MAX_RECORDS, coordinator.feed.value.records.size)
        assertEquals(100, sink.posted.size, "OS posts stop at the tracker cap; nothing untracked remains in the shade")
        // recovery: cancellation works again, retirement removes every tag of the owner
        sink.failAllCancels = null
        coordinator.retire(ownerN)
        assertTrue(sink.posted.isEmpty())
    }
}
