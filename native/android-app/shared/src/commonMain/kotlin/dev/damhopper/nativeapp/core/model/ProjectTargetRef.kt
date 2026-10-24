package dev.damhopper.nativeapp.core.model

import kotlinx.serialization.Serializable

/**
 * References a project under an optional profile scope.
 */
@Serializable
data class ProjectRef(
    val profileId: ProfileId? = null,
    val project: String,
) {
    init {
        require(project.isNotBlank()) { "project name cannot be blank" }
    }

    val key: String get() = projectKey(this)

    companion object {
        fun projectKey(ref: ProjectRef): String =
            """["${ref.profileId.orEmpty()}","${ref.project}"]"""
    }
}

/**
 * Qualified reference to a project target (project + optional worktreePath).
 */
@Serializable
data class ProjectTargetRef(
    val profileId: ProfileId? = null,
    val project: String,
    val worktreePath: String? = null,
) {
    init {
        require(project.isNotBlank()) { "project name cannot be blank" }
    }

    val key: String get() = projectTargetKey(this)

    /**
     * Projects to wire-safe ServerProjectTarget payload, stripping profileId.
     */
    fun toServerPayload(): ServerProjectTarget = ServerProjectTarget(
        project = project,
        worktreePath = normalizeProjectTargetPath(worktreePath),
    )

    companion object {
        fun projectTargetKey(ref: ProjectTargetRef): String {
            val normalizedWorktree = normalizeProjectTargetPath(ref.worktreePath)
            val wtPart = if (normalizedWorktree != null) "\"$normalizedWorktree\"" else "null"
            return """["${ref.profileId.orEmpty()}","${ref.project}",$wtPart]"""
        }
    }
}

/**
 * Wire representation sent to the server. Never contains profileId.
 */
@Serializable
data class ServerProjectTarget(
    val project: String,
    val worktreePath: String? = null,
)

/**
 * Normalizes project target worktree paths.
 */
fun normalizeProjectTargetPath(path: String?): String? {
    if (path.isNullOrBlank()) return null
    val trimmed = path.trim().replace('\\', '/')
    if (trimmed == "." || trimmed == "./") return null

    val isAbsolute = trimmed.startsWith('/')
    val segments = mutableListOf<String>()
    for (segment in trimmed.split('/')) {
        if (segment.isEmpty() || segment == ".") continue
        if (segment == ".." && segments.isNotEmpty() && segments.last() != "..") {
            segments.removeAt(segments.size - 1)
        } else if (segment != "..") {
            segments.add(segment)
        }
    }

    val suffix = segments.joinToString("/")
    if (suffix.isEmpty()) return if (isAbsolute) "/" else null
    return if (isAbsolute) "/$suffix" else suffix
}

/**
 * Validates that a target belongs to the expected connection owner.
 */
fun assertOwnerMatch(
    expected: ConnectionRef,
    actualProfileId: ProfileId?,
    operation: String = "operation",
) {
    if (actualProfileId != null && actualProfileId != expected.profileId) {
        throw ConnectionOwnerError(
            "Owner mismatch for $operation: expected '${expected.profileId}' but received '$actualProfileId'",
            ConnectionErrorReason.OWNER_MISMATCH,
        )
    }
}
