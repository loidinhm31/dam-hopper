package dev.damhopper.nativeapp.platform.storage

import android.content.Context
import android.content.SharedPreferences
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.profiles.ProfileMetadataStore
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.profiles.LastNavigationState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer

/**
 * Persists non-secret server profile metadata in Android SharedPreferences.
 * Matches web profile storage semantics under key "damhopper_server_profiles".
 */
class AndroidProfileMetadataStore(
    context: Context,
    prefsName: String = "damhopper_profile_metadata"
) : ProfileMetadataStore {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    override suspend fun loadProfiles(): List<ServerProfile> = withContext(Dispatchers.IO) {
        val json = prefs.getString(KEY_PROFILES, null) ?: return@withContext emptyList()
        try {
            ProtocolJson.decodeFromString(ListSerializer(ServerProfile.serializer()), json)
        } catch (_: Exception) {
            emptyList()
        }
    }

    override suspend fun saveProfiles(profiles: List<ServerProfile>) = withContext(Dispatchers.IO) {
        val json = ProtocolJson.encodeToString(ListSerializer(ServerProfile.serializer()), profiles)
        prefs.edit().putString(KEY_PROFILES, json).commit()
        Unit
    }

    override suspend fun loadActiveProfileId(): String? = withContext(Dispatchers.IO) {
        prefs.getString(KEY_ACTIVE_PROFILE, null)
    }

    override suspend fun saveActiveProfileId(id: String?) = withContext(Dispatchers.IO) {
        if (id == null) {
            prefs.edit().remove(KEY_ACTIVE_PROFILE).commit()
        } else {
            prefs.edit().putString(KEY_ACTIVE_PROFILE, id).commit()
        }
        Unit
    }
    override suspend fun loadLastNavigationState(): LastNavigationState? = withContext(Dispatchers.IO) {
        val json = prefs.getString(KEY_LAST_NAV, null) ?: return@withContext null
        try {
            ProtocolJson.decodeFromString(LastNavigationState.serializer(), json)
        } catch (_: Exception) {
            null
        }
    }

    override suspend fun saveLastNavigationState(state: LastNavigationState?) = withContext(Dispatchers.IO) {
        if (state == null) {
            prefs.edit().remove(KEY_LAST_NAV).commit()
        } else {
            val json = ProtocolJson.encodeToString(LastNavigationState.serializer(), state)
            prefs.edit().putString(KEY_LAST_NAV, json).commit()
        }
        Unit
    }

    companion object {
        const val KEY_PROFILES = "damhopper_server_profiles"
        const val KEY_ACTIVE_PROFILE = "damhopper_active_profile"
        const val KEY_LAST_NAV = "damhopper_last_navigation"
    }
}
