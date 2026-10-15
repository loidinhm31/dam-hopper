@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package dev.damhopper.nativeapp.core.transport

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

/**
 * Inbound messages sent from client to server over WebSocket.
 * Discriminator is "kind" in the JSON envelope.
 */
@Serializable
@JsonClassDiscriminator("kind")
sealed class ClientMsg {

    // Terminal
    @Serializable
    @SerialName("terminal:write")
    data class TermWrite(
        val id: String,
        val data: String,
    ) : ClientMsg()

    @Serializable
    @SerialName("terminal:resize")
    data class TermResize(
        val id: String,
        val cols: Int,
        val rows: Int,
    ) : ClientMsg()

    @Serializable
    @SerialName("terminal:attach")
    data class TermAttach(
        val id: String,
        @SerialName("from_offset")
        val fromOffset: ULong? = null,
    ) : ClientMsg()

    // FS — subscribe
    @Serializable
    @SerialName("fs:subscribe_tree")
    data class FsSubscribeTree(
        @SerialName("req_id")
        val reqId: ULong,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val path: String,
        @SerialName("watchOnly")
        val watchOnly: Boolean? = null,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:unsubscribe_tree")
    data class FsUnsubscribeTree(
        @SerialName("sub_id")
        val subId: ULong,
    ) : ClientMsg()

    // FS — read
    @Serializable
    @SerialName("fs:read")
    data class FsRead(
        @SerialName("req_id")
        val reqId: ULong,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val path: String,
        val offset: ULong? = null,
        val len: ULong? = null,
        @SerialName("readMode")
        val readMode: String? = null,
    ) : ClientMsg()

    // FS — write
    @Serializable
    @SerialName("fs:write_begin")
    data class FsWriteBegin(
        @SerialName("req_id")
        val reqId: ULong,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val path: String,
        @SerialName("expected_mtime")
        val expectedMtime: Long,
        val size: ULong,
        val encoding: String? = null,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:write_chunk")
    data class FsWriteChunk(
        @SerialName("write_id")
        val writeId: ULong,
        val seq: UInt,
        val eof: Boolean,
        val data: String,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:write_chunk_binary")
    data class FsWriteChunkBinary(
        @SerialName("write_id")
        val writeId: ULong,
        val seq: UInt,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:write_commit")
    data class FsWriteCommit(
        @SerialName("write_id")
        val writeId: ULong,
    ) : ClientMsg()

    // FS — mutating ops
    @Serializable
    @SerialName("fs:op")
    data class FsOp(
        @SerialName("req_id")
        val reqId: ULong,
        val op: String,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val path: String,
        @SerialName("new_path")
        val newPath: String? = null,
        @SerialName("force_git")
        val forceGit: Boolean = false,
    ) : ClientMsg()

    // FS — upload
    @Serializable
    @SerialName("fs:upload_begin")
    data class FsUploadBegin(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val dir: String,
        val filename: String,
        val len: ULong,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:upload_chunk")
    data class FsUploadChunk(
        @SerialName("upload_id")
        val uploadId: String,
        val seq: ULong,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:upload_commit")
    data class FsUploadCommit(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
    ) : ClientMsg()

    // Auth — OPAQUE registration
    @Serializable
    @SerialName("auth:register_start")
    data class AuthRegisterStart(
        @SerialName("req_id")
        val reqId: ULong,
        val identifier: String,
        val data: String,
    ) : ClientMsg()

    @Serializable
    @SerialName("auth:register_finish")
    data class AuthRegisterFinish(
        @SerialName("req_id")
        val reqId: ULong,
        val identifier: String,
        val data: String,
        val overwrite: Boolean = false,
    ) : ClientMsg()

    // Auth — OPAQUE login
    @Serializable
    @SerialName("auth:login_start")
    data class AuthLoginStart(
        @SerialName("req_id")
        val reqId: ULong,
        val identifier: String,
        val data: String,
    ) : ClientMsg()

    @Serializable
    @SerialName("auth:login_finish")
    data class AuthLoginFinish(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("session_id")
        val sessionId: String,
        val data: String,
    ) : ClientMsg()

    // FS — encrypted put
    @Serializable
    @SerialName("fs:put_begin")
    data class FsPutBegin(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
        @SerialName("session_id")
        val sessionId: String,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val dir: String,
        val filename: String,
        val len: ULong,
        @SerialName("expected_mtime")
        val expectedMtime: Long? = null,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:put_chunk")
    data class FsPutChunk(
        @SerialName("upload_id")
        val uploadId: String,
        val seq: ULong,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:put_commit")
    data class FsPutCommit(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("upload_id")
        val uploadId: String,
    ) : ClientMsg()

    @Serializable
    @SerialName("fs:put_save")
    data class FsPutSave(
        @SerialName("req_id")
        val reqId: ULong,
        @SerialName("session_id")
        val sessionId: String,
        val project: String,
        @SerialName("worktree_path")
        val worktreePath: String? = null,
        val path: String,
    ) : ClientMsg()

    @Serializable
    @SerialName("auth:session_remove")
    data class AuthSessionRemove(
        @SerialName("session_id")
        val sessionId: String,
    ) : ClientMsg()
}
