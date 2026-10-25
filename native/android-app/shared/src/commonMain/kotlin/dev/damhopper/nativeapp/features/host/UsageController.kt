package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.classifyCancellation
import dev.damhopper.nativeapp.features.settings.classifyFailure
import dev.damhopper.nativeapp.features.settings.reasonOrNull
import kotlinx.coroutines.CancellationException
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
    private var settingsGeneration = 0L
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
                                val newModels = res.data.sessions.mapNotNull { it.model }.filter { it.isNotBlank() }
                                val updatedKnown = (current.knownModels + newModels).distinct()
                                current.copy(
                                    sessions = combined,
                                    knownModels = updatedKnown,
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
        val captured = ++settingsGeneration
        coroutineScope.launch {
            val s = (repository.getSettings().getOrNull() as? UsageResult.Available)?.data
            val su = (repository.getSetup().getOrNull() as? UsageResult.Available)?.data
            val h = (repository.getHealth().getOrNull() as? UsageResult.Available)?.data
            if (disposed || captured != settingsGeneration) return@launch
            _uiState.update { it.copy(settings = s ?: it.settings, setup = su ?: it.setup, health = h ?: it.health) }
        }
    }

    /**
     * Updates usage settings through the request-local [guard]. [onDone] receives an honest outcome
     * (NotSubmitted / Rejected / Unknown / Confirmed) - never a Boolean; nothing is retried.
     */
    fun updateSettings(
        patch: SettingsPatchRequest,
        guard: RequestAdmissionGuard,
        onDone: (SettingsOutcome<UsageSettingsResponse>) -> Unit = {},
    ) {
        val captured = ++settingsGeneration
        coroutineScope.launch {
            val outcome = guardedResult(guard, onDone) { repository.patchSettings(patch, guard) }
            if (outcome is SettingsOutcome.Confirmed && !disposed && captured == settingsGeneration) {
                _uiState.update { it.copy(settings = outcome.value) }
            }
            onDone(outcome)
        }
    }

    fun updateSetup(
        patch: SetupPatchRequest,
        guard: RequestAdmissionGuard,
        onDone: (SettingsOutcome<UsageSetupStatusResponse>) -> Unit = {},
    ) {
        val captured = ++settingsGeneration
        coroutineScope.launch {
            val outcome = guardedResult(guard, onDone) { repository.patchSetup(patch, guard) }
            if (outcome is SettingsOutcome.Confirmed && !disposed && captured == settingsGeneration) {
                _uiState.update { it.copy(setup = outcome.value) }
            }
            onDone(outcome)
        }
    }

    private suspend fun <T> guardedResult(
        guard: RequestAdmissionGuard,
        onDone: (SettingsOutcome<T>) -> Unit,
        request: suspend () -> Result<T>,
    ): SettingsOutcome<T> {
        if (disposed) return SettingsOutcome.NotSubmitted("Usage controller is disposed")
        return try {
            request().fold(
                onSuccess = { SettingsOutcome.Confirmed(it) },
                onFailure = { classifyFailure(guard, it) },
            )
        } catch (ce: CancellationException) {
            onDone(classifyCancellation(guard))
            throw ce
        }
    }

    /**
     * Deletes usage data after the explicit confirmation string, through the request-local [guard]. The
     * summary/session caches are refreshed (read-only) afterwards; the delete itself is never retried.
     */
    fun deleteUsage(
        confirmation: String,
        from: Long? = null,
        to: Long? = null,
        guard: RequestAdmissionGuard,
        onComplete: (SettingsOutcome<Unit>) -> Unit = {},
    ) {
        if (disposed || _uiState.value.isDeleting) {
            onComplete(SettingsOutcome.NotSubmitted("Usage controller is busy or disposed"))
            return
        }
        if (confirmation != "delete-usage-data") {
            _uiState.update { it.copy(deleteError = "Confirmation string 'delete-usage-data' required") }
            onComplete(SettingsOutcome.NotSubmitted("Confirmation string 'delete-usage-data' required"))
            return
        }
        _uiState.update { it.copy(isDeleting = true, deleteError = null) }
        coroutineScope.launch {
            val outcome = try {
                repository.deleteUsage(DeleteUsageRequest(confirmation, from, to), guard).fold(
                    onSuccess = { SettingsOutcome.Confirmed(Unit) },
                    onFailure = { classifyFailure(guard, it) },
                )
            } catch (ce: CancellationException) {
                _uiState.update { it.copy(isDeleting = false, deleteError = classifyCancellation(guard).reasonOrNull) }
                onComplete(classifyCancellation(guard))
                throw ce
            }
            if (disposed) {
                onComplete(outcome)
                return@launch
            }
            when (outcome) {
                is SettingsOutcome.Confirmed -> {
                    summaryGeneration++; sessionsGeneration++
                    _uiState.update { it.copy(isDeleting = false, summary = null, sessions = emptyList(), nextCursor = null, selectedSessionDetail = null) }
                }
                else -> _uiState.update { it.copy(isDeleting = false, deleteError = outcome.reasonOrNull ?: "Deletion failed") }
            }
            reloadAll()
            onComplete(outcome)
        }
    }

    fun dispose() {
        disposed = true
    }
}
