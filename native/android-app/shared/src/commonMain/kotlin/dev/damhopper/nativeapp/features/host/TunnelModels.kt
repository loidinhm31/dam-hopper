package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class TunnelStatus {
    @SerialName("starting")
    STARTING,

    @SerialName("ready")
    READY,

    @SerialName("failed")
    FAILED,

    @SerialName("stopped")
    STOPPED
}

@Serializable
data class TunnelSession(
    val id: String,
    val port: Int,
    val label: String,
    val driver: String = "cloudflared",
    val status: TunnelStatus,
    val url: String? = null,
    val error: String? = null,
    @SerialName("startedAt")
    val startedAt: Long,
    @SerialName("reminderDue")
    val reminderDue: Boolean = false,
    val pid: Long? = null
)

@Serializable
data class CreateTunnelRequest(
    val port: Int,
    val label: String
)

@Serializable
data class InstallStatusResponse(
    val installing: Boolean,
    val installed: Boolean
)

@Serializable
data class TunnelErrorBody(
    val error: String
)
