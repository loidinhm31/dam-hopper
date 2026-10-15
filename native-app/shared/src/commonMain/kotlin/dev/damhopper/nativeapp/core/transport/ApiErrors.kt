package dev.damhopper.nativeapp.core.transport

import kotlinx.serialization.Serializable

/**
 * Standard typed API request error.
 */
class ApiRequestError(
    message: String,
    val status: Int,
    val code: String? = null,
    val retryAfterSeconds: Long? = null,
    val details: String? = null,
    cause: Throwable? = null,
) : RuntimeException(message, cause) {
    override fun toString(): String =
        "ApiRequestError(status=$status, code=$code, retryAfterSeconds=$retryAfterSeconds, message='$message')"
}

@Serializable
data class HealthResponse(
    val status: String,
    val version: String? = null,
)

@Serializable
data class AuthStatusResponse(
    val authenticated: Boolean,
    val user: String? = null,
    val devMode: Boolean = false,
)

/**
 * Sanitizes URLs to redact sensitive query parameters (e.g. token) and user-info passwords.
 */
fun redactUrl(url: String): String {
    var sanitized = url
    // Redact query token: token=xxx
    sanitized = sanitized.replace(Regex("([?&]token=)[^&]+", RegexOption.IGNORE_CASE), "$1[REDACTED]")
    // Redact password in user:password@host across http, https, ws, wss
    sanitized = sanitized.replace(Regex("((?:https?|wss?)://[^:/@]+:)[^@]+(@)", RegexOption.IGNORE_CASE), "$1[REDACTED]$2")
    return sanitized
}
