package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Cache key identifying blame attribution across multi-dimensional identity.
 */
data class BlameCacheKey(
    val profileId: String,
    val generation: Long,
    val project: String,
    val worktreePath: String? = null,
    val rootId: String = ".",
    val headOid: String? = null,
    val repositoryEpoch: Long = 1L,
    val path: String,
    val sha256Fingerprint: String,
)

data class BlameCacheEntry(
    val key: BlameCacheKey,
    val response: GitBlameResponse,
    val estimatedBytes: Long,
    var accessOrder: Long,
)

/**
 * Bounded LRU cache for completed Git blame responses.
 * Respects maximum 64 entries and 32 MiB memory budget.
 */
class BlameCache(
    val maxEntries: Int = BLAME_CACHE_MAX_ENTRIES,
    val maxBytes: Long = BLAME_CACHE_MAX_BYTES,
) {
    private val mutex = Mutex()
    private val entries = mutableMapOf<BlameCacheKey, BlameCacheEntry>()
    private val targetEpochs = mutableMapOf<String, Long>()
    private var totalBytes: Long = 0L
    private var accessCounter: Long = 0L

    suspend fun get(key: BlameCacheKey): GitBlameResponse? = mutex.withLock {
        val entry = entries[key] ?: return null
        entry.accessOrder = ++accessCounter
        entry.response
    }

    suspend fun put(key: BlameCacheKey, response: GitBlameResponse): Boolean = mutex.withLock {
        val bytes = estimateMemoryWeight(response)
        if (bytes > maxBytes) return false

        val existing = entries.remove(key)
        if (existing != null) {
            totalBytes -= existing.estimatedBytes
        }

        while (entries.size >= maxEntries || (totalBytes + bytes) > maxBytes) {
            val oldest = entries.values.minByOrNull { it.accessOrder } ?: break
            entries.remove(oldest.key)
            totalBytes -= oldest.estimatedBytes
        }

        entries[key] = BlameCacheEntry(key, response, bytes, ++accessCounter)
        totalBytes += bytes
        true
    }

    suspend fun getTargetEpoch(owner: ConnectionRef, target: ProjectTargetRef): Long = mutex.withLock {
        val key = "${owner.profileId}:${owner.generation}:${target.project}:${target.worktreePath ?: ""}"
        targetEpochs.getOrPut(key) { 1L }
    }

    suspend fun advanceTargetEpoch(owner: ConnectionRef, target: ProjectTargetRef): Long = mutex.withLock {
        val targetKey = "${owner.profileId}:${owner.generation}:${target.project}:${target.worktreePath ?: ""}"
        val newEpoch = (targetEpochs[targetKey] ?: 1L) + 1L
        targetEpochs[targetKey] = newEpoch

        val toRemove = entries.keys.filter {
            it.profileId == owner.profileId &&
                it.generation == owner.generation &&
                it.project == target.project &&
                it.worktreePath == target.worktreePath
        }
        for (k in toRemove) {
            val removed = entries.remove(k)
            if (removed != null) totalBytes -= removed.estimatedBytes
        }
        newEpoch
    }

    suspend fun retireOwner(owner: ConnectionRef) = mutex.withLock {
        val toRemove = entries.keys.filter { it.profileId == owner.profileId && it.generation == owner.generation }
        for (k in toRemove) {
            val removed = entries.remove(k)
            if (removed != null) totalBytes -= removed.estimatedBytes
        }
    }

    suspend fun size(): Int = mutex.withLock { entries.size }

    suspend fun currentBytes(): Long = mutex.withLock { totalBytes }

    suspend fun clear() = mutex.withLock {
        entries.clear()
        targetEpochs.clear()
        totalBytes = 0L
    }

    private fun estimateMemoryWeight(response: GitBlameResponse): Long {
        var bytes = 256L
        bytes += response.snapshotId.length * 2L + response.rootId.length * 2L + response.rootRelativePath.length * 2L
        bytes += (response.baseCommitOid?.length ?: 0) * 2L
        bytes += response.ranges.size * 32L
        for (c in response.commits) {
            bytes += 64L + (c.hash.length + c.authorName.length + c.authorEmail.length + c.subject.length) * 2L
        }
        return bytes
    }
}
