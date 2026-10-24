package dev.damhopper.nativeapp.features.profiles

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * In-memory thread-safe implementation of CredentialVault.
 * Used for unit testing and platforms without native hardware keystores.
 * Supports simulating key invalidation / corruption to verify fail-closed recovery paths.
 */
class InMemoryCredentialVault : CredentialVault {
    private val mutex = Mutex()
    private val store = mutableMapOf<String, String>()

    /**
     * When true, any read or write throws VaultKeyInvalidatedException to verify
     * fail-closed handling in repositories and UI.
     */
    var simulateKeyInvalidation: Boolean = false

    override suspend fun storeToken(profileId: String, baseUrl: String, token: String) {
        checkKeyValidity()
        require(token.isNotBlank()) { "Cannot store blank token in vault" }
        val key = CredentialVault.makeKey(profileId, baseUrl)
        mutex.withLock {
            store[key] = token
        }
    }

    override suspend fun getToken(profileId: String, baseUrl: String): String? {
        checkKeyValidity()
        val key = CredentialVault.makeKey(profileId, baseUrl)
        return mutex.withLock {
            store[key]
        }
    }

    override suspend fun clearToken(profileId: String, baseUrl: String) {
        checkKeyValidity()
        val key = CredentialVault.makeKey(profileId, baseUrl)
        mutex.withLock {
            store.remove(key)
        }
    }

    override suspend fun clearAllForProfile(profileId: String) {
        checkKeyValidity()
        val prefix = "token:${profileId.trim()}:"
        mutex.withLock {
            val toRemove = store.keys.filter { it.startsWith(prefix) }
            for (key in toRemove) {
                store.remove(key)
            }
        }
    }

    override suspend fun clearAll() {
        checkKeyValidity()
        mutex.withLock {
            store.clear()
        }
    }

    private fun checkKeyValidity() {
        if (simulateKeyInvalidation) {
            throw VaultKeyInvalidatedException(
                "Keystore master key was permanently invalidated (simulated)"
            )
        }
    }
}
