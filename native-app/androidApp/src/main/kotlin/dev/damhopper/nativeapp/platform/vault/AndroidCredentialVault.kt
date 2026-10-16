package dev.damhopper.nativeapp.platform.vault

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dev.damhopper.nativeapp.features.profiles.CredentialVault
import dev.damhopper.nativeapp.features.profiles.VaultKeyInvalidatedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.GeneralSecurityException

/**
 * Android Keystore-backed AES-256-GCM encrypted credential vault.
 *
 * Invariants:
 * - Credentials are bound to (profileId, baseUrl) pairs.
 * - If Keystore key is invalidated or corrupt, throws VaultKeyInvalidatedException (fail-closed).
 * - Never stores passwords, challenges, or TOTP secrets.
 * - Backed by encrypted SharedPreferences which is excluded from cloud backup and device transfer.
 */
class AndroidCredentialVault(
    private val context: Context,
    private val prefsName: String = "damhopper_secure_vault"
) : CredentialVault {

    @Volatile
    private var cachedPrefs: SharedPreferences? = null

    private fun getEncryptedPrefs(): SharedPreferences {
        cachedPrefs?.let { return it }
        return synchronized(this) {
            cachedPrefs?.let { return it }
            val prefs = try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()

                EncryptedSharedPreferences.create(
                    context,
                    prefsName,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } catch (e: GeneralSecurityException) {
                cachedPrefs = null
                throw VaultKeyInvalidatedException(
                    "Keystore key was permanently invalidated or corrupted: ${e.message}",
                    e
                )
            } catch (e: Exception) {
                cachedPrefs = null
                throw VaultKeyInvalidatedException(
                    "Failed to access secure keystore vault: ${e.message}",
                    e
                )
            }
            cachedPrefs = prefs
            prefs
        }
    }

    override suspend fun storeToken(profileId: String, baseUrl: String, token: String) =
        withContext(Dispatchers.IO) {
            require(token.isNotBlank()) { "Cannot store blank token in vault" }
            val key = CredentialVault.makeKey(profileId, baseUrl)
            try {
                getEncryptedPrefs().edit().putString(key, token).commit()
                Unit
            } catch (e: Exception) {
                if (e is VaultKeyInvalidatedException) throw e
                throw VaultKeyInvalidatedException("Failed to store credential in encrypted vault", e)
            }
        }

    override suspend fun getToken(profileId: String, baseUrl: String): String? =
        withContext(Dispatchers.IO) {
            val key = CredentialVault.makeKey(profileId, baseUrl)
            try {
                getEncryptedPrefs().getString(key, null)
            } catch (e: Exception) {
                if (e is VaultKeyInvalidatedException) throw e
                throw VaultKeyInvalidatedException("Failed to read credential from encrypted vault", e)
            }
        }

    override suspend fun clearToken(profileId: String, baseUrl: String) =
        withContext(Dispatchers.IO) {
            val key = CredentialVault.makeKey(profileId, baseUrl)
            try {
                getEncryptedPrefs().edit().remove(key).commit()
                Unit
            } catch (e: Exception) {
                if (e is VaultKeyInvalidatedException) throw e
                throw VaultKeyInvalidatedException("Failed to clear credential from encrypted vault", e)
            }
        }

    override suspend fun clearAllForProfile(profileId: String) =
        withContext(Dispatchers.IO) {
            val prefix = "token:${profileId.trim()}:"
            try {
                val prefs = getEncryptedPrefs()
                val keysToRemove = prefs.all.keys.filter { it.startsWith(prefix) }
                val editor = prefs.edit()
                for (k in keysToRemove) {
                    editor.remove(k)
                }
                editor.commit()
                Unit
            } catch (e: Exception) {
                if (e is VaultKeyInvalidatedException) throw e
                throw VaultKeyInvalidatedException("Failed to clear profile credentials from vault", e)
            }
        }

    override suspend fun clearAll() =
        withContext(Dispatchers.IO) {
            try {
                getEncryptedPrefs().edit().clear().commit()
                Unit
            } catch (e: Exception) {
                if (e is VaultKeyInvalidatedException) throw e
                throw VaultKeyInvalidatedException("Failed to clear all credentials from encrypted vault", e)
            }
        }
}
