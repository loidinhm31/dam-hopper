package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class ActionCapabilitiesResponse(
    val available: Boolean,
    val reason: String,
    val actions: List<String> = emptyList()
)

@Serializable
data class ActionIntentRequest(
    val action: String,
    val sampleId: String,
    val alertId: String? = null
)

@Serializable
data class IntentChallenge(
    val intentId: String,
    val challengeNonce: String,
    val expiresAt: Long
)

@Serializable
data class ApproveIntentRequest(
    val challengeNonce: String,
    val username: String,
    val password: String
) {
    override fun toString(): String =
        "ApproveIntentRequest(challengeNonce='$challengeNonce', username='$username', password=[REDACTED])"
}

@Serializable
data class ExecutionRequest(
    val intentId: String,
    val approvalToken: String
) {
    override fun toString(): String =
        "ExecutionRequest(intentId='$intentId', approvalToken=[REDACTED])"
}

@Serializable
data class ActionExecution(
    val executionId: String,
    val state: String,
    val code: String? = null
)

@Serializable
data class ActionAuditPage(
    val records: List<JsonObject> = emptyList(),
    val nextCursor: String? = null
)
