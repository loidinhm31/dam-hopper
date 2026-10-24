package dev.damhopper.nativeapp.core.logging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DiagnosticRingBufferTest {

    @Test
    fun testMaxEntriesBoundAndEviction() {
        val buffer = DiagnosticRingBuffer(maxEntries = 5, maxBytes = 100_000)

        for (i in 1..10) {
            buffer.add(
                DiagnosticEntry(
                    timestampMs = i * 1000L,
                    type = "terminal",
                    scope = "terminal-panel",
                    message = "event-$i",
                    profileId = "prof-1",
                ),
                minIntervalMs = 0L, // disable rate limit for count test
            )
        }

        val snapshot = buffer.snapshot()
        assertEquals(5, snapshot.size)
        // Oldest (1..5) evicted; retained should be 6..10
        assertEquals("event-6", snapshot[0].message)
        assertEquals("event-10", snapshot[4].message)
    }

    @Test
    fun testMaxBytesBoundAndEviction() {
        // Very tight byte cap
        val buffer = DiagnosticRingBuffer(maxEntries = 100, maxBytes = 500)

        for (i in 1..20) {
            buffer.add(
                DiagnosticEntry(
                    timestampMs = i * 1000L,
                    type = "terminal",
                    scope = "scope-test",
                    message = "a_medium_length_message_for_testing_$i",
                    metadata = mapOf("k1" to "value_1", "k2" to "value_2"),
                ),
                minIntervalMs = 0L,
            )
        }

        val stats = buffer.currentStats()
        assertTrue(stats.second <= 500, "Buffer bytes ${stats.second} should be <= 500")
        assertTrue(stats.first < 20, "Should have evicted oldest entries")
    }

    @Test
    fun testRateLimitingRepetitiveEvents() {
        val buffer = DiagnosticRingBuffer(maxEntries = 100, maxBytes = 100_000)

        // Add 5 identical events in rapid succession within 500ms
        for (i in 1..5) {
            buffer.add(
                DiagnosticEntry(
                    timestampMs = 1000L + (i * 10), // only 10ms apart
                    type = "transport",
                    scope = "terminal-panel",
                    message = "stream_gap_detected",
                    sessionId = "term-1",
                ),
                minIntervalMs = 500L,
            )
        }

        val snapshot = buffer.snapshot()
        // Only the first event should be admitted, others suppressed by rate limiting
        assertEquals(1, snapshot.size)

        // After 600ms, next event is admitted
        buffer.add(
            DiagnosticEntry(
                timestampMs = 1700L,
                type = "transport",
                scope = "terminal-panel",
                message = "stream_gap_detected",
                sessionId = "term-1",
            ),
            minIntervalMs = 500L,
        )

        assertEquals(2, buffer.snapshot().size)
    }

    @Test
    fun testProfileAndSessionFiltering() {
        val buffer = DiagnosticRingBuffer()

        buffer.add(DiagnosticEntry(1L, "terminal", "scope-1", "m1", profileId = "prof-A", sessionId = "sess-1"), 0L)
        buffer.add(DiagnosticEntry(2L, "terminal", "scope-1", "m2", profileId = "prof-A", sessionId = "sess-2"), 0L)
        buffer.add(DiagnosticEntry(3L, "terminal", "scope-1", "m3", profileId = "prof-B", sessionId = "sess-1"), 0L)

        val profA = buffer.snapshot(profileId = "prof-A")
        assertEquals(2, profA.size)
        assertEquals("m1", profA[0].message)
        assertEquals("m2", profA[1].message)

        val profASess1 = buffer.snapshot(profileId = "prof-A", sessionId = "sess-1")
        assertEquals(1, profASess1.size)
        assertEquals("m1", profASess1[0].message)

        val profB = buffer.snapshot(profileId = "prof-B")
        assertEquals(1, profB.size)
        assertEquals("m3", profB[0].message)
    }

    @Test
    fun testGenerationScopedFilteringAndScopedClear() {
        val buffer = DiagnosticRingBuffer()

        buffer.add(DiagnosticEntry(1L, "terminal", "scope", "g1", profileId = "prof-A", generation = 1L), 0L)
        buffer.add(DiagnosticEntry(2L, "terminal", "scope", "g2", profileId = "prof-A", generation = 2L), 0L)
        buffer.add(DiagnosticEntry(3L, "terminal", "scope", "g3", profileId = "prof-B", generation = 1L), 0L)

        // Filter by profile-A and generation 2:
        val gen2 = buffer.snapshot(profileId = "prof-A", generation = 2L)
        assertEquals(1, gen2.size)
        assertEquals("g2", gen2[0].message)

        // Scoped clear for profile-A only:
        buffer.clear(profileId = "prof-A")
        val remaining = buffer.snapshot()
        assertEquals(1, remaining.size)
        assertEquals("prof-B", remaining[0].profileId)
    }

    @Test
    fun testRateLimitsPruningOnOverflow() {
        val buffer = DiagnosticRingBuffer()
        // Add 120 unique keys
        for (i in 1..120) {
            buffer.add(
                DiagnosticEntry(
                    timestampMs = i * 1000L,
                    type = "type-$i",
                    scope = "scope-$i",
                    message = "msg-$i",
                ),
                minIntervalMs = 0L
            )
        }
        // Buffer should succeed and not blow up
        assertEquals(120, buffer.snapshot().size)
    }
    @Test
    fun testClear() {
        val buffer = DiagnosticRingBuffer()
        buffer.add(DiagnosticEntry(1L, "terminal", "scope", "msg"), 0L)
        assertEquals(1, buffer.snapshot().size)
        buffer.clear()
        assertEquals(0, buffer.snapshot().size)
        assertEquals(0, buffer.currentStats().second)
    }
}
