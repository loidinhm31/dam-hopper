package dev.damhopper.nativeapp.features.profiles

/**
 * Thrown when the cryptographic key or underlying vault storage has been invalidated,
 * corrupted, or cannot be accessed (e.g. Android Keystore key permanently invalidated).
 * The caller MUST NOT fall back to plaintext; it must fail-closed and prompt explicit re-authentication.
 */
class VaultKeyInvalidatedException(
    message: String,
    cause: Throwable? = null
) : RuntimeException(message, cause)

/**
 * Contract for secure credential custody.
 *
 * Implements strict security invariants:
 * - Credentials are bound to both profileId and normalized baseUrl.
 * - Key failure/invalidation causes explicit fail-closed exceptions, never plaintext fallback.
 * - Passwords, challenges, and TOTP secrets must NEVER be written to the vault.
 */
interface CredentialVault {
    suspend fun storeToken(profileId: String, baseUrl: String, token: String)
    suspend fun getToken(profileId: String, baseUrl: String): String?
    suspend fun clearToken(profileId: String, baseUrl: String)
    suspend fun clearAllForProfile(profileId: String)
    suspend fun clearAll()

    companion object {
        fun makeKey(profileId: String, baseUrl: String): String =
            "token:${profileId.trim()}:${ServerProfile.normalizeUrl(baseUrl)}"
    }
}
