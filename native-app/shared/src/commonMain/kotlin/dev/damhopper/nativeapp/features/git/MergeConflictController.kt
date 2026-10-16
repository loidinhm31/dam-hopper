package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

class MergeConflictController(
    val apiClient: ApiClient,
    val targetStore: ProjectTargetStore? = null,
    private val coroutineScope: CoroutineScope,
) {
    private val _conflictFiles = MutableStateFlow<List<ConflictFile>>(emptyList())
    val conflictFiles: StateFlow<List<ConflictFile>> = _conflictFiles.asStateFlow()
    private val _selectedFile = MutableStateFlow<ConflictFile?>(null)
    val selectedFile: StateFlow<ConflictFile?> = _selectedFile.asStateFlow()
    private val _currentRegions = MutableStateFlow<List<ConflictRegion>>(emptyList())
    val currentRegions: StateFlow<List<ConflictRegion>> = _currentRegions.asStateFlow()
    private val _selectedConflictIndex = MutableStateFlow(0)
    val selectedConflictIndex: StateFlow<Int> = _selectedConflictIndex.asStateFlow()
    private val _resultContent = MutableStateFlow("")
    val resultContent: StateFlow<String> = _resultContent.asStateFlow()
    private val _originalWorkdirContent = MutableStateFlow("")
    val originalWorkdirContent: StateFlow<String> = _originalWorkdirContent.asStateFlow()
    private val _theirsContent = MutableStateFlow("")
    val theirsContent: StateFlow<String> = _theirsContent.asStateFlow()
    private val _oursContent = MutableStateFlow("")
    val oursContent: StateFlow<String> = _oursContent.asStateFlow()
    private val _ancestorContent = MutableStateFlow<String?>(null)
    val ancestorContent: StateFlow<String?> = _ancestorContent.asStateFlow()
    private val _isResultDirty = MutableStateFlow(false)
    val isResultDirty: StateFlow<Boolean> = _isResultDirty.asStateFlow()
    private val _allResolved = MutableStateFlow(false)
    val allResolved: StateFlow<Boolean> = _allResolved.asStateFlow()
    private val _isMalformed = MutableStateFlow(false)
    val isMalformed: StateFlow<Boolean> = _isMalformed.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _isResolving = MutableStateFlow(false)
    val isResolving: StateFlow<Boolean> = _isResolving.asStateFlow()
    private val _resolveError = MutableStateFlow<String?>(null)
    val resolveError: StateFlow<String?> = _resolveError.asStateFlow()
    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()
    private var activeProject: String = ""
    private var activeTarget: ProjectTargetRef? = null
    private var activeRoot: String? = null
    private var selectSeq: Long = 0L
    private var loadConflictsSeq: Long = 0L

    fun loadConflicts(project: String, target: ProjectTargetRef, root: String? = null) {
        activeProject = project
        activeTarget = target
        activeRoot = root
        _isLoading.value = true
        _errorMessage.value = null
        val seq = ++loadConflictsSeq
        coroutineScope.launch {
            try {
                val encoded = ApiClient.encodePathSegment(project)
                val params = mutableMapOf<String, String>()
                target.worktreePath?.let { params["worktreePath"] = it }
                root?.let { params["root"] = it }
                val text = apiClient.get("/api/git/$encoded/conflicts", params)
                val files = ProtocolJson.decodeFromString(ListSerializer(ConflictFile.serializer()), text)
                if (seq == loadConflictsSeq) {
                    _conflictFiles.value = files
                    if (files.isNotEmpty() && (_selectedFile.value == null || files.none { it.path == _selectedFile.value?.path })) {
                        selectFile(files.first(), project, target, root)
                    } else if (files.isEmpty()) {
                        _selectedFile.value = null; resetBufferState()
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (seq == loadConflictsSeq) {
                    _errorMessage.value = e.message ?: "Failed to load conflicts"
                    _conflictFiles.value = emptyList()
                }
            } finally {
                if (seq == loadConflictsSeq) _isLoading.value = false
            }
        }
    }

    fun selectFile(file: ConflictFile, project: String = activeProject, target: ProjectTargetRef? = activeTarget, root: String? = activeRoot) {
        val tgt = target ?: activeTarget ?: ProjectTargetRef(project = project)
        activeProject = project
        activeTarget = tgt
        activeRoot = root
        _selectedFile.value = file
        _isLoading.value = true
        _resolveError.value = null
        resetBufferState()
        val seq = ++selectSeq
        coroutineScope.launch {
            try {
                val encoded = ApiClient.encodePathSegment(project)
                val params = mutableMapOf("path" to file.path)
                tgt.worktreePath?.let { params["worktreePath"] = it }
                root?.let { params["root"] = it }
                val text = apiClient.get("/api/git/$encoded/diff/file", params)
                val diff = ProtocolJson.decodeFromString(FileDiffContent.serializer(), text)
                val workdir = diff.modified ?: ""
                if (seq == selectSeq) {
                    _originalWorkdirContent.value = workdir
                    _theirsContent.value = file.theirs ?: diff.original ?: ""
                    _oursContent.value = file.ours ?: ""
                    _ancestorContent.value = file.ancestor
                    applyNewResultContent(workdir, isBaseline = true)
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (seq == selectSeq) _errorMessage.value = e.message ?: "Failed to load file content"
            } finally {
                if (seq == selectSeq) _isLoading.value = false
            }
        }
    }

    fun acceptCurrentConflict(side: ConflictSide) {
        val region = _currentRegions.value.getOrNull(_selectedConflictIndex.value) ?: return
        val next = ConflictParser.acceptConflict(_resultContent.value, region, side)
        applyNewResultContent(next, isBaseline = false)
        val count = _currentRegions.value.size
        _selectedConflictIndex.value = if (count > 0) minOf(_selectedConflictIndex.value, count - 1) else 0
    }

    fun acceptAllConflicts(side: ConflictSide) {
        val next = ConflictParser.acceptAll(_resultContent.value, side)
        applyNewResultContent(next, isBaseline = false)
        _selectedConflictIndex.value = 0
    }

    fun selectConflictIndex(index: Int) {
        val count = _currentRegions.value.size
        if (count > 0) _selectedConflictIndex.value = index.coerceIn(0, count - 1)
    }
    fun updateResultContent(newContent: String) = applyNewResultContent(newContent, isBaseline = false)

    suspend fun markResolved(): Result<Unit> {
        val file = _selectedFile.value ?: return Result.failure(IllegalStateException("No file selected"))
        val target = activeTarget ?: return Result.failure(IllegalStateException("No target active"))
        if (_isLoading.value || _isResolving.value) return Result.failure(IllegalStateException("Already resolving or loading"))
        if (!_allResolved.value) return Result.failure(IllegalStateException("Remaining unresolved conflict markers"))
        if (_isMalformed.value) return Result.failure(IllegalStateException("Malformed conflict markers"))
        _isResolving.value = true
        _resolveError.value = null
        return try {
            val encoded = ApiClient.encodePathSegment(activeProject)
            val req = ResolveConflictRequest(file.path, _resultContent.value, target.worktreePath, activeRoot)
            val body = ProtocolJson.encodeToString(ResolveConflictRequest.serializer(), req)
            val text = apiClient.postJson("/api/git/$encoded/resolve", body)
            val ok = ProtocolJson.decodeFromString(JsonObject.serializer(), text)["ok"]?.jsonPrimitive?.booleanOrNull ?: true
            if (ok) {
                loadConflicts(activeProject, target, activeRoot)
                Result.success(Unit)
            } else {
                val err = "Server rejected conflict resolution"
                _resolveError.value = err
                Result.failure(RuntimeException(err))
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            val msg = e.message ?: "Failed to resolve conflict"
            _resolveError.value = msg
            Result.failure(e)
        } finally {
            _isResolving.value = false
        }
    }

    private fun applyNewResultContent(content: String, isBaseline: Boolean) {
        _resultContent.value = content
        _isResultDirty.value = if (isBaseline) false else content != _originalWorkdirContent.value
        _currentRegions.value = ConflictParser.parseConflictRegions(content)
        _allResolved.value = !ConflictParser.hasRemainingConflicts(content)
        _isMalformed.value = ConflictParser.hasMalformedConflicts(content)
    }

    private fun resetBufferState() {
        _resultContent.value = ""; _originalWorkdirContent.value = ""; _theirsContent.value = ""
        _oursContent.value = ""; _ancestorContent.value = null; _currentRegions.value = emptyList()
        _isResultDirty.value = false; _allResolved.value = false; _isMalformed.value = false
    }
}
