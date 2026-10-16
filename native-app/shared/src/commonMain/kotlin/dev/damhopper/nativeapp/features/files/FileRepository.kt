@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

class FileRepository(
    val apiClient: ApiClient,
    val wsConnection: WsConnection,
    coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
) {
    private val writeCoordinator = FsWriteCoordinator(wsConnection) { wsConnection.nextReqId() }
    private val transferCoordinator = TransferCoordinator(wsConnection, { wsConnection.nextReqId() })
    private val subscriptionManager = TreeSubscriptionManager(wsConnection, coroutineScope) { wsConnection.nextReqId() }

    suspend fun listDirectory(target: ProjectTargetRef, relativePath: String = ""): List<DirEntryDto> {
        val queryParams = mutableMapOf("project" to target.project, "path" to relativePath.ifBlank { "." })
        target.worktreePath?.let { queryParams["worktreePath"] = it }
        val json = apiClient.get("/api/fs/list", queryParams)
        return ProtocolJson.decodeFromString(ListResponseDto.serializer(), json).entries
    }

    suspend fun stat(target: ProjectTargetRef, relativePath: String): FileStatDto {
        val queryParams = mutableMapOf("project" to target.project, "path" to relativePath)
        target.worktreePath?.let { queryParams["worktreePath"] = it }
        val json = apiClient.get("/api/fs/stat", queryParams)
        return ProtocolJson.decodeFromString(FileStatDto.serializer(), json)
    }

    suspend fun readFile(
        target: ProjectTargetRef,
        relativePath: String,
        offset: ULong? = null,
        len: ULong? = null,
    ): FsFileReadResult {
        val reqId = wsConnection.nextReqId()
        val readMsg = ClientMsg.FsRead(
            reqId = reqId,
            project = target.project,
            worktreePath = target.worktreePath,
            path = relativePath,
            offset = offset,
            len = len,
        )

        return try {
            val response = wsConnection.request(reqId, readMsg)
            when (response) {
                is ServerMsg.FsReadResult -> {
                    val binaryBytes = response.data?.let {
                        try { Base64.decode(it) } catch (_: Throwable) { null }
                    }
                    val text = if (!response.binary && binaryBytes != null) binaryBytes.decodeToString() else null
                    FsFileReadResult(
                        ok = response.ok,
                        mime = response.mime,
                        isBinary = response.binary,
                        mtime = response.mtime,
                        size = response.size,
                        textContent = text,
                        binaryData = binaryBytes,
                        errorCode = response.code,
                    )
                }
                is ServerMsg.FsError -> FsFileReadResult(ok = false, errorCode = response.code)
                else -> FsFileReadResult(ok = false, errorCode = "UNKNOWN_RESPONSE")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            val queryParams = mutableMapOf("project" to target.project, "path" to relativePath)
            target.worktreePath?.let { queryParams["worktreePath"] = it }
            offset?.let { queryParams["offset"] = it.toString() }
            len?.let { queryParams["len"] = it.toString() }

            try {
                val body = apiClient.get("/api/fs/read", queryParams)
                if (body.contains("\"binary\":true") || body.contains("\"binary\": true")) {
                    FsFileReadResult(ok = true, isBinary = true, textContent = null)
                } else {
                    FsFileReadResult(ok = true, isBinary = false, textContent = body, size = body.encodeToByteArray().size.toULong())
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                FsFileReadResult(ok = false, errorCode = e.message ?: "READ_FAILED")
            }
        }
    }

    suspend fun writeFile(
        target: ProjectTargetRef,
        relativePath: String,
        content: String,
        expectedMtime: Long,
    ): ServerMsg.FsWriteResult {
        return writeCoordinator.writeFile(target, relativePath, content, expectedMtime)
    }

    suspend fun uploadPlain(
        target: ProjectTargetRef,
        dir: String,
        filename: String,
        content: ByteArray,
        overwrite: Boolean = true,
        timeoutMillis: Long = 60_000,
        onProgress: ((bytesSent: Long, totalBytes: Long) -> Unit)? = null,
    ): TransferResult {
        return transferCoordinator.uploadPlain(target, dir, filename, content, overwrite, timeoutMillis, expectedOwner = wsConnection.connection, onProgress = onProgress)
    }

    suspend fun uploadEncrypted(
        target: ProjectTargetRef,
        dir: String,
        filename: String,
        content: ByteArray,
        cryptoSession: dev.damhopper.nativeapp.core.security.CryptoSession,
        expectedMtime: Long? = null,
        mimeType: String = "application/octet-stream",
        timeoutMillis: Long = 60_000,
        onProgress: ((bytesSent: Long, totalBytes: Long) -> Unit)? = null,
    ): TransferResult {
        return transferCoordinator.uploadEncrypted(target, dir, filename, content, cryptoSession, expectedMtime, mimeType, timeoutMillis, expectedOwner = wsConnection.connection, onProgress = onProgress)
    }

    suspend fun executeFsOp(
        target: ProjectTargetRef,
        op: String,
        path: String,
        newPath: String? = null,
        forceGit: Boolean = false,
    ): FsOpOutcome {
        val reqId = wsConnection.nextReqId()
        val opMsg = ClientMsg.FsOp(
            reqId = reqId,
            op = op,
            project = target.project,
            worktreePath = target.worktreePath,
            path = path,
            newPath = newPath,
            forceGit = forceGit,
        )

        return try {
            when (val response = wsConnection.request(reqId, opMsg)) {
                is ServerMsg.FsOpResult -> FsOpOutcome(ok = response.ok, error = response.error)
                is ServerMsg.FsError -> FsOpOutcome(ok = false, error = "[${response.code}] ${response.message}")
                else -> FsOpOutcome(ok = false, error = "Unexpected response from server")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            FsOpOutcome(ok = false, error = e.message ?: "Mutation request failed")
        }
    }

    suspend fun subscribeTree(
        target: ProjectTargetRef,
        path: String = "",
        watchOnly: Boolean? = true,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit,
        onEvent: (FsEventDto) -> Unit,
        onOverflow: (String) -> Unit,
    ): FileTreeSubscription {
        return subscriptionManager.subscribe(target, path, watchOnly, onSnapshot, onEvent, onOverflow)
    }

    fun unsubscribeTree(subId: ULong) = subscriptionManager.unsubscribe(subId)
    fun dispose() = subscriptionManager.dispose()
}
