package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.core.transport.WsState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * High-level connection and authority readiness state for the file explorer.
 */
enum class ExplorerConnectionStatus {
    CONNECTED,
    CONNECTING,
    DISCONNECTED,
    TARGET_UNAVAILABLE,
}

/**
 * Observable controller managing lazy directory tree expansion, selection, scroll retention,
 * demand-shared WebSocket watch subscriptions, watermark-fenced listings, and overflow recovery.
 */
class FileTreeState(
    val target: ProjectTargetRef,
    private val repository: FileRepository,
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    val watchCoordinator: FileWatchCoordinator = FileWatchCoordinator(
        target = target,
        repository = repository,
        coroutineScope = coroutineScope,
    ),
) {
    @Volatile
    private var isDisposed: Boolean = false

    @Volatile
    private var initialLoadJob: kotlinx.coroutines.Job? = null

    private val initialRoot = FileTreeNode(target, "", target.project, isDirectory = true, isExpanded = true)
    private val _root = MutableStateFlow(initialRoot)
    val root: StateFlow<FileTreeNode> = _root.asStateFlow()

    private val _selectedPath = MutableStateFlow<String?>(null)
    val selectedPath: StateFlow<String?> = _selectedPath.asStateFlow()

    private val _showHidden = MutableStateFlow(false)
    val showHidden: StateFlow<Boolean> = _showHidden.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _refreshWarning = MutableStateFlow<String?>(null)
    val refreshWarning: StateFlow<String?> = _refreshWarning.asStateFlow()

    private val _connectionStatus = MutableStateFlow(resolveInitialConnectionStatus())
    val connectionStatus: StateFlow<ExplorerConnectionStatus> = _connectionStatus.asStateFlow()

    val isWriteReady: StateFlow<Boolean>
        get() = watchCoordinator.isWriteReady

    private val _scrollIndex = MutableStateFlow(0)
    val scrollIndex: StateFlow<Int> = _scrollIndex.asStateFlow()

    private val _scrollOffset = MutableStateFlow(0)
    val scrollOffset: StateFlow<Int> = _scrollOffset.asStateFlow()

    init {
        watchCoordinator.onRefetchExplorerDirectory = { dirPath ->
            refreshDirectoryOrdered(dirPath)
        }
        watchCoordinator.onOverflowNotice = { _, _ ->
            _error.value = "Watcher overflow recovered"
        }
        initialLoadJob = coroutineScope.launch {
            initTreeAndSubscriptionInternal()
        }
        coroutineScope.launch {
            observeConnectionState()
        }
    }

    private fun resolveInitialConnectionStatus(): ExplorerConnectionStatus {
        if (!repository.owner.matchesTarget(target)) {
            return ExplorerConnectionStatus.TARGET_UNAVAILABLE
        }
        return when (repository.wsConnection.state.value) {
            is WsState.Connected -> ExplorerConnectionStatus.CONNECTED
            is WsState.Connecting -> ExplorerConnectionStatus.CONNECTING
            else -> ExplorerConnectionStatus.DISCONNECTED
        }
    }

    private suspend fun observeConnectionState() {
        repository.wsConnection.state.collect { wsState ->
            if (isDisposed) return@collect
            if (!repository.owner.matchesTarget(target)) {
                _connectionStatus.value = ExplorerConnectionStatus.TARGET_UNAVAILABLE
                return@collect
            }
            _connectionStatus.value = when (wsState) {
                is WsState.Connected -> ExplorerConnectionStatus.CONNECTED
                is WsState.Connecting -> ExplorerConnectionStatus.CONNECTING
                else -> ExplorerConnectionStatus.DISCONNECTED
            }
        }
    }

    suspend fun initTreeAndSubscription() {
        if (isDisposed) return
        val runningInit = initialLoadJob
        if (runningInit != null && runningInit.isActive) {
            runningInit.cancel()
            try { runningInit.join() } catch (_: Throwable) {}
        }
        initTreeAndSubscriptionInternal()
    }

    private suspend fun initTreeAndSubscriptionInternal() {
        if (isDisposed) return
        if (!repository.owner.matchesTarget(target)) {
            _connectionStatus.value = ExplorerConnectionStatus.TARGET_UNAVAILABLE
            _error.value = "Target does not match workspace owner"
            return
        }
        _isLoading.value = true
        _error.value = null
        _refreshWarning.value = null
        try {
            watchCoordinator.acquireExplorerDemand("")
            when (val result = watchCoordinator.fetchDirectoryOrdered("")) {
                is OrderedDirectoryListingResult.Published -> {
                    _root.value = FileTreeHelpers.updateChildren(_root.value, "", result.entries, target)
                    _error.value = null
                    _isLoading.value = false
                }
                is OrderedDirectoryListingResult.Failed -> {
                    _error.value = result.error.message ?: "Failed to load directory"
                    _isLoading.value = false
                }
                is OrderedDirectoryListingResult.Superseded -> {
                    // A newer request owns the loading/error state
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (!isDisposed) {
                _error.value = e.message ?: "Failed to load directory"
                _isLoading.value = false
            }
        }
    }

    fun toggleFolder(path: String) {
        if (isDisposed) return
        val cleanPath = watchCoordinator.normalizeDirectoryPath(path)
        val node = FileTreeHelpers.findNode(_root.value, cleanPath) ?: return
        if (!node.isDirectory) return

        if (node.isExpanded || node.isLoading) {
            // Collapse: invalidate in-flight listing for this folder and release only explorer demand
            _root.value = FileTreeHelpers.updateNode(_root.value, cleanPath) {
                it.copy(isExpanded = false, isLoading = false, error = null)
            }
            if (cleanPath.isNotEmpty()) {
                watchCoordinator.releaseExplorerDemandImmediate(cleanPath)
            }
        } else {
            loadDirectory(cleanPath)
        }
    }

    fun loadDirectory(path: String) {
        if (isDisposed) return
        val cleanPath = watchCoordinator.normalizeDirectoryPath(path)
        if (cleanPath.isEmpty()) {
            _isLoading.value = true
        } else {
            _root.value = FileTreeHelpers.updateNode(_root.value, cleanPath) {
                it.copy(isLoading = true, error = null)
            }
        }
        coroutineScope.launch {
            loadDirectorySuspending(cleanPath, isPostMutationRefresh = false)
        }
    }

    /**
     * Suspends until the ordered directory load completes.
     * When [isPostMutationRefresh] is true, failures surface as a non-fatal [refreshWarning]
     * so an already-confirmed server mutation is never reported as a failed mutation.
     */
    suspend fun loadDirectorySuspending(
        path: String,
        isPostMutationRefresh: Boolean = false,
    ): Boolean {
        if (isDisposed) return false
        val cleanPath = watchCoordinator.normalizeDirectoryPath(path)
        if (cleanPath.isEmpty()) {
            _isLoading.value = true
        } else {
            _root.value = FileTreeHelpers.updateNode(_root.value, cleanPath) {
                it.copy(isLoading = true, error = null)
            }
        }
        return try {
            watchCoordinator.acquireExplorerDemand(cleanPath)
            when (val result = watchCoordinator.fetchDirectoryOrdered(cleanPath)) {
                is OrderedDirectoryListingResult.Published -> {
                    _root.value = FileTreeHelpers.updateChildren(_root.value, cleanPath, result.entries, target)
                    if (cleanPath.isEmpty()) {
                        _isLoading.value = false
                        _error.value = null
                    }
                    _refreshWarning.value = null
                    true
                }
                is OrderedDirectoryListingResult.Failed -> {
                    val msg = result.error.message ?: "Failed to read folder"
                    if (isPostMutationRefresh) {
                        _refreshWarning.value = "Operation succeeded, but directory refresh failed: $msg"
                        if (cleanPath.isEmpty()) _isLoading.value = false
                        else _root.value = FileTreeHelpers.updateNode(_root.value, cleanPath) { it.copy(isLoading = false) }
                    } else if (cleanPath.isEmpty()) {
                        _isLoading.value = false
                        _error.value = msg
                    } else {
                        _root.value = FileTreeHelpers.updateNode(_root.value, cleanPath) {
                            it.copy(isLoading = false, error = msg)
                        }
                    }
                    false
                }
                is OrderedDirectoryListingResult.Superseded -> true
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (!isDisposed) {
                val msg = e.message ?: "Failed to read folder"
                if (isPostMutationRefresh) {
                    _refreshWarning.value = "Operation succeeded, but directory refresh failed: $msg"
                } else if (cleanPath.isEmpty()) {
                    _error.value = msg
                } else {
                    _root.value = FileTreeHelpers.updateNode(_root.value, cleanPath) {
                        it.copy(isLoading = false, error = msg)
                    }
                }
                if (cleanPath.isEmpty()) _isLoading.value = false
            }
            false
        }
    }

    private suspend fun refreshDirectoryOrdered(dirPath: String): Boolean {
        val cleanDir = watchCoordinator.normalizeDirectoryPath(dirPath)
        val node = FileTreeHelpers.findNode(_root.value, cleanDir)
        if (node == null || (!node.isExpanded && cleanDir.isNotEmpty())) {
            return true
        }
        return loadDirectorySuspending(cleanDir, isPostMutationRefresh = false)
    }

    fun selectPath(path: String?) {
        _selectedPath.value = path?.let { watchCoordinator.normalizeDirectoryPath(it) }
    }

    fun setShowHidden(show: Boolean) {
        _showHidden.value = show
    }

    fun setError(err: String?) {
        _error.value = err
    }

    fun clearRefreshWarning() {
        _refreshWarning.value = null
    }

    fun updateScrollPosition(firstVisibleItemIndex: Int, firstVisibleItemScrollOffset: Int) {
        _scrollIndex.value = firstVisibleItemIndex.coerceAtLeast(0)
        _scrollOffset.value = firstVisibleItemScrollOffset.coerceAtLeast(0)
    }

    fun refresh() {
        if (isDisposed) return
        coroutineScope.launch {
            initTreeAndSubscription()
            refreshExpandedSubdirectories(_root.value)
        }
    }

    private suspend fun refreshExpandedSubdirectories(node: FileTreeNode) {
        for (child in node.children) {
            if (child.isDirectory && child.isExpanded) {
                loadDirectorySuspending(child.path, isPostMutationRefresh = false)
                val updatedChild = FileTreeHelpers.findNode(_root.value, child.path)
                if (updatedChild != null) {
                    refreshExpandedSubdirectories(updatedChild)
                }
            }
        }
    }

    fun handleFsEvent(event: FsEventDto) {
        if (isDisposed) return
        coroutineScope.launch {
            val activeSocket = repository.wsConnection.activeSocketRef()
            val activeSub = watchCoordinator.activeSubscriptions.value[""]
            if (activeSocket != null && activeSub != null && activeSub.socketRef == activeSocket) {
                val qualified = QualifiedWatchEvent.fromRaw(
                    owner = watchCoordinator.owner,
                    target = target,
                    watchedDirectoryPath = "",
                    originSocket = activeSocket,
                    subId = activeSub.subId.toULongOrNull() ?: 0uL,
                    requestId = 0uL,
                    subscribeIncarnation = activeSub.subscribeIncarnation,
                    sequenceNumber = 0L,
                    event = event,
                )
                watchCoordinator.handleQualifiedEvent(qualified)
                return@launch
            }

            // Fallback when invoked directly in unit tests without an active WS subscription:
            // strictly enforce target-relative routing (never fall back to raw event.path/from).
            val safeRelPath = QualifiedWatchEvent.extractSafeTargetRelativePath(event.targetRelativePath)
            val requiresFrom = event.from != null || event.targetRelativeFrom != null
            val safeRelFrom = if (requiresFrom) {
                QualifiedWatchEvent.extractSafeTargetRelativePath(event.targetRelativeFrom)
            } else {
                null
            }
            if (safeRelPath == null || (requiresFrom && safeRelFrom == null)) {
                // Missing relative routing: invalidate and refetch loaded directories
                refreshDirectoryIfLoaded("")
                refreshExpandedSubdirectories(_root.value)
                return@launch
            }

            val parentPath = if (safeRelPath.isEmpty()) "" else FileTreeHelpers.resolveParentPath(safeRelPath)
            refreshDirectoryIfLoaded(parentPath)

            if (safeRelFrom != null) {
                val fromParent = if (safeRelFrom.isEmpty()) "" else FileTreeHelpers.resolveParentPath(safeRelFrom)
                if (fromParent != parentPath) {
                    refreshDirectoryIfLoaded(fromParent)
                }
            }
        }
    }

    private suspend fun refreshDirectoryIfLoaded(dirPath: String) {
        val node = FileTreeHelpers.findNode(_root.value, dirPath)
        if (node != null && (node.isExpanded || dirPath.isEmpty())) {
            try {
                val entries = repository.listDirectory(target, dirPath)
                _root.value = FileTreeHelpers.updateChildren(_root.value, dirPath, entries, target)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {}
        }
    }

    fun handleFsOverflow(message: String) {
        if (isDisposed) return
        _error.value = "Watcher overflow recovered"
        coroutineScope.launch {
            val activeSocket = repository.wsConnection.activeSocketRef()
            if (activeSocket != null && watchCoordinator.activeSubscriptions.value.isNotEmpty()) {
                for (dirPath in watchCoordinator.activeSubscriptions.value.keys.toList()) {
                    watchCoordinator.handleSubscriptionOverflow(dirPath, activeSocket, message)
                }
            } else {
                refreshDirectoryIfLoaded("")
                refreshExpandedSubdirectories(_root.value)
            }
        }
    }

    suspend fun pauseWatching() {
        watchCoordinator.pause()
    }

    suspend fun resumeWatching(): Boolean =
        watchCoordinator.resume()

    fun dispose() {
        isDisposed = true
        watchCoordinator.dispose()
    }
}
