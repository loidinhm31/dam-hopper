package dev.damhopper.nativeapp.features.profiles

import kotlinx.serialization.Serializable

@Serializable
internal data class LoginRequestBody(
    val username: String? = null,
    val password: String? = null,
)

@Serializable
internal data class RegisterRequestBody(
    val username: String,
    val password: String,
)

@Serializable
internal data class MfaSetupRequestBody(
    val challengeToken: String,
)

@Serializable
internal data class MfaCodeRequestBody(
    val challengeToken: String,
    val code: String,
)

@Serializable
internal data class RawLoginChallengeResponse(
    val state: String,
    val challengeToken: String,
    val challengeExpiresAt: String,
    val authProtocol: Int,
)

@Serializable
internal data class RawDevLoginResponse(
    val ok: Boolean? = null,
    val token: String? = null,
    val dev_mode: Boolean? = null,
    val devMode: Boolean? = null,
    val role: String? = null,
    val workbenchProtocol: Int? = null,
    val authProtocol: Int? = null,
)

@Serializable
internal data class RawMfaSetupResponse(
    val secret: String,
    val otpauthUri: String,
    val issuer: String,
    val accountName: String,
    val algorithm: String = "SHA1",
    val digits: Int = 6,
    val period: Long = 30L,
)

@Serializable
internal data class RawAuthSessionResponse(
    val state: String,
    val token: String,
    val expiresAt: String,
    val mfaDueAt: String,
    val user: String,
    val role: String = "user",
    val authProtocol: Int,
)

@Serializable
internal data class RawMfaChallengeResponse(
    val challengeToken: String,
    val challengeExpiresAt: String,
    val authProtocol: Int,
)

@Serializable
internal data class RawAuthStatusResponse(
    val authenticated: Boolean,
    val user: String? = null,
    val role: String? = null,
    val workbenchProtocol: Int? = null,
    val authProtocol: Int? = null,
    val issuedAt: String? = null,
    val expiresAt: String? = null,
    val mfaDueAt: String? = null,
    val dev_mode: Boolean? = null,
    val devMode: Boolean? = null,
    val code: String? = null,
    val error: String? = null,
)

@Serializable
internal data class RawRegisterResponse(
    val ok: Boolean = false,
)
