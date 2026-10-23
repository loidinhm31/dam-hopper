package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.editor.EditorDirtyGuardPort
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.datetime.Clock

/**
 * Retained record of an ambiguous/unresolved file mutation operation.
 * Preserves original local identity and blocks retry until server state is reconciled.
 */
data class UnresolvedFileMutation(
    val actionId: Long,
    val owner: WorkspaceFileOwner,
    val target: ProjectTargetRef,
    val operation: String,
    val sourcePath: String,
    val destinationPath: String? = null,
    val stage: OperationStage,
    val opId: String? = null,
    val message: String,
)

/**
 * Retained modal state for explorer actions so dialog inputs, captured target identity,
 * validation/server-reject errors, and unresolved outcomes survive recomposition and rotation.
 */
sealed interface ExplorerDialogState {
    val actionId: Long

    data object None : ExplorerDialogState {
        override val actionId: Long = 0L
    }

    data class CreateFile(
        override val actionId: Long,
        val owner: WorkspaceFileOwner,
        val target: ProjectTargetRef,
        val parentPath: String,
        val draftName: String = "",
        val isSubmitting: Boolean = false,
        val errorMessage: String? = null,
        val unknownOutcome: FileOperationOutcome.Unknown? = null,
    ) : ExplorerDialogState

    data class CreateDirectory(
        override val actionId: Long,
        val owner: WorkspaceFileOwner,
        val target: ProjectTargetRef,
        val parentPath: String,
        val draftName: String = "",
        val isSubmitting: Boolean = false,
        val errorMessage: String? = null,
        val unknownOutcome: FileOperationOutcome.Unknown? = null,
    ) : ExplorerDialogState

    data class Rename(
        override val actionId: Long,
        val owner: WorkspaceFileOwner,
        val target: ProjectTargetRef,
        val sourcePath: String,
        val currentName: String,
        val draftNewName: String = currentName,
        val isSubmitting: Boolean = false,
        val errorMessage: String? = null,
        val unknownOutcome: FileOperationOutcome.Unknown? = null,
    ) : ExplorerDialogState

    data class Move(
        override val actionId: Long,
        val owner: WorkspaceFileOwner,
        val target: ProjectTargetRef,
        val sourcePath: String,
        val draftDestDirPath: String = "",
        val isSubmitting: Boolean = false,
        val errorMessage: String? = null,
        val unknownOutcome: FileOperationOutcome.Unknown? = null,
    ) : ExplorerDialogState

    data class DeleteConfirm(
        override val actionId: Long,
        val owner: WorkspaceFileOwner,
        val target: ProjectTargetRef,
        val targetPath: String,
        val isDirectory: Boolean,
        val isSubmitting: Boolean = false,
        val errorMessage: String? = null,
        val unknownOutcome: FileOperationOutcome.Unknown? = null,
    ) : ExplorerDialogState
}

/**
 * Validates and executes mutating fs:op operations (create, rename, move, delete)
 * with owner- and path-qualified reservations, dirty-document guards, retained dialog state,
 * and phase-aware outcome classification.
 */
class FileMutationCoordinator(
    private val repository: FileRepository,
    private val treeState: FileTreeState,
    private val dirtyGuardPort: EditorDirtyGuardPort? = null,
    val arbiter: FileOperationArbiter = repository.arbiter,
) {
    val target: ProjectTargetRef
        get() = treeState.target

    val owner: WorkspaceFileOwner
        get() = FileWatchCoordinator.resolveEffectiveOwner(repository.owner, target)

    private val actionLock = Any()
    private var nextActionId = 1L

    private val _dialogState = MutableStateFlow<ExplorerDialogState>(ExplorerDialogState.None)
    val dialogState: StateFlow<ExplorerDialogState> = _dialogState.asStateFlow()

    private val _unresolvedOperations = MutableStateFlow<List<UnresolvedFileMutation>>(emptyList())
    val unresolvedOperations: StateFlow<List<UnresolvedFileMutation>> = _unresolvedOperations.asStateFlow()

    private val _isMutating = MutableStateFlow(false)
    val isMutating: StateFlow<Boolean> = _isMutating.asStateFlow()

    private val _lastFeedbackNotice = MutableStateFlow<String?>(null)
    val lastFeedbackNotice: StateFlow<String?> = _lastFeedbackNotice.asStateFlow()

    private fun allocateActionId(): Long = synchronized(actionLock) {
        nextActionId++
    }

    /**
     * Sanitizes a project-relative path: strips leading/trailing slashes and rejects traversal segments.
     */
    fun sanitizePath(path: String): String {
        val trimmed = path.trim().replace('\\', '/').trim('/')
        if (trimmed.isEmpty()) return ""
        require(!trimmed.contains(":") && !trimmed.contains('\u0000')) {
            "Invalid characters in relative path: $path"
        }
        val segments = trimmed.split('/')
        require(segments.none { it.isEmpty() || it == ".." || it == "." }) {
            "Path traversal ('..' or '.') is strictly prohibited: $path"
        }
        return trimmed
    }

    fun validateName(name: String): String {
        val trimmed = name.trim().trim('/')
        require(
            trimmed.isNotBlank() &&
                trimmed != "." &&
                trimmed != ".." &&
                !trimmed.contains('/') &&
                !trimmed.contains('\\') &&
                !trimmed.contains(':') &&
                !trimmed.contains('\u0000')
        ) {
            "Invalid file or directory name: $name"
        }
        return trimmed
    }

    fun isPathUnresolved(path: String): Boolean {
        val clean = try {
            sanitizePath(path)
        } catch (_: IllegalArgumentException) {
            return false
        }
        return _unresolvedOperations.value.any { op ->
            op.owner == owner && (
                FileOperationArbiter.pathsConflict(clean, op.sourcePath) ||
                    (op.destinationPath != null && FileOperationArbiter.pathsConflict(clean, op.destinationPath))
                )
        } || arbiter.getQuarantinedOperations(owner).any { q ->
            FileOperationArbiter.pathsConflict(clean, q.path)
        }
    }

    fun copyRemotePath(
        path: String? = treeState.selectedPath.value,
        onCopied: ((String) -> Unit)? = null,
    ): String? {
        val targetPath = path ?: return null
        return try {
            val formatted = FileTreeHelpers.formatRemoteClipboardPath(targetPath)
            _lastFeedbackNotice.value = "Copied remote path: $formatted"
            onCopied?.invoke(formatted)
            formatted
        } catch (e: IllegalArgumentException) {
            _lastFeedbackNotice.value = e.message ?: "Invalid remote path"
            null
        }
    }

    fun clearFeedbackNotice() {
        _lastFeedbackNotice.value = null
    }

    // --- Retained Dialog Lifecycle ---

    fun openCreateFileDialog(parentPath: String? = null) {
        val resolvedParent = parentPath?.let {
            try { sanitizePath(it) } catch (_: IllegalArgumentException) { "" }
        } ?: FileTreeHelpers.resolveCreateParentPath(treeState.root.value, treeState.selectedPath.value)
        _dialogState.value = ExplorerDialogState.CreateFile(
            actionId = allocateActionId(),
            owner = owner,
            target = target,
            parentPath = resolvedParent,
        )
    }

    fun openCreateDirectoryDialog(parentPath: String? = null) {
        val resolvedParent = parentPath?.let {
            try { sanitizePath(it) } catch (_: IllegalArgumentException) { "" }
        } ?: FileTreeHelpers.resolveCreateParentPath(treeState.root.value, treeState.selectedPath.value)
        _dialogState.value = ExplorerDialogState.CreateDirectory(
            actionId = allocateActionId(),
            owner = owner,
            target = target,
            parentPath = resolvedParent,
        )
    }

    fun openRenameDialog(sourcePath: String? = treeState.selectedPath.value) {
        val rawSource = sourcePath ?: return
        val cleanSource = try {
            sanitizePath(rawSource)
        } catch (_: IllegalArgumentException) {
            return
        }
        if (cleanSource.isEmpty()) return
        val currentName = cleanSource.substringAfterLast('/')
        _dialogState.value = ExplorerDialogState.Rename(
            actionId = allocateActionId(),
            owner = owner,
            target = target,
            sourcePath = cleanSource,
            currentName = currentName,
            draftNewName = currentName,
        )
    }

    fun openMoveDialog(
        sourcePath: String? = treeState.selectedPath.value,
        initialDestDirPath: String? = null,
    ) {
        val rawSource = sourcePath ?: return
        val cleanSource = try {
            sanitizePath(rawSource)
        } catch (_: IllegalArgumentException) {
            return
        }
        if (cleanSource.isEmpty()) return
        val defaultDest = initialDestDirPath ?: FileTreeHelpers.resolveParentPath(cleanSource)
        _dialogState.value = ExplorerDialogState.Move(
            actionId = allocateActionId(),
            owner = owner,
            target = target,
            sourcePath = cleanSource,
            draftDestDirPath = defaultDest,
        )
    }

    fun openDeleteDialog(targetPath: String? = treeState.selectedPath.value) {
        val rawPath = targetPath ?: return
        val cleanPath = try {
            sanitizePath(rawPath)
        } catch (_: IllegalArgumentException) {
            return
        }
        if (cleanPath.isEmpty()) return
        val node = FileTreeHelpers.findNode(treeState.root.value, cleanPath)
        _dialogState.value = ExplorerDialogState.DeleteConfirm(
            actionId = allocateActionId(),
            owner = owner,
            target = target,
            targetPath = cleanPath,
            isDirectory = node?.isDirectory ?: false,
        )
    }

    fun updateDialogDraft(draftValue: String) {
        _dialogState.value = when (val current = _dialogState.value) {
            is ExplorerDialogState.CreateFile -> if (current.isSubmitting || current.unknownOutcome != null) current else current.copy(draftName = draftValue, errorMessage = null)
            is ExplorerDialogState.CreateDirectory -> if (current.isSubmitting || current.unknownOutcome != null) current else current.copy(draftName = draftValue, errorMessage = null)
            is ExplorerDialogState.Rename -> if (current.isSubmitting || current.unknownOutcome != null) current else current.copy(draftNewName = draftValue, errorMessage = null)
            is ExplorerDialogState.Move -> if (current.isSubmitting || current.unknownOutcome != null) current else current.copy(draftDestDirPath = draftValue, errorMessage = null)
            is ExplorerDialogState.DeleteConfirm, is ExplorerDialogState.None -> current
        }
    }

    fun dismissDialog() {
        val current = _dialogState.value
        if (
            current is ExplorerDialogState.CreateFile && current.isSubmitting ||
            current is ExplorerDialogState.CreateDirectory && current.isSubmitting ||
            current is ExplorerDialogState.Rename && current.isSubmitting ||
            current is ExplorerDialogState.Move && current.isSubmitting ||
            current is ExplorerDialogState.DeleteConfirm && current.isSubmitting
        ) {
            return
        }
        _dialogState.value = ExplorerDialogState.None
    }

    suspend fun submitCurrentDialog(): FileOperationOutcome<FsOpOutcome>? {
        val snapshot = _dialogState.value
        val capturedActionId = snapshot.actionId
        val submittingState = when (snapshot) {
            is ExplorerDialogState.None -> return null
            is ExplorerDialogState.CreateFile -> if (snapshot.isSubmitting || snapshot.unknownOutcome != null) return null else snapshot.copy(isSubmitting = true, errorMessage = null)
            is ExplorerDialogState.CreateDirectory -> if (snapshot.isSubmitting || snapshot.unknownOutcome != null) return null else snapshot.copy(isSubmitting = true, errorMessage = null)
            is ExplorerDialogState.Rename -> if (snapshot.isSubmitting || snapshot.unknownOutcome != null) return null else snapshot.copy(isSubmitting = true, errorMessage = null)
            is ExplorerDialogState.Move -> if (snapshot.isSubmitting || snapshot.unknownOutcome != null) return null else snapshot.copy(isSubmitting = true, errorMessage = null)
            is ExplorerDialogState.DeleteConfirm -> if (snapshot.isSubmitting || snapshot.unknownOutcome != null) return null else snapshot.copy(isSubmitting = true, errorMessage = null)
        }
        if (!_dialogState.compareAndSet(snapshot, submittingState)) {
            return null
        }

        val outcome = try {
            when (snapshot) {
                is ExplorerDialogState.None -> return null
                is ExplorerDialogState.CreateFile -> createFileWithOutcome(snapshot.parentPath, snapshot.draftName, actionId = capturedActionId)
                is ExplorerDialogState.CreateDirectory -> createDirectoryWithOutcome(snapshot.parentPath, snapshot.draftName, actionId = capturedActionId)
                is ExplorerDialogState.Rename -> renameWithOutcome(snapshot.sourcePath, snapshot.draftNewName, actionId = capturedActionId)
                is ExplorerDialogState.Move -> moveWithOutcome(snapshot.sourcePath, snapshot.draftDestDirPath, actionId = capturedActionId)
                is ExplorerDialogState.DeleteConfirm -> deleteWithOutcome(snapshot.targetPath, confirmed = true, actionId = capturedActionId)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IllegalArgumentException) {
            FileOperationOutcome.NotSubmitted(e.message ?: "Validation failed before submission", e)
        } catch (e: Throwable) {
            FileOperationOutcome.Unknown(
                stage = OperationStage.AWAITING_RESULT,
                opId = null,
                message = e.message ?: "Unexpected failure during mutation",
                cause = e,
            )
        }
        // Fence completion against dialog replacement
        val latest = _dialogState.value
        if (latest.actionId != capturedActionId) {
            return outcome
        }

        when (outcome) {
            is FileOperationOutcome.Confirmed -> {
                _dialogState.value = ExplorerDialogState.None
            }
            is FileOperationOutcome.NotSubmitted -> {
                _dialogState.value = updateDialogFailure(latest, errorMessage = outcome.reason, unknown = null)
            }
            is FileOperationOutcome.Rejected -> {
                val msg = if (outcome.code.isNotBlank()) "[${outcome.code}] ${outcome.message}" else outcome.message
                _dialogState.value = updateDialogFailure(latest, errorMessage = msg, unknown = null)
            }
            is FileOperationOutcome.Unknown -> {
                val msg = "Operation outcome is unresolved (${outcome.stage}): ${outcome.message}. Retry is disabled until reconciled."
                _dialogState.value = updateDialogFailure(latest, errorMessage = msg, unknown = outcome)
            }
        }
        return outcome
    }

    private fun updateDialogFailure(
        state: ExplorerDialogState,
        errorMessage: String,
        unknown: FileOperationOutcome.Unknown?,
    ): ExplorerDialogState = when (state) {
        is ExplorerDialogState.CreateFile -> state.copy(isSubmitting = false, errorMessage = errorMessage, unknownOutcome = unknown)
        is ExplorerDialogState.CreateDirectory -> state.copy(isSubmitting = false, errorMessage = errorMessage, unknownOutcome = unknown)
        is ExplorerDialogState.Rename -> state.copy(isSubmitting = false, errorMessage = errorMessage, unknownOutcome = unknown)
        is ExplorerDialogState.Move -> state.copy(isSubmitting = false, errorMessage = errorMessage, unknownOutcome = unknown)
        is ExplorerDialogState.DeleteConfirm -> state.copy(isSubmitting = false, errorMessage = errorMessage, unknownOutcome = unknown)
        is ExplorerDialogState.None -> state
    }

    // --- Typed Phase-Aware Mutation Operations ---

    suspend fun createFileWithOutcome(
        parentPath: String,
        name: String,
        actionId: Long = allocateActionId(),
    ): FileOperationOutcome<FsOpOutcome> =
        createEntryWithOutcome(parentPath, name, isDir = false, actionId = actionId)

    suspend fun createDirectoryWithOutcome(
        parentPath: String,
        name: String,
        actionId: Long = allocateActionId(),
    ): FileOperationOutcome<FsOpOutcome> =
        createEntryWithOutcome(parentPath, name, isDir = true, actionId = actionId)

    private suspend fun createEntryWithOutcome(
        parentPath: String,
        name: String,
        isDir: Boolean,
        actionId: Long,
    ): FileOperationOutcome<FsOpOutcome> {
        val cleanParent = try {
            sanitizePath(parentPath)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid parent directory path", e)
        }
        val cleanName = try {
            validateName(name)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid item name", e)
        }

        val relativePath = if (cleanParent.isEmpty()) cleanName else "$cleanParent/$cleanName"
        if (isProtectedGitPath(relativePath)) {
            return FileOperationOutcome.Rejected(
                code = "PROTECTED_PATH",
                message = "Cannot create items inside protected .git path: $relativePath",
            )
        }

        val op = if (isDir) "create_dir" else "create_file"
        return executeReservedMutation(
            actionId = actionId,
            op = op,
            sourcePath = relativePath,
            destPath = null,
            checkDirtySubtree = false,
            onConfirmedRefresh = {
                treeState.loadDirectorySuspending(cleanParent, isPostMutationRefresh = true)
            },
        )
    }

    suspend fun renameWithOutcome(
        path: String,
        newName: String,
        actionId: Long = allocateActionId(),
    ): FileOperationOutcome<FsOpOutcome> {
        val cleanSource = try {
            sanitizePath(path)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid source path", e)
        }
        if (cleanSource.isEmpty()) {
            return FileOperationOutcome.NotSubmitted("Cannot rename root directory")
        }
        val cleanName = try {
            validateName(newName)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid new name", e)
        }

        val parentPath = FileTreeHelpers.resolveParentPath(cleanSource)
        val newRelativePath = if (parentPath.isEmpty()) cleanName else "$parentPath/$cleanName"
        if (newRelativePath == cleanSource) {
            return FileOperationOutcome.NotSubmitted("New name must differ from current name")
        }
        if (isProtectedGitPath(cleanSource) || isProtectedGitPath(newRelativePath)) {
            return FileOperationOutcome.Rejected(
                code = "PROTECTED_PATH",
                message = "Cannot rename protected .git path",
            )
        }

        return executeReservedMutation(
            actionId = actionId,
            op = "rename",
            sourcePath = cleanSource,
            destPath = newRelativePath,
            checkDirtySubtree = true,
            onConfirmedRefresh = {
                treeState.loadDirectorySuspending(parentPath, isPostMutationRefresh = true)
            },
        )
    }

    suspend fun moveWithOutcome(
        sourcePath: String,
        destDirPath: String,
        actionId: Long = allocateActionId(),
    ): FileOperationOutcome<FsOpOutcome> {
        val cleanSource = try {
            sanitizePath(sourcePath)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid source path", e)
        }
        if (cleanSource.isEmpty()) {
            return FileOperationOutcome.NotSubmitted("Cannot move root directory")
        }
        val cleanDestDir = try {
            sanitizePath(destDirPath)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid destination directory path", e)
        }

        val fileName = cleanSource.substringAfterLast('/')
        val newRelativePath = if (cleanDestDir.isEmpty()) fileName else "$cleanDestDir/$fileName"
        if (newRelativePath == cleanSource) {
            return FileOperationOutcome.NotSubmitted("Source and destination paths are identical")
        }
        if (FileOperationArbiter.isPathAncestorOrEqual(ancestor = cleanSource, descendant = newRelativePath)) {
            return FileOperationOutcome.NotSubmitted("Cannot move directory '$cleanSource' into its own descendant '$newRelativePath'")
        }
        if (isProtectedGitPath(cleanSource) || isProtectedGitPath(newRelativePath)) {
            return FileOperationOutcome.Rejected(
                code = "PROTECTED_PATH",
                message = "Cannot move protected .git path",
            )
        }

        return executeReservedMutation(
            actionId = actionId,
            op = "move",
            sourcePath = cleanSource,
            destPath = newRelativePath,
            checkDirtySubtree = true,
            onConfirmedRefresh = {
                val sourceParent = FileTreeHelpers.resolveParentPath(cleanSource)
                treeState.loadDirectorySuspending(sourceParent, isPostMutationRefresh = true)
                if (sourceParent != cleanDestDir) {
                    treeState.loadDirectorySuspending(cleanDestDir, isPostMutationRefresh = true)
                }
            },
        )
    }

    suspend fun deleteWithOutcome(
        path: String,
        confirmed: Boolean = true,
        forceGit: Boolean = false,
        actionId: Long = allocateActionId(),
    ): FileOperationOutcome<FsOpOutcome> {
        if (!confirmed) {
            return FileOperationOutcome.NotSubmitted("Explicit user confirmation is required before deleting '$path'")
        }
        if (forceGit) {
            return FileOperationOutcome.Rejected(
                code = "FORCE_GIT_PROHIBITED",
                message = "Bypassing .git protection via force_git is prohibited",
            )
        }
        val cleanPath = try {
            sanitizePath(path)
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid delete path", e)
        }
        if (cleanPath.isEmpty()) {
            return FileOperationOutcome.NotSubmitted("Cannot delete root directory")
        }
        if (isProtectedGitPath(cleanPath)) {
            return FileOperationOutcome.Rejected(
                code = "PROTECTED_PATH",
                message = "Cannot delete protected .git path: $cleanPath",
            )
        }

        val parentPath = FileTreeHelpers.resolveParentPath(cleanPath)
        return executeReservedMutation(
            actionId = actionId,
            op = "delete",
            sourcePath = cleanPath,
            destPath = null,
            checkDirtySubtree = true,
            onConfirmedRefresh = {
                treeState.loadDirectorySuspending(parentPath, isPostMutationRefresh = true)
                val currentSelection = treeState.selectedPath.value
                if (currentSelection != null && FileOperationArbiter.isPathAncestorOrEqual(cleanPath, currentSelection)) {
                    treeState.selectPath(null)
                }
            },
        )
    }

    private fun isProtectedGitPath(cleanPath: String): Boolean {
        val segments = FileOperationArbiter.normalizeSegments(cleanPath)
        return segments.any { it == ".git" }
    }

    private suspend fun executeReservedMutation(
        actionId: Long,
        op: String,
        sourcePath: String,
        destPath: String?,
        checkDirtySubtree: Boolean,
        onConfirmedRefresh: suspend () -> Unit,
    ): FileOperationOutcome<FsOpOutcome> {
        val capturedOwner = owner
        val capturedTarget = target
        try {
            repository.assertTargetMatchesOwner(capturedTarget, "FileMutationCoordinator.$op")
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Target does not match workspace owner", e)
        }

        if (isPathUnresolved(sourcePath) || (destPath != null && isPathUnresolved(destPath))) {
            return FileOperationOutcome.NotSubmitted(
                "Path is quarantined by an unresolved file operation. Automatic retry or conflicting mutation is blocked."
            )
        }

        val token = try {
            arbiter.tryReserveMutation(
                owner = capturedOwner,
                sourcePath = sourcePath,
                destPath = destPath,
            )
        } catch (e: IllegalArgumentException) {
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid path for reservation", e)
        } ?: return FileOperationOutcome.NotSubmitted(
            "Path '$sourcePath'${destPath?.let { " or '$it'" } ?: ""} is currently reserved by another file operation"
        )

        // Enforce W3: verify owner and path qualification on reservation token before dispatch
        val normalizedSource = try {
            FileOperationArbiter.normalizeRelativePath(sourcePath)
        } catch (e: IllegalArgumentException) {
            releaseIfActive(token)
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid source path", e)
        }
        val normalizedDest = try {
            destPath?.let { FileOperationArbiter.normalizeRelativePath(it) }
        } catch (e: IllegalArgumentException) {
            releaseIfActive(token)
            return FileOperationOutcome.NotSubmitted(e.message ?: "Invalid destination path", e)
        }
        if (
            token.owner != capturedOwner ||
            token.kind != ReservationKind.MUTATION_SUBTREE ||
            token.state != ReservationState.ACTIVE ||
            !token.paths.contains(normalizedSource) ||
            (normalizedDest != null && !token.paths.contains(normalizedDest))
        ) {
            releaseIfActive(token)
            return FileOperationOutcome.NotSubmitted("Reservation token failed owner/path qualification check")
        }

        if (checkDirtySubtree && dirtyGuardPort != null) {
            val hasDirtySource = dirtyGuardPort.isFileDirty(capturedTarget, normalizedSource) ||
                dirtyGuardPort.hasDirtyDescendants(capturedTarget, normalizedSource)
            val hasDirtyDest = normalizedDest != null && (
                dirtyGuardPort.isFileDirty(capturedTarget, normalizedDest) ||
                    dirtyGuardPort.hasDirtyDescendants(capturedTarget, normalizedDest)
                )
            if (hasDirtySource || hasDirtyDest) {
                releaseIfActive(token)
                return FileOperationOutcome.NotSubmitted(
                    "Cannot $op '$normalizedSource' while open editor documents have unsaved edits"
                )
            }
        }

        _isMutating.value = true
        val outcome = try {
            repository.executeFsOpWithOutcome(
                target = capturedTarget,
                op = op,
                path = normalizedSource,
                newPath = normalizedDest,
                forceGit = false,
                reservationToken = token,
            )
        } catch (e: CancellationException) {
            if (token.state == ReservationState.QUARANTINED) {
                recordUnresolvedMutation(
                    actionId = actionId,
                    owner = capturedOwner,
                    target = capturedTarget,
                    op = op,
                    sourcePath = normalizedSource,
                    destPath = normalizedDest,
                    stage = OperationStage.AWAITING_RESULT,
                    opId = null,
                    message = "Cancelled while awaiting server confirmation for $op",
                )
            } else {
                releaseIfActive(token)
            }
            _isMutating.value = false
            throw e
        } catch (t: Throwable) {
            releaseIfActive(token)
            _isMutating.value = false
            return FileOperationOutcome.NotSubmitted(t.message ?: "Failed before mutation dispatch", t)
        }
        _isMutating.value = false

        when (outcome) {
            is FileOperationOutcome.Confirmed -> {
                releaseIfActive(token)
                try {
                    onConfirmedRefresh()
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    // Confirmed server operation remains Confirmed even if follow-up refresh fails
                }
            }
            is FileOperationOutcome.NotSubmitted, is FileOperationOutcome.Rejected -> {
                releaseIfActive(token)
            }
            is FileOperationOutcome.Unknown -> {
                if (token.state == ReservationState.ACTIVE) {
                    arbiter.quarantineToken(
                        token,
                        QuarantinedOperation(
                            owner = capturedOwner,
                            path = normalizedSource,
                            stage = outcome.stage,
                            opId = outcome.opId,
                            timestampMillis = Clock.System.now().toEpochMilliseconds(),
                            error = outcome.cause,
                        ),
                    )
                }
                recordUnresolvedMutation(
                    actionId = actionId,
                    owner = capturedOwner,
                    target = capturedTarget,
                    op = op,
                    sourcePath = normalizedSource,
                    destPath = normalizedDest,
                    stage = outcome.stage,
                    opId = outcome.opId,
                    message = outcome.message,
                )
            }
        }

        return outcome
    }

    private fun releaseIfActive(token: ReservationToken) {
        if (token.state == ReservationState.ACTIVE) {
            try {
                arbiter.releaseToken(token)
            } catch (_: IllegalStateException) {}
        }
    }

    private fun recordUnresolvedMutation(
        actionId: Long,
        owner: WorkspaceFileOwner,
        target: ProjectTargetRef,
        op: String,
        sourcePath: String,
        destPath: String?,
        stage: OperationStage,
        opId: String?,
        message: String,
    ) {
        val record = UnresolvedFileMutation(
            actionId = actionId,
            owner = owner,
            target = target,
            operation = op,
            sourcePath = sourcePath,
            destinationPath = destPath,
            stage = stage,
            opId = opId,
            message = message,
        )
        _unresolvedOperations.value = _unresolvedOperations.value
            .filterNot { it.owner == owner && it.sourcePath == sourcePath && it.operation == op } + record
    }

    // --- Legacy FsOpOutcome Compatibility Wrappers ---

    suspend fun createFile(parentPath: String, name: String): FsOpOutcome {
        val cleanParent = sanitizePath(parentPath)
        val cleanName = validateName(name)
        return toLegacyFsOpOutcome(createFileWithOutcome(cleanParent, cleanName))
    }

    suspend fun createDirectory(parentPath: String, name: String): FsOpOutcome {
        val cleanParent = sanitizePath(parentPath)
        val cleanName = validateName(name)
        return toLegacyFsOpOutcome(createDirectoryWithOutcome(cleanParent, cleanName))
    }

    suspend fun rename(path: String, newName: String): FsOpOutcome {
        val cleanSource = sanitizePath(path)
        require(cleanSource.isNotEmpty()) { "Cannot rename root directory" }
        val cleanName = validateName(newName)
        return toLegacyFsOpOutcome(renameWithOutcome(cleanSource, cleanName))
    }

    suspend fun move(sourcePath: String, destDirPath: String): FsOpOutcome {
        val cleanSource = sanitizePath(sourcePath)
        require(cleanSource.isNotEmpty()) { "Cannot move root directory" }
        val cleanDestDir = sanitizePath(destDirPath)
        return toLegacyFsOpOutcome(moveWithOutcome(cleanSource, cleanDestDir))
    }

    suspend fun delete(path: String, forceGit: Boolean = false): FsOpOutcome {
        val cleanPath = sanitizePath(path)
        require(cleanPath.isNotEmpty()) { "Cannot delete root directory" }
        return toLegacyFsOpOutcome(deleteWithOutcome(cleanPath, confirmed = true, forceGit = forceGit))
    }

    private fun toLegacyFsOpOutcome(outcome: FileOperationOutcome<FsOpOutcome>): FsOpOutcome = when (outcome) {
        is FileOperationOutcome.Confirmed -> outcome.result
        is FileOperationOutcome.Rejected -> FsOpOutcome(ok = false, error = "[${outcome.code}] ${outcome.message}")
        is FileOperationOutcome.NotSubmitted -> FsOpOutcome(ok = false, error = outcome.reason)
        is FileOperationOutcome.Unknown -> FsOpOutcome(
            ok = false,
            error = "Outcome unresolved (${outcome.stage}): ${outcome.message}",
        )
    }
}
