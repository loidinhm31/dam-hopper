package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef

/**
 * Preview summary for a single file affected by replacement.
 */
data class ReplaceFilePreview(
    val profileId: String,
    val target: ProjectTargetRef,
    val path: String,
    val matchCount: Int,
    val currentMtime: Long,
    val isDirtyBlocked: Boolean,
)

/**
 * Aggregate preview for bulk replace.
 */
data class ReplacePreviewSummary(
    val searchQuery: String,
    val replaceQuery: String,
    val caseSensitive: Boolean,
    val totalMatches: Int,
    val files: List<ReplaceFilePreview>,
    val isSearchTruncated: Boolean,
)

/**
 * Individual file outcome during replace application.
 */
sealed class ReplaceFileOutcome {
    abstract val path: String

    data class Success(override val path: String, val newMtime: Long) : ReplaceFileOutcome()
    data class Conflict(override val path: String, val error: String) : ReplaceFileOutcome()
    data class SkippedDirty(override val path: String) : ReplaceFileOutcome()
    data class Failed(override val path: String, val message: String) : ReplaceFileOutcome()
}

/**
 * Batch result after applying replacement across enumerated files.
 */
data class ReplaceBatchResult(
    val replacedFilesCount: Int,
    val skippedDirtyCount: Int,
    val conflictCount: Int,
    val failureCount: Int,
    val outcomes: List<ReplaceFileOutcome>,
)
