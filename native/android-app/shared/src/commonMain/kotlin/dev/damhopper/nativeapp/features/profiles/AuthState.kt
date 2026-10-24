package dev.damhopper.nativeapp.features.profiles

import kotlinx.serialization.Serializable

/**
 * Protocol version constants frozen at baseline server 0.13.2 / protocol 2.
 */
const val FROZEN_AUTH_PROTOCOL_VERSION: Int = 2
const val FROZEN_WORKBENCH_PROTOCOL_VERSION: Int = 2

/**
 * Machine-readable authentication error codes returned by the server or client transport.
 */
object AuthErrorCodes {
    const val AUTH_REQUIRED = "AUTH_REQUIRED"
    const val MFA_REQUIRED = "MFA_REQUIRED"
    const val SESSION_EXPIRED = "SESSION_EXPIRED"
    const val SESSION_REVOKED = "SESSION_REVOKED"
    const val ACCOUNT_DISABLED = "ACCOUNT_DISABLED"
    const val ACCOUNT_LOCKED = "ACCOUNT_LOCKED"
    const val INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    const val INVALID_CHALLENGE = "INVALID_CHALLENGE"
    const val INVALID_CODE = "INVALID_CODE"
    const val CODE_REPLAYED = "CODE_REPLAYED"
    const val RATE_LIMITED = "RATE_LIMITED"
    const val AUTH_UNAVAILABLE = "AUTH_UNAVAILABLE"
    const val INCOMPATIBLE_PROTOCOL = "INCOMPATIBLE_PROTOCOL"
    const val NETWORK_ERROR = "NETWORK_ERROR"
    const val VAULT_ERROR = "VAULT_ERROR"
    const val ATTEMPT_STALE = "ATTEMPT_STALE"
}

enum class ChallengeType {
    ENROLLMENT_REQUIRED,
    MFA_REQUIRED,
}

/**
 * Active authenticated session representation.
 * Token is zeroized/redacted from toString() output.
 */
@Serializable
data class AuthSession(
    val token: String,
    val user: String,
    val role: String = "user",
    val expiresAt: String,
    val mfaDueAt: String? = null,
    val devMode: Boolean = false,
    val authProtocol: Int = FROZEN_AUTH_PROTOCOL_VERSION,
) {
    init {
        require(token.isNotBlank()) { "Token cannot be blank" }
        require(user.isNotBlank()) { "User cannot be blank" }
    }

    override fun toString(): String =
        "AuthSession(user='$user', role='$role', expiresAt='$expiresAt', mfaDueAt='$mfaDueAt', devMode=$devMode, token=[REDACTED])"
}

/**
 * Transient login challenge returned by password login.
 * Challenge token is redacted from toString() output.
 */
@Serializable
data class LoginChallenge(
    val type: ChallengeType,
    val challengeToken: String,
    val challengeExpiresAt: String,
    val authProtocol: Int = FROZEN_AUTH_PROTOCOL_VERSION,
) {
    override fun toString(): String =
        "LoginChallenge(type=$type, expiresAt='$challengeExpiresAt', token=[REDACTED])"
}

/**
 * Transient TOTP setup parameters returned by /api/auth/mfa/setup.
 * Secrets and provisioning URIs are redacted from toString().
 */
@Serializable
data class MfaSetupData(
    val secret: String,
    val otpauthUri: String,
    val issuer: String,
    val accountName: String,
    val algorithm: String = "SHA1",
    val digits: Int = 6,
    val period: Long = 30L,
) {
    override fun toString(): String =
        "MfaSetupData(issuer='$issuer', account='$accountName', algorithm='$algorithm', digits=$digits, period=$period, secret=[REDACTED])"
}

/**
 * Comprehensive authentication status for a server profile.
 */
sealed class AuthStatus {
    data class Authenticated(
        val session: AuthSession,
        val issuedAt: String? = null,
        val workbenchProtocol: Int = FROZEN_WORKBENCH_PROTOCOL_VERSION,
    ) : AuthStatus()

    data class MfaRequired(
        val user: String?,
        val expiresAt: String?,
        val mfaDueAt: String?,
        val workbenchProtocol: Int = FROZEN_WORKBENCH_PROTOCOL_VERSION,
        val authProtocol: Int = FROZEN_AUTH_PROTOCOL_VERSION,
    ) : AuthStatus()

    data class LoginRequired(
        val code: String,
        val error: String,
        val workbenchProtocol: Int = FROZEN_WORKBENCH_PROTOCOL_VERSION,
        val authProtocol: Int = FROZEN_AUTH_PROTOCOL_VERSION,
    ) : AuthStatus()

    data class Unavailable(
        val code: String,
        val error: String,
    ) : AuthStatus()

    data class Incompatible(
        val reason: String,
    ) : AuthStatus()
}
