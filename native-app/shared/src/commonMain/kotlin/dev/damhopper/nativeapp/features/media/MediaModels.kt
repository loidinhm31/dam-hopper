package dev.damhopper.nativeapp.features.media

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

enum class MediaKind {
    IMAGE,
    VIDEO
}

enum class MediaPurpose {
    @SerialName("preview")
    PREVIEW,
    @SerialName("playback")
    PLAYBACK,
    @SerialName("download")
    DOWNLOAD
}

@Serializable
data class IssueImageTicketRequest(
    val project: String,
    val worktreePath: String? = null,
    val path: String,
    val mediaClientId: String,
)

@Serializable
data class IssueImageTicketResponse(
    val ticket: String,
    val streamPath: String,
    val expiresAt: Long,
    val purpose: String = "preview",
    val authorizationMode: String = "session-cookie-v2",
)

@Serializable
data class IssueVideoTicketRequest(
    val project: String,
    val worktreePath: String? = null,
    val path: String,
    val purpose: String,
    val mediaClientId: String,
)

@Serializable
data class IssueVideoTicketResponse(
    val ticket: String,
    val streamPath: String,
    val expiresAt: Long,
    val purpose: String,
    val authorizationMode: String = "session-cookie-v2",
)

@Serializable
data class RevokeTicketRequest(
    val ticket: String,
    val mediaClientId: String,
)

@Serializable
data class RevokeMediaSessionRequest(
    val mediaClientId: String,
)

/**
 * Active media lease capturing the ephemeral stream ticket, namespaced cookie,
 * purpose, and connection generation fence.
 */
data class MediaLease(
    val kind: MediaKind,
    val ticket: String,
    val streamPath: String,
    val expiresAtEpochMs: Long,
    val purpose: MediaPurpose,
    val mediaClientId: String,
    val cookieHeader: String?,
    val ownerRef: ConnectionRef,
) {
    fun isExpired(nowEpochMs: Long = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()): Boolean =
        nowEpochMs >= expiresAtEpochMs

    fun assertValidOwner(currentOwner: ConnectionRef?) {
        if (currentOwner != null) {
            require(ownerRef.profileId == currentOwner.profileId && ownerRef.generation == currentOwner.generation) {
                "MediaLease owner mismatch: lease owned by ${ownerRef.key}, current is ${currentOwner.key}"
            }
        }
    }

    override fun toString(): String =
        "MediaLease(kind=$kind, ticket=[REDACTED], streamPath='$streamPath', expiresAt=$expiresAtEpochMs, purpose=$purpose, mediaClientId='$mediaClientId', cookie=[REDACTED], ownerRef=$ownerRef)"
}

class MediaException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
