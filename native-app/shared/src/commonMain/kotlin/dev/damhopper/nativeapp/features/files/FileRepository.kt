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
    val owner: dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner,
    val apiClient: ApiClient,
    val wsConnection: WsConnection,
    coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    val arbiter: FileOperationArbiter = FileOperationArbiter(),
) {
    constructor(
        apiClient: ApiClient,
        wsConnection: WsConnection,
        coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
        defaultProject: String = "*",
    ) : this(
        owner = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
            profileId = apiClient.connection.profileId,
            baseUrl = apiClient.normalizedBaseUrl,
            accountUser = "authenticated-user",
            project = defaultProject,
        ),
        apiClient = apiClient,
        wsConnection = wsConnection,
        coroutineScope = coroutineScope,
    )

    init {
        require(apiClient.connection.profileId == owner.profileId) {
            "ApiClient profileId (${apiClient.connection.profileId}) must match owner profileId (${owner.profileId})"
        }
        require(wsConnection.connection.profileId == owner.profileId) {
            "WsConnection profileId (${wsConnection.connection.profileId}) must match owner profileId (${owner.profileId})"
        }
        require(apiClient.connection.generation == wsConnection.connection.generation) {
            "ApiClient generation (${apiClient.connection.generation}) must match WsConnection generation (${wsConnection.connection.generation})"
        }
        require(apiClient.normalizedBaseUrl == owner.normalizedBaseUrl) {
            "ApiClient baseUrl (${apiClient.normalizedBaseUrl}) must match owner baseUrl (${owner.normalizedBaseUrl})"
        }
        require(wsConnection.baseUrl.trim().trimEnd('/') == owner.normalizedBaseUrl) {
            "WsConnection baseUrl (${wsConnection.baseUrl}) must match owner baseUrl (${owner.normalizedBaseUrl})"
        }
    }

    fun assertTargetMatchesOwner(target: ProjectTargetRef, operation: String) {
        if (!owner.matchesTarget(target)) {
            throw IllegalArgumentException(
                "Cross-owner target rejected in FileRepository.$operation: target=$target does not match owner=$owner"
            )
        }
    }

    private val writeCoordinator = FsWriteCoordinator(wsConnection) { wsConnection.nextReqId() }
    private val transferCoordinator = TransferCoordinator(wsConnection, { wsConnection.nextReqId() })
    private val subscriptionManager = TreeSubscriptionManager(wsConnection, coroutineScope) { wsConnection.nextReqId() }
    suspend fun listDirectory(target: ProjectTargetRef, relativePath: String = ""): List<DirEntryDto> {
        assertTargetMatchesOwner(target, "listDirectory")
        val cleanPath = if (relativePath.isBlank() || relativePath == ".") "." else dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(relativePath)
        val queryParams = mutableMapOf("project" to target.project, "path" to cleanPath)
        target.worktreePath?.let { queryParams["worktreePath"] = it }
        val json = apiClient.get("/api/fs/list", queryParams)
        return ProtocolJson.decodeFromString(ListResponseDto.serializer(), json).entries
    }

    suspend fun stat(target: ProjectTargetRef, relativePath: String): FileStatDto {
        assertTargetMatchesOwner(target, "stat")
        val cleanPath = if (relativePath.isBlank() || relativePath == ".") "." else dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(relativePath)
        val queryParams = mutableMapOf("project" to target.project, "path" to cleanPath)
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
        assertTargetMatchesOwner(target, "readFile")
        val cleanPath = dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(relativePath)

        val reqId = wsConnection.nextReqId()
        val readMsg = ClientMsg.FsRead(
            reqId = reqId,
            project = target.project,
            worktreePath = target.worktreePath,
            path = cleanPath,
            offset = offset,
            len = len,
        )
        val maxBytes = (len?.toLong() ?: 5_242_880L).coerceAtMost(5_242_880L)
        val activeSocket = wsConnection.activeSocketRef()
        if (activeSocket == null) {
            return readViaRest(target, cleanPath, offset, len, maxBytes)
        }

        return try {
            val response = wsConnection.requestOnSocket(activeSocket, reqId, readMsg)
            when (response) {
                is ServerMsg.FsReadResult -> {
                    val rawData = response.data
                    if (rawData != null) {
                        val padding = if (rawData.endsWith("==")) 2 else if (rawData.endsWith("=")) 1 else 0
                        val exactDecodedLen = (rawData.length.toLong() * 3L) / 4L - padding
                        if (exactDecodedLen > maxBytes) {
                            return FsFileReadResult(ok = false, errorCode = "OVERSIZE_BYTES")
                        }
                    }
                    val binaryBytes = rawData?.let {
                        try { Base64.decode(it) } catch (_: Throwable) { null }
                    }
                    if (binaryBytes != null && binaryBytes.size.toLong() > maxBytes) {
                        return FsFileReadResult(ok = false, errorCode = "OVERSIZE_BYTES")
                    }
                    val text = if (!response.binary && binaryBytes != null) {
                        try {
                            binaryBytes.decodeToString(throwOnInvalidSequence = true)
                        } catch (_: Throwable) {
                            null
                        }
                    } else null
                    FsFileReadResult(
                        ok = response.ok,
                        mime = response.mime,
                        isBinary = response.binary || (binaryBytes != null && text == null),
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
        } catch (e: dev.damhopper.nativeapp.core.model.ConnectionOwnerError) {
            if (e.reason != dev.damhopper.nativeapp.core.model.ConnectionErrorReason.UNAVAILABLE) {
                FsFileReadResult(ok = false, errorCode = "OWNER_ERROR: ${e.message}")
            } else {
                readViaRest(target, cleanPath, offset, len, maxBytes)
            }
        } catch (e: IllegalArgumentException) {
            throw e
        } catch (_: Throwable) {
            readViaRest(target, cleanPath, offset, len, maxBytes)
        }
    }

    private suspend fun readViaRest(
        target: ProjectTargetRef,
        cleanPath: String,
        offset: ULong?,
        len: ULong?,
        maxBytes: Long,
    ): FsFileReadResult {
        val queryParams = mutableMapOf("project" to target.project, "path" to cleanPath)
        target.worktreePath?.let { queryParams["worktreePath"] = it }
        offset?.let { queryParams["offset"] = it.toString() }
        len?.let { queryParams["len"] = it.toString() }

        return try {
            val rawBytes = apiClient.getBytesBounded("/api/fs/read", queryParams, maxBytes = maxBytes)
            val rawString = rawBytes.decodeToString()
            if (rawString.contains("\"binary\":true") || rawString.contains("\"binary\": true")) {
                FsFileReadResult(ok = true, isBinary = true, textContent = null)
            } else {
                val text = try {
                    rawBytes.decodeToString(throwOnInvalidSequence = true)
                } catch (_: Throwable) {
                    null
                }
                if (text != null) {
                    FsFileReadResult(
                        ok = true,
                        isBinary = false,
                        textContent = text,
                        size = rawBytes.size.toULong(),
                        binaryData = rawBytes,
                    )
                } else {
                    FsFileReadResult(
                        ok = true,
                        isBinary = true,
                        textContent = null,
                        size = rawBytes.size.toULong(),
                        binaryData = rawBytes,
                    )
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            FsFileReadResult(ok = false, errorCode = e.message ?: "READ_FAILED")
        }
    }

    suspend fun writeFile(
        target: ProjectTargetRef,
        relativePath: String,
        content: String,
        expectedMtime: Long,
    ): ServerMsg.FsWriteResult {
        assertTargetMatchesOwner(target, "writeFile")
        val cleanPath = dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(relativePath)
        return writeCoordinator.writeFile(target, cleanPath, content, expectedMtime)
    }

    suspend fun writeFileWithOutcome(
        target: ProjectTargetRef,
        relativePath: String,
        content: String,
        expectedMtime: Long,
        timeoutMillis: Long = 30_000,
        reservationToken: ReservationToken? = null,
        submittedRevision: Long? = null,
        tabIncarnation: Long? = null,
    ): FileOperationOutcome<ServerMsg.FsWriteResult> {
        assertTargetMatchesOwner(target, "writeFileWithOutcome")
        val cleanPath = dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(relativePath)
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(owner, target)
        return writeCoordinator.writeFileWithOutcome(
            owner = effectiveOwner,
            target = target,
            path = cleanPath,
            content = content,
            expectedMtime = expectedMtime,
            timeoutMillis = timeoutMillis,
            arbiter = arbiter,
            reservationToken = reservationToken,
            submittedRevision = submittedRevision,
            tabIncarnation = tabIncarnation,
        )
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
        assertTargetMatchesOwner(target, "uploadPlain")
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
        assertTargetMatchesOwner(target, "uploadEncrypted")
        return transferCoordinator.uploadEncrypted(target, dir, filename, content, cryptoSession, expectedMtime, mimeType, timeoutMillis, expectedOwner = wsConnection.connection, onProgress = onProgress)
    }
    suspend fun executeFsOpWithOutcome(
        target: ProjectTargetRef,
        op: String,
        path: String,
        newPath: String? = null,
        forceGit: Boolean = false,
        reservationToken: ReservationToken? = null,
    ): FileOperationOutcome<FsOpOutcome> {
        assertTargetMatchesOwner(target, "executeFsOpWithOutcome")
        val cleanPath = dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(path)
        val cleanNewPath = newPath?.let { dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(it) }
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(owner, target)

        val activeSocket = wsConnection.activeSocketRef()
            ?: return FileOperationOutcome.NotSubmitted("WebSocket is not connected")

        val reqId = wsConnection.nextReqId()
        val opMsg = ClientMsg.FsOp(
            reqId = reqId,
            op = op,
            project = target.project,
            worktreePath = target.worktreePath,
            path = cleanPath,
            newPath = cleanNewPath,
            forceGit = forceGit,
        )

        val quarantinedOp = QuarantinedOperation(
            owner = effectiveOwner,
            path = cleanPath,
            destinationPath = cleanNewPath,
            operationKind = op,
            stage = OperationStage.FS_OP_DISPATCHED,
            opId = reqId.toString(),
            submittedRevision = null,
            baselineRevision = null,
            submittedBytes = null,
            timestampMillis = kotlinx.datetime.Clock.System.now().toEpochMilliseconds(),
        )
        if (reservationToken != null) {
            arbiter.quarantineToken(reservationToken, quarantinedOp)
        }
        return try {
            val response = wsConnection.requestOnSocket(activeSocket, reqId, opMsg)
            when (response) {
                is ServerMsg.FsOpResult -> {
                    if (response.ok) {
                        FileOperationOutcome.Confirmed(FsOpOutcome(ok = true))
                    } else {
                        FileOperationOutcome.Rejected(
                            code = "FS_OP_FAILED",
                            message = response.error ?: "File operation failed",
                        )
                    }
                }
                is ServerMsg.FsError -> {
                    FileOperationOutcome.Rejected(
                        code = response.code,
                        message = response.message,
                    )
                }
                else -> FileOperationOutcome.Unknown(
                    stage = OperationStage.AWAITING_RESULT,
                    opId = reqId.toString(),
                    message = "Unexpected response from server: $response",
                )
            }
        } catch (e: CancellationException) {
            FileOperationOutcome.Unknown(
                stage = OperationStage.AWAITING_RESULT,
                opId = reqId.toString(),
                message = "Cancelled while awaiting fs:op response",
                cause = e,
            )
        } catch (t: Throwable) {
            FileOperationOutcome.Unknown(
                stage = OperationStage.AWAITING_RESULT,
                opId = reqId.toString(),
                message = "Error awaiting fs:op response: ${t.message}",
                cause = t,
            )
        }
    }

    suspend fun executeFsOp(
        target: ProjectTargetRef,
        op: String,
        path: String,
        newPath: String? = null,
        forceGit: Boolean = false,
    ): FsOpOutcome {
        val outcome = executeFsOpWithOutcome(target, op, path, newPath, forceGit, reservationToken = null)
        return when (outcome) {
            is FileOperationOutcome.Confirmed -> outcome.result
            is FileOperationOutcome.Rejected -> FsOpOutcome(ok = false, error = "[${outcome.code}] ${outcome.message}")
            is FileOperationOutcome.NotSubmitted -> FsOpOutcome(ok = false, error = "Not submitted: ${outcome.reason}")
            is FileOperationOutcome.Unknown -> FsOpOutcome(ok = false, error = "Outcome unknown at stage ${outcome.stage}: ${outcome.message}")
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
        assertTargetMatchesOwner(target, "subscribeTree")
        val cleanPath = if (path.isBlank() || path == ".") "" else dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(path)
        return subscriptionManager.subscribe(target, cleanPath, watchOnly, onSnapshot, onEvent, onOverflow)
    }

    fun unsubscribeTree(subId: ULong) = subscriptionManager.unsubscribe(subId)
    fun dispose() = subscriptionManager.dispose()
    suspend fun reconcileUnknownSave(
        target: ProjectTargetRef,
        relativePath: String,
        quarantinedOp: QuarantinedOperation,
    ): SaveReconciliationResult {
        assertTargetMatchesOwner(target, "reconcileUnknownSave")
        val cleanPath = dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(relativePath)
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(owner, target)
        val submitted = quarantinedOp.submittedBytes
            ?: return SaveReconciliationResult.Unresolved("No submitted bytes recorded for quarantined save on '$cleanPath'")

        val preStat = try {
            stat(target, cleanPath)
        } catch (e: Throwable) {
            return SaveReconciliationResult.Unresolved("Failed to stat file during reconciliation: ${e.message}")
        }

        if (preStat.size.toLong() != submitted.size.toLong()) {
            return SaveReconciliationResult.Conflicted(
                "Remote file size (${preStat.size}) does not match submitted bytes (${submitted.size})"
            )
        }

        val readRes = try {
            readFile(target, cleanPath, offset = 0uL, len = (submitted.size + 1).toULong())
        } catch (e: Throwable) {
            return SaveReconciliationResult.Unresolved("Failed reading server bytes for comparison: ${e.message}")
        }

        val serverBytes = readRes.binaryData ?: readRes.textContent?.encodeToByteArray()
            ?: return SaveReconciliationResult.Unresolved("Failed reading server content data")

        if (serverBytes.size != submitted.size || !serverBytes.contentEquals(submitted)) {
            return SaveReconciliationResult.Conflicted("Server content differs from submitted bytes")
        }

        val postStat = try {
            stat(target, cleanPath)
        } catch (e: Throwable) {
            return SaveReconciliationResult.Unresolved("Failed post-read stat during reconciliation: ${e.message}")
        }

        if (postStat.mtime != preStat.mtime || postStat.size != preStat.size) {
            return SaveReconciliationResult.Unresolved("File was modified concurrently during reconciliation read")
        }

        return SaveReconciliationResult.Reconciled(postStat.mtime.toLong())
    }

    suspend fun reconcileUnknownMutation(
        target: ProjectTargetRef,
        op: String,
        sourcePath: String,
        destPath: String?,
    ): MutationReconciliationResult {
        assertTargetMatchesOwner(target, "reconcileUnknownMutation")
        val cleanSource = dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(sourcePath)
        val cleanDest = destPath?.let { dev.damhopper.nativeapp.features.workspace.DocumentId.normalizeRelativePath(it) }
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(owner, target)

        val sourceStat = try { stat(target, cleanSource) } catch (_: Throwable) { null }
        val destStat = cleanDest?.let { try { stat(target, it) } catch (_: Throwable) { null } }

        val sourceParent = FileTreeHelpers.resolveParentPath(cleanSource)
        val sourceParentList = try { listDirectory(target, sourceParent) } catch (_: Throwable) { emptyList() }
        val destParentList = cleanDest?.let {
            val destParent = FileTreeHelpers.resolveParentPath(it)
            if (destParent == sourceParent) sourceParentList
            else try { listDirectory(target, destParent) } catch (_: Throwable) { emptyList() }
        } ?: emptyList()

        val statusDesc = buildString {
            append("Probed server state for $op: ")
            append("source '$cleanSource' ${if (sourceStat != null) "exists (size=${sourceStat.size})" else "not found"}; ")
            if (cleanDest != null) {
                append("destination '$cleanDest' ${if (destStat != null) "exists (size=${destStat.size})" else "not found"}; ")
            }
            append("Protocol cannot authoritatively prove operation identity without inode/opId confirmation. Local identity preserved in quarantine.")
        }
        return MutationReconciliationResult.Unresolved(op, statusDesc)
    }
}


sealed interface SaveReconciliationResult {
    data class Reconciled(val newMtime: Long) : SaveReconciliationResult
    data class Conflicted(val message: String) : SaveReconciliationResult
    data class Unresolved(val message: String) : SaveReconciliationResult
}

sealed interface MutationReconciliationResult {
    data class Reconciled(val op: String, val message: String) : MutationReconciliationResult
    data class Unresolved(val op: String, val message: String) : MutationReconciliationResult
}
