@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.files.FileRepository
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Helper for tier-based file reading (large range, binary, full text).
 */
class EditorContentLoader(private val fileRepository: FileRepository) {

    suspend fun loadLargeRange(
        target: ProjectTargetRef,
        path: String,
        offset: Long,
        totalSize: Long,
        mtime: Long,
    ): EditorLoadResult {
        val chunkBytes = FileTierPolicy.LARGE_CHUNK_BYTES.toULong()
        val readResult = fileRepository.readFile(target, path, offset = offset.toULong(), len = chunkBytes)
        if (!readResult.ok) {
            return EditorLoadResult.Error(readResult.errorCode ?: "Range read failed")
        }

        val rawBytes = readResult.binaryData ?: readResult.textContent?.encodeToByteArray() ?: byteArrayOf()
        val (decodedText, validLen) = FileTierPolicy.decodeUtf8Safe(rawBytes)
        val isEof = (offset + validLen.toLong()) >= totalSize || rawBytes.isEmpty()

        return EditorLoadResult.Success(
            content = decodedText,
            mtime = readResult.mtime?.toLong() ?: mtime,
            size = totalSize,
            tier = FileTier.LARGE,
            mime = readResult.mime,
            isBinary = false,
            isEof = isEof,
            bytesRead = validLen,
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
        val readResult = fileRepository.readFile(target, path)
        if (!readResult.ok) return EditorLoadResult.Error(readResult.errorCode ?: "Read failed")
        return EditorLoadResult.Success(
            content = readResult.textContent ?: "",
            mtime = readResult.mtime?.toLong() ?: mtime,
            size = size,
            tier = tier,
            mime = readResult.mime,
            isBinary = false,
            isEof = true,
        )
    }
}
