package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Pure read-only controller for Git diff review.
 *
 * Discard-hunk and inline buffer modifications are not supported; the editor
 * is the sole writable authority.
 */
class DiffReviewController(
    val apiClient: ApiClient,
    private val coroutineScope: CoroutineScope,
) {
    private val _activeScope = MutableStateFlow<GitOperationScope?>(null)
    val activeScope: StateFlow<GitOperationScope?> = _activeScope.asStateFlow()

    private val _activeQuery = MutableStateFlow<FileDiffQuery?>(null)
    val activeQuery: StateFlow<FileDiffQuery?> = _activeQuery.asStateFlow()

    private val _diffContent = MutableStateFlow<FileDiffContent?>(null)
    val diffContent: StateFlow<FileDiffContent?> = _diffContent.asStateFlow()

    private val _layoutMode = MutableStateFlow(DiffLayoutMode.SIDE_BY_SIDE)
    val layoutMode: StateFlow<DiffLayoutMode> = _layoutMode.asStateFlow()

    private val _currentHunkIndex = MutableStateFlow(0)
    val currentHunkIndex: StateFlow<Int> = _currentHunkIndex.asStateFlow()

    private val _totalHunks = MutableStateFlow(0)
    val totalHunks: StateFlow<Int> = _totalHunks.asStateFlow()

    private val _diffRows = MutableStateFlow<List<DiffRow>>(emptyList())
    val diffRows: StateFlow<List<DiffRow>> = _diffRows.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private var loadDiffSeq: Long = 0L
    private var layoutSeq: Long = 0L
    private var activeJob: Job? = null

    fun loadDiff(scope: GitOperationScope, path: String, commitHash: String? = null): Job {
        _activeScope.value = scope
        _activeQuery.value = FileDiffQuery(
            path = path,
            worktreePath = scope.worktreePath,
            root = scope.root,
            commitHash = commitHash,
        )
        _isLoading.value = true
        _errorMessage.value = null
        val seq = ++loadDiffSeq

        activeJob?.cancel()
        val job = coroutineScope.launch {
            try {
                val queryParams = mutableMapOf("path" to path)
                scope.worktreePath?.let { queryParams["worktreePath"] = it }
                scope.root?.let { queryParams["root"] = it }

                val encodedProject = ApiClient.encodePathSegment(scope.project)
                val url = if (commitHash != null) {
                    val encodedHash = ApiClient.encodePathSegment(commitHash)
                    "/api/git/$encodedProject/commit/$encodedHash/diff"
                } else {
                    "/api/git/$encodedProject/diff/file"
                }

                val responseText = apiClient.get(url, queryParams)
                val content = ProtocolJson.decodeFromString(FileDiffContent.serializer(), responseText)

                if (seq == loadDiffSeq && scope.matches(_activeScope.value)) {
                    _diffContent.value = content
                    recomputeRows(content.original, content.modified, _layoutMode.value, content.hunks, seq).join()
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (seq == loadDiffSeq && scope.matches(_activeScope.value)) {
                    _errorMessage.value = t.message ?: "Failed to load diff"
                    _diffContent.value = null
                    _diffRows.value = emptyList()
                    _totalHunks.value = 0
                    _currentHunkIndex.value = 0
                }
            } finally {
                if (seq == loadDiffSeq && scope.matches(_activeScope.value)) {
                    _isLoading.value = false
                }
            }
        }
        activeJob = job
        return job
    }

    fun exitCommitDiff(): Job? {
        val q = _activeQuery.value ?: return null
        val scope = _activeScope.value ?: return null
        if (q.commitHash == null) return null
        return loadDiff(scope, q.path, commitHash = null)
    }
    fun clearScope() {
        _activeScope.value = null
        _activeQuery.value = null
        _diffContent.value = null
        _diffRows.value = emptyList()
        _totalHunks.value = 0
        _currentHunkIndex.value = 0
        _errorMessage.value = null
        _isLoading.value = false
        activeJob?.cancel()
    }


    fun setLayoutMode(mode: DiffLayoutMode): Job? {
        if (_layoutMode.value != mode) {
            _layoutMode.value = mode
            val content = _diffContent.value
            val seq = loadDiffSeq
            return recomputeRows(content?.original, content?.modified, mode, content?.hunks ?: emptyList(), seq)
        }
        return null
    }

    fun nextHunk() {
        if (_totalHunks.value > 0) {
            _currentHunkIndex.value = (_currentHunkIndex.value + 1) % _totalHunks.value
        }
    }

    fun prevHunk() {
        if (_totalHunks.value > 0) {
            _currentHunkIndex.value = (_currentHunkIndex.value - 1 + _totalHunks.value) % _totalHunks.value
        }
    }

    private fun recomputeRows(
        original: String?,
        modified: String?,
        mode: DiffLayoutMode,
        serverHunks: List<HunkInfo> = emptyList(),
        expectedSeq: Long,
    ): Job {
        val currentLayoutSeq = ++layoutSeq
        return coroutineScope.launch(Dispatchers.Default) {
            val rows = DiffCalculator.computeDiffRows(original, modified, mode, serverHunks)
            if (expectedSeq == loadDiffSeq && currentLayoutSeq == layoutSeq) {
                _diffRows.value = rows
                val count = if (serverHunks.isNotEmpty()) {
                    serverHunks.size
                } else {
                    rows.mapNotNull { it.hunkIndex }.distinct().size
                }
                _totalHunks.value = count
                if (_currentHunkIndex.value >= count) {
                    _currentHunkIndex.value = maxOf(0, count - 1)
                }
            }
        }
    }
}
