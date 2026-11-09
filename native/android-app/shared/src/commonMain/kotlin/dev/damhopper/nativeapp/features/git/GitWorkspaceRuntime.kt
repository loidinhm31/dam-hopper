package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Concrete Git workspace runtime hosting all controllers, active roots,
 * and presentation safety coordinator.
 *
 * Implements [GitHostPorts] and [AutoCloseable].
 * Invariants:
 * 1. Constructor builds all controllers with host = this; no network or host requests
 *    run during constructor execution.
 * 2. Scope strictly matches bound owner and connection generation.
 * 3. Delegates safety operations to [WorkspaceGitSafety] and coordinates refreshes.
 * 4. Revocation invalidates controllers and presentation authority.
 */
class GitWorkspaceRuntime(
    val owner: WorkspaceFileOwner,
    val connection: ConnectionRef,
    val repository: GitRepository,
    val presentation: GitWorkspaceState,
    val safety: WorkspaceGitSafety,
    private val coroutineScope: CoroutineScope,
) : GitHostPorts, AutoCloseable {

    val history: GitHistoryController = GitHistoryController(repository, coroutineScope)
    val changes: GitChangesController = GitChangesController(repository, coroutineScope, host = this)
    val branches: GitBranchController = GitBranchController(repository, coroutineScope, host = this)
    val worktrees: WorktreeMutationController = WorktreeMutationController(repository, coroutineScope, host = this)
    val rewrite: GitRewriteActionController = GitRewriteActionController(repository, coroutineScope, host = this)
    val actions: GitHistoryActionController = GitHistoryActionController(repository, coroutineScope, host = this)
    val leased: LeasedPublishController = LeasedPublishController(repository, coroutineScope, host = this)
    val sync: GitSyncController = GitSyncController(repository, coroutineScope, host = this)
    val diff: DiffReviewController = DiffReviewController(repository.apiClient, coroutineScope)

    private var isRevoked = false
    val isRegisteredProjectTarget: Boolean get() = safety.isRegisteredProjectTarget(owner)
    private val _roots = MutableStateFlow<List<VcsRoot>>(emptyList())
    val roots: StateFlow<List<VcsRoot>> = _roots.asStateFlow()

    private val _selectedRootId = MutableStateFlow<String?>(null)
    val selectedRootId: StateFlow<String?> = _selectedRootId.asStateFlow()

    private val _operationStatus = MutableStateFlow<GitOperationStatus?>(null)
    val operationStatus: StateFlow<GitOperationStatus?> = _operationStatus.asStateFlow()

    private val _conflictSummary = MutableStateFlow<GitConflictSummary?>(null)
    val conflictSummary: StateFlow<GitConflictSummary?> = _conflictSummary.asStateFlow()

    private val _scope = MutableStateFlow<GitOperationScope?>(
        if (safety.isRegisteredProjectTarget(owner)) GitOperationScope.from(owner, connection, root = null) else null
    )
    val scope: StateFlow<GitOperationScope?> = _scope.asStateFlow()

    init {
        val initialScope = _scope.value
        if (initialScope != null && isRegisteredProjectTarget) {
            propagateScope(initialScope)
        } else {
            clearControllers()
        }
    }

    private fun propagateScope(targetScope: GitOperationScope) {
        changes.updateScope(targetScope)
        branches.updateScope(targetScope)
        sync.updateScope(targetScope)
        worktrees.updateScope(targetScope)
        rewrite.updateScope(targetScope)
        actions.updateScope(targetScope)
        leased.updateScope(targetScope)
        history.updateScope(targetScope, viewed = history.viewedBranch, active = history.activeBranch)
    }

    fun selectRoot(rootId: String) {
        if (isRevoked || !isRegisteredProjectTarget) return
        val currentRoots = _roots.value
        val effectivePath: String
        val effectiveId: String
        if (currentRoots.isNotEmpty()) {
            val found = currentRoots.find { it.rootId == rootId || it.path == rootId } ?: return
            effectiveId = found.rootId
            effectivePath = found.path
        } else {
            effectiveId = rootId
            effectivePath = rootId
        }
        _selectedRootId.value = effectiveId
        val newScope = GitOperationScope.from(owner, connection, root = effectivePath)
        _scope.value = newScope
        propagateScope(newScope)
    }

    override fun refresh(reason: GitRefreshReason) {
        if (isRevoked || !isRegisteredProjectTarget) {
            clearControllers()
            return
        }
        coroutineScope.launch {
            if (isRevoked || !isRegisteredProjectTarget) return@launch
            try {
                val fetchedRoots = repository.listRoots(owner.project, owner.worktreePath)
                if (isRevoked || !isRegisteredProjectTarget) return@launch
                _roots.value = fetchedRoots
                if (_selectedRootId.value == null && fetchedRoots.isNotEmpty()) {
                    val primary = fetchedRoots.firstOrNull { it.kind == "primary" } ?: fetchedRoots.first()
                    selectRoot(primary.rootId)
                }
            } catch (c: CancellationException) {
                throw c
            } catch (_: Exception) {
                if (isRevoked || !isRegisteredProjectTarget) return@launch
            }

            if (isRevoked || !isRegisteredProjectTarget) return@launch
            changes.refreshChanges()
            branches.refreshBranches { brs ->
                if (isRevoked || !isRegisteredProjectTarget) return@refreshBranches
                val active = brs.firstOrNull { it.isCurrent }
                val currentScope = _scope.value
                if (currentScope != null) {
                    history.updateScope(currentScope, viewed = active, active = active)
                    presentation.setCheckedOutBranch(active?.name)
                    presentation.setViewedRef(active?.name)
                }
            }
            worktrees.refreshWorktrees()
            history.loadHistory(resetOffset = (reason == GitRefreshReason.ENTRY || reason == GitRefreshReason.RECONCILE))

            // Query scope-fenced operation and conflict summaries
            try {
                _operationStatus.value = repository.query.getOperation(owner.project, owner.worktreePath, _scope.value?.root)
            } catch (_: Exception) {}
            try {
                _conflictSummary.value = repository.query.getConflicts(owner.project, owner.worktreePath, _scope.value?.root)
            } catch (_: Exception) {}

            if (!isRevoked && isRegisteredProjectTarget) {
                presentation.revalidateAuthority()
            }
        }
    }

    private fun clearControllers() {
        changes.revoke()
        branches.revoke()
        sync.revoke()
        worktrees.revoke()
        history.revoke()
        actions.revoke()
        rewrite.revoke()
        leased.revoke()
        diff.clearScope()
    }

    fun revoke() {
        isRevoked = true
        _scope.value = null
        _operationStatus.value = null
        _conflictSummary.value = null
        clearControllers()
        presentation.invalidateAuthority()
    }

    override fun close() {
        revoke()
    }

    // ---- GitHostPorts Implementation ----

    override suspend fun <T> withMutationGuard(
        scope: GitOperationScope,
        impact: GitMutationImpact,
        paths: List<String>,
        dispatch: suspend () -> T,
    ): Result<T> {
        return safety.withMutationGuard(scope, impact, paths, dispatch)
    }

    override suspend fun preflightRemoval(
        scope: GitOperationScope,
        worktree: ProjectWorktree,
    ): WorktreeRemovalPrecheck {
        return safety.preflightRemoval(scope, worktree)
    }

    override suspend fun requestWorktreeSwitch(
        scope: GitOperationScope,
        target: ProjectTargetRef,
    ): Result<Unit> {
        return safety.requestWorktreeSwitch(scope, target)
    }

    override suspend fun openWorkspaceFile(
        scope: GitOperationScope,
        rootRelativePath: String,
    ): Result<Unit> {
        return safety.openWorkspaceFile(scope, rootRelativePath)
    }

    override fun onMutationOutcome(event: GitMutationEvent) {
        safety.onMutationOutcome(event)
        if (event.kind == GitOutcomeKind.SUCCEEDED) {
            refresh(GitRefreshReason.MUTATION)
        }
    }

    override fun openRecoveryTerminal(scope: GitOperationScope) {
        val workspace = safety.workspaceStateGetter()
        workspace?.selectPanel(WorkspacePanel.TERMINAL)
    }
}
