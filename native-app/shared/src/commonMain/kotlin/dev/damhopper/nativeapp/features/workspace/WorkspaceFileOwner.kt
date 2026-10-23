package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import kotlinx.serialization.Serializable

/**
 * Structured logical owner binding endpoint, authenticated account identity,
 * project target, and optional worktree.
 *
 * Account identity is strictly the server-returned AuthSession.user (or "dev-user"
 * in loopback devMode). Labels or ServerProfile.username alone are never identities.
 */
@Serializable
data class WorkspaceFileOwner(
    val profileId: ProfileId?,
    val baseUrl: String,
    val accountUser: String,
    val project: String,
    val worktreePath: String? = null,
) {
    val normalizedBaseUrl: String = normalizeBaseUrl(baseUrl)
    val normalizedWorktreePath: String? = normalizeWorktree(worktreePath)

    init {
        require(normalizedBaseUrl.isNotBlank()) { "baseUrl cannot be blank" }
        require(accountUser.isNotBlank()) { "accountUser cannot be blank" }
        require(project.isNotBlank()) { "project cannot be blank" }
    }

    fun matchesTarget(target: ProjectTargetRef): Boolean {
        if (target.profileId != null && target.profileId != profileId) return false
        if (project.isNotBlank() && project != "*" && target.project != project) return false
        val targetWorktree = normalizeWorktree(target.worktreePath)
        return targetWorktree == normalizedWorktreePath
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is WorkspaceFileOwner) return false
        return profileId == other.profileId &&
            normalizedBaseUrl == other.normalizedBaseUrl &&
            accountUser == other.accountUser &&
            project == other.project &&
            normalizedWorktreePath == other.normalizedWorktreePath
    }

    override fun hashCode(): Int {
        var result = profileId?.hashCode() ?: 0
        result = 31 * result + normalizedBaseUrl.hashCode()
        result = 31 * result + accountUser.hashCode()
        result = 31 * result + project.hashCode()
        result = 31 * result + (normalizedWorktreePath?.hashCode() ?: 0)
        return result
    }

    fun toProjectTargetRef(): ProjectTargetRef = ProjectTargetRef(
        profileId = profileId,
        project = project,
        worktreePath = normalizedWorktreePath,
    )

    companion object {
        fun normalizeBaseUrl(url: String): String =
            url.trim().trimEnd('/')

        fun normalizeWorktree(path: String?): String? =
            path?.trim()?.takeIf { it.isNotBlank() }?.let { raw ->
                val cleaned = raw.replace('\\', '/').trim().trim('/')
                cleaned.ifBlank { null }
            }

        fun fromSession(
            profile: ServerProfile,
            authStatus: AuthStatus.Authenticated,
            project: String,
            worktreePath: String? = null,
        ): WorkspaceFileOwner {
            val user = authStatus.session.user
            require(user.isNotBlank()) { "Authenticated session user cannot be blank" }
            return WorkspaceFileOwner(
                profileId = profile.id,
                baseUrl = profile.baseUrl,
                accountUser = user,
                project = project,
                worktreePath = worktreePath,
            )
        }
    }
}

/**
 * Structured document identity: (logicalOwner, relativePath, tabIncarnation).
 * Monotonic tabIncarnation is retained across reconnects and closes/reopens.
 * Rekeying updates relativePath while preserving owner, undo history, and incarnation.
 */
@Serializable
data class DocumentId(
    val owner: WorkspaceFileOwner,
    val relativePath: String,
    val tabIncarnation: Long,
) {
    val normalizedPath: String = normalizeRelativePath(relativePath)

    init {
        require(tabIncarnation > 0) { "tabIncarnation must be positive ($tabIncarnation)" }
    }

    fun rekeyed(newPath: String): DocumentId = copy(
        relativePath = normalizeRelativePath(newPath)
    )

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DocumentId) return false
        return owner == other.owner &&
            normalizedPath == other.normalizedPath &&
            tabIncarnation == other.tabIncarnation
    }

    override fun hashCode(): Int {
        var result = owner.hashCode()
        result = 31 * result + normalizedPath.hashCode()
        result = 31 * result + tabIncarnation.hashCode()
        return result
    }

    /**
     * Collision-free presentation key using length-prefixed structured segments.
     */
    val presentationKey: String
        get() {
            fun encodeSegment(s: String): String = "${s.length}:$s"
            return listOf(
                encodeSegment(owner.profileId.orEmpty()),
                encodeSegment(owner.normalizedBaseUrl),
                encodeSegment(owner.accountUser),
                encodeSegment(owner.project),
                encodeSegment(owner.normalizedWorktreePath.orEmpty()),
                encodeSegment(normalizedPath),
                "#$tabIncarnation"
            ).joinToString("/")
        }
    companion object {
        fun normalizeRelativePath(path: String): String {
            val trimmed = path.trim().replace('\\', '/')
            require(!trimmed.startsWith("/") && !trimmed.contains(":") && !trimmed.startsWith("\\")) {
                "Absolute or drive-qualified paths rejected: $path"
            }
            val segments = trimmed.split('/').filter { it.isNotEmpty() && it != "." }
            val resolved = ArrayList<String>(segments.size)
            for (segment in segments) {
                if (segment == "..") {
                    require(resolved.isNotEmpty()) {
                        "Path traversal outside project root rejected: $path"
                    }
                    resolved.removeAt(resolved.lastIndex)
                } else {
                    resolved.add(segment)
                }
            }
            return resolved.joinToString("/")
        }
    }
}

/**
 * Revocable file authority binding logical owner, connection generation,
 * live socket reference, and retirement token.
 */
data class FileAuthority(
    val owner: WorkspaceFileOwner,
    val connection: ConnectionRef,
    val socketRef: SocketInstanceRef? = null,
    val retirementToken: Long = 0L,
    val isRetired: Boolean = false,
) {
    fun assertValid(target: ProjectTargetRef, requireSocket: Boolean = false) {
        if (isRetired) {
            throw IllegalStateException("FileAuthority is retired for owner ${owner.project} (profile=${owner.profileId})")
        }
        if (!owner.matchesTarget(target)) {
            throw IllegalArgumentException("ProjectTargetRef $target does not match authority owner $owner")
        }
        if (requireSocket && socketRef == null) {
            throw IllegalStateException("FileAuthority requires active live socketRef for WebSocket operations")
        }
    }

    fun retired(): FileAuthority = copy(isRetired = true)
}
