@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.files.FileRepository
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Helper for tier-based file reading (large range, binary, full text).
 * Guarantees bounded reads and never produces empty editable replacement on invalid UTF-8.
 */
class EditorContentLoader(private val fileRepository: FileRepository) {

    suspend fun loadLargeRange(
        target: ProjectTargetRef,
        path: String,
        offset: Long,
        totalSize: Long,
        mtime: Long,
        limitBytes: Int = FileTierPolicy.LARGE_CHUNK_BYTES.toInt(),
    ): EditorLoadResult {
        val clampedLimit = limitBytes.coerceIn(1, FileTierPolicy.LARGE_CHUNK_BYTES.toInt())
        val readResult = fileRepository.readFile(target, path, offset = offset.toULong(), len = clampedLimit.toULong())
        if (!readResult.ok) {
            return EditorLoadResult.Error(readResult.errorCode ?: "Range read failed")
        }

        val rawBytes = readResult.binaryData ?: readResult.textContent?.encodeToByteArray() ?: byteArrayOf()
        val (decodedText, validLen) = FileTierPolicy.decodeUtf8Safe(rawBytes)
        val isEof = (offset + validLen.toLong()) >= totalSize || rawBytes.isEmpty()

        val rangeWindow = BoundedRangeWindow(
            offset = offset,
            requestedBytes = clampedLimit,
            receivedBytes = validLen,
            text = decodedText,
            isEof = isEof,
            epoch = mtime
        )

        return EditorLoadResult.Success(
            content = decodedText,
            mtime = readResult.mtime?.toLong() ?: mtime,
            size = totalSize,
            tier = FileTier.LARGE,
            mime = readResult.mime,
            isBinary = false,
            isEof = isEof,
            bytesRead = validLen,
            rangeWindow = rangeWindow,
        )
    }

    suspend fun loadBinaryFile(target: ProjectTargetRef, path: String, size: Long, mtime: Long): EditorLoadResult {
        val readResult = fileRepository.readFile(target, path)
        if (!readResult.ok) return EditorLoadResult.Error(readResult.errorCode ?: "Binary read failed")
        val b64 = readResult.binaryData?.let { Base64.encode(it) }
        return EditorLoadResult.Success(
            content = "",
            mtime = readResult.mtime?.toLong() ?: mtime,
            size = size,
            tier = FileTier.BINARY,
            mime = readResult.mime,
            isBinary = true,
            binaryBase64 = b64,
            isEof = true,
        )
    }

    suspend fun loadFullText(target: ProjectTargetRef, path: String, size: Long, tier: FileTier, mtime: Long): EditorLoadResult {
        // Enforce max bounds on wire read
        val maxReadBytes = when (tier) {
            FileTier.NORMAL -> FileTierPolicy.NORMAL_MAX_BYTES.toULong()
            FileTier.DEGRADED -> FileTierPolicy.DEGRADED_MAX_BYTES.toULong()
            else -> FileTierPolicy.DEGRADED_MAX_BYTES.toULong()
        }
        val readResult = fileRepository.readFile(target, path, offset = 0uL, len = maxReadBytes)
        if (!readResult.ok) return EditorLoadResult.Error(readResult.errorCode ?: "Read failed")
        if (readResult.isBinary || readResult.textContent == null) {
            return EditorLoadResult.Error("File contains invalid UTF-8 or binary characters and cannot be opened as editable text")
        }
        return EditorLoadResult.Success(
            content = readResult.textContent,
            mtime = readResult.mtime?.toLong() ?: mtime,
            size = size,
            tier = tier,
            mime = readResult.mime,
            isBinary = false,
            isEof = true,
            bytesRead = readResult.textContent.encodeToByteArray().size,
        )
    }
}
