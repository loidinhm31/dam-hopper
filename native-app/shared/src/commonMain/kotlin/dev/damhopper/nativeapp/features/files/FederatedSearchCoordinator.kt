package dev.damhopper.nativeapp.features.files

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * Executes parallel, federated searches across all connected profiles,
 * capping matches to 500 and isolating individual profile errors.
 */
class FederatedSearchCoordinator(
    private val repository: SearchRepository,
) {
    suspend fun federateContentSearch(
        bindings: List<ProfileTargetBinding>,
        query: String,
        caseSensitive: Boolean = false,
        maxAggregate: Int = SearchRepository.MAX_FEDERATED_CAP,
        scope: SearchScope = SearchScope.PROJECT,
    ): FederatedSearchResult = coroutineScope {
        if (query.isBlank() || bindings.isEmpty()) {
            return@coroutineScope FederatedSearchResult(
                query = query,
                matches = emptyList(),
                isTruncated = false,
                profileCount = bindings.size,
            )
        }

        val deferredResults = bindings.map { binding ->
            async {
                try {
                    val result = repository.searchContent(
                        apiClient = binding.apiClient,
                        target = binding.target,
                        query = query,
                        caseSensitive = caseSensitive,
                        maxResults = maxAggregate,
                        scope = scope,
                    )
                    Result.success(Pair(binding, result))
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    Result.failure(e)
                }
            }
        }

        val allMatches = mutableListOf<QualifiedSearchMatch>()
        val partialFailures = mutableListOf<String>()
        var anyServerTruncated = false

        for ((index, deferred) in deferredResults.withIndex()) {
            val outcome = deferred.await()
            val binding = bindings[index]

            outcome.fold(
                onSuccess = { (_, response) ->
                    if (response.truncated) anyServerTruncated = true
                    for (m in response.matches) {
                        val matchTarget = if (scope == SearchScope.WORKSPACE && m.project != null) {
                            binding.target.copy(project = m.project, worktreePath = null)
                        } else {
                            binding.target
                        }
                        allMatches.add(
                            QualifiedSearchMatch(
                                profileId = binding.profileId,
                                target = matchTarget,
                                path = m.path,
                                line = m.line,
                                col = m.col,
                                text = m.text,
                            )
                        )
                    }
                },
                onFailure = { error ->
                    partialFailures.add("${binding.profileId}: ${error.message ?: "Search failed"}")
                }
            )
        }

        val isCapExceeded = allMatches.size > maxAggregate
        val cappedMatches = if (isCapExceeded) allMatches.take(maxAggregate) else allMatches

        FederatedSearchResult(
            query = query,
            caseSensitive = caseSensitive,
            scope = scope.name,
            matches = cappedMatches,
            isTruncated = anyServerTruncated || isCapExceeded,
            profileCount = bindings.size,
            partialFailures = partialFailures,
        )
    }

    suspend fun federatePathSearch(
        bindings: List<ProfileTargetBinding>,
        query: String,
        caseSensitive: Boolean = false,
        maxAggregate: Int = SearchRepository.MAX_FEDERATED_CAP,
        scope: SearchScope = SearchScope.PROJECT,
    ): FederatedPathResult = coroutineScope {
        if (query.isBlank() || bindings.isEmpty()) {
            return@coroutineScope FederatedPathResult(
                query = query,
                matches = emptyList(),
                isTruncated = false,
                profileCount = bindings.size,
            )
        }

        val deferredResults = bindings.map { binding ->
            async {
                try {
                    val result = repository.searchPaths(
                        apiClient = binding.apiClient,
                        target = binding.target,
                        query = query,
                        caseSensitive = caseSensitive,
                        maxResults = maxAggregate,
                        scope = scope,
                    )
                    Result.success(Pair(binding, result))
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    Result.failure(e)
                }
            }
        }

        val allMatches = mutableListOf<QualifiedPathMatch>()
        val partialFailures = mutableListOf<String>()
        var anyServerTruncated = false

        for ((index, deferred) in deferredResults.withIndex()) {
            val outcome = deferred.await()
            val binding = bindings[index]

            outcome.fold(
                onSuccess = { (_, response) ->
                    if (response.truncated) anyServerTruncated = true
                    for (m in response.matches) {
                        val matchTarget = if (scope == SearchScope.WORKSPACE && m.project != null) {
                            binding.target.copy(project = m.project, worktreePath = null)
                        } else {
                            binding.target
                        }
                        allMatches.add(
                            QualifiedPathMatch(
                                profileId = binding.profileId,
                                target = matchTarget,
                                path = m.path,
                            )
                        )
                    }
                },
                onFailure = { error ->
                    partialFailures.add("${binding.profileId}: ${error.message ?: "Path search failed"}")
                }
            )
        }

        val isCapExceeded = allMatches.size > maxAggregate
        val cappedMatches = if (isCapExceeded) allMatches.take(maxAggregate) else allMatches

        FederatedPathResult(
            query = query,
            matches = cappedMatches,
            isTruncated = anyServerTruncated || isCapExceeded,
            profileCount = bindings.size,
            partialFailures = partialFailures,
        )
    }
}
