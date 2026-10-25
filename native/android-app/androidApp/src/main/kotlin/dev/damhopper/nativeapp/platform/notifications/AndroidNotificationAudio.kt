package dev.damhopper.nativeapp.platform.notifications

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import dev.damhopper.nativeapp.core.notifications.NotificationAudioPort
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * Generated PCM for the four supported patterns. Pure math: no bundled audio, no dependency and nothing
 * derived from user content (terminal output, titles, paths) ever enters a tone.
 */
internal object NotificationTones {
    const val SAMPLE_RATE = 22_050
    private const val FADE_MS = 8

    private data class Tone(val frequencyHz: Double, val durationMs: Int, val gapAfterMs: Int = 0, val amplitude: Double = 0.8)

    private val patterns: Map<String, List<Tone>> = mapOf(
        "default" to listOf(Tone(880.0, 180)),
        "soft" to listOf(Tone(660.0, 240, amplitude = 0.5)),
        "two-tone" to listOf(Tone(660.0, 150, gapAfterMs = 40), Tone(880.0, 150)),
        "urgent" to listOf(Tone(1_000.0, 100, gapAfterMs = 60), Tone(1_000.0, 100, gapAfterMs = 60), Tone(1_000.0, 100)),
    )

    private val cache = ConcurrentHashMap<String, ShortArray>()

    val supportedPatterns: Set<String> get() = patterns.keys

    /** Mono 16-bit PCM at [SAMPLE_RATE] for a supported [pattern] (full scale; volume is applied by the track), else null. */
    fun pcm(pattern: String): ShortArray? {
        val tones = patterns[pattern] ?: return null
        return cache.getOrPut(pattern) { render(tones) }
    }

    fun durationMs(pattern: String): Int? = patterns[pattern]?.sumOf { it.durationMs + it.gapAfterMs }

    private fun render(tones: List<Tone>): ShortArray {
        val total = tones.sumOf { frames(it.durationMs + it.gapAfterMs) }
        val out = ShortArray(total)
        var offset = 0
        for (tone in tones) {
            val toneFrames = frames(tone.durationMs)
            val fade = min(frames(FADE_MS), toneFrames / 2).coerceAtLeast(1)
            for (i in 0 until toneFrames) {
                val envelope = when {
                    i < fade -> i.toDouble() / fade
                    i >= toneFrames - fade -> (toneFrames - 1 - i).toDouble() / fade
                    else -> 1.0
                }
                val sample = sin(2.0 * PI * tone.frequencyHz * i / SAMPLE_RATE) * tone.amplitude * envelope
                out[offset + i] = (sample * Short.MAX_VALUE).toInt().toShort()
            }
            offset += frames(tone.durationMs + tone.gapAfterMs)
        }
        return out
    }

    private fun frames(ms: Int): Int = ms * SAMPLE_RATE / 1000
}

/**
 * Foreground in-app notification audio using only platform audio APIs ([AudioTrack], static PCM tones).
 *
 * - Honors a finite volume in `0..1` through the track gain; anything else, zero volume or an unknown
 *   pattern plays nothing. `USAGE_NOTIFICATION` keeps system volume, ringer mode and Do Not Disturb in
 *   control; this is never a background workaround (the coordinator only calls it in the foreground).
 * - Playback is serialized by one lock: starting a new pattern stops the previous one, so a single
 *   admitted event can never produce two overlapping chimes, and [stop] is exact and idempotent.
 * - Every track is released when it finishes, on [stop] (profile retirement) and on [close] (final
 *   teardown). No Context/Activity is retained at all.
 */
class AndroidNotificationAudio : NotificationAudioPort {

    private val lock = Any()
    private var current: AudioTrack? = null
    private var closed = false
    private val releaseScheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "dh-notification-audio").apply { isDaemon = true }
    }

    /** 1 while a chime is playing/allocated, else 0 (test/diagnostic hook). */
    internal val activeTrackCount: Int get() = synchronized(lock) { if (current != null) 1 else 0 }

    override fun play(pattern: String, volume: Double) {
        if (!volume.isFinite() || volume <= 0.0 || volume > 1.0) return
        val pcm = NotificationTones.pcm(pattern) ?: return
        val durationMs = NotificationTones.durationMs(pattern) ?: return
        synchronized(lock) {
            if (closed) return
            releaseLocked() // one chime at a time
            val track = createTrack(pcm) ?: return
            try {
                track.setVolume(volume.toFloat())
                track.play()
            } catch (_: IllegalStateException) {
                track.release()
                return
            }
            current = track
            releaseScheduler.schedule({ releaseIfCurrent(track) }, durationMs + RELEASE_GRACE_MS, TimeUnit.MILLISECONDS)
        }
    }

    override fun stop() {
        synchronized(lock) { releaseLocked() }
    }

    /** Final teardown: stops audio, releases the track and the release thread. Later [play] calls are ignored. */
    fun close() {
        synchronized(lock) {
            closed = true
            releaseLocked()
        }
        releaseScheduler.shutdownNow()
    }

    private fun releaseIfCurrent(track: AudioTrack) {
        synchronized(lock) { if (current === track) releaseLocked() }
    }

    private fun releaseLocked() {
        val track = current ?: return
        current = null
        try {
            track.stop()
        } catch (_: IllegalStateException) {
            // already stopped/uninitialized
        }
        track.release()
    }

    private fun createTrack(pcm: ShortArray): AudioTrack? {
        var track: AudioTrack? = null
        return try {
            val created = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(NotificationTones.SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(pcm.size * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
            track = created
            if (created.state != AudioTrack.STATE_INITIALIZED || created.write(pcm, 0, pcm.size) != pcm.size) {
                created.release()
                null
            } else {
                track = null
                created
            }
        } catch (_: RuntimeException) {
            track?.release()
            null
        }
    }

    private companion object {
        const val RELEASE_GRACE_MS = 150L
    }
}
