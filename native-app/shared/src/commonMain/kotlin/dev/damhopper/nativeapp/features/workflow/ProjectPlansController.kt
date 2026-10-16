package dev.damhopper.nativeapp.features.workflow

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProjectPlansState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val project: String = "",
    val worktreePath: String? = null,
    val currentPath: String = "plans",
    val foldersResponse: PlanFoldersResponse? = null,
    val selectedPlanPath: String? = null,
    val selectedPlanResponse: SelectedPlanResponse? = null,
    val selectedPhase: FilePlanPhase? = null,
    val activeDocumentPath: String? = null,
    val documentReadResult: PlanDocumentReadResult? = null,
    val isLoadingDocument: Boolean = false
)

class ProjectPlansController(
    val repository: ProjectPlansRepository,
    val scope: CoroutineScope,
    initialProject: String,
    initialWorktreePath: String? = null,
    val profileId: String,
    val generation: Long
) {
    private val _state = MutableStateFlow(
        ProjectPlansState(
            project = initialProject,
            worktreePath = initialWorktreePath
        )
    )
    val state: StateFlow<ProjectPlansState> = _state.asStateFlow()

    private var activeProject: String = initialProject
    private var activeWorktreePath: String? = initialWorktreePath
    private var activeGeneration: Long = generation
    private var activeProfileId: String = profileId
    private var requestSequence: Long = 0L

    init {
        if (initialProject.isNotBlank()) {
            loadFolders("plans")
        }
    }

    fun updateTarget(newProject: String, newWorktreePath: String?, newProfileId: String, newGeneration: Long) {
        if (newProject != activeProject || newWorktreePath != activeWorktreePath ||
            newProfileId != activeProfileId || newGeneration != activeGeneration
        ) {
            activeProject = newProject
            activeWorktreePath = newWorktreePath
            activeProfileId = newProfileId
            activeGeneration = newGeneration
            _state.value = ProjectPlansState(
                project = newProject,
                worktreePath = newWorktreePath,
                currentPath = "plans"
            )
            if (newProject.isNotBlank()) {
                loadFolders("plans")
            }
        }
    }

    fun loadFolders(path: String = "plans") {
        val capturedGen = activeGeneration
        val capturedProfile = activeProfileId
        val capturedProject = activeProject
        val capturedWorktree = activeWorktreePath
        val seq = ++requestSequence
        _state.update { it.copy(isLoading = true, error = null, currentPath = path) }

        scope.launch {
            val result = repository.getPlanFolders(
                project = capturedProject,
                worktreePath = capturedWorktree,
                path = path
            )
            if (activeGeneration != capturedGen || activeProfileId != capturedProfile ||
                activeProject != capturedProject || activeWorktreePath != capturedWorktree ||
                seq != requestSequence
            ) return@launch

            result.fold(
                onSuccess = { response ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            foldersResponse = response,
                            error = null
                        )
                    }
                    if (response.kind == PlanFolderKind.PLAN) {
                        selectPlan(response.path)
                    }
                },
                onFailure = { err ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = err.message ?: "Failed to list plan folders"
                        )
                    }
                }
            )
        }
    }

    fun selectPlan(planPath: String) {
        val capturedGen = activeGeneration
        val capturedProfile = activeProfileId
        val capturedProject = activeProject
        val capturedWorktree = activeWorktreePath
        val seq = ++requestSequence
        _state.update {
            it.copy(
                isLoading = true,
                error = null,
                selectedPlanPath = planPath,
                selectedPlanResponse = null,
                selectedPhase = null,
                activeDocumentPath = null,
                documentReadResult = null
            )
        }

        scope.launch {
            val result = repository.getSelectedPlan(
                project = capturedProject,
                worktreePath = capturedWorktree,
                planPath = planPath
            )
            if (activeGeneration != capturedGen || activeProfileId != capturedProfile ||
                activeProject != capturedProject || activeWorktreePath != capturedWorktree ||
                seq != requestSequence
            ) return@launch

            result.fold(
                onSuccess = { response ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            selectedPlanResponse = response,
                            error = null
                        )
                    }
                },
                onFailure = { err ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = err.message ?: "Failed to load selected plan"
                        )
                    }
                }
            )
        }
    }

    fun selectPhase(phase: FilePlanPhase?) {
        _state.update { it.copy(selectedPhase = phase) }
    }

    fun openDocument(docPath: String) {
        val capturedGen = activeGeneration
        val capturedProfile = activeProfileId
        val capturedProject = activeProject
        val capturedWorktree = activeWorktreePath

        _state.update {
            it.copy(
                isLoadingDocument = true,
                activeDocumentPath = docPath,
                documentReadResult = null
            )
        }

        scope.launch {
            val result = repository.readPlanDocument(
                project = capturedProject,
                worktreePath = capturedWorktree,
                relativePath = docPath
            )
            if (activeGeneration != capturedGen || activeProfileId != capturedProfile ||
                activeProject != capturedProject || activeWorktreePath != capturedWorktree
            ) return@launch

            _state.update {
                it.copy(
                    isLoadingDocument = false,
                    documentReadResult = result
                )
            }
        }
    }

    fun closeDocument() {
        _state.update {
            it.copy(
                activeDocumentPath = null,
                documentReadResult = null,
                isLoadingDocument = false
            )
        }
    }

    /**
     * Handles back navigation hierarchy:
     * Document view -> Plan detail view -> Folder listing -> Parent folder.
     * Returns true if handled internally, false if top-level caller should handle (e.g. exit to TERMINAL).
     */
    fun handleBack(): Boolean {
        val current = _state.value
        if (current.activeDocumentPath != null) {
            closeDocument()
            return true
        }
        if (current.selectedPlanPath != null) {
            _state.update {
                it.copy(
                    selectedPlanPath = null,
                    selectedPlanResponse = null,
                    selectedPhase = null
                )
            }
            return true
        }
        if (current.currentPath.contains('/') && current.currentPath != "plans") {
            val parentPath = current.currentPath.substringBeforeLast('/', "plans")
            loadFolders(parentPath)
            return true
        }
        return false
    }
}
