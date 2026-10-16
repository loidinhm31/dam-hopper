package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson

/**
 * Parses raw JSON responses from authentication endpoints into typed domain models.
 * Enforces frozen protocol version 2 validation.
 */
internal object AuthResponseParser {

    fun parseLoginResponse(responseText: String): LoginResult {
        // 1. Try parsing MFA Challenge
        try {
            val challenge = ProtocolJson.decodeFromString(
                RawLoginChallengeResponse.serializer(),
                responseText
            )
            if (challenge.challengeToken.isNotBlank() &&
                (challenge.state == "enrollmentRequired" || challenge.state == "mfaRequired")
            ) {
                if (challenge.authProtocol != FROZEN_AUTH_PROTOCOL_VERSION) {
                    throw ApiRequestError(
                        "Incompatible authProtocol ${challenge.authProtocol}, expected $FROZEN_AUTH_PROTOCOL_VERSION",
                        status = 400,
                        code = AuthErrorCodes.INCOMPATIBLE_PROTOCOL
                    )
                }
                val type = if (challenge.state == "enrollmentRequired") {
                    ChallengeType.ENROLLMENT_REQUIRED
                } else {
                    ChallengeType.MFA_REQUIRED
                }
                return LoginResult.Challenge(
                    LoginChallenge(
                        type = type,
                        challengeToken = challenge.challengeToken,
                        challengeExpiresAt = challenge.challengeExpiresAt,
                        authProtocol = challenge.authProtocol,
                    )
                )
            }
        } catch (e: ApiRequestError) {
            throw e
        } catch (_: Exception) {
            // Not a challenge response, continue to dev-session check
        }

        // 2. Try parsing Dev-mode session
        val devSession = ProtocolJson.decodeFromString(
            RawDevLoginResponse.serializer(),
            responseText
        )
        if (!devSession.token.isNullOrBlank() &&
            (devSession.dev_mode == true || devSession.devMode == true || devSession.ok == true)
        ) {
            val authProto = devSession.authProtocol ?: FROZEN_AUTH_PROTOCOL_VERSION
            val benchProto = devSession.workbenchProtocol ?: FROZEN_WORKBENCH_PROTOCOL_VERSION
            if (authProto != FROZEN_AUTH_PROTOCOL_VERSION || benchProto != FROZEN_WORKBENCH_PROTOCOL_VERSION) {
                throw ApiRequestError(
                    "Incompatible dev protocol versions: auth=$authProto, workbench=$benchProto",
                    status = 400,
                    code = AuthErrorCodes.INCOMPATIBLE_PROTOCOL
                )
            }
            return LoginResult.Session(
                AuthSession(
                    token = devSession.token,
                    user = "dev-user",
                    role = devSession.role ?: "user",
                    expiresAt = "",
                    devMode = true,
                    authProtocol = authProto,
                )
            )
        }

        throw ApiRequestError(
            "Unrecognized login response format",
            status = 400,
            code = AuthErrorCodes.INCOMPATIBLE_PROTOCOL
        )
    }

    fun parseMfaSetup(responseText: String): MfaSetupData {
        val raw = ProtocolJson.decodeFromString(RawMfaSetupResponse.serializer(), responseText)
        return MfaSetupData(
            secret = raw.secret,
            otpauthUri = raw.otpauthUri,
            issuer = raw.issuer,
            accountName = raw.accountName,
            algorithm = raw.algorithm,
            digits = raw.digits,
            period = raw.period,
        )
    }

    fun parseSessionResponse(responseText: String): AuthSession {
        val raw = ProtocolJson.decodeFromString(RawAuthSessionResponse.serializer(), responseText)
        if (raw.authProtocol != FROZEN_AUTH_PROTOCOL_VERSION) {
            throw ApiRequestError(
                "Incompatible authProtocol ${raw.authProtocol}, expected $FROZEN_AUTH_PROTOCOL_VERSION",
                status = 400,
                code = AuthErrorCodes.INCOMPATIBLE_PROTOCOL
            )
        }
        return AuthSession(
            token = raw.token,
            user = raw.user,
            role = raw.role,
            expiresAt = raw.expiresAt,
            mfaDueAt = raw.mfaDueAt,
            authProtocol = raw.authProtocol,
        )
    }

    fun parseMfaChallenge(responseText: String): LoginChallenge {
        val raw = ProtocolJson.decodeFromString(RawMfaChallengeResponse.serializer(), responseText)
        if (raw.authProtocol != FROZEN_AUTH_PROTOCOL_VERSION) {
            throw ApiRequestError(
                "Incompatible authProtocol ${raw.authProtocol}, expected $FROZEN_AUTH_PROTOCOL_VERSION",
                status = 400,
                code = AuthErrorCodes.INCOMPATIBLE_PROTOCOL
            )
        }
        return LoginChallenge(
            type = ChallengeType.MFA_REQUIRED,
            challengeToken = raw.challengeToken,
            challengeExpiresAt = raw.challengeExpiresAt,
            authProtocol = raw.authProtocol,
        )
    }
}
