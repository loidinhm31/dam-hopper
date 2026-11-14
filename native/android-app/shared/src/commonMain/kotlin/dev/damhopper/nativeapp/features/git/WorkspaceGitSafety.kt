package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import kotlinx.coroutines.launch

/**
 * Real production workspace safety authority for Git mutations, worktree removals,
 * target transitions, and editor file opening.
 *
 * Invariants:
 * 1. Binds an exact [WorkspaceFileOwner]; scopes are strictly verified before execution.
 * 2. Preflight removal checks dirty tabs across all retained matching owners (including retired/hidden),
 *    checks fresh listDetailed terminal sessions for the target (using marker or legacy project+cwd containment),
 *    and blocks on active/unknown live sessions. Never kills PTYs.
 * 3. Mutation guard prevents operations while unconfirmed dirty documents are in flight.
 * 4. Worktree switching runs departure guard first and revalidates target before committing flow/store.
 * 5. Reconciles only clean (non-dirty) buffers on mutation success.
 */
class WorkspaceGitSafety(
    val boundOwner: WorkspaceFileOwner,
    val connectionGetter: () -> ConnectionRef?,
    val fileRepositoryGetter: () -> FileRepository?,
    val editorRepositoryGetter: () -> EditorRepository?,
    val terminalRepositoryGetter: () -> TerminalRepository?,
    val workspaceStateGetter: () -> ProjectWorkspaceState?,
    val retainedDirtyDocsProvider: (WorkspaceFileOwner) -> List<DocumentId>,
    val targetStore: ProjectTargetStore? = null,
    val flowNavigation: AppFlowNavigation? = null,
    val registeredProjectsProvider: (() -> List<String>?)? = null,
    val vcsRootsProvider: (() -> List<VcsRoot>?)? = null,
) {

    fun isRegisteredProjectTarget(targetOwner: WorkspaceFileOwner = boundOwner): Boolean {
        if (targetOwner.project.isBlank() || targetOwner.project == "*" || targetOwner.project.equals("workspace", ignoreCase = true)) {
            return false
        }
        val provider = registeredProjectsProvider
        if (provider != null) {
            val registered = provider()
            if (registered == null || !registered.contains(targetOwner.project)) {
                return false
            }
        } else {
            val ws = workspaceStateGetter()
            if (ws != null) {
                val isProject = ws.fileTreeState.activeBrowsingTarget.value is dev.damhopper.nativeapp.core.model.FilesystemTargetRef.Project
                if (!isProject) {
                    return false
                }
                val registered = ws.fileTreeState.registeredProjects.value
                if (registered.isNotEmpty() && !registered.contains(targetOwner.project)) {
                    return false
                }
            }
        }
        return true
    }

    fun assertScopeMatchesBoundOwner(scope: GitOperationScope, operation: String) {
        if (!isRegisteredProjectTarget(scope.owner)) {
            throw IllegalArgumentException(
                "Cannot execute $operation: target '${scope.owner.project}' is not a registered project"
            )
        }
        if (scope.owner != boundOwner) {
            throw IllegalArgumentException(
                "Scope owner (${scope.owner}) does not match bound owner ($boundOwner) in $operation"
            )
        }
        val liveConn = connectionGetter()
        if (liveConn != null && scope.generation != liveConn.generation) {
            throw IllegalArgumentException(
                "Scope generation (${scope.generation}) does not match live connection generation (${liveConn.generation}) in $operation"
            )
        }
        if (scope.root != null && scope.root != ".") {
            val roots = vcsRootsProvider?.invoke() ?: workspaceStateGetter()?.gitRuntime?.roots?.value
            if (roots == null || roots.isEmpty()) {
                throw IllegalArgumentException(
                    "Cannot execute $operation: secondary root '${scope.root}' requires authoritative VCS root discovery"
                )
            }
            val rootFound = roots.any { it.rootId == scope.root || it.path == scope.root }
            if (!rootFound) {
                throw IllegalArgumentException(
                    "Cannot execute $operation: root '${scope.root}' does not match any existing VcsRoot"
                )
            }
        }
    }

    suspend fun checkTerminalBlockers(
        project: String,
        worktreePath: String?,
    ): List<String> {
        val termRepo = terminalRepositoryGetter() ?: return emptyList()
        val blockers = mutableListOf<String>()
        val sessions = try {
            termRepo.listDetailed()
        } catch (e: Exception) {
            return listOf("Failed to inspect terminal sessions: ${e.message}")
        }

        val normTargetWt = WorkspaceFileOwner.normalizeWorktree(worktreePath)
        val termState = workspaceStateGetter()?.terminalState
        for (session in sessions) {
            val sessionWt = WorkspaceFileOwner.normalizeWorktree(session.worktreePath)
            val matches = if (sessionWt != null) {
                session.project == project && sessionWt == normTargetWt
            } else if (normTargetWt != null) {
                session.project == project && isCwdInWorktree(session.cwd, normTargetWt)
            } else {
                session.project == project && sessionWt == null
            }
            if (matches) {
                val isHidden = termState?.hiddenSessions?.any {
                    it.profileId == boundOwner.profileId &&
                        it.terminalId == session.id &&
                        (it.incarnation == 0uL || it.incarnation == session.incarnation)
                } ?: false

                val isRestartPending = session.terminationState == "restartPending" ||
                    (session.restartPolicy != "never" && !session.alive && session.exitCode != 0)
                val isUnknown = session.terminationState == "unknown" || session.targetUnavailable

                if (session.alive) {
                    blockers.add("Active terminal session (session ${session.id})")
                } else if (isHidden) {
                    blockers.add("Hidden terminal session (session ${session.id})")
                } else if (isRestartPending) {
                    blockers.add("Restart-pending terminal session (session ${session.id})")
                } else if (isUnknown) {
                    blockers.add("Terminal session in unknown state (session ${session.id})")
                }
            }
        }

        if (termState != null) {
            for (h in termState.hiddenSessions) {
                if (h.profileId == boundOwner.profileId && h.project == project) {
                    val hWt = WorkspaceFileOwner.normalizeWorktree(h.worktreePath)
                    val wtMatch = if (normTargetWt != null) hWt == normTargetWt else hWt == null
                    if (wtMatch && sessions.none { it.id == h.terminalId }) {
                        blockers.add("Hidden terminal session absent from inventory (session ${h.terminalId})")
                    }
                }
            }
            for (uc in termState.uncertainCreates) {
                if (uc.profileId == boundOwner.profileId && uc.project == project) {
                    val ucWt = WorkspaceFileOwner.normalizeWorktree(uc.worktreePath)
                    val wtMatch = if (normTargetWt != null) ucWt == normTargetWt else ucWt == null
                    if (wtMatch) {
                        blockers.add("Uncertain pending terminal creation (terminal ${uc.terminalId})")
                    }
                }
            }
        }

        return blockers
    }

    suspend fun <T> withMutationGuard(
        scope: GitOperationScope,
        impact: GitMutationImpact,
        paths: List<String>,
        dispatch: suspend () -> T,
    ): Result<T> {
        try {
            assertScopeMatchesBoundOwner(scope, "withMutationGuard")
        } catch (e: Exception) {
            return Result.failure(e)
        }

        // 1. Active/hidden/restart-pending/unknown PTY blockers for branch deletion (REFS), whole-target reset/detach (empty FILES/TARGETS), or publication
        if (impact == GitMutationImpact.REFS ||
            (paths.isEmpty() && (impact == GitMutationImpact.FILES || impact == GitMutationImpact.TARGETS || impact == GitMutationImpact.PUBLICATION))) {
            val termBlockers = checkTerminalBlockers(scope.project, scope.worktreePath)
            if (termBlockers.isNotEmpty()) {
                return Result.failure(
                    IllegalStateException(
                        "Cannot execute mutation: target has ${termBlockers.joinToString(", ")}. Close terminal sessions first."
                    )
                )
            }
        }

        // Post-suspension revalidation: Re-check authority after suspension in checkTerminalBlockers
        try {
            assertScopeMatchesBoundOwner(scope, "withMutationGuard")
        } catch (e: Exception) {
            return Result.failure(e)
        }

        val dirtyDocs = retainedDirtyDocsProvider(boundOwner)
        if (dirtyDocs.isNotEmpty()) {
            val workspace = workspaceStateGetter()
            if (workspace != null && workspace.isAuthorityRetired.value) {
                return Result.failure(
                    IllegalStateException("Cannot execute mutation: workspace authority is retired with unsaved documents")
                )
            }
            if (impact == GitMutationImpact.FILES || impact == GitMutationImpact.TARGETS ||
                impact == GitMutationImpact.HISTORY || impact == GitMutationImpact.REFS ||
                impact == GitMutationImpact.PUBLICATION) {
                if (paths.isEmpty()) {
                    // Whole-target/repository-wide mutation (checkout, discard all, drop, reset, revert, cherry-pick, branch delete, publication)
                    return Result.failure(
                        IllegalStateException(
                            "Cannot execute mutation: unsaved editor changes in ${dirtyDocs.joinToString { it.relativePath }}. Save or discard changes first."
                        )
                    )
                } else {
                    val matchingDirty = mutableListOf<DocumentId>()
                    for (p in paths) {
                        val translated = try {
                            gitWorkspaceRelativePath(scope.root ?: "", p)
                        } catch (e: Exception) {
                            return Result.failure(
                                IllegalStateException("Cannot execute mutation: invalid path translation for '$p': ${e.message}")
                            )
                        }
                        dirtyDocs.filterTo(matchingDirty) { it.relativePath == translated }
                    }
                    if (matchingDirty.isNotEmpty()) {
                        return Result.failure(
                            IllegalStateException(
                                "Cannot execute mutation: unsaved editor changes in ${matchingDirty.distinctBy { it.relativePath }.joinToString { it.relativePath }}. Save or discard changes first."
                            )
                        )
                    }
                }
            }
        }

        return try {
            val result = dispatch()
            Result.success(result)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun preflightRemoval(
        scope: GitOperationScope,
        worktree: ProjectWorktree,
    ): WorktreeRemovalPrecheck {
        try {
            assertScopeMatchesBoundOwner(scope, "preflightRemoval")
        } catch (e: Exception) {
            return WorktreeRemovalPrecheck.Blocked(listOf(e.message ?: "Invalid scope"))
        }

        if (worktree.isMain) {
            return WorktreeRemovalPrecheck.Blocked(listOf("Cannot remove the primary/main worktree."))
        }

        val blockers = mutableListOf<String>()
        val targetOwner = scope.owner.copy(worktreePath = worktree.path)

        // 1. All retained exact logical owner dirty docs (including hidden/retired)
        val dirty = retainedDirtyDocsProvider(targetOwner)
        if (dirty.isNotEmpty()) {
            blockers.add("Worktree has unsaved editor tabs: ${dirty.joinToString { it.relativePath }}")
        }

        // 2. Fresh terminal sessions check including live/hidden/restartPending/unknown/uncertain
        val termBlockers = checkTerminalBlockers(scope.project, worktree.path)
        for (b in termBlockers) {
            blockers.add("Worktree has $b")
        }

        return if (blockers.isEmpty()) {
            WorktreeRemovalPrecheck.Allowed
        } else {
            WorktreeRemovalPrecheck.Blocked(blockers)
        }
    }

    suspend fun requestWorktreeSwitch(
        scope: GitOperationScope,
        target: ProjectTargetRef,
    ): Result<Unit> {
        try {
            assertScopeMatchesBoundOwner(scope, "requestWorktreeSwitch")
        } catch (e: Exception) {
            return Result.failure(e)
        }

        val nav = flowNavigation ?: return Result.failure(IllegalStateException("Flow navigation unavailable"))

        // If no departure guard is registered, check dirty docs & terminal blockers immediately
        if (nav.departureGuard == null) {
            val dirtyDocs = retainedDirtyDocsProvider(boundOwner)
            if (dirtyDocs.isNotEmpty()) {
                return Result.failure(
                    IllegalStateException(
                        "Cannot switch worktree: unsaved editor changes in ${dirtyDocs.joinToString { it.relativePath }}. Save or discard changes first."
                    )
                )
            }
            val termBlockers = checkTerminalBlockers(scope.project, scope.worktreePath)
            if (termBlockers.isNotEmpty()) {
                return Result.failure(
                    IllegalStateException(
                        "Cannot switch worktree: departing target has ${termBlockers.joinToString(", ")}. Close terminal sessions first."
                    )
                )
            }
        }

        return nav.requestWorkspaceTarget(
            target = target,
            revalidate = {
                // 1. Check terminal blockers first (which may suspend)
                val termBlockers = checkTerminalBlockers(scope.project, scope.worktreePath)
                if (termBlockers.isNotEmpty()) return@requestWorkspaceTarget false

                // 2. Post-suspension check of live connection and destination target validity
                val liveConn = connectionGetter()
                val connValid = liveConn != null && liveConn.generation == scope.generation && liveConn.profileId == boundOwner.profileId
                if (!connValid) return@requestWorkspaceTarget false

                // 3. Ensure target is still registered and valid
                if (!isRegisteredProjectTarget(boundOwner)) return@requestWorkspaceTarget false

                // 4. Dirty tabs must be resolved (saved/discarded)
                val dirtyDocs = retainedDirtyDocsProvider(boundOwner)
                if (dirtyDocs.isNotEmpty()) return@requestWorkspaceTarget false

                true
            },
            onCommitted = {
                targetStore?.selectTarget(
                    profileId = target.profileId,
                    workspaceConfigPath = null,
                    project = target.project,
                    worktreePath = target.worktreePath,
                )
            }
        )
    }

    suspend fun openWorkspaceFile(
        scope: GitOperationScope,
        rootRelativePath: String,
    ): Result<Unit> {
        try {
            assertScopeMatchesBoundOwner(scope, "openWorkspaceFile")
        } catch (e: Exception) {
            return Result.failure(e)
        }
        val workspace = workspaceStateGetter() ?: return Result.failure(IllegalStateException("Workspace unavailable"))
        val workspacePath = try {
            gitWorkspaceRelativePath(scope.root ?: "", rootRelativePath)
        } catch (e: Exception) {
            return Result.failure(IllegalStateException("Invalid workspace path for '$rootRelativePath': ${e.message}"))
        }
        return try {
            workspace.selectPanel(WorkspacePanel.EDITOR)
            workspace.editorTabsState.openTab(scope.targetRef, workspacePath)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun onMutationOutcome(event: GitMutationEvent) {
        if (event.kind == GitOutcomeKind.SUCCEEDED &&
            (event.impact == GitMutationImpact.FILES || event.impact == GitMutationImpact.INDEX ||
             event.impact == GitMutationImpact.TARGETS || event.impact == GitMutationImpact.HISTORY)
        ) {
            reconcileCleanBuffers(event.paths)
        }
    }

    fun reconcileCleanBuffers(paths: List<String>) {
        val workspace = workspaceStateGetter() ?: return
        val tabs = workspace.editorTabsState
        if (paths.isEmpty()) {
            // Whole-target mutation (checkout, discard all, reset, pull, drop) -> reload all clean open tabs
            for (tab in tabs.tabs.value) {
                if (!tab.isDirty) {
                    workspace.coroutineScope.launch {
                        tabs.reloadTab(tab.key)
                    }
                }
            }
        } else {
            for (path in paths) {
                val matchingTab = tabs.tabs.value.find { it.path == path && !it.isDirty }
                if (matchingTab != null) {
                    workspace.coroutineScope.launch {
                        tabs.reloadTab(matchingTab.key)
                    }
                }
            }
        }
    }

    private fun isCwdInWorktree(cwd: String?, worktreePath: String): Boolean {
        if (cwd == null) return false
        val normCwd = cwd.trim().replace('\\', '/').trim('/')
        val normWt = worktreePath.trim().replace('\\', '/').trim('/')
        if (normWt.isEmpty()) return true
        return normCwd == normWt || normCwd.startsWith("$normWt/")
    }
}
