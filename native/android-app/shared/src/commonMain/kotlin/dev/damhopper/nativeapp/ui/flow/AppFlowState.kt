package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.core.model.ConnectionRef

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
 *
 * @property hostSection Remembered Host administration section name (e.g. `AGENTS`); null means the default.
 * @property targetProfileId The captured Settings target workspace server B of an Agents-opened overlay; null when
 *   Settings was opened without a captured target.
 * @property intent Identity of the open intent. A new `openAgentSettings` while already open advances it, so the
 *   root can deterministically re-key the Settings content instead of relying on unkeyed remembered state.
 */
data class SettingsOverlay(
    val origin: SettingsOrigin,
    val subSection: String? = null,
    val hostSection: String? = null,
    val targetProfileId: String? = null,
    val intent: Long = 0L,
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
 * @property requiredTerminalInstance Captured exact-selection intent of a verified manual Agents activation (not a
 *   feature flag): the terminal screen selects only this ID + incarnation and never falls back to another terminal.
 *   Retained until a deliberate different session/project/profile/back navigation clears it.
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
    val requiredTerminalInstance: TerminalAgentsInstanceKey? = null,
)

/**
 * True when the captured Settings target workspace server B may use its remote administration services: no captured
 * target (plain Settings), or B is BOTH the selected Settings target and the exact retained service owner (same
 * registry connection and authenticated account). Anything else keeps target services blocked - there is never an
 * ambient fallback to the viewed workspace, preference source A or another server.
 */
fun SettingsOverlay.targetServicesReady(
    selectedTargetProfileId: String?,
    serviceOwnerConnection: ConnectionRef?,
    serviceOwnerAccount: String?,
    currentConnection: ConnectionRef?,
    currentAccount: String?,
): Boolean {
    val intended = targetProfileId ?: return true
    return selectedTargetProfileId == intended &&
        serviceOwnerConnection != null && serviceOwnerConnection == currentConnection &&
        serviceOwnerAccount != null && serviceOwnerAccount == currentAccount
}
