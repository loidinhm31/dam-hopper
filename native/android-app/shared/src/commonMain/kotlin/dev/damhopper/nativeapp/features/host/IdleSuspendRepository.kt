package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson

class IdleSuspendHandoffConflictException(message: String) : Exception(message)

class IdleSuspendActiveFleetConflictException(
    val conflict: IdleSuspendConflictResponse
) : Exception(conflict.error)

class IdleSuspendFleetChangedConflictException(
    val conflict: IdleSuspendConflictResponse
) : Exception(conflict.error)

class IdleSuspendRepository(
    val apiClient: ApiClient
) {
    /**
     * GET /api/system/idle-suspend/v1/status
     */
    suspend fun getStatus(): Result<IdleSuspendStatusV1> = runCatching {
        val responseText = apiClient.get("/api/system/idle-suspend/v1/status")
        decodeIdleSuspendStatusV1(responseText)
    }

    /**
     * PATCH /api/system/idle-suspend/v1/timing
     */
    suspend fun updateTiming(
        quietPeriodSeconds: Int,
        wakeAfterSeconds: Int
    ): Result<IdleSuspendTimingPatchResponse> = runCatching {
        require(quietPeriodSeconds in 60..86400) {
            "quietPeriodSeconds must be between 60 and 86400"
        }
        require(wakeAfterSeconds in 60..86400) {
            "wakeAfterSeconds must be between 60 and 86400"
        }

        val request = IdleSuspendTimingPatchRequest(
            quietPeriodSeconds = quietPeriodSeconds,
            wakeAfterSeconds = wakeAfterSeconds
        )
        val body = ProtocolJson.encodeToString(IdleSuspendTimingPatchRequest.serializer(), request)

        try {
            val responseText = apiClient.patchJson("/api/system/idle-suspend/v1/timing", body)
            ProtocolJson.decodeFromString(IdleSuspendTimingPatchResponse.serializer(), responseText)
        } catch (e: ApiRequestError) {
            if (e.status == 409) {
                // Hand-off is actively in progress; client must not auto-retry
                throw IdleSuspendHandoffConflictException(
                    e.message ?: "Timing update rejected: handoff actively in progress"
                )
            }
            throw e
        }
    }

    /**
     * POST /api/system/idle-suspend/v1/force-suspend
     *
     * Non-retrying admission endpoint.
     */
    suspend fun forceSuspend(
        wakeAfterSeconds: Int,
        force: Boolean
    ): Result<ForceSuspendAcceptedResponse> = runCatching {
        require(wakeAfterSeconds == 0 || wakeAfterSeconds in 60..86400) {
            "wakeAfterSeconds must be 0 (indefinite) or between 60 and 86400"
        }

        val request = ForceSuspendRequest(
            wakeAfterSeconds = wakeAfterSeconds,
            force = force
        )
        val body = ProtocolJson.encodeToString(ForceSuspendRequest.serializer(), request)

        try {
            val responseText = apiClient.postJson("/api/system/idle-suspend/v1/force-suspend", body)
            ProtocolJson.decodeFromString(ForceSuspendAcceptedResponse.serializer(), responseText)
        } catch (e: ApiRequestError) {
            if (e.status == 409) {
                val conflict = try {
                    ProtocolJson.decodeFromString(
                        IdleSuspendConflictResponse.serializer(),
                        e.rawBody ?: "{}"
                    )
                } catch (_: Throwable) {
                    IdleSuspendConflictResponse(code = "idleSuspendConflict", error = e.message ?: "Conflict")
                }

                when (conflict.code) {
                    "idleSuspendActiveFleetConfirmationRequired" ->
                        throw IdleSuspendActiveFleetConflictException(conflict)
                    "idleSuspendFleetChanged" ->
                        throw IdleSuspendFleetChangedConflictException(conflict)
                    "idleSuspendHandoffInProgress" ->
                        throw IdleSuspendHandoffConflictException(conflict.error)
                    else -> throw e
                }
            }
            throw e
        }
    }

    /**
     * POST /api/system/idle-suspend/v1/consent/decision
     */
    suspend fun submitConsentDecision(
        request: ConsentDecisionRequest
    ): Result<ConsentDecisionResponse> = runCatching {
        val body = ProtocolJson.encodeToString(ConsentDecisionRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/system/idle-suspend/v1/consent/decision", body)
        ProtocolJson.decodeFromString(ConsentDecisionResponse.serializer(), responseText)
    }
}
