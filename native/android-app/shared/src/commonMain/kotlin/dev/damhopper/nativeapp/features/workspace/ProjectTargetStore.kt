package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.normalizeProjectTargetPath
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray

/**
 * Thread-safe, reactive store for project targets (root vs worktree) with strict workspace
 * revision fencing and explicit unavailable-target failure semantics.
 */
class ProjectTargetStore {

    data class State(
        val activeTargetByProject: Map<String, String?> = emptyMap(),
        val unavailableTargetByProject: Map<String, String> = emptyMap(),
        val unavailableTargetsByProject: Map<String, Set<String>> = emptyMap(),
        val knownWorktreesByProject: Map<String, List<ProjectWorktree>> = emptyMap(),
        val workspaceRevisionByProfile: Map<String, Long> = emptyMap(),
        val activeWorkspaceConfigPath: Map<String, String> = emptyMap(),
        val activeWorkspaceRoot: Map<String, String> = emptyMap(),
        val activeWorkspaceEpoch: Map<String, Long> = emptyMap(),
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    fun getWorkspaceRevision(profileId: ProfileId?): Long {
        return _state.value.workspaceRevisionByProfile[profileId.orEmpty()] ?: 0L
    }

    fun getActiveWorkspaceConfigPath(profileId: ProfileId?): String? {
        return _state.value.activeWorkspaceConfigPath[profileId.orEmpty()]
            ?: _state.value.activeWorkspaceRoot[profileId.orEmpty()]
    }

    fun getActiveWorkspaceRoot(profileId: ProfileId?): String? {
        return _state.value.activeWorkspaceRoot[profileId.orEmpty()]
    }

    fun getActiveWorkspaceEpoch(profileId: ProfileId?): Long? {
        return _state.value.activeWorkspaceEpoch[profileId.orEmpty()]
    }

    /**
     * Called when active workspace changes (via switch or server event).
     * Bumps revision counter and updates active workspace root, epoch, and config path.
     */
    fun invalidateWorkspace(
        profileId: ProfileId?,
        newWorkspaceRoot: String? = null,
        epoch: Long? = null,
        configPath: String? = null,
    ) {
        val profKey = profileId.orEmpty()
        _state.update { current ->
            val nextRev = (current.workspaceRevisionByProfile[profKey] ?: 0L) + 1L
            val resolvedConfigPath = configPath
                ?: (if (newWorkspaceRoot?.endsWith(".toml") == true) newWorkspaceRoot else current.activeWorkspaceConfigPath[profKey])
            current.copy(
                workspaceRevisionByProfile = current.workspaceRevisionByProfile + (profKey to nextRev),
                activeWorkspaceRoot = if (newWorkspaceRoot != null) {
                    current.activeWorkspaceRoot + (profKey to newWorkspaceRoot)
                } else {
                    current.activeWorkspaceRoot - profKey
                },
                activeWorkspaceEpoch = if (epoch != null) {
                    current.activeWorkspaceEpoch + (profKey to epoch)
                } else {
                    current.activeWorkspaceEpoch - profKey
                },
                activeWorkspaceConfigPath = if (resolvedConfigPath != null) {
                    current.activeWorkspaceConfigPath + (profKey to resolvedConfigPath)
                } else {
                    current.activeWorkspaceConfigPath - profKey
                },
            )
        }
    }

    /**
     * Selects either project root (worktreePath == null) or a worktree target.
     */
    fun selectTarget(
        profileId: ProfileId?,
        workspaceConfigPath: String?,
        project: String,
        worktreePath: String?,
    ) {
        val key = projectScopeKey(profileId, workspaceConfigPath, project)
        val normalized = normalizeProjectTargetPath(worktreePath)
        _state.update { current ->
            current.copy(
                activeTargetByProject = current.activeTargetByProject + (key to normalized)
            )
        }
    }

    /**
     * Resets selected target for project back to root.
     */
    fun resetTargetToRoot(
        profileId: ProfileId?,
        workspaceConfigPath: String?,
        project: String,
    ) {
        val key = projectScopeKey(profileId, workspaceConfigPath, project)
        _state.update { current ->
            current.copy(
                activeTargetByProject = current.activeTargetByProject + (key to null),
                unavailableTargetByProject = current.unavailableTargetByProject - key,
                unavailableTargetsByProject = current.unavailableTargetsByProject - key,
            )
        }
    }

    /**
     * Updates discovered worktrees for a project. Reconciles current active target:
     * if the active target was a worktree and is no longer selectable, marks it unavailable
     * without silently redirecting to root.
     */
    fun setKnownWorktrees(
        profileId: ProfileId?,
        workspaceConfigPath: String?,
        project: String,
        worktrees: List<ProjectWorktree>,
    ) {
        val key = projectScopeKey(profileId, workspaceConfigPath, project)
        _state.update { current ->
            val activeWt = current.activeTargetByProject[key]
            var nextUnavailable = current.unavailableTargetsByProject[key] ?: emptySet()
            var lastUnavailable = current.unavailableTargetByProject[key]

            if (activeWt != null) {
                val matched = worktrees.find { normalizeProjectTargetPath(it.path) == activeWt }
                if (matched == null || !matched.isSelectable) {
                    nextUnavailable = nextUnavailable + activeWt
                    lastUnavailable = activeWt
                } else {
                    nextUnavailable = nextUnavailable - activeWt
                    if (lastUnavailable == activeWt) {
                        lastUnavailable = null
                    }
                }
            }

            current.copy(
                knownWorktreesByProject = current.knownWorktreesByProject + (key to worktrees),
                unavailableTargetsByProject = if (nextUnavailable.isEmpty()) {
                    current.unavailableTargetsByProject - key
                } else {
                    current.unavailableTargetsByProject + (key to nextUnavailable)
                },
                unavailableTargetByProject = if (lastUnavailable == null) {
                    current.unavailableTargetByProject - key
                } else {
                    current.unavailableTargetByProject + (key to lastUnavailable)
                }
            )
        }
    }

    /**
     * Marks a specific worktree target as unavailable.
     * Retains selection so UI can show explicit unavailable state rather than silent redirect.
     */
    fun markTargetUnavailable(
        profileId: ProfileId?,
        workspaceConfigPath: String?,
        project: String,
        worktreePath: String,
    ) {
        val key = projectScopeKey(profileId, workspaceConfigPath, project)
        val normalized = normalizeProjectTargetPath(worktreePath) ?: return
        _state.update { current ->
            val existing = current.unavailableTargetsByProject[key] ?: emptySet()
            current.copy(
                unavailableTargetsByProject = current.unavailableTargetsByProject + (key to (existing + normalized)),
                unavailableTargetByProject = current.unavailableTargetByProject + (key to normalized),
            )
        }
    }

    /**
     * Builds the current snapshot for a project target.
     * Invariant: Never silently redirects unavailable targets to root.
     */
    fun getSnapshot(
        profileId: ProfileId?,
        workspaceConfigPath: String?,
        project: String,
    ): ProjectTargetSnapshot {
        val current = _state.value
        val key = projectScopeKey(profileId, workspaceConfigPath, project)
        val selectedWt = current.activeTargetByProject[key]
        val revision = current.workspaceRevisionByProfile[profileId.orEmpty()] ?: 0L
        val root = current.activeWorkspaceRoot[profileId.orEmpty()]
        val epoch = current.activeWorkspaceEpoch[profileId.orEmpty()]
        val targetKey = ProjectTargetSnapshot.buildStructuredTargetKey(
            profileId = profileId,
            workspaceConfigPath = workspaceConfigPath,
            project = project,
            worktreePath = selectedWt,
            workspaceRoot = root,
            workspaceRevision = revision,
        )
        if (selectedWt == null) {
            return ProjectTargetSnapshot(
                profileId = profileId,
                workspaceConfigPath = workspaceConfigPath,
                workspaceRevision = revision,
                project = project,
                target = ProjectTargetRef(profileId = profileId, project = project, worktreePath = null),
                targetKey = targetKey,
                label = ProjectTargetSnapshot.ROOT_TARGET_LABEL,
                isRoot = true,
                isAvailable = true,
                statusLabel = "Configured root",
                worktree = null,
                workspaceRoot = root,
                workspaceEpoch = epoch,
            )
        }

        val worktrees = current.knownWorktreesByProject[key] ?: emptyList()
        val matchedWt = worktrees.find { normalizeProjectTargetPath(it.path) == selectedWt }
        val isExplicitlyUnavailable = current.unavailableTargetsByProject[key]?.contains(selectedWt) == true

        val (isAvailable, statusLabel) = when {
            matchedWt != null -> matchedWt.isSelectable to matchedWt.statusLabel
            isExplicitlyUnavailable -> false to "Target unavailable"
            else -> false to "Unverified target"
        }

        val label = matchedWt?.branch?.ifBlank { selectedWt } ?: selectedWt

        return ProjectTargetSnapshot(
            profileId = profileId,
            workspaceConfigPath = workspaceConfigPath,
            workspaceRevision = revision,
            project = project,
            target = ProjectTargetRef(profileId = profileId, project = project, worktreePath = selectedWt),
            targetKey = targetKey,
            label = label,
            isRoot = false,
            isAvailable = isAvailable,
            statusLabel = statusLabel,
            worktree = matchedWt,
            workspaceRoot = root,
            workspaceEpoch = epoch,
        )
    }

    companion object {
        fun projectScopeKey(
            profileId: ProfileId?,
            workspaceConfigPath: String?,
            project: String,
        ): String {
            return buildJsonArray {
                add(profileId.orEmpty())
                add(workspaceConfigPath.orEmpty())
                add(project)
            }.toString()
        }
    }
}
