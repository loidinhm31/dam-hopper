package dev.damhopper.nativeapp.features.profiles

import kotlinx.serialization.Serializable

/**
 * Fences an asynchronous authentication attempt (login, MFA challenge, step-up)
 * against concurrent profile lifecycle events (logout, profile removal, endpoint edit, rotation).
 *
 * If the attempt ID does not match the profile's active attempt watermark,
 * the response is rejected and not written to the CredentialVault.
 */
@Serializable
data class AuthAttemptRef(
    val profileId: String,
    val attemptId: Long,
) {
    init {
        require(profileId.isNotBlank()) { "profileId cannot be blank" }
        require(attemptId >= 0) { "attemptId must be non-negative: $attemptId" }
    }

    val key: String get() = """["$profileId",$attemptId]"""
}

class AuthAttemptStaleException(
    val attempt: AuthAttemptRef,
    override val message: String = "Authentication attempt ${attempt.key} is stale and was cancelled by lifecycle change"
) : IllegalStateException(message)
