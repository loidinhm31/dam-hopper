package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson

/**
 * Parses and evaluates responses from GET /api/auth/status.
 * Enforces strict frozen protocol version 2 validation and preserves server error details.
 */
internal object AuthStatusParser {

    fun parseSuccess(responseText: String, token: String?): AuthStatus {
        val raw = ProtocolJson.decodeFromString(RawAuthStatusResponse.serializer(), responseText)
        val authProto = raw.authProtocol ?: FROZEN_AUTH_PROTOCOL_VERSION
        val benchProto = raw.workbenchProtocol ?: FROZEN_WORKBENCH_PROTOCOL_VERSION

        if (authProto != FROZEN_AUTH_PROTOCOL_VERSION || benchProto != FROZEN_WORKBENCH_PROTOCOL_VERSION) {
            return AuthStatus.Incompatible(
                "Server reports authProtocol=$authProto, workbenchProtocol=$benchProto; expected $FROZEN_AUTH_PROTOCOL_VERSION / $FROZEN_WORKBENCH_PROTOCOL_VERSION"
            )
        }

        if (raw.authenticated) {
            val isDev = raw.dev_mode == true || raw.devMode == true
            val effectiveToken = if (token.isNullOrBlank() && isDev) "dev-session" else (token ?: "")
            if (effectiveToken.isBlank()) {
                return AuthStatus.LoginRequired(
                    code = raw.code ?: AuthErrorCodes.AUTH_REQUIRED,
                    error = raw.error ?: "Authentication required",
                    workbenchProtocol = benchProto,
                    authProtocol = authProto,
                )
            }
            val session = AuthSession(
                token = effectiveToken,
                user = raw.user?.ifBlank { null } ?: if (isDev) "dev-user" else "user",
                role = raw.role ?: "user",
                expiresAt = raw.expiresAt ?: "",
                mfaDueAt = raw.mfaDueAt,
                devMode = isDev,
                authProtocol = authProto,
            )
            return AuthStatus.Authenticated(
                session = session,
                issuedAt = raw.issuedAt,
                workbenchProtocol = benchProto,
            )
        }

        return AuthStatus.LoginRequired(
            code = raw.code ?: AuthErrorCodes.AUTH_REQUIRED,
            error = raw.error ?: "Authentication required",
            workbenchProtocol = benchProto,
            authProtocol = authProto,
        )
    }

    fun parseError(e: ApiRequestError): AuthStatus {
        if (e.status == 401) {
            val raw = parseStatusErrorBody(e.rawBody)
            val code = raw?.code ?: e.code ?: AuthErrorCodes.AUTH_REQUIRED
            val error = raw?.error ?: (e.message ?: "Authentication required")
            val authProto = raw?.authProtocol ?: FROZEN_AUTH_PROTOCOL_VERSION
            val benchProto = raw?.workbenchProtocol ?: FROZEN_WORKBENCH_PROTOCOL_VERSION

            if (authProto != FROZEN_AUTH_PROTOCOL_VERSION || benchProto != FROZEN_WORKBENCH_PROTOCOL_VERSION) {
                return AuthStatus.Incompatible(
                    "Server reports authProtocol=$authProto, workbenchProtocol=$benchProto; expected $FROZEN_AUTH_PROTOCOL_VERSION / $FROZEN_WORKBENCH_PROTOCOL_VERSION"
                )
            }

            if (code == AuthErrorCodes.MFA_REQUIRED) {
                return AuthStatus.MfaRequired(
                    user = raw?.user,
                    expiresAt = raw?.expiresAt,
                    mfaDueAt = raw?.mfaDueAt,
                    workbenchProtocol = benchProto,
                    authProtocol = authProto,
                )
            }

            return AuthStatus.LoginRequired(
                code = code,
                error = error,
                workbenchProtocol = benchProto,
                authProtocol = authProto,
            )
        }

        if (e.status == 503) {
            return AuthStatus.Unavailable(
                code = e.code ?: AuthErrorCodes.AUTH_UNAVAILABLE,
                error = e.message ?: "Service unavailable",
            )
        }

        return AuthStatus.Unavailable(
            code = e.code ?: "HTTP_${e.status}",
            error = e.message ?: "HTTP ${e.status} error",
        )
    }

    private fun parseStatusErrorBody(body: String?): RawAuthStatusResponse? {
        if (body.isNullOrBlank()) return null
        return try {
            ProtocolJson.decodeFromString(RawAuthStatusResponse.serializer(), body)
        } catch (_: Exception) {
            null
        }
    }
}
