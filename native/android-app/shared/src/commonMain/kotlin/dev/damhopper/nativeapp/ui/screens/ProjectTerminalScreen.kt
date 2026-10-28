package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import kotlinx.coroutines.delay
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.transport.WsState
import dev.damhopper.nativeapp.features.terminal.TerminalConnectionPresentation
import dev.damhopper.nativeapp.features.terminal.TerminalDiagnosticsDialog
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.settings.SettingsOwner
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.git.GitQueryRepository
import dev.damhopper.nativeapp.ui.theme.UnscaledDensity
import androidx.compose.ui.platform.LocalFocusManager
import kotlinx.coroutines.flow.MutableStateFlow
import dev.damhopper.nativeapp.features.terminal.NativeTerminalSurface
import dev.damhopper.nativeapp.features.terminal.VtTerminalSurface
import dev.damhopper.nativeapp.features.terminal.CreateSessionRequest
import dev.damhopper.nativeapp.features.terminal.TerminalModifier
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.terminal.TerminalAttachQueue
import dev.damhopper.nativeapp.features.terminal.TerminalReadingStates
import dev.damhopper.nativeapp.features.terminal.TerminalViewportEffects
import dev.damhopper.nativeapp.features.terminal.pinchedTerminalFontSize
import dev.damhopper.nativeapp.features.terminal.stepTerminalFontSize
import dev.damhopper.nativeapp.features.terminal.terminalGeometry
import dev.damhopper.nativeapp.features.terminal.terminalLineHeightSp
import dev.damhopper.nativeapp.features.terminal.TerminalDisplaySnapshot
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.datetime.Clock
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.flow.StateFlow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInventoryReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeKey
import dev.damhopper.nativeapp.ui.components.TerminalAgentsContext
import dev.damhopper.nativeapp.ui.components.TerminalAgentsSidebarHost
import dev.damhopper.nativeapp.ui.components.TerminalAgentsSidebarOverlay
import dev.damhopper.nativeapp.ui.components.isTerminalAgentsPinned
import dev.damhopper.nativeapp.ui.components.TERMINAL_AGENTS_PINNED_WIDTH
import dev.damhopper.nativeapp.ui.components.TerminalAgentsTrigger
import androidx.compose.runtime.SideEffect

/**
 * Standalone Mobile Terminal Display & Input Screen for a selected project.
 *
 * Flow stage: Profile Login -> Project List -> [ProjectTerminalScreen]
 *
 * Invariants:
 * 1. Output streams and historical replay MUST be routed through [TerminalSessionController]
 *    and [TerminalReplayGate] (no parallel unfenced buffers).
 * 2. Keystrokes, commands, and accessory shortcuts are strictly gated by [TerminalSessionController.sendInput]
 *    respecting [TerminalSessionController.isPanelActive] and privacy settings.
 * 3. Renders bounded VT rows with stable identities and user-controlled output following.
 *    Client-side "Clear" actions clear only the local display surface without affecting server stream offsets.
 * 4. Leaving the screen ("← Projects" back button) deactivates input fencing and cleans up local controllers
 *    without killing or removing the remote server PTY session.
 * 5. Input and accessory rows observe imePadding to stay docked above the IME.
 * 6. Zero WebView and zero floating action buttons.
 */
@Composable
fun ProjectTerminalScreen(
    projectName: String,
    terminalRepo: TerminalRepository?,
    onBackToProjects: () -> Unit,
    modifier: Modifier = Modifier,
    initialSessionId: String? = null,
    onSessionSelected: ((String?) -> Unit)? = null,
    profileId: String? = null,
    preferenceAccess: PreferenceAccess? = null,
    commandHistory: ObservableCommandHistory? = null,
    historyOwner: SettingsOwner? = null,
    worktreePath: String? = null,
    inputCovered: Boolean = false,
    retainedState: ProjectTerminalState? = null,
    showHeader: Boolean = true,
    /** Exact manual-activation intent: only this ID + incarnation may be selected; never `selectable.firstOrNull()`. */
    requiredTerminalInstance: TerminalAgentsInstanceKey? = null,
    /** Retained Agents roster participation (null: no sidebar, no inventory consumption). */
    agents: TerminalAgentsContext? = null,
    /** Reports the OR of this screen's own local modals/popups to the root (owner-token source). */
    onLocalCoverChanged: (Boolean) -> Unit = {},
) {
    // Resolve authoritative connection reference
    val connectionRef = terminalRepo?.apiClient?.connection

    // If repository or connection is not yet ready, render loading state
    if (terminalRepo == null || connectionRef == null) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(DamHopperColors.Background),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
                Text(
                    text = "Connecting to terminal service...",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 14.sp
                )
            }
        }
        return
    }

    val connectionKey = "${connectionRef.profileId}:${connectionRef.generation}:$projectName"

    // State scoped strictly to the active repository, connection, and project
    var sessions by remember(terminalRepo, connectionKey) { mutableStateOf<List<TerminalSessionDetailed>>(emptyList()) }
    var isLoadingSessions by remember(terminalRepo, connectionKey) { mutableStateOf(true) }
    var fallbackActiveSessionId by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var fallbackActiveSessionEpoch by remember(terminalRepo, connectionKey) { mutableStateOf(0L) }
    fun currentActiveSessionId(): String? = retainedState?.activeSessionId ?: fallbackActiveSessionId
    fun currentActiveSessionEpoch(): Long = retainedState?.activeSessionEpoch ?: fallbackActiveSessionEpoch
    val activeSessionId = currentActiveSessionId()
    val activeSessionEpoch = currentActiveSessionEpoch()
    val terminalWsState by (terminalRepo?.wsConnection?.state ?: remember { MutableStateFlow<WsState>(WsState.Disconnected) }).collectAsState()

    var showCreateDialog by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var showDiagnosticsDialog by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var sessionToKill by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var requiredRefusal by remember(terminalRepo, connectionKey, requiredTerminalInstance) { mutableStateOf<String?>(null) }
    var appliedInventoryRuntime by remember(terminalRepo, connectionKey) { mutableStateOf<TerminalAgentsRuntimeKey?>(null) }
    var appliedInventoryTicket by remember(terminalRepo, connectionKey) { mutableStateOf<Long?>(null) }
    var lastAgentsRuntime by remember(terminalRepo, connectionKey) { mutableStateOf<TerminalAgentsRuntimeKey?>(null) }
    var commandInput by remember(terminalRepo, connectionKey) { mutableStateOf("") }
    var uiErrorBanner by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var attachError by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var isDestructiveOpInProgress by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var isSyncFailure by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var pendingReconciliationId by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var fallbackAttachmentRevision by remember(terminalRepo, connectionKey) { mutableStateOf(0L) }
    var fallbackAttachmentAttemptToken by remember(terminalRepo, connectionKey) { mutableStateOf(0L) }
    fun currentAttachmentRevision(): Long = retainedState?.attachmentRevision ?: fallbackAttachmentRevision
    fun currentAttachmentAttemptToken(): Long = retainedState?.attachmentAttemptToken ?: fallbackAttachmentAttemptToken
    val attachmentRevision = currentAttachmentRevision()
    val attachmentAttemptToken = currentAttachmentAttemptToken()

    val fallbackOwnerScope = remember(terminalRepo, connectionKey) { CoroutineScope(Dispatchers.Main.immediate) }
    val ownerScope = retainedState?.ownerScope ?: fallbackOwnerScope

    val fallbackWriteChannel = remember(terminalRepo, connectionKey) { Channel<QueuedWrite>(capacity = 64) }
    val writeChannel = retainedState?.writeChannel ?: fallbackWriteChannel

    val fallbackControllers = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, TerminalSessionController>() }
    val controllers = retainedState?.controllers ?: fallbackControllers

    LaunchedEffect(terminalWsState) {
        if (terminalWsState !is WsState.Connected) {
            controllers.values.forEach { it.onSocketDisconnected() }
        }
    }

    val fallbackSurfaces = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, NativeTerminalSurface>() }
    val surfaces = retainedState?.surfaces ?: fallbackSurfaces

    val fallbackAttachQueues = remember(terminalRepo, connectionKey) { mutableMapOf<TerminalSessionController, TerminalAttachQueue>() }
    val attachQueues = retainedState?.attachQueues ?: fallbackAttachQueues

    val fallbackReadingStates = remember(terminalRepo, connectionKey) { TerminalReadingStates() }
    val readingStates = retainedState?.readingStates ?: fallbackReadingStates

    val fallbackDestroyingSessionIds = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, Boolean>() }
    val destroyingSessionIds = retainedState?.destroyingSessionIds ?: fallbackDestroyingSessionIds

    val fallbackFailedRecords = remember(terminalRepo, connectionKey) { mutableStateListOf<FailedCommandRecord>() }
    val failedRecords = retainedState?.failedRecords ?: fallbackFailedRecords

    val fallbackSessionDrafts = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, String>() }
    val sessionDrafts = retainedState?.sessionDrafts ?: fallbackSessionDrafts
    val terminalFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    var directInputState by remember { mutableStateOf(TextFieldValue("")) }
    var cursorVisible by remember { mutableStateOf(true) }
    val prefAccess = preferenceAccess ?: retainedState?.preferenceAccess
        ?: remember { PreferenceAccess(MutableStateFlow(WorkbenchPreferences()), {}) }
    val prefs by prefAccess.preferences.collectAsState()
    val terminalFontSize = prefs.terminalFontSize
    fun updateTerminalFontSize(newSize: Int) {
        val clamped = WorkbenchPreferences.clampFont(newSize)
        if (clamped == prefAccess.current.terminalFontSize) return
        prefAccess.update { it.copy(terminalFontSize = clamped) }
    }

    // Settings/history/privacy covering the terminal hides the inline controls and drops the IME.
    val covered = inputCovered || retainedState?.isInputSuspended == true
    val focusManager = LocalFocusManager.current
    LaunchedEffect(covered) {
        if (covered) {
            keyboardController?.hide()
            focusManager.clearFocus(force = true)
        }
    }

    val history = retainedState?.commandHistory ?: commandHistory
    val historyScopeOwner = retainedState?.historyOwner ?: historyOwner
    val historyRevision by (history?.revision ?: NO_HISTORY_REVISION).collectAsState()
    val historyEnabled by (history?.enabled ?: NO_HISTORY_ENABLED).collectAsState()
    val historyFailure by (history?.failure ?: NO_HISTORY_FAILURE).collectAsState()
    fun recordConfirmedCommand(command: String) {
        val owner = historyScopeOwner ?: return
        history?.record(owner, projectName, command)
    }
    var ctrlLatched by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var altLatched by remember(terminalRepo, connectionKey) { mutableStateOf(false) }

    var commitStatus by remember(terminalRepo, connectionKey, worktreePath) { mutableStateOf<TerminalCommitStatus?>(null) }
    LaunchedEffect(terminalRepo, connectionKey, worktreePath, prefs.terminalCommitStatusEnabled) {
        if (!prefs.terminalCommitStatusEnabled) {
            commitStatus = null
            return@LaunchedEffect
        }
        try {
            val git = GitQueryRepository(terminalRepo.apiClient)
            val branch = git.listBranches(projectName, worktreePath).firstOrNull { it.isCurrent && !it.isRemote }?.name
            val latest = git.getLog(projectName, worktreePath, limit = 1).firstOrNull()
            if (terminalRepo.apiClient.connection == connectionRef) {
                commitStatus = TerminalCommitStatus(branch, latest?.hash?.take(7), latest?.message)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            commitStatus = null
        }
    }

    fun isEligibleForInput(sessionId: String): Boolean {
        if (retainedState != null) {
            return retainedState.isInputAllowedForSession(sessionId)
        }
        return (sessionId == activeSessionId && destroyingSessionIds[sessionId] != true)
    }

    fun bumpActiveSessionEpoch() {
        if (retainedState != null) {
            retainedState.selectSession(retainedState.activeSessionId)
        } else {
            fallbackActiveSessionEpoch++
        }
    }
    val currentTerminalFontSize by rememberUpdatedState(terminalFontSize)
    val currentUpdateTerminalFontSize by rememberUpdatedState<(Int) -> Unit>(::updateTerminalFontSize)

    LaunchedEffect(activeSessionId) {
        while (true) {
            delay(500)
            cursorVisible = !cursorVisible
        }
    }

    var lastSinkAdmitted by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var lastSubmittedCommandText by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }

    fun isSessionForProject(session: TerminalSessionDetailed): Boolean {
        return session.project == projectName
    }

    fun isSessionSelectable(session: TerminalSessionDetailed): Boolean {
        return isSessionForProject(session) && destroyingSessionIds[session.id] != true
    }

    fun removeSessionLocal(id: String) {
        controllers.remove(id)?.let { controller ->
            attachQueues.remove(controller)
            readingStates.remove(controller)
            controller.close()
        }
        surfaces.remove(id)?.close()
    }

    fun selectSession(newSessionId: String?) {
        if (newSessionId != null && destroyingSessionIds[newSessionId] == true) return
        if (activeSessionId == newSessionId) return

        val prevId = activeSessionId
        if (prevId != null) {
            controllers[prevId]?.isPanelActive = false
            sessionDrafts[prevId] = commandInput
        }

        if (retainedState != null) {
            retainedState.selectSession(newSessionId, onSessionSelected)
        } else {
            fallbackActiveSessionEpoch++
            fallbackActiveSessionId = newSessionId
            onSessionSelected?.invoke(newSessionId)
        }

        if (newSessionId != null) {
            controllers[newSessionId]?.isPanelActive = isEligibleForInput(newSessionId)
            commandInput = sessionDrafts[newSessionId] ?: ""
        } else {
            commandInput = ""
        }
    }

    // Single background worker strictly serializing writes with epoch and boundary gating
    LaunchedEffect(terminalRepo, connectionKey) {
        launch(Dispatchers.Main.immediate) {
            for (item in writeChannel) {
                try {
                    val curEpoch = currentActiveSessionEpoch()
                    val curSession = currentActiveSessionId()
                    val isCurrent = (item.epoch == curEpoch) &&
                        (item.sessionId == curSession) &&
                        (terminalRepo.apiClient.connection == connectionRef) &&
                        (controllers[item.sessionId] === item.controller) &&
                        (destroyingSessionIds[item.sessionId] != true)

                    val isEligible = isCurrent &&
                        item.controller.isPanelActive &&
                        item.controller.isReplayCompleted &&
                        item.controller.gate.shouldForwardTerminalData() &&
                        item.controller.isInputAllowed() &&
                        isEligibleForInput(item.sessionId) &&
                        (item.controller.incarnation.toLong() == item.incarnation)

                    if (isEligible) {
                        val payload = item.bytes.decodeToString()
                        val capturedEpoch = item.epoch
                        val capturedCtrl = item.controller

                        val writeOutcome = withContext(Dispatchers.Default) {
                                if (capturedEpoch == currentActiveSessionEpoch() &&
                                terminalRepo.apiClient.connection == connectionRef &&
                                capturedCtrl.isPanelActive &&
                                isEligibleForInput(item.sessionId)
                            ) {
                                try {
                                    terminalRepo.writeTerminal(item.sessionId, payload)
                                    true
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    false
                                }
                            } else {
                                null
                            }
                        }

                        when (writeOutcome) {
                            true -> item.onResult(true, false, null)
                            false -> item.onResult(false, true, "Write failed during network transport (delivery uncertain)")
                            null -> item.onResult(false, false, "Input dropped: session changed or inactive before submission (unsent)")
                        }
                    } else {
                        item.onResult(false, false, "Input dropped: session inactive or preparing (unsent)")
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    item.onResult(false, true, "Write error: ${e.message ?: "unknown"}")
                }
            }
        }
    }

    fun getOrCreateController(id: String, incarnation: Long): TerminalSessionController {
        val existing = controllers[id]
        if (existing != null) {
            if (existing.incarnation.toLong() < incarnation) {
                // Incarnation bumped on server: clean up stale controller immediately
                removeSessionLocal(id)
            } else {
                return existing
            }
        }

        val surface = surfaces.getOrPut(id) {
            VtTerminalSurface()
        }

        val ctrl = TerminalSessionController(
            sessionId = id,
            initialIncarnation = incarnation,
            connectionRef = connectionRef,
            surface = surface,
            terminalRepository = terminalRepo
        )

        ctrl.onResizeBroadcast = { cols, rows ->
            ownerScope.launch {
                try {
                    terminalRepo.resizeTerminal(id, cols, rows)
                } catch (_: Throwable) {}
            }
        }

        ctrl.setRawInputSink { bytes ->
            val capturedCmd = lastSubmittedCommandText
            val item = QueuedWrite(
                sessionId = id,
                controller = ctrl,
                bytes = bytes,
                epoch = currentActiveSessionEpoch(),
                incarnation = ctrl.incarnation.toLong(),
                commandText = capturedCmd,
                onResult = { success, isDeliveryUncertain, error ->
                    // Only a transport-confirmed explicit submission is remembered; failed/uncertain never are.
                    if (success && capturedCmd != null) recordConfirmedCommand(capturedCmd)
                    if (!success) {
                        if (error != null) {
                            uiErrorBanner = error
                        }
                        if (capturedCmd != null) {
                            failedRecords.add(
                                FailedCommandRecord(
                                    sessionId = id,
                                    command = capturedCmd,
                                    isDeliveryUncertain = isDeliveryUncertain,
                                    reason = error ?: "Delivery failure"
                                )
                            )
                        }
                    }
                }
            )
            val admitted = writeChannel.trySend(item).isSuccess
            lastSinkAdmitted = admitted
            if (!admitted) {
                uiErrorBanner = "Terminal input buffer full"
                if (capturedCmd != null) {
                    failedRecords.add(
                        FailedCommandRecord(
                            sessionId = id,
                            command = capturedCmd,
                            isDeliveryUncertain = false,
                            reason = "Input buffer full"
                        )
                    )
                }
            }
        }

        ctrl.onRequestReattach = recovery@{ sId, offset ->
            if (sId != currentActiveSessionId() || controllers[sId] !== ctrl ||
                destroyingSessionIds[sId] == true || !ctrl.isPanelActive
            ) return@recovery
            val requestEpoch = currentActiveSessionEpoch()
            val requestIncarnation = ctrl.incarnation
            val requestToken = if (retainedState != null) ++retainedState.attachmentAttemptToken else ++fallbackAttachmentAttemptToken
            attachQueues.getOrPut(ctrl) { TerminalAttachQueue(ctrl, ownerScope) }.recover(
                capturedOffset = offset,
                isCurrent = {
                    terminalRepo.apiClient.connection == connectionRef &&
                        ctrl.isPanelActive && controllers[sId] === ctrl &&
                        destroyingSessionIds[sId] != true && sId == currentActiveSessionId() &&
                        requestEpoch == currentActiveSessionEpoch() && requestIncarnation == ctrl.incarnation &&
                        requestToken == currentAttachmentAttemptToken()
                },
                connect = {
                    if (terminalRepo.wsConnection?.state?.value !is WsState.Connected) {
                        throw ConnectionOwnerError("WebSocket is not connected", ConnectionErrorReason.UNAVAILABLE)
                    }
                },
                send = { capturedOffset -> terminalRepo.attachTerminal(sId, capturedOffset) },
                onResult = { error ->
                    if (error != null) {
                        uiErrorBanner = "Reattach failed: ${error.message ?: "network error"}"
                    }
                },
            )
        }

        ctrl.isPanelActive = isEligibleForInput(id)
        controllers[id] = ctrl
        return ctrl
    }

    suspend fun refreshSessions(
        prefetched: TerminalAgentsInventoryReceipt? = null,
        bumpAttachment: Boolean = true,
    ): Boolean {
        return try {
            var acceptedReceipt: TerminalAgentsInventoryReceipt? = prefetched
            val detailed = if (prefetched != null) {
                prefetched.sessions
            } else {
                // Roster participants consume the ONE shared coalesced inventory instead of a per-screen full list.
                val service = agents?.service
                val runtimeKey = lastAgentsRuntime
                if (service != null && runtimeKey != null) {
                    val shared = service.refreshInventory(runtimeKey, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
                    if (shared == null) {
                        // Inventory unavailable or failed: preserve existing sessions, do not wipe
                        return false
                    }
                    acceptedReceipt = shared
                    shared.sessions
                } else if (agents == null) {
                    // Nonparticipating screen (no retained agents service attached): own list request.
                    withContext(Dispatchers.Default) {
                        terminalRepo.listDetailed()
                    }
                } else {
                    // Participating screen awaiting runtime attachment: preserve existing sessions
                    return false
                }
            }
            if (terminalRepo.apiClient.connection != connectionRef) return false

            // Immediately invalidate any local controllers with stale incarnation BEFORE updating state
            for (s in detailed) {
                val existing = controllers[s.id]
                if (existing != null && existing.incarnation.toLong() < s.incarnation.toLong()) {
                    removeSessionLocal(s.id)
                }
            }

            sessions = detailed

            // Prune vanished sessions strictly based on server existence, not temporary destruction lock
            val projectIds = detailed.filter { isSessionForProject(it) }.map { it.id }.toSet()
            val vanishedIds = controllers.keys.filter { it !in projectIds }
            vanishedIds.forEach { removeSessionLocal(it) }

            // Validate selectable sessions
            val selectable = detailed.filter { isSessionSelectable(it) }

            // Handle pending reconciliation
            val pendingId = pendingReconciliationId
            if (pendingId != null) {
                if (selectable.any { it.id == pendingId }) {
                    pendingReconciliationId = null
                    isSyncFailure = false
                    uiErrorBanner = null
                    if (activeSessionId == null) {
                        selectSession(pendingId)
                    }
                } else {
                    uiErrorBanner = "Session created on server but reconciliation was missing new session ID. Tap Retry Sync."
                    isSyncFailure = true
                }
            } else {
                val currentActive = activeSessionId
                when (val exact = resolveRequiredTerminalSelection(requiredTerminalInstance, connectionRef.profileId, selectable)) {
                    is RequiredTerminalSelection.Select -> {
                        requiredRefusal = null
                        if (currentActiveSessionId() != exact.terminalId) selectSession(exact.terminalId)
                    }
                    // Exact intent: explicit refusal, never the first selectable terminal.
                    is RequiredTerminalSelection.Refused -> requiredRefusal = exact.reason
                    RequiredTerminalSelection.NotRequired -> {
                        requiredRefusal = null
                        val requested = initialSessionId?.takeIf { initId -> selectable.any { it.id == initId } }
                        if (requested != null && (currentActive == null || currentActive != requested)) {
                            selectSession(requested)
                        } else if (currentActive == null || selectable.none { it.id == currentActive }) {
                            selectSession(selectable.firstOrNull()?.id)
                        }
                    }
                }
                isSyncFailure = false
            }

            if (bumpAttachment) {
                if (retainedState != null) retainedState.attachmentRevision++ else fallbackAttachmentRevision++
            }
            appliedInventoryRuntime = acceptedReceipt?.runtime
            appliedInventoryTicket = acceptedReceipt?.requestTicket
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            uiErrorBanner = "Session sync failed: ${e.message ?: "network error"}. Tap to retry."
            isSyncFailure = true
            false
        } finally {
            isLoadingSessions = false
        }
    }

    // Establish WebSocket stream listeners with UNDISPATCHED startup to guarantee subscription before attachment
    LaunchedEffect(terminalRepo, connectionKey) {
        launch(start = CoroutineStart.UNDISPATCHED) {
            terminalRepo.terminalOutput.collect { msg ->
                controllers[msg.id]?.handleLiveChunk(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.incarnation
                )
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            terminalRepo.terminalBuffer.collect { msg ->
                controllers[msg.id]?.handleBufferReplay(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.reset,
                    msg.truncated,
                    msg.incarnation
                )
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            terminalRepo.terminalExit.collect { msg ->
                controllers[msg.id]?.handleExit(
                    msg.exitCode,
                    msg.willRestart,
                    msg.restartCount,
                    msg.incarnation
                )
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            terminalRepo.terminalLagged.collect { msg ->
                activeSessionId?.let { id ->
                    controllers[id]?.handleLagged(msg.dropped)
                }
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            terminalRepo.processRestarted.collect { msg ->
                controllers[msg.id]?.handleProcessRestarted(
                    msg.restartCount,
                    msg.previousExitCode
                )
            }
        }

        refreshSessions()
    }

    // Shared inventory consumption: the exact current receipt of this screen's runtime updates the composition-local
    // sessions without any per-screen request; each receipt is applied once (ticket dedupe, no echo loop).
    val agentInventories by (agents?.service?.inventories ?: NO_AGENT_INVENTORIES).collectAsState()
    val currentReceipt = agentInventories.values.firstOrNull { it.runtime.connection == connectionRef }
    LaunchedEffect(currentReceipt?.runtime, currentReceipt?.requestTicket) {
        val receipt = currentReceipt ?: return@LaunchedEffect
        lastAgentsRuntime = receipt.runtime
        if (appliedInventoryRuntime != receipt.runtime || appliedInventoryTicket != receipt.requestTicket) {
            refreshSessions(prefetched = receipt, bumpAttachment = false)
        }
    }

    val eligibleSessions = remember(sessions, projectName, destroyingSessionIds.size) {
        sessions.filter { isSessionSelectable(it) }
    }

    val activeSession = eligibleSessions.find {
        it.id == activeSessionId && isSessionAttachableForRequired(requiredTerminalInstance, it)
    }

    // Publish the accepted selectable tabs + explicit exclusions of the exact applied receipt (never initiates a fetch).
    val agentsRegistration = agents?.registration
    val destroyingKeys = destroyingSessionIds.keys.toSet()
    LaunchedEffect(
        agentsRegistration,
        currentReceipt?.runtime,
        currentReceipt?.requestTicket,
        currentReceipt?.invalidationRevision,
        appliedInventoryRuntime,
        appliedInventoryTicket,
        eligibleSessions,
        destroyingKeys,
    ) {
        val service = agents?.service ?: return@LaunchedEffect
        val receipt = currentReceipt ?: return@LaunchedEffect
        if (agentsRegistration != null && appliedInventoryRuntime == receipt.runtime && appliedInventoryTicket == receipt.requestTicket) {
            service.publishWorkspaceTabs(agentsRegistration, receipt, eligibleSessions, destroyingKeys)
        }
    }

    // This effect does not own the send job: per-controller ordering survives effect replacement.
    val connectedSocketRef = (terminalWsState as? WsState.Connected)?.socketRef
    LaunchedEffect(activeSessionId, activeSession?.incarnation, attachmentRevision, terminalRepo, connectionKey, connectedSocketRef) {
        val session = activeSession ?: return@LaunchedEffect
        if (destroyingSessionIds[session.id] == true) return@LaunchedEffect
        val ctrl = getOrCreateController(session.id, session.incarnation.toLong())
        ctrl.isPanelActive = isEligibleForInput(session.id)
        val requestToken = if (retainedState != null) ++retainedState.attachmentAttemptToken else ++fallbackAttachmentAttemptToken
        val requestEpoch = currentActiveSessionEpoch()
        val requestIncarnation = ctrl.incarnation
        attachQueues.getOrPut(ctrl) { TerminalAttachQueue(ctrl, ownerScope) }.attach(
            isCurrent = {
                requestToken == currentAttachmentAttemptToken() && session.id == currentActiveSessionId() &&
                    requestEpoch == currentActiveSessionEpoch() && ctrl.incarnation == requestIncarnation &&
                    terminalRepo.apiClient.connection == connectionRef &&
                    destroyingSessionIds[session.id] != true && controllers[session.id] === ctrl
            },
            connect = {
                if (terminalRepo.wsConnection?.state?.value !is WsState.Connected) {
                    throw ConnectionOwnerError("WebSocket is not connected", ConnectionErrorReason.UNAVAILABLE)
                }
            },
            send = { capturedOffset -> terminalRepo.attachTerminal(session.id, capturedOffset) },
            onResult = { error ->
                attachError = if (error == null) null else "Failed to attach terminal to server"
                AppLogger.recordDiagnostic(
                    type = "transport",
                    scope = "terminal-panel",
                    message = if (error == null) "terminal.attach_succeeded" else "terminal.attach_failed",
                    profileId = connectionRef.profileId,
                    generation = connectionRef.generation,
                    sessionId = session.id,
                )
            },
        )
    }

    // Clean detachment on unmount or connection invalidation: deactivate input, close local controllers and surfaces
    DisposableEffect(terminalRepo, connectionKey, retainedState) {
        if (retainedState != null) {
            retainedState.setPanelVisible(true)
        }
        onDispose {
            if (retainedState != null) {
                retainedState.detachWidgets()
            } else {
                ownerScope.cancel()
                writeChannel.close()
                controllers.values.forEach { ctrl ->
                    ctrl.isPanelActive = false
                    ctrl.close()
                }
                controllers.clear()
                surfaces.values.forEach { surf ->
                    surf.detachView()
                    surf.close()
                }
                surfaces.clear()
                attachQueues.clear()
                readingStates.clear()
                destroyingSessionIds.clear()
                failedRecords.clear()
                sessionDrafts.clear()
            }
        }
    }

    val activeController = activeSession?.let { controllers[it.id] }
    val activeSurface = activeSession?.let { surfaces[it.id] }
    LaunchedEffect(cursorVisible, activeSurface) {
        (activeSurface as? VtTerminalSurface)?.updateCursorBlink(cursorVisible)
    }

    fun sendCommand() {
        val cmd = commandInput
        val ctrl = activeController
        if (ctrl == null) {
            uiErrorBanner = "Cannot send command: no active terminal session"
            return
        }
        if (destroyingSessionIds[ctrl.sessionId] == true) {
            uiErrorBanner = "Cannot send command: session is being closed"
            return
        }
        if (!ctrl.isPanelActive) {
            uiErrorBanner = "Cannot send command: session is inactive"
            return
        }
        if (!ctrl.isReplayCompleted) {
            uiErrorBanner = "Cannot send command: terminal buffer is replaying"
            return
        }
        if (!ctrl.isInputAllowed()) {
            bumpActiveSessionEpoch()
            uiErrorBanner = "Cannot send command: input blocked by privacy settings"
            return
        }

        lastSinkAdmitted = false
        lastSubmittedCommandText = cmd
        try {
            // Strictly routes through controller.sendInput, invoking rawInputSink
            ctrl.sendInput("$cmd\r".encodeToByteArray())
            if (lastSinkAdmitted) {
                commandInput = ""
                uiErrorBanner = null
            } else if (uiErrorBanner == null) {
                uiErrorBanner = "Command rejected: input queue full or dropped"
            }
        } finally {
            lastSubmittedCommandText = null
        }
    }

    fun sendSpecialKey(keyName: String) {
        val ctrl = activeController ?: return
        if (destroyingSessionIds[ctrl.sessionId] == true) return
        lastSubmittedCommandText = null
        lastSinkAdmitted = false
        ctrl.sendInput(ctrl.encodeSpecialKey(keyName))
        if (!lastSinkAdmitted && uiErrorBanner == null) {
            uiErrorBanner = "Accessory key dropped: input queue full or inactive"
        }
    }

    fun sendCtrlChar(char: Char) {
        val ctrl = activeController ?: return
        if (destroyingSessionIds[ctrl.sessionId] == true) return
        lastSubmittedCommandText = null
        lastSinkAdmitted = false
        if (!ctrl.isModifierActive(TerminalModifier.CTRL)) ctrl.toggleModifier(TerminalModifier.CTRL)
        ctrl.sendInput(ctrl.encodeKey(char))
        if (!lastSinkAdmitted && uiErrorBanner == null) {
            uiErrorBanner = "Accessory key dropped: input queue full or inactive"
        }
    }

    fun onAccessoryAction(action: AccessoryAction) {
        when (action) {
            is AccessoryAction.Special -> {
                sendSpecialKey(action.name)
                ctrlLatched = false
                altLatched = false
            }
            is AccessoryAction.CtrlChar -> {
                sendCtrlChar(action.char)
                ctrlLatched = false
                altLatched = false
            }
            AccessoryAction.ToggleCtrl -> {
                activeController?.toggleModifier(TerminalModifier.CTRL)
                ctrlLatched = !ctrlLatched
            }
            AccessoryAction.ToggleAlt -> {
                activeController?.toggleModifier(TerminalModifier.ALT)
                altLatched = !altLatched
            }
            AccessoryAction.ShowKeyboard -> {
                terminalFocusRequester.requestFocus()
                keyboardController?.show()
            }
            AccessoryAction.ClearLocalDisplay -> {
                AppLogger.recordDiagnostic(
                    type = "terminal",
                    scope = "terminal-panel",
                    message = "terminal.local_buffer_cleared",
                    profileId = connectionRef.profileId,
                    generation = connectionRef.generation,
                    sessionId = activeSessionId
                )
                (activeSurface as? VtTerminalSurface)?.clearDisplayBuffer()
            }
        }
    }

    // Cover reporting: this screen's local modals are ONE source (owner token); disposal clears only this source.
    val coverOwner = remember { Any() }
    val localModalOpen = showCreateDialog || showDiagnosticsDialog || sessionToKill != null
    val agentsHost = agents?.host
    val currentOnLocalCoverChanged by rememberUpdatedState(onLocalCoverChanged)
    SideEffect {
        agentsHost?.setLocalCover(coverOwner, localModalOpen)
        currentOnLocalCoverChanged(localModalOpen)
    }
    DisposableEffect(coverOwner, agentsHost) {
        onDispose {
            agentsHost?.setLocalCover(coverOwner, false)
            currentOnLocalCoverChanged(false)
        }
    }
    // The live effective cover is also consulted at the actual input boundary (queued sends, accessory, hardware).
    DisposableEffect(retainedState, agentsHost) {
        if (retainedState != null && agentsHost != null) retainedState.coverPredicate = { agentsHost.effectiveCover }
        onDispose {
            if (retainedState != null && agentsHost != null) retainedState.coverPredicate = { false }
        }
    }

    val pinned = agents != null && agents.host.pinned == true
    val pinnedOpen = agents != null && agents.host.open && pinned
    val startPadding = if (pinnedOpen) TERMINAL_AGENTS_PINNED_WIDTH + 1.dp else 0.dp

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(start = startPadding)
                .background(DamHopperColors.Background)
                .imePadding()
        ) {
            if (showHeader) {
                TerminalTopHeader(
                    projectName = projectName,
                    terminalFontSize = terminalFontSize,
                    canDecreaseFont = terminalFontSize > WorkbenchPreferences.FONT_MIN,
                    canIncreaseFont = terminalFontSize < WorkbenchPreferences.FONT_MAX,
                    updateTerminalFontSize = { updateTerminalFontSize(it) },
                    onBackToProjects = onBackToProjects,
                    onShowDiagnostics = { showDiagnosticsDialog = true },
                    onShowCreate = { showCreateDialog = true },
                    agents = agents,
                )
            } else {
                TerminalSubHeader(
                    terminalFontSize = terminalFontSize,
                    canDecreaseFont = terminalFontSize > WorkbenchPreferences.FONT_MIN,
                    canIncreaseFont = terminalFontSize < WorkbenchPreferences.FONT_MAX,
                    updateTerminalFontSize = { updateTerminalFontSize(it) },
                    onShowDiagnostics = { showDiagnosticsDialog = true },
                    onShowCreate = { showCreateDialog = true },
                    agents = agents,
                )
            }

            TerminalSessionTabs(
                sessions = eligibleSessions,
                activeSessionId = activeSessionId,
                onSelectSession = { selectSession(it) },
                onKillSession = { sessionToKill = it },
                wsState = terminalWsState,
                controllers = controllers,
            )

        // Exact manual-activation refusal: the required terminal is missing/restarted; never another terminal.
        requiredRefusal?.let { refusal ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Warning)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = refusal,
                    color = DamHopperColors.Background,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = "Refresh",
                    color = DamHopperColors.Background,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { ownerScope.launch { refreshSessions() } }
                )
            }
        }

        // Attach Error Banner
        attachError?.let { err ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Error)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = err, color = DamHopperColors.TextPrimary, fontSize = 11.sp)
                Text(
                    text = "Retry",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { if (retainedState != null) retainedState.attachmentRevision++ else fallbackAttachmentRevision++ }
                )
            }
        }

        // Failed Command History / Unsent Recovery Banner (rendered independently of transient error banner)
        val pendingFailedRecord = activeSessionId?.let { sId -> failedRecords.lastOrNull { it.sessionId == sId } }
        if (pendingFailedRecord != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (pendingFailedRecord.isDeliveryUncertain) DamHopperColors.SurfaceVariant else DamHopperColors.Warning)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = if (pendingFailedRecord.isDeliveryUncertain) {
                        "Uncertain delivery (may execute twice): \"${pendingFailedRecord.command}\""
                    } else {
                        "Unsent command: \"${pendingFailedRecord.command}\""
                    },
                    color = if (pendingFailedRecord.isDeliveryUncertain) DamHopperColors.Warning else DamHopperColors.Background,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Restore",
                        color = if (pendingFailedRecord.isDeliveryUncertain) DamHopperColors.Primary else DamHopperColors.Background,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable {
                            if (commandInput.isEmpty()) {
                                commandInput = pendingFailedRecord.command
                                failedRecords.remove(pendingFailedRecord)
                            } else {
                                uiErrorBanner = "Draft \"${pendingFailedRecord.command}\" retained. Clear input field to restore."
                            }
                        }
                    )
                    Text(
                        text = "Discard",
                        color = if (pendingFailedRecord.isDeliveryUncertain) DamHopperColors.TextSecondary else DamHopperColors.Background,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { failedRecords.remove(pendingFailedRecord) }
                    )
                }
            }
        }

        // Transient Error / Sync Recovery Banner
        uiErrorBanner?.let { err ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Warning)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = err, color = DamHopperColors.Background, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (isSyncFailure) {
                        Text(
                            text = "Retry Sync",
                            color = DamHopperColors.Background,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.clickable { ownerScope.launch { refreshSessions() } }
                        )
                    }
                    Text(
                        text = "✕",
                        color = DamHopperColors.Background,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { uiErrorBanner = null }
                    )
                }
            }
        }

        commitStatus?.describe()?.let { line ->
            Text(
                text = line,
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp,
                fontFamily = JetBrainsMonoFontFamily,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .padding(horizontal = 12.dp, vertical = 2.dp)
                    .semantics { contentDescription = "Latest commit $line" },
            )
        }

        // 3. Status & Exit Banner
        if (activeController?.isExited == true) {
            val exitCode = activeController.exitCode
            val willRestart = activeController.willRestart
            val bannerColor = if (exitCode == 0) DamHopperColors.SurfaceVariant else DamHopperColors.Error
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(bannerColor)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "Process exited with code ${exitCode ?: "unknown"}${if (willRestart) " (restarting...)" else ""}",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Restart",
                        color = DamHopperColors.Primary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .clickable {
                                if (isDestructiveOpInProgress) return@clickable
                                val targetId = activeSessionId ?: return@clickable
                                val oldSession = sessions.find { it.id == targetId }
                                val cmd = oldSession?.command ?: "sh"
                                val name = oldSession?.name
                                ownerScope.launch {
                                    isDestructiveOpInProgress = true
                                    destroyingSessionIds[targetId] = true
                                    controllers[targetId]?.isPanelActive = false
                                    bumpActiveSessionEpoch()
                                    try {
                                        withContext(Dispatchers.Default) {
                                            terminalRepo.removeSession(targetId)
                                        }
                                        removeSessionLocal(targetId)
                                        sessions = sessions.filter { it.id != targetId }
                                        val next = sessions.filter { isSessionSelectable(it) }.firstOrNull()?.id
                                        if (activeSessionId == targetId) {
                                            selectSession(next)
                                        }

                                        val newId = withContext(Dispatchers.Default) {
                                            val id = "term-${Clock.System.now().toEpochMilliseconds()}"
                                            terminalRepo.createSession(
                                                CreateSessionRequest(
                                                    id = id,
                                                    command = cmd,
                                                    name = name,
                                                    project = projectName
                                                )
                                            )
                                            id
                                        }
                                        pendingReconciliationId = newId
                                        refreshSessions()
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        uiErrorBanner = "Restart failed: ${e.message ?: "remote error"}"
                                    } finally {
                                        destroyingSessionIds.remove(targetId)
                                        isDestructiveOpInProgress = false
                                        val syncSuccess = refreshSessions()
                                        if (!syncSuccess && activeSessionId == targetId) {
                                            controllers[targetId]?.isPanelActive = isEligibleForInput(targetId)
                                        }
                                    }
                                }
                            }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                    Text(
                        text = "Remove",
                        color = DamHopperColors.Error,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .clickable {
                                if (isDestructiveOpInProgress) return@clickable
                                val targetId = activeSessionId ?: return@clickable
                                ownerScope.launch {
                                    isDestructiveOpInProgress = true
                                    destroyingSessionIds[targetId] = true
                                    controllers[targetId]?.isPanelActive = false
                                    bumpActiveSessionEpoch()
                                    try {
                                        withContext(Dispatchers.Default) {
                                            terminalRepo.removeSession(targetId)
                                        }
                                        removeSessionLocal(targetId)
                                        sessions = sessions.filter { it.id != targetId }
                                        val next = sessions.filter { isSessionSelectable(it) }.firstOrNull()?.id
                                        if (activeSessionId == targetId) {
                                            selectSession(next)
                                        }
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        uiErrorBanner = "Removal failed: ${e.message ?: "remote error"}"
                                    } finally {
                                        destroyingSessionIds.remove(targetId)
                                        isDestructiveOpInProgress = false
                                        val syncSuccess = refreshSessions()
                                        if (!syncSuccess && activeSessionId == targetId) {
                                            controllers[targetId]?.isPanelActive = isEligibleForInput(targetId)
                                        }
                                    }
                                }
                            }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
        }

        // 4. Main Console Output Area. Each retained controller keeps its own reading intent.
        val vtSurface = activeSurface as? VtTerminalSurface
        val snapshot = vtSurface?.displaySnapshot ?: TerminalDisplaySnapshot()
        val lines = snapshot.lines
        val lineIds = snapshot.lineIds
        val readingState = readingStates.forController(activeController)
        TerminalViewportEffects(readingState, lineIds, snapshot.revision)
        val scrollScope = rememberCoroutineScope()
        fun scrollTerminal(direction: TerminalScrollDirection) {
            val reading = readingState
            val lastIndex = lineIds.lastIndex
            scrollScope.launch {
                reading.programmaticScroll = true
                try {
                    val target = terminalScrollTarget(
                        reading.list.firstVisibleItemIndex, lastIndex, direction, prefs.terminalScrollStep,
                    )
                    reading.follow.beginUserScroll()
                    reading.list.scrollToItem(target)
                    reading.follow.observeUserScroll(
                        atBottom = !reading.list.canScrollForward,
                        firstRowId = lineIds.getOrNull(reading.list.firstVisibleItemIndex),
                        offset = reading.list.firstVisibleItemScrollOffset,
                    )
                } finally {
                    reading.programmaticScroll = false
                }
            }
        }
        // The terminal font is its own preference: keep it out of the system font-size scaling.
        UnscaledDensity {
        val density = LocalDensity.current
        val terminalTextStyle = remember(terminalFontSize) {
            TextStyle(
                color = DamHopperColors.TextPrimary,
                fontSize = terminalFontSize.sp,
                fontFamily = JetBrainsMonoFontFamily,
                fontFeatureSettings = "calt 0",
                lineHeight = terminalLineHeightSp(terminalFontSize).sp,
                lineHeightStyle = LineHeightStyle(
                    alignment = LineHeightStyle.Alignment.Center,
                    trim = LineHeightStyle.Trim.None,
                ),
            )
        }
        val textMeasurer = rememberTextMeasurer()
        val cellMetrics = remember(textMeasurer, terminalTextStyle, density.density, density.fontScale) {
            textMeasurer.measure("M", style = terminalTextStyle, softWrap = false, maxLines = 1)
        }
        val glyphAdvancePx = cellMetrics.multiParagraph.getLineRight(0) - cellMetrics.multiParagraph.getLineLeft(0)
        val lineHeightPx = cellMetrics.size.height.toFloat()

        BoxWithConstraints(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(DamHopperColors.Background)
                .pointerInput(prefAccess) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var segmentStartSp = 0
                        var continuousSize = 0f
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            var pressedCount = 0
                            for (i in 0 until event.changes.size) {
                                if (event.changes[i].pressed) pressedCount++
                            }
                            if (pressedCount >= 2) {
                                if (segmentStartSp == 0) {
                                    segmentStartSp = currentTerminalFontSize
                                    continuousSize = segmentStartSp.toFloat()
                                }
                                val zoomChange = event.calculateZoom()
                                if (zoomChange.isFinite() && zoomChange > 0f && zoomChange != 1f) {
                                    continuousSize = (continuousSize * zoomChange).coerceIn(
                                        WorkbenchPreferences.FONT_MIN.toFloat(),
                                        WorkbenchPreferences.FONT_MAX.toFloat(),
                                    )
                                    val nextSize = pinchedTerminalFontSize(
                                        startFontSizeSp = segmentStartSp,
                                        zoomFactor = continuousSize / segmentStartSp.toFloat(),
                                    )
                                    currentUpdateTerminalFontSize(nextSize)
                                }
                                for (i in 0 until event.changes.size) {
                                    event.changes[i].consume()
                                }
                            } else {
                                segmentStartSp = 0
                                continuousSize = 0f
                            }
                            if (pressedCount == 0) break
                        }
                    }
                }
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) {
                    terminalFocusRequester.requestFocus()
                    keyboardController?.show()
                }
                .padding(horizontal = 8.dp, vertical = 4.dp)
        ) {
            // Box constraints already exclude the actual 8dp/4dp content padding above.
            val geometry = remember(maxWidth, maxHeight, glyphAdvancePx, lineHeightPx, density.density) {
                terminalGeometry(
                    contentWidthPx = with(density) { maxWidth.toPx() },
                    contentHeightPx = with(density) { maxHeight.toPx() },
                    glyphAdvancePx = glyphAdvancePx,
                    lineHeightPx = lineHeightPx,
                )
            }
            LaunchedEffect(geometry, activeController) {
                if (activeController != null && readingState.geometry.update(geometry)) {
                    activeController.resize(geometry.columns, geometry.rows)
                }
            }

            // Invisible direct IME input receiver for real-time keystroke interaction
            BasicTextField(
                value = directInputState,
                onValueChange = { newValue ->
                    retainedState?.isImeComposing?.value = newValue.composition != null
                    val newText = newValue.text
                    val oldText = directInputState.text
                    if (newText.length > oldText.length) {
                        val added = newText.substring(oldText.length)
                        for (ch in added) {
                            if (ch == '\n') {
                                activeController?.sendInput(byteArrayOf(0x0D))
                            } else {
                                activeController?.let { c ->
                                    if (ctrlLatched || altLatched) {
                                        c.sendInput(c.encodeKey(ch))
                                        ctrlLatched = false
                                        altLatched = false
                                    } else {
                                        c.sendInput(ch.toString().encodeToByteArray())
                                    }
                                }
                            }
                        }
                    } else if (newText.length < oldText.length) {
                        val deletedCount = oldText.length - newText.length
                        repeat(deletedCount) {
                            activeController?.sendInput(byteArrayOf(0x7F))
                        }
                    }
                    directInputState = if (newText.length > 50) TextFieldValue("") else newValue
                },
                keyboardOptions = KeyboardOptions(
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.None,
                ),
                keyboardActions = KeyboardActions(
                    onAny = {
                        activeController?.sendInput(byteArrayOf(0x0D))
                    }
                ),
                modifier = Modifier
                    .focusRequester(terminalFocusRequester)
                    .size(1.dp)
                    .alpha(0.01f)
                    .onFocusChanged {
                        if (!it.isFocused) retainedState?.isImeComposing?.value = false
                    }
            )
            if (eligibleSessions.isEmpty() && !isLoadingSessions) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "No active terminal session for $projectName",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = {
                            ownerScope.launch {
                                try {
                                    val newId = withContext(Dispatchers.Default) {
                                        val id = "term-${Clock.System.now().toEpochMilliseconds()}"
                                        terminalRepo.createSession(
                                            CreateSessionRequest(
                                                id = id,
                                                command = "sh",
                                                name = "$projectName Shell",
                                                project = projectName
                                            )
                                        )
                                        id
                                    }
                                    pendingReconciliationId = newId
                                    refreshSessions()
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    uiErrorBanner = "Failed to start terminal: ${e.message}"
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                    ) {
                        Text("Start Terminal Session")
                    }
                }
            } else if (activeSession == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DamHopperColors.Primary)
                }
            } else if (lines.isEmpty()) {
                Column(modifier = Modifier.fillMaxSize().padding(8.dp)) {
                    Text(
                        text = "$ ${activeSession.command}",
                        color = DamHopperColors.Success,
                        fontSize = 13.sp,
                        fontFamily = JetBrainsMonoFontFamily
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (terminalWsState !is WsState.Connected) {
                            "Terminal offline. Reconnecting to service..."
                        } else if (activeController?.isReplayCompleted == true) {
                            "Terminal connected. Interactive session ready."
                        } else {
                            "Replaying stream buffer..."
                        },
                        color = DamHopperColors.TextSecondary,
                        fontSize = 12.sp,
                        fontFamily = JetBrainsMonoFontFamily
                    )
                }
            } else {
                LazyColumn(
                    state = readingState.list,
                    modifier = Modifier.fillMaxSize()
                ) {
                    itemsIndexed(
                        items = lines,
                        // IDs carry the surface namespace and survive row movement/eviction.
                        key = { index, _ -> lineIds[index] }
                    ) { _, line ->
                        Text(
                            text = if (line.isEmpty()) AnnotatedString(" ") else line,
                            style = terminalTextStyle,
                            softWrap = false,
                            maxLines = 1,
                            overflow = TextOverflow.Clip,
                            modifier = Modifier.height(with(density) { lineHeightPx.toDp() }),
                        )
                    }
                }
            }
        }
        }

        // 5. Inline scroll controls (1..50 lines per step) and the native accessory keyboard.
        if (activeController != null && prefs.terminalScrollButtonsEnabled && !covered) {
            TerminalScrollControls(
                step = clampTerminalScrollStep(prefs.terminalScrollStep),
                onScroll = { scrollTerminal(it) },
            )
        }
        // Strictly inline above IME, ZERO floating action buttons!
        if (activeController != null) {
            val suggestions = if (covered) {
                emptyList()
            } else {
                remember(historyRevision, historyEnabled, commandInput, prefs.terminalSuggestionsEnabled, projectName, historyScopeOwner) {
                    terminalSuggestionsFor(prefs.terminalSuggestionsEnabled, history, historyScopeOwner, projectName, commandInput)
                }
            }
            TerminalAccessoryAndCommandBar(
                commandInput = commandInput,
                onCommandInputChange = { commandInput = it },
                onSend = { sendCommand() },
                onFocusChanged = { retainedState?.isCommandInputFocused?.value = it },
                prefs = prefs,
                covered = covered,
                ctrlLatched = ctrlLatched,
                altLatched = altLatched,
                onAccessoryAction = { onAccessoryAction(it) },
                suggestions = suggestions,
                historyFailure = historyFailure,
            )
        }
    }
        if (agents != null && connectionRef != null) {
            val activeInstance = eligibleSessions.firstOrNull { it.id == activeSessionId }
                ?.let { TerminalAgentsInstanceKey(connectionRef.profileId, it.id, it.incarnation) }
            BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
                val isPinned = isTerminalAgentsPinned(maxWidth)
                SideEffect { agents.host.setPinned(isPinned) }
                TerminalAgentsSidebarOverlay(agents = agents, active = activeInstance, maxWidth = maxWidth)
            }
        }
    }


    if (connectionRef != null) {
        TerminalDialogs(
            showDiagnosticsDialog = showDiagnosticsDialog,
            onDismissDiagnostics = { showDiagnosticsDialog = false },
            showCreateDialog = showCreateDialog,
            onDismissCreate = { showCreateDialog = false },
            onCreateSession = { cmd, name ->
                ownerScope.launch {
                    try {
                        val newId = withContext(Dispatchers.Default) {
                            val id = "term-${Clock.System.now().toEpochMilliseconds()}"
                            terminalRepo?.createSession(
                                CreateSessionRequest(id = id, command = cmd, name = name, project = projectName)
                            )
                            id
                        }
                        pendingReconciliationId = newId
                        refreshSessions()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        uiErrorBanner = "Failed to create session: ${e.message}"
                    }
                }
            },
            sessionToKill = sessionToKill,
            onDismissKill = { sessionToKill = null },
            onConfirmKill = { targetId ->
                if (isDestructiveOpInProgress) return@TerminalDialogs
                sessionToKill = null
                ownerScope.launch {
                    isDestructiveOpInProgress = true
                    destroyingSessionIds[targetId] = true
                    controllers[targetId]?.isPanelActive = false
                    bumpActiveSessionEpoch()
                    try {
                        withContext(Dispatchers.Default) {
                            terminalRepo?.removeSession(targetId)
                        }
                        removeSessionLocal(targetId)
                        sessions = sessions.filter { it.id != targetId }
                        val next = sessions.filter { isSessionSelectable(it) }.firstOrNull()?.id
                        if (activeSessionId == targetId) {
                            selectSession(next)
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        uiErrorBanner = "Failed to remove session: ${e.message}"
                    } finally {
                        destroyingSessionIds.remove(targetId)
                        isDestructiveOpInProgress = false
                        val syncSuccess = refreshSessions()
                        if (!syncSuccess && activeSessionId == targetId) {
                            controllers[targetId]?.isPanelActive = isEligibleForInput(targetId)
                        }
                    }
                }
            },
            connectionRef = connectionRef,
            activeSessionId = activeSessionId,
        )
    }
}

/**
 * Convenient overload resolving [TerminalRepository] from [ProfileRepository].
 */
@Composable
fun ProjectTerminalScreen(
    projectName: String,
    profileRepository: ProfileRepository,
    profileId: String,
    onBackToProjects: () -> Unit,
    modifier: Modifier = Modifier,
    initialSessionId: String? = null,
    onSessionSelected: ((String?) -> Unit)? = null,
    preferenceAccess: PreferenceAccess? = null,
) {
    val profiles by profileRepository.profiles.collectAsState()
    val activeProfile = profiles.find { it.id == profileId }
    val connections by profileRepository.registry.connectionsState.collectAsState()
    val currentConn = connections[profileId]

    var terminalRepo by remember(profileRepository, profileId, activeProfile?.baseUrl, currentConn?.generation) {
        mutableStateOf<TerminalRepository?>(null)
    }

    LaunchedEffect(profileRepository, profileId, activeProfile?.baseUrl, currentConn?.generation) {
        try {
            val client = profileRepository.getOrCreateApiClient(profileId)
            val ws = try {
                profileRepository.getOrCreateWsConnection(profileId)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            terminalRepo = TerminalRepository(client, ws)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {}
    }

    ProjectTerminalScreen(
        projectName = projectName,
        terminalRepo = terminalRepo,
        onBackToProjects = onBackToProjects,
        modifier = modifier,
        initialSessionId = initialSessionId,
        onSessionSelected = onSessionSelected,
        profileId = profileId,
        preferenceAccess = preferenceAccess,
    )
}

private val NO_HISTORY_REVISION: StateFlow<Long> = MutableStateFlow(0L)
private val NO_HISTORY_ENABLED: StateFlow<Boolean> = MutableStateFlow(false)
private val NO_HISTORY_FAILURE: StateFlow<String?> = MutableStateFlow(null)
private val NO_AGENT_INVENTORIES: StateFlow<Map<TerminalAgentsRuntimeKey, TerminalAgentsInventoryReceipt>> =
    MutableStateFlow(emptyMap())

/**
 * Inline terminal scroll controls: up/down by the preferred [step] lines (1..50) and jumps to the top/bottom.
 * Each control keeps a 48 dp touch target; they only move the local viewport, never the remote PTY.
 */
@Composable
private fun TerminalScrollControls(step: Int, onScroll: (TerminalScrollDirection) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(DamHopperColors.Surface)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        listOf(
            Triple("▲ $step", "Scroll up $step lines", TerminalScrollDirection.UP),
            Triple("▼ $step", "Scroll down $step lines", TerminalScrollDirection.DOWN),
            Triple("Top", "Jump to the top of the output", TerminalScrollDirection.TOP),
            Triple("Bottom", "Jump to the latest output", TerminalScrollDirection.BOTTOM),
        ).forEach { (label, description, direction) ->
            Box(
                modifier = Modifier
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .semantics { contentDescription = description }
                    .clickable { onScroll(direction) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    color = DamHopperColors.TextPrimary,
                    fontSize = 12.sp,
                    fontFamily = JetBrainsMonoFontFamily,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }
    }
}
@Composable
private fun TerminalTopHeader(
    projectName: String,
    terminalFontSize: Int,
    canDecreaseFont: Boolean,
    canIncreaseFont: Boolean,
    updateTerminalFontSize: (Int) -> Unit,
    onBackToProjects: () -> Unit,
    onShowDiagnostics: () -> Unit,
    onShowCreate: () -> Unit,
    agents: TerminalAgentsContext?,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(DamHopperColors.Surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "← Projects",
            color = DamHopperColors.Primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .clickable(enabled = agents?.host?.compactSheetOpen != true) {
                    onBackToProjects()
                }
                .padding(horizontal = 6.dp, vertical = 4.dp)
        )

        Text(
            text = projectName,
            color = DamHopperColors.TextPrimary,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(0.35f)
        )

        Row(
            modifier = Modifier
                .weight(0.65f, fill = false)
                .horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = "A-",
                color = if (canDecreaseFont) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .sizeIn(minWidth = 32.dp, minHeight = 32.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .semantics { contentDescription = "Decrease terminal font size" }
                    .clickable(enabled = canDecreaseFont) {
                        updateTerminalFontSize(stepTerminalFontSize(terminalFontSize, -1))
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp)
            )

            Text(
                text = "${terminalFontSize}sp",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontFamily = JetBrainsMonoFontFamily,
                modifier = Modifier
                    .semantics { contentDescription = "Terminal font size ${terminalFontSize}sp" }
                    .padding(horizontal = 2.dp, vertical = 6.dp)
            )

            Text(
                text = "A+",
                color = if (canIncreaseFont) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .sizeIn(minWidth = 32.dp, minHeight = 32.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .semantics { contentDescription = "Increase terminal font size" }
                    .clickable(enabled = canIncreaseFont) {
                        updateTerminalFontSize(stepTerminalFontSize(terminalFontSize, 1))
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp)
            )

            agents?.let { TerminalAgentsTrigger(it) }

            Text(
                text = "Diag",
                color = DamHopperColors.Warning,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .clickable { onShowDiagnostics() }
                    .padding(horizontal = 8.dp, vertical = 6.dp)
            )

            Text(
                text = "+ New Terminal",
                color = DamHopperColors.Primary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .clickable { onShowCreate() }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
    }
}

@Composable
private fun TerminalSubHeader(
    terminalFontSize: Int,
    canDecreaseFont: Boolean,
    canIncreaseFont: Boolean,
    updateTerminalFontSize: (Int) -> Unit,
    onShowDiagnostics: () -> Unit,
    onShowCreate: () -> Unit,
    agents: TerminalAgentsContext?,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(DamHopperColors.Surface)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(
            text = "A-",
            color = if (canDecreaseFont) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .sizeIn(minWidth = 32.dp, minHeight = 32.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(DamHopperColors.SurfaceVariant)
                .semantics { contentDescription = "Decrease terminal font size" }
                .clickable(enabled = canDecreaseFont) {
                    updateTerminalFontSize(stepTerminalFontSize(terminalFontSize, -1))
                }
                .padding(horizontal = 8.dp, vertical = 6.dp)
        )

        Text(
            text = "${terminalFontSize}sp",
            color = DamHopperColors.TextSecondary,
            fontSize = 12.sp,
            fontFamily = JetBrainsMonoFontFamily,
            modifier = Modifier
                .semantics { contentDescription = "Terminal font size ${terminalFontSize}sp" }
                .padding(horizontal = 2.dp, vertical = 6.dp)
        )

        Text(
            text = "A+",
            color = if (canIncreaseFont) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .sizeIn(minWidth = 32.dp, minHeight = 32.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(DamHopperColors.SurfaceVariant)
                .semantics { contentDescription = "Increase terminal font size" }
                .clickable(enabled = canIncreaseFont) {
                    updateTerminalFontSize(stepTerminalFontSize(terminalFontSize, 1))
                }
                .padding(horizontal = 8.dp, vertical = 6.dp)
        )

        agents?.let { TerminalAgentsTrigger(it) }

        Text(
            text = "Diag",
            color = DamHopperColors.Warning,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(DamHopperColors.SurfaceVariant)
                .clickable { onShowDiagnostics() }
                .padding(horizontal = 8.dp, vertical = 6.dp)
        )

        Text(
            text = "+ New Terminal",
            color = DamHopperColors.Primary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(DamHopperColors.SurfaceVariant)
                .clickable { onShowCreate() }
                .padding(horizontal = 10.dp, vertical = 6.dp)
        )
    }
}

@Composable
private fun TerminalSessionTabs(
    sessions: List<TerminalSessionDetailed>,
    activeSessionId: String?,
    onSelectSession: (String) -> Unit,
    onKillSession: (String) -> Unit,
    modifier: Modifier = Modifier,
    wsState: WsState? = null,
    controllers: Map<String, TerminalSessionController> = emptyMap(),
) {
    if (sessions.isEmpty()) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(DamHopperColors.SurfaceVariant)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        sessions.forEach { session ->
            val isSelected = session.id == activeSessionId
            val ctrl = controllers[session.id]
            val isStreamReady = ctrl?.isReplayCompleted == true
            val tabStatus = TerminalConnectionPresentation.resolveTabStatus(
                wsState = wsState,
                isSessionAlive = session.alive,
                isStreamReady = isStreamReady,
                restartCount = session.restartCount,
            )

            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (isSelected) DamHopperColors.PrimaryVariant else DamHopperColors.Surface)
                    .clickable { onSelectSession(session.id) }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box(
                    modifier = Modifier
                        .width(8.dp)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(tabStatus.color)
                        .semantics { contentDescription = tabStatus.description }
                )
                Text(
                    text = session.displayName,
                    color = if (isSelected) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                )
                if (isSelected) {
                    Text(
                        text = "✕",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(2.dp))
                            .clickable { onKillSession(session.id) }
                            .padding(horizontal = 2.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun TerminalAccessoryAndCommandBar(
    commandInput: String,
    onCommandInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onFocusChanged: (Boolean) -> Unit,
    prefs: WorkbenchPreferences,
    covered: Boolean,
    ctrlLatched: Boolean,
    altLatched: Boolean,
    onAccessoryAction: (AccessoryAction) -> Unit,
    suggestions: List<String>,
    historyFailure: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        NativeAccessoryKeyboard(
            enabled = prefs.mobileCustomKeyboardEnabled,
            inert = covered,
            metrics = accessoryMetrics(prefs),
            haptics = prefs.hapticFeedbackEnabled,
            ctrlLatched = ctrlLatched,
            altLatched = altLatched,
            onAction = onAccessoryAction,
        )

        if (suggestions.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "This device's history:",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
                suggestions.forEach { suggestion ->
                    Box(
                        modifier = Modifier
                            .sizeIn(minHeight = 48.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(DamHopperColors.SurfaceVariant)
                            .semantics { contentDescription = "Insert history command into draft" }
                            .clickable { onCommandInputChange(suggestion) }
                            .padding(horizontal = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = suggestion,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp,
                            fontFamily = JetBrainsMonoFontFamily,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
        historyFailure?.let { failure ->
            Text(
                text = failure,
                color = DamHopperColors.Warning,
                fontSize = 11.sp,
                modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(horizontal = 12.dp, vertical = 2.dp),
            )
        }

        // Interactive Command Input Field
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = commandInput,
                onValueChange = onCommandInputChange,
                placeholder = {
                    Text(
                        text = "Enter command (e.g. ls -la)...",
                        fontSize = 12.sp,
                        color = DamHopperColors.TextSecondary
                    )
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                textStyle = TextStyle(
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 13.sp,
                    color = DamHopperColors.TextPrimary
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = DamHopperColors.Primary,
                    unfocusedBorderColor = DamHopperColors.SurfaceVariant,
                    focusedContainerColor = DamHopperColors.Background,
                    unfocusedContainerColor = DamHopperColors.Background,
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp)
                    .onFocusChanged { onFocusChanged(it.isFocused) }
            )

            Button(
                onClick = onSend,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                shape = RoundedCornerShape(6.dp),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 0.dp),
                modifier = Modifier.height(44.dp)
            ) {
                Text("Send", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun TerminalDialogs(
    showDiagnosticsDialog: Boolean,
    onDismissDiagnostics: () -> Unit,
    showCreateDialog: Boolean,
    onDismissCreate: () -> Unit,
    onCreateSession: (command: String, name: String?) -> Unit,
    sessionToKill: String?,
    onDismissKill: () -> Unit,
    onConfirmKill: (String) -> Unit,
    connectionRef: ConnectionRef,
    activeSessionId: String?,
) {
    if (showDiagnosticsDialog) {
        TerminalDiagnosticsDialog(
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = activeSessionId,
            onDismiss = onDismissDiagnostics
        )
    }

    if (showCreateDialog) {
        var commandText by remember { mutableStateOf("sh") }
        var nameText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = onDismissCreate,
            title = { Text("New Terminal Session", color = DamHopperColors.TextPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = nameText,
                        onValueChange = { nameText = it },
                        label = { Text("Session Name (optional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = commandText,
                        onValueChange = { commandText = it },
                        label = { Text("Command") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val finalCmd = if (commandText.isNotBlank()) commandText else "sh"
                        val finalName = if (nameText.isNotBlank()) nameText else null
                        onCreateSession(finalCmd, finalName)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                ) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissCreate) {
                    Text("Cancel")
                }
            }
        )
    }

    if (sessionToKill != null) {
        AlertDialog(
            onDismissRequest = onDismissKill,
            title = { Text("Close Terminal Session", color = DamHopperColors.TextPrimary) },
            text = { Text("Are you sure you want to close and remove this terminal session?") },
            confirmButton = {
                Button(
                    onClick = { onConfirmKill(sessionToKill) },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Close Session")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissKill) {
                    Text("Cancel")
                }
            }
        )
    }
}
