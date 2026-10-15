package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson

/**
 * Scope for text and path search operations.
 */
enum class SearchScope {
    PROJECT,
    WORKSPACE,
}

/**
 * Encapsulates an active profile, its ApiClient, and current project target.
 */
data class ProfileTargetBinding(
    val profileId: String,
    val apiClient: ApiClient,
    val target: ProjectTargetRef,
)

/**
 * Client repository for text content and filename/path search operations,
 * supporting project/workspace scoping and multi-profile federation with 500-match caps.
 */
class SearchRepository {

    companion object {
        const val DEFAULT_MAX_MATCHES = 200
        const val MAX_FEDERATED_CAP = 500
    }

    private val federatedCoordinator = FederatedSearchCoordinator(this)

    /**
     * Executes text content search over GET /api/fs/search for a single target.
     */
    suspend fun searchContent(
        apiClient: ApiClient,
        target: ProjectTargetRef,
        query: String,
        caseSensitive: Boolean = false,
        maxResults: Int = DEFAULT_MAX_MATCHES,
        scope: SearchScope = SearchScope.PROJECT,
    ): SearchResponseDto {
        val queryParams = mutableMapOf(
            "q" to query,
            "case" to caseSensitive.toString(),
            "max" to maxResults.toString(),
        )

        if (scope == SearchScope.WORKSPACE) {
            queryParams["scope"] = "workspace"
        } else {
            queryParams["project"] = target.project
            target.worktreePath?.let { queryParams["worktreePath"] = it }
        }

        val json = apiClient.get("/api/fs/search", queryParams)
        return ProtocolJson.decodeFromString(SearchResponseDto.serializer(), json)
    }

    /**
     * Executes path/filename search over GET /api/fs/search-paths for a single target.
     */
    suspend fun searchPaths(
        apiClient: ApiClient,
        target: ProjectTargetRef,
        query: String,
        caseSensitive: Boolean = false,
        maxResults: Int = DEFAULT_MAX_MATCHES,
        scope: SearchScope = SearchScope.PROJECT,
    ): PathSearchResponseDto {
        val queryParams = mutableMapOf(
            "q" to query,
            "case" to caseSensitive.toString(),
            "max" to maxResults.toString(),
        )

        if (scope == SearchScope.WORKSPACE) {
            queryParams["scope"] = "workspace"
        } else {
            queryParams["project"] = target.project
            target.worktreePath?.let { queryParams["worktreePath"] = it }
        }

        val json = apiClient.get("/api/fs/search-paths", queryParams)
        return ProtocolJson.decodeFromString(PathSearchResponseDto.serializer(), json)
    }

    suspend fun federateContentSearch(
        bindings: List<ProfileTargetBinding>,
        query: String,
        caseSensitive: Boolean = false,
        maxAggregate: Int = MAX_FEDERATED_CAP,
        scope: SearchScope = SearchScope.PROJECT,
    ): FederatedSearchResult {
        return federatedCoordinator.federateContentSearch(bindings, query, caseSensitive, maxAggregate, scope)
    }

    suspend fun federatePathSearch(
        bindings: List<ProfileTargetBinding>,
        query: String,
        caseSensitive: Boolean = false,
        maxAggregate: Int = MAX_FEDERATED_CAP,
        scope: SearchScope = SearchScope.PROJECT,
    ): FederatedPathResult {
        return federatedCoordinator.federatePathSearch(bindings, query, caseSensitive, maxAggregate, scope)
    }
}
