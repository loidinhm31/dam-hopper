package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/**
 * Coordinates safe search-and-replace previews and batch execution by enumerated files,
 * enforcing mtime CAS checks, blocking files with unsaved editor edits, and isolating
 * per-file conflicts and failures.
 */
class ReplaceCoordinator(
    private val repositoryProvider: (profileId: String) -> FileRepository?,
    private val isDirtyFile: (target: ProjectTargetRef, path: String) -> Boolean = { _, _ -> false },
) {
    /**
     * Replaces occurrences of [search] with [replacement] literally without regex expansion.
     */
    fun replaceLiteral(
        content: String,
        search: String,
        replacement: String,
        ignoreCase: Boolean,
    ): String {
        if (search.isEmpty()) return content
        val result = StringBuilder()
        var startIdx = 0
        while (true) {
            val foundIdx = content.indexOf(search, startIdx, ignoreCase = ignoreCase)
            if (foundIdx < 0) {
                result.append(content.substring(startIdx))
                break
            }
            result.append(content.substring(startIdx, foundIdx))
            result.append(replacement)
            startIdx = foundIdx + search.length
        }
        return result.toString()
    }

    /**
     * Builds a preview summary for enumerated matches before applying replacements.
     */
    suspend fun preview(
        matches: List<QualifiedSearchMatch>,
        searchQuery: String,
        replaceQuery: String,
        caseSensitive: Boolean,
        isSearchTruncated: Boolean,
    ): ReplacePreviewSummary {
        val grouped = matches.groupBy { Triple(it.profileId, it.target, it.path) }
        val previews = mutableListOf<ReplaceFilePreview>()

        for ((key, fileMatches) in grouped) {
            val (profileId, target, path) = key
            val repo = repositoryProvider(profileId)
            val stat = try { repo?.stat(target, path) } catch (_: Throwable) { null }
            val dirty = isDirtyFile(target, path)

            previews.add(
                ReplaceFilePreview(
                    profileId = profileId,
                    target = target,
                    path = path,
                    matchCount = fileMatches.size,
                    currentMtime = stat?.mtime ?: 0L,
                    isDirtyBlocked = dirty,
                )
            )
        }

        return ReplacePreviewSummary(
            searchQuery = searchQuery,
            replaceQuery = replaceQuery,
            caseSensitive = caseSensitive,
            totalMatches = matches.size,
            files = previews,
            isSearchTruncated = isSearchTruncated,
        )
    }

    /**
     * Sequentially applies replacement to enumerated files using frozen search spec,
     * rechecking dirty state, verifying matches in current content, and using expected_mtime CAS.
     */
    suspend fun applyBatch(
        summary: ReplacePreviewSummary,
    ): ReplaceBatchResult {
        require(summary.searchQuery.isNotEmpty()) { "searchQuery cannot be empty" }
        require(!summary.isSearchTruncated) { "Cannot apply batch replace when search matches are truncated" }

        val outcomes = mutableListOf<ReplaceFileOutcome>()
        var replaced = 0
        var skippedDirty = 0
        var conflicts = 0
        var failures = 0

        for (file in summary.files) {
            coroutineContext.ensureActive()

            if (isDirtyFile(file.target, file.path) || file.isDirtyBlocked) {
                outcomes.add(ReplaceFileOutcome.SkippedDirty(file.path))
                skippedDirty++
                continue
            }

            val repo = repositoryProvider(file.profileId)
            if (repo == null) {
                outcomes.add(ReplaceFileOutcome.Failed(file.path, "Profile disconnected"))
                failures++
                continue
            }

            try {
                val readResult = repo.readFile(file.target, file.path)
                if (!readResult.ok || readResult.isBinary || readResult.textContent == null) {
                    outcomes.add(ReplaceFileOutcome.Failed(file.path, "Cannot read file or content is binary"))
                    failures++
                    continue
                }

                val currentContent = readResult.textContent
                val hasMatch = currentContent.indexOf(summary.searchQuery, ignoreCase = !summary.caseSensitive) >= 0
                if (!hasMatch) {
                    outcomes.add(ReplaceFileOutcome.Failed(file.path, "Match no longer present in file"))
                    failures++
                    continue
                }

                val newContent = replaceLiteral(
                    content = currentContent,
                    search = summary.searchQuery,
                    replacement = summary.replaceQuery,
                    ignoreCase = !summary.caseSensitive,
                )

                val expectedMtime = readResult.mtime ?: file.currentMtime
                val writeResult = repo.writeFile(file.target, file.path, newContent, expectedMtime)

                if (writeResult.ok) {
                    outcomes.add(ReplaceFileOutcome.Success(file.path, writeResult.newMtime ?: expectedMtime))
                    replaced++
                } else if (writeResult.conflict) {
                    outcomes.add(ReplaceFileOutcome.Conflict(file.path, writeResult.error ?: "File changed on server (CAS mismatch)"))
                    conflicts++
                } else {
                    outcomes.add(ReplaceFileOutcome.Failed(file.path, writeResult.error ?: "Write failed"))
                    failures++
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                outcomes.add(ReplaceFileOutcome.Failed(file.path, e.message ?: "Operation failed"))
                failures++
            }
        }

        return ReplaceBatchResult(
            replacedFilesCount = replaced,
            skippedDirtyCount = skippedDirty,
            conflictCount = conflicts,
            failureCount = failures,
            outcomes = outcomes,
        )
    }
}
