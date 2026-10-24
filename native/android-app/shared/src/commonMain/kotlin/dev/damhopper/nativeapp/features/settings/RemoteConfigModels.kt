package dev.damhopper.nativeapp.features.settings

import kotlinx.serialization.Serializable

/**
 * Allowlisted UI preferences matching server UiConfig schema.
 */
@Serializable
data class UiPreferences(
    val systemFontSize: Int? = null,
    val editorFontSize: Int? = null,
    val terminalFontSize: Int? = null,
    val cognitoModeShortcut: String? = null,
    val cognitoModeStyle: String? = null, // "heavy-blur" | "black-screen"
)

/**
 * State of remote configuration editor tracking base, draft, dirty status, and external conflicts.
 */
data class RemoteConfigEditorState(
    val baseConfigJson: String? = null,
    val draftConfigJson: String? = null,
    val isDirty: Boolean = false,
    val hasConflict: Boolean = false,
    val conflictingServerJson: String? = null,
    val uiPreferencesDraft: UiPreferences = UiPreferences(),
    val uiPreferencesBase: UiPreferences = UiPreferences(),
    val isUiPreferencesDirty: Boolean = false,
    val isSaving: Boolean = false,
    val lastError: String? = null,
)
