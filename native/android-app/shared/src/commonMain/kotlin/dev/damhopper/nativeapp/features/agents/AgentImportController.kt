package dev.damhopper.nativeapp.features.agents

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ImportSource {
    REPO,
    LOCAL
}

/**
 * Snapshot of a completed scan captured by owner and scan revision.
 */
data class CapturedScanResult(
    val source: ImportSource,
    val sourceDirOrTmpDir: String,
    val scanRevision: Long,
    val items: List<RepoScanItem>
)

/**
 * UI state for the Agent Import workflow.
 */
data class AgentImportState(
    val source: ImportSource = ImportSource.REPO,
    val repoUrl: String = "",
    val dirPath: String = "",
    val scanRevision: Long = 0L,
    val capturedScan: CapturedScanResult? = null,
    val selectedItemKeys: Set<String> = emptySet(),
    val isScanning: Boolean = false,
    val isImporting: Boolean = false,
    val scanError: String? = null,
    val importError: String? = null,
    val importResults: List<ImportResult>? = null
) {
    val foundItems: List<RepoScanItem>
        get() = capturedScan?.items ?: emptyList()

    val selectedCount: Int
        get() = selectedItemKeys.size

    val allSelected: Boolean
        get() = foundItems.isNotEmpty() && selectedCount == foundItems.size
}

/**
 * Controller managing remote Git and local server directory import workflows.
 * Enforces owner fencing, scan revision invalidation on every transition, and safe cleanup derivation.
 */
class AgentImportController(
    val repository: AgentImportRepository,
    val scope: CoroutineScope,
    val profileId: String,
    val generation: Long
) {
    private val _state = MutableStateFlow(AgentImportState())
    val state: StateFlow<AgentImportState> = _state.asStateFlow()

    private var isRetired: Boolean = false
    private var scanRevision: Long = 0L

    fun retire() {
        isRetired = true
        scanRevision++
        _state.value = AgentImportState(scanRevision = scanRevision)
    }

    /**
     * Switch import source.
     * Crucial invariant: Bumps scan revision and clears pending scan and selection
     * so an old scan cannot be confirmed under a new source.
     */
    fun setSource(nextSource: ImportSource) {
        if (isRetired) return
        val nextRev = ++scanRevision
        _state.update {
            it.copy(
                source = nextSource,
                scanRevision = nextRev,
                capturedScan = null,
                selectedItemKeys = emptySet(),
                isScanning = false,
                isImporting = false,
                scanError = null,
                importError = null,
                importResults = null
            )
        }
    }

    fun setRepoUrl(url: String) {
        if (isRetired) return
        _state.update { it.copy(repoUrl = url) }
    }

    fun setDirPath(path: String) {
        if (isRetired) return
        _state.update { it.copy(dirPath = path) }
    }

    fun resetScan() {
        val nextRev = ++scanRevision
        _state.update {
            it.copy(
                scanRevision = nextRev,
                capturedScan = null,
                selectedItemKeys = emptySet(),
                isScanning = false,
                isImporting = false,
                scanError = null,
                importError = null,
                importResults = null
            )
        }
    }

    fun itemKey(item: RepoScanItem): String =
        "${item.category.wireName}:${item.name}:${item.relativePath}"

    fun toggleItem(item: RepoScanItem) {
        if (isRetired) return
        val key = itemKey(item)
        _state.update { current ->
            val nextSet = current.selectedItemKeys.toMutableSet()
            if (nextSet.contains(key)) nextSet.remove(key) else nextSet.add(key)
            current.copy(selectedItemKeys = nextSet)
        }
    }

    fun toggleSelectAll() {
        if (isRetired) return
        _state.update { current ->
            val items = current.foundItems
            val allKeys = items.map { itemKey(it) }.toSet()
            val nextKeys = if (current.selectedItemKeys.size == items.size) emptySet() else allKeys
            current.copy(selectedItemKeys = nextKeys)
        }
    }

    /**
     * Trigger scanning based on active source.
     */
    fun startScan() {
        if (isRetired || _state.value.isScanning || _state.value.isImporting) return
        val current = _state.value
        val input = if (current.source == ImportSource.REPO) current.repoUrl.trim() else current.dirPath.trim()
        if (input.isBlank()) return

        val rev = ++scanRevision
        _state.update {
            it.copy(
                scanRevision = rev,
                capturedScan = null,
                selectedItemKeys = emptySet(),
                isScanning = true,
                scanError = null,
                importError = null,
                importResults = null
            )
        }

        scope.launch {
            if (current.source == ImportSource.REPO) {
                val result = repository.scanRepo(input)
                if (isRetired || rev != scanRevision) return@launch

                result.fold(
                    onSuccess = { resp ->
                        val captured = CapturedScanResult(
                            source = ImportSource.REPO,
                            sourceDirOrTmpDir = resp.tmpDir,
                            scanRevision = rev,
                            items = resp.items
                        )
                        _state.update {
                            it.copy(
                                isScanning = false,
                                capturedScan = captured,
                                selectedItemKeys = resp.items.map { item -> itemKey(item) }.toSet()
                            )
                        }
                    },
                    onFailure = { err ->
                        _state.update { it.copy(isScanning = false, scanError = err.message ?: "Failed to scan repository") }
                    }
                )
            } else {
                val result = repository.scanLocal(input)
                if (isRetired || rev != scanRevision) return@launch

                result.fold(
                    onSuccess = { resp ->
                        val captured = CapturedScanResult(
                            source = ImportSource.LOCAL,
                            sourceDirOrTmpDir = resp.dirPath,
                            scanRevision = rev,
                            items = resp.items
                        )
                        _state.update {
                            it.copy(
                                isScanning = false,
                                capturedScan = captured,
                                selectedItemKeys = resp.items.map { item -> itemKey(item) }.toSet()
                            )
                        }
                    },
                    onFailure = { err ->
                        _state.update { it.copy(isScanning = false, scanError = err.message ?: "Failed to scan local directory") }
                    }
                )
            }
        }
    }

    /**
     * Confirm importing the selected items into the store.
     * Crucial invariant: Derives cleanup flag from capturedScan.source:
     * cleanup = (capturedScan.source == ImportSource.REPO)
     * so that server-local directories are NEVER deleted during cleanup!
     */
    fun confirmImport(onSuccess: (() -> Unit)? = null) {
        val captured = _state.value.capturedScan ?: return
        if (isRetired || _state.value.isImporting || _state.value.isScanning) return
        val selectedItems = captured.items.filter { _state.value.selectedItemKeys.contains(itemKey(it)) }
        if (selectedItems.isEmpty()) return

        val cleanup = (captured.source == ImportSource.REPO)
        _state.update { it.copy(isImporting = true, importError = null, importResults = null) }

        scope.launch {
            val result = repository.confirmImport(
                sourceDir = captured.sourceDirOrTmpDir,
                items = selectedItems,
                cleanup = cleanup
            )
            if (isRetired || captured.scanRevision != scanRevision) return@launch

            result.fold(
                onSuccess = { results ->
                    val allSuccess = results.all { it.success }
                    val anySuccess = results.any { it.success }
                    _state.update {
                        it.copy(
                            isImporting = false,
                            capturedScan = if (captured.source == ImportSource.REPO && allSuccess) null else it.capturedScan,
                            importResults = results,
                            importError = if (!allSuccess) "Some items failed to import" else null
                        )
                    }
                    if (anySuccess) {
                        onSuccess?.invoke()
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isImporting = false, importError = err.message ?: "Import confirmation failed") }
                }
            )
        }
    }
}
