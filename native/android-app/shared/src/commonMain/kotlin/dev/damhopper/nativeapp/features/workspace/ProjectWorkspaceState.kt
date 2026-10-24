package dev.damhopper.nativeapp.features.workspace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.damhopper.nativeapp.core.lifecycle.LifecycleAware
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.editor.CloseIntent
import dev.damhopper.nativeapp.features.editor.EditorDocumentFactory
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorTabsState
import dev.damhopper.nativeapp.features.files.FileMutationCoordinator
import dev.damhopper.nativeapp.features.files.FileOperationOutcome
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.FileTreeState
import dev.damhopper.nativeapp.ui.screens.ProjectTerminalState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Panels hosted within the focused project workspace.
 */
enum class WorkspacePanel {
    TERMINAL,
    FILES,
    EDITOR,
}

/**
 * Retained departure intent capturing voluntary exits (tab close or workspace leave)
 * with dirty document revisions to prevent data loss.
 */
sealed class WorkspaceDepartureIntent {
    data class TabClose(
        val intent: CloseIntent,
    ) : WorkspaceDepartureIntent()

    data class WorkspaceLeave(
        val targetStageName: String,
        val dirtyDocuments: List<DocumentId>,
        val dirtyRevisions: Map<DocumentId, Long>,
        val onConfirmed: () -> Unit,
    ) : WorkspaceDepartureIntent()
}

/**
 * Retained non-Activity owner for workspace documents, file tree, mutations,
 * active panel, and departure intent under a strict [WorkspaceFileOwner].
 *
 * Invariants:
 * 1. Keyed strictly by logical owner (endpoint, account user, project, worktree), not ambient target.
 * 2. Survives Activity recreation and panel switches without losing text, undo history, or tree state.
 * 3. Input activation is visibility- and lifecycle-gated: only the visible editor accepts text edits.
 * 4. Forced auth/connection loss revokes writes immediately while preserving in-memory detached buffers.
 * 5. Reconnection rebinds only exact logical owner; different owners cannot adopt detached drafts.
 * 6. True resource teardown occurs exclusively on [close], called by ViewModel.onCleared or explicit workspace destruction.
 */
class ProjectWorkspaceState(
    val owner: WorkspaceFileOwner,
    val target: ProjectTargetRef,
    initialFileRepository: FileRepository,
    initialEditorRepository: EditorRepository,
    val editorTabsState: EditorTabsState,
    val fileTreeState: FileTreeState,
    val fileMutationCoordinator: FileMutationCoordinator,
    val terminalState: ProjectTerminalState? = null,
    val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),
    var lifecycleCoordinator: LifecycleCoordinator? = null,
) : LifecycleAware {

    var fileRepository: FileRepository = initialFileRepository
        private set
    var editorRepository: EditorRepository = initialEditorRepository
        private set

    var isSavingDeparture: Boolean by mutableStateOf(false)
        internal set
    var departureError: String? by mutableStateOf(null)
        internal set

    private val _activePanel = MutableStateFlow(WorkspacePanel.TERMINAL)
    val activePanel: StateFlow<WorkspacePanel> = _activePanel.asStateFlow()

    private val _isForeground = MutableStateFlow(true)
    val isForeground: StateFlow<Boolean> = _isForeground.asStateFlow()

    private val _isAuthorityRetired = MutableStateFlow(false)
    val isAuthorityRetired: StateFlow<Boolean> = _isAuthorityRetired.asStateFlow()

    /** Whether the editor-panel file-tree sidebar is open (split view when wide, slide-over when compact). */
    val isEditorSidebarOpen = MutableStateFlow(false)

    fun toggleEditorSidebar() {
        isEditorSidebarOpen.value = !isEditorSidebarOpen.value
    }

    fun setEditorSidebarOpen(open: Boolean) {
        isEditorSidebarOpen.value = open
    }

    private val _pendingDeparture = MutableStateFlow<WorkspaceDepartureIntent?>(null)
    val pendingDeparture: StateFlow<WorkspaceDepartureIntent?> = _pendingDeparture.asStateFlow()

    init {
        updateInputGate()
    }

    /**
     * Switches the active focused panel.
     */
    fun selectPanel(panel: WorkspacePanel) {
        _activePanel.value = panel
        terminalState?.setPanelVisible(panel == WorkspacePanel.TERMINAL)
        updateInputGate()
    }

    override fun onForeground() {
        onAppForeground()
    }

    /**
     * Forwards application foreground event to workspace features.
     */
    fun onAppForeground() {
        _isForeground.value = true
        terminalState?.onForeground()
        coroutineScope.launch {
            try {
                fileTreeState.resumeWatching()
            } catch (_: Throwable) {}
        }
        updateInputGate()
    }

    override fun onBackground() {
        onAppBackground()
    }

    /**
     * Forwards application background event to pause input and watch updates.
     */
    fun onAppBackground() {
        _isForeground.value = false
        terminalState?.onBackground()
        coroutineScope.launch {
            try {
                fileTreeState.pauseWatching()
            } catch (_: Throwable) {}
        }
        updateInputGate()
    }

    override fun onOwnerRetired(profileId: String) {
        if (owner.profileId == profileId) {
            revokeAuthority()
        }
    }

    override fun onDestroy() {
        close()
    }

    /**
     * Revokes write authority synchronously on forced auth loss, disconnection,
     * or connection generation retirement.
     * Detached documents and uncommitted edits remain preserved in memory.
     */
    fun revokeAuthority() {
        _isAuthorityRetired.value = true
        terminalState?.revokeAuthority()
        updateInputGate()
    }

    /**
     * Rebinds connection authority after reconnection.
     * Rebinding is strictly permitted only if [expectedOwner] exactly matches [owner].
     */
    fun rebindAuthority(
        expectedOwner: WorkspaceFileOwner,
        newConnection: ConnectionRef? = null,
    ): Boolean {
        if (expectedOwner != owner) {
            return false
        }
        _isAuthorityRetired.value = false
        val conn = newConnection ?: owner.profileId?.let { ConnectionRef(it, 1L) }
        if (conn != null) {
            terminalState?.rebindAuthority(conn)
        }
        updateInputGate()
        return true
    }

    /**
     * Rebinds updated transport repositories while retaining all document buffers and undo history.
     */
    fun rebindTransports(
        newFileRepo: FileRepository,
        newEditorRepo: EditorRepository,
        newConnection: ConnectionRef,
    ): Boolean {
        if (newFileRepo.owner != owner) return false
        fileRepository = newFileRepo
        editorRepository = newEditorRepo
        _isAuthorityRetired.value = false
        terminalState?.rebindAuthority(newConnection)
        updateInputGate()
        return true
    }

    /**
     * Detaches native Activity widgets and Compose view adapters without
     * destroying retained document models, undo buffers, or tree state.
     */
    fun detachWidgets() {
        terminalState?.detachWidgets()
    }

    /**
     * Sets or clears the pending departure intent. Coalesces concurrent departure requests.
     */
    fun setPendingDeparture(intent: WorkspaceDepartureIntent?) {
        if (intent != null && _pendingDeparture.value != null) {
            return // Coalesce: do not overwrite active departure prompt
        }
        _pendingDeparture.value = intent
    }

    fun clearPendingDeparture() {
        _pendingDeparture.value = null
    }

    /**
     * Executes the authoritative departure save transaction.
     * Validates that all dirty documents are confirmed saved, no documents were modified
     * during save, and no other documents became dirty before committing navigation.
     */
    suspend fun commitDepartureSave(intent: WorkspaceDepartureIntent.WorkspaceLeave): Boolean {
        if (_isAuthorityRetired.value) {
            departureError = "Authority is retired; cannot commit save"
            return false
        }
        if (_pendingDeparture.value !== intent) {
            departureError = "Departure intent was cancelled or superseded"
            return false
        }
        isSavingDeparture = true
        departureError = null
        try {
            for (docId in intent.dirtyDocuments) {
                val outcome = editorRepository.saveDocument(docId)
                if (outcome !is FileOperationOutcome.Confirmed) {
                    departureError = "Save failed for ${docId.relativePath}: ${(outcome as? FileOperationOutcome.Rejected)?.message ?: "rejected"}"
                    return false
                }
            }
            if (_pendingDeparture.value !== intent) {
                departureError = "Departure intent was cancelled while saving"
                return false
            }
            // Final all-document revision transaction check
            for ((docId, initialRev) in intent.dirtyRevisions) {
                val doc = editorTabsState.getDocument(docId)
                if (doc == null || doc.isDirty.value || doc.revision.value != initialRev) {
                    departureError = "File was modified during save or missing: ${docId.relativePath}"
                    return false
                }
            }
            if (hasDirtyDocuments()) {
                departureError = "Workspace still has unsaved changes"
                return false
            }
            clearPendingDeparture()
            intent.onConfirmed()
            return true
        } catch (e: Exception) {
            departureError = "Save error: ${e.message}"
            return false
        } finally {
            isSavingDeparture = false
        }
    }

    /**
     * Returns all open dirty document IDs across the active workspace.
     */
    fun getDirtyDocumentIds(): List<DocumentId> {
        val dirtyFromSessions = editorTabsState.getDirtyDocumentIds(target, "")
        if (dirtyFromSessions.isNotEmpty()) return dirtyFromSessions
        val fromOpenTabs = editorTabsState.openTabs.value.filter { it.isDirty }.map { it.id }
        if (fromOpenTabs.isNotEmpty()) return fromOpenTabs
        return editorTabsState.tabs.value.filter { it.isDirty }.map { tab ->
            DocumentId(owner = owner, relativePath = tab.path, tabIncarnation = tab.sessionIncarnation)
        }
    }

    /**
     * Checks if any document in the workspace has uncommitted changes.
     */
    fun hasDirtyDocuments(): Boolean {
        if (editorTabsState.tabs.value.any { it.isDirty }) return true
        return editorTabsState.isDirtyTarget(target)
    }

    fun getDirtyRevisions(): Map<DocumentId, Long> {
        val dirtyIds = getDirtyDocumentIds()
        return dirtyIds.associateWith { docId ->
            val doc = editorTabsState.getDocument(docId)
            doc?.revision?.value ?: 0L
        }
    }

    private fun updateInputGate() {
        val isEligible = _isForeground.value && !_isAuthorityRetired.value
        // Authority allows saves across panels when authorized
        editorTabsState.isInputAllowed = { isEligible }
    }

    fun isInteractiveEditAllowed(): Boolean {
        return _isForeground.value && !_isAuthorityRetired.value && _activePanel.value == WorkspacePanel.EDITOR
    }

    /**
     * Idempotently frees all retained runtime resources.
     * Invoked only when the workspace is explicitly closed or host ViewModel is cleared.
     */
    fun close() {
        _isAuthorityRetired.value = true
        updateInputGate()
        lifecycleCoordinator?.unregister(this)
        terminalState?.close()
        coroutineScope.cancel()
        fileTreeState.dispose()
        editorTabsState.closeAll()
    }

    companion object {
        /**
         * Creates a new [ProjectWorkspaceState] instance with standard coordination wiring.
         */
        fun create(
            owner: WorkspaceFileOwner,
            target: ProjectTargetRef,
            fileRepository: FileRepository,
            editorRepository: EditorRepository,
            documentFactory: EditorDocumentFactory? = null,
            coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),
            lifecycleCoordinator: LifecycleCoordinator? = null,
        ): ProjectWorkspaceState {
            val tabsState = EditorTabsState(
                profileId = owner.profileId ?: "default",
                editorRepository = editorRepository,
                documentFactory = documentFactory,
            )
            val treeState = FileTreeState(
                target = target,
                repository = fileRepository,
                coroutineScope = coroutineScope,
            )
            val mutationCoordinator = FileMutationCoordinator(
                repository = fileRepository,
                treeState = treeState,
                dirtyGuardPort = tabsState,
                arbiter = fileRepository.arbiter,
                editorTabsState = tabsState,
            )
            val termState = ProjectTerminalState(
                projectName = target.project,
                connectionRef = fileRepository.apiClient.connection,
                preferencesStore = null,
                ownerScope = coroutineScope,
            )
            val created = ProjectWorkspaceState(
                owner = owner,
                target = target,
                initialFileRepository = fileRepository,
                initialEditorRepository = editorRepository,
                editorTabsState = tabsState,
                fileTreeState = treeState,
                fileMutationCoordinator = mutationCoordinator,
                terminalState = termState,
                coroutineScope = coroutineScope,
                lifecycleCoordinator = lifecycleCoordinator,
            )
            lifecycleCoordinator?.register(created)
            return created
        }
    }
}
