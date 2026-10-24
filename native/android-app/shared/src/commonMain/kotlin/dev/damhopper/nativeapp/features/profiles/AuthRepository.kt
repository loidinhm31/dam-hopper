package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson

sealed class LoginResult {
    data class Challenge(val challenge: LoginChallenge) : LoginResult()
    data class Session(val session: AuthSession) : LoginResult()
}

/**
 * Executes authentication operations against a single server endpoint.
 * Enforces frozen protocol version 2 validation across all operations.
 */
class AuthRepository(
    val apiClient: ApiClient,
) {
    suspend fun register(username: String, password: String): Result<Unit> = runCatching {
        require(username.isNotBlank()) { "Username cannot be blank" }
        require(password.isNotBlank()) { "Password cannot be blank" }
        val body = ProtocolJson.encodeToString(
            RegisterRequestBody.serializer(),
            RegisterRequestBody(username = username, password = password)
        )
        val responseText = apiClient.postJson("/api/auth/register", body)
        val resp = ProtocolJson.decodeFromString(RawRegisterResponse.serializer(), responseText)
        if (!resp.ok) {
            throw ApiRequestError("Registration failed", status = 400, code = "REGISTRATION_FAILED")
        }
    }

    suspend fun login(username: String? = null, password: String? = null): LoginResult {
        val reqBody = if (username != null || password != null) {
            ProtocolJson.encodeToString(
                LoginRequestBody.serializer(),
                LoginRequestBody(username = username ?: "", password = password ?: "")
            )
        } else {
            "{}"
        }
        val responseText = apiClient.postJson("/api/auth/login", reqBody)
        return AuthResponseParser.parseLoginResponse(responseText)
    }

    suspend fun fetchMfaSetup(challengeToken: String): MfaSetupData {
        require(challengeToken.isNotBlank()) { "challengeToken cannot be blank" }
        val body = ProtocolJson.encodeToString(
            MfaSetupRequestBody.serializer(),
            MfaSetupRequestBody(challengeToken)
        )
        val responseText = apiClient.postJson("/api/auth/mfa/setup", body)
        return AuthResponseParser.parseMfaSetup(responseText)
    }

    suspend fun confirmMfaEnrollment(challengeToken: String, code: String): AuthSession {
        require(challengeToken.isNotBlank()) { "challengeToken cannot be blank" }
        require(code.isNotBlank()) { "code cannot be blank" }
        val body = ProtocolJson.encodeToString(
            MfaCodeRequestBody.serializer(),
            MfaCodeRequestBody(challengeToken, code.trim())
        )
        val responseText = apiClient.postJson("/api/auth/mfa/confirm", body)
        return AuthResponseParser.parseSessionResponse(responseText)
    }

    suspend fun verifyMfa(challengeToken: String, code: String): AuthSession {
        require(challengeToken.isNotBlank()) { "challengeToken cannot be blank" }
        require(code.isNotBlank()) { "code cannot be blank" }
        val body = ProtocolJson.encodeToString(
            MfaCodeRequestBody.serializer(),
            MfaCodeRequestBody(challengeToken, code.trim())
        )
        val responseText = apiClient.postJson("/api/auth/mfa/verify", body)
        return AuthResponseParser.parseSessionResponse(responseText)
    }

    suspend fun requestMfaStepUp(): LoginChallenge {
        val responseText = apiClient.postJson("/api/auth/mfa/challenge", "{}")
        return AuthResponseParser.parseMfaChallenge(responseText)
    }

    suspend fun checkAuthStatus(): AuthStatus {
        return try {
            val responseText = apiClient.get("/api/auth/status")
            val token = apiClient.authTokenProvider()
            AuthStatusParser.parseSuccess(responseText, token)
        } catch (e: ApiRequestError) {
            AuthStatusParser.parseError(e)
        }
    }

    suspend fun logout() {
        try {
            apiClient.postJson("/api/auth/logout", "{}")
        } catch (_: Exception) {
            // Idempotent and best-effort
        }
    }
}
