package dev.damhopper.nativeapp.features.git

import kotlinx.serialization.Serializable

/**
 * File with unresolved conflict markers from GET /api/git/{project}/conflicts
 */
@Serializable
data class ConflictFile(
    val path: String,
    val ancestor: String? = null,
    val ours: String? = null,
    val theirs: String? = null,
)

/**
 * Request payload for POST /api/git/{project}/resolve
 */
@Serializable
data class ResolveConflictRequest(
    val path: String,
    val content: String,
    val worktreePath: String? = null,
    val root: String? = null,
)

/**
 * Parsed git conflict region within in-memory buffer.
 * Supports standard 2-way (<<<<<<<, =======, >>>>>>>) and 3-way/diff3 (<<<<<<<, |||||||, =======, >>>>>>>).
 */
data class ConflictRegion(
    val index: Int,
    val startLine: Int, // 1-based line of <<<<<<<
    val ancestorLine: Int? = null, // 1-based line of ||||||| if diff3
    val separatorLine: Int, // 1-based line of =======
    val endLine: Int, // 1-based line of >>>>>>>
    val oursContent: String,
    val ancestorContent: String? = null,
    val theirsContent: String,
    val markerWidth: Int = 7,
    val ourLabel: String = "",
    val ancestorLabel: String? = null,
    val theirLabel: String = "",
)

/**
 * Side selection when resolving an individual conflict region or all regions.
 */
enum class ConflictSide {
    OURS,
    THEIRS,
    ANCESTOR,
    BOTH_OURS_FIRST,
    BOTH_THEIRS_FIRST,
}
