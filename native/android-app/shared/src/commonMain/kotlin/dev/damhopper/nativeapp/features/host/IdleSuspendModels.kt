package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

@Serializable
enum class IdleSuspendState {
    @SerialName("disabled")
    DISABLED,

    @SerialName("watching")
    WATCHING,

    @SerialName("armed")
    ARMED,

    @SerialName("finalCheck")
    FINAL_CHECK,

    @SerialName("handedOff")
    HANDED_OFF,

    @SerialName("suppressed")
    SUPPRESSED,

    @SerialName("failed")
    FAILED,

    @SerialName("resumed")
    RESUMED
}

@Serializable
enum class AutomaticPolicy {
    @SerialName("empty-fleet")
    EMPTY_FLEET,

    @SerialName("agent-activity")
    AGENT_ACTIVITY,

    @SerialName("agent-free")
    AGENT_FREE
}

@Serializable
enum class MeasurementState {
    @SerialName("initializing")
    INITIALIZING,

    @SerialName("available")
    AVAILABLE,

    @SerialName("unavailable")
    UNAVAILABLE
}

@Serializable
data class ActivityProcessRecord(
    val pid: Long,
    val executableIdentity: String? = null
)

@Serializable
data class MeasurementWarning(
    val reasonCode: String,
    val blockedSinceMs: Long,
    val processes: List<ActivityProcessRecord> = emptyList(),
    val processesTruncated: Boolean = false
)

@Serializable
data class IdleSuspendActivity(
    val measurementState: MeasurementState,
    val reasonCode: String? = null,
    val recognizedAgentCount: Int? = null,
    val monitoredTerminalCount: Int? = null,
    val sampledAtMs: Long? = null,
    val lastActivityAtMs: Long? = null,
    val networkCoverage: String? = null,
    val measurementWarning: MeasurementWarning? = null
)

@Serializable
data class AgentFreeStatus(
    val phase: String,
    val scope: String = "managed-terminals",
    val inventoryState: String,
    val inventoryRevision: Long,
    val semanticRevision: Long,
    val idleCount: Int? = null,
    val blockedCount: Int? = null,
    val workingCount: Int? = null,
    val unknownCount: Int? = null,
    val freeSinceMs: Long? = null,
    val eligibleAtMs: Long? = null,
    val deferredUntilMs: Long? = null,
    val reasonCode: String? = null
)

@Serializable
data class ClientPresenceStatus(
    val connectionCount: Int,
    val pendingUpgradeCount: Int = 0,
    val revision: Long,
    val available: Boolean
)

@Serializable
enum class SleepConsentDecision {
    @SerialName("approve")
    APPROVE,

    @SerialName("deny")
    DENY
}

@Serializable
enum class SleepConsentState {
    @SerialName("pending")
    PENDING,

    @SerialName("approved")
    APPROVED,

    @SerialName("denied")
    DENIED,

    @SerialName("expired")
    EXPIRED,

    @SerialName("cancelled")
    CANCELLED
}

@Serializable
data class SleepConsentStatus(
    val requestId: String,
    val requestRevision: Long,
    val state: SleepConsentState,
    val requestedAtMs: Long,
    val expiresAtMs: Long,
    val decision: SleepConsentDecision? = null,
    val wakeAfterSeconds: Int = 0
)

@Serializable
data class PtyFleetSnapshotDto(
    val liveCount: Int = 0,
    val creatingCount: Int = 0,
    val restartPendingCount: Int = 0,
    val generation: Long = 0,
    val quiescent: Boolean = true,
    val disposing: Boolean = false,
    val closing: Boolean = false,
    val handoffActive: Boolean = false
)

@Serializable
data class IdleSuspendStatusV1(
    val version: Int = 1,
    val statusRevision: Long = 0,
    val state: IdleSuspendState,
    val enabled: Boolean = false,
    val automaticPolicy: AutomaticPolicy = AutomaticPolicy.EMPTY_FLEET,
    val activity: IdleSuspendActivity? = null,
    val timingMutable: Boolean = false,
    val timingMutableReason: String? = null,
    val capabilityCode: String = "unavailable",
    val currentEpoch: Long = 0,
    val quietPeriodSeconds: Int = 300,
    val wakeAfterSeconds: Int = 600,
    val minQuietPeriodSeconds: Int = 60,
    val maxQuietPeriodSeconds: Int = 86400,
    val minWakeAfterSeconds: Int = 60,
    val maxWakeAfterSeconds: Int = 86400,
    val fleetSnapshot: PtyFleetSnapshotDto = PtyFleetSnapshotDto(),
    val armDeadlineMs: Long? = null,
    val agentFree: AgentFreeStatus? = null,
    val clientPresence: ClientPresenceStatus? = null,
    val consent: SleepConsentStatus? = null,
    val detail: String? = null,
    val timestampMs: Long = 0
)

@Serializable
data class IdleSuspendTimingPatchRequest(
    val quietPeriodSeconds: Int,
    val wakeAfterSeconds: Int
)

@Serializable
data class IdleSuspendTimingPatchResponse(
    val version: Int,
    val changed: Boolean,
    val statusRevision: Long,
    val quietPeriodSeconds: Int,
    val wakeAfterSeconds: Int
)

@Serializable
data class ForceSuspendRequest(
    val wakeAfterSeconds: Int,
    val force: Boolean
)

@Serializable
data class ForceSuspendAcceptedResponse(
    val version: Int,
    val requestId: String,
    val statusRevision: Long,
    val state: String,
    val wakeAfterSeconds: Int,
    val forced: Boolean,
    val fleetSnapshot: PtyFleetSnapshotDto
)

@Serializable
data class ConsentDecisionRequest(
    val requestId: String,
    val requestRevision: Long,
    val connectionId: String,
    val decisionCapability: String,
    val decision: SleepConsentDecision
) {
    override fun toString(): String =
        "ConsentDecisionRequest(requestId='$requestId', requestRevision=$requestRevision, connectionId='$connectionId', decisionCapability=[REDACTED], decision=$decision)"
}

@Serializable
data class ConsentDecisionResponse(
    val version: Int,
    val requestId: String,
    val decision: String,
    val statusRevision: Long,
    val settled: Boolean
)

@Serializable
data class IdleSuspendConflictResponse(
    val code: String,
    val error: String,
    val activeSessionCount: Int? = null,
    val fleetSnapshot: PtyFleetSnapshotDto? = null
)

private val lenientJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

private val strictJson = Json {
    ignoreUnknownKeys = false
    isLenient = false
}

/**
 * Decodes and normalizes IdleSuspendStatusV1.
 *
 * Fallback policy per docs/api/idle-suspend.md:
 * A client receiving a valid v1 response with both automaticPolicy and activity absent
 * normalizes them to automaticPolicy: "empty-fleet" and activity: null.
 * Any partial omission or invalid enum is rejected.
 */
fun decodeIdleSuspendStatusV1(jsonString: String): IdleSuspendStatusV1 {
    val element = lenientJson.parseToJsonElement(jsonString) as? JsonObject
        ?: throw IllegalArgumentException("Expected JSON object for IdleSuspendStatusV1")

    val hasPolicy = element.containsKey("automaticPolicy")
    val hasActivity = element.containsKey("activity")

    return if (!hasPolicy && !hasActivity) {
        // Both absent: old server normalization
        val normalized = element.toMutableMap()
        normalized["automaticPolicy"] = kotlinx.serialization.json.JsonPrimitive("empty-fleet")
        lenientJson.decodeFromJsonElement(IdleSuspendStatusV1.serializer(), JsonObject(normalized))
    } else if (!hasPolicy) {
        throw IllegalArgumentException("automaticPolicy missing while activity is present")
    } else {
        lenientJson.decodeFromJsonElement(IdleSuspendStatusV1.serializer(), element)
    }
}
