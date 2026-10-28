package dev.damhopper.nativeapp.ui.screens

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.snapshots.SnapshotStateMap
import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.settings.CommandHistoryStore
import dev.damhopper.nativeapp.features.settings.SettingsOwner
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.settings.ExplorerLanguageFilter
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import dev.damhopper.nativeapp.features.terminal.NativeTerminalSurface
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAttachQueue
import dev.damhopper.nativeapp.features.terminal.TerminalReadingStates
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel

/**
 * Record of a failed terminal command distinguishing definitely unsent items
 * from uncertain delivery across transport failures.
 */
data class FailedCommandRecord(
    val sessionId: String,
    val command: String,
    val isDeliveryUncertain: Boolean,
    val reason: String,
)

/**
 * Tagged input write bearing session, epoch, and incarnation tokens
 * ensuring FIFO execution and preventing cross-epoch / cross-session transmission.
 */
data class QueuedWrite(
    val sessionId: String,
    val controller: TerminalSessionController,
    val bytes: ByteArray,
    val epoch: Long,
    val incarnation: Long,
    val commandText: String? = null,
    val onResult: (Boolean, Boolean, String?) -> Unit,
)

/**
 * Retained non-Activity state owner for terminal sessions, surfaces, FIFO write queue,
 * active selection, and visibility-gated input policy.
 *
 * Invariants:
 * 1. Survives panel switches (Terminal, Files, Editor) and Activity rotation without closing controllers or killing remote PTYs.
 * 2. Enforces derived input policy: [isPanelVisible] && [isForeground] && ![isAuthorityRetired] && (activeSessionId == session.id).
 * 3. Write dispatch checks visibility and epoch immediately before submission; queued writes from prior inactive epochs are dropped.
 * 4. Surface view references are detachable without losing in-memory VT buffer contents or cursor/scrollback state.
 * 5. Idempotent [close] owns teardown when the workspace is truly closed.
 */
class ProjectTerminalState(
    val projectName: String,
    val connectionRef: ConnectionRef,
    val ownerScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),
) : AutoCloseable {

    val controllers: SnapshotStateMap<String, TerminalSessionController> = mutableStateMapOf()
    val surfaces: SnapshotStateMap<String, NativeTerminalSurface> = mutableStateMapOf()
    internal val attachQueues: MutableMap<TerminalSessionController, TerminalAttachQueue> = mutableMapOf()
    internal val readingStates: TerminalReadingStates = TerminalReadingStates()
    val destroyingSessionIds: SnapshotStateMap<String, Boolean> = mutableStateMapOf()
    val failedRecords: SnapshotStateList<FailedCommandRecord> = mutableStateListOf()
    val sessionDrafts: SnapshotStateMap<String, String> = mutableStateMapOf()

    val writeChannel: Channel<QueuedWrite> = Channel(capacity = 64)

    var activeSessionId: String? by mutableStateOf(null)
        internal set
    var activeSessionEpoch: Long by mutableStateOf(0L)
        internal set
    var attachmentRevision: Long by mutableStateOf(0L)
        internal set
    var attachmentAttemptToken: Long by mutableStateOf(0L)
        internal set

    private var _isPanelVisible by mutableStateOf(true)
    val isPanelVisible: Boolean get() = _isPanelVisible

    private var _isForeground by mutableStateOf(true)
    val isForeground: Boolean get() = _isForeground

    private var _isAuthorityRetired by mutableStateOf(false)
    val isAuthorityRetired: Boolean get() = _isAuthorityRetired

    private var _inputSuspended by mutableStateOf(false)

    /**
     * Live effective-cover predicate installed by the root (privacy, Settings, search, pending departure, local
     * terminal modals, sidebar popup, compact Agents). It is consulted at the actual input boundary so a send that was
     * already queued when a cover appeared is dropped; it never owns or resets another surface's cover.
     */
    var coverPredicate: () -> Boolean = { false }

    val isCommandInputFocused: MutableStateFlow<Boolean> = MutableStateFlow(false)
    val isImeComposing: MutableStateFlow<Boolean> = MutableStateFlow(false)
    /** The retained reactive preferences (set by the owner of the workspace; null in isolated tests). */
    var preferenceAccess: PreferenceAccess? = null

    /** Opt-in local command history of this device (null when no store is attached). */
    var commandHistory: ObservableCommandHistory? = null

    /** Exact owner the history scope derives from; set together with [commandHistory]. */
    var historyOwner: SettingsOwner? = null

    init {
        updateAllControllersInputPolicy()
    }

    fun setPanelVisible(visible: Boolean) {
        if (_isPanelVisible == visible) return
        _isPanelVisible = visible
        updateAllControllersInputPolicy()
    }

    fun onForeground() {
        if (_isForeground) return
        _isForeground = true
        attachmentRevision++
        updateAllControllersInputPolicy()
    }

    fun onBackground() {
        if (!_isForeground) return
        _isForeground = false
        updateAllControllersInputPolicy()
    }

    fun revokeAuthority() {
        _isAuthorityRetired = true
        updateAllControllersInputPolicy()
    }

    fun rebindAuthority(newConnection: ConnectionRef): Boolean {
        if (newConnection.profileId != connectionRef.profileId) return false
        _isAuthorityRetired = false
        updateAllControllersInputPolicy()
        return true
    }

    /**
     * Writes the terminal font through the one reactive preference truth. There is no local copy: screens read
     * [PreferenceAccess.preferences], so the pinch/step controls and Settings always agree.
     */
    fun updateTerminalFontSize(newSize: Int) {
        val clamped = WorkbenchPreferences.clampFont(newSize)
        val access = preferenceAccess ?: return
        if (clamped == access.current.terminalFontSize) return
        access.update { it.copy(terminalFontSize = clamped) }
    }

    /**
     * Hides terminal input without closing PTYs, drafts or surfaces (Settings, history or privacy covering it);
     * lifting it restores exactly the previous eligibility.
     */
    fun setInputSuspended(suspended: Boolean) {
        if (_inputSuspended == suspended) return
        _inputSuspended = suspended
        updateAllControllersInputPolicy()
    }

    val isInputSuspended: Boolean get() = _inputSuspended

    fun isInputAllowedForSession(sessionId: String): Boolean {
        return _isPanelVisible &&
            _isForeground &&
            !_isAuthorityRetired &&
            !_inputSuspended &&
            sessionId == activeSessionId &&
            destroyingSessionIds[sessionId] != true &&
            !coverPredicate()
    }

    /**
     * Mutation-only write of an already prevalidated exact selection (retained Agents activation): active ID and
     * selection epoch only - no logger, caller callback, attach/controller creation, input-policy work or IO. Callable
     * only from the admitted leaf; [updateAllControllersInputPolicy] runs afterwards.
     */
    fun commitVerifiedSelection(instance: TerminalAgentsInstanceKey) {
        if (activeSessionId == instance.terminalId) return
        activeSessionEpoch++
        activeSessionId = instance.terminalId
    }

    fun updateAllControllersInputPolicy() {
        controllers.forEach { (id, ctrl) ->
            val eligible = isInputAllowedForSession(id)
            ctrl.isPanelActive = eligible
            ctrl.isInputAllowed = { isInputAllowedForSession(id) }
        }
    }

    fun selectSession(newSessionId: String?, onSelected: ((String?) -> Unit)? = null) {
        if (newSessionId != null && destroyingSessionIds[newSessionId] == true) return
        if (activeSessionId == newSessionId) return

        val prevId = activeSessionId
        if (prevId != null) {
            controllers[prevId]?.isPanelActive = false
        }

        activeSessionEpoch++
        activeSessionId = newSessionId

        AppLogger.recordDiagnostic(
            type = "terminal",
            scope = "terminal-panel",
            message = "terminal.session_selected",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = newSessionId,
            metadata = mapOf("previousSessionId" to (prevId ?: "none"))
        )

        updateAllControllersInputPolicy()
        onSelected?.invoke(newSessionId)
    }

    fun getOrCreateController(
        id: String,
        incarnation: Long,
        factory: (id: String, incarnation: Long) -> TerminalSessionController,
    ): TerminalSessionController {
        val existing = controllers[id]
        if (existing != null) {
            if (existing.incarnation.toLong() < incarnation) {
                removeSessionLocal(id)
            } else {
                existing.isPanelActive = isInputAllowedForSession(id)
                existing.isInputAllowed = { isInputAllowedForSession(id) }
                return existing
            }
        }

        val ctrl = factory(id, incarnation)
        ctrl.isPanelActive = isInputAllowedForSession(id)
        ctrl.isInputAllowed = { isInputAllowedForSession(id) }
        controllers[id] = ctrl
        return ctrl
    }

    fun removeSessionLocal(id: String) {
        controllers.remove(id)?.let { controller ->
            attachQueues.remove(controller)
            readingStates.remove(controller)
            controller.close()
        }
        surfaces.remove(id)?.close()
    }

    fun isSessionForProject(session: TerminalSessionDetailed): Boolean {
        return session.project == projectName
    }

    fun isSessionSelectable(session: TerminalSessionDetailed): Boolean {
        return isSessionForProject(session) && destroyingSessionIds[session.id] != true
    }

    fun detachWidgets() {
        setPanelVisible(false)
    }

    override fun close() {
        _isAuthorityRetired = true
        updateAllControllersInputPolicy()
        ownerScope.cancel()
        writeChannel.close()
        controllers.values.forEach { ctrl ->
            ctrl.isPanelActive = false
            ctrl.close()
        }
        controllers.clear()
        surfaces.values.forEach { it.close() }
        surfaces.clear()
        attachQueues.clear()
        readingStates.clear()
        destroyingSessionIds.clear()
        failedRecords.clear()
        sessionDrafts.clear()
    }
}

/**
 * The single reactive preference truth for active-root consumers: the retained `SettingsRepository`
 * preferences flow plus its ordered updater. Consumers collect [preferences] and write through [update]; there is
 * no snapshot load/save copy anywhere in the terminal, workspace or file consumers.
 */
class PreferenceAccess(
    val preferences: StateFlow<WorkbenchPreferences>,
    private val updater: ((WorkbenchPreferences) -> WorkbenchPreferences) -> Unit,
    private val languageSelector: ((ExplorerLanguageFilter) -> Unit)? = null,
) {
    val current: WorkbenchPreferences get() = preferences.value

    fun update(transform: (WorkbenchPreferences) -> WorkbenchPreferences) = updater(transform)

    /**
     * Explicit user choice of an Explorer language family: always writes the real wire value (even when it equals
     * a legacy local fallback), unlike an ordinary preference update.
     */
    fun selectLanguageFilter(filter: ExplorerLanguageFilter) {
        val selector = languageSelector
        if (selector != null) selector(filter) else update { it.copy(explorerLanguageFilter = filter) }
    }
}

/** [CommandHistoryStore] that also reports a persistence failure and a content revision for live suggestions. */
interface ObservableCommandHistory : CommandHistoryStore {
    /** Non-null once recording stopped because storage failed; shown to the user, never retried silently. */
    val failure: StateFlow<String?>

    /** Advances whenever stored content or consent changes, so suggestions can be recomputed. */
    val revision: StateFlow<Long>
}

/** Allowed range of the terminal scroll-step preference (C1: 1..50). */
const val TERMINAL_SCROLL_STEP_MIN = 1
const val TERMINAL_SCROLL_STEP_MAX = 50

fun clampTerminalScrollStep(step: Int): Int = step.coerceIn(TERMINAL_SCROLL_STEP_MIN, TERMINAL_SCROLL_STEP_MAX)

enum class TerminalScrollDirection { UP, DOWN, TOP, BOTTOM }

/**
 * Target line index of an inline scroll control. UP/DOWN move by the clamped [step] lines (never past either end);
 * TOP/BOTTOM jump. An empty buffer always targets 0.
 */
fun terminalScrollTarget(currentIndex: Int, lastIndex: Int, direction: TerminalScrollDirection, step: Int): Int {
    if (lastIndex <= 0) return 0
    val s = clampTerminalScrollStep(step)
    return when (direction) {
        TerminalScrollDirection.UP -> (currentIndex - s).coerceIn(0, lastIndex)
        TerminalScrollDirection.DOWN -> (currentIndex + s).coerceIn(0, lastIndex)
        TerminalScrollDirection.TOP -> 0
        TerminalScrollDirection.BOTTOM -> lastIndex
    }
}

/**
 * Authoritative project of a session for the auto-switch preference: only a session the server assigned to a
 * project different from [currentProject] can switch it, and only when [autoSwitchEnabled]. A free terminal
 * (no project) and a same-project session preserve the current project.
 */
fun autoSwitchProjectFor(autoSwitchEnabled: Boolean, currentProject: String, sessionProject: String?): String? {
    if (!autoSwitchEnabled) return null
    val assigned = sessionProject?.takeIf { it.isNotBlank() } ?: return null
    return if (assigned == currentProject) null else assigned
}

/** App-local history suggestions for [draft]: none unless suggestions are enabled and the draft is non-blank. */
fun terminalSuggestionsFor(
    enabled: Boolean,
    history: CommandHistoryStore?,
    owner: SettingsOwner?,
    project: String,
    draft: String,
): List<String> {
    if (!enabled || history == null || owner == null || !history.enabled.value || draft.isBlank()) return emptyList()
    return history.suggestions(owner, project, draft)
}

/** Latest commit/branch line of the terminal header (existing target-qualified Git read APIs, no Git page). */
data class TerminalCommitStatus(val branch: String?, val shortHash: String?, val summary: String?) {
    fun describe(): String? {
        val parts = listOfNotNull(branch, shortHash, summary?.lineSequence()?.firstOrNull()?.take(60)).filter { it.isNotBlank() }
        return if (parts.isEmpty()) null else parts.joinToString(" · ")
    }
}

/** Outcome of reconciling a terminal screen's selectable sessions with an exact required terminal instance. */
sealed interface RequiredTerminalSelection {
    /** No exact intent applies: ordinary project-only selection policy. */
    data object NotRequired : RequiredTerminalSelection

    /** The exact ID + incarnation is selectable on this screen's server: select it. */
    data class Select(val terminalId: String) : RequiredTerminalSelection

    /** Missing, restarted or belonging to another server: explicit refusal; NEVER fall back to another terminal. */
    data class Refused(val reason: String) : RequiredTerminalSelection
}

/**
 * Exact-selection policy of a verified manual Agents activation. With a [required] instance only that terminal ID and
 * incarnation of this screen's [profileId] may be selected; a missing or restarted instance is an explicit refusal
 * and the ordinary `selectable.firstOrNull()` fallback never runs. Without one the ordinary policy applies unchanged.
 */
fun resolveRequiredTerminalSelection(
    required: TerminalAgentsInstanceKey?,
    profileId: String?,
    selectable: List<TerminalSessionDetailed>,
): RequiredTerminalSelection {
    if (required == null) return RequiredTerminalSelection.NotRequired
    if (profileId == null || required.profileId != profileId) {
        return RequiredTerminalSelection.Refused("The requested terminal belongs to another server.")
    }
    val exact = selectable.firstOrNull { it.id == required.terminalId && it.incarnation == required.incarnation }
    if (exact != null) return RequiredTerminalSelection.Select(exact.id)
    val restarted = selectable.any { it.id == required.terminalId }
    return RequiredTerminalSelection.Refused(
        if (restarted) {
            "The requested terminal was restarted. Refresh Agents and choose it again."
        } else {
            "The requested terminal is no longer available. Refresh Agents and choose it again."
        },
    )
}

/** True when [session] may be attached for the screen: an exact required instance only matches its own incarnation. */
fun isSessionAttachableForRequired(required: TerminalAgentsInstanceKey?, session: TerminalSessionDetailed): Boolean =
    required == null || required.terminalId != session.id || required.incarnation == session.incarnation
