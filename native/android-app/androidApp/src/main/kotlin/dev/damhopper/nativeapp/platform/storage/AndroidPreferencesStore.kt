package dev.damhopper.nativeapp.platform.storage

import android.content.Context
import android.content.SharedPreferences
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import dev.damhopper.nativeapp.features.settings.SettingsSourceTargetState
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences

/**
 * Persists local preferences and source/target selections in Android SharedPreferences.
 */
class AndroidPreferencesStore(
    context: Context,
    prefsName: String = "damhopper_workbench_preferences",
) : PreferencesStore {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    override fun loadPreferences(): WorkbenchPreferences {
        val json = prefs.getString(KEY_PREFERENCES, null) ?: return WorkbenchPreferences()
        return try {
            ProtocolJson.decodeFromString(WorkbenchPreferences.serializer(), json).clamped()
        } catch (_: Exception) {
            WorkbenchPreferences()
        }
    }

    override fun savePreferences(preferences: WorkbenchPreferences) {
        val clamped = preferences.clamped()
        val json = ProtocolJson.encodeToString(WorkbenchPreferences.serializer(), clamped)
        prefs.edit().putString(KEY_PREFERENCES, json).apply()
    }

    override fun loadSourceTargetState(): SettingsSourceTargetState {
        val json = prefs.getString(KEY_SOURCE_TARGET, null) ?: return SettingsSourceTargetState()
        return try {
            ProtocolJson.decodeFromString(SettingsSourceTargetState.serializer(), json)
        } catch (_: Exception) {
            SettingsSourceTargetState()
        }
    }

    override fun saveSourceTargetState(state: SettingsSourceTargetState) {
        val json = ProtocolJson.encodeToString(SettingsSourceTargetState.serializer(), state)
        prefs.edit().putString(KEY_SOURCE_TARGET, json).apply()
    }

    companion object {
        const val KEY_PREFERENCES = "damhopper_workbench_preferences"
        const val KEY_SOURCE_TARGET = "damhopper_settings_source_target"
    }
}
