package dev.damhopper.nativeapp.features.editor

/**
 * Result types for editor save operations.
 */
sealed class EditorSaveResult {
    data class Success(val newMtime: Long) : EditorSaveResult()
    data class Conflict(val serverMtime: Long?, val message: String) : EditorSaveResult()
    data class TargetUnavailable(val message: String) : EditorSaveResult()
    data class UnknownOutcome(val message: String) : EditorSaveResult()
    data class Error(val message: String, val code: String? = null) : EditorSaveResult()
}

/**
 * Result types for editor load/read operations.
 */
sealed class EditorLoadResult {
    data class Success(
        val content: String,
        val mtime: Long?,
        val size: Long,
        val tier: FileTier,
        val mime: String? = null,
        val isBinary: Boolean = false,
        val binaryBase64: String? = null,
        val isEof: Boolean = true,
        val bytesRead: Int = 0,
        val rangeWindow: BoundedRangeWindow? = null,
    ) : EditorLoadResult()

    data class TargetUnavailable(val message: String) : EditorLoadResult()
    data class Error(val message: String, val code: String? = null, val opId: String? = null) : EditorLoadResult()
}

private val PROJECT_TARGET_ERROR_CODES = listOf(
    "WORKSPACE_PROJECT_NOT_FOUND",
    "WORKSPACE_TARGET_UNREGISTERED",
    "WORKSPACE_TARGET_UNAVAILABLE",
    "WORKSPACE_TARGET_INVALID_PATH",
)

/** Returns true when an API error value indicates the project target is unavailable. */
fun isProjectTargetError(vararg values: String?): Boolean {
    val text = values.filterNotNull().joinToString(" ").uppercase()
    return PROJECT_TARGET_ERROR_CODES.any { text.contains(it) } ||
            ((text.contains("TARGET") || text.contains("WORKTREE")) &&
                    (text.contains("UNAVAILABLE") || text.contains("UNREGISTERED") || text.contains("INVALID_PATH")))
}
