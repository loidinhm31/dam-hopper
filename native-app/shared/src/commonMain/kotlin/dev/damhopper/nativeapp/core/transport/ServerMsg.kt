@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package dev.damhopper.nativeapp.core.transport

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Outbound messages sent from server to client over WebSocket.
 * Deserialized polymorphically by "kind" tag; unknown tags fall back to ServerMsg.Unknown.
 */
@Serializable(with = ServerMsgSerializer::class)
sealed class ServerMsg {

    // Terminal
    @Serializable
    @SerialName("terminal:output")
    data class TermOutput(
        val id: String,
        val data: String,
        val offset: ULong,
        val incarnation: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:buffer")
    data class TermBuffer(
        val id: String,
        val data: String,
        val offset: ULong,
        val reset: Boolean,
        val truncated: Boolean,
        val incarnation: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:lifecycle")
    data class TerminalLifecycle(
        val id: String,
        val lifecycle: String,
        val generation: ULong,
        val command: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:exit")
    data class TermExit(
        val id: String,
        @SerialName("exitCode")
        val exitCode: Int? = null,
        @SerialName("willRestart")
        val willRestart: Boolean = false,
        @SerialName("restartIn")
        val restartIn: ULong? = null,
        @SerialName("restartCount")
        val restartCount: UInt? = null,
        val incarnation: ULong? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:lagged")
    data class TermLagged(
        val dropped: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:agentStatusChanged")
    data class AgentStatusChanged(
        @SerialName("serverEpoch")
        val serverEpoch: ULong,
        val revision: ULong,
        val row: JsonElement,
        val attention: JsonElement? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:agentStatusRemoved")
    data class AgentStatusRemoved(
        @SerialName("serverEpoch")
        val serverEpoch: ULong,
        val revision: ULong,
        @SerialName("terminalId")
        val terminalId: String,
        val incarnation: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("terminal:agentStatusInvalidated")
    data class AgentStatusInvalidated(
        @SerialName("serverEpoch")
        val serverEpoch: ULong,
        val revision: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("process:restarted")
    data class ProcessRestarted(
        val id: String,
        @SerialName("restartCount")
        val restartCount: UInt,
        @SerialName("previousExitCode")
        val previousExitCode: Int? = null,
    ) : ServerMsg()

    // FS
    @Serializable
    @SerialName("fs:tree_snapshot")
    data class TreeSnapshot(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("sub_id")
        val subId: ULong,
        val nodes: List<TreeNode> = emptyList(),
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:event")
    data class FsEventMsg(
        @SerialName("sub_id")
        val subId: ULong,
        val event: FsEventDto,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:error")
    data class FsError(
        @SerialName("req_id")
        val reqId: ULong,
        val code: String,
        val message: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:overflow")
    data class FsOverflow(
        @SerialName("sub_id")
        val subId: ULong,
        val message: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:read_result")
    data class FsReadResult(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        val mime: String? = null,
        val binary: Boolean = false,
        val mtime: Long? = null,
        val size: ULong? = null,
        val data: String? = null,
        val code: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:write_ack")
    data class FsWriteAck(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("write_id")
        val writeId: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:write_chunk_ack")
    data class FsWriteChunkAck(
        @SerialName("write_id")
        val writeId: ULong,
        val seq: UInt,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:write_result")
    data class FsWriteResult(
        @SerialName("write_id")
        val writeId: ULong,
        val ok: Boolean,
        @SerialName("new_mtime")
        val newMtime: Long? = null,
        val conflict: Boolean = false,
        val error: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:op_result")
    data class FsOpResult(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        val error: String? = null,
    ) : ServerMsg()

    // Tunnel
    @Serializable
    @SerialName("tunnel:created")
    data class TunnelCreated(
        val id: String,
        val port: Int,
        val label: String,
        val driver: String,
        val status: String,
        @SerialName("startedAt")
        val startedAt: Long,
        @SerialName("reminderDue")
        val reminderDue: Boolean,
    ) : ServerMsg()

    @Serializable
    @SerialName("tunnel:ready")
    data class TunnelReady(
        val id: String,
        val url: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("tunnel:failed")
    data class TunnelFailed(
        val id: String,
        val error: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("tunnel:stopped")
    data class TunnelStopped(
        val id: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("tunnel:reminder")
    data class TunnelReminder(
        val id: String,
    ) : ServerMsg()

    // Upload
    @Serializable
    @SerialName("fs:upload_begin_ok")
    data class FsUploadBeginOk(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:upload_chunk_ack")
    data class FsUploadChunkAck(
        @SerialName("upload_id")
        val uploadId: String,
        val seq: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:upload_result")
    data class FsUploadResult(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
        val ok: Boolean,
        @SerialName("new_mtime")
        val newMtime: Long? = null,
        val error: String? = null,
    ) : ServerMsg()

    // Auth OPAQUE responses
    @Serializable
    @SerialName("auth:register_start_response")
    data class AuthRegisterStartResponse(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        val data: String? = null,
        val error: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("auth:register_finish_response")
    data class AuthRegisterFinishResponse(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        val error: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("auth:login_start_response")
    data class AuthLoginStartResponse(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        @SerialName("session_id")
        val sessionId: String? = null,
        val data: String? = null,
        val error: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("auth:login_finish_response")
    data class AuthLoginFinishResponse(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        @SerialName("session_id")
        val sessionId: String? = null,
        val error: String? = null,
    ) : ServerMsg()

    // Encrypted Put
    @Serializable
    @SerialName("fs:put_begin_ok")
    data class FsPutBeginOk(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:put_chunk_ack")
    data class FsPutChunkAck(
        @SerialName("upload_id")
        val uploadId: String,
        val seq: ULong,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:put_result")
    data class FsPutResult(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
        val ok: Boolean,
        val conflict: Boolean = false,
        @SerialName("new_mtime")
        val newMtime: Long? = null,
        val error: String? = null,
    ) : ServerMsg()

    @Serializable
    @SerialName("fs:put_save_result")
    data class FsPutSaveResult(
        @SerialName("req_id")
        val reqId: ULong,
        val ok: Boolean,
        @SerialName("new_mtime")
        val newMtime: Long? = null,
        val error: String? = null,
    ) : ServerMsg()

    // Ports
    @Serializable
    @SerialName("port:discovered")
    data class PortDiscovered(
        val port: Int,
        @SerialName("session_id")
        val sessionId: String,
        val incarnation: ULong,
        val project: String? = null,
        @SerialName("detected_via")
        val detectedVia: String,
        val state: String,
    ) : ServerMsg()

    @Serializable
    @SerialName("port:lost")
    data class PortLost(
        val port: Int,
        @SerialName("session_id")
        val sessionId: String,
        val incarnation: ULong,
    ) : ServerMsg()

    // Exact socket UI Connection Receipt
    @Serializable
    @SerialName("host:uiConnection")
    data class UiConnection(
        val version: Int,
        @SerialName("connectionId")
        val connectionId: String,
        @SerialName("decisionCapability")
        val decisionCapability: String,
    ) : ServerMsg() {
        override fun toString(): String =
            "UiConnection(version=$version, connectionId='$connectionId', decisionCapability=[REDACTED])"
    }

    // Fallback for unknown kinds to ensure forward compatibility
    @Serializable
    data class Unknown(
        val kind: String = "unknown",
    ) : ServerMsg()
}

/**
 * Resilient polymorphic deserializer for ServerMsg.
 * Falls back to ServerMsg.Unknown for unrecognized `kind` values.
 */
object ServerMsgSerializer : JsonContentPolymorphicSerializer<ServerMsg>(ServerMsg::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out ServerMsg> {
        val kind = element.jsonObject["kind"]?.jsonPrimitive?.content
        return when (kind) {
            "terminal:output" -> ServerMsg.TermOutput.serializer()
            "terminal:buffer" -> ServerMsg.TermBuffer.serializer()
            "terminal:lifecycle" -> ServerMsg.TerminalLifecycle.serializer()
            "terminal:exit" -> ServerMsg.TermExit.serializer()
            "terminal:lagged" -> ServerMsg.TermLagged.serializer()
            "terminal:agentStatusChanged" -> ServerMsg.AgentStatusChanged.serializer()
            "terminal:agentStatusRemoved" -> ServerMsg.AgentStatusRemoved.serializer()
            "terminal:agentStatusInvalidated" -> ServerMsg.AgentStatusInvalidated.serializer()
            "process:restarted" -> ServerMsg.ProcessRestarted.serializer()
            "fs:tree_snapshot" -> ServerMsg.TreeSnapshot.serializer()
            "fs:event" -> ServerMsg.FsEventMsg.serializer()
            "fs:error" -> ServerMsg.FsError.serializer()
            "fs:overflow" -> ServerMsg.FsOverflow.serializer()
            "fs:read_result" -> ServerMsg.FsReadResult.serializer()
            "fs:write_ack" -> ServerMsg.FsWriteAck.serializer()
            "fs:write_chunk_ack" -> ServerMsg.FsWriteChunkAck.serializer()
            "fs:write_result" -> ServerMsg.FsWriteResult.serializer()
            "fs:op_result" -> ServerMsg.FsOpResult.serializer()
            "tunnel:created" -> ServerMsg.TunnelCreated.serializer()
            "tunnel:ready" -> ServerMsg.TunnelReady.serializer()
            "tunnel:failed" -> ServerMsg.TunnelFailed.serializer()
            "tunnel:stopped" -> ServerMsg.TunnelStopped.serializer()
            "tunnel:reminder" -> ServerMsg.TunnelReminder.serializer()
            "fs:upload_begin_ok" -> ServerMsg.FsUploadBeginOk.serializer()
            "fs:upload_chunk_ack" -> ServerMsg.FsUploadChunkAck.serializer()
            "fs:upload_result" -> ServerMsg.FsUploadResult.serializer()
            "auth:register_start_response" -> ServerMsg.AuthRegisterStartResponse.serializer()
            "auth:register_finish_response" -> ServerMsg.AuthRegisterFinishResponse.serializer()
            "auth:login_start_response" -> ServerMsg.AuthLoginStartResponse.serializer()
            "auth:login_finish_response" -> ServerMsg.AuthLoginFinishResponse.serializer()
            "fs:put_begin_ok" -> ServerMsg.FsPutBeginOk.serializer()
            "fs:put_chunk_ack" -> ServerMsg.FsPutChunkAck.serializer()
            "fs:put_result" -> ServerMsg.FsPutResult.serializer()
            "fs:put_save_result" -> ServerMsg.FsPutSaveResult.serializer()
            "port:discovered" -> ServerMsg.PortDiscovered.serializer()
            "port:lost" -> ServerMsg.PortLost.serializer()
            "host:uiConnection" -> ServerMsg.UiConnection.serializer()
            else -> ServerMsg.Unknown.serializer()
        }
    }
}
