package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class DetectedVia {
    @SerialName("stdout_regex")
    STDOUT_REGEX,

    @SerialName("proc_net")
    PROC_NET
}

@Serializable
enum class PortState {
    @SerialName("provisional")
    PROVISIONAL,

    @SerialName("listening")
    LISTENING,

    @SerialName("lost")
    LOST
}

@Serializable
data class DetectedPort(
    val port: Int,
    @SerialName("session_id")
    val sessionId: String,
    val incarnation: ULong,
    val project: String? = null,
    @SerialName("detected_via")
    val detectedVia: DetectedVia = DetectedVia.PROC_NET,
    val state: PortState = PortState.LISTENING
)

@Serializable
data class PortListResponse(
    val ports: List<DetectedPort> = emptyList()
)
