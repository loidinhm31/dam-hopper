package dev.damhopper.nativeapp.features.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Lossless and conflict-aware editor controller for remote configuration and UI preferences.
 * Invariants:
 * - Full JSON document is preserved during whole-config updates to avoid stripping unmodeled fields.
 * - Background refreshes preserve dirty fields without clobbering user drafts.
 * - Conflicting server revisions are surfaced explicitly for user resolution.
 */
class RemoteConfigEditor(
    val repository: RemoteConfigRepository,
) {
    private val _state = MutableStateFlow(RemoteConfigEditorState())
    val state: StateFlow<RemoteConfigEditorState> = _state.asStateFlow()

    suspend fun load() {
        _state.update { it.copy(isSaving = true, lastError = null) }
        try {
            val fullConfig = repository.getFullConfig()
            val uiPrefs = repository.getUiPreferences()
            _state.update {
                it.copy(
                    baseConfigJson = fullConfig,
                    draftConfigJson = fullConfig,
                    isDirty = false,
                    hasConflict = false,
                    conflictingServerJson = null,
                    uiPreferencesBase = uiPrefs,
                    uiPreferencesDraft = uiPrefs,
                    isUiPreferencesDirty = false,
                    isSaving = false,
                    lastError = null,
                )
            }
        } catch (e: Exception) {
            _state.update { it.copy(isSaving = false, lastError = e.message ?: "Failed to load config") }
            throw e
        }
    }

    fun updateConfigDraft(newDraftJson: String) {
        _state.update { current ->
            val isDirty = current.baseConfigJson != null && current.baseConfigJson != newDraftJson
            current.copy(
                draftConfigJson = newDraftJson,
                isDirty = isDirty,
            )
        }
    }

    fun updateUiPreferencesDraft(preferences: UiPreferences) {
        _state.update { current ->
            val isDirty = current.uiPreferencesBase != preferences
            current.copy(
                uiPreferencesDraft = preferences,
                isUiPreferencesDirty = isDirty,
            )
        }
    }

    /**
     * Called when an external refresh or event brings new server configuration.
     * Never clobbers uncommitted local drafts; sets hasConflict if server changed under draft.
     */
    fun handleServerRefresh(newServerJson: String) {
        _state.update { current ->
            if (!current.isDirty) {
                current.copy(
                    baseConfigJson = newServerJson,
                    draftConfigJson = newServerJson,
                    isDirty = false,
                    hasConflict = false,
                    conflictingServerJson = null,
                )
            } else {
                if (current.baseConfigJson == newServerJson) {
                    current.copy(hasConflict = false, conflictingServerJson = null)
                } else {
                    current.copy(
                        hasConflict = true,
                        conflictingServerJson = newServerJson,
                    )
                }
            }
        }
    }

    /**
     * Discards uncommitted draft edits and resets state to latest authoritative server config.
     */
    fun discardDraft() {
        _state.update { current ->
            val target = current.conflictingServerJson ?: current.baseConfigJson
            current.copy(
                draftConfigJson = target,
                isDirty = false,
                hasConflict = false,
                conflictingServerJson = null,
                uiPreferencesDraft = current.uiPreferencesBase,
                isUiPreferencesDirty = false,
                lastError = null,
            )
        }
    }

    /**
     * Overwrites server with current draft configuration.
     */
    suspend fun saveFullConfig(): Boolean {
        val draft = _state.value.draftConfigJson ?: return false
        _state.update { it.copy(isSaving = true, lastError = null) }
        return try {
            val success = repository.updateFullConfig(draft)
            if (success) {
                _state.update {
                    it.copy(
                        baseConfigJson = draft,
                        isDirty = false,
                        hasConflict = false,
                        conflictingServerJson = null,
                        isSaving = false,
                    )
                }
            } else {
                _state.update { it.copy(isSaving = false, lastError = "Server rejected config update") }
            }
            success
        } catch (e: Exception) {
            _state.update { it.copy(isSaving = false, lastError = e.message ?: "Save failed") }
            throw e
        }
    }

    suspend fun saveUiPreferences(): Boolean {
        val draft = _state.value.uiPreferencesDraft
        _state.update { it.copy(isSaving = true, lastError = null) }
        return try {
            val success = repository.updateGlobalUi(draft)
            if (success) {
                _state.update {
                    it.copy(
                        uiPreferencesBase = draft,
                        isUiPreferencesDirty = false,
                        isSaving = false,
                    )
                }
            } else {
                _state.update { it.copy(isSaving = false, lastError = "Server rejected UI preferences update") }
            }
            success
        } catch (e: Exception) {
            _state.update { it.copy(isSaving = false, lastError = e.message ?: "Save failed") }
            throw e
        }
    }
}
