package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.crypto.computeSha256

/**
 * Validates structural invariants and partition bounds of Git blame responses.
 */
object BlameValidator {

    /**
     * Computes display line count preserving editor CRLF and LF layout conventions.
     * An empty string has 1 line; each newline delimiter increments line count.
     */
    fun computeBufferLineCount(content: String): Int {
        if (content.isEmpty()) return 1
        var lines = 1
        var i = 0
        while (i < content.length) {
            val c = content[i]
            if (c == '\r') {
                lines++
                if (i + 1 < content.length && content[i + 1] == '\n') i++
            } else if (c == '\n') {
                lines++
            }
            i++
        }
        return lines
    }

    /**
     * Checks if content UTF-8 byte length exceeds 5 MiB threshold.
     */
    fun isBufferOverLimit(content: String): Boolean {
        val bytes = content.encodeToByteArray()
        return bytes.size.toLong() > GIT_BLAME_MAX_BUFFER_BYTES
    }

    /**
     * Computes synchronous hex SHA-256 fingerprint of exact UTF-8 buffer bytes.
     */
    fun computeBufferFingerprint(content: String): String = computeSha256(content)

    sealed class ValidationResult {
        data class Valid(val response: GitBlameResponse) : ValidationResult()
        data class Invalid(val reason: String) : ValidationResult()
    }

    /**
     * Validates raw blame response against strict structural invariants:
     * - positive integral bounds without overflow
     * - contiguous, non-overlapping partition covering exactly 1..bufferLineCount
     * - echo matching of snapshotId and modelVersion
     * - valid commit references and status consistency
     */
    fun validateBlameResponse(
        response: GitBlameResponse,
        expectedSnapshotId: String? = null,
        expectedModelVersion: Long? = null,
        expectedBufferLineCount: Int? = null,
    ): ValidationResult {
        if (response.snapshotId.isBlank()) {
            return ValidationResult.Invalid("Missing or empty snapshotId")
        }
        if (expectedSnapshotId != null && response.snapshotId != expectedSnapshotId) {
            return ValidationResult.Invalid("Snapshot ID mismatch: expected $expectedSnapshotId, got ${response.snapshotId}")
        }
        if (response.modelVersion < 1L) {
            return ValidationResult.Invalid("Invalid modelVersion: ${response.modelVersion}")
        }
        if (expectedModelVersion != null && response.modelVersion != expectedModelVersion) {
            return ValidationResult.Invalid("Model version mismatch: expected $expectedModelVersion, got ${response.modelVersion}")
        }
        if (response.bufferLineCount < 1) {
            return ValidationResult.Invalid("Invalid bufferLineCount: ${response.bufferLineCount}")
        }
        if (expectedBufferLineCount != null && response.bufferLineCount != expectedBufferLineCount) {
            return ValidationResult.Invalid("Buffer line count mismatch: expected $expectedBufferLineCount, got ${response.bufferLineCount}")
        }

        val totalLines = response.bufferLineCount
        val ranges = response.ranges
        val numCommits = response.commits.size

        if (response.status == GitBlameStatus.EMPTY) {
            if (ranges.isEmpty()) return ValidationResult.Valid(response)
            if (ranges.size == 1) {
                val first = ranges[0]
                if (first.startLine == 1 && first.lineCount == 1 && first.commitIndex == null) {
                    return ValidationResult.Valid(response)
                }
            }
            return ValidationResult.Invalid("Empty status must have 0 ranges or 1 uncommitted single-line range")
        }

        if (ranges.isEmpty()) {
            return ValidationResult.Invalid("Non-empty blame status cannot have empty ranges")
        }

        var nextExpectedLine = 1
        for (i in ranges.indices) {
            val r = ranges[i]
            if (r.startLine < 1 || r.lineCount < 1) {
                return ValidationResult.Invalid("Non-positive range bounds at index $i: start=${r.startLine}, count=${r.lineCount}")
            }
            if (r.startLine != nextExpectedLine) {
                return ValidationResult.Invalid("Partition gap or overlap at index $i: expected line $nextExpectedLine, got ${r.startLine}")
            }
            val rangeEnd = r.startLine.toLong() + r.lineCount.toLong() - 1L
            if (rangeEnd > Int.MAX_VALUE) {
                return ValidationResult.Invalid("Range endpoint overflow at index $i")
            }
            if (r.commitIndex != null) {
                if (r.commitIndex < 0 || r.commitIndex >= numCommits) {
                    return ValidationResult.Invalid("Commit index ${r.commitIndex} out of bounds (0..${numCommits - 1}) at index $i")
                }
                if (response.status == GitBlameStatus.UNCOMMITTED) {
                    return ValidationResult.Invalid("Uncommitted status cannot contain committed range at index $i")
                }
            }
            nextExpectedLine = r.startLine + r.lineCount
        }

        if (nextExpectedLine - 1 != totalLines) {
            return ValidationResult.Invalid("Partition covers ${nextExpectedLine - 1} lines, but bufferLineCount is $totalLines")
        }

        if (response.status == GitBlameStatus.READY && ranges.none { it.commitIndex != null }) {
            return ValidationResult.Invalid("Ready status must contain at least one committed range")
        }

        return ValidationResult.Valid(response)
    }
}
