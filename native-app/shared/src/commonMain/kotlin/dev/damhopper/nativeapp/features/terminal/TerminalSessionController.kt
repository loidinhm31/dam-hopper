package dev.damhopper.nativeapp.features.terminal

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
            return
        }

        // Newer incarnation detected before buffer: bump incarnation and reset offset
        if (chunkIncarnation > incarnation) {
            incarnation = chunkIncarnation
            lastSeenOffset = 0uL
            gate.resetForAttach()
            requestReattach()
            return
        }

        // If historical replay is still in progress, queue live chunk
        if (!gate.isLiveStreamReady) {
            gate.enqueueLiveChunk(QueuedLiveChunk(data, offset, chunkIncarnation))
            return
        }

        // Reconcile contiguous/overlapping chunk
        when (val result = reconcileTerminalOutput(data, offset, lastSeenOffset)) {
            is ReconcileOutputResult.Discard -> {
                // Chunk already processed; discard duplicate
            }
            is ReconcileOutputResult.Gap -> {
                // Stream gap detected; request re-attach
                requestReattach()
            }
            is ReconcileOutputResult.Render -> {
                lastSeenOffset = result.nextOffset
                surface?.feedOutput(result.data, result.nextOffset.toLong() - result.data.size, false)
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
            return
        }
        if (bufferIncarnation > incarnation) {
            incarnation = bufferIncarnation
        }
        isTruncated = truncated

        gate.beginReplayWrite()
        try {
            surface?.feedOutput(data, offset.toLong() - data.size, reset)
            lastSeenOffset = offset
        } finally {
            gate.finishReplayWrite()
            gate.notifyReplayDrain()
        }
    }

    private fun drainQueuedChunksAfterReplay() {
        gate.markLiveStreamReady()
        val queued = gate.drainQueuedChunks()
        for (chunk in queued) {
            if (!gate.isLiveStreamReady) break
            handleLiveChunk(chunk.data, chunk.offset, chunk.incarnation)
        }
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
    }

    /**
     * Handles lagged stream notification.
     */
    fun handleLagged(dropped: ULong) {
        lastLaggedDropped = dropped
        requestReattach()
    }

    private fun requestReattach() {
        gate.resetForAttach()
        onRequestReattach?.invoke(sessionId, lastSeenOffset)
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
        val seq = when (name.uppercase()) {
            "UP" -> "\u001b[A"
            "DOWN" -> "\u001b[B"
            "RIGHT" -> "\u001b[C"
            "LEFT" -> "\u001b[D"
            "HOME" -> "\u001b[H"
            "END" -> "\u001b[F"
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
        if (!isPanelActive) return
        if (!isReplayCompleted) return
        if (!gate.shouldForwardTerminalData()) return
        if (!isInputAllowed()) return
        rawInputSink?.invoke(bytes)
    }

    private fun handleSurfaceInput(bytes: ByteArray) {
        sendInput(bytes)
    }

    fun resize(cols: Int, rows: Int) {
        surface?.resize(cols, rows)
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
