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
import dev.damhopper.nativeapp.features.settings.ExplorerLanguageFilter


enum class LanguageScanStatus { IDLE, LOADING, READY, FAILED }

/**
 * Family scan state. [tree] is the ancestor tree of exactly the files whose authoritative server family matches
 * [filter]; [truncated] (with [limit]) marks a partial result.
 */
data class LanguageScanState(
    val filter: ExplorerLanguageFilter = ExplorerLanguageFilter.ALL,
    val status: LanguageScanStatus = LanguageScanStatus.IDLE,
    val tree: FileTreeNode? = null,
    val truncated: Boolean = false,
    val limit: Long = 0L,
    val error: String? = null,
)

/**
 * Builds the retained ancestor tree for [filter] from authoritative family metadata: only files whose server
 * `language` equals the filter's wire value appear (no guessed extension/known equivalence), with every ancestor
 * directory expanded. Paths with empty/`..` segments are rejected rather than normalized.
 */
fun buildLanguageTree(
    target: ProjectTargetRef,
    files: List<LanguageFileDto>,
    filter: ExplorerLanguageFilter,
): FileTreeNode {
    class Builder(val path: String, val name: String) {
        val dirs = LinkedHashMap<String, Builder>()
        val leaves = mutableListOf<FileTreeNode>()
    }
    val root = Builder("", target.project)
    for (file in files) {
        if (filter == ExplorerLanguageFilter.ALL || file.language != filter.wire) continue
        val segments = file.path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }
        if (segments.isEmpty() || segments.any { it == ".." }) continue
        var dir = root
        for (segment in segments.dropLast(1)) {
            val childPath = if (dir.path.isEmpty()) segment else "${dir.path}/$segment"
            dir = dir.dirs.getOrPut(segment) { Builder(childPath, segment) }
        }
        val name = segments.last()
        val filePath = if (dir.path.isEmpty()) name else "${dir.path}/$name"
        dir.leaves += FileTreeNode(target, filePath, name, isDirectory = false, size = file.size, mtime = file.mtime)
    }
    fun materialize(b: Builder): FileTreeNode = FileTreeNode(
        target = target,
        path = b.path,
        name = b.name,
        isDirectory = true,
        isExpanded = true,
        children = b.dirs.values.sortedBy { it.name.lowercase() }.map { materialize(it) } + b.leaves.sortedBy { it.name.lowercase() },
    )
    return materialize(root)
}

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
    repository: FileRepository,
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    watchCoordinator: FileWatchCoordinator? = null,
) {
    var repository: FileRepository = repository
        private set

    var watchCoordinator: FileWatchCoordinator = watchCoordinator ?: FileWatchCoordinator(
        target = target,
        repository = repository,
        coroutineScope = coroutineScope,
    )
        private set
    @Volatile
    private var isDisposed: Boolean = false

    @Volatile
    private var initialLoadJob: kotlinx.coroutines.Job? = null
    private var connectionStateJob: kotlinx.coroutines.Job? = null
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

    private val _languageFilter = MutableStateFlow(ExplorerLanguageFilter.ALL)

    /** The applied Explorer language filter (ALL = ordinary tree). */
    val languageFilter: StateFlow<ExplorerLanguageFilter> = _languageFilter.asStateFlow()

    private val _languageScan = MutableStateFlow(LanguageScanState())

    /** Result/progress/error of the family scan behind a non-ALL [languageFilter]. */
    val languageScan: StateFlow<LanguageScanState> = _languageScan.asStateFlow()

    @Volatile
    private var scanTicket: Long = 0L
    private var scanJob: kotlinx.coroutines.Job? = null

    init {
        wireWatchCoordinator(this.watchCoordinator)
        initialLoadJob = coroutineScope.launch {
            initTreeAndSubscriptionInternal()
        }
        connectionStateJob = coroutineScope.launch {
            observeConnectionState()
        }
    }

    private fun wireWatchCoordinator(coordinator: FileWatchCoordinator) {
        coordinator.onRefetchExplorerDirectory = { dirPath ->
            refreshDirectoryOrdered(dirPath)
        }
        coordinator.onOverflowNotice = { _, _ ->
            _error.value = "Watcher overflow recovered"
        }
    }

    fun rebindRepository(newRepo: FileRepository): Boolean {
        if (newRepo.owner != this.repository.owner) return false
        this.repository = newRepo
        connectionStateJob?.cancel()
        this.watchCoordinator.dispose()
        val newCoordinator = FileWatchCoordinator(
            target = target,
            repository = newRepo,
            coroutineScope = coroutineScope,
        )
        wireWatchCoordinator(newCoordinator)
        this.watchCoordinator = newCoordinator
        _connectionStatus.value = resolveInitialConnectionStatus()
        connectionStateJob = coroutineScope.launch {
            observeConnectionState()
        }
        val expanded = collectExpandedPaths(_root.value)
        coroutineScope.launch {
            for (dir in expanded) {
                watchCoordinator.acquireExplorerDemand(dir)
            }
        }
        return true
    }

    private fun collectExpandedPaths(node: FileTreeNode): Set<String> {
        val paths = mutableSetOf<String>()
        if (node.isDirectory && node.isExpanded) {
            paths.add(node.path)
            for (child in node.children) {
                paths.addAll(collectExpandedPaths(child))
            }
        }
        return paths
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

    /**
     * Reveals [path] in the current view: in the ordinary tree every ancestor directory is loaded/expanded in
     * order through the ordered listing (a failed ancestor stops the reveal and leaves the error visible), in a
     * language-family view the path is only selected when that view contains it. Documents are never touched.
     */
    fun revealPath(path: String) {
        if (isDisposed) return
        val clean = path.replace('\\', '/').trim('/').trim()
        if (clean.isEmpty()) return
        if (_languageFilter.value != ExplorerLanguageFilter.ALL) {
            val tree = _languageScan.value.tree
            if (tree != null && FileTreeHelpers.findNode(tree, clean) != null) _selectedPath.value = clean
            return
        }
        coroutineScope.launch {
            var dir = ""
            for (segment in clean.split('/').filter { it.isNotEmpty() }.dropLast(1)) {
                dir = if (dir.isEmpty()) segment else "$dir/$segment"
                val node = FileTreeHelpers.findNode(_root.value, dir)
                if (node == null || !node.isExpanded) {
                    if (!loadDirectorySuspending(dir)) return@launch
                }
            }
            if (!isDisposed) _selectedPath.value = clean
        }
    }

    fun rekeyPath(oldPath: String, newPath: String) {
        val cleanOld = watchCoordinator.normalizeDirectoryPath(oldPath)
        val cleanNew = watchCoordinator.normalizeDirectoryPath(newPath)
        val oldPrefix = if (cleanOld.isEmpty()) "" else "$cleanOld/"
        val sel = _selectedPath.value
        if (sel != null && (sel == cleanOld || FileOperationArbiter.isPathAncestorOrEqual(cleanOld, sel))) {
            _selectedPath.value = if (sel == cleanOld) cleanNew else cleanNew + "/" + sel.removePrefix(oldPrefix)
        }

        // Rekey active watch subscriptions under cleanOld to cleanNew
        val oldDemands = watchCoordinator.activeSubscriptions.value.keys.filter {
            it == cleanOld || FileOperationArbiter.isPathAncestorOrEqual(cleanOld, it)
        }
        for (oldSub in oldDemands) {
            val newSub = if (oldSub == cleanOld) cleanNew else cleanNew + "/" + oldSub.removePrefix(oldPrefix)
            watchCoordinator.releaseExplorerDemandImmediate(oldSub)
            if (newSub.isNotEmpty()) {
                coroutineScope.launch {
                    watchCoordinator.acquireExplorerDemand(newSub)
                }
            }
        }

        // Recursively rekey loaded tree nodes
        fun rekeyNode(node: FileTreeNode): FileTreeNode {
            val rekeyedPath = if (node.path == cleanOld) {
                cleanNew
            } else if (cleanOld.isNotEmpty() && node.path.startsWith(oldPrefix)) {
                cleanNew + "/" + node.path.removePrefix(oldPrefix)
            } else {
                node.path
            }
            val rekeyedName = if (rekeyedPath.isEmpty() || node.path.isEmpty()) node.name else rekeyedPath.substringAfterLast('/')
            return node.copy(
                path = rekeyedPath,
                name = rekeyedName,
                children = node.children.map { rekeyNode(it) },
            )
        }
        _root.value = rekeyNode(_root.value)
    }

    fun handleConfirmedDeletion(deletedPath: String) {
        val clean = watchCoordinator.normalizeDirectoryPath(deletedPath)
        val sel = _selectedPath.value
        if (sel != null && (sel == clean || FileOperationArbiter.isPathAncestorOrEqual(clean, sel))) {
            _selectedPath.value = null
        }
        for (subDir in watchCoordinator.activeSubscriptions.value.keys.toList()) {
            if (subDir == clean || FileOperationArbiter.isPathAncestorOrEqual(clean, subDir)) {
                if (subDir.isNotEmpty()) {
                    watchCoordinator.releaseExplorerDemandImmediate(subDir)
                }
            }
        }
    }

    fun setShowHidden(show: Boolean) {
        _showHidden.value = show
    }

    /**
     * Applies the synchronized Explorer language filter. [ExplorerLanguageFilter.ALL] uses the ordinary lazy
     * tree and never scans. A family filter requests the bounded project scan for exactly this state's
     * [target]; results are fenced by a ticket (filter change, refresh or disposal supersedes them), failures and
     * truncation stay visible in [languageScan], and neither ever touches open documents or other owners.
     * The selection is only cleared when the new view does not contain it.
     */
    fun setLanguageFilter(filter: ExplorerLanguageFilter, rescan: Boolean = false) {
        if (isDisposed) return
        val current = _languageScan.value
        if (!rescan && _languageFilter.value == filter &&
            (filter == ExplorerLanguageFilter.ALL || current.status != LanguageScanStatus.FAILED)
        ) {
            return
        }
        scanTicket++
        scanJob?.cancel()
        _languageFilter.value = filter
        if (filter == ExplorerLanguageFilter.ALL) {
            _languageScan.value = LanguageScanState()
            return
        }
        val ticket = scanTicket
        _languageScan.value = LanguageScanState(filter = filter, status = LanguageScanStatus.LOADING)
        scanJob = coroutineScope.launch {
            try {
                val response = repository.languageFiles(target)
                if (isDisposed || ticket != scanTicket || _languageFilter.value != filter) return@launch
                val tree = buildLanguageTree(target, response.files, filter)
                _languageScan.value = LanguageScanState(
                    filter = filter,
                    status = LanguageScanStatus.READY,
                    tree = tree,
                    truncated = response.truncated,
                    limit = response.limit,
                )
                val selected = _selectedPath.value
                if (selected != null && FileTreeHelpers.findNode(tree, selected) == null) _selectedPath.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (isDisposed || ticket != scanTicket || _languageFilter.value != filter) return@launch
                _languageScan.value = LanguageScanState(
                    filter = filter,
                    status = LanguageScanStatus.FAILED,
                    error = e.message ?: "Language scan failed",
                )
            }
        }
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
        if (_languageFilter.value != ExplorerLanguageFilter.ALL) setLanguageFilter(_languageFilter.value, rescan = true)
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
        connectionStateJob?.cancel()
        initialLoadJob?.cancel()
        scanTicket++
        scanJob?.cancel()
        watchCoordinator.dispose()
    }
}
