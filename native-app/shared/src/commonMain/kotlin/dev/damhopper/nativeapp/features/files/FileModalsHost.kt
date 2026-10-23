package dev.damhopper.nativeapp.features.files

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Hosts inline file creation, renaming, moving, and deletion dialogs with retained
 * action state, error surfacing, and unresolved-outcome retry blocking.
 */
@Composable
fun FileModalsHost(
    rootNode: FileTreeNode,
    selectedPath: String?,
    mutationCoordinator: FileMutationCoordinator,
    coroutineScope: CoroutineScope,
    showHidden: Boolean = true,
) {
    val retainedDialog by mutationCoordinator.dialogState.collectAsState()
    val availableDirectories = remember(rootNode, showHidden) {
        FileTreeHelpers.collectLoadedDirectoryPaths(rootNode, showHidden = showHidden)
    }

    when (val dialog = retainedDialog) {
        is ExplorerDialogState.CreateFile -> {
            CreateItemDialog(
                isDirectory = false,
                parentPath = dialog.parentPath,
                draftName = dialog.draftName,
                onDraftChange = { mutationCoordinator.updateDialogDraft(it) },
                isSubmitting = dialog.isSubmitting,
                isUnresolved = dialog.unknownOutcome != null,
                errorMessage = dialog.errorMessage,
                onConfirm = {
                    coroutineScope.launch {
                        mutationCoordinator.submitCurrentDialog()
                    }
                },
                onDismiss = {
                    mutationCoordinator.dismissDialog()
                },
            )
        }
        is ExplorerDialogState.CreateDirectory -> {
            CreateItemDialog(
                isDirectory = true,
                parentPath = dialog.parentPath,
                draftName = dialog.draftName,
                onDraftChange = { mutationCoordinator.updateDialogDraft(it) },
                isSubmitting = dialog.isSubmitting,
                isUnresolved = dialog.unknownOutcome != null,
                errorMessage = dialog.errorMessage,
                onConfirm = {
                    coroutineScope.launch {
                        mutationCoordinator.submitCurrentDialog()
                    }
                },
                onDismiss = {
                    mutationCoordinator.dismissDialog()
                },
            )
        }
        is ExplorerDialogState.Rename -> {
            RenameItemDialog(
                currentName = dialog.currentName,
                sourcePath = dialog.sourcePath,
                draftNewName = dialog.draftNewName,
                onDraftChange = { mutationCoordinator.updateDialogDraft(it) },
                isSubmitting = dialog.isSubmitting,
                isUnresolved = dialog.unknownOutcome != null,
                errorMessage = dialog.errorMessage,
                onConfirm = {
                    coroutineScope.launch {
                        mutationCoordinator.submitCurrentDialog()
                    }
                },
                onDismiss = {
                    mutationCoordinator.dismissDialog()
                },
            )
        }
        is ExplorerDialogState.Move -> {
            MoveItemDialog(
                sourcePath = dialog.sourcePath,
                draftDestDirPath = dialog.draftDestDirPath,
                availableDirectories = availableDirectories,
                onDraftChange = { mutationCoordinator.updateDialogDraft(it) },
                isSubmitting = dialog.isSubmitting,
                isUnresolved = dialog.unknownOutcome != null,
                errorMessage = dialog.errorMessage,
                onConfirm = {
                    coroutineScope.launch {
                        mutationCoordinator.submitCurrentDialog()
                    }
                },
                onDismiss = {
                    mutationCoordinator.dismissDialog()
                },
            )
        }
        is ExplorerDialogState.DeleteConfirm -> {
            DeleteConfirmDialog(
                path = dialog.targetPath,
                isDirectory = dialog.isDirectory,
                isSubmitting = dialog.isSubmitting,
                isUnresolved = dialog.unknownOutcome != null,
                errorMessage = dialog.errorMessage,
                onConfirm = {
                    coroutineScope.launch {
                        mutationCoordinator.submitCurrentDialog()
                    }
                },
                onDismiss = {
                    mutationCoordinator.dismissDialog()
                },
            )
        }
        ExplorerDialogState.None -> Unit
    }
}
