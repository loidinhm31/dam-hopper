package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.delay
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.features.terminal.TerminalDiagnosticsDialog
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.terminal.ConsoleBufferTerminalSurface
import dev.damhopper.nativeapp.features.terminal.NativeTerminalSurface
import dev.damhopper.nativeapp.features.terminal.VtTerminalSurface
import dev.damhopper.nativeapp.features.terminal.CreateSessionRequest
import dev.damhopper.nativeapp.features.terminal.TerminalModifier
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.datetime.Clock

/**
 * Record of a failed command distinguishing definitely unsent items from uncertain delivery.
 */
private data class FailedCommandRecord(
    val sessionId: String,
    val command: String,
    val isDeliveryUncertain: Boolean,
    val reason: String,
)

/**
 * Tagged input write bearing owner, session, epoch, and incarnation tokens to prevent cross-epoch transmission.
 */
private data class QueuedWrite(
    val sessionId: String,
    val controller: TerminalSessionController,
    val bytes: ByteArray,
    val epoch: Long,
    val incarnation: Long,
    val commandText: String? = null,
    val onResult: (Boolean, Boolean, String?) -> Unit,
)

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
 * 3. Renders a bounded, scrollable monospace console viewer with ANSI code stripping.
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
    var activeSessionId by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var activeSessionEpoch by remember(terminalRepo, connectionKey) { mutableStateOf(0L) }
    var showCreateDialog by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var showDiagnosticsDialog by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var sessionToKill by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var commandInput by remember(terminalRepo, connectionKey) { mutableStateOf("") }
    var uiErrorBanner by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var attachError by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var isDestructiveOpInProgress by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var isSyncFailure by remember(terminalRepo, connectionKey) { mutableStateOf(false) }
    var pendingReconciliationId by remember(terminalRepo, connectionKey) { mutableStateOf<String?>(null) }
    var attachmentRevision by remember(terminalRepo, connectionKey) { mutableStateOf(0L) }
    var attachmentAttemptToken by remember(terminalRepo, connectionKey) { mutableStateOf(0L) }

    // Owner-keyed coroutine scope cancelled whenever terminalRepo or connectionKey changes
    val ownerScope = remember(terminalRepo, connectionKey) { CoroutineScope(Dispatchers.Main.immediate) }

    // Serialized bounded input channel ensuring strictly FIFO ordered writes
    val writeChannel = remember(terminalRepo, connectionKey) { Channel<QueuedWrite>(capacity = 64) }

    // Observable Compose state maps ensuring controller publication triggers recomposition
    val controllers = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, TerminalSessionController>() }
    val surfaces = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, NativeTerminalSurface>() }
    val destroyingSessionIds = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, Boolean>() }
    val failedRecords = remember(terminalRepo, connectionKey) { mutableStateListOf<FailedCommandRecord>() }
    val sessionDrafts = remember(terminalRepo, connectionKey) { mutableStateMapOf<String, String>() }
    val terminalFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    var directInputState by remember { mutableStateOf(TextFieldValue("")) }
    var cursorVisible by remember { mutableStateOf(true) }

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
        controllers.remove(id)?.close()
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

        if (newSessionId != null) {
            controllers[newSessionId]?.isPanelActive = true
            commandInput = sessionDrafts[newSessionId] ?: ""
        } else {
            commandInput = ""
        }

        onSessionSelected?.invoke(newSessionId)
    }

    // Single background worker strictly serializing writes with epoch and boundary gating
    LaunchedEffect(terminalRepo, connectionKey) {
        launch(Dispatchers.Main.immediate) {
            for (item in writeChannel) {
                try {
                    val isCurrent = (item.epoch == activeSessionEpoch) &&
                        (item.sessionId == activeSessionId) &&
                        (terminalRepo.apiClient.connection == connectionRef) &&
                        (controllers[item.sessionId] === item.controller) &&
                        (destroyingSessionIds[item.sessionId] != true)

                    val isEligible = isCurrent &&
                        item.controller.isPanelActive &&
                        item.controller.isReplayCompleted &&
                        item.controller.gate.shouldForwardTerminalData() &&
                        item.controller.isInputAllowed() &&
                        (item.controller.incarnation.toLong() == item.incarnation)

                    if (isEligible) {
                        val payload = item.bytes.decodeToString()
                        val capturedEpoch = item.epoch
                        val capturedCtrl = item.controller

                        val writeOutcome = withContext(Dispatchers.Default) {
                            if (capturedEpoch == activeSessionEpoch &&
                                terminalRepo.apiClient.connection == connectionRef &&
                                capturedCtrl.isPanelActive
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
                epoch = activeSessionEpoch,
                incarnation = ctrl.incarnation.toLong(),
                commandText = capturedCmd,
                onResult = { success, isDeliveryUncertain, error ->
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

        ctrl.onRequestReattach = { sId, offset ->
            val requestEpoch = activeSessionEpoch
            ownerScope.launch {
                try {
                    val eligible = withContext(Dispatchers.Default) {
                        (terminalRepo.apiClient.connection == connectionRef) &&
                            ctrl.isPanelActive &&
                            (controllers[sId] === ctrl) &&
                            (destroyingSessionIds[sId] != true) &&
                            (sId == activeSessionId) &&
                            (requestEpoch == activeSessionEpoch)
                    }
                    if (eligible) {
                        withContext(Dispatchers.Default) {
                            terminalRepo.attachTerminal(sId, offset)
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (sId == activeSessionId && controllers[sId] === ctrl && requestEpoch == activeSessionEpoch && terminalRepo.apiClient.connection == connectionRef) {
                        uiErrorBanner = "Reattach failed: ${e.message ?: "network error"}"
                    }
                }
            }
        }

        ctrl.isPanelActive = (id == activeSessionId && activeSessionId != null && destroyingSessionIds[id] != true)
        controllers[id] = ctrl
        return ctrl
    }

    suspend fun refreshSessions(): Boolean {
        return try {
            val detailed = withContext(Dispatchers.Default) {
                terminalRepo.listDetailed()
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
                if (currentActive == null || selectable.none { it.id == currentActive }) {
                    val candidate = initialSessionId?.takeIf { initId -> selectable.any { it.id == initId } }
                        ?: selectable.firstOrNull()?.id
                    selectSession(candidate)
                }
                isSyncFailure = false
            }

            attachmentRevision++
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
        launch(Dispatchers.Main.immediate) {
            terminalRepo.terminalOutput.collect { msg ->
                controllers[msg.id]?.handleLiveChunk(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.incarnation
                )
            }
        }
        launch(Dispatchers.Main.immediate) {
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

    val eligibleSessions = remember(sessions, projectName, destroyingSessionIds.size) {
        sessions.filter { isSessionSelectable(it) }
    }

    val activeSession = eligibleSessions.find { it.id == activeSessionId }

    // Active session attachment effect: keyed by active session resolution, ensuring rerun on refresh
    LaunchedEffect(activeSessionId, activeSession?.incarnation, attachmentRevision, terminalRepo, connectionKey) {
        val session = activeSession ?: return@LaunchedEffect
        if (destroyingSessionIds[session.id] == true) return@LaunchedEffect
        val ctrl = getOrCreateController(session.id, session.incarnation.toLong())
        ctrl.isPanelActive = true

        val currentAttemptToken = ++attachmentAttemptToken
        val currentSessionId = session.id
        val currentSessionEpoch = activeSessionEpoch
        val currentConnectionRef = connectionRef
        val currentCtrl = ctrl

        val attachOutcome = try {
            val eligible = (currentAttemptToken == attachmentAttemptToken) &&
                (activeSessionId == currentSessionId) &&
                (currentSessionEpoch == activeSessionEpoch) &&
                (terminalRepo.apiClient.connection == currentConnectionRef) &&
                (destroyingSessionIds[session.id] != true) &&
                (controllers[session.id] === currentCtrl)

            if (eligible) {
                withContext(Dispatchers.Default) {
                    try {
                        terminalRepo.wsConnection?.connect()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {}
                    try {
                        val bufferText = terminalRepo.getBuffer(session.id)
                        AppLogger.recordDiagnostic(
                            type = "transport",
                            scope = "terminal-panel",
                            message = "terminal.buffer_fetched",
                            profileId = connectionRef.profileId,
                            generation = connectionRef.generation,
                            sessionId = session.id,
                            metadata = mapOf("byteCount" to bufferText.length.toString())
                        )
                        if (bufferText.isNotEmpty() && ctrl.lastSeenOffset == 0uL) {
                            withContext(Dispatchers.Main) {
                                ctrl.surface?.feedOutput(bufferText.encodeToByteArray(), 0L, true)
                            }
                        }
                    } catch (e: Exception) {
                        AppLogger.recordDiagnostic(
                            type = "transport",
                            scope = "terminal-panel",
                            message = "terminal.buffer_fetch_failed",
                            profileId = connectionRef.profileId,
                            generation = connectionRef.generation,
                            sessionId = session.id,
                            metadata = mapOf("error" to (e.message ?: "unknown"))
                        )
                    }
                    terminalRepo.attachTerminal(session.id, ctrl.lastSeenOffset.takeIf { it > 0uL })
                }
                true
            } else {
                false
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

        if (currentAttemptToken == attachmentAttemptToken &&
            activeSessionId == currentSessionId &&
            currentSessionEpoch == activeSessionEpoch &&
            terminalRepo.apiClient.connection == currentConnectionRef &&
            destroyingSessionIds[session.id] != true &&
            controllers[session.id] === currentCtrl
        ) {
            when (attachOutcome) {
                true -> {
                    attachError = null
                    AppLogger.recordDiagnostic(
                        type = "transport",
                        scope = "terminal-panel",
                        message = "terminal.attach_succeeded",
                        profileId = connectionRef.profileId,
                        generation = connectionRef.generation,
                        sessionId = currentSessionId,
                        metadata = mapOf("fromOffset" to currentCtrl.lastSeenOffset.toString())
                    )
                }
                false -> { /* Skipped because superseded; preserve status */ }
                null -> {
                    attachError = "Failed to attach terminal to server"
                    AppLogger.recordDiagnostic(
                        type = "transport",
                        scope = "terminal-panel",
                        message = "terminal.attach_failed",
                        profileId = connectionRef.profileId,
                        generation = connectionRef.generation,
                        sessionId = currentSessionId
                    )
                }
            }
        }
    }

    // Clean detachment on unmount or connection invalidation: deactivate input, close local controllers and surfaces
    DisposableEffect(terminalRepo, connectionKey) {
        onDispose {
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
            destroyingSessionIds.clear()
            failedRecords.clear()
            sessionDrafts.clear()
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
            activeSessionEpoch++
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
        ctrl.toggleModifier(TerminalModifier.CTRL)
        ctrl.sendInput(ctrl.encodeKey(char))
        if (!lastSinkAdmitted && uiErrorBanner == null) {
            uiErrorBanner = "Accessory key dropped: input queue full or inactive"
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .imePadding()
    ) {
        // 1. Top Navigation & Project Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f, fill = false)
            ) {
                Text(
                    text = "← Projects",
                    color = DamHopperColors.Primary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .clickable {
                            selectSession(null)
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
                    overflow = TextOverflow.Ellipsis
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "Diag",
                    color = DamHopperColors.Warning,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .clickable { showDiagnosticsDialog = true }
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
                        .clickable { showCreateDialog = true }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                )
            }
        }

        // 2. Session Picker Tab Bar (strictly for this project's eligible sessions)
        if (eligibleSessions.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant)
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                eligibleSessions.forEach { session ->
                    val isSelected = session.id == activeSessionId
                    val statusColor = when {
                        !session.alive -> DamHopperColors.Error
                        session.restartCount > 0u -> DamHopperColors.Warning
                        else -> DamHopperColors.Success
                    }

                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isSelected) DamHopperColors.PrimaryVariant else DamHopperColors.Surface)
                            .clickable {
                                selectSession(session.id)
                            }
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .width(8.dp)
                                .height(8.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(statusColor)
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
                                    .clickable { sessionToKill = session.id }
                                    .padding(horizontal = 2.dp)
                            )
                        }
                    }
                }
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
                    modifier = Modifier.clickable { attachmentRevision++ }
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
                                    activeSessionEpoch++
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
                                            controllers[targetId]?.isPanelActive = true
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
                                    activeSessionEpoch++
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
                                            controllers[targetId]?.isPanelActive = true
                                        }
                                    }
                                }
                            }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
        }

        // 4. Main Console Output Area
        val lines = (activeSurface as? VtTerminalSurface)?.lines ?: (activeSurface as? ConsoleBufferTerminalSurface)?.lines ?: emptyList()
        val listState = rememberLazyListState()
        val surfaceRevision = (activeSurface as? VtTerminalSurface)?.updateRevision ?: (activeSurface as? ConsoleBufferTerminalSurface)?.updateRevision

        LaunchedEffect(surfaceRevision, lines.size) {
            if (lines.isNotEmpty()) {
                listState.scrollToItem(lines.size - 1)
            }
        }

        BoxWithConstraints(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(DamHopperColors.Background)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) {
                    terminalFocusRequester.requestFocus()
                    keyboardController?.show()
                }
                .padding(horizontal = 8.dp, vertical = 4.dp)
        ) {
            val charWidthDp = 7.2f
            val charHeightDp = 16.0f
            val computedCols = ((maxWidth.value / charWidthDp).toInt()).coerceIn(40, 200)
            val computedRows = ((maxHeight.value / charHeightDp).toInt()).coerceIn(10, 80)

            LaunchedEffect(computedCols, computedRows, activeSessionId) {
                activeController?.resize(computedCols, computedRows)
            }

            // Invisible direct IME input receiver for real-time keystroke interaction
            BasicTextField(
                value = directInputState,
                onValueChange = { newValue ->
                    val newText = newValue.text
                    val oldText = directInputState.text
                    if (newText.length > oldText.length) {
                        val added = newText.substring(oldText.length)
                        for (ch in added) {
                            if (ch == '\n') {
                                activeController?.sendInput(byteArrayOf(0x0D))
                            } else {
                                activeController?.sendInput(ch.toString().encodeToByteArray())
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
                        fontFamily = FontFamily.Monospace
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (activeController?.isReplayCompleted == true) {
                            "Terminal connected. Interactive session ready."
                        } else {
                            "Replaying stream buffer..."
                        },
                        color = DamHopperColors.TextSecondary,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize()
                ) {
                    itemsIndexed(
                        items = lines,
                        key = { index, _ -> "${activeSessionId}_line_${index}" }
                    ) { index, line ->
                        val textToRender = if (activeSurface is VtTerminalSurface) {
                            if (line.isEmpty()) AnnotatedString(" ") else line
                        } else {
                            val isLastLine = index == lines.lastIndex
                            if (isLastLine && activeController?.isPanelActive == true) {
                                buildAnnotatedString {
                                    append(line)
                                    if (cursorVisible) {
                                        withStyle(SpanStyle(color = DamHopperColors.Primary)) {
                                            append("█")
                                        }
                                    } else {
                                        append(" ")
                                    }
                                }
                            } else {
                                if (line.isEmpty()) AnnotatedString(" ") else line
                            }
                        }
                        Text(
                            text = textToRender,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            lineHeight = 16.sp
                        )
                    }
                }
            }
        }

        // 5. Inline Accessory Control Bar
        // Strictly inline above IME, ZERO floating action buttons!
        if (activeController != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                AccessoryKeyButton(label = "⌨", onClick = {
                    terminalFocusRequester.requestFocus()
                    keyboardController?.show()
                })
                AccessoryKeyButton(label = "Ctrl+C", onClick = { sendCtrlChar('c') })
                AccessoryKeyButton(label = "Ctrl+D", onClick = { sendCtrlChar('d') })
                AccessoryKeyButton(label = "Tab", onClick = { sendSpecialKey("TAB") })
                AccessoryKeyButton(label = "Esc", onClick = { sendSpecialKey("ESC") })
                AccessoryKeyButton(label = "▲", onClick = { sendSpecialKey("UP") })
                AccessoryKeyButton(label = "▼", onClick = { sendSpecialKey("DOWN") })
                AccessoryKeyButton(label = "◀", onClick = { sendSpecialKey("LEFT") })
                AccessoryKeyButton(label = "▶", onClick = { sendSpecialKey("RIGHT") })
                AccessoryKeyButton(label = "Enter", onClick = { sendSpecialKey("ENTER") })
                AccessoryKeyButton(
                    label = "Clear",
                    onClick = {
                        AppLogger.recordDiagnostic(
                            type = "terminal",
                            scope = "terminal-panel",
                            message = "terminal.local_buffer_cleared",
                            profileId = connectionRef.profileId,
                            generation = connectionRef.generation,
                            sessionId = activeSessionId
                        )
                        (activeSurface as? VtTerminalSurface)?.clearDisplayBuffer()
                            ?: (activeSurface as? ConsoleBufferTerminalSurface)?.clearDisplayBuffer()
                    }
                )
            }

            // 6. Interactive Command Input Field
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
                    onValueChange = { commandInput = it },
                    placeholder = {
                        Text(
                            text = "Enter command (e.g. ls -la)...",
                            fontSize = 12.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { sendCommand() }),
                    textStyle = TextStyle(
                        fontFamily = FontFamily.Monospace,
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
                )

                Button(
                    onClick = { sendCommand() },
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
    // Diagnostics Viewer Dialog
    if (showDiagnosticsDialog) {
        TerminalDiagnosticsDialog(
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = activeSessionId,
            onDismiss = { showDiagnosticsDialog = false }
        )
    }

    // Create New Session Dialog
    if (showCreateDialog) {
        var commandText by remember { mutableStateOf("sh") }
        var nameText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
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
                        showCreateDialog = false
                        val finalCmd = if (commandText.isNotBlank()) commandText else "sh"
                        val finalName = if (nameText.isNotBlank()) nameText else null
                        ownerScope.launch {
                            try {
                                val newId = withContext(Dispatchers.Default) {
                                    val id = "term-${Clock.System.now().toEpochMilliseconds()}"
                                    terminalRepo.createSession(
                                        CreateSessionRequest(
                                            id = id,
                                            command = finalCmd,
                                            name = finalName,
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
                                uiErrorBanner = "Failed to create session: ${e.message}"
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                ) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Kill / Close Session Dialog
    if (sessionToKill != null) {
        AlertDialog(
            onDismissRequest = { sessionToKill = null },
            title = { Text("Close Terminal Session", color = DamHopperColors.TextPrimary) },
            text = { Text("Are you sure you want to close and remove this terminal session?") },
            confirmButton = {
                Button(
                    onClick = {
                        if (isDestructiveOpInProgress) return@Button
                        val targetId = sessionToKill
                        sessionToKill = null
                        if (targetId != null) {
                            ownerScope.launch {
                                isDestructiveOpInProgress = true
                                destroyingSessionIds[targetId] = true
                                controllers[targetId]?.isPanelActive = false
                                activeSessionEpoch++
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
                                    uiErrorBanner = "Failed to remove session: ${e.message}"
                                } finally {
                                    destroyingSessionIds.remove(targetId)
                                    isDestructiveOpInProgress = false
                                    val syncSuccess = refreshSessions()
                                    if (!syncSuccess && activeSessionId == targetId) {
                                        controllers[targetId]?.isPanelActive = true
                                    }
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Close Session")
                }
            },
            dismissButton = {
                TextButton(onClick = { sessionToKill = null }) {
                    Text("Cancel")
                }
            }
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
    )
}

@Composable
private fun AccessoryKeyButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(DamHopperColors.SurfaceVariant)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            color = DamHopperColors.TextPrimary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace
        )
    }
}
