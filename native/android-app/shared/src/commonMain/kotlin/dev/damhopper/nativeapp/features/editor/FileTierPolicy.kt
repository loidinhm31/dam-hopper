package dev.damhopper.nativeapp.features.editor

/**
 * File size and type tier classifications for editor capabilities and routing.
 *
 * Exact size thresholds:
 * - normal: < 1 MiB (1,048,576 bytes)
 * - degraded: >= 1 MiB and < 5 MiB (5,242,880 bytes)
 * - large/read-only: >= 5 MiB (viewed via 64 KiB range reads)
 * - binary: raw binary / hex preview
 * - image / video: media preview only
 * - diff: Git diff view
 */
enum class FileTier {
    NORMAL,
    DEGRADED,
    LARGE,
    BINARY,
    IMAGE,
    VIDEO,
    DIFF;

    val isEditable: Boolean
        get() = this == NORMAL || this == DEGRADED

    val isReadOnly: Boolean
        get() = this == LARGE || this == BINARY || this == IMAGE || this == VIDEO || this == DIFF
}

object FileTierPolicy {
    const val NORMAL_MAX_BYTES: Long = 1L * 1024L * 1024L // 1 MiB = 1,048,576 bytes
    const val DEGRADED_MAX_BYTES: Long = 5L * 1024L * 1024L // 5 MiB = 5,242,880 bytes
    const val LARGE_CHUNK_BYTES: Long = 64L * 1024L // 64 KiB = 65,536 bytes

    private val IMAGE_EXTENSIONS = setOf(
        "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"
    )

    private val VIDEO_EXTENSIONS = setOf(
        "mp4", "webm", "ogg", "mkv", "mov", "m4v"
    )

    private val MARKDOWN_EXTENSIONS = setOf(
        "md", "markdown", "mdown", "mkd"
    )

    private val HTML_EXTENSIONS = setOf(
        "html", "htm"
    )

    private val MERMAID_EXTENSIONS = setOf(
        "mmd", "mermaid"
    )

    fun fileExtension(filename: String): String {
        val dotIndex = filename.lastIndexOf('.')
        return if (dotIndex >= 0 && dotIndex < filename.length - 1) {
            filename.substring(dotIndex + 1).lowercase()
        } else {
            ""
        }
    }

    fun isImageFile(filename: String): Boolean =
        IMAGE_EXTENSIONS.contains(fileExtension(filename))

    fun isVideoFile(filename: String): Boolean =
        VIDEO_EXTENSIONS.contains(fileExtension(filename))

    fun isMarkdownFile(filename: String): Boolean =
        MARKDOWN_EXTENSIONS.contains(fileExtension(filename))

    fun isHtmlFile(filename: String): Boolean =
        HTML_EXTENSIONS.contains(fileExtension(filename))

    fun isMermaidFile(filename: String): Boolean =
        MERMAID_EXTENSIONS.contains(fileExtension(filename))

    /**
     * Preview-only files never enter editor byte reads or write paths.
     */
    fun isPreviewOnlyFile(tier: FileTier, filename: String): Boolean {
        return tier == FileTier.VIDEO ||
                tier == FileTier.IMAGE ||
                (tier != FileTier.DIFF && (isVideoFile(filename) || isImageFile(filename)))
    }

    /**
     * Determines the authoritative file tier based on file name, size in bytes, and binary status.
     * Precedence:
     * 1. Video / Image media files (preview only)
     * 2. Binary probe flag
     * 3. Size boundary: >= 5 MiB -> LARGE
     * 4. Size boundary: >= 1 MiB -> DEGRADED
     * 5. Default -> NORMAL
     */
    fun determineTier(filename: String, sizeBytes: Long, isBinary: Boolean): FileTier {
        if (isVideoFile(filename)) return FileTier.VIDEO
        if (isImageFile(filename)) return FileTier.IMAGE
        if (isBinary) return FileTier.BINARY
        if (sizeBytes >= DEGRADED_MAX_BYTES) return FileTier.LARGE
        if (sizeBytes >= NORMAL_MAX_BYTES) return FileTier.DEGRADED
        return FileTier.NORMAL
    }

    /**
     * Decodes a range chunk safely, discarding incomplete trailing UTF-8 multi-byte sequences
     * so that boundaries do not produce replacement character corruption.
     *
     * Returns the valid decoded string and the number of bytes that were safely decoded.
     */
    fun decodeUtf8Safe(bytes: ByteArray, length: Int = bytes.size): Pair<String, Int> {
        if (length <= 0) return Pair("", 0)
        var validLen = length

        // Check if the last byte(s) are part of an incomplete UTF-8 sequence
        var i = length - 1
        var leadByteIndex = -1
        while (i >= 0 && (length - 1 - i) < 4) {
            val b = bytes[i].toInt() and 0xFF
            if ((b and 0x80) == 0) {
                // 1-byte ASCII character
                break
            } else if ((b and 0xC0) == 0xC0) {
                // Lead byte found
                leadByteIndex = i
                break
            }
            i--
        }

        if (leadByteIndex >= 0) {
            val lead = bytes[leadByteIndex].toInt() and 0xFF
            val expectedTotal = when {
                (lead and 0xE0) == 0xC0 -> 2
                (lead and 0xF0) == 0xE0 -> 3
                (lead and 0xF8) == 0xF0 -> 4
                else -> 1
            }
            val actualTrailing = length - leadByteIndex
            if (actualTrailing < expectedTotal) {
                // Incomplete multi-byte sequence at tail; drop it from this chunk
                validLen = leadByteIndex
            }
        }

        val decoded = if (validLen > 0) {
            bytes.decodeToString(startIndex = 0, endIndex = validLen, throwOnInvalidSequence = false)
        } else {
            ""
        }
        return Pair(decoded, validLen)
    }
}
