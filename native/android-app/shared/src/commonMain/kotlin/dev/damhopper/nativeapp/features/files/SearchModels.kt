package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.serialization.Serializable

/**
 * Text search match DTO matching GET /api/fs/search.
 */
@Serializable
data class SearchMatchDto(
    val path: String,
    val line: ULong,
    val col: ULong,
    val text: String,
    val project: String? = null,
)

/**
 * Path search match DTO matching GET /api/fs/search-paths.
 */
@Serializable
data class PathSearchMatchDto(
    val path: String,
    val project: String? = null,
)

/**
 * Search response DTO for GET /api/fs/search.
 */
@Serializable
data class SearchResponseDto(
    val query: String,
    val matches: List<SearchMatchDto> = emptyList(),
    val truncated: Boolean = false,
)

/**
 * Path search response DTO for GET /api/fs/search-paths.
 */
@Serializable
data class PathSearchResponseDto(
    val query: String,
    val matches: List<PathSearchMatchDto> = emptyList(),
    val truncated: Boolean = false,
)

/**
 * Target-qualified search match for federated multi-profile results.
 */
data class QualifiedSearchMatch(
    val profileId: String,
    val target: ProjectTargetRef,
    val path: String,
    val line: ULong,
    val col: ULong,
    val text: String,
)

/**
 * Target-qualified path match for federated multi-profile results.
 */
data class QualifiedPathMatch(
    val profileId: String,
    val target: ProjectTargetRef,
    val path: String,
)

/**
 * Aggregate search result across one or more profiles.
 */
data class FederatedSearchResult(
    val query: String,
    val caseSensitive: Boolean = false,
    val scope: String = "project",
    val matches: List<QualifiedSearchMatch>,
    val isTruncated: Boolean,
    val profileCount: Int,
    val partialFailures: List<String> = emptyList(),
)

/**
 * Aggregate path search result across one or more profiles.
 */
data class FederatedPathResult(
    val query: String,
    val matches: List<QualifiedPathMatch>,
    val isTruncated: Boolean,
    val profileCount: Int,
    val partialFailures: List<String> = emptyList(),
)
