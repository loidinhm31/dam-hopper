package dev.damhopper.nativeapp.features.files

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Hosts inline file creation, renaming, and deletion dialogs with error handling
 * and failure surfacing.
 */
@Composable
fun FileModalsHost(
    rootNode: FileTreeNode,
    selectedPath: String?,
    showCreateFileDialog: Boolean,
    showCreateDirDialog: Boolean,
    showRenameDialog: Boolean,
    showDeleteDialog: Boolean,
    onDismissCreateFile: () -> Unit,
    onDismissCreateDir: () -> Unit,
    onDismissRename: () -> Unit,
    onDismissDelete: () -> Unit,
    mutationCoordinator: FileMutationCoordinator,
    coroutineScope: CoroutineScope,
) {
    var dialogError by remember { mutableStateOf<String?>(null) }

    if (showCreateFileDialog) {
        val parent = selectedPath?.let {
            val node = FileTreeHelpers.findNode(rootNode, it)
            if (node?.isDirectory == true) it else FileTreeHelpers.resolveParentPath(it)
        } ?: ""

        CreateItemDialog(
            isDirectory = false,
            parentPath = parent,
            errorMessage = dialogError,
            onConfirm = { name ->
                coroutineScope.launch {
                    try {
                        val outcome = mutationCoordinator.createFile(parent, name)
                        if (outcome.ok) {
                            dialogError = null
                            onDismissCreateFile()
                        } else {
                            dialogError = outcome.error ?: "Create file failed"
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        dialogError = e.message ?: "Invalid file name"
                    }
                }
            },
            onDismiss = {
                dialogError = null
                onDismissCreateFile()
            },
        )
    }

    if (showCreateDirDialog) {
        val parent = selectedPath?.let {
            val node = FileTreeHelpers.findNode(rootNode, it)
            if (node?.isDirectory == true) it else FileTreeHelpers.resolveParentPath(it)
        } ?: ""

        CreateItemDialog(
            isDirectory = true,
            parentPath = parent,
            errorMessage = dialogError,
            onConfirm = { name ->
                coroutineScope.launch {
                    try {
                        val outcome = mutationCoordinator.createDirectory(parent, name)
                        if (outcome.ok) {
                            dialogError = null
                            onDismissCreateDir()
                        } else {
                            dialogError = outcome.error ?: "Create directory failed"
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        dialogError = e.message ?: "Invalid directory name"
                    }
                }
            },
            onDismiss = {
                dialogError = null
                onDismissCreateDir()
            },
        )
    }

    if (showRenameDialog && selectedPath != null) {
        val path = selectedPath
        val currentName = path.substringAfterLast('/')

        RenameItemDialog(
            currentName = currentName,
            errorMessage = dialogError,
            onConfirm = { newName ->
                coroutineScope.launch {
                    try {
                        val outcome = mutationCoordinator.rename(path, newName)
                        if (outcome.ok) {
                            dialogError = null
                            onDismissRename()
                        } else {
                            dialogError = outcome.error ?: "Rename failed"
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        dialogError = e.message ?: "Invalid rename destination"
                    }
                }
            },
            onDismiss = {
                dialogError = null
                onDismissRename()
            },
        )
    }

    if (showDeleteDialog && selectedPath != null) {
        val path = selectedPath
        val node = FileTreeHelpers.findNode(rootNode, path)
        val isDir = node?.isDirectory ?: false

        DeleteConfirmDialog(
            path = path,
            isDirectory = isDir,
            errorMessage = dialogError,
            onConfirm = {
                coroutineScope.launch {
                    try {
                        val outcome = mutationCoordinator.delete(path)
                        if (outcome.ok) {
                            dialogError = null
                            onDismissDelete()
                        } else {
                            dialogError = outcome.error ?: "Delete failed"
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        dialogError = e.message ?: "Failed to delete"
                    }
                }
            },
            onDismiss = {
                dialogError = null
                onDismissDelete()
            },
        )
    }
}
