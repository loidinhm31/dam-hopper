package dev.damhopper.nativeapp.core.notifications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NotificationSinkTest {

    private fun key(
        process: String = "proc",
        profile: String = "p",
        generation: Long = 1L,
        epoch: Long? = 1L,
        terminal: String? = "t",
        incarnation: Long? = 1L,
        session: String? = "s",
        kind: String? = "omp",
        revision: Long? = 1L,
        event: String = "e",
    ) = NotificationKey.of(process, profile, generation, epoch, terminal, incarnation, session, kind, revision, event)

    private fun note(key: String, profile: String = "p", generation: Long = 1L, terminal: String? = null) = AppNotification(
        key = key,
        channel = NotificationChannelId.TERMINAL_ATTENTION,
        target = NotificationTarget(profileId = profile, generation = generation, terminalId = terminal),
        title = "t",
        body = "b",
    )

    @Test
    fun testNotificationChannels() {
        assertEquals("channel_terminal_attention", NotificationChannelId.TERMINAL_ATTENTION.id)
        assertEquals("channel_transfers", NotificationChannelId.TRANSFERS.id)
        assertEquals("channel_idle_suspend", NotificationChannelId.IDLE_SUSPEND.id)
        assertEquals(3, NotificationChannelId.entries.size) // no fourth/health/per-setting channels
    }

    @Test
    fun testNotificationPostingAndPublicRedaction() {
        val sink = InMemoryNotificationSink()
        val target = NotificationTarget(
            profileId = "profile-1",
            generation = 2L,
            serverEpoch = 100L,
            terminalId = "term-42",
            incarnation = 3L,
            attentionRevision = 5L,
        )
        val k = key(profile = "profile-1", generation = 2L, epoch = 100L, terminal = "term-42", incarnation = 3L, revision = 5L)
        val notification = AppNotification(
            key = k,
            channel = NotificationChannelId.TERMINAL_ATTENTION,
            target = target,
            title = "OMP needs attention",
            body = "Approval requested",
        )

        sink.postNotification(notification)

        val posted = sink.getActiveNotifications().single()
        assertEquals(k, posted.key)
        // default public text is always generic and never carries the private title/body
        assertEquals("DamHopper", posted.publicTitle)
        assertEquals("Attention required", posted.publicBody)
        assertFalse(posted.silent)
        assertEquals("profile-1", posted.target.profileId)
        assertEquals(2L, posted.target.generation)
        assertEquals("term-42", posted.target.terminalId)
        assertEquals(3L, posted.target.incarnation)
    }

    @Test
    fun postingTheSameKeyReplacesAndDifferentKeysNeverDo() {
        val sink = InMemoryNotificationSink()
        sink.postNotification(note("k1"))
        sink.postNotification(note("k1"))
        sink.postNotification(note("k2"))
        assertEquals(listOf("k1", "k2"), sink.getActiveNotifications().map { it.key })
        sink.cancelNotification("k1")
        assertEquals(listOf("k2"), sink.getActiveNotifications().map { it.key })
        sink.cancelNotification("unknown")
        assertEquals(1, sink.getActiveNotifications().size)
        assertFailsWith<IllegalArgumentException> { note(" ") }
    }

    @Test
    fun testCancelNotificationsForProfileOnRetirement() {
        val sink = InMemoryNotificationSink()
        sink.postNotification(note("a1", profile = "profile-A"))
        sink.postNotification(note("a2", profile = "profile-A", generation = 2L))
        sink.postNotification(note("b1", profile = "profile-B"))
        assertEquals(3, sink.getActiveNotifications().size)

        sink.cancelNotificationsForProfile("profile-A")

        val remaining = sink.getActiveNotifications()
        assertEquals(listOf("b1"), remaining.map { it.key })
        assertEquals("profile-B", remaining.single().target.profileId)
        sink.cancelAll()
        assertTrue(sink.getActiveNotifications().isEmpty())
    }

    @Test
    fun equalTerminalIdsAcrossProfilesAndIncarnationsHaveDistinctKeys() {
        val keys = listOf(
            key(profile = "profile-A"),
            key(profile = "profile-B"),
            key(incarnation = 2L),
            key(session = "s2"),
            key(kind = "claude"),
            key(revision = 2L),
            key(epoch = 2L),
            key(generation = 2L),
            key(process = "proc-2"),
            key(event = "e2"),
        )
        assertEquals(keys.size, keys.toSet().size)
        val sink = InMemoryNotificationSink()
        keys.forEachIndexed { i, k -> sink.postNotification(note(k, profile = "p$i")) }
        assertEquals(keys.size, sink.getActiveNotifications().size)
    }

    @Test
    fun intHashCollisionsAndDelimiterTricksDoNotCollide() {
        // classic equal-hashCode strings
        assertEquals("Aa".hashCode(), "BB".hashCode())
        assertNotEquals(key(terminal = "Aa"), key(terminal = "BB"))
        // naive "a:b" / "a|b" concatenation ambiguities and length-prefix lookalikes
        assertNotEquals(key(terminal = "1:x", session = "y"), key(terminal = "1", session = "x:y"))
        assertNotEquals(key(profile = "p:1", terminal = "t"), key(profile = "p", terminal = "1:t"))
        assertNotEquals(key(terminal = null), key(terminal = "~"))
        assertNotEquals(key(terminal = null), key(terminal = ""))
        assertNotEquals(key(session = "ab", kind = "c"), key(session = "a", kind = "bc"))
        // unicode is encoded by UTF-8 byte length, still injective
        assertNotEquals(key(terminal = "é"), key(terminal = "e\u0301"))
    }

    @Test
    fun keysAreUriSafeStableAndDecodeToTheirTuple() {
        val k = key(profile = "prof/with space?#&=", terminal = "t:é/ü%", event = "ev ent/1")
        assertTrue(k.isNotEmpty() && k.all { it in '0'..'9' || it in 'a'..'f' }, "key must be URI-safe lowercase hex: $k")
        assertEquals(k, key(profile = "prof/with space?#&=", terminal = "t:é/ü%", event = "ev ent/1"))
        val fields = assertNotNull(NotificationKey.fields(k))
        assertEquals(
            listOf("proc", "prof/with space?#&=", "1", "1", "t:é/ü%", "1", "s", "omp", "1", "ev ent/1"),
            fields,
        )
        val withNulls = NotificationKey.of("proc", "p", 0L, null, null, null, null, null, null, "e")
        assertEquals(listOf("proc", "p", "0", null, null, null, null, null, null, "e"), NotificationKey.fields(withNulls))
    }

    @Test
    fun nonCanonicalKeysDoNotDecode() {
        assertNull(NotificationKey.fields(""))
        assertNull(NotificationKey.fields("generic-key"))
        assertNull(NotificationKey.fields("zz"))
        val k = key()
        assertNull(NotificationKey.fields(k.dropLast(2)))
        assertNull(NotificationKey.fields(k + "00"))
        assertNull(NotificationKey.fields(k.uppercase())) // case-stable: only the canonical lowercase form
        assertFailsWith<IllegalArgumentException> { NotificationKey.of(" ", "p", 1L, null, null, null, null, null, null, "e") }
        assertFailsWith<IllegalArgumentException> { NotificationKey.of("proc", "", 1L, null, null, null, null, null, null, "e") }
        assertFailsWith<IllegalArgumentException> { NotificationKey.of("proc", "p", 1L, null, null, null, null, null, null, " ") }
    }

    @Test
    fun targetCountersAreCheckedSafeIntegers() {
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", -1L) }
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", 1L, serverEpoch = MAX_SERVER_SAFE_INTEGER + 1) }
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", 1L, incarnation = -5L) }
        assertFailsWith<IllegalArgumentException> { NotificationTarget("p", 1L, attentionRevision = Long.MAX_VALUE) }
        NotificationTarget("p", 1L, serverEpoch = MAX_SERVER_SAFE_INTEGER)
        assertNull((MAX_SERVER_SAFE_INTEGER.toULong() + 1uL).toServerSafeLongOrNull())
        assertNull(ULong.MAX_VALUE.toServerSafeLongOrNull())
        assertEquals(MAX_SERVER_SAFE_INTEGER, MAX_SERVER_SAFE_INTEGER.toULong().toServerSafeLongOrNull())
    }

    @Test
    fun silentFlagAndGenericPublicTextAreDefaultsOfTheModel() {
        val n = note("k")
        assertFalse(n.silent)
        assertEquals("DamHopper", n.publicTitle)
        assertEquals("Attention required", n.publicBody)
        assertTrue(n.copy(silent = true).silent)
    }
}
