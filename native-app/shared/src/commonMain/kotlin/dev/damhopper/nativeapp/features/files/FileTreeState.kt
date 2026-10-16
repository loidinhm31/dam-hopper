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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Observable controller managing lazy directory tree expansion, selection,
 * WebSocket subscription lifecycle, event invalidations, and overflow recovery.
 */
class FileTreeState(
    val target: ProjectTargetRef,
    private val repository: FileRepository,
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
) {
    private val mutex = Mutex()
    @Volatile
    private var subscriptionGeneration: ULong = 0uL
    @Volatile
    private var isDisposed: Boolean = false
    private var activeSubscription: FileTreeSubscription? = null

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

    init {
        coroutineScope.launch {
            initTreeAndSubscription()
            observeConnectionState()
        }
    }

    private suspend fun observeConnectionState() {
        repository.wsConnection.state.collect { wsState ->
            if (!isDisposed && wsState is WsState.Connected && activeSubscription == null) {
                try { resubscribeLocked() } catch (_: Throwable) { _error.value = "Directory watcher offline" }
            }
        }
    }

    suspend fun initTreeAndSubscription() {
        if (isDisposed) return
        _isLoading.value = true
        _error.value = null
        try {
            resubscribeLocked()
            val rootEntries = repository.listDirectory(target, "")
            _root.value = FileTreeHelpers.updateChildren(_root.value, "", rootEntries, target)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            _error.value = e.message ?: "Failed to load directory"
        } finally {
            _isLoading.value = false
        }
    }

    private suspend fun resubscribeLocked() = mutex.withLock {
        if (isDisposed) return@withLock
        activeSubscription?.cancel()
        activeSubscription = null
        val currentGen = ++subscriptionGeneration

        try {
            activeSubscription = repository.subscribeTree(
                target = target,
                path = "",
                watchOnly = true,
                onSnapshot = { /* Baseline loaded via REST */ },
                onEvent = { event ->
                    if (subscriptionGeneration == currentGen && !isDisposed) handleFsEvent(event)
                },
                onOverflow = { message ->
                    if (subscriptionGeneration == currentGen && !isDisposed) handleFsOverflow(message)
                },
            )
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            _error.value = "Directory watcher offline"
        }
    }

    fun toggleFolder(path: String) {
        val node = FileTreeHelpers.findNode(_root.value, path) ?: return
        if (!node.isDirectory) return

        if (node.isExpanded) {
            _root.value = FileTreeHelpers.updateNode(_root.value, path) { it.copy(isExpanded = false) }
        } else {
            loadDirectory(path)
        }
    }

    fun loadDirectory(path: String) {
        if (isDisposed) return
        coroutineScope.launch {
            _root.value = FileTreeHelpers.updateNode(_root.value, path) { it.copy(isLoading = true, error = null) }
            try {
                val entries = repository.listDirectory(target, path)
                _root.value = FileTreeHelpers.updateChildren(_root.value, path, entries, target)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _root.value = FileTreeHelpers.updateNode(_root.value, path) {
                    it.copy(isLoading = false, error = e.message ?: "Failed to read folder")
                }
            }
        }
    }

    fun selectPath(path: String?) { _selectedPath.value = path }
    fun setShowHidden(show: Boolean) { _showHidden.value = show }
    fun setError(err: String?) { _error.value = err }

    fun refresh() {
        coroutineScope.launch { initTreeAndSubscription() }
    }

    fun handleFsEvent(event: FsEventDto) {
        if (isDisposed) return
        coroutineScope.launch {
            val targetRel = event.targetRelativePath?.trim('/') ?: ""
            val relPath = if (targetRel == "." || targetRel.isEmpty()) "" else targetRel
            val parentPath = if (relPath.isEmpty()) "" else FileTreeHelpers.resolveParentPath(relPath)
            refreshDirectoryIfLoaded(parentPath)

            event.targetRelativeFrom?.let { fromRaw ->
                val fromClean = fromRaw.trim('/')
                val fromPath = if (fromClean == "." || fromClean.isEmpty()) "" else fromClean
                val fromParent = if (fromPath.isEmpty()) "" else FileTreeHelpers.resolveParentPath(fromPath)
                if (fromParent != parentPath) refreshDirectoryIfLoaded(fromParent)
            }
        }
    }

    private suspend fun refreshDirectoryIfLoaded(dirPath: String) {
        val node = FileTreeHelpers.findNode(_root.value, dirPath)
        if (node != null && (node.isExpanded || dirPath.isEmpty())) {
            try {
                val entries = repository.listDirectory(target, dirPath)
                _root.value = FileTreeHelpers.updateChildren(_root.value, dirPath, entries, target)
            } catch (_: Throwable) {}
        }
    }

    fun handleFsOverflow(message: String) {
        if (isDisposed) return
        _error.value = "Watcher overflow recovered"
        coroutineScope.launch {
            resubscribeLocked()
            refreshLoadedDirectories(_root.value)
        }
    }

    private suspend fun refreshLoadedDirectories(node: FileTreeNode) {
        if (node.isDirectory && node.isExpanded) {
            try {
                val entries = repository.listDirectory(target, node.path)
                _root.value = FileTreeHelpers.updateChildren(_root.value, node.path, entries, target)
            } catch (_: Throwable) {}
            node.children.forEach { refreshLoadedDirectories(it) }
        }
    }

    fun dispose() {
        isDisposed = true
        coroutineScope.launch {
            mutex.withLock {
                activeSubscription?.cancel()
                activeSubscription = null
            }
        }
    }
}
