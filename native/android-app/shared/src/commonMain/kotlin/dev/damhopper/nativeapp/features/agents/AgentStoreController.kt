package dev.damhopper.nativeapp.features.agents

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * UI state for the Agent Store catalog, inventory, distribution matrix, and health.
 */
data class AgentStoreState(
    val isLoading: Boolean = false,
    val isUnavailable: Boolean = false,
    val unavailableMessage: String? = null,
    val error: String? = null,
    val items: List<AgentStoreItem> = emptyList(),
    val selectedItem: AgentStoreItem? = null,
    val selectedCategory: AgentItemCategory? = null,
    val searchQuery: String = "",
    val matrix: Map<String, Map<String, DistributionStatus>> = emptyMap(),
    val health: HealthCheckResult? = null,
    val isHealthLoading: Boolean = false,
    val itemContent: String? = null,
    val isLoadingContent: Boolean = false,
    val isMutating: Boolean = false,
    val mutationError: String? = null,
    val bulkResults: List<ShipResult>? = null,
    val deleteConfirmationItem: AgentStoreItem? = null,
    val shipDialogItem: AgentStoreItem? = null,
    val shipCounts: Map<String, Int> = emptyMap(),
    val cellActionModalData: CellActionModalData? = null,
    val projectScanResults: List<ProjectAgentScanResult>? = null,
    val isScanningProjects: Boolean = false
) {
    /**
     * Filtered list of items matching the current category and search query.
     */
    val filteredItems: List<AgentStoreItem>
        get() = items.filter { item ->
            val matchesCategory = selectedCategory == null || item.category == selectedCategory
            val matchesSearch = searchQuery.isBlank() ||
                item.name.contains(searchQuery, ignoreCase = true) ||
                (item.description?.contains(searchQuery, ignoreCase = true) == true)
            matchesCategory && matchesSearch
        }
}
data class CellActionModalData(
    val item: AgentStoreItem,
    val projectName: String,
    val agent: AgentType,
    val status: DistributionStatus?
)

/**
 * Controller managing Agent Store catalog operations with immutable connection owner fencing.
 */
class AgentStoreController(
    val repository: AgentStoreRepository,
    val scope: CoroutineScope,
    val profileId: String,
    val generation: Long
) {
    private val _state = MutableStateFlow(AgentStoreState())
    val state: StateFlow<AgentStoreState> = _state.asStateFlow()

    private var isRetired: Boolean = false
    private var requestSequence: Long = 0L
    private var contentRequestSequence: Long = 0L

    init {
        loadStore()
    }

    /**
     * Retire controller on profile or generation disconnection.
     * Prevents any future or in-flight responses from mutating state.
     */
    fun retire() {
        isRetired = true
        _state.value = AgentStoreState()
    }

    /**
     * Loads catalog items, distribution matrix, and health status.
     */
    fun loadStore() {
        if (isRetired) return
        val seq = ++requestSequence
        _state.update { it.copy(isLoading = true, error = null, isUnavailable = false) }

        scope.launch {
            if (isRetired || seq != requestSequence) return@launch

            val itemsResult = repository.listItems(_state.value.selectedCategory)
            if (isRetired || seq != requestSequence) return@launch

            itemsResult.fold(
                onSuccess = { catalogResult ->
                    when (catalogResult) {
                        is AgentStoreCatalogResult.Available -> {
                            _state.update { current ->
                                val preservedSelection = current.selectedItem?.let { sel ->
                                    catalogResult.items.firstOrNull { it.name == sel.name && it.category == sel.category }
                                }
                                current.copy(
                                    isLoading = false,
                                    items = catalogResult.items,
                                    selectedItem = preservedSelection
                                )
                            }
                            loadMatrixAndHealth(seq)
                        }
                        is AgentStoreCatalogResult.Unavailable -> {
                            _state.update {
                                it.copy(
                                    isLoading = false,
                                    isUnavailable = true,
                                    unavailableMessage = catalogResult.message
                                )
                            }
                        }
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isLoading = false, error = err.message ?: "Failed to load agent store") }
                }
            )
        }
    }

    private fun loadMatrixAndHealth(parentSeq: Long) {
        if (isRetired || parentSeq != requestSequence) return

        scope.launch {
            val matrixResult = repository.getMatrix()
            if (isRetired || parentSeq != requestSequence) return@launch

            matrixResult.onSuccess { matrixData ->
                val counts = mutableMapOf<String, Int>()
                for ((itemKey, projectMap) in matrixData) {
                    counts[itemKey] = projectMap.values.count { it.shipped }
                }
                _state.update { it.copy(matrix = matrixData, shipCounts = counts) }
            }

            val healthResult = repository.healthCheck()
            if (isRetired || parentSeq != requestSequence) return@launch

            healthResult.onSuccess { healthData ->
                _state.update { it.copy(health = healthData) }
            }
        }
    }

    fun setCategoryFilter(category: AgentItemCategory?) {
        if (isRetired) return
        _state.update { it.copy(selectedCategory = category) }
        loadStore()
    }

    fun setSearchQuery(query: String) {
        if (isRetired) return
        _state.update { it.copy(searchQuery = query) }
    }

    fun selectItem(item: AgentStoreItem?) {
        if (isRetired) return
        _state.update { it.copy(selectedItem = item, itemContent = null, isLoadingContent = item != null) }
        if (item == null) return

        val seq = ++contentRequestSequence
        scope.launch {
            val result = repository.getItemContent(item.category, item.name)
            if (isRetired || seq != contentRequestSequence) return@launch

            result.fold(
                onSuccess = { content ->
                    _state.update { current ->
                        if (current.selectedItem?.name == item.name && current.selectedItem?.category == item.category) {
                            current.copy(itemContent = content, isLoadingContent = false)
                        } else {
                            current
                        }
                    }
                },
                onFailure = {
                    _state.update { current ->
                        if (current.selectedItem?.name == item.name && current.selectedItem?.category == item.category) {
                            current.copy(itemContent = "", isLoadingContent = false)
                        } else {
                            current
                        }
                    }
                }
            )
        }
    }

    fun openShipDialog(item: AgentStoreItem) {
        if (isRetired) return
        _state.update { it.copy(shipDialogItem = item, mutationError = null) }
    }

    fun closeShipDialog() {
        _state.update { it.copy(shipDialogItem = null, mutationError = null) }
    }

    fun shipItem(
        item: AgentStoreItem,
        projectName: String,
        agent: AgentType,
        method: DistributionMethod = DistributionMethod.SYMLINK,
        onSuccess: (() -> Unit)? = null
    ) {
        if (isRetired) return
        _state.update { it.copy(isMutating = true, mutationError = null) }

        scope.launch {
            val req = ShipRequest(
                itemName = item.name,
                category = item.category,
                projectName = projectName,
                agent = agent,
                method = method
            )
            val result = repository.shipItem(req)
            if (isRetired) return@launch

            result.fold(
                onSuccess = { shipResult ->
                    _state.update { it.copy(isMutating = false) }
                    if (shipResult.success) {
                        loadStore()
                        onSuccess?.invoke()
                    } else {
                        _state.update { it.copy(mutationError = shipResult.error ?: "Ship operation failed") }
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isMutating = false, mutationError = err.message ?: "Failed to ship item") }
                }
            )
        }
    }

    fun unshipItem(
        item: AgentStoreItem,
        projectName: String,
        agent: AgentType,
        force: Boolean = false
    ) {
        if (isRetired) return
        _state.update { it.copy(isMutating = true, mutationError = null) }

        scope.launch {
            val req = UnshipRequest(
                itemName = item.name,
                category = item.category,
                projectName = projectName,
                agent = agent,
                force = force
            )
            val result = repository.unshipItem(req)
            if (isRetired) return@launch

            result.fold(
                onSuccess = { unshipResult ->
                    _state.update { it.copy(isMutating = false) }
                    if (unshipResult.success) {
                        loadStore()
                    } else {
                        _state.update { it.copy(mutationError = unshipResult.error ?: "Unship operation failed") }
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isMutating = false, mutationError = err.message ?: "Failed to unship item") }
                }
            )
        }
    }

    fun absorbItem(
        item: AgentStoreItem,
        projectName: String,
        agent: AgentType
    ) {
        if (isRetired) return
        _state.update { it.copy(isMutating = true, mutationError = null) }

        scope.launch {
            val req = AbsorbRequest(
                itemName = item.name,
                category = item.category,
                projectName = projectName,
                agent = agent
            )
            val result = repository.absorbItem(req)
            if (isRetired) return@launch

            result.fold(
                onSuccess = { absorbResult ->
                    _state.update { it.copy(isMutating = false) }
                    if (absorbResult.success) {
                        loadStore()
                    } else {
                        _state.update { it.copy(mutationError = absorbResult.error ?: "Absorb operation failed") }
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isMutating = false, mutationError = err.message ?: "Failed to absorb item") }
                }
            )
        }
    }

    fun bulkShip(
        items: List<AgentStoreItem>,
        projects: List<Pair<String, AgentType>>,
        method: DistributionMethod = DistributionMethod.SYMLINK,
        onSuccess: (() -> Unit)? = null
    ) {
        if (isRetired || items.isEmpty() || projects.isEmpty()) return
        _state.update { it.copy(isMutating = true, mutationError = null, bulkResults = null) }

        scope.launch {
            val req = BulkShipRequest(
                items = items.map { BulkShipItem(name = it.name, category = it.category) },
                projects = projects.map { BulkShipProject(projectName = it.first, agent = it.second) },
                method = method
            )
            val result = repository.bulkShip(req)
            if (isRetired) return@launch

            result.fold(
                onSuccess = { results ->
                    val hasFailures = results.any { !it.success }
                    _state.update {
                        it.copy(
                            isMutating = false,
                            bulkResults = results,
                            mutationError = if (hasFailures) "Some items failed to ship" else null
                        )
                    }
                    loadStore()
                    if (!hasFailures) {
                        onSuccess?.invoke()
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isMutating = false, mutationError = err.message ?: "Bulk ship failed") }
                }
            )
        }
    }

    fun requestDeleteItem(item: AgentStoreItem) {
        if (isRetired) return
        _state.update { it.copy(deleteConfirmationItem = item, mutationError = null) }
    }

    fun dismissDeleteDialog() {
        _state.update { it.copy(deleteConfirmationItem = null, mutationError = null) }
    }

    fun confirmDeleteItem() {
        val item = _state.value.deleteConfirmationItem ?: return
        if (isRetired) return
        _state.update { it.copy(isMutating = true, mutationError = null) }

        scope.launch {
            val result = repository.removeItem(item.category, item.name)
            if (isRetired) return@launch

            result.fold(
                onSuccess = {
                    _state.update { current ->
                        current.copy(
                            isMutating = false,
                            deleteConfirmationItem = null,
                            selectedItem = if (current.selectedItem?.name == item.name && current.selectedItem?.category == item.category) null else current.selectedItem
                        )
                    }
                    loadStore()
                },
                onFailure = { err ->
                    _state.update { it.copy(isMutating = false, mutationError = err.message ?: "Failed to remove item") }
                }
            )
        }
    }

    fun clearBulkResults() {
        _state.update { it.copy(bulkResults = null) }
    }

    fun openCellActionModal(item: AgentStoreItem, projectName: String, agent: AgentType) {
        if (isRetired) return
        val itemKey = AgentStoreHelpers.itemKey(item.category, item.name)
        val projKey = AgentStoreHelpers.projectAgentKey(projectName, agent)
        val status = _state.value.matrix[itemKey]?.get(projKey)
        _state.update {
            it.copy(
                cellActionModalData = CellActionModalData(item, projectName, agent, status),
                mutationError = null
            )
        }
    }

    fun closeCellActionModal() {
        _state.update { it.copy(cellActionModalData = null, mutationError = null) }
    }

    fun scanProjects() {
        if (isRetired) return
        _state.update { it.copy(isScanningProjects = true, mutationError = null) }
        scope.launch {
            val result = repository.scanProjects()
            if (isRetired) return@launch
            result.fold(
                onSuccess = { scanList ->
                    _state.update { it.copy(isScanningProjects = false, projectScanResults = scanList) }
                },
                onFailure = { err ->
                    _state.update { it.copy(isScanningProjects = false, mutationError = err.message ?: "Project scan failed") }
                }
            )
        }
    }

    fun clearProjectScanResults() {
        _state.update { it.copy(projectScanResults = null) }
    }
}
