package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Coordinates local native preferences, remote preference source synchronization,
 * Settings target selection, and TOML configuration import/export.
 */
class SettingsRepository(
    private val preferencesStore: PreferencesStore,
    private val clientProvider: (profileId: String) -> ApiClient?,
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    private val debounceMillis: Long = 500L,
) {
    private val _preferences = MutableStateFlow(preferencesStore.loadPreferences().clamped())
    val preferences: StateFlow<WorkbenchPreferences> = _preferences.asStateFlow()

    private val _sourceTargetState = MutableStateFlow(preferencesStore.loadSourceTargetState())
    val sourceTargetState: StateFlow<SettingsSourceTargetState> = _sourceTargetState.asStateFlow()

    private val _importExportState = MutableStateFlow(SettingsImportExportState())
    val importExportState: StateFlow<SettingsImportExportState> = _importExportState.asStateFlow()

    private var latestEditRevision: Long = 0L
    private var debounceJob: Job? = null
    private var lastSavedSnapshot: WorkbenchPreferences? = null

    init {
        lastSavedSnapshot = _preferences.value
    }

    /**
     * Updates local preferences and schedules a debounced remote save if an active
     * preferences source is configured.
     */
    fun updatePreferences(transform: (WorkbenchPreferences) -> WorkbenchPreferences) {
        val updated = transform(_preferences.value).clamped()
        _preferences.value = updated
        preferencesStore.savePreferences(updated)
        latestEditRevision++

        val sourceProfileId = _sourceTargetState.value.preferencesProfileId
        if (_sourceTargetState.value.preferencesStatus == PreferenceSourceStatus.ACTIVE && sourceProfileId != null) {
            scheduleDebouncedRemoteSave(sourceProfileId, latestEditRevision)
        }
    }

    private fun scheduleDebouncedRemoteSave(targetProfileId: String, editRevision: Long) {
        debounceJob?.cancel()
        val initialClient = clientProvider(targetProfileId) ?: return
        val initialGeneration = initialClient.connection.generation
        val payloadPrefs = _preferences.value
        val payloadUiPrefs = payloadPrefs.toUiPreferences()

        debounceJob = coroutineScope.launch {
            delay(debounceMillis)

            val client = clientProvider(targetProfileId) ?: return@launch
            if (client.connection.generation != initialGeneration) return@launch

            try {
                val remoteRepo = RemoteConfigRepository(client)
                val success = remoteRepo.updateGlobalUi(payloadUiPrefs)

                // Verify ownership and edit revision haven't shifted during dispatch
                if (_sourceTargetState.value.preferencesProfileId == targetProfileId &&
                    client.connection.generation == initialGeneration &&
                    latestEditRevision == editRevision
                ) {
                    if (success) {
                        lastSavedSnapshot = payloadPrefs
                        val snapshotState = _sourceTargetState.value.copy(lastSnapshot = payloadPrefs)
                        _sourceTargetState.value = snapshotState
                        preferencesStore.saveSourceTargetState(snapshotState)
                    }
                }
            } catch (ce: kotlinx.coroutines.CancellationException) {
                throw ce
            } catch (_: Throwable) {
                // Keep local state but diagnostics / snapshot preserved
            }
        }
    }

    /**
     * Switches preference source server. Cancels pending remote saves.
     * Hydrates allowlisted preferences from the new source if connected.
     */
    suspend fun switchPreferenceSource(profileId: String?): Boolean {
        debounceJob?.cancel()
        debounceJob = null

        if (profileId == null) {
            val newState = _sourceTargetState.value.copy(
                preferencesProfileId = null,
                preferencesStatus = PreferenceSourceStatus.UNSET,
            )
            _sourceTargetState.value = newState
            preferencesStore.saveSourceTargetState(newState)
            return true
        }

        val newState = _sourceTargetState.value.copy(
            preferencesProfileId = profileId,
            preferencesStatus = PreferenceSourceStatus.ACTIVE,
        )
        _sourceTargetState.value = newState
        preferencesStore.saveSourceTargetState(newState)

        val client = clientProvider(profileId) ?: return false
        val capturedGeneration = client.connection.generation
        val capturedRevision = latestEditRevision
        return try {
            val remoteRepo = RemoteConfigRepository(client)
            val uiPrefs = remoteRepo.getUiPreferences()

            if (_sourceTargetState.value.preferencesProfileId == profileId &&
                client.connection.generation == capturedGeneration &&
                latestEditRevision == capturedRevision
            ) {
                val applied = uiPrefs.applyTo(_preferences.value).clamped()
                _preferences.value = applied
                preferencesStore.savePreferences(applied)
                lastSavedSnapshot = applied

                val snapshotState = _sourceTargetState.value.copy(lastSnapshot = applied)
                _sourceTargetState.value = snapshotState
                preferencesStore.saveSourceTargetState(snapshotState)
                true
            } else {
                false
            }
        } catch (ce: kotlinx.coroutines.CancellationException) {
            throw ce
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Sets target server for workspace configuration / maintenance inspection.
     */
    fun setSettingsTarget(profileId: String?) {
        val newState = _sourceTargetState.value.copy(settingsProfileId = profileId)
        _sourceTargetState.value = newState
        preferencesStore.saveSourceTargetState(newState)
    }
    /**
     * Returns current connection generation for specified profile, if connected.
     */
    fun getTargetConnectionGeneration(profileId: String): Long? =
        clientProvider(profileId)?.connection?.generation


    /**
     * Handles profile deletion by retaining safe snapshots and clearing targets.
     */
    fun onProfileRemoved(profileId: String) {
        var state = _sourceTargetState.value
        var changed = false

        if (state.preferencesProfileId == profileId) {
            debounceJob?.cancel()
            debounceJob = null
            state = state.copy(
                preferencesProfileId = null,
                preferencesStatus = PreferenceSourceStatus.SOURCE_REMOVED,
            )
            changed = true
        }

        if (state.settingsProfileId == profileId) {
            state = state.copy(settingsProfileId = null)
            changed = true
        }

        if (changed) {
            _sourceTargetState.value = state
            preferencesStore.saveSourceTargetState(state)
        }
    }

    /**
     * Exports workspace TOML from the specified target server.
     */
    suspend fun exportWorkspaceToml(profileId: String): Result<String> {
        val client = clientProvider(profileId)
            ?: return Result.failure(IllegalStateException("Settings target server is not connected."))

        _importExportState.value = _importExportState.value.copy(isExporting = true, lastError = null)
        return try {
            val toml = client.get("/api/settings/export/workspace.toml")
            _importExportState.value = _importExportState.value.copy(
                isExporting = false,
                lastExportedToml = toml,
            )
            Result.success(toml)
        } catch (ce: kotlinx.coroutines.CancellationException) {
            throw ce
        } catch (t: Throwable) {
            _importExportState.value = _importExportState.value.copy(
                isExporting = false,
                lastError = t.message ?: "Failed to export settings",
            )
            Result.failure(t)
        }
    }

    /**
     * Imports workspace TOML to the specified target server with 1 MiB boundary
     * enforcement and target verification.
     */
    suspend fun importWorkspaceToml(
        profileId: String,
        tomlContent: String,
        expectedGeneration: Long? = null,
    ): Result<SettingsImportResult> {
        val bytes = tomlContent.encodeToByteArray()
        if (bytes.size > MAX_CONFIG_IMPORT_BYTES) {
            val err = "File size exceeds 1 MiB limit."
            _importExportState.value = _importExportState.value.copy(lastError = err)
            return Result.failure(IllegalArgumentException(err))
        }

        val client = clientProvider(profileId)
            ?: return Result.failure(IllegalStateException("Settings target server is not connected."))

        if (expectedGeneration != null && client.connection.generation != expectedGeneration) {
            val err = "Settings target connection generation changed during confirmation."
            _importExportState.value = _importExportState.value.copy(lastError = err)
            return Result.failure(IllegalStateException(err))
        }

        _importExportState.value = _importExportState.value.copy(isImporting = true, lastError = null)
        return try {
            val responseText = client.postToml("/api/settings/import/workspace.toml", tomlContent)
            val result = ProtocolJson.decodeFromString(SettingsImportResult.serializer(), responseText)
            _importExportState.value = _importExportState.value.copy(
                isImporting = false,
                lastImportResult = result,
            )
            Result.success(result)
        } catch (ce: kotlinx.coroutines.CancellationException) {
            throw ce
        } catch (t: Throwable) {
            _importExportState.value = _importExportState.value.copy(
                isImporting = false,
                lastError = t.message ?: "Failed to import settings",
            )
            Result.failure(t)
        }
    }

    /**
     * Clears server cache for target profile.
     */
    suspend fun clearCache(profileId: String, expectedGeneration: Long? = null): Result<Boolean> {
        val client = clientProvider(profileId)
            ?: return Result.failure(IllegalStateException("Settings target server is not connected."))
        if (expectedGeneration != null && client.connection.generation != expectedGeneration) {
            return Result.failure(IllegalStateException("Target connection generation changed during confirmation."))
        }
        return try {
            val text = client.postJson("/api/settings/cache-clear", "{}")
            val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
            Result.success(obj["ok"]?.jsonPrimitive?.booleanOrNull == true)
        } catch (ce: kotlinx.coroutines.CancellationException) {
            throw ce
        } catch (t: Throwable) {
            Result.failure(t)
        }
    }

    /**
     * Triggers nuclear reset on target server.
     */
    suspend fun nuclearReset(profileId: String, expectedGeneration: Long? = null): Result<Boolean> {
        val client = clientProvider(profileId)
            ?: return Result.failure(IllegalStateException("Settings target server is not connected."))
        if (expectedGeneration != null && client.connection.generation != expectedGeneration) {
            return Result.failure(IllegalStateException("Target connection generation changed during confirmation."))
        }
        return try {
            val text = client.postJson("/api/settings/reset", "{}")
            val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
            Result.success(obj["ok"]?.jsonPrimitive?.booleanOrNull == true)
        } catch (ce: kotlinx.coroutines.CancellationException) {
            throw ce
        } catch (t: Throwable) {
            Result.failure(t)
        }
    }
}
