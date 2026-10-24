package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

class DiffReviewController(
    val apiClient: ApiClient,
    val targetStore: ProjectTargetStore? = null,
    val isDirtyBufferProvider: ((ProjectTargetRef, String) -> Boolean)? = null,
    private val coroutineScope: CoroutineScope,
) {
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
    private val _modifiedDraft = MutableStateFlow("")
    val modifiedDraft: StateFlow<String> = _modifiedDraft.asStateFlow()
    private val _isModifiedDirty = MutableStateFlow(false)
    val isModifiedDirty: StateFlow<Boolean> = _isModifiedDirty.asStateFlow()
    private val _isReadOnly = MutableStateFlow(false)
    val isReadOnly: StateFlow<Boolean> = _isReadOnly.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private var activeProjectName: String = ""
    private var activeTargetRef: ProjectTargetRef? = null
    private var loadDiffSeq: Long = 0L
    var baselineMtime: Long? = null

    fun loadDiff(project: String, target: ProjectTargetRef, path: String, commitHash: String? = null, root: String? = null) {
        activeProjectName = project
        activeTargetRef = target
        _activeQuery.value = FileDiffQuery(path = path, worktreePath = target.worktreePath, root = root, commitHash = commitHash)
        _isLoading.value = true
        _errorMessage.value = null
        val seq = ++loadDiffSeq

        coroutineScope.launch {
            try {
                val queryParams = mutableMapOf("path" to path, "project" to target.project)
                target.worktreePath?.let { queryParams["worktreePath"] = it }
                root?.let { queryParams["root"] = it }
                val fetchedMtime = if (commitHash == null) {
                    try {
                        val statJson = apiClient.get("/api/fs/stat", queryParams)
                        ProtocolJson.decodeFromString(dev.damhopper.nativeapp.features.files.FileStatDto.serializer(), statJson).mtime
                    } catch (_: Exception) { null }
                } else null
                val encoded = ApiClient.encodePathSegment(project)
                val url = if (commitHash != null) "/api/git/$encoded/commit/${ApiClient.encodePathSegment(commitHash)}/diff" else "/api/git/$encoded/diff/file"
                val content = ProtocolJson.decodeFromString(FileDiffContent.serializer(), apiClient.get(url, queryParams))
                if (seq == loadDiffSeq) {
                    baselineMtime = fetchedMtime
                    _diffContent.value = content
                    val baselineModified = content.modified ?: ""
                    _modifiedDraft.value = baselineModified
                    _isModifiedDirty.value = false
                    _isReadOnly.value = commitHash != null || (content.original != null && content.modified == null) || content.isBinary
                    recomputeRows(content.original, baselineModified, _layoutMode.value, content.hunks)
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (seq == loadDiffSeq) {
                    _errorMessage.value = e.message ?: "Failed to load diff"
                    _diffContent.value = null
                    _diffRows.value = emptyList()
                }
            } finally {
                if (seq == loadDiffSeq) _isLoading.value = false
            }
        }
    }

    fun exitCommitDiff() {
        val q = _activeQuery.value ?: return
        val target = activeTargetRef ?: return
        loadDiff(activeProjectName, target, q.path, commitHash = null, root = q.root)
    }

    fun setLayoutMode(mode: DiffLayoutMode) {
        if (_layoutMode.value != mode) {
            _layoutMode.value = mode
            recomputeRows(_diffContent.value?.original, _modifiedDraft.value, mode, _diffContent.value?.hunks ?: emptyList())
        }
    }

    fun updateModifiedDraft(newContent: String) {
        if (_isReadOnly.value) return
        _modifiedDraft.value = newContent
        _isModifiedDirty.value = newContent != (_diffContent.value?.modified ?: "")
        recomputeRows(_diffContent.value?.original, newContent, _layoutMode.value, _diffContent.value?.hunks ?: emptyList())
    }

    suspend fun discardHunk(hunkIndex: Int): Result<Unit> {
        val query = _activeQuery.value ?: return Result.failure(IllegalStateException("No active diff query"))
        val target = activeTargetRef ?: return Result.failure(IllegalStateException("No active target"))
        if (_isReadOnly.value) return Result.failure(IllegalStateException("Cannot discard hunk on read-only diff"))
        if (_isModifiedDirty.value) return Result.failure(IllegalStateException("Cannot discard hunk: unsaved local diff modifications present"))
        if (isDirtyBufferProvider?.invoke(target, query.path) == true) return Result.failure(IllegalStateException("Cannot discard hunk: file has unsaved in-memory editor changes"))

        return try {
            val encoded = ApiClient.encodePathSegment(activeProjectName)
            val serverHunks = _diffContent.value?.hunks ?: emptyList()
            val effectiveHunk = serverHunks.getOrNull(hunkIndex) ?: return Result.failure(IllegalStateException("Cannot revert unmapped hunk"))
            val req = DiscardHunkRequest(query.path, effectiveHunk.index, query.worktreePath, query.root)
            val body = ProtocolJson.encodeToString(DiscardHunkRequest.serializer(), req)
            val text = apiClient.postJson("/api/git/$encoded/discard-hunk", body)
            val ok = ProtocolJson.decodeFromString(JsonObject.serializer(), text)["ok"]?.jsonPrimitive?.booleanOrNull ?: true
            if (ok) {
                loadDiff(activeProjectName, target, query.path, query.commitHash, query.root)
                Result.success(Unit)
            } else Result.failure(RuntimeException("Server rejected hunk discard"))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            Result.failure(e)
        }
    }

    fun nextHunk() { if (_totalHunks.value > 0) _currentHunkIndex.value = (_currentHunkIndex.value + 1) % _totalHunks.value }
    fun prevHunk() { if (_totalHunks.value > 0) _currentHunkIndex.value = (_currentHunkIndex.value - 1 + _totalHunks.value) % _totalHunks.value }

    suspend fun saveModified(fileRepo: dev.damhopper.nativeapp.features.files.FileRepository): Result<Unit> {
        val query = _activeQuery.value ?: return Result.failure(IllegalStateException("No active diff query"))
        val target = activeTargetRef ?: return Result.failure(IllegalStateException("No active target"))
        if (_isReadOnly.value || !_isModifiedDirty.value) return Result.success(Unit)
        val snapshotText = _modifiedDraft.value
        val expectedMtime = baselineMtime ?: return Result.failure(IllegalStateException("Cannot save: missing baseline file mtime."))
        return try {
            val res = fileRepo.writeFile(target, query.path, snapshotText, expectedMtime)
            if (res.conflict) return Result.failure(IllegalStateException("Save conflict: file was modified on server."))
            if (res.ok) {
                baselineMtime = res.newMtime ?: baselineMtime
                _diffContent.value = _diffContent.value?.copy(modified = snapshotText)
                _isModifiedDirty.value = (_modifiedDraft.value != snapshotText)
                loadDiff(activeProjectName, target, query.path, query.commitHash, query.root)
                Result.success(Unit)
            } else Result.failure(RuntimeException(res.error ?: "Failed to save"))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            Result.failure(e)
        }
    }

    private fun recomputeRows(original: String?, modified: String?, mode: DiffLayoutMode, serverHunks: List<HunkInfo> = emptyList()) {
        coroutineScope.launch(Dispatchers.Default) {
            val rows = DiffCalculator.computeDiffRows(original, modified, mode, serverHunks)
            _diffRows.value = rows
            val count = if (serverHunks.isNotEmpty()) serverHunks.size else (rows.mapNotNull { it.hunkIndex }.distinct().size)
            _totalHunks.value = count
            if (_currentHunkIndex.value >= count) _currentHunkIndex.value = maxOf(0, count - 1)
        }
    }
}
