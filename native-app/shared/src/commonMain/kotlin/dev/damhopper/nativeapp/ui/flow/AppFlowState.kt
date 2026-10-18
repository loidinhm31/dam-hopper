package dev.damhopper.nativeapp.ui.flow

/**
 * Stages of the core mobile application flow:
 * Profile Login -> List of Projects -> Terminal display.
 */
enum class AppFlowStage {
    PROFILE_LOGIN,
    PROJECT_LIST,
    TERMINAL,
}

/**
 * Immutable state model for the core mobile application flow.
 *
 * @property stage Current visible flow stage.
 * @property activeProfileId Currently authenticated profile ID, or null if unauthenticated.
 * @property activeProject Currently selected project name / path, or null if none selected.
 * @property activeSessionId Active terminal session identifier associated with the project, if any.
 */
data class AppFlowState(
    val stage: AppFlowStage = AppFlowStage.PROFILE_LOGIN,
    val activeProfileId: String? = null,
    val activeProject: String? = null,
    val activeSessionId: String? = null,
)
