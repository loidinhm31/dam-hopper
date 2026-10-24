package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef

/**
 * Pure helper functions for manipulating immutable FileTreeNode hierarchies.
 */
object FileTreeHelpers {

    /**
     * Resolves parent path for a relative path.
     */
    fun resolveParentPath(path: String): String {
        val clean = path.trim('/').trim()
        val idx = clean.lastIndexOf('/')
        return if (idx >= 0) clean.substring(0, idx) else ""
    }

    /**
     * Recursively locates a node by relative path ("" matches root).
     */
    fun findNode(root: FileTreeNode, path: String): FileTreeNode? {
        val targetPath = path.trim('/').trim()
        val currentPath = root.path.trim('/').trim()
        if (currentPath == targetPath) return root
        if (!root.isDirectory) return null

        for (child in root.children) {
            val childPath = child.path.trim('/').trim()
            if (targetPath == childPath || (targetPath.startsWith("$childPath/") && child.isDirectory)) {
                val found = findNode(child, targetPath)
                if (found != null) return found
            }
        }
        return null
    }

    /**
     * Recursively transforms a node matching targetPath.
     */
    fun updateNode(
        root: FileTreeNode,
        targetPath: String,
        transform: (FileTreeNode) -> FileTreeNode,
    ): FileTreeNode {
        val cleanTarget = targetPath.trim('/').trim()
        val cleanCurrent = root.path.trim('/').trim()

        if (cleanCurrent == cleanTarget) {
            return transform(root)
        }

        if (!root.isDirectory) return root

        var anyChanged = false
        val newChildren = root.children.map { child ->
            val childPath = child.path.trim('/').trim()
            if (cleanTarget == childPath || (cleanTarget.startsWith("$childPath/") && child.isDirectory)) {
                val updated = updateNode(child, cleanTarget, transform)
                if (updated !== child) anyChanged = true
                updated
            } else {
                child
            }
        }

        return if (anyChanged) root.copy(children = newChildren) else root
    }

    /**
     * Replaces the children of a directory node with newly fetched DirEntryDto items.
     * Preserves expansion state of existing child directories.
     */
    fun updateChildren(
        root: FileTreeNode,
        dirPath: String,
        entries: List<DirEntryDto>,
        target: ProjectTargetRef,
    ): FileTreeNode {
        val cleanDir = dirPath.trim('/').trim()

        return updateNode(root, cleanDir) { parent ->
            val existingByPath = parent.children.associateBy { it.path }
            val newChildren = entries
                .sortedWith(compareBy({ it.kind != "dir" }, { it.name.lowercase() }))
                .map { entry ->
                    val childPath = if (cleanDir.isEmpty()) entry.name else "$cleanDir/${entry.name}"
                    val existing = existingByPath[childPath]

                    FileTreeNode(
                        target = target,
                        path = childPath,
                        name = entry.name,
                        isDirectory = entry.kind == "dir",
                        size = entry.size,
                        mtime = entry.mtime,
                        isSymlink = entry.isSymlink,
                        isExpanded = existing?.isExpanded ?: false,
                        isLoading = false,
                        children = existing?.children ?: emptyList(),
                    )
                }

            parent.copy(
                isLoading = false,
                isExpanded = true,
                children = newChildren,
                error = null,
            )
        }
    }

    /**
     * Flattens expanded visible nodes into an indented list for LazyColumn virtualization.
     */
    fun flattenVisibleNodes(
        node: FileTreeNode,
        depth: Int = 0,
        showHidden: Boolean = false,
    ): List<Pair<FileTreeNode, Int>> {
        if (node.isHidden && !showHidden) return emptyList()
        val list = mutableListOf<Pair<FileTreeNode, Int>>()
        if (node.path.isNotEmpty()) {
            list.add(Pair(node, depth))
        }
        if (node.isDirectory && (node.isExpanded || node.path.isEmpty())) {
            val nextDepth = if (node.path.isEmpty()) depth else depth + 1
            for (child in node.children) {
                list.addAll(flattenVisibleNodes(child, nextDepth, showHidden))
            }
        }
        return list
    }

    /**
     * Formats a remote project-relative path for clipboard copy.
     * Preserves server/target relative semantics and never prefixes local device paths.
     */
    fun formatRemoteClipboardPath(path: String): String {
        val normalized = path.trim().replace('\\', '/').trim('/')
        if (normalized.isEmpty() || normalized == ".") return "."
        val segments = normalized.split('/').filter { it.isNotEmpty() && it != "." }
        require(segments.none { it == ".." }) {
            "Path traversal ('..') is prohibited in remote clipboard path: $path"
        }
        return segments.joinToString("/")
    }

    /**
     * Resolves the default parent directory path for creating a new file or folder
     * based on the current tree selection.
     */
    fun resolveCreateParentPath(root: FileTreeNode, selectedPath: String?): String {
        val sel = selectedPath?.trim()?.replace('\\', '/')?.trim('/') ?: return ""
        if (sel.isEmpty()) return ""
        val node = findNode(root, sel)
        return if (node?.isDirectory == true) sel else resolveParentPath(sel)
    }

    /**
     * Collects all known directory paths in the loaded tree ("" for root, plus loaded folders)
     * for touch destination selection in the Move dialog.
     */
    fun collectLoadedDirectoryPaths(
        node: FileTreeNode,
        showHidden: Boolean = false,
    ): List<String> {
        if (node.path.isNotEmpty() && node.isHidden && !showHidden) return emptyList()
        if (!node.isDirectory) return emptyList()
        val result = mutableListOf(node.path.trim('/'))
        for (child in node.children) {
            if (child.isDirectory) {
                result.addAll(collectLoadedDirectoryPaths(child, showHidden))
            }
        }
        return result.distinct()
    }
}
