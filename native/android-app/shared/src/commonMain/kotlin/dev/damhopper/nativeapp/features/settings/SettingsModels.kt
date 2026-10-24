package dev.damhopper.nativeapp.features.settings

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Maximum size allowed for TOML configuration imports (1 MiB ceiling).
 */
const val MAX_CONFIG_IMPORT_BYTES = 1024L * 1024L

@Serializable
enum class WorkbenchTheme {
    @SerialName("dark")
    DARK,
    @SerialName("light")
    LIGHT,
    @SerialName("system")
    SYSTEM,
    @SerialName("high-contrast")
    HIGH_CONTRAST,
}

@Serializable
enum class CognitoModeStyle {
    @SerialName("heavy-blur")
    HEAVY_BLUR,
    @SerialName("black-screen")
    BLACK_SCREEN,
}

@Serializable
enum class ExplorerLanguageFilter {
    @SerialName("all")
    ALL,
    @SerialName("known")
    KNOWN,
    @SerialName("code")
    CODE,
    @SerialName("text")
    TEXT,
}

@Serializable
enum class PreferenceSourceStatus {
    @SerialName("active")
    ACTIVE,
    @SerialName("source-removed")
    SOURCE_REMOVED,
    @SerialName("unset")
    UNSET,
}

@Serializable
data class TerminalAgentPolicy(
    val enabled: Boolean = false,
    val toast: Boolean = true,
    val sound: Boolean = false,
    val browser: Boolean = false,
)

@Serializable
data class TerminalAgentNotifications(
    val masterEnabled: Boolean = false,
    val omp: TerminalAgentPolicy = TerminalAgentPolicy(),
    val claude: TerminalAgentPolicy = TerminalAgentPolicy(),
    val codex: TerminalAgentPolicy = TerminalAgentPolicy(),
)

/**
 * Persisted local and synchronized workbench preferences.
 */
@Serializable
data class WorkbenchPreferences(
    val theme: WorkbenchTheme = WorkbenchTheme.DARK,
    val systemFontSize: Int = 14,
    val editorFontSize: Int = 14,
    val terminalFontSize: Int = 13,
    val editorZoomWheelEnabled: Boolean = true,
    val terminalSuggestionsEnabled: Boolean = true,
    val terminalScrollButtonsEnabled: Boolean = true,
    val terminalCommitStatusEnabled: Boolean = true,
    val terminalScrollStep: Int = 5,
    val explorerShowHidden: Boolean = false,
    val explorerLanguageFilter: ExplorerLanguageFilter = ExplorerLanguageFilter.ALL,
    val soundEnabled: Boolean = true,
    val hapticFeedbackEnabled: Boolean = true,
    val statusFilter: String = "",
    val cognitoModeShortcut: String = "Ctrl+Alt+P",
    val cognitoModeStyle: CognitoModeStyle = CognitoModeStyle.HEAVY_BLUR,
    val terminalAgentNotifications: TerminalAgentNotifications = TerminalAgentNotifications(),
) {
    companion object {
        const val FONT_MIN = 10
        const val FONT_MAX = 32
        const val SCROLL_STEP_MIN = 1
        const val SCROLL_STEP_MAX = 20

        fun clampFont(size: Int): Int = size.coerceIn(FONT_MIN, FONT_MAX)
        fun clampScrollStep(step: Int): Int = step.coerceIn(SCROLL_STEP_MIN, SCROLL_STEP_MAX)
    }

    fun clamped(): WorkbenchPreferences = copy(
        systemFontSize = clampFont(systemFontSize),
        editorFontSize = clampFont(editorFontSize),
        terminalFontSize = clampFont(terminalFontSize),
        terminalScrollStep = clampScrollStep(terminalScrollStep),
    )
}

/**
 * State tracking independent selections:
 * - preferencesProfileId: server profile used as source for shared appearance / preferences
 * - settingsProfileId: server profile whose workspace config / maintenance / import-export is managed
 */
@Serializable
data class SettingsSourceTargetState(
    val preferencesProfileId: String? = null,
    val preferencesStatus: PreferenceSourceStatus = PreferenceSourceStatus.UNSET,
    val lastSnapshot: WorkbenchPreferences? = null,
    val settingsProfileId: String? = null,
)

@Serializable
data class SettingsImportResult(
    val ok: Boolean = false,
    val imported: Boolean = false,
    val backupFileName: String? = null,
    val error: String? = null,
)

data class SettingsImportExportState(
    val isExporting: Boolean = false,
    val isImporting: Boolean = false,
    val lastExportedToml: String? = null,
    val lastImportResult: SettingsImportResult? = null,
    val lastError: String? = null,
)

fun WorkbenchPreferences.toUiPreferences(): UiPreferences {
    return UiPreferences(
        systemFontSize = systemFontSize,
        editorFontSize = editorFontSize,
        terminalFontSize = terminalFontSize,
        cognitoModeShortcut = cognitoModeShortcut,
        cognitoModeStyle = when (cognitoModeStyle) {
            CognitoModeStyle.HEAVY_BLUR -> "heavy-blur"
            CognitoModeStyle.BLACK_SCREEN -> "black-screen"
        },
    )
}

fun UiPreferences.applyTo(base: WorkbenchPreferences): WorkbenchPreferences {
    return base.copy(
        systemFontSize = systemFontSize?.let { WorkbenchPreferences.clampFont(it) } ?: base.systemFontSize,
        editorFontSize = editorFontSize?.let { WorkbenchPreferences.clampFont(it) } ?: base.editorFontSize,
        terminalFontSize = terminalFontSize?.let { WorkbenchPreferences.clampFont(it) } ?: base.terminalFontSize,
        cognitoModeShortcut = cognitoModeShortcut ?: base.cognitoModeShortcut,
        cognitoModeStyle = when (cognitoModeStyle) {
            "black-screen" -> CognitoModeStyle.BLACK_SCREEN
            "heavy-blur" -> CognitoModeStyle.HEAVY_BLUR
            else -> base.cognitoModeStyle
        },
    )
}
