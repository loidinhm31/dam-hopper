package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef

/**
 * Validates and executes mutating fs:op operations (create, rename, move, delete)
 * without treating remote paths as local Android filesystem paths, and invalidates
 * affected tree directories upon success.
 */
class FileMutationCoordinator(
    private val repository: FileRepository,
    private val treeState: FileTreeState,
) {
    val target: ProjectTargetRef
        get() = treeState.target

    /**
     * Sanitizes a project-relative path: strips leading slashes, checks against path traversal segments.
     */
    private fun sanitizePath(path: String): String {
        val trimmed = path.trim().trim('/')
        if (trimmed.isEmpty()) return ""
        val segments = trimmed.split('/')
        require(segments.none { it == ".." || it == "." }) {
            "Path traversal ('..' or '.') is strictly prohibited: $path"
        }
        return trimmed
    }

    private fun validateName(name: String): String {
        val trimmed = name.trim().trim('/')
        require(
            trimmed.isNotBlank() &&
            trimmed != "." &&
            trimmed != ".." &&
            !trimmed.contains('/') &&
            !trimmed.contains('\\') &&
            !trimmed.contains('\u0000')
        ) {
            "Invalid file or directory name: $name"
        }
        return trimmed
    }

    private suspend fun createEntry(parentPath: String, name: String, isDir: Boolean): FsOpOutcome {
        val cleanParent = sanitizePath(parentPath)
        val cleanName = validateName(name)

        val relativePath = if (cleanParent.isEmpty()) cleanName else "$cleanParent/$cleanName"
        val op = if (isDir) "create_dir" else "create_file"
        val outcome = repository.executeFsOp(
            target = target,
            op = op,
            path = relativePath,
        )

        if (outcome.ok) {
            treeState.loadDirectory(cleanParent)
        }
        return outcome
    }

    suspend fun createFile(parentPath: String, name: String): FsOpOutcome =
        createEntry(parentPath, name, isDir = false)

    suspend fun createDirectory(parentPath: String, name: String): FsOpOutcome =
        createEntry(parentPath, name, isDir = true)

    suspend fun rename(path: String, newName: String): FsOpOutcome {
        val cleanSource = sanitizePath(path)
        require(cleanSource.isNotEmpty()) { "Cannot rename root directory" }
        val cleanName = validateName(newName)

        val parentPath = FileTreeHelpers.resolveParentPath(cleanSource)
        val newRelativePath = if (parentPath.isEmpty()) cleanName else "$parentPath/$cleanName"

        val outcome = repository.executeFsOp(
            target = target,
            op = "rename",
            path = cleanSource,
            newPath = newRelativePath,
        )

        if (outcome.ok) {
            treeState.loadDirectory(parentPath)
        }
        return outcome
    }

    suspend fun move(sourcePath: String, destDirPath: String): FsOpOutcome {
        val cleanSource = sanitizePath(sourcePath)
        require(cleanSource.isNotEmpty()) { "Cannot move root directory" }
        val cleanDestDir = sanitizePath(destDirPath)
        val fileName = cleanSource.substringAfterLast('/')

        val newRelativePath = if (cleanDestDir.isEmpty()) fileName else "$cleanDestDir/$fileName"
        val outcome = repository.executeFsOp(
            target = target,
            op = "move",
            path = cleanSource,
            newPath = newRelativePath,
        )

        if (outcome.ok) {
            val sourceParent = FileTreeHelpers.resolveParentPath(cleanSource)
            treeState.loadDirectory(sourceParent)
            if (sourceParent != cleanDestDir) {
                treeState.loadDirectory(cleanDestDir)
            }
        }
        return outcome
    }

    suspend fun delete(path: String, forceGit: Boolean = false): FsOpOutcome {
        val cleanPath = sanitizePath(path)
        require(cleanPath.isNotEmpty()) { "Cannot delete root directory" }
        val parentPath = FileTreeHelpers.resolveParentPath(cleanPath)

        val outcome = repository.executeFsOp(
            target = target,
            op = "delete",
            path = cleanPath,
            forceGit = forceGit,
        )

        if (outcome.ok) {
            treeState.loadDirectory(parentPath)
            if (treeState.selectedPath.value == cleanPath) {
                treeState.selectPath(null)
            }
        }
        return outcome
    }
}
