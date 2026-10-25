package dev.damhopper.nativeapp.ui.flow

/**
 * Stages of the core mobile application flow:
 * Profile Login -> List of Projects -> Terminal / Focused Workspace.
 */
enum class AppFlowStage {
    PROFILE_LOGIN,
    PROJECT_LIST,
    TERMINAL;

    companion object {
        val WORKSPACE = TERMINAL
        val FOCUSED_WORKSPACE = TERMINAL
    }
}

/**
 * Where Settings was opened from. Settings is a retained overlay above the existing flow, not a stage:
 * [panel], [document] and [sessionId] only record what the user was looking at so that Back returns to
 * exactly that place. The documents, undo history, sidebar and PTYs themselves stay in the retained
 * workspace state and are never closed or reset by opening Settings.
 *
 * @property stage Flow stage that was visible.
 * @property panel Workspace panel name (e.g. `EDITOR`) when the origin was the focused workspace.
 * @property document Key of the active editor document at open time, if any.
 * @property sessionId Active terminal session at open time, if any.
 */
data class SettingsOrigin(
    val stage: AppFlowStage,
    val panel: String? = null,
    val document: String? = null,
    val sessionId: String? = null,
)

/**
 * The open Settings overlay: its captured [origin] and the currently shown sub-section (kept by name so a
 * configuration change restores it).
 */
data class SettingsOverlay(
    val origin: SettingsOrigin,
    val subSection: String? = null,
)

/**
 * Immutable state model for the core mobile application flow.
 *
 * @property stage Current visible flow stage.
 * @property activeProfileId Currently authenticated profile ID, or null if unauthenticated.
 * @property activeProject Currently selected project name / path, or null if none selected.
 * @property activeSessionId Active terminal session identifier associated with the project, if any.
 * @property activeWorktreePath Selected worktree path within the project, if any.
 * @property settings Retained Settings overlay (null when closed).
 * @property notificationsOpen Whether the inline notification feed is expanded in the current header.
 */
data class AppFlowState(
    val stage: AppFlowStage = AppFlowStage.PROFILE_LOGIN,
    val activeProfileId: String? = null,
    val activeProject: String? = null,
    val activeSessionId: String? = null,
    val activeWorktreePath: String? = null,
    val settings: SettingsOverlay? = null,
    val notificationsOpen: Boolean = false,
    val notificationRouteActive: Boolean = false,
)
