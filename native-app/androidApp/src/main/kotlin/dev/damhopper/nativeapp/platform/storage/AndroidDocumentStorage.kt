package dev.damhopper.nativeapp.platform.storage

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream

data class DocumentDescriptor(
    val name: String,
    val size: Long,
    val mimeType: String,
)

interface DocumentStorage {
    suspend fun queryMetadata(uri: Uri): DocumentDescriptor
    suspend fun readBytes(uri: Uri, maxBytes: Long = MAX_DOCUMENT_BYTES): ByteArray
    suspend fun writeBytes(uri: Uri, bytes: ByteArray)
    suspend fun streamFromUri(
        uri: Uri,
        chunkSize: Int = DEFAULT_CHUNK_SIZE,
        maxBytes: Long = MAX_DOCUMENT_BYTES,
        onChunk: suspend (chunk: ByteArray, isLast: Boolean) -> Unit
    )
    suspend fun streamToUri(
        uri: Uri,
        provider: suspend (outputStream: OutputStream) -> Unit
    )

    companion object {
        const val MAX_DOCUMENT_BYTES: Long = 100 * 1024 * 1024 // 100 MiB
        const val DEFAULT_CHUNK_SIZE: Int = 64 * 1024 // 64 KiB
    }
}

class DocumentStorageException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/**
 * Android Storage Access Framework (SAF) document storage implementation.
 * Operates on scoped content URIs without requiring broad external storage permissions.
 */
class AndroidDocumentStorage(
    private val contentResolver: ContentResolver,
) : DocumentStorage {

    override suspend fun queryMetadata(uri: Uri): DocumentDescriptor = withContext(Dispatchers.IO) {
        var name = "unnamed_file"
        var size: Long = -1L
        val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        val rawName = cursor.getString(nameIdx)
                        if (!rawName.isNullOrBlank()) {
                            name = sanitizeFilename(rawName)
                        }
                    }

                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        size = cursor.getLong(sizeIdx)
                    }
                }
            }
        } catch (e: Exception) {
            // Fallback to last path segment if query fails
            uri.lastPathSegment?.let { segment ->
                name = sanitizeFilename(segment)
            }
        }

        DocumentDescriptor(name = name, size = size, mimeType = mimeType)
    }

    override suspend fun readBytes(uri: Uri, maxBytes: Long): ByteArray = withContext(Dispatchers.IO) {
        val stream: InputStream = contentResolver.openInputStream(uri)
            ?: throw DocumentStorageException("Unable to open input stream for URI: $uri")

        stream.use { input ->
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(DocumentStorage.DEFAULT_CHUNK_SIZE)
            var totalRead = 0L

            while (true) {
                val read = input.read(chunk)
                if (read < 0) break
                totalRead += read
                if (totalRead > maxBytes) {
                    throw DocumentStorageException("File exceeds maximum allowed size of $maxBytes bytes")
                }
                buffer.write(chunk, 0, read)
            }

            buffer.toByteArray()
        }
    }

    override suspend fun writeBytes(uri: Uri, bytes: ByteArray): Unit = withContext(Dispatchers.IO) {
        val stream: OutputStream = contentResolver.openOutputStream(uri, "wt")
            ?: throw DocumentStorageException("Unable to open output stream for URI: $uri")

        try {
            stream.use { output ->
                output.write(bytes)
                output.flush()
            }
        } catch (e: Exception) {
            throw DocumentStorageException("Failed to write to URI: $uri", e)
        }
    }

    override suspend fun streamFromUri(
        uri: Uri,
        chunkSize: Int,
        maxBytes: Long,
        onChunk: suspend (chunk: ByteArray, isLast: Boolean) -> Unit
    ): Unit = withContext(Dispatchers.IO) {
        val stream: InputStream = contentResolver.openInputStream(uri)
            ?: throw DocumentStorageException("Unable to open input stream for URI: $uri")

        stream.use { input ->
            val chunk = ByteArray(chunkSize)
            var totalRead = 0L

            var bytesInChunk = input.read(chunk)
            if (bytesInChunk < 0) {
                onChunk(ByteArray(0), true)
                return@use
            }

            while (bytesInChunk >= 0) {
                totalRead += bytesInChunk
                if (totalRead > maxBytes) {
                    throw DocumentStorageException("File stream exceeds maximum allowed size of $maxBytes bytes")
                }

                val currentBytes = if (bytesInChunk == chunk.size) chunk.copyOf() else chunk.copyOf(bytesInChunk)
                val nextRead = input.read(chunk)
                val isLast = nextRead < 0

                onChunk(currentBytes, isLast)
                bytesInChunk = nextRead
            }
        }
    }

    override suspend fun streamToUri(
        uri: Uri,
        provider: suspend (outputStream: OutputStream) -> Unit
    ): Unit = withContext(Dispatchers.IO) {
        val stream: OutputStream = contentResolver.openOutputStream(uri, "wt")
            ?: throw DocumentStorageException("Unable to open output stream for URI: $uri")

        try {
            stream.use { output ->
                provider(output)
                output.flush()
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            throw DocumentStorageException("Failed to stream to URI: $uri", e)
        }
    }

    companion object {
        fun sanitizeFilename(raw: String): String {
            val trimmed = raw.trim()
            val withoutPath = trimmed.substringAfterLast('/').substringAfterLast('\\')
            val noTraversal = withoutPath.replace("..", "_")
            val sanitized = noTraversal.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1F]"), "_")
            return sanitized.ifBlank { "unnamed_file" }
        }
    }
}
