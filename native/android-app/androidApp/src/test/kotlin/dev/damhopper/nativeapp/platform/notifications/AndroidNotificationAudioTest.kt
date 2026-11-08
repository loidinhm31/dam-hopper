package dev.damhopper.nativeapp.platform.notifications

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class AndroidNotificationAudioTest {

    @Test
    fun audioLifecycleAndGracefulFailureHandling() {
        val audio = AndroidNotificationAudio()
        assertNotNull(audio)
        // Invalid or zero volume does not play or leak
        audio.play("invalid_pattern", 0.5)
        audio.play("default", 0.0)
        audio.play("default", -1.0)
        audio.play("default", 1.5)
        audio.play("default", Double.NaN)
        audio.play("default", Double.POSITIVE_INFINITY)
        audio.play("default", Double.NEGATIVE_INFINITY)
        audio.stop()
        audio.stop() // idempotent
        audio.close()
        audio.close() // idempotent
        // Play after close is safely ignored
        audio.play("default", 0.5)
    }

    @Test
    fun supportedPatternsSetIsExact() {
        val expected = setOf("default", "soft", "two-tone", "urgent")
        assertEquals(expected, NotificationTones.supportedPatterns)
    }

    @Test
    fun durationMsMatchesPatternDefinitions() {
        assertEquals(180, NotificationTones.durationMs("default"))
        assertEquals(240, NotificationTones.durationMs("soft"))
        assertEquals(340, NotificationTones.durationMs("two-tone")) // 150 + 40 + 150
        assertEquals(420, NotificationTones.durationMs("urgent")) // 100 + 60 + 100 + 60 + 100
        assertNull(NotificationTones.durationMs("unknown"))
        assertNull(NotificationTones.durationMs(""))
    }

    @Test
    fun pcmGenerationProducesValidWaveformsForAllSupportedPatterns() {
        assertEquals(22_050, NotificationTones.SAMPLE_RATE, "Sample rate must be 22,050 Hz")
        for (pattern in NotificationTones.supportedPatterns) {
            val pcm = assertNotNull(NotificationTones.pcm(pattern), "pcm for $pattern")
            assertTrue(pcm.isNotEmpty(), "pcm should not be empty for $pattern")
            val durationMs = assertNotNull(NotificationTones.durationMs(pattern))
            val expectedFrames = durationMs * NotificationTones.SAMPLE_RATE / 1000
            assertTrue(
                abs(pcm.size - expectedFrames) <= 1,
                "expected ~${expectedFrames} frames for $pattern, got ${pcm.size}",
            )
            // Every sample must be within valid 16-bit PCM bounds
            assertTrue(pcm.all { it >= Short.MIN_VALUE && it <= Short.MAX_VALUE })
            // Nonzero audible signal must be generated
            assertTrue(pcm.maxOf { abs(it.toInt()) } > 10_000, "Signal must have audible nonzero amplitude")
            // Envelope fade-in ensures the first sample starts at 0
            assertEquals(0, pcm[0].toInt(), "First sample of $pattern should be 0 due to fade-in envelope")
        }
        // Envelope ramp: verify amplitude increases over the 8ms fade window for "default"
        val defaultPcm = assertNotNull(NotificationTones.pcm("default"))
        val earlyWindowMax = defaultPcm.slice(0..25).maxOf { abs(it.toInt()) }
        val settledWindowMax = defaultPcm.slice(150..176).maxOf { abs(it.toInt()) }
        assertTrue(
            earlyWindowMax < settledWindowMax,
            "Early envelope window ($earlyWindowMax) must be ramped below settled window ($settledWindowMax)",
        )
    }

    @Test
    fun softPatternHasStrictlyLowerMaxAmplitudeThanDefault() {
        val defaultPcm = assertNotNull(NotificationTones.pcm("default"))
        val softPcm = assertNotNull(NotificationTones.pcm("soft"))
        val defaultMax = defaultPcm.maxOf { abs(it.toInt()) }
        val softMax = softPcm.maxOf { abs(it.toInt()) }
        assertTrue(
            softMax < defaultMax,
            "Soft pattern max amplitude ($softMax) must be strictly less than default ($defaultMax)",
        )
    }

    @Test
    fun twoToneAndUrgentPatternsContainSilentGaps() {
        val twoTonePcm = assertNotNull(NotificationTones.pcm("two-tone"))
        // First tone is 150ms. Gap is 40ms from frame ~3307 to ~4190.
        val gapStart = 150 * NotificationTones.SAMPLE_RATE / 1000
        val gapFrames = 40 * NotificationTones.SAMPLE_RATE / 1000
        // The entire interior of the gap must be strictly silent (0)
        for (i in (gapStart + 5) until (gapStart + gapFrames - 5)) {
            assertEquals(0, twoTonePcm[i].toInt(), "Two-tone gap sample at frame $i should be silent (0)")
        }

        val urgentPcm = assertNotNull(NotificationTones.pcm("urgent"))
        // First tone 100ms, first gap 60ms.
        val urgentGapStart = 100 * NotificationTones.SAMPLE_RATE / 1000
        val urgentGapFrames = 60 * NotificationTones.SAMPLE_RATE / 1000
        for (i in (urgentGapStart + 5) until (urgentGapStart + urgentGapFrames - 5)) {
            assertEquals(0, urgentPcm[i].toInt(), "Urgent gap sample at frame $i should be silent (0)")
        }
    }

    @Test
    fun pcmCacheReturnsSameInstanceOnSubsequentCalls() {
        for (pattern in NotificationTones.supportedPatterns) {
            val first = NotificationTones.pcm(pattern)
            val second = NotificationTones.pcm(pattern)
            assertSame(first, second, "Repeated calls for $pattern must return cached ShortArray instance")
        }
    }

    @Test
    fun unsupportedOrEmptyPatternsReturnNull() {
        assertNull(NotificationTones.pcm("invalid"))
        assertNull(NotificationTones.pcm(""))
        assertNull(NotificationTones.pcm("   "))
        assertNull(NotificationTones.pcm("chime"))
    }
}
