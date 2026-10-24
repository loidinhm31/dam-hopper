package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Coordinates Git blame retrieval with 250ms keystroke debounce, single-flight
 * execution, multi-dimensional cache lookups, and response partition validation.
 */
class BlameRepository(
    val apiClient: ApiClient,
    val cache: BlameCache = BlameCache(),
    private val coroutineScope: CoroutineScope,
) {
    private val mutex = Mutex()
    private val inFlightJobs = mutableMapOf<String, Job>()

    fun requestBlameDebounced(
        target: ProjectTargetRef,
        path: String,
        content: String,
        snapshotId: String,
        modelVersion: Long,
        onResult: (BlameValidator.ValidationResult) -> Unit,
    ) {
        val fileKey = "${target.project}:${target.worktreePath ?: ""}:$path"

        coroutineScope.launch {
            val job = launch {
                delay(GIT_BLAME_DEBOUNCE_MS)
                val res = executeBlame(target, path, content, snapshotId, modelVersion)
                onResult(res)
            }
            mutex.withLock {
                inFlightJobs[fileKey]?.cancel()
                inFlightJobs[fileKey] = job
            }
        }
    }

    suspend fun executeBlame(
        target: ProjectTargetRef,
        path: String,
        content: String,
        snapshotId: String,
        modelVersion: Long,
    ): BlameValidator.ValidationResult {
        if (BlameValidator.isBufferOverLimit(content)) {
            return BlameValidator.ValidationResult.Invalid("Buffer exceeds 5 MiB blame threshold")
        }

        val owner = apiClient.connection
        val epoch = cache.getTargetEpoch(owner, target)
        val fingerprint = BlameValidator.computeBufferFingerprint(content)
        val expectedLines = BlameValidator.computeBufferLineCount(content)

        val cacheKey = BlameCacheKey(
            profileId = owner.profileId,
            generation = owner.generation,
            project = target.project,
            worktreePath = target.worktreePath,
            repositoryEpoch = epoch,
            path = path,
            sha256Fingerprint = fingerprint
        )

        val cached = cache.get(cacheKey)
        if (cached != null) {
            val rebound = cached.copy(snapshotId = snapshotId, modelVersion = modelVersion)
            return BlameValidator.ValidationResult.Valid(rebound)
        }

        return try {
            val encodedProject = ApiClient.encodePathSegment(target.project)
            val input = GitBlameInput(
                path = path,
                worktreePath = target.worktreePath,
                content = content,
                snapshotId = snapshotId,
                modelVersion = modelVersion
            )
            val body = ProtocolJson.encodeToString(GitBlameInput.serializer(), input)
            val responseText = apiClient.postJson("/api/git/$encodedProject/blame", body)
            val response = ProtocolJson.decodeFromString(GitBlameResponse.serializer(), responseText)

            val validation = BlameValidator.validateBlameResponse(
                response = response,
                expectedSnapshotId = snapshotId,
                expectedModelVersion = modelVersion,
                expectedBufferLineCount = expectedLines
            )

            if (validation is BlameValidator.ValidationResult.Valid) {
                cache.put(cacheKey, response)
            }

            validation
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            BlameValidator.ValidationResult.Invalid(e.message ?: "Blame request failed")
        }
    }

    fun deriveLineAttributions(response: GitBlameResponse): Map<Int, BlameLineAttribution> {
        val result = mutableMapOf<Int, BlameLineAttribution>()
        val commits = response.commits

        for (range in response.ranges) {
            val commit = range.commitIndex?.let { idx -> commits.getOrNull(idx) }
            val isUncommitted = range.commitIndex == null || response.status == GitBlameStatus.UNCOMMITTED
            for (line in range.startLine until (range.startLine + range.lineCount)) {
                result[line] = BlameLineAttribution(
                    line = line,
                    commit = commit,
                    isUncommitted = isUncommitted
                )
            }
        }
        return result
    }
}
