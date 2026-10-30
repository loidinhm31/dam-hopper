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
) {

    fun assertScopeMatchesBoundOwner(scope: GitOperationScope, operation: String) {
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

        val dirtyDocs = retainedDirtyDocsProvider(boundOwner)
        if (dirtyDocs.isNotEmpty()) {
            val workspace = workspaceStateGetter()
            if (workspace != null && workspace.isAuthorityRetired.value) {
                return Result.failure(
                    IllegalStateException("Cannot execute mutation: workspace authority is retired with unsaved documents")
                )
            }
            if (impact == GitMutationImpact.FILES || impact == GitMutationImpact.TARGETS || impact == GitMutationImpact.HISTORY) {
                if (paths.isEmpty()) {
                    // Whole-target/repository-wide mutation (checkout, discard all, drop, reset, revert, cherry-pick)
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

        // 2. Fresh listDetailed terminal sessions from exact owner transport
        val termRepo = terminalRepositoryGetter()
        if (termRepo == null) {
            blockers.add("Terminal repository unavailable to inspect live sessions")
        } else {
            val sessions = try {
                termRepo.listDetailed()
            } catch (e: Exception) {
                blockers.add("Failed to inspect terminal sessions: ${e.message}")
                emptyList()
            }

            val normTargetWt = WorkspaceFileOwner.normalizeWorktree(worktree.path)
            for (session in sessions) {
                if (!session.alive) continue
                val matches = if (session.worktreePath != null) {
                    session.project == scope.project &&
                        WorkspaceFileOwner.normalizeWorktree(session.worktreePath) == normTargetWt
                } else {
                    session.project == scope.project && isCwdInWorktree(session.cwd, worktree.path)
                }
                if (matches) {
                    blockers.add("Worktree has active terminal sessions (session ${session.id})")
                }
            }
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
        return nav.requestWorkspaceTarget(
            target = target,
            revalidate = {
                val liveConn = connectionGetter()
                liveConn != null && liveConn.generation == scope.generation && liveConn.profileId == boundOwner.profileId
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
