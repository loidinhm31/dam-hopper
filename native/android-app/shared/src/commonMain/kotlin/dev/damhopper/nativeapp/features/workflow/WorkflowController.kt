package dev.damhopper.nativeapp.features.workflow

import dev.damhopper.nativeapp.core.transport.ApiRequestError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WorkflowState(
    val isLoading: Boolean = false,
    val isUnavailable: Boolean = false,
    val unavailableMessage: String? = null,
    val error: String? = null,
    val overview: WorkflowOverviewDto? = null,
    val events: List<EventDto> = emptyList(),
    val eventsNextCursor: String? = null,
    val isLoadingEvents: Boolean = false,
    val eventsHasLoaded: Boolean = false,
    val selectedItem: ItemDto? = null,
    val selectedSession: SessionDto? = null,
    val expandedItemIds: Set<String> = emptySet(),
    val projectFilter: String? = null,
    val statusFilter: ItemStatus? = null,
    val kindFilter: ItemKind? = null,
    val conflictWarning: String? = null,
    val sessionLinks: Map<String, List<LinkDto>> = emptyMap()
)

class WorkflowController(
    val repository: WorkflowRepository,
    val scope: CoroutineScope,
    val profileId: String,
    val generation: Long
) {
    private val _state = MutableStateFlow(WorkflowState())
    val state: StateFlow<WorkflowState> = _state.asStateFlow()

    private var activeGeneration: Long = generation
    private var activeProfileId: String = profileId
    private var requestSequence: Long = 0L

    init {
        refreshOverview()
    }

    fun updateContext(newProfileId: String, newGeneration: Long) {
        if (newProfileId != activeProfileId || newGeneration != activeGeneration) {
            activeProfileId = newProfileId
            activeGeneration = newGeneration
            _state.value = WorkflowState()
            refreshOverview()
        }
    }


    fun refreshOverview() {
        val capturedGen = activeGeneration
        val capturedProfile = activeProfileId
        val seq = ++requestSequence
        _state.update { it.copy(isLoading = true, error = null) }

        scope.launch {
            val result = repository.getOverview()
            if (activeGeneration != capturedGen || activeProfileId != capturedProfile || seq != requestSequence) return@launch

            result.fold(
                onSuccess = { overviewResult ->
                    when (overviewResult) {
                        is WorkflowOverviewResult.Available -> {
                            _state.update { current ->
                                val freshItem = findItemInOverview(overviewResult.overview, current.selectedItem?.id)
                                current.copy(
                                    isLoading = false,
                                    isUnavailable = false,
                                    unavailableMessage = null,
                                    overview = overviewResult.overview,
                                    selectedItem = freshItem
                                )
                            }
                        }
                        is WorkflowOverviewResult.Unavailable -> {
                            _state.update {
                                it.copy(
                                    isLoading = false,
                                    isUnavailable = true,
                                    unavailableMessage = overviewResult.message
                                )
                            }
                        }
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isLoading = false, error = err.message ?: "Failed to load workflow overview") }
                }
            )
        }
    }

    private fun findItem(node: ItemOverviewNodeDto, id: String?): ItemDto? {
        if (id == null) return null
        if (node.item.id == id) return node.item
        for (child in node.children) {
            val found = findItem(child, id)
            if (found != null) return found
        }
        return null
    }

    private fun findItemInOverview(overview: WorkflowOverviewDto, id: String?): ItemDto? {
        if (id == null) return null
        for (plan in overview.plans) {
            val found = findItem(plan, id)
            if (found != null) return found
        }
        for (task in overview.standaloneTasks) {
            val found = findItem(task, id)
            if (found != null) return found
        }
        return null
    }

    private var eventsRequestSeq: Long = 0L

    fun loadEvents(initial: Boolean = false) {
        if (_state.value.isLoadingEvents) return
        val cursor = if (initial) null else _state.value.eventsNextCursor
        if (!initial && cursor == null && _state.value.eventsHasLoaded) return

        val capturedGen = activeGeneration
        val capturedProfile = activeProfileId
        val seq = ++eventsRequestSeq

        _state.update { it.copy(isLoadingEvents = true) }
        scope.launch {
            val result = repository.getEvents(cursor = cursor, limit = 50)
            if (activeGeneration != capturedGen || activeProfileId != capturedProfile || seq != eventsRequestSeq) return@launch

            result.fold(
                onSuccess = { dto ->
                    _state.update { current ->
                        val combined = if (initial) dto.events else (current.events + dto.events).distinctBy { it.id }
                        current.copy(
                            isLoadingEvents = false,
                            events = combined,
                            eventsNextCursor = dto.nextCursor,
                            eventsHasLoaded = true
                        )
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isLoadingEvents = false, error = err.message) }
                }
            )
        }
    }

    fun loadMoreEvents() {
        loadEvents(initial = false)
    }

    fun toggleItemExpanded(itemId: String) {
        _state.update { current ->
            val set = current.expandedItemIds.toMutableSet()
            if (set.contains(itemId)) set.remove(itemId) else set.add(itemId)
            current.copy(expandedItemIds = set)
        }
    }

    fun selectItem(item: ItemDto?) {
        _state.update { it.copy(selectedItem = item) }
    }

    fun selectSession(session: SessionDto?) {
        _state.update { it.copy(selectedSession = session) }
    }

    fun setProjectFilter(project: String?) {
        _state.update { it.copy(projectFilter = project) }
    }

    fun setStatusFilter(status: ItemStatus?) {
        _state.update { it.copy(statusFilter = status) }
    }

    fun setKindFilter(kind: ItemKind?) {
        _state.update { it.copy(kindFilter = kind) }
    }

    fun clearConflictWarning() {
        _state.update { it.copy(conflictWarning = null) }
    }

    suspend fun createItem(
        target: WorkflowTargetDto,
        kind: ItemKind,
        title: String,
        parentId: String? = null,
        summary: String? = null,
        status: ItemStatus? = null,
        sortOrder: Int? = null
    ): Result<MutationDto<ItemDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = CreateItemRequest(
            requestId = reqId,
            target = target,
            parentId = parentId,
            kind = kind,
            title = title,
            summary = summary,
            status = status,
            sortOrder = sortOrder
        )
        val result = repository.createItem(request)
        result.onSuccess {
            refreshOverview()
        }
        return result
    }

    suspend fun updateItem(
        id: String,
        updatedAt: String,
        title: String? = null,
        summary: String? = null,
        summarySpecified: Boolean = false,
        status: ItemStatus? = null,
        sortOrder: Int? = null,
        target: WorkflowTargetDto? = null
    ): Result<MutationDto<ItemDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = PatchItemRequest(
            requestId = reqId,
            updatedAt = updatedAt,
            title = title,
            summarySpecified = summarySpecified,
            summary = summary,
            status = status,
            sortOrder = sortOrder,
            target = target
        )
        val result = repository.patchItem(id, request)
        result.fold(
            onSuccess = { mutation ->
                _state.update { it.copy(conflictWarning = null, selectedItem = mutation.resource) }
                refreshOverview()
            },
            onFailure = { err ->
                if (err is ApiRequestError && (err.status == 409 || err.code == "workflow_conflict")) {
                    _state.update { it.copy(conflictWarning = "Item was modified remotely. Your draft was preserved. Please review latest state.") }
                    refreshOverview()
                }
            }
        )
        return result
    }

    suspend fun deleteItem(id: String, updatedAt: String): Result<TombstoneDto> {
        val reqId = WorkflowRepository.generateUuid()
        val request = DeleteItemRequest(requestId = reqId, updatedAt = updatedAt)
        val result = repository.deleteItem(id, request)
        result.onSuccess {
            _state.update { if (it.selectedItem?.id == id) it.copy(selectedItem = null) else it }
            refreshOverview()
        }
        return result
    }

    suspend fun startSession(
        target: WorkflowTargetDto,
        itemId: String? = null,
        startedAt: String
    ): Result<MutationDto<SessionDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = CreateSessionRequest(
            requestId = reqId,
            target = target,
            itemId = itemId,
            startedAt = startedAt
        )
        val result = repository.createSession(request)
        result.onSuccess {
            refreshOverview()
        }
        return result
    }

    suspend fun endSession(id: String, endedAt: String): Result<MutationDto<SessionDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = EndSessionRequest(requestId = reqId, endedAt = endedAt)
        val result = repository.endSession(id, request)
        result.onSuccess {
            refreshOverview()
        }
        return result
    }

    suspend fun abandonSession(id: String): Result<MutationDto<SessionDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = AbandonSessionRequest(requestId = reqId)
        val result = repository.abandonSession(id, request)
        result.onSuccess {
            refreshOverview()
        }
        return result
    }

    suspend fun linkTerminal(
        sessionId: String,
        terminalId: String,
        incarnation: Long? = null
    ): Result<MutationDto<LinkDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = LinkResourceRequest(
            requestId = reqId,
            resourceType = ResourceLinkType.TERMINAL,
            externalId = terminalId,
            incarnation = incarnation
        )
        val result = repository.linkResource(sessionId, request)
        result.onSuccess { mutation ->
            _state.update { current ->
                val existing = current.sessionLinks[sessionId]?.filter { it.externalId != terminalId } ?: emptyList()
                current.copy(sessionLinks = current.sessionLinks + (sessionId to (existing + mutation.resource)))
            }
            refreshOverview()
        }
        return result
    }

    suspend fun linkAgent(
        sessionId: String,
        agentId: String,
        harnessLabel: String? = null,
        runId: String? = null
    ): Result<MutationDto<LinkDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = LinkResourceRequest(
            requestId = reqId,
            resourceType = ResourceLinkType.AGENT,
            externalId = agentId,
            harnessLabel = harnessLabel,
            runId = runId
        )
        val result = repository.linkResource(sessionId, request)
        result.onSuccess { mutation ->
            _state.update { current ->
                val existing = current.sessionLinks[sessionId]?.filter { it.externalId != agentId } ?: emptyList()
                current.copy(sessionLinks = current.sessionLinks + (sessionId to (existing + mutation.resource)))
            }
            refreshOverview()
        }
        return result
    }

    suspend fun unlinkResource(
        sessionId: String,
        updatedAt: String,
        resourceType: ResourceLinkType,
        externalId: String
    ): Result<TombstoneDto> {
        val reqId = WorkflowRepository.generateUuid()
        val request = UnlinkResourceRequest(
            requestId = reqId,
            updatedAt = updatedAt,
            resourceType = resourceType,
            externalId = externalId
        )
        val result = repository.unlinkResource(sessionId, request)
        result.onSuccess {
            _state.update { current ->
                val existing = current.sessionLinks[sessionId]?.filter { it.externalId != externalId } ?: emptyList()
                current.copy(sessionLinks = current.sessionLinks + (sessionId to existing))
            }
            refreshOverview()
        }
        return result
    }

    suspend fun addNote(
        body: String,
        itemId: String? = null,
        sessionId: String? = null
    ): Result<MutationDto<NoteDto>> {
        val reqId = WorkflowRepository.generateUuid()
        val request = CreateNoteRequest(
            requestId = reqId,
            itemId = itemId,
            sessionId = sessionId,
            body = body
        )
        val result = repository.createNote(request)
        result.onSuccess {
            refreshOverview()
        }
        return result
    }

    suspend fun deleteNote(id: String, updatedAt: String): Result<TombstoneDto> {
        val reqId = WorkflowRepository.generateUuid()
        val request = DeleteNoteRequest(requestId = reqId, updatedAt = updatedAt)
        val result = repository.deleteNote(id, request)
        result.onSuccess {
            refreshOverview()
        }
        return result
    }

    suspend fun purgeHistory(before: String): Result<PurgeDto> {
        val result = repository.purgeHistory(before)
        result.onSuccess {
            _state.update { it.copy(events = emptyList(), eventsNextCursor = null) }
            refreshOverview()
        }
        return result
    }
}
