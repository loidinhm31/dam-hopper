package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class BlameValidatorAndCacheTest {

    @Test
    fun testComputeBufferLineCount() {
        assertEquals(1, BlameValidator.computeBufferLineCount(""))
        assertEquals(2, BlameValidator.computeBufferLineCount("alpha\nbeta"))
        assertEquals(2, BlameValidator.computeBufferLineCount("alpha\r\nbeta"))
        assertEquals(2, BlameValidator.computeBufferLineCount("alpha\rbeta"))
        assertEquals(2, BlameValidator.computeBufferLineCount("alpha\n"))
        assertEquals(3, BlameValidator.computeBufferLineCount("a\nb\nc"))
    }

    @Test
    fun testBufferLimitThreshold() {
        assertFalse(BlameValidator.isBufferOverLimit("hello world"))
        val normalBytes = ByteArray(1024 * 1024) { 'a'.code.toByte() }.decodeToString()
        assertFalse(BlameValidator.isBufferOverLimit(normalBytes))
        val hugeBytes = ByteArray(5 * 1024 * 1024 + 10) { 'a'.code.toByte() }.decodeToString()
        assertTrue(BlameValidator.isBufferOverLimit(hugeBytes))
    }

    @Test
    fun testSha256Fingerprint() {
        val hash = BlameValidator.computeBufferFingerprint("test content")
        assertEquals(64, hash.length)
        assertTrue(hash.all { it in "0123456789abcdef" })
    }

    @Test
    fun testValidateReadyResponse() {
        val commit = GitBlameCommit("abc1234", "Author", "author@example.com", 1700000000L, 0, "Initial commit")
        val response = GitBlameResponse(
            snapshotId = "snap-1",
            modelVersion = 1L,
            rootId = ".",
            rootRelativePath = "file.txt",
            baseCommitOid = "abc1234",
            bufferLineCount = 3,
            status = GitBlameStatus.READY,
            ranges = listOf(
                GitBlameRange(startLine = 1, lineCount = 2, commitIndex = 0),
                GitBlameRange(startLine = 3, lineCount = 1, commitIndex = null)
            ),
            commits = listOf(commit)
        )

        val res = BlameValidator.validateBlameResponse(
            response = response,
            expectedSnapshotId = "snap-1",
            expectedModelVersion = 1L,
            expectedBufferLineCount = 3
        )
        assertTrue(res is BlameValidator.ValidationResult.Valid)
    }

    @Test
    fun testValidateUncommittedResponse() {
        val response = GitBlameResponse(
            snapshotId = "snap-2",
            modelVersion = 1L,
            rootId = ".",
            rootRelativePath = "file.txt",
            bufferLineCount = 2,
            status = GitBlameStatus.UNCOMMITTED,
            ranges = listOf(
                GitBlameRange(startLine = 1, lineCount = 2, commitIndex = null)
            ),
            commits = emptyList()
        )

        val res = BlameValidator.validateBlameResponse(response)
        assertTrue(res is BlameValidator.ValidationResult.Valid)
    }

    @Test
    fun testValidateEmptyStatus() {
        val emptyResp = GitBlameResponse(
            snapshotId = "snap-3",
            modelVersion = 1L,
            rootId = ".",
            rootRelativePath = "empty.txt",
            bufferLineCount = 1,
            status = GitBlameStatus.EMPTY,
            ranges = emptyList(),
            commits = emptyList()
        )
        assertTrue(BlameValidator.validateBlameResponse(emptyResp) is BlameValidator.ValidationResult.Valid)
    }

    @Test
    fun testValidatePartitionGapAndOverlapRejection() {
        val commit = GitBlameCommit("hash", "A", "a@b.com", 0L, 0, "sub")
        // Gap: 1..1, then 3..3 (missing 2)
        val gapResp = GitBlameResponse(
            snapshotId = "snap-4", modelVersion = 1L, rootId = ".", rootRelativePath = "f.txt",
            bufferLineCount = 3, status = GitBlameStatus.READY,
            ranges = listOf(
                GitBlameRange(startLine = 1, lineCount = 1, commitIndex = 0),
                GitBlameRange(startLine = 3, lineCount = 1, commitIndex = 0)
            ),
            commits = listOf(commit)
        )
        assertTrue(BlameValidator.validateBlameResponse(gapResp) is BlameValidator.ValidationResult.Invalid)

        // Overlap: 1..2, then 2..3
        val overlapResp = GitBlameResponse(
            snapshotId = "snap-5", modelVersion = 1L, rootId = ".", rootRelativePath = "f.txt",
            bufferLineCount = 3, status = GitBlameStatus.READY,
            ranges = listOf(
                GitBlameRange(startLine = 1, lineCount = 2, commitIndex = 0),
                GitBlameRange(startLine = 2, lineCount = 2, commitIndex = 0)
            ),
            commits = listOf(commit)
        )
        assertTrue(BlameValidator.validateBlameResponse(overlapResp) is BlameValidator.ValidationResult.Invalid)
    }

    @Test
    fun testValidateCommitIndexOutOfBounds() {
        val response = GitBlameResponse(
            snapshotId = "snap-6", modelVersion = 1L, rootId = ".", rootRelativePath = "f.txt",
            bufferLineCount = 1, status = GitBlameStatus.READY,
            ranges = listOf(GitBlameRange(startLine = 1, lineCount = 1, commitIndex = 5)),
            commits = emptyList()
        )
        assertTrue(BlameValidator.validateBlameResponse(response) is BlameValidator.ValidationResult.Invalid)
    }

    @Test
    fun testBlameCacheLruCapacityAndEviction() = runTest {
        val cache = BlameCache(maxEntries = 2, maxBytes = 100_000L)
        val owner = ConnectionRef("prof-1", 1L)
        val target = ProjectTargetRef(project = "demo")

        val key1 = BlameCacheKey("prof-1", 1L, "demo", path = "f1.txt", sha256Fingerprint = "hash1")
        val key2 = BlameCacheKey("prof-1", 1L, "demo", path = "f2.txt", sha256Fingerprint = "hash2")
        val key3 = BlameCacheKey("prof-1", 1L, "demo", path = "f3.txt", sha256Fingerprint = "hash3")

        val resp = GitBlameResponse("s", 1L, ".", "f", null, 1, GitBlameStatus.EMPTY)
        cache.put(key1, resp)
        cache.put(key2, resp)
        assertEquals(2, cache.size())

        // Access key1 so key2 becomes least recently used
        assertNotNull(cache.get(key1))

        // Put key3 -> key2 should be evicted
        cache.put(key3, resp)
        assertEquals(2, cache.size())
        assertNotNull(cache.get(key1))
        assertNull(cache.get(key2))
        assertNotNull(cache.get(key3))

        // Advance target epoch invalidates all entries for target
        cache.advanceTargetEpoch(owner, target)
        assertEquals(0, cache.size())
    }

    @Test
    fun testCommitRevealCoordinator() {
        val coordinator = CommitRevealCoordinator()
        val owner = ConnectionRef("prof-1", 1L)
        val target = ProjectTargetRef(project = "repo")

        val request = CommitRevealRequest(
            owner = owner,
            target = target,
            commitHash = "deadbeef"
        )
        coordinator.requestReveal(request)
        assertEquals(request, coordinator.pendingReveal.value)

        // Stale owner consumption returns null
        val staleOwner = ConnectionRef("prof-2", 1L)
        assertNull(coordinator.consumeReveal(staleOwner, target))

        // Correct owner consumption succeeds
        coordinator.requestReveal(request)
        val consumed = coordinator.consumeReveal(owner, target)
        assertEquals("deadbeef", consumed?.commitHash)
        assertNull(coordinator.pendingReveal.value)
    }
}
