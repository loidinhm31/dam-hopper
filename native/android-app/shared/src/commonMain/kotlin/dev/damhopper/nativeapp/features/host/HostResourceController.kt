package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.lifecycle.LifecycleAware
import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * UI state for Host Resources panel presentation.
 */
data class HostResourceUiState(
    val mode: ResourceSourceMode = ResourceSourceMode.STOPPED,
    val snapshot: HostResourceSnapshotV1? = null,
    val metrics: HostMetrics? = null,
    val alerts: List<AlertIncident> = emptyList(),
    val freshness: ProjectionFreshness? = null,
    val selectedDetailHost: String? = null,
    val isRestLoading: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * Controller coordinating streaming, REST fallback, and presentation state for Host Resources.
 */
class HostResourceController(
    val owner: ConnectionRef,
    val coordinator: ResourceStreamCoordinator,
    val repository: HostResourceRepository,
    val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
) : LifecycleAware {
    companion object {
        const val REST_FALLBACK_INTERVAL_MS = 5_000L
    }
    private val _uiState = MutableStateFlow(HostResourceUiState())
    val uiState: StateFlow<HostResourceUiState> = _uiState.asStateFlow()

    private var streamCollectionJob: Job? = null
    private var restPollingJob: Job? = null
    private var alertPollingJob: Job? = null
    private var disposed = false
    init {
        streamCollectionJob = coroutineScope.launch {
            coordinator.state.collect { streamState ->
                _uiState.value = _uiState.value.copy(
                    mode = streamState.mode,
                    snapshot = streamState.latestSnapshot ?: _uiState.value.snapshot,
                    metrics = streamState.latestMetrics ?: _uiState.value.metrics,
                    freshness = streamState.freshness,
                )
            }
        }
        startRestFallbackPolling()
        startAlertPolling()
    }

    fun registerViewDemand(kind: ResourceConsumerKind): () -> Unit {
        val unreg = coordinator.registerInterest(kind)
        return { unreg() }
    }

    fun setForeground(foreground: Boolean) {
        coordinator.setForeground(foreground)
    }

    override fun onForeground() {
        setForeground(true)
    }

    override fun onBackground() {
        setForeground(false)
    }

    override fun onOwnerRetired(profileId: String) {
        if (owner.profileId == profileId) {
            dispose()
        }
    }

    override fun onDestroy() {
        dispose()
    }

    fun selectDetailHost(hostName: String?) {
        _uiState.value = _uiState.value.copy(selectedDetailHost = hostName)
    }

    fun triggerRestRefresh() {
        coroutineScope.launch { pollRestData() }
    }

    private fun startRestFallbackPolling() {
        restPollingJob?.cancel()
        restPollingJob = coroutineScope.launch {
            while (isActive && !disposed) {
                delay(REST_FALLBACK_INTERVAL_MS)
                if (coordinator.canUseResourceRest()) {
                    pollRestData()
                }
            }
        }
    }

    private fun startAlertPolling() {
        alertPollingJob?.cancel()
        alertPollingJob = coroutineScope.launch {
            while (isActive && !disposed) {
                if (coordinator.hasInterest() && coordinator.isCurrentOwner()) {
                    pollAlertHistory()
                }
                delay(30_000L)
            }
        }
    }

    private suspend fun pollRestData() {
        if (!coordinator.canUseResourceRest()) return
        _uiState.value = _uiState.value.copy(isRestLoading = true)
        val snapResult = repository.getSnapshot().getOrNull()
        val metricsResult = repository.getMetrics().getOrNull()

        if (snapResult is HostResourceResult.Available && metricsResult is HostResourceResult.Available) {
            val committed = coordinator.commitRestPair(snapResult.data, metricsResult.data)
            if (committed) {
                _uiState.value = _uiState.value.copy(
                    snapshot = snapResult.data,
                    metrics = metricsResult.data,
                    freshness = null,
                    isRestLoading = false,
                    errorMessage = null,
                )
            } else {
                _uiState.value = _uiState.value.copy(isRestLoading = false)
            }
        } else {
            _uiState.value = _uiState.value.copy(isRestLoading = false)
        }
    }

    private suspend fun pollAlertHistory() {
        val alertResult = repository.getAlertHistory().getOrNull()
        if (alertResult is HostResourceResult.Available) {
            _uiState.value = _uiState.value.copy(alerts = alertResult.data)
        }
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        streamCollectionJob?.cancel()
        restPollingJob?.cancel()
        alertPollingJob?.cancel()
        coordinator.dispose()
    }
}
