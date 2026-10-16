package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class UsageController(
    val owner: ConnectionRef,
    val repository: UsageRepository,
    val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
) {
    private val _uiState = MutableStateFlow(UsageUiState())
    val uiState: StateFlow<UsageUiState> = _uiState.asStateFlow()

    private var summaryGeneration = 0L
    private var sessionsGeneration = 0L
    private var isForeground = true
    private var disposed = false

    init {
        reloadAll()
    }

    fun setForeground(foreground: Boolean) {
        if (isForeground == foreground) return
        isForeground = foreground
        if (isForeground) reloadAll()
    }

    fun setTimeWindow(window: String) { _uiState.update { it.copy(timeWindow = window) }; resetPaginationAndReload() }
    fun setBucket(bucket: String) { _uiState.update { it.copy(bucket = bucket) }; resetPaginationAndReload() }
    fun setModelFilter(model: String?) { _uiState.update { it.copy(modelFilter = model) }; resetPaginationAndReload() }

    fun reloadAll() {
        if (disposed || !isForeground) return
        loadSummary(); loadSessions(initial = true); loadSettingsAndSetup()
    }

    private fun resetPaginationAndReload() {
        summaryGeneration++
        sessionsGeneration++
        _uiState.update {
            it.copy(
                sessions = emptyList(),
                nextCursor = null,
                selectedSessionId = null,
                selectedSessionDetail = null,
            )
        }
        reloadAll()
    }

    fun loadSummary() {
        val captured = ++summaryGeneration
        _uiState.update { it.copy(isLoadingSummary = true, summaryError = null) }
        coroutineScope.launch {
            val state = _uiState.value
            val result = repository.getSummary(
                window = state.timeWindow,
                bucket = state.bucket,
                model = state.modelFilter,
            )
            if (disposed || captured != summaryGeneration) return@launch
            result.fold(
                onSuccess = { res ->
                    when (res) {
                        is UsageResult.Available -> _uiState.update { it.copy(summary = res.data, isLoadingSummary = false) }
                        is UsageResult.Unavailable -> _uiState.update { it.copy(isLoadingSummary = false, summaryError = res.message) }
                    }
                },
                onFailure = { err ->
                    _uiState.update { it.copy(isLoadingSummary = false, summaryError = err.message ?: "Failed to load summary") }
                }
            )
        }
    }

    fun loadSessions(initial: Boolean = false) {
        if (!initial && _uiState.value.isLoadingSessions) return
        val captured = if (initial) ++sessionsGeneration else sessionsGeneration
        val cursor = if (initial) null else _uiState.value.nextCursor
        if (!initial && cursor == null) return

        val now = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
        val fromMs = when (_uiState.value.timeWindow) {
            "24h" -> now - 86_400_000L
            "7d" -> now - 7 * 86_400_000L
            "30d" -> now - 30 * 86_400_000L
            else -> null
        }
        val reqFrom = if (cursor == null) fromMs else null
        val reqTo = if (cursor == null && fromMs != null) now else null

        _uiState.update { it.copy(isLoadingSessions = true, sessionsError = null) }
        coroutineScope.launch {
            val state = _uiState.value
            val result = repository.listSessions(
                from = reqFrom,
                to = reqTo,
                model = state.modelFilter,
                limit = 25,
                cursor = cursor,
            )
            if (disposed || captured != sessionsGeneration) return@launch
            result.fold(
                onSuccess = { res ->
                    when (res) {
                        is UsageResult.Available -> {
                            _uiState.update { current ->
                                val combined = if (initial) res.data.sessions else current.sessions + res.data.sessions
                                current.copy(
                                    sessions = combined,
                                    nextCursor = res.data.nextCursor,
                                    isLoadingSessions = false,
                                )
                            }
                        }
                        is UsageResult.Unavailable -> _uiState.update { it.copy(isLoadingSessions = false, sessionsError = res.message) }
                    }
                },
                onFailure = { err ->
                    _uiState.update { it.copy(isLoadingSessions = false, sessionsError = err.message ?: "Failed to load sessions") }
                }
            )
        }
    }

    fun selectSession(id: String?) {
        if (id == null) {
            _uiState.update { it.copy(selectedSessionId = null, selectedSessionDetail = null) }
            return
        }
        val captured = sessionsGeneration
        _uiState.update { it.copy(selectedSessionId = id, isLoadingDetail = true) }
        coroutineScope.launch {
            val result = repository.getSessionDetail(id)
            if (disposed || captured != sessionsGeneration) return@launch
            result.fold(
                onSuccess = { detail -> _uiState.update { it.copy(selectedSessionDetail = detail, isLoadingDetail = false) } },
                onFailure = { _uiState.update { it.copy(isLoadingDetail = false) } }
            )
        }
    }

    fun loadSettingsAndSetup() {
        coroutineScope.launch {
            (repository.getSettings().getOrNull() as? UsageResult.Available)?.let { res -> _uiState.update { it.copy(settings = res.data) } }
            (repository.getSetup().getOrNull() as? UsageResult.Available)?.let { res -> _uiState.update { it.copy(setup = res.data) } }
            (repository.getHealth().getOrNull() as? UsageResult.Available)?.let { res -> _uiState.update { it.copy(health = res.data) } }
        }
    }

    fun updateSettings(patch: SettingsPatchRequest, onDone: (Boolean) -> Unit = {}) {
        coroutineScope.launch {
            repository.patchSettings(patch).onSuccess { res -> _uiState.update { it.copy(settings = res) }; onDone(true) }.onFailure { onDone(false) }
        }
    }

    fun updateSetup(patch: SetupPatchRequest, onDone: (Boolean) -> Unit = {}) {
        coroutineScope.launch {
            repository.patchSetup(patch).onSuccess { res -> _uiState.update { it.copy(setup = res) }; onDone(true) }.onFailure { onDone(false) }
        }
    }

    fun deleteUsage(confirmation: String, from: Long? = null, to: Long? = null, onComplete: (Boolean) -> Unit = {}) {
        if (disposed || _uiState.value.isDeleting) {
            onComplete(false)
            return
        }
        if (confirmation != "delete-usage-data") {
            _uiState.update { it.copy(deleteError = "Confirmation string 'delete-usage-data' required") }
            onComplete(false)
            return
        }
        _uiState.update { it.copy(isDeleting = true, deleteError = null) }
        coroutineScope.launch {
            val result = repository.deleteUsage(DeleteUsageRequest(confirmation, from, to))
            if (disposed) return@launch
            result.fold(
                onSuccess = {
                    summaryGeneration++; sessionsGeneration++
                    _uiState.update { it.copy(isDeleting = false, summary = null, sessions = emptyList(), nextCursor = null, selectedSessionDetail = null) }
                    reloadAll()
                    onComplete(true)
                },
                onFailure = { err ->
                    _uiState.update { it.copy(isDeleting = false, deleteError = err.message ?: "Deletion failed") }
                    reloadAll()
                    onComplete(false)
                }
            )
        }
    }

    fun dispose() {
        disposed = true
    }
}
