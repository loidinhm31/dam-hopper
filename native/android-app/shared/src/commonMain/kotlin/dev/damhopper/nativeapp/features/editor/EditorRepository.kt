package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.files.FileOperationOutcome
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.workspace.DocumentId
import kotlinx.coroutines.CancellationException

/**
 * Handles target-bound file loads, safe CAS saves, 64 KiB large-file range reads,
 * and guarded force-overwrite operations for the native editor.
 * Implements [EditorRangeRequestPort] and [EditorSavePort].
 */
class EditorRepository(
    val fileRepository: FileRepository,
    val connectionRegistry: ConnectionRegistry? = null,
    val profileId: String = "",
    val cryptoSessionProvider: (() -> dev.damhopper.nativeapp.core.security.CryptoSession?)? = null,
) : EditorRangeRequestPort, EditorSavePort {

    var documentProvider: ((DocumentId) -> EditorDocument?)? = null
    private val contentLoader = EditorContentLoader(fileRepository)
    val encryptedSaveCoordinator: EncryptedSaveCoordinator = EncryptedSaveCoordinator(
        fileRepository.wsConnection,
        dev.damhopper.nativeapp.features.files.TransferCoordinator(fileRepository.wsConnection, { fileRepository.wsConnection.nextReqId() }),
        { fileRepository.wsConnection.nextReqId() },
    )

    suspend fun loadFile(
        target: ProjectTargetRef,
        path: String,
        offset: Long = 0L,
    ): EditorLoadResult {
        try {
            val stat = fileRepository.stat(target, path)
            val size = stat.size.toLong()
            var tier = FileTierPolicy.determineTier(path, size, stat.isBinary)

            if (FileTierPolicy.isPreviewOnlyFile(tier, path)) {
                return EditorLoadResult.Success(
                    content = "", mtime = stat.mtime.toLong(), size = size,
                    tier = tier, mime = stat.mime, isBinary = stat.isBinary, isEof = true
                )
            }
            return when (tier) {
                FileTier.LARGE -> contentLoader.loadLargeRange(target, path, offset, size, stat.mtime.toLong())
                FileTier.BINARY -> contentLoader.loadBinaryFile(target, path, size, stat.mtime.toLong())
                FileTier.NORMAL, FileTier.DEGRADED, FileTier.DIFF ->
                    loadEditableText(target, path, size, tier, stat.mtime.toLong())
                else -> EditorLoadResult.Error("Unsupported tier $tier for $path")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            val msg = e.message ?: "Failed to read file $path"
            if (isProjectTargetError(msg)) return EditorLoadResult.TargetUnavailable(msg)
            return EditorLoadResult.Error(msg)
        }
    }

    /**
     * Single completeness gate for every editable read, including retries: a result whose received
     * bytes saturate the tier cap (or whose wire body exceeded it) is never published as editable.
     * Tiers only ever escalate NORMAL -> DEGRADED -> LARGE (read-only 64 KiB range).
     */
    private suspend fun loadEditableText(
        target: ProjectTargetRef,
        path: String,
        initialSize: Long,
        initialTier: FileTier,
        mtime: Long,
    ): EditorLoadResult {
        var tier = initialTier
        var size = initialSize
        while (true) {
            val cap = if (tier == FileTier.NORMAL) FileTierPolicy.NORMAL_MAX_BYTES else FileTierPolicy.DEGRADED_MAX_BYTES
            val res = contentLoader.loadFullText(target, path, size, tier, mtime)
            val saturated = when (res) {
                is EditorLoadResult.Success -> res.bytesRead.toLong() >= cap
                is EditorLoadResult.Error -> res.message.contains("exceeded", ignoreCase = true)
                else -> false
            }
            if (!saturated) return res
            if (tier == FileTier.NORMAL) {
                tier = FileTier.DEGRADED
                size = maxOf(size, cap)
            } else {
                val restat = fileRepository.stat(target, path)
                return contentLoader.loadLargeRange(target, path, 0L, restat.size.toLong(), restat.mtime.toLong())
            }
        }
    }

    override suspend fun requestRangeWindow(id: DocumentId, offset: Long, limitBytes: Int): BoundedRangeWindow {
        val target = ProjectTargetRef(project = id.owner.project, worktreePath = id.owner.worktreePath)
        val stat = fileRepository.stat(target, id.relativePath)
        val res = contentLoader.loadLargeRange(
            target = target,
            path = id.relativePath,
            offset = offset,
            totalSize = stat.size.toLong(),
            mtime = stat.mtime.toLong(),
            limitBytes = limitBytes
        )
        if (res is EditorLoadResult.Success && res.rangeWindow != null) {
            return res.rangeWindow
        }
        throw IllegalStateException((res as? EditorLoadResult.Error)?.message ?: "Failed to read range window")
    }

    /** Returns a denial reason when the document must not be saved (tier, availability, privacy, in-flight). */
    var saveGate: ((DocumentId) -> String?)? = null

    override suspend fun saveDocument(id: DocumentId, explicitOverwrite: Boolean): FileOperationOutcome<Long> {
        val target = ProjectTargetRef(project = id.owner.project, worktreePath = id.owner.worktreePath)
        val doc = documentProvider?.invoke(id)
            ?: return FileOperationOutcome.NotSubmitted("No document found for $id")
        if (doc.isReadOnly.value) return FileOperationOutcome.NotSubmitted("Document is read-only")
        val gate = saveGate ?: return FileOperationOutcome.NotSubmitted("No save eligibility gate installed")
        gate(id)?.let { return FileOperationOutcome.NotSubmitted(it) }
        val effectiveOwner = dev.damhopper.nativeapp.features.files.FileWatchCoordinator.resolveEffectiveOwner(fileRepository.owner, target)
        val acquiredToken = fileRepository.arbiter.tryReserveSave(effectiveOwner, id.relativePath)
            ?: return FileOperationOutcome.NotSubmitted("Path '${id.relativePath}' is currently reserved by another file operation")

        try {
            val snapshot = doc.snapshotForSave()
            val content = snapshot.utf8Bytes.decodeToString()
            val expectedMtime = if (explicitOverwrite) {
                try {
                    fileRepository.stat(target, id.relativePath).mtime.toLong()
                } catch (e: Throwable) {
                    return FileOperationOutcome.NotSubmitted("Failed to stat file for overwrite: ${e.message}", e)
                }
            } else {
                snapshot.mtime
            }

            val outcome = fileRepository.writeFileWithOutcome(
                target = target,
                relativePath = id.relativePath,
                content = content,
                expectedMtime = expectedMtime,
                reservationToken = acquiredToken,
                submittedRevision = snapshot.revision,
                tabIncarnation = id.tabIncarnation,
            )

            return when (outcome) {
                is FileOperationOutcome.Confirmed -> {
                    val confirmedMtime = outcome.result.newMtime ?: expectedMtime
                    doc.markSaved(snapshot.revision, confirmedMtime)
                    FileOperationOutcome.Confirmed(confirmedMtime)
                }
                is FileOperationOutcome.Rejected -> FileOperationOutcome.Rejected(outcome.code, outcome.message, outcome.details)
                is FileOperationOutcome.Unknown -> FileOperationOutcome.Unknown(outcome.stage, outcome.opId, outcome.message, outcome.cause)
                is FileOperationOutcome.NotSubmitted -> FileOperationOutcome.NotSubmitted(outcome.reason, outcome.cause)
            }
        } finally {
            if (acquiredToken.state == dev.damhopper.nativeapp.features.files.ReservationState.ACTIVE) {
                try {
                    fileRepository.arbiter.releaseToken(acquiredToken)
                } catch (_: Throwable) {}
            }
        }
    }

    suspend fun saveFile(
        target: ProjectTargetRef,
        path: String,
        submittedContent: String,
        expectedMtime: Long,
        encryptedRequested: Boolean = false,
        reservationToken: dev.damhopper.nativeapp.features.files.ReservationToken? = null,
        submittedRevision: Long? = null,
        tabIncarnation: Long? = null,
    ): EditorSaveResult {
        if (encryptedRequested) {
            val session = cryptoSessionProvider?.invoke()
                ?: return EditorSaveResult.Error("Encrypted save requires Phase 11 owner-bound crypto session (none available)")
            val expectedOwner = connectionRegistry?.getCurrentConnection(profileId)
            return encryptedSaveCoordinator.saveEncrypted(target, path, submittedContent, expectedMtime, session, expectedOwner = expectedOwner)
        }

        val outcome = fileRepository.writeFileWithOutcome(
            target = target,
            relativePath = path,
            content = submittedContent,
            expectedMtime = expectedMtime,
            reservationToken = reservationToken,
            submittedRevision = submittedRevision,
            tabIncarnation = tabIncarnation,
        )
        return when (outcome) {
            is FileOperationOutcome.Confirmed -> {
                EditorSaveResult.Success(outcome.result.newMtime ?: expectedMtime)
            }
            is FileOperationOutcome.Rejected -> {
                if (outcome.code == "CAS_CONFLICT") {
                    EditorSaveResult.Conflict(
                        serverMtime = null,
                        message = outcome.message,
                    )
                } else {
                    if (isProjectTargetError(outcome.message)) {
                        EditorSaveResult.TargetUnavailable(outcome.message)
                    } else {
                        EditorSaveResult.Error(outcome.message)
                    }
                }
            }
            is FileOperationOutcome.Unknown -> {
                EditorSaveResult.UnknownOutcome(
                    "Save outcome unknown: ${outcome.message}. Check server state before retrying."
                )
            }
            is FileOperationOutcome.NotSubmitted -> {
                if (isProjectTargetError(outcome.reason)) {
                    EditorSaveResult.TargetUnavailable(outcome.reason)
                } else {
                    EditorSaveResult.Error(outcome.reason)
                }
            }
        }
    }

    suspend fun forceOverwrite(
        target: ProjectTargetRef,
        path: String,
        submittedContent: String,
        encryptedRequested: Boolean = false,
        reservationToken: dev.damhopper.nativeapp.features.files.ReservationToken? = null,
    ): EditorSaveResult {
        if (encryptedRequested) {
            val session = cryptoSessionProvider?.invoke()
                ?: return EditorSaveResult.Error("Encrypted overwrite requires Phase 11 owner-bound crypto session (none available)")
            val expectedOwner = connectionRegistry?.getCurrentConnection(profileId)
            return encryptedSaveCoordinator.forceOverwriteEncrypted(target, path, submittedContent, session, expectedOwner = expectedOwner)
        }
        return try {
            val freshStat = fileRepository.stat(target, path)
            saveFile(
                target = target,
                path = path,
                submittedContent = submittedContent,
                expectedMtime = freshStat.mtime.toLong(),
                encryptedRequested = encryptedRequested,
                reservationToken = reservationToken,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            val msg = e.message ?: "Force overwrite failed to stat file"
            if (isProjectTargetError(msg)) EditorSaveResult.TargetUnavailable(msg) else EditorSaveResult.Error(msg)
        }
    }
}
