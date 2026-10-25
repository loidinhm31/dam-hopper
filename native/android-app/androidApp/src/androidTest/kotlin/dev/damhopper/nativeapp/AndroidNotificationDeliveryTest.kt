package dev.damhopper.nativeapp

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.StatusBarNotification
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.core.notifications.AppNotification
import dev.damhopper.nativeapp.core.notifications.MAX_SERVER_SAFE_INTEGER
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationKey
import dev.damhopper.nativeapp.core.notifications.NotificationPermissionState
import dev.damhopper.nativeapp.core.notifications.NotificationTarget
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationAudio
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationPlatform
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.notifications.NotificationTones
import kotlin.math.abs
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android delivery qualification for the notification adapters (future planned instrumentation, run on
 * API 29 and API 33+ by Phase 05; not run by the implementation branch):
 * identity/PendingIntent collisions, rotation/relaunch intents, permission/blocked status, public
 * redaction, foreground-silent vs background builders, profile-scoped cancellation, channel set and audio.
 *
 * Tests that post need the system to allow notifications; they skip (Assume) when it does not. On API 33+
 * the grant is attempted through `pm grant`; the "requester" test needs a fresh install with the permission
 * not yet granted and skips otherwise. Nothing here claims physical-device behaviour.
 */
@RunWith(AndroidJUnit4::class)
class AndroidNotificationDeliveryTest {

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private lateinit var sink: AndroidNotificationSink
    private lateinit var manager: NotificationManager

    @Before
    fun setUp() {
        sink = AndroidNotificationSink(context)
        manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        sink.cancelAll()
    }

    @After
    fun tearDown() {
        sink.cancelAll()
    }

    private fun terminalNote(
        profile: String = "profile-A",
        terminal: String = "term-1",
        generation: Long = 1L,
        incarnation: Long = 1L,
        revision: Long = 1L,
        event: String = "evt-1",
        silent: Boolean = false,
    ): AppNotification {
        val key = NotificationKey.of("proc-test", profile, generation, 7L, terminal, incarnation, "sess-1", "omp", revision, event)
        val target = NotificationTarget(
            profileId = profile,
            generation = generation,
            serverEpoch = 7L,
            terminalId = terminal,
            incarnation = incarnation,
            attentionRevision = revision,
            processInstanceId = "proc-test",
            endpoint = "https://host",
            accountId = "acct",
            agentSessionId = "sess-1",
            agentKind = "omp",
        )
        return AppNotification(key, NotificationChannelId.TERMINAL_ATTENTION, target, "OMP needs attention", "Approval requested", silent)
    }

    private fun ensurePostingAllowed() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            instrumentation.uiAutomation
                .executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
                .close()
            Thread.sleep(300)
        }
        assumeTrue("system notifications must be allowed for this test", sink.areNotificationsEnabled())
    }

    private fun active(): List<StatusBarNotification> =
        manager.activeNotifications.filter { it.packageName == context.packageName }

    private fun awaitActiveTags(expected: Set<String>): Boolean {
        val deadline = System.currentTimeMillis() + 3_000
        while (System.currentTimeMillis() < deadline) {
            if (active().mapNotNull { it.tag }.toSet() == expected) return true
            Thread.sleep(50)
        }
        return active().mapNotNull { it.tag }.toSet() == expected
    }

    // ---- identity / PendingIntent ----

    @Test
    fun equalTerminalIdsAcrossProfilesAndIncarnationsGetDistinctTagsIntentsAndPendingIntents() {
        ensurePostingAllowed()
        val a = terminalNote(profile = "profile-A")
        val b = terminalNote(profile = "profile-B")
        val c = terminalNote(profile = "profile-A", incarnation = 2L)
        assertEquals(3, setOf(a.key, b.key, c.key).size)

        val intents = listOf(a, b, c).map { sink.contentIntent(it) }
        for (i in intents.indices) for (j in i + 1 until intents.size) {
            assertFalse(intents[i].filterEquals(intents[j]), "requestCode 0 must still be unique via Intent.data")
            assertNotEquals(intents[i].data, intents[j].data)
        }
        // immutable PendingIntents resolve independently (FLAG_NO_CREATE only finds the exact same request)
        val flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        listOf(a, b, c).forEach { sink.postNotification(it) }
        assertTrue(awaitActiveTags(setOf(a.key, b.key, c.key)))
        for (intent in intents) assertNotNull(PendingIntent.getActivity(context, AndroidNotificationSink.REQUEST_CODE, intent, flags))
        assertTrue(active().all { it.id == AndroidNotificationSink.NOTIFICATION_ID })
    }

    @Test
    fun intHashCollisionTerminalsDoNotReplaceOrCancelEachOther() {
        ensurePostingAllowed()
        assertEquals("Aa".hashCode(), "BB".hashCode())
        val aa = terminalNote(terminal = "Aa")
        val bb = terminalNote(terminal = "BB")
        assertNotEquals(aa.key, bb.key)
        sink.postNotification(aa)
        sink.postNotification(bb)
        assertTrue(awaitActiveTags(setOf(aa.key, bb.key)))
        sink.cancelNotification(aa.key)
        assertTrue(awaitActiveTags(setOf(bb.key)))
    }

    @Test
    fun rotationAndRelaunchIntentsDecodeToTheSameExactTarget() {
        val note = terminalNote()
        val intent = sink.contentIntent(note)
        val first = assertNotNull(AndroidNotificationSink.decodeClick(intent))
        // a relaunch/rotation delivers an equal copy of the same intent
        val second = assertNotNull(AndroidNotificationSink.decodeClick(Intent(intent)))
        assertEquals(note.key, first.key)
        assertEquals(first.key, second.key)
        assertEquals(note.target, first.target)
        assertEquals(first.target, second.target)
        assertEquals(note.key, intent.data?.lastPathSegment)

        // posting the same key again updates in place instead of stacking a duplicate
        ensurePostingAllowed()
        sink.postNotification(note)
        sink.postNotification(note.copy(body = "Approval requested again"))
        assertTrue(awaitActiveTags(setOf(note.key)))
        assertEquals(1, active().size)
    }

    @Test
    fun tamperedOrUnsafeClickIntentsAreRejectedNeverNormalized() {
        val note = terminalNote()
        val base = sink.contentIntent(note)
        fun mutate(change: Intent.() -> Unit) = AndroidNotificationSink.decodeClick(Intent(base).apply(change))
        assertNotNull(mutate { })
        assertNull(mutate { action = Intent.ACTION_VIEW })
        assertNull(mutate { data = null })
        assertNull(mutate { data = AndroidNotificationSink.dataUriFor("some-other-key") })
        assertNull(mutate { removeExtra(AndroidNotificationSink.EXTRA_NOTIFICATION_KEY) })
        assertNull(mutate { removeExtra(AndroidNotificationSink.EXTRA_TARGET_PROFILE_ID) })
        assertNull(mutate { removeExtra(AndroidNotificationSink.EXTRA_TARGET_GENERATION) })
        assertNull(mutate { putExtra(AndroidNotificationSink.EXTRA_TARGET_GENERATION, -1L) })
        assertNull(mutate { putExtra(AndroidNotificationSink.EXTRA_TARGET_SERVER_EPOCH, MAX_SERVER_SAFE_INTEGER + 1) })
        assertNull(mutate { putExtra(AndroidNotificationSink.EXTRA_TARGET_INCARNATION, Long.MIN_VALUE) })
        // extras that disagree with the canonical key tuple (profile/terminal/revision edits) are rejected
        assertNull(mutate { putExtra(AndroidNotificationSink.EXTRA_TARGET_PROFILE_ID, "profile-B") })
        assertNull(mutate { putExtra(AndroidNotificationSink.EXTRA_TARGET_TERMINAL_ID, "other-terminal") })
        assertNull(mutate { putExtra(AndroidNotificationSink.EXTRA_TARGET_ATTENTION_REVISION, 99L) })
        assertNull(AndroidNotificationSink.decodeClick(null))
    }

    @Test
    fun genericNonTerminalKeysDecodeButSemanticTargetsRequireTheirCanonicalKey() {
        val generic = AppNotification("transfer-1", NotificationChannelId.TRANSFERS, NotificationTarget("profile-A", 1L), "t", "b")
        val click = assertNotNull(AndroidNotificationSink.decodeClick(sink.contentIntent(generic)))
        assertEquals(generic.target, click.target)
        assertNull(click.target.terminalId)
        // a terminal/semantic target smuggled under a caller-chosen key is rejected
        val forged = AppNotification("transfer-1", NotificationChannelId.TERMINAL_ATTENTION, terminalNote().target, "t", "b")
        assertNull(AndroidNotificationSink.decodeClick(sink.contentIntent(forged)))
    }

    // ---- presentation ----

    @Test
    fun publicVersionIsGenericAndPrivateTextStaysPrivate() {
        val built = sink.buildNotification(terminalNote())
        assertEquals(Notification.VISIBILITY_PRIVATE, built.visibility)
        assertEquals("OMP needs attention", built.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
        assertEquals("Approval requested", built.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString())
        val public = assertNotNull(built.publicVersion)
        val publicTitle = public.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val publicText = public.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        assertEquals("DamHopper", publicTitle)
        assertEquals("Attention required", publicText)
        assertFalse(publicTitle.orEmpty().contains("OMP") || publicText.orEmpty().contains("Approval"))
        assertEquals(NotificationChannelId.TERMINAL_ATTENTION.id, built.channelId)
    }

    @Test
    fun foregroundBuilderIsSilentAndBackgroundBuilderLeavesTheChannelAlone() {
        val silent = sink.buildNotification(terminalNote(silent = true))
        val audible = sink.buildNotification(terminalNote(silent = false))
        // NotificationCompat.setSilent: no alerting for this post even on an audible existing channel
        assertEquals(Notification.GROUP_ALERT_SUMMARY, silent.groupAlertBehavior)
        assertNotNull(silent.group)
        // background sound-enabled: nothing overrides the user-controlled channel sound/importance
        assertEquals(Notification.GROUP_ALERT_ALL, audible.groupAlertBehavior)
        assertNull(audible.group)
        assertNull(audible.sound, "per-notification sound must not override the channel")
        assertEquals(0, audible.defaults)
    }

    @Test
    fun profileCancellationIsExactAcrossProfilesAndGenerations() {
        ensurePostingAllowed()
        val a1 = terminalNote(profile = "profile-A", generation = 1L)
        val a2 = terminalNote(profile = "profile-A", generation = 2L, event = "evt-2")
        val b1 = terminalNote(profile = "profile-B", generation = 1L)
        listOf(a1, a2, b1).forEach { sink.postNotification(it) }
        assertTrue(awaitActiveTags(setOf(a1.key, a2.key, b1.key)))

        sink.cancelNotification(a2.key) // retired generation tag only
        assertTrue(awaitActiveTags(setOf(a1.key, b1.key)))
        sink.cancelNotificationsForProfile("profile-A")
        assertTrue(awaitActiveTags(setOf(b1.key)))
    }

    // ---- permission / channel status ----

    @Test
    fun platformReportsExactlyTheThreeStableChannelsAndPermissionState() {
        val platform = AndroidNotificationPlatform(context)
        platform.refreshStatus()
        val status = platform.status.value
        assertEquals(NotificationChannelId.entries.toSet(), status.channels.keys)
        val ours = manager.notificationChannels.map { it.id }.filter { it.startsWith("channel_") }.toSet()
        assertEquals(NotificationChannelId.entries.map { it.id }.toSet(), ours, "no fourth/per-setting channel")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            assertEquals(NotificationPermissionState.NOT_REQUIRED, status.permission)
        } else {
            assertTrue(
                status.permission in setOf(
                    NotificationPermissionState.GRANTED,
                    NotificationPermissionState.NOT_REQUESTED,
                    NotificationPermissionState.DENIED,
                ),
            )
        }
        // a system block (permission, app or channel) means the OS post is abandoned without a crash
        val blocked = status.appBlocked || status.permission == NotificationPermissionState.DENIED ||
            status.permission == NotificationPermissionState.NOT_REQUESTED ||
            status.channels.getValue(NotificationChannelId.TERMINAL_ATTENTION).blocked
        if (blocked) {
            sink.postNotification(terminalNote())
            Thread.sleep(300)
            assertTrue(active().isEmpty())
        }
    }

    @Test
    fun permissionRequestIsExplicitOnlyAndNeverAutomatic() {
        val platform = AndroidNotificationPlatform(context)
        var requests = 0
        platform.bindLaunchers(requestPermission = { requests++ })
        platform.refreshStatus()
        assertEquals(0, requests, "binding/refreshing never prompts")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            platform.requestPermission()
            assertEquals(0, requests, "API 29-32 has no runtime permission to request")
            assertEquals(NotificationPermissionState.NOT_REQUIRED, platform.status.value.permission)
        } else {
            assumeTrue("needs a fresh install with POST_NOTIFICATIONS not granted", platform.status.value.permission != NotificationPermissionState.GRANTED)
            platform.requestPermission()
            assertEquals(1, requests)
            platform.onPermissionResult(granted = false)
            assertEquals(NotificationPermissionState.DENIED, platform.status.value.permission)
            platform.refreshStatus()
            assertEquals(1, requests, "denial is never auto-retried")
        }
        platform.unbindLaunchers()
    }

    // ---- audio ----

    @Test
    fun tonesAreGeneratedForExactlyTheSupportedPatternsWithinAmplitudeBounds() {
        assertEquals(setOf("default", "soft", "two-tone", "urgent"), NotificationTones.supportedPatterns)
        for (pattern in NotificationTones.supportedPatterns) {
            val pcm = assertNotNull(NotificationTones.pcm(pattern), pattern)
            assertTrue(pcm.isNotEmpty())
            val expectedFrames = NotificationTones.durationMs(pattern)!! * NotificationTones.SAMPLE_RATE / 1000
            assertTrue(abs(pcm.size - expectedFrames) <= 3, "$pattern length ${pcm.size} vs $expectedFrames")
            assertTrue(pcm.maxOf { abs(it.toInt()) } in 1..Short.MAX_VALUE.toInt())
        }
        assertTrue(NotificationTones.pcm("soft")!!.maxOf { abs(it.toInt()) } < NotificationTones.pcm("default")!!.maxOf { abs(it.toInt()) })
        assertNull(NotificationTones.pcm("bell"))
        assertNull(NotificationTones.pcm(""))
    }

    @Test
    fun audioHonorsFiniteVolumeSerializesPlaybackAndReleasesOnStopAndClose() {
        val audio = AndroidNotificationAudio()
        for (bad in listOf(Double.NaN, Double.POSITIVE_INFINITY, -0.1, 1.01, 0.0)) {
            audio.play("default", bad)
            assertEquals(0, audio.activeTrackCount, "volume $bad must play nothing")
        }
        audio.play("not-a-pattern", 0.5)
        assertEquals(0, audio.activeTrackCount)

        audio.play("two-tone", 0.3)
        assumeTrue("no audio output available on this device", audio.activeTrackCount == 1)
        audio.play("urgent", 1.0) // a second chime replaces, never overlaps
        assertEquals(1, audio.activeTrackCount)
        audio.stop()
        assertEquals(0, audio.activeTrackCount)
        audio.stop() // idempotent

        audio.play("soft", 0.5)
        audio.close()
        assertEquals(0, audio.activeTrackCount)
        audio.play("default", 0.5) // ignored after final teardown
        assertEquals(0, audio.activeTrackCount)
    }
}
