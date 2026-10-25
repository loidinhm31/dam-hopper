package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.classifyFailure

class IdleSuspendHandoffConflictException(message: String) : Exception(message)

class IdleSuspendActiveFleetConflictException(
    val conflict: IdleSuspendConflictResponse
) : Exception(conflict.error)

class IdleSuspendFleetChangedConflictException(
    val conflict: IdleSuspendConflictResponse
) : Exception(conflict.error)

/**
 * Why the timing pair must NOT be submitted for [status], or null when it is editable. Capability,
 * unknown/stale status, disabled, locked and handoff states all block submission; the reason is shown to the user.
 */
fun idleTimingBlockReason(status: IdleSuspendStatusV1?): String? {
    if (status == null) return "Idle-suspend status is unknown; refresh before editing timing."
    if (status.version != 1) return "Unsupported idle-suspend status version ${status.version}."
    if (status.state == IdleSuspendState.DISABLED || !status.enabled) {
        return "Idle suspend is disabled on this server (it is enabled at server startup)."
    }
    if (status.capabilityCode == "unavailable") return "Host sleep capability is unavailable on this server."
    if (status.state == IdleSuspendState.HANDED_OFF || status.fleetSnapshot.handoffActive) {
        return "A host sleep handoff is in progress; timing cannot change until it settles."
    }
    if (!status.timingMutable) {
        return status.timingMutableReason?.let { "Timing is locked by the server ($it)." } ?: "Timing is locked by the server."
    }
    if (status.minQuietPeriodSeconds > status.maxQuietPeriodSeconds ||
        status.minWakeAfterSeconds > status.maxWakeAfterSeconds
    ) {
        return "The server reported inconsistent timing bounds."
    }
    return null
}

/**
 * Validates the atomic quiet/wake pair against the LATEST current-owner status bounds for both fields
 * (never hard-coded limits). Returns an error message or null when the pair may be submitted.
 */
fun validateIdleTiming(status: IdleSuspendStatusV1?, quietPeriodSeconds: Int, wakeAfterSeconds: Int): String? {
    idleTimingBlockReason(status)?.let { return it }
    val s = status!!
    if (quietPeriodSeconds !in s.minQuietPeriodSeconds..s.maxQuietPeriodSeconds) {
        return "Quiet period must be between ${s.minQuietPeriodSeconds} and ${s.maxQuietPeriodSeconds} seconds."
    }
    if (wakeAfterSeconds !in s.minWakeAfterSeconds..s.maxWakeAfterSeconds) {
        return "Wake timer must be between ${s.minWakeAfterSeconds} and ${s.maxWakeAfterSeconds} seconds."
    }
    return null
}

/** Force-suspend wake timer: 0 (indefinite) or within the latest status wake bounds. */
fun validateForceSuspendWake(status: IdleSuspendStatusV1?, wakeAfterSeconds: Int): String? {
    if (status == null) return "Idle-suspend status is unknown; refresh before requesting suspend."
    if (wakeAfterSeconds == 0) return null
    if (wakeAfterSeconds !in status.minWakeAfterSeconds..status.maxWakeAfterSeconds) {
        return "Wake timer must be 0 (indefinite) or between ${status.minWakeAfterSeconds} and ${status.maxWakeAfterSeconds} seconds."
    }
    return null
}

/** Maps a failed idle request to an honest outcome; 409 conflict answers are definitive rejections. */
fun <T> idleOutcome(result: Result<T>, guard: RequestAdmissionGuard): SettingsOutcome<T> = result.fold(
    onSuccess = { SettingsOutcome.Confirmed(it) },
    onFailure = { error ->
        when (error) {
            is IdleSuspendHandoffConflictException,
            is IdleSuspendActiveFleetConflictException,
            is IdleSuspendFleetChangedConflictException ->
                SettingsOutcome.Rejected(error.message ?: "The server rejected the idle-suspend request.")
            else -> classifyFailure(guard, error)
        }
    },
)

/** Like `runCatching` but a CancellationException always propagates (never becomes a Result). */
internal inline fun <T> resultRethrowingCancellation(block: () -> T): Result<T> = try {
    Result.success(block())
} catch (ce: kotlinx.coroutines.CancellationException) {
    throw ce
} catch (t: Throwable) {
    Result.failure(t)
}

class IdleSuspendRepository(
    val apiClient: ApiClient
) {
    /**
     * GET /api/system/idle-suspend/v1/status
     */
    suspend fun getStatus(): Result<IdleSuspendStatusV1> = resultRethrowingCancellation {
        val responseText = apiClient.get("/api/system/idle-suspend/v1/status")
        decodeIdleSuspendStatusV1(responseText)
    }

    /**
     * PATCH /api/system/idle-suspend/v1/timing
     *
     * Fetches the current-owner status FIRST (no lock is held across the fetch), validates the pair against
     * the returned min/max bounds and capability/lock state, then submits the pair through the same [guard].
     * Nothing is retried; a conflict (409 handoff) is never auto-retried.
     */
    suspend fun updateTiming(
        quietPeriodSeconds: Int,
        wakeAfterSeconds: Int,
        guard: RequestAdmissionGuard,
    ): Result<IdleSuspendTimingPatchResponse> = resultRethrowingCancellation {
        val status = getStatus().getOrThrow()
        validateIdleTiming(status, quietPeriodSeconds, wakeAfterSeconds)?.let { throw IllegalArgumentException(it) }

        val request = IdleSuspendTimingPatchRequest(
            quietPeriodSeconds = quietPeriodSeconds,
            wakeAfterSeconds = wakeAfterSeconds
        )
        val body = ProtocolJson.encodeToString(IdleSuspendTimingPatchRequest.serializer(), request)

        try {
            val responseText = apiClient.patchJson("/api/system/idle-suspend/v1/timing", body, guard)
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
     * Non-retrying admission endpoint; the wake timer is validated against the latest status bounds.
     */
    suspend fun forceSuspend(
        wakeAfterSeconds: Int,
        force: Boolean,
        guard: RequestAdmissionGuard,
    ): Result<ForceSuspendAcceptedResponse> = resultRethrowingCancellation {
        val status = getStatus().getOrThrow()
        validateForceSuspendWake(status, wakeAfterSeconds)?.let { throw IllegalArgumentException(it) }

        val request = ForceSuspendRequest(
            wakeAfterSeconds = wakeAfterSeconds,
            force = force
        )
        val body = ProtocolJson.encodeToString(ForceSuspendRequest.serializer(), request)

        try {
            val responseText = apiClient.postJson("/api/system/idle-suspend/v1/force-suspend", body, guard)
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
     * POST /api/system/idle-suspend/v1/consent/decision ([guard] required; runtime consent passes the
     * explicit runtime-owner guard, never a Settings-target fallback).
     */
    suspend fun submitConsentDecision(
        request: ConsentDecisionRequest,
        guard: RequestAdmissionGuard,
    ): Result<ConsentDecisionResponse> = resultRethrowingCancellation {
        val body = ProtocolJson.encodeToString(ConsentDecisionRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/system/idle-suspend/v1/consent/decision", body, guard)
        ProtocolJson.decodeFromString(ConsentDecisionResponse.serializer(), responseText)
    }
}
