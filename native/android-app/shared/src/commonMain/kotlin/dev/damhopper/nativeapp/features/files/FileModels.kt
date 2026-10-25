package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.serialization.Serializable

/**
 * REST Directory entry DTO matching GET /api/fs/list.
 */
@Serializable
data class DirEntryDto(
    val name: String,
    val kind: String, // "file" | "dir"
    val size: ULong = 0uL,
    val mtime: Long = 0L,
    val isSymlink: Boolean = false,
)

/**
 * REST List response DTO for GET /api/fs/list.
 */
@Serializable
data class ListResponseDto(
    val entries: List<DirEntryDto> = emptyList(),
)

/**
 * One file of the bounded project language scan (GET /api/fs/language-files). [language] is the server's
 * family wire value (`rust`, `javascript-typescript`, `java`); [mtime] is Unix seconds like the other metadata.
 */
@Serializable
data class LanguageFileDto(
    val path: String,
    val size: ULong = 0uL,
    val mtime: Long = 0L,
    val language: String,
)

/**
 * Response of GET /api/fs/language-files. [truncated] means the server stopped at [limit] files, so the
 * family view is explicitly incomplete (never presented as the whole project).
 */
@Serializable
data class LanguageFilesResponse(
    val files: List<LanguageFileDto> = emptyList(),
    val truncated: Boolean = false,
    val limit: Long = 0L,
)

/**
 * REST Stat response DTO for GET /api/fs/stat.
 */
@Serializable
data class FileStatDto(
    val kind: String, // "file" | "dir"
    val size: ULong = 0uL,
    val mtime: Long = 0L,
    val mime: String? = null,
    val isBinary: Boolean = false,
)

/**
 * Result of reading a file via REST or WebSocket.
 */
data class FsFileReadResult(
    val ok: Boolean,
    val mime: String? = null,
    val isBinary: Boolean = false,
    val mtime: Long? = null,
    val size: ULong? = null,
    val textContent: String? = null,
    val binaryData: ByteArray? = null,
    val errorCode: String? = null,
)

/**
 * Node within the immutable file explorer tree hierarchy.
 */
data class FileTreeNode(
    val target: ProjectTargetRef,
    val path: String, // project-relative path ("" for root, or "src/main.kt")
    val name: String,
    val isDirectory: Boolean,
    val size: ULong = 0uL,
    val mtime: Long = 0L,
    val isSymlink: Boolean = false,
    val isExpanded: Boolean = false,
    val isLoading: Boolean = false,
    val children: List<FileTreeNode> = emptyList(),
    val error: String? = null,
) {
    val extension: String
        get() = if (isDirectory) "" else name.substringAfterLast('.', "")

    val isHidden: Boolean
        get() = name.startsWith('.') && name != "." && name != ".."
}

/**
 * Result of a mutating fs:op operation.
 */
data class FsOpOutcome(
    val ok: Boolean,
    val error: String? = null,
)
