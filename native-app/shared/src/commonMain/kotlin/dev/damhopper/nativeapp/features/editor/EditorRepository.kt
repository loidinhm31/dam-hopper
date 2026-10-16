package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.files.FileRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException

/**
 * Handles target-bound file loads, safe CAS saves, 64 KiB large-file range reads,
 * and guarded force-overwrite operations for the native editor.
 */
class EditorRepository(
    val fileRepository: FileRepository,
    val connectionRegistry: ConnectionRegistry? = null,
    val profileId: String = "",
    val cryptoSessionProvider: (() -> dev.damhopper.nativeapp.core.security.CryptoSession?)? = null,
) {
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
            val tier = FileTierPolicy.determineTier(path, size, stat.isBinary)

            if (FileTierPolicy.isPreviewOnlyFile(tier, path)) {
                return EditorLoadResult.Success(
                    content = "", mtime = stat.mtime.toLong(), size = size,
                    tier = tier, mime = stat.mime, isBinary = stat.isBinary, isEof = true
                )
            }

            return when (tier) {
                FileTier.LARGE -> contentLoader.loadLargeRange(target, path, offset, size, stat.mtime.toLong())
                FileTier.BINARY -> contentLoader.loadBinaryFile(target, path, size, stat.mtime.toLong())
                FileTier.NORMAL, FileTier.DEGRADED, FileTier.DIFF -> contentLoader.loadFullText(target, path, size, tier, stat.mtime.toLong())
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

    suspend fun saveFile(
        target: ProjectTargetRef,
        path: String,
        submittedContent: String,
        expectedMtime: Long,
        encryptedRequested: Boolean = false,
    ): EditorSaveResult {
        if (encryptedRequested) {
            val session = cryptoSessionProvider?.invoke()
                ?: return EditorSaveResult.Error("Encrypted save requires Phase 11 owner-bound crypto session (none available)")
            val expectedOwner = connectionRegistry?.getCurrentConnection(profileId)
            return encryptedSaveCoordinator.saveEncrypted(target, path, submittedContent, expectedMtime, session, expectedOwner = expectedOwner)
        }

        try {
            val writeResult = fileRepository.writeFile(
                target = target,
                relativePath = path,
                content = submittedContent,
                expectedMtime = expectedMtime,
            )

            if (writeResult.ok) {
                return EditorSaveResult.Success(writeResult.newMtime ?: expectedMtime)
            } else if (writeResult.conflict) {
                return EditorSaveResult.Conflict(
                    serverMtime = null,
                    message = writeResult.error ?: "File modified on server"
                )
            } else {
                val err = writeResult.error ?: "Save failed"
                if (isProjectTargetError(err)) return EditorSaveResult.TargetUnavailable(err)
                return EditorSaveResult.Error(err)
            }
        } catch (e: TimeoutCancellationException) {
            return EditorSaveResult.UnknownOutcome(
                "Save outcome unknown: timeout occurred after commit transmission. Check server state before retrying."
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            val msg = e.message ?: "Save error"
            if (isProjectTargetError(msg)) return EditorSaveResult.TargetUnavailable(msg)
            return EditorSaveResult.Error(msg)
        }
    }

    suspend fun forceOverwrite(
        target: ProjectTargetRef,
        path: String,
        submittedContent: String,
        encryptedRequested: Boolean = false,
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
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            val msg = e.message ?: "Force overwrite failed to stat file"
            if (isProjectTargetError(msg)) EditorSaveResult.TargetUnavailable(msg) else EditorSaveResult.Error(msg)
        }
    }
}
