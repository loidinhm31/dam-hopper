package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

/**
 * Kind of path reservation.
 */
enum class ReservationKind {
    EXACT_FILE_SAVE,
    MUTATION_SUBTREE,
    CHILD_SAVE,
}

/**
 * Lifecycle state of a reservation token.
 */
enum class ReservationState {
    ACTIVE,
    QUARANTINED,
    RELEASED,
}

/**
 * Handle representing an exclusive path reservation.
 */
interface ReservationToken {
    val id: Long
    val owner: WorkspaceFileOwner
    val paths: Set<String>
    val kind: ReservationKind
    val state: ReservationState
    val parentTokenId: Long?
}

/**
 * Target-scoped segment-aware reservation arbiter.
 *
 * Guarantees:
 * - Segment-aware ancestor/descendant conflict detection (e.g. 'a' never blocks 'ab', but blocks 'a/b').
 * - Atomic multi-path reservation for mutations (source and destination acquired together or not at all).
 * - Child-save capability to prevent self-deadlock when saving files during a mutation dirty prompt.
 * - Quarantine preservation: operations with Unknown outcome hold reservations until reconciled or abandoned.
 * - Strict owner isolation: reservations on one owner never block another.
 */
class FileOperationArbiter {
    private val lock = Any()
    private var nextTokenId = 1L
    private val activeTokens = mutableMapOf<Long, MutableReservationToken>()
    private val quarantinedOps = mutableMapOf<Long, QuarantinedOperation>()

    private class MutableReservationToken(
        override val id: Long,
        override val owner: WorkspaceFileOwner,
        override val paths: Set<String>,
        override val kind: ReservationKind,
        override var state: ReservationState = ReservationState.ACTIVE,
        override val parentTokenId: Long? = null,
    ) : ReservationToken

    /**
     * Attempts to acquire an exact-path reservation for a file save.
     * Returns a valid ReservationToken, or null if any path conflicts with an active/quarantined reservation.
     */
    fun tryReserveSave(owner: WorkspaceFileOwner, path: String): ReservationToken? = synchronized(lock) {
        val normalized = normalizeRelativePath(path)
        if (hasConflictLocked(owner, setOf(normalized), excludeTokenId = null)) {
            return null
        }
        val token = MutableReservationToken(
            id = nextTokenId++,
            owner = owner,
            paths = setOf(normalized),
            kind = ReservationKind.EXACT_FILE_SAVE,
        )
        activeTokens[token.id] = token
        token
    }

    /**
     * Atomically reserves source and optional destination subtrees for a mutation (rename/move/delete).
     * Either both paths are reserved or neither is.
     */
    fun tryReserveMutation(
        owner: WorkspaceFileOwner,
        sourcePath: String,
        destPath: String? = null,
    ): ReservationToken? = synchronized(lock) {
        val paths = mutableSetOf(normalizeRelativePath(sourcePath))
        if (destPath != null) {
            paths.add(normalizeRelativePath(destPath))
        }

        if (hasConflictLocked(owner, paths, excludeTokenId = null)) {
            return null
        }

        val token = MutableReservationToken(
            id = nextTokenId++,
            owner = owner,
            paths = paths,
            kind = ReservationKind.MUTATION_SUBTREE,
        )
        activeTokens[token.id] = token
        token
    }

    /**
     * Creates a child save token derived from an active mutation token.
     * Prevents self-deadlock when saving dirty documents within a reserved mutation subtree.
     */
    fun createChildSaveToken(parentToken: ReservationToken, savePath: String): ReservationToken = synchronized(lock) {
        val parent = activeTokens[parentToken.id]
            ?: throw IllegalStateException("Parent token ${parentToken.id} is not active")
        require(parent.state == ReservationState.ACTIVE) {
            "Cannot create child save token from inactive parent (state=${parent.state})"
        }
        require(parent.kind == ReservationKind.MUTATION_SUBTREE) {
            "Child save tokens can only be spawned from MUTATION_SUBTREE reservations (got ${parent.kind})"
        }
        val normalizedSave = normalizeRelativePath(savePath)
        val isEnclosed = parent.paths.any { parentPath ->
            isPathAncestorOrEqual(ancestor = parentPath, descendant = normalizedSave)
        }
        require(isEnclosed) {
            "Save path '$normalizedSave' is not directionally enclosed within parent reservation paths ${parent.paths}"
        }
        // Verify no conflicting reservation from ANOTHER token (excluding parent)
        if (hasConflictLocked(parent.owner, setOf(normalizedSave), excludeTokenId = parent.id)) {
            throw IllegalStateException("Conflicting reservation prevents child save on '$normalizedSave'")
        }

        val child = MutableReservationToken(
            id = nextTokenId++,
            owner = parent.owner,
            paths = setOf(normalizedSave),
            kind = ReservationKind.CHILD_SAVE,
            parentTokenId = parent.id,
        )
        activeTokens[child.id] = child
        child
    }

    /**
     * Quarantines a token due to an ambiguous Unknown operation outcome.
     * Quarantined tokens cannot be released by ordinary releaseToken().
     */
    fun quarantineToken(token: ReservationToken, operation: QuarantinedOperation): Unit = synchronized(lock) {
        val active = activeTokens[token.id]
            ?: throw IllegalStateException("Token ${token.id} is not tracked")
        active.state = ReservationState.QUARANTINED
        quarantinedOps[token.id] = operation
    }

    /**
     * Releases an active reservation token.
     * Throws IllegalStateException if the token is currently quarantined.
     */
    fun releaseToken(token: ReservationToken): Unit = synchronized(lock) {
        val active = activeTokens[token.id] ?: return@synchronized
        if (active.state == ReservationState.QUARANTINED) {
            throw IllegalStateException(
                "Cannot release quarantined token ${token.id} for path(s) ${token.paths}. " +
                    "Reconciliation or explicit abandonQuarantine required."
            )
        }
        active.state = ReservationState.RELEASED
        activeTokens.remove(token.id)
    }

    /**
     * Explicitly abandons a quarantined reservation after user confirmation or successful reconciliation.
     */
    fun abandonQuarantine(token: ReservationToken, reason: String): Unit = synchronized(lock) {
        val active = activeTokens[token.id] ?: return@synchronized
        active.state = ReservationState.RELEASED
        activeTokens.remove(token.id)
        quarantinedOps.remove(token.id)
    }

    /**
     * Checks if a path is currently reserved under the given owner.
     */
    fun isPathReserved(owner: WorkspaceFileOwner, path: String): Boolean = synchronized(lock) {
        val normalized = normalizeRelativePath(path)
        hasConflictLocked(owner, setOf(normalized), excludeTokenId = null)
    }

    /**
     * Returns all currently quarantined operations for the given owner.
     */
    fun getQuarantinedOperations(owner: WorkspaceFileOwner): List<QuarantinedOperation> = synchronized(lock) {
        quarantinedOps.values.filter { it.owner == owner }
    }

    private fun hasConflictLocked(
        owner: WorkspaceFileOwner,
        pathsToCheck: Set<String>,
        excludeTokenId: Long?,
    ): Boolean {
        for (token in activeTokens.values) {
            if (excludeTokenId != null && token.id == excludeTokenId) {
                continue
            }
            if (token.owner != owner) continue
            if (token.state == ReservationState.RELEASED) continue
            for (targetPath in pathsToCheck) {
                for (existingPath in token.paths) {
                    if (pathsConflict(targetPath, existingPath)) {
                        return true
                    }
                }
            }
        }
        return false
    }

    companion object {
        fun normalizeRelativePath(path: String): String =
            dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(path)

        fun normalizeSegments(path: String): List<String> {
            val trimmed = path.trim().replace('\\', '/')
            return trimmed.split('/').filter { it.isNotEmpty() && it != "." }
        }

        /**
         * Checks whether two project-relative paths conflict.
         * Segment-aware:
         * - 'a' and 'ab' DO NOT conflict (different segments).
         * - 'a' and 'a/b' DO conflict (one is ancestor of another).
         * - 'a/b' and 'a/b' DO conflict (exact match).
         * - '' (root) conflicts with every path.
         */
        fun pathsConflict(path1: String, path2: String): Boolean {
            val segs1 = normalizeSegments(path1)
            val segs2 = normalizeSegments(path2)
            if (segs1.isEmpty() || segs2.isEmpty()) return true
            val minLen = minOf(segs1.size, segs2.size)
            for (i in 0 until minLen) {
                if (segs1[i] != segs2[i]) return false
            }
            return true
        }

        /**
         * Directional check: returns true if ancestor is equal to or an ancestor of descendant.
         * E.g. 'src' is an ancestor of 'src/main.kt', but 'src/main.kt' is NOT an ancestor of 'src'.
         */
        fun isPathAncestorOrEqual(ancestor: String, descendant: String): Boolean {
            val segsAncestor = normalizeSegments(ancestor)
            val segsDescendant = normalizeSegments(descendant)
            if (segsAncestor.isEmpty()) return true
            if (segsAncestor.size > segsDescendant.size) return false
            for (i in segsAncestor.indices) {
                if (segsAncestor[i] != segsDescendant[i]) return false
            }
            return true
        }
    }
}
