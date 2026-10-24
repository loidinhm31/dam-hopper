package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Controller for Git commit history, literal search filtering, pagination,
 * and view-level branch eligibility.
 */
class GitHistoryController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
) {
    private val _entries = MutableStateFlow<List<GitLogEntry>>(emptyList())
    val entries: StateFlow<List<GitLogEntry>> = _entries.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _selectedCommitDetails = MutableStateFlow<GitCommitDetails?>(null)
    val selectedCommitDetails: StateFlow<GitCommitDetails?> = _selectedCommitDetails.asStateFlow()

    private val _selectedCommitHashes = MutableStateFlow<List<String>>(emptyList())
    val selectedCommitHashes: StateFlow<List<String>> = _selectedCommitHashes.asStateFlow()

    private var activeJob: Job? = null

    var activeScope: GitOperationScope? = null
        private set

    var viewedBranch: GitBranch? = null
        private set

    var activeBranch: GitBranch? = null
        private set

    val isViewingLocalBranch: Boolean
        get() = viewedBranch?.isLocal == true && viewedBranch?.name?.isNotBlank() == true

    val isViewingActiveBranch: Boolean
        get() {
            val v = viewedBranch?.name ?: return false
            val a = activeBranch?.name ?: return false
            return v == a
        }

    fun updateScope(scope: GitOperationScope, viewed: GitBranch?, active: GitBranch?) {
        val scopeChanged = !scope.matches(activeScope)
        activeScope = scope
        viewedBranch = viewed
        activeBranch = active
        if (scopeChanged) {
            _selectedCommitHashes.value = emptyList()
            _selectedCommitDetails.value = null
            loadHistory(resetOffset = true)
        }
    }

    fun selectViewedBranch(branch: GitBranch) {
        viewedBranch = branch
        _selectedCommitHashes.value = emptyList()
        _selectedCommitDetails.value = null
        loadHistory(resetOffset = true)
    }

    fun setSearchQuery(query: String) {
        _searchQuery.value = query
        loadHistory(resetOffset = true)
    }

    fun loadHistory(resetOffset: Boolean = false): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        activeJob?.cancel()
        val job = coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val ref = viewedBranch?.name ?: "HEAD"
                val query = _searchQuery.value.takeIf { it.isNotBlank() }
                val result = repository.getLog(
                    project = scope.project,
                    worktreePath = scope.worktreePath,
                    limit = 100,
                    offset = if (resetOffset) 0 else _entries.value.size,
                    ref = ref,
                    messageQuery = query,
                    root = scope.root,
                )
                if (scope.matches(activeScope)) {
                    if (resetOffset) {
                        _entries.value = result
                    } else {
                        _entries.value = _entries.value + result
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Failed to load history"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
        activeJob = job
        return job
    }

    fun toggleCommitSelection(hash: String) {
        val current = _selectedCommitHashes.value.toMutableList()
        if (current.contains(hash)) current.remove(hash) else current.add(hash)
        _selectedCommitHashes.value = current
    }

    fun clearSelection() { _selectedCommitHashes.value = emptyList() }

    fun getSelectedCommitsOldestFirst(): List<String>? {
        val selected = _selectedCommitHashes.value
        if (selected.size < 2) return null
        val allEntries = _entries.value
        val indices = selected.map { hash -> allEntries.indexOfFirst { it.hash == hash } }
        if (indices.any { it == -1 }) return null
        val sortedIndices = indices.sorted()
        for (i in 0 until sortedIndices.size - 1) {
            if (sortedIndices[i + 1] != sortedIndices[i] + 1) return null // Non-contiguous
        }
        // allEntries is newest-first, so highest index is oldest commit
        return sortedIndices.reversed().map { allEntries[it].hash }
    }

    fun inspectCommit(hash: String): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        return coroutineScope.launch {
            try {
                val details = repository.query.getCommitDetails(
                    project = scope.project,
                    hash = hash,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                if (scope.matches(activeScope)) _selectedCommitDetails.value = details
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = "Failed to inspect commit: ${t.message}"
            }
        }
    }

    fun dismissCommitDetails() { _selectedCommitDetails.value = null }
}
