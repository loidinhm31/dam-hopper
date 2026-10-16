package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson

/**
 * Result wrapper for telemetry availability.
 */
sealed class UsageResult<out T> {
    data class Available<T>(val data: T) : UsageResult<T>()
    data class Unavailable(val message: String, val statusCode: Int? = null) : UsageResult<Nothing>()
}

/**
 * Repository for protected aggregate-only Codex usage analytics and telemetry management.
 * Enforces: zero raw prompts/responses/commands, scoped cursors, and explicit deletion confirmation.
 */
class UsageRepository(
    val apiClient: ApiClient,
) {
    suspend fun getSummary(
        from: Long? = null,
        to: Long? = null,
        window: String? = null,
        bucket: String? = null,
        model: String? = null,
    ): Result<UsageResult<UsageSummaryResponse>> = runCatching {
        try {
            val params = mutableMapOf<String, String>()
            if (from != null) params["from"] = from.toString()
            if (to != null) params["to"] = to.toString()
            if (!window.isNullOrBlank()) params["window"] = window
            if (!bucket.isNullOrBlank()) params["bucket"] = bucket
            if (!model.isNullOrBlank()) params["model"] = model

            val response = apiClient.get("/api/usage/summary", params)
            val summary = ProtocolJson.decodeFromString(UsageSummaryResponse.serializer(), response)
            UsageResult.Available(summary)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                UsageResult.Unavailable(e.message ?: "Usage telemetry unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    suspend fun getHealth(): Result<UsageResult<UsageHealth>> = runCatching {
        try {
            val response = apiClient.get("/api/usage/health")
            val health = ProtocolJson.decodeFromString(UsageHealth.serializer(), response)
            UsageResult.Available(health)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                UsageResult.Unavailable(e.message ?: "Usage health unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    suspend fun getSettings(): Result<UsageResult<UsageSettingsResponse>> = runCatching {
        try {
            val response = apiClient.get("/api/usage/settings")
            val settings = ProtocolJson.decodeFromString(UsageSettingsResponse.serializer(), response)
            UsageResult.Available(settings)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                UsageResult.Unavailable(e.message ?: "Usage settings unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    suspend fun patchSettings(patch: SettingsPatchRequest): Result<UsageSettingsResponse> = runCatching {
        val body = ProtocolJson.encodeToString(SettingsPatchRequest.serializer(), patch)
        val response = apiClient.patchJson("/api/usage/settings", body)
        ProtocolJson.decodeFromString(UsageSettingsResponse.serializer(), response)
    }

    suspend fun getSetup(): Result<UsageResult<UsageSetupStatusResponse>> = runCatching {
        try {
            val response = apiClient.get("/api/usage/setup")
            val setup = ProtocolJson.decodeFromString(UsageSetupStatusResponse.serializer(), response)
            UsageResult.Available(setup)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                UsageResult.Unavailable(e.message ?: "Usage setup unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    suspend fun patchSetup(patch: SetupPatchRequest): Result<UsageSetupStatusResponse> = runCatching {
        val body = ProtocolJson.encodeToString(SetupPatchRequest.serializer(), patch)
        val response = apiClient.patchJson("/api/usage/setup", body)
        ProtocolJson.decodeFromString(UsageSetupStatusResponse.serializer(), response)
    }

    suspend fun listSessions(
        from: Long? = null,
        to: Long? = null,
        model: String? = null,
        limit: Int? = null,
        cursor: String? = null,
    ): Result<UsageResult<SessionListResponse>> = runCatching {
        try {
            val params = mutableMapOf<String, String>()
            if (from != null) params["from"] = from.toString()
            if (to != null) params["to"] = to.toString()
            if (!model.isNullOrBlank()) params["model"] = model
            if (limit != null) params["limit"] = limit.toString()
            if (!cursor.isNullOrBlank()) params["cursor"] = cursor

            val response = apiClient.get("/api/usage/sessions", params)
            val list = ProtocolJson.decodeFromString(SessionListResponse.serializer(), response)
            UsageResult.Available(list)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                UsageResult.Unavailable(e.message ?: "Usage sessions unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    suspend fun getSessionDetail(id: String): Result<SessionDetailResponse?> = runCatching {
        try {
            val encId = ApiClient.encodePathSegment(id)
            val response = apiClient.get("/api/usage/sessions/$encId")
            ProtocolJson.decodeFromString(SessionDetailResponse.serializer(), response)
        } catch (e: ApiRequestError) {
            if (e.status == 404) {
                null
            } else {
                throw e
            }
        }
    }

    suspend fun deleteUsage(request: DeleteUsageRequest): Result<Unit> = runCatching {
        val body = ProtocolJson.encodeToString(DeleteUsageRequest.serializer(), request)
        apiClient.deleteJson("/api/usage", body)
        Unit
    }
}
