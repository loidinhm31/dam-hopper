package dev.damhopper.nativeapp.features.editor

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Maximum 5 MiB UTF-8 buffer threshold for blame operations */
const val GIT_BLAME_MAX_BUFFER_BYTES = 5L * 1024L * 1024L

/** Keystroke edit debounce threshold (250 ms) */
const val GIT_BLAME_DEBOUNCE_MS = 250L

/** Maximum number of retained completed blame attribution entries per cache */
const val BLAME_CACHE_MAX_ENTRIES = 64

/** Maximum total retained memory budget (32 MiB) for completed blame attributions */
const val BLAME_CACHE_MAX_BYTES = 32L * 1024L * 1024L

/**
 * Request payload for POST /api/git/{project}/blame
 */
@Serializable
data class GitBlameInput(
    val path: String,
    val worktreePath: String? = null,
    val content: String,
    val snapshotId: String,
    val modelVersion: Long,
)

/**
 * Commit metadata in Git blame response.
 */
@Serializable
data class GitBlameCommit(
    val hash: String,
    val authorName: String,
    val authorEmail: String,
    val authorTimestamp: Long,
    val authorTimezoneOffsetMinutes: Int,
    val subject: String,
)

/**
 * Line range attribution in Git blame response.
 */
@Serializable
data class GitBlameRange(
    val startLine: Int,
    val lineCount: Int,
    val commitIndex: Int? = null,
)

/**
 * Lifecycle status of Git blame attribution.
 */
@Serializable
enum class GitBlameStatus {
    @SerialName("ready")
    READY,

    @SerialName("uncommitted")
    UNCOMMITTED,

    @SerialName("empty")
    EMPTY,
}

/**
 * Response payload from POST /api/git/{project}/blame
 */
@Serializable
data class GitBlameResponse(
    val snapshotId: String,
    val modelVersion: Long,
    val rootId: String,
    val rootRelativePath: String,
    val baseCommitOid: String? = null,
    val bufferLineCount: Int,
    val status: GitBlameStatus,
    val ranges: List<GitBlameRange> = emptyList(),
    val commits: List<GitBlameCommit> = emptyList(),
)

/**
 * Derived per-line attribution for gutter rendering.
 */
data class BlameLineAttribution(
    val line: Int,
    val commit: GitBlameCommit?,
    val isUncommitted: Boolean,
)
