package dev.damhopper.nativeapp.core.logging

/**
 * Redactor strips credentials, tokens, secrets, and auth queries from log strings and metadata.
 * Mirrors the sensitive redaction rules of web app's logger.ts.
 */
object Redactor {
    const val REDACTED = "[REDACTED]"
    const val MAX_STRING_LENGTH = 1000

    private val BEARER_PATTERN = Regex("(?i)(Bearer\\s+)[A-Za-z0-9._~+/=-]+")
    private val URL_TOKEN_PATTERN = Regex("(?i)([?&]token=)[^&\\s]+")
    private val KV_SECRET_PATTERN = Regex("(?i)(password|passphrase|api[-_]?key|secret|credential)=([^&\\s]+)")
    private val SENSITIVE_KEY_PATTERN = Regex("(?i)token|authorization|password|passwd|passphrase|api[-_]?key|secret|credential|private[-_]?key")

    /**
     * Redacts secret tokens, authorization headers, and credential query parameters from a string.
     */
    fun redactString(input: String?): String {
        if (input == null) return ""
        val truncated = if (input.length > MAX_STRING_LENGTH) {
            input.substring(0, MAX_STRING_LENGTH) + "…[TRUNCATED]"
        } else {
            input
        }

        return truncated
            .replace(BEARER_PATTERN, "$1$REDACTED")
            .replace(URL_TOKEN_PATTERN, "$1$REDACTED")
            .replace(KV_SECRET_PATTERN, "$1=$REDACTED")
    }

    /**
     * Redacts a metadata map: replaces values of sensitive keys with [REDACTED],
     * and scrubs secret patterns from all string values.
     */
    fun redactMetadata(metadata: Map<String, String>?): Map<String, String>? {
        if (metadata == null) return null
        val result = mutableMapOf<String, String>()
        for ((key, value) in metadata) {
            if (SENSITIVE_KEY_PATTERN.containsMatchIn(key)) {
                result[key] = REDACTED
            } else {
                result[key] = redactString(value)
            }
        }
        return result
    }

    /**
     * Redacts throwable details (message and stack).
     */
    fun redactThrowable(t: Throwable?): String? {
        if (t == null) return null
        val name = t::class.simpleName ?: "Throwable"
        val msg = redactString(t.message ?: "")
        return "$name: $msg"
    }
}
