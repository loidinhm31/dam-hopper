package dev.damhopper.nativeapp.features.terminal

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.AnnotatedString

/**
 * Android/Compose terminal surface backed by the full [VtTerminalEngine].
 *
 * Implements [NativeTerminalSurface], providing a 2D VT100 character matrix,
 * dual buffers (main/alternate), ANSI cursor motion, line/screen erasing,
 * and live-fenced protocol responses (CPR/DA).
 */
class VtTerminalSurface(
    initialCols: Int = 80,
    initialRows: Int = 24,
) : NativeTerminalSurface {

    private var _dimensions = TerminalDimensions(initialCols, initialRows)
    override val dimensions: TerminalDimensions get() = _dimensions

    private var _isAttached: Boolean = true
    override val isAttached: Boolean get() = _isAttached

    private var _isDisposed: Boolean = false
    override val isDisposed: Boolean get() = _isDisposed

    val engine = VtTerminalEngine(initialCols, initialRows)

    val lines = mutableStateListOf<AnnotatedString>()
    var updateRevision by mutableStateOf(0L)
        private set

    var isCursorBlinkingOn: Boolean = true
        private set

    fun updateCursorBlink(visible: Boolean) {
        if (_isDisposed) return
        isCursorBlinkingOn = visible
        synchronized(bufferLock) {
            syncLinesFromEngine()
        }
    }

    /**
     * Controls whether incoming feed chunks are considered live stream (enabling protocol replies like CPR)
     * or replay stream (suppressing protocol replies).
     */
    var isLiveStream: Boolean = true

    private var onInputListener: ((ByteArray) -> Unit)? = null
    private var onResizeListener: ((Int, Int) -> Unit)? = null
    private val bufferLock = Any()

    init {
        engine.onProtocolReply = { reply ->
            onInputListener?.invoke(reply)
        }
    }

    override fun attachView(hostView: Any?) {
        check(!_isDisposed) { "Cannot attach disposed VtTerminalSurface" }
        _isAttached = true
    }

    override fun detachView() {
        _isAttached = false
    }

    override fun feedOutput(data: ByteArray, offset: Long, reset: Boolean) {
        if (_isDisposed) return
        synchronized(bufferLock) {
            if (reset) {
                engine.reset()
            }
            engine.feedBytes(data, isLiveStream = isLiveStream)
            syncLinesFromEngine()
        }
    }

    fun clearDisplayBuffer() {
        synchronized(bufferLock) {
            engine.reset()
            lines.clear()
            updateRevision++
        }
    }

    private fun syncLinesFromEngine() {
        val rendered = engine.renderAllLines(cursorVisible = isCursorBlinkingOn)
        lines.clear()
        lines.addAll(rendered)
        updateRevision++
    }

    override fun resize(cols: Int, rows: Int) {
        if (_isDisposed) return
        if (cols == _dimensions.cols && rows == _dimensions.rows) return
        _dimensions = TerminalDimensions(cols, rows)
        synchronized(bufferLock) {
            engine.resize(cols, rows)
            syncLinesFromEngine()
        }
        onResizeListener?.invoke(cols, rows)
    }

    override fun setOnInputListener(listener: (ByteArray) -> Unit) {
        onInputListener = listener
    }

    override fun setOnResizeListener(listener: (cols: Int, rows: Int) -> Unit) {
        onResizeListener = listener
    }

    override fun search(query: String, matchCase: Boolean): TerminalSearchResult {
        if (query.isEmpty()) return TerminalSearchResult(query, 0, -1)
        var totalMatches = 0
        synchronized(bufferLock) {
            for (line in lines) {
                val text = line.text
                var idx = 0
                while (idx < text.length) {
                    val found = text.indexOf(query, idx, ignoreCase = !matchCase)
                    if (found >= 0) {
                        totalMatches++
                        idx = found + query.length
                    } else {
                        break
                    }
                }
            }
        }
        return TerminalSearchResult(query, totalMatches, if (totalMatches > 0) 0 else -1)
    }

    override fun clearSearch() {
        // no-op for now
    }

    override fun getSelectedText(): String? = null

    override fun copySelection(): String? = null

    override fun pasteText(text: String) {
        if (_isDisposed) return
        val bytes = if (engine.isBracketedPaste) {
            "\u001B[200~${text}\u001B[201~".encodeToByteArray()
        } else {
            text.encodeToByteArray()
        }
        onInputListener?.invoke(bytes)
    }

    override fun close() {
        _isDisposed = true
        _isAttached = false
        onInputListener = null
        onResizeListener = null
        engine.onProtocolReply = null
        synchronized(bufferLock) {
            lines.clear()
        }
    }
}
