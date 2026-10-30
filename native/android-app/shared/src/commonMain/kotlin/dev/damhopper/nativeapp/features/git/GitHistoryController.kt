package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
    private var searchDebounceJob: Job? = null
    private var requestSequence: Long = 0L
    private var detailsSequence: Long = 0L
    private var rawOffset: Int = 0

    private var _lastRequestIdentity: GitRequestIdentity? = null
    val lastRequestIdentity: GitRequestIdentity? get() = _lastRequestIdentity
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
            val v = viewedBranch?.fullRef ?: viewedBranch?.name ?: return false
            val a = activeBranch?.fullRef ?: activeBranch?.name ?: return false
            return v == a
        }

    fun updateScope(scope: GitOperationScope, viewed: GitBranch?, active: GitBranch?) {
        val scopeChanged = !scope.matches(activeScope)
        val viewedChanged = (viewedBranch?.fullRef ?: viewedBranch?.name) != (viewed?.fullRef ?: viewed?.name)
        searchDebounceJob?.cancel()
        activeScope = scope
        viewedBranch = viewed
        activeBranch = active
        if (scopeChanged || viewedChanged) {
            _selectedCommitHashes.value = emptyList()
            _selectedCommitDetails.value = null
            loadHistory(resetOffset = true)
        }
    }

    fun revoke() {
        activeJob?.cancel()
        activeJob = null
        searchDebounceJob?.cancel()
        searchDebounceJob = null
        activeScope = null
        viewedBranch = null
        activeBranch = null
        _entries.value = emptyList()
        _error.value = null
        _isLoading.value = false
        _searchQuery.value = ""
        _selectedCommitDetails.value = null
        _selectedCommitHashes.value = emptyList()
        _lastRequestIdentity = null
    }

    fun selectViewedBranch(branch: GitBranch) {
        searchDebounceJob?.cancel()
        viewedBranch = branch
        _selectedCommitHashes.value = emptyList()
        _selectedCommitDetails.value = null
        loadHistory(resetOffset = true)
    }

    fun setSearchQuery(query: String): Job {
        _searchQuery.value = query
        _selectedCommitHashes.value = emptyList()
        _selectedCommitDetails.value = null
        searchDebounceJob?.cancel()
        val job = coroutineScope.launch {
            delay(300)
            loadHistory(resetOffset = true)
        }
        searchDebounceJob = job
        return job
    }

    fun loadHistory(resetOffset: Boolean = false): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        activeJob?.cancel()
        val currentSeq = ++requestSequence
        val ref = viewedBranch?.fullRef ?: viewedBranch?.name ?: "HEAD"
        val query = _searchQuery.value.trim().takeIf { it.isNotBlank() }
        val isReset = resetOffset || _entries.value.isEmpty()
        if (isReset) {
            rawOffset = 0
        }
        val offsetToRequest = if (isReset) 0 else rawOffset
        val identity = GitRequestIdentity(
            owner = scope.owner,
            generation = scope.generation,
            root = scope.root,
            ref = ref,
            search = query ?: "",
            offset = offsetToRequest,
            sequence = currentSeq,
        )
        _lastRequestIdentity = identity

        val job = coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                if (!isReset && _entries.value.isNotEmpty()) {
                    val tipLog = repository.getLog(
                        project = scope.project,
                        worktreePath = scope.worktreePath,
                        limit = 1,
                        offset = 0,
                        ref = ref,
                        messageQuery = null,
                        root = scope.root,
                    )
                    if (!scope.matches(activeScope) || currentSeq != requestSequence) return@launch
                    val currentTipHash = _entries.value.firstOrNull()?.hash
                    val observedTipHash = tipLog.firstOrNull()?.hash
                    if (observedTipHash != null && currentTipHash != null && observedTipHash != currentTipHash) {
                        _selectedCommitHashes.value = emptyList()
                        rawOffset = 0
                        val resetResult = repository.getLog(
                            project = scope.project,
                            worktreePath = scope.worktreePath,
                            limit = 100,
                            offset = 0,
                            ref = ref,
                            messageQuery = query,
                            root = scope.root,
                        )
                        if (scope.matches(activeScope) && currentSeq == requestSequence) {
                            rawOffset = resetResult.size
                            _entries.value = resetResult.distinctBy { it.hash }
                        }
                        return@launch
                    }
                }
                val result = repository.getLog(
                    project = scope.project,
                    worktreePath = scope.worktreePath,
                    limit = 100,
                    offset = offsetToRequest,
                    ref = ref,
                    messageQuery = query,
                    root = scope.root,
                )
                if (scope.matches(activeScope) && currentSeq == requestSequence) {
                    rawOffset += result.size
                    if (isReset) {
                        _entries.value = result.distinctBy { it.hash }
                    } else {
                        val existing = _entries.value.map { it.hash }.toSet()
                        _entries.value = _entries.value + result.filter { it.hash !in existing }
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope) && currentSeq == requestSequence) {
                    _error.value = t.message ?: "Failed to load history"
                }
            } finally {
                if (scope.matches(activeScope) && currentSeq == requestSequence) {
                    _isLoading.value = false
                }
            }
        }
        activeJob = job
        return job
    }

    fun toggleCommitSelection(hash: String) {
        if (_searchQuery.value.isNotBlank()) return
        val current = _selectedCommitHashes.value.toMutableList()
        if (current.contains(hash)) current.remove(hash) else current.add(hash)
        _selectedCommitHashes.value = current
    }

    fun clearSelection() { _selectedCommitHashes.value = emptyList() }

    fun getSelectedCommitsOldestFirst(): List<String>? {
        if (_searchQuery.value.isNotBlank()) return null
        val selected = _selectedCommitHashes.value
        if (selected.size < 2) return null
        val entriesMap = _entries.value.associateBy { it.hash }
        val selectedEntries = selected.map { entriesMap[it] ?: return null }
        if (selectedEntries.any { it.parents.size > 1 }) return null
        val selectedSet = selected.toSet()
        val parentOf = mutableMapOf<String, String>()
        val childOf = mutableMapOf<String, String>()
        for (entry in selectedEntries) {
            val p = entry.parents.firstOrNull()
            if (p != null && p in selectedSet) {
                parentOf[entry.hash] = p
                if (childOf.containsKey(p)) return null
                childOf[p] = entry.hash
            }
        }
        val roots = selectedSet.filter { it !in parentOf }
        if (roots.size != 1) return null
        val oldest = roots.first()
        val chain = mutableListOf<String>()
        var curr: String? = oldest
        while (curr != null) {
            chain.add(curr)
            curr = childOf[curr]
        }
        if (chain.size != selectedSet.size) return null
        return chain
    }

    fun inspectCommit(hash: String): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        val currentSeq = ++detailsSequence
        return coroutineScope.launch {
            try {
                val details = repository.query.getCommitDetails(
                    project = scope.project,
                    hash = hash,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                if (scope.matches(activeScope) && currentSeq == detailsSequence) {
                    _selectedCommitDetails.value = details
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope) && currentSeq == detailsSequence) {
                    _error.value = "Failed to inspect commit: ${t.message}"
                }
            }
        }
    }

    fun dismissCommitDetails() {
        detailsSequence++
        _selectedCommitDetails.value = null
    }
}
