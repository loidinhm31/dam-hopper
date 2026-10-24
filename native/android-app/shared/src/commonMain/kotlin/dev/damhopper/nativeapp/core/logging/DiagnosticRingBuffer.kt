package dev.damhopper.nativeapp.core.logging

/**
 * Thread-safe ring buffer retaining recent diagnostic events.
 * Bounded by both maximum entry count and maximum total estimated bytes.
 */
class DiagnosticRingBuffer(
    val maxEntries: Int = 500,
    val maxBytes: Int = 256 * 1024, // 256 KB
) {
    private val lock = Any()
    private val buffer = ArrayDeque<DiagnosticEntry>()
    private var totalBytes: Int = 0

    // Rate-limiting tracking: key -> (lastTimestampMs, count)
    private val rateLimits = mutableMapOf<String, RateLimitState>()

    private data class RateLimitState(
        var lastTimestampMs: Long,
        var suppressedCount: Int,
    )

    fun add(entry: DiagnosticEntry, minIntervalMs: Long = 500L) {
        val entryBytes = estimateBytes(entry)

        synchronized(lock) {
            // Check rate limiting for repetitive events (e.g. repeated stream gaps or dropped inputs)
            val rateKey = "${entry.scope}:${entry.message}:${entry.sessionId ?: ""}"
            val existing = rateLimits[rateKey]
            if (existing != null) {
                if (entry.timestampMs - existing.lastTimestampMs < minIntervalMs) {
                    existing.suppressedCount++
                    return
                } else {
                    existing.lastTimestampMs = entry.timestampMs
                    existing.suppressedCount = 0
                }
            } else {
                if (rateLimits.size >= 100) {
                    val cutoff = entry.timestampMs - 60_000L
                    rateLimits.entries.removeAll { it.value.lastTimestampMs < cutoff }
                }
                if (rateLimits.size < 100) {
                    rateLimits[rateKey] = RateLimitState(entry.timestampMs, 0)
                }
            }
            // Evict oldest entries until within maxEntries and maxBytes
            while (buffer.isNotEmpty() && (buffer.size >= maxEntries || (totalBytes + entryBytes > maxBytes))) {
                val removed = buffer.removeFirst()
                totalBytes = maxOf(0, totalBytes - estimateBytes(removed))
            }

            buffer.addLast(entry)
            totalBytes += entryBytes
        }
    }

    fun snapshot(
        profileId: String? = null,
        generation: Long? = null,
        sessionId: String? = null,
    ): List<DiagnosticEntry> {
        synchronized(lock) {
            val list = buffer.toList()
            return if (profileId == null && generation == null && sessionId == null) {
                list
            } else {
                list.filter { entry ->
                    (profileId == null || entry.profileId == null || entry.profileId == profileId) &&
                    (generation == null || entry.generation == null || entry.generation == generation) &&
                    (sessionId == null || entry.sessionId == null || entry.sessionId == sessionId)
                }
            }
        }
    }

    fun clear(profileId: String? = null) {
        synchronized(lock) {
            if (profileId == null) {
                buffer.clear()
                totalBytes = 0
                rateLimits.clear()
            } else {
                val iterator = buffer.iterator()
                while (iterator.hasNext()) {
                    val item = iterator.next()
                    if (item.profileId == profileId) {
                        iterator.remove()
                        totalBytes = maxOf(0, totalBytes - estimateBytes(item))
                    }
                }
            }
        }
    }


    fun currentStats(): Pair<Int, Int> {
        synchronized(lock) {
            return Pair(buffer.size, totalBytes)
        }
    }

    private fun estimateBytes(entry: DiagnosticEntry): Int {
        var bytes = 64 // Object overhead
        bytes += entry.type.length * 2
        bytes += entry.scope.length * 2
        bytes += entry.message.length * 2
        entry.profileId?.let { bytes += it.length * 2 }
        entry.sessionId?.let { bytes += it.length * 2 }
        entry.metadata?.forEach { (k, v) ->
            bytes += (k.length + v.length) * 2 + 16
        }
        return bytes
    }
}
