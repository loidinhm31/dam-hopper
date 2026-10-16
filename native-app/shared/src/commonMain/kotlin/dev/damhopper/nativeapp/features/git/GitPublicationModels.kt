package dev.damhopper.nativeapp.features.git

import kotlinx.serialization.Serializable

/**
 * Frozen lease snapshot returned by /api/git/{project}/push/prepare
 * and consumed strictly by /api/git/{project}/push/publish
 */
@Serializable
data class PublishSnapshot(
    val branch: String,
    val sourceOid: String,
    val remoteName: String,
    val destinationRef: String,
    val expectedRemoteOid: String,
    val remoteIdentity: String? = null,
    val repositoryIdentity: String? = null,
)

/**
 * Leased push preview returned by POST /api/git/{project}/push/prepare
 */
@Serializable
data class PublishPreview(
    val status: String, // ready | blocked
    val snapshot: PublishSnapshot? = null,
    val reason: String? = null, // missing-upstream | ambiguous-destination | missing-destination | detached-head
    val message: String? = null,
    val alreadyCurrent: Boolean = false,
) {
    val isReady: Boolean get() = status == "ready" && snapshot != null
}

/**
 * Outcome of POST /api/git/{project}/push/publish
 */
@Serializable
data class PublishResult(
    val status: String, // published | already-current | stale-remote | stale-local | stale-config | rejected | auth-required | unknown
    val message: String? = null,
    val actualRemoteOid: String? = null,
) {
    val isPublished: Boolean get() = status == "published" || status == "already-current"
    val isStaleRemote: Boolean get() = status == "stale-remote"
}

@Serializable
data class PrepareLeasedPushRequest(
    val branch: String? = null,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class PublishLeasedPushRequest(
    val snapshot: PublishSnapshot,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class GitOpTarget(
    val project: String,
    val worktreePath: String? = null,
)

/**
 * Per-target result of fetch, pull, or normal push matching server GitOperationResultResponse
 */
@Serializable
data class GitOpResult(
    val projectName: String = "",
    val operation: String = "fetch",
    val success: Boolean,
    val summary: String? = null,
    val error: String? = null,
    val durationMs: Long = 0L,
    val worktreePath: String? = null,
    val targetUnavailable: Boolean = false,
) {
    val project: String get() = projectName
    val message: String? get() = error ?: summary
}

@Serializable
data class PushRequest(
    val project: String,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class FetchPullRequest(
    val projects: List<String>? = null,
    val targets: List<GitOpTarget>? = null,
)
