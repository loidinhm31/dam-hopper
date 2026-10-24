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
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.terminal.NativeTerminalSurface
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
    val preferencesStore: PreferencesStore? = null,
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

    var terminalFontSize: Int by mutableStateOf(
        preferencesStore?.let {
            WorkbenchPreferences.clampFont(it.loadPreferences().terminalFontSize)
        } ?: 14
    )
        private set

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

    fun updateTerminalFontSize(newSize: Int) {
        val clamped = WorkbenchPreferences.clampFont(newSize)
        if (clamped == terminalFontSize) return
        terminalFontSize = clamped
        preferencesStore?.let { store ->
            store.savePreferences(store.loadPreferences().copy(terminalFontSize = clamped))
        }
    }

    fun isInputAllowedForSession(sessionId: String): Boolean {
        return _isPanelVisible &&
            _isForeground &&
            !_isAuthorityRetired &&
            sessionId == activeSessionId &&
            destroyingSessionIds[sessionId] != true
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
