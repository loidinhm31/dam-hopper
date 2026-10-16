package dev.damhopper.nativeapp.features.profiles

import kotlinx.serialization.Serializable

/**
 * Normalized and validated server profile metadata.
 * Persisted in non-secret storage. Auth tokens are stored exclusively in CredentialVault.
 */
@Serializable
data class ServerProfile(
    val id: String,
    val name: String,
    val baseUrl: String,
    val username: String? = null,
    val activeProjectId: String? = null,
) {
    init {
        require(id.isNotBlank()) { "Profile ID cannot be blank" }
        require(name.isNotBlank()) { "Profile name cannot be blank" }
        validateServerUrl(baseUrl).getOrThrow()
    }

    /**
     * Normalized base URL guaranteed to have no trailing slash.
     */
    val normalizedUrl: String get() = normalizeUrl(baseUrl)

    companion object {
        fun normalizeUrl(raw: String): String =
            raw.trim().trimEnd('/')

        /**
         * Validates server URL structure:
         * - Must be http:// or https://
         * - Must not contain credentials (user:pass@)
         * - Must not contain query parameters (?) or fragments (#)
         * - Must have non-empty host
         */
        fun validateServerUrl(raw: String): Result<String> {
            val trimmed = raw.trim()
            if (trimmed.isBlank()) {
                return Result.failure(IllegalArgumentException("Server URL cannot be blank"))
            }

            val scheme = when {
                trimmed.startsWith("https://", ignoreCase = true) -> "https"
                trimmed.startsWith("http://", ignoreCase = true) -> "http"
                else -> return Result.failure(
                    IllegalArgumentException("Server URL must begin with http:// or https://")
                )
            }

            val withoutScheme = trimmed.substring(scheme.length + 3)
            if (withoutScheme.isBlank()) {
                return Result.failure(IllegalArgumentException("Server URL missing host"))
            }

            if (withoutScheme.contains("@")) {
                return Result.failure(IllegalArgumentException("Server URL cannot contain credentials in authority"))
            }

            if (withoutScheme.contains("?")) {
                return Result.failure(IllegalArgumentException("Server URL cannot contain query parameters"))
            }

            if (withoutScheme.contains("#")) {
                return Result.failure(IllegalArgumentException("Server URL cannot contain fragment identifier"))
            }

            val hostPort = withoutScheme.trimEnd('/').split('/')[0]
            val host = hostPort.split(':')[0]
            if (host.isBlank()) {
                return Result.failure(IllegalArgumentException("Server URL has empty host"))
            }

            return Result.success(normalizeUrl(trimmed))
        }

        /**
         * Checks whether a host is a local loopback address permitted for cleartext development.
         */
        fun isLoopbackHost(host: String): Boolean {
            val cleanHost = host.lowercase().trim().removePrefix("[").removeSuffix("]")
            return cleanHost == "localhost" ||
                    cleanHost == "127.0.0.1" ||
                    cleanHost == "::1" ||
                    cleanHost == "10.0.2.2" // Android emulator loopback host
        }

        fun generateId(): String {
            val chars = "0123456789abcdef"
            return (1..16).map { chars.random() }.joinToString("")
        }
    }
}
