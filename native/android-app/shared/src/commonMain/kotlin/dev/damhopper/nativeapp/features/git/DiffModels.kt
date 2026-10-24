package dev.damhopper.nativeapp.features.git

import kotlinx.serialization.Serializable

/**
 * Wire model for file diff content returned by GET /api/git/{project}/diff/file
 * or GET /api/git/{project}/commit/{hash}/diff
 */
@Serializable
data class FileDiffContent(
    val path: String,
    val original: String? = null,
    val modified: String? = null,
    val language: String = "plaintext",
    val hunks: List<HunkInfo> = emptyList(),
    val lineChanges: List<GitLineChange> = emptyList(),
    val isBinary: Boolean = false,
)

/**
 * Line change range indicator returned from server git diff.
 */
@Serializable
data class GitLineChange(
    val kind: String, // "added" | "modified" | "deleted"
    val line: Int,
    val length: Int,
    val oldStart: Int,
    val oldLines: Int,
    val newStart: Int,
    val newLines: Int,
)

/**
 * Hunk summary metadata matching server HunkInfo.
 */
@Serializable
data class HunkInfo(
    val index: Int,
    val oldStart: Int,
    val oldLines: Int,
    val newStart: Int,
    val newLines: Int,
    val header: String = "",
)

/**
 * Presentation mode for diff viewing.
 */
enum class DiffLayoutMode {
    INLINE,
    SIDE_BY_SIDE,
}

/**
 * Classification of diff line content.
 */
enum class DiffLineType {
    UNCHANGED,
    ADDED,
    DELETED,
    MODIFIED,
    HEADER,
}

/**
 * Unified representation of a diff line/row for rendering.
 */
data class DiffRow(
    val oldLineNumber: Int? = null,
    val oldContent: String? = null,
    val oldType: DiffLineType = DiffLineType.UNCHANGED,
    val newLineNumber: Int? = null,
    val newContent: String? = null,
    val newType: DiffLineType = DiffLineType.UNCHANGED,
    val hunkIndex: Int? = null,
)

/**
 * Request payload for POST /api/git/{project}/discard-hunk
 */
@Serializable
data class DiscardHunkRequest(
    val path: String,
    val hunkIndex: Int,
    val worktreePath: String? = null,
    val root: String? = null,
)

/**
 * Query criteria for fetching diff content.
 */
data class FileDiffQuery(
    val path: String,
    val worktreePath: String? = null,
    val root: String? = null,
    val commitHash: String? = null,
)
