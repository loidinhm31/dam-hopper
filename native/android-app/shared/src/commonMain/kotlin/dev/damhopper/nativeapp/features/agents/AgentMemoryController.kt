package dev.damhopper.nativeapp.features.agents

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class MemorySaveStatus {
    IDLE,
    SAVED,
    ERROR
}

/**
 * UI state for the Agent Memory editor, templates, and target selection.
 */
data class AgentMemoryState(
    val projects: List<String> = emptyList(),
    val selectedProject: String? = null,
    val selectedAgent: AgentType = AgentType.CLAUDE,
    val loadedProject: String? = null,
    val loadedAgent: AgentType? = null,
    val content: String = "",
    val initialSavedContent: String = "",
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val saveStatus: MemorySaveStatus = MemorySaveStatus.IDLE,
    val error: String? = null,
    val templates: List<MemoryTemplateInfo> = emptyList(),
    val selectedTemplateName: String? = null,
    val previewContent: String? = null,
    val initialPreviewContent: String? = null,
    val isApplyingTemplate: Boolean = false,
    val pendingTargetSwitch: Pair<String, AgentType>? = null,
    val showDiscardPreviewConfirm: Boolean = false,
    val showOverwriteDraftConfirmForPreview: Boolean = false
) {
    val isDirty: Boolean
        get() = content != initialSavedContent

    val isPreviewEdited: Boolean
        get() = previewContent != null && initialPreviewContent != null && previewContent != initialPreviewContent
}

/**
 * Controller managing Agent Memory editing, template previewing, and safe saves.
 * Enforces immutable connection owner fencing, monotonic operation revisions, and dirty draft protection.
 */
class AgentMemoryController(
    val repository: AgentMemoryRepository,
    val scope: CoroutineScope,
    val profileId: String,
    val generation: Long
) {
    private val _state = MutableStateFlow(AgentMemoryState())
    val state: StateFlow<AgentMemoryState> = _state.asStateFlow()

    private var isRetired: Boolean = false
    private var readOpRevision: Long = 0L
    private var templateOpRevision: Long = 0L
    private var saveOpRevision: Long = 0L

    fun retire() {
        isRetired = true
        _state.value = AgentMemoryState()
    }

    /**
     * Set available workspace projects.
     * Automatically selects the first project if none is currently selected.
     */
    fun setProjects(projectNames: List<String>) {
        if (isRetired) return
        val current = _state.value
        val currentProj = current.selectedProject

        if (currentProj == null) {
            val first = projectNames.firstOrNull()
            _state.update { it.copy(projects = projectNames, selectedProject = first) }
            loadTemplates()
            if (first != null) {
                loadMemory(first, current.selectedAgent)
            }
        } else if (projectNames.contains(currentProj)) {
            _state.update { it.copy(projects = projectNames) }
            loadTemplates()
        } else {
            val nextProj = projectNames.firstOrNull()
            _state.update { it.copy(projects = projectNames) }
            loadTemplates()
            if (current.isDirty && nextProj != null) {
                _state.update { it.copy(pendingTargetSwitch = Pair(nextProj, current.selectedAgent)) }
            } else if (nextProj != null) {
                loadMemory(nextProj, current.selectedAgent)
            } else {
                _state.update { it.copy(selectedProject = null, loadedProject = null, content = "", initialSavedContent = "") }
            }
        }
    }

    fun loadTemplates() {
        if (isRetired) return
        scope.launch {
            val result = repository.listTemplates()
            if (isRetired) return@launch

            result.onSuccess { templateList ->
                _state.update { it.copy(templates = templateList) }
            }
        }
    }

    fun loadMemory(projectName: String, agent: AgentType) {
        if (isRetired) return
        val opRev = ++readOpRevision
        val isSameTarget = _state.value.loadedProject == projectName && _state.value.loadedAgent == agent
        _state.update {
            it.copy(
                selectedProject = projectName,
                selectedAgent = agent,
                loadedProject = if (isSameTarget) projectName else null,
                loadedAgent = if (isSameTarget) agent else null,
                content = if (isSameTarget) it.content else "",
                initialSavedContent = if (isSameTarget) it.initialSavedContent else "",
                isLoading = true,
                error = null,
                previewContent = null,
                initialPreviewContent = null,
                saveStatus = MemorySaveStatus.IDLE
            )
        }

        scope.launch {
            val result = repository.getProjectMemory(projectName, agent)
            if (isRetired || opRev != readOpRevision) return@launch

            result.fold(
                onSuccess = { fetchedContent ->
                    val text = fetchedContent ?: ""
                    _state.update { current ->
                        if (current.selectedProject == projectName && current.selectedAgent == agent) {
                            current.copy(
                                isLoading = false,
                                loadedProject = projectName,
                                loadedAgent = agent,
                                content = text,
                                initialSavedContent = text,
                                saveStatus = MemorySaveStatus.IDLE
                            )
                        } else current
                    }
                },
                onFailure = { err ->
                    _state.update { current ->
                        if (current.selectedProject == projectName && current.selectedAgent == agent) {
                            current.copy(
                                isLoading = false,
                                loadedProject = null,
                                loadedAgent = null,
                                error = err.message ?: "Failed to read memory file"
                            )
                        } else current
                    }
                }
            )
        }
    }

    /**
     * Request switching target project or agent.
     * If the editor has unsaved changes or an edited preview, prompts user for confirmation.
     */
    fun requestTargetSwitch(projectName: String, agent: AgentType) {
        if (isRetired) return
        val current = _state.value
        if (current.selectedProject == projectName && current.selectedAgent == agent) return

        if (current.isDirty || current.isPreviewEdited) {
            _state.update { it.copy(pendingTargetSwitch = Pair(projectName, agent)) }
        } else {
            loadMemory(projectName, agent)
        }
    }

    fun confirmTargetSwitch() {
        val target = _state.value.pendingTargetSwitch ?: return
        _state.update { it.copy(pendingTargetSwitch = null) }
        loadMemory(target.first, target.second)
    }

    fun cancelTargetSwitch() {
        _state.update { it.copy(pendingTargetSwitch = null) }
    }

    fun updateContent(newContent: String) {
        if (isRetired) return
        _state.update { it.copy(content = newContent, saveStatus = MemorySaveStatus.IDLE, error = null) }
    }

    fun updatePreviewContent(newPreview: String) {
        if (isRetired) return
        _state.update { it.copy(previewContent = newPreview) }
    }

    fun selectTemplate(templateName: String) {
        if (isRetired) return
        _state.update { it.copy(selectedTemplateName = templateName) }
    }

    /**
     * Preview applying a template.
     * Crucial invariant: Only populates local previewContent. Does NOT write to server file.
     */
    fun applyTemplatePreview(templateName: String) {
        val proj = _state.value.selectedProject ?: return
        val agent = _state.value.selectedAgent
        if (isRetired) return

        val opRev = ++templateOpRevision
        _state.update { it.copy(isApplyingTemplate = true, error = null) }

        scope.launch {
            val result = repository.applyTemplate(
                projectName = proj,
                agent = agent,
                templateName = templateName,
                write = false
            )
            if (isRetired || opRev != templateOpRevision) return@launch

            result.fold(
                onSuccess = { rendered ->
                    _state.update { current ->
                        if (current.selectedProject == proj && current.selectedAgent == agent) {
                            current.copy(
                                isApplyingTemplate = false,
                                previewContent = rendered,
                                initialPreviewContent = rendered
                            )
                        } else {
                            current.copy(isApplyingTemplate = false)
                        }
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isApplyingTemplate = false, error = err.message ?: "Failed to apply template") }
                }
            )
        }
    }

    fun requestDiscardPreview() {
        if (_state.value.isPreviewEdited) {
            _state.update { it.copy(showDiscardPreviewConfirm = true) }
        } else {
            discardPreview()
        }
    }

    fun confirmDiscardPreview() {
        _state.update { it.copy(showDiscardPreviewConfirm = false) }
        discardPreview()
    }

    fun cancelDiscardPreview() {
        _state.update { it.copy(showDiscardPreviewConfirm = false) }
    }

    private fun discardPreview() {
        _state.update { it.copy(previewContent = null, initialPreviewContent = null) }
    }

    fun adoptPreviewIntoEditor() {
        val preview = _state.value.previewContent ?: return
        _state.update { it.copy(content = preview, previewContent = null, initialPreviewContent = null) }
    }

    fun requestAdoptPreview() {
        if (_state.value.isDirty) {
            _state.update { it.copy(showOverwriteDraftConfirmForPreview = true) }
        } else {
            adoptPreviewIntoEditor()
        }
    }

    fun confirmAdoptPreview() {
        _state.update { it.copy(showOverwriteDraftConfirmForPreview = false) }
        adoptPreviewIntoEditor()
    }

    fun cancelAdoptPreview() {
        _state.update { it.copy(showOverwriteDraftConfirmForPreview = false) }
    }

    /**
     * Saves the current content buffer to the remote server.
     * Captures content snapshot: if user edits during save, newer edits remain dirty.
     */
    fun saveMemory() {
        val proj = _state.value.selectedProject ?: return
        val agent = _state.value.selectedAgent
        if (isRetired) return

        val capturedContent = _state.value.content
        val opRev = ++saveOpRevision
        _state.update { it.copy(isSaving = true, saveStatus = MemorySaveStatus.IDLE, error = null) }

        scope.launch {
            val result = repository.updateProjectMemory(proj, agent, capturedContent)
            if (isRetired || opRev != saveOpRevision) return@launch

            result.fold(
                onSuccess = {
                    _state.update { current ->
                        if (current.selectedProject == proj && current.selectedAgent == agent) {
                            val stillMatches = current.content == capturedContent
                            current.copy(
                                isSaving = false,
                                saveStatus = MemorySaveStatus.SAVED,
                                initialSavedContent = capturedContent
                            )
                        } else current.copy(isSaving = false)
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isSaving = false, saveStatus = MemorySaveStatus.ERROR, error = err.message ?: "Failed to save memory") }
                }
            )
        }
    }

    /**
     * Directly saves the preview content as the authoritative memory file.
     */
    fun savePreviewAsMemory() {
        val preview = _state.value.previewContent ?: return
        val proj = _state.value.selectedProject ?: return
        val agent = _state.value.selectedAgent
        if (isRetired) return

        val capturedContent = preview
        val opRev = ++saveOpRevision
        _state.update { it.copy(isSaving = true, saveStatus = MemorySaveStatus.IDLE, error = null) }

        scope.launch {
            val result = repository.updateProjectMemory(proj, agent, capturedContent)
            if (isRetired || opRev != saveOpRevision) return@launch

            result.fold(
                onSuccess = {
                    _state.update { current ->
                        if (current.selectedProject == proj && current.selectedAgent == agent) {
                            current.copy(
                                isSaving = false,
                                content = capturedContent,
                                initialSavedContent = capturedContent,
                                previewContent = null,
                                initialPreviewContent = null,
                                saveStatus = MemorySaveStatus.SAVED
                            )
                        } else current.copy(isSaving = false)
                    }
                },
                onFailure = { err ->
                    _state.update { it.copy(isSaving = false, saveStatus = MemorySaveStatus.ERROR, error = err.message ?: "Failed to save preview as memory") }
                }
            )
        }
    }
}
