package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

class HostControlRepository(
    val apiClient: ApiClient
) {
    suspend fun getCapabilities(): Result<ActionCapabilitiesResponse> = runCatching {
        val responseText = apiClient.get("/api/system/actions/v1/capabilities")
        ProtocolJson.decodeFromString(ActionCapabilitiesResponse.serializer(), responseText)
    }

    suspend fun createIntent(
        action: String,
        sampleId: String,
        alertId: String? = null
    ): Result<IntentChallenge> = runCatching {
        val request = ActionIntentRequest(action = action, sampleId = sampleId, alertId = alertId)
        val body = ProtocolJson.encodeToString(ActionIntentRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/system/actions/v1/intents", body)
        ProtocolJson.decodeFromString(IntentChallenge.serializer(), responseText)
    }

    suspend fun approveIntent(
        intentId: String,
        challengeNonce: String,
        username: String,
        password: String
    ): Result<String> = runCatching {
        val request = ApproveIntentRequest(
            challengeNonce = challengeNonce,
            username = username,
            password = password
        )
        val body = ProtocolJson.encodeToString(ApproveIntentRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/system/actions/v1/intents/$intentId/approve", body)
        val json = ProtocolJson.decodeFromString(JsonObject.serializer(), responseText)
        json["approvalToken"]?.jsonPrimitive?.content
            ?: throw IllegalStateException("Missing approvalToken in response")
    }

    suspend fun executeAction(
        intentId: String,
        approvalToken: String
    ): Result<ActionExecution> = runCatching {
        val request = ExecutionRequest(intentId = intentId, approvalToken = approvalToken)
        val body = ProtocolJson.encodeToString(ExecutionRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/system/actions/v1/executions", body)
        ProtocolJson.decodeFromString(ActionExecution.serializer(), responseText)
    }

    suspend fun getAudit(cursor: String? = null): Result<ActionAuditPage> = runCatching {
        val queryParams = if (cursor != null) mapOf("cursor" to cursor) else emptyMap()
        val responseText = apiClient.get("/api/system/actions/v1/audit", queryParams)
        ProtocolJson.decodeFromString(ActionAuditPage.serializer(), responseText)
    }
}
