package dev.damhopper.nativeapp.platform.storage

import android.content.Context
import android.content.SharedPreferences
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.settings.NativePreferencesEnvelope
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import dev.damhopper.nativeapp.features.settings.SettingsSourceTargetState
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.settings.decodeNativePreferences
import dev.damhopper.nativeapp.features.settings.encodeNativePreferences
import dev.damhopper.nativeapp.features.settings.encodeSourceTargetState
import dev.damhopper.nativeapp.features.settings.migrateSourceSnapshot
import kotlinx.serialization.json.JsonElement

/**
 * Persists local preferences and source/target selections in Android SharedPreferences.
 *
 * Preferences use the versioned envelope `{nativeVersion:2, preferences, legacyExplorerLanguageFilter?}`.
 * Pre-v2 unversioned objects (and the pre-v2 `lastSnapshot` inside the source/target state) are migrated
 * exactly once: the original bytes are first copied to a `*_pre_v2` recovery key (never overwritten once
 * present) in the same edit that commits the migrated value. Corrupt or unknown-version bytes are NEVER
 * reset or overwritten: they stay in place, the store serves in-memory defaults for the session, further
 * saves of that value stay in memory only, and [loadRecoverableError] describes the problem.
 */
class AndroidPreferencesStore(
    context: Context,
    prefsName: String = "damhopper_workbench_preferences",
) : PreferencesStore {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    private val lock = Any()

    private var envelope: NativePreferencesEnvelope = NativePreferencesEnvelope(preferences = WorkbenchPreferences())
    private var preferencesError: String? = null
    private var sourceTarget: SettingsSourceTargetState = SettingsSourceTargetState()
    private var sourceTargetError: String? = null

    init {
        loadPreferencesFromDisk()
        loadSourceTargetFromDisk()
    }

    private fun loadPreferencesFromDisk() {
        val raw = prefs.getString(KEY_PREFERENCES, null) ?: return
        val decoded = decodeNativePreferences(raw)
        decoded.onSuccess { migrated ->
            envelope = migrated
            if (!isCurrentEnvelope(raw)) {
                // One-time migration: keep the original bytes recoverable, commit the envelope atomically.
                val edit = prefs.edit()
                if (!prefs.contains(KEY_PREFERENCES_PRE_V2)) edit.putString(KEY_PREFERENCES_PRE_V2, raw)
                edit.putString(KEY_PREFERENCES, encodeNativePreferences(migrated))
                edit.apply()
            }
        }.onFailure { error ->
            preferencesError = "Saved preferences could not be read and were left untouched: ${error.message}"
        }
    }

    private fun loadSourceTargetFromDisk() {
        val raw = prefs.getString(KEY_SOURCE_TARGET, null) ?: return
        val decoded = migrateSourceSnapshot(raw)
        decoded.onSuccess { migrated ->
            sourceTarget = migrated
            val rewritten = encodeSourceTargetState(migrated)
            if (!sameJson(raw, rewritten)) {
                val edit = prefs.edit()
                if (!prefs.contains(KEY_SOURCE_TARGET_PRE_V2)) edit.putString(KEY_SOURCE_TARGET_PRE_V2, raw)
                edit.putString(KEY_SOURCE_TARGET, rewritten)
                edit.apply()
            }
        }.onFailure { error ->
            sourceTargetError = "Saved server selection could not be read and was left untouched: ${error.message}"
        }
    }

    private fun isCurrentEnvelope(raw: String): Boolean = try {
        val root = ProtocolJson.parseToJsonElement(raw)
        (root as? kotlinx.serialization.json.JsonObject)?.containsKey("nativeVersion") == true
    } catch (_: Exception) {
        false
    }

    private fun sameJson(a: String, b: String): Boolean = try {
        val left: JsonElement = ProtocolJson.parseToJsonElement(a)
        val right: JsonElement = ProtocolJson.parseToJsonElement(b)
        left == right
    } catch (_: Exception) {
        false
    }

    override fun loadPreferences(): WorkbenchPreferences = synchronized(lock) { envelope.preferences }

    override fun savePreferences(preferences: WorkbenchPreferences) {
        synchronized(lock) {
            envelope = envelope.copy(preferences = preferences.clamped())
            // Never overwrite bytes that failed to decode: keep them recoverable, serve memory only.
            if (preferencesError == null) persistEnvelope()
        }
    }

    override fun loadSourceTargetState(): SettingsSourceTargetState = synchronized(lock) { sourceTarget }

    override fun saveSourceTargetState(state: SettingsSourceTargetState) {
        synchronized(lock) {
            sourceTarget = state
            if (sourceTargetError == null) {
                prefs.edit().putString(KEY_SOURCE_TARGET, encodeSourceTargetState(state)).apply()
            }
        }
    }

    override fun loadLegacyExplorerLanguageFilter(): String? = synchronized(lock) {
        envelope.legacyExplorerLanguageFilter
    }

    override fun clearLegacyExplorerLanguageFilter() {
        synchronized(lock) {
            if (envelope.legacyExplorerLanguageFilter == null) return
            // Clears the visible notice only; the `*_pre_v2` recovery bytes are retained.
            envelope = envelope.copy(legacyExplorerLanguageFilter = null)
            if (preferencesError == null) persistEnvelope()
        }
    }

    override fun loadRecoverableError(): String? = synchronized(lock) {
        preferencesError ?: sourceTargetError
    }

    private fun persistEnvelope() {
        prefs.edit().putString(KEY_PREFERENCES, encodeNativePreferences(envelope)).apply()
    }

    companion object {
        const val KEY_PREFERENCES = "damhopper_workbench_preferences"
        const val KEY_SOURCE_TARGET = "damhopper_settings_source_target"
        const val KEY_PREFERENCES_PRE_V2 = "damhopper_workbench_preferences_pre_v2"
        const val KEY_SOURCE_TARGET_PRE_V2 = "damhopper_settings_source_target_pre_v2"
    }
}
