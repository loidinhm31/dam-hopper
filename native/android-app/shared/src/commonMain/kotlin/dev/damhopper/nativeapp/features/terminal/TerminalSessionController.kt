package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.model.ConnectionRef

/**
 * TerminalSessionController maintains terminal session state across navigation transitions.
 *
 * It decouples terminal screen rendering from PTY ownership:
 * - Remote PTY runs authoritatively on the server.
 * - Controller lives outside composition and is retained across panel switches.
 * - Input is strictly fenced: if [isPanelActive] is false or [gate.isLiveStreamReady] is false,
 *   keystrokes are dropped to prevent out-of-order execution or input leakage.
 * - Replay and live data streams are reconciled byte-for-byte using [TerminalReplayGate].
 */
open class TerminalSessionController(
    val sessionId: String,
    initialIncarnation: Long = 0L,
    val connectionRef: ConnectionRef,
    val surface: NativeTerminalSurface? = null,
    val terminalRepository: TerminalRepository? = null,
) : AutoCloseable {

    var incarnation: ULong = initialIncarnation.toULong()
        private set

    var lastSeenOffset: ULong = 0uL
        private set

    var isAlternateScreen: Boolean = false
        private set

    val isReplayCompleted: Boolean
        get() = gate.hasAttachBufferBeenReceived && gate.isLiveStreamReady

    var isPanelActive: Boolean = false

    var isExited: Boolean = false
        private set

    var exitCode: Int? = null
        private set

    var willRestart: Boolean = false
        private set

    var restartCount: UInt = 0u
        private set

    var lastLaggedDropped: ULong? = null
        private set
    var isTruncated: Boolean = false
        private set

    var isInputAllowed: () -> Boolean = { true }

    val gate = TerminalReplayGate()

    private val activeModifiers = mutableSetOf<TerminalModifier>()
    private var rawInputSink: ((ByteArray) -> Unit)? = null
    private var requiresResetSnapshot = false
    private var pendingReplayDrainGeneration: Long? = null
    var onRequestReattach: ((sessionId: String, fromOffset: ULong) -> Unit)? = null

    init {
        surface?.setOnInputListener { bytes ->
            handleSurfaceInput(bytes)
        }
        gate.onReplayDrain = {
            drainQueuedChunksAfterReplay()
        }
        gate.onQueueOverflow = {
            requestReattach()
        }
    }

    fun setRawInputSink(sink: (ByteArray) -> Unit) {
        this.rawInputSink = sink
    }

    /**
     * Closes replay/input before any asynchronous attach work, retaining accepted text/offset.
     * Ordinary callers invoke once; recovery callbacks receive this already-captured offset.
     */
    fun beginAttach(): ULong {
        pendingReplayDrainGeneration = null
        gate.resetForAttach()
        return lastSeenOffset
    }

    /** Keeps an uncertain/failed attach fenced, even if a late reset already supplied a baseline. */
    fun failAttach() {
        pendingReplayDrainGeneration = null
        gate.failAttach()
    }

    fun markReplayCompleted() {
        gate.markReadyAfterRestart()
    }

    /**
     * Backward-compatible overload for Phase 05 tests.
     */
    fun handleOutputChunk(data: ByteArray, offset: Long, reset: Boolean = false) {
        if (reset) {
            lastSeenOffset = offset.toULong()
            surface?.feedOutput(data, offset, true)
        } else {
            val endOffset = (offset + data.size).toULong()
            lastSeenOffset = maxOf(lastSeenOffset, endOffset)
            surface?.feedOutput(data, offset, false)
        }
    }

    /**
     * Handles live PTY output chunk with incarnation fencing and stream reconciliation.
     */
    fun handleLiveChunk(data: ByteArray, offset: ULong, chunkIncarnation: ULong) {
        // Drop chunks from older incarnations
        if (chunkIncarnation < incarnation) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-session",
                message = "stream_chunk_dropped_stale_incarnation",
                profileId = connectionRef.profileId,
                generation = connectionRef.generation,
                sessionId = sessionId,
                incarnation = incarnation.toLong(),
                metadata = mapOf(
                    "chunkIncarnation" to chunkIncarnation.toString(),
                    "currentIncarnation" to incarnation.toString(),
                    "byteCount" to data.size.toString(),
                    "offset" to offset.toString()
                )
            )
            return
        }

        // A new process needs an authoritative reset before its parser/output can be used.
        if (chunkIncarnation > incarnation) {
            incarnation = chunkIncarnation
            lastSeenOffset = 0uL
            requiresResetSnapshot = true
            requestReattach()
            // A synchronous callback may already have supplied the new baseline.
            if (chunkIncarnation != incarnation) return
        }

        // If historical replay is still in progress, queue live chunk
        if (!gate.isLiveStreamReady) {
            AppLogger.debug(
                tag = "TerminalSessionController",
                message = "stream_chunk_queued_for_replay",
                metadata = mapOf(
                    "sessionId" to sessionId,
                    "byteCount" to data.size.toString(),
                    "offset" to offset.toString()
                )
            )
            gate.enqueueLiveChunk(QueuedLiveChunk(data, offset, chunkIncarnation))
            return
        }

        applyReconciledOutput(data, offset, historical = false)
    }

    /** Also used by replay/drain while public live output and outbound traffic remain closed. */
    private fun applyReconciledOutput(data: ByteArray, offset: ULong, historical: Boolean): Boolean {
        when (val result = reconcileTerminalOutput(data, offset, lastSeenOffset)) {
            is ReconcileOutputResult.Discard -> {
                AppLogger.debug(
                    tag = "TerminalSessionController",
                    message = "stream_chunk_discarded_duplicate",
                    metadata = mapOf(
                        "sessionId" to sessionId,
                        "offset" to offset.toString(),
                        "lastSeenOffset" to lastSeenOffset.toString()
                    )
                )
                return true
            }
            is ReconcileOutputResult.Gap -> {
                AppLogger.recordDiagnostic(
                    type = "transport",
                    scope = "terminal-panel",
                    message = "stream_gap_detected",
                    profileId = connectionRef.profileId,
                    generation = connectionRef.generation,
                    sessionId = sessionId,
                    incarnation = incarnation.toLong(),
                    metadata = mapOf(
                        "expectedOffset" to lastSeenOffset.toString(),
                        "receivedStartOffset" to result.receivedStartOffset.toString(),
                        "byteCount" to data.size.toString()
                    )
                )
                requestReattach()
                return false
            }
            is ReconcileOutputResult.Render -> {
                feedAcceptedOutput(result.data, result.nextOffset, reset = false, historical = historical)
                return true
            }
        }
    }

    /**
     * Applies historical buffer replay received from server.
     */
    fun handleBufferReplay(
        data: ByteArray,
        offset: ULong,
        reset: Boolean,
        truncated: Boolean,
        bufferIncarnation: ULong,
    ) {
        if (bufferIncarnation < incarnation) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-session",
                message = "buffer_replay_dropped_stale_incarnation",
                profileId = connectionRef.profileId,
                generation = connectionRef.generation,
                sessionId = sessionId,
                incarnation = incarnation.toLong(),
                metadata = mapOf(
                    "bufferIncarnation" to bufferIncarnation.toString(),
                    "currentIncarnation" to incarnation.toString()
                )
            )
            return
        }
        if (bufferIncarnation > incarnation) {
            incarnation = bufferIncarnation
            lastSeenOffset = 0uL
            requiresResetSnapshot = true
            if (reset) {
                val attachFailed = gate.isAttachFailed
                beginAttach()
                // An unsolicited process baseline is not evidence that a failed send succeeded.
                if (attachFailed) failAttach()
            }
        }
        if (requiresResetSnapshot && !reset) {
            requestReattach()
            return
        }

        AppLogger.recordDiagnostic(
            type = "transport",
            scope = "terminal-panel",
            message = "buffer_replay",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = sessionId,
            incarnation = incarnation.toLong(),
            metadata = mapOf(
                "byteCount" to data.size.toString(),
                "offset" to offset.toString(),
                "reset" to reset.toString(),
                "truncated" to truncated.toString()
            )
        )
        val generation = gate.replayGeneration
        gate.beginReplayWrite()
        val applied: Boolean
        try {
            if (reset) {
                // There is no wire attempt ID: even a lower/empty same-incarnation reset wins.
                feedAcceptedOutput(data, offset, reset = true, historical = true)
                if (generation == gate.replayGeneration) requiresResetSnapshot = false
                applied = true
            } else {
                applied = applyReconciledOutput(data, offset, historical = true)
            }
            if (applied && generation == gate.replayGeneration) isTruncated = truncated
        } finally {
            gate.finishReplayWrite()
        }
        // Only successful current-generation baselines can authorize a drain.
        if (applied && generation == gate.replayGeneration) pendingReplayDrainGeneration = generation
        drainPendingReplay()
    }

    private fun feedAcceptedOutput(data: ByteArray, endOffset: ULong, reset: Boolean, historical: Boolean) {
        val vtSurface = surface as? VtTerminalSurface
        val previousMode = vtSurface?.isLiveStream
        val previousOffset = lastSeenOffset
        val generation = gate.replayGeneration
        lastSeenOffset = endOffset
        try {
            vtSurface?.isLiveStream = !historical
            surface?.feedOutput(data, endOffset.toLong() - data.size, reset)
        } catch (error: Throwable) {
            if (generation == gate.replayGeneration) {
                lastSeenOffset = previousOffset
                beginAttach()
            }
            throw error
        } finally {
            if (previousMode != null) vtSurface?.isLiveStream = previousMode
        }
    }

    private fun drainPendingReplay() {
        if (!gate.isAttachFailed && pendingReplayDrainGeneration == gate.replayGeneration && gate.activeReplayWrites == 0) {
            pendingReplayDrainGeneration = null
            gate.notifyReplayDrain()
        }
    }

    private fun drainQueuedChunksAfterReplay() {
        val generation = gate.replayGeneration
        var queuedChunkCount = 0
        var drained = false
        // Count the drain as historical parser work, not a temporary opening of the live path.
        gate.beginReplayWrite()
        try {
            while (!gate.isAttachFailed && generation == gate.replayGeneration) {
                val chunk = gate.pollQueuedChunk()
                if (chunk == null) {
                    drained = true
                    break
                }
                if (chunk.incarnation < incarnation) continue
                if (chunk.incarnation > incarnation) {
                    handleLiveChunk(chunk.data, chunk.offset, chunk.incarnation)
                    break
                }
                queuedChunkCount += 1
                if (!applyReconciledOutput(chunk.data, chunk.offset, historical = true)) break
            }
        } finally {
            gate.finishReplayWrite()
        }
        if (!drained || generation != gate.replayGeneration) {
            // A reentrant new baseline may be waiting for this superseded write to finish.
            drainPendingReplay()
            return
        }
        gate.markLiveStreamReady(generation)
        if (!gate.isLiveStreamReady) return
        AppLogger.recordDiagnostic(
            type = "transport",
            scope = "terminal-panel",
            message = "buffer_replay_complete",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = sessionId,
            incarnation = incarnation.toLong(),
            metadata = mapOf("queuedChunkCount" to queuedChunkCount.toString())
        )
    }

    /**
     * Handles process exit event from server.
     */
    fun handleExit(
        code: Int?,
        restart: Boolean,
        restarts: UInt?,
        eventIncarnation: ULong?,
    ) {
        if (eventIncarnation != null && eventIncarnation < incarnation) {
            return
        }
        isExited = true
        exitCode = code
        willRestart = restart
        restarts?.let { restartCount = it }
        AppLogger.recordDiagnostic(
            type = "terminal",
            scope = "terminal-session",
            message = "terminal.exit",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = sessionId,
            incarnation = incarnation.toLong(),
            metadata = mapOf(
                "exitCode" to (code?.toString() ?: "null"),
                "willRestart" to restart.toString(),
                "restartCount" to (restarts?.toString() ?: restartCount.toString())
            )
        )
    }

    /**
     * Handles process restarted notification.
     */
    fun handleProcessRestarted(count: UInt, prevExitCode: Int?) {
        isExited = false
        exitCode = null
        willRestart = false
        restartCount = count
        gate.markReadyAfterRestart()
        AppLogger.recordDiagnostic(
            type = "terminal",
            scope = "terminal-session",
            message = "process.restarted",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = sessionId,
            incarnation = incarnation.toLong(),
            metadata = mapOf(
                "restartCount" to count.toString(),
                "prevExitCode" to (prevExitCode?.toString() ?: "null")
            )
        )
    }
    /**
     * Handles lagged stream notification.
     */
    fun handleLagged(dropped: ULong) {
        lastLaggedDropped = dropped
        AppLogger.recordDiagnostic(
            type = "transport",
            scope = "terminal-panel",
            message = "broadcast_lagged",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = sessionId,
            incarnation = incarnation.toLong(),
            metadata = mapOf(
                "droppedCount" to dropped.toString(),
                "lastSeenOffset" to lastSeenOffset.toString()
            )
        )
        requestReattach()
    }
    private fun requestReattach() {
        val fromOffset = beginAttach()
        onRequestReattach?.invoke(sessionId, fromOffset)
    }

    fun setAlternateScreen(active: Boolean) {
        isAlternateScreen = active
    }

    fun toggleModifier(modifier: TerminalModifier) {
        if (activeModifiers.contains(modifier)) {
            activeModifiers.remove(modifier)
        } else {
            activeModifiers.add(modifier)
        }
    }

    fun isModifierActive(modifier: TerminalModifier): Boolean =
        activeModifiers.contains(modifier)

    fun clearModifiers() {
        activeModifiers.clear()
    }

    /**
     * Translates a character key with active modifiers to standard ANSI/VT100 escape sequences.
     */
    open fun encodeKey(char: Char): ByteArray {
        val isCtrl = activeModifiers.contains(TerminalModifier.CTRL)
        val isAlt = activeModifiers.contains(TerminalModifier.ALT)

        clearModifiers()

        if (isCtrl) {
            val upper = char.uppercaseChar()
            if (upper in '@'..'_') {
                val ctrlCode = (upper.code - '@'.code).toByte()
                return if (isAlt) {
                    byteArrayOf(0x1B, ctrlCode) // ESC + Ctrl-char
                } else {
                    byteArrayOf(ctrlCode)
                }
            }
        }

        if (isAlt) {
            return byteArrayOf(0x1B) + char.toString().encodeToByteArray()
        }

        return char.toString().encodeToByteArray()
    }

    /**
     * Translates special navigation keys (arrows, home, end, etc.) to ANSI escape sequences.
     */
    open fun encodeSpecialKey(name: String): ByteArray {
        val isAlt = activeModifiers.contains(TerminalModifier.ALT)
        clearModifiers()
        val isAppCursor = (surface as? VtTerminalSurface)?.engine?.isAppCursorKeys == true
        val seq = when (name.uppercase()) {
            "UP" -> if (isAppCursor) "\u001bOA" else "\u001b[A"
            "DOWN" -> if (isAppCursor) "\u001bOB" else "\u001b[B"
            "RIGHT" -> if (isAppCursor) "\u001bOC" else "\u001b[C"
            "LEFT" -> if (isAppCursor) "\u001bOD" else "\u001b[D"
            "HOME" -> if (isAppCursor) "\u001bOH" else "\u001b[H"
            "END" -> if (isAppCursor) "\u001bOF" else "\u001b[F"
            "PAGE_UP", "PAGEUP" -> "\u001b[5~"
            "PAGE_DOWN", "PAGEDOWN" -> "\u001b[6~"
            "INSERT" -> "\u001b[2~"
            "DELETE" -> "\u001b[3~"
            "TAB" -> "\t"
            "ESC" -> "\u001b"
            "BACKSPACE" -> "\u007f"
            "ENTER" -> "\r"
            else -> ""
        }
        if (seq.isEmpty()) return byteArrayOf()
        return if (isAlt) {
            byteArrayOf(0x1B) + seq.encodeToByteArray()
        } else {
            seq.encodeToByteArray()
        }
    }

    /**
     * Encodes pasted text with bracketed paste escape sequences if supported.
     */
    fun encodeBracketedPaste(text: String): ByteArray {
        val wrapped = "\u001b[200~$text\u001b[201~"
        return wrapped.encodeToByteArray()
    }

    /**
     * Sends user keystrokes / input to remote PTY.
     */
    fun sendInput(bytes: ByteArray) {
        if (!isPanelActive) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-input",
                message = "terminal.input_dropped",
                profileId = connectionRef.profileId,
                generation = connectionRef.generation,
                sessionId = sessionId,
                incarnation = incarnation.toLong(),
                metadata = mapOf("reason" to "panel_inactive", "byteCount" to bytes.size.toString())
            )
            return
        }
        if (!isReplayCompleted) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-input",
                message = "terminal.input_dropped",
                profileId = connectionRef.profileId,
                generation = connectionRef.generation,
                sessionId = sessionId,
                incarnation = incarnation.toLong(),
                metadata = mapOf("reason" to "replay_in_progress", "byteCount" to bytes.size.toString())
            )
            return
        }
        if (!gate.shouldForwardTerminalData()) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-input",
                message = "terminal.input_dropped",
                profileId = connectionRef.profileId,
                generation = connectionRef.generation,
                sessionId = sessionId,
                incarnation = incarnation.toLong(),
                metadata = mapOf("reason" to "gate_blocked", "byteCount" to bytes.size.toString())
            )
            return
        }
        if (!isInputAllowed()) {
            AppLogger.recordDiagnostic(
                type = "terminal",
                scope = "terminal-input",
                message = "terminal.input_dropped",
                profileId = connectionRef.profileId,
                generation = connectionRef.generation,
                sessionId = sessionId,
                incarnation = incarnation.toLong(),
                metadata = mapOf("reason" to "input_disallowed", "byteCount" to bytes.size.toString())
            )
            return
        }
        AppLogger.debug(
            tag = "TerminalSessionController",
            message = "terminal.input_dispatched",
            metadata = mapOf(
                "sessionId" to sessionId,
                "byteCount" to bytes.size.toString()
            )
        )
        rawInputSink?.invoke(bytes)
    }

    private fun handleSurfaceInput(bytes: ByteArray) {
        sendInput(bytes)
    }

    var onResizeBroadcast: ((cols: Int, rows: Int) -> Unit)? = null

    fun resize(cols: Int, rows: Int) {
        AppLogger.recordDiagnostic(
            type = "terminal",
            scope = "terminal-session",
            message = "terminal.resize",
            profileId = connectionRef.profileId,
            generation = connectionRef.generation,
            sessionId = sessionId,
            incarnation = incarnation.toLong(),
            metadata = mapOf("cols" to cols.toString(), "rows" to rows.toString())
        )
        surface?.resize(cols, rows)
        onResizeBroadcast?.invoke(cols, rows)
    }
    fun search(query: String, matchCase: Boolean = false): TerminalSearchResult? {
        return surface?.search(query, matchCase)
    }

    fun clearSearch() {
        surface?.clearSearch()
    }

    fun getSelectedText(): String? {
        if (!isInputAllowed()) return null
        return surface?.getSelectedText()
    }

    fun copySelection(): String? {
        if (!isInputAllowed()) return null
        return surface?.copySelection()
    }

    fun pasteText(text: String) {
        if (!isInputAllowed()) return
        val bytes = encodeBracketedPaste(text)
        sendInput(bytes)
    }

    override fun close() {
        surface?.close()
        rawInputSink = null
        activeModifiers.clear()
        onRequestReattach = null
    }
}
