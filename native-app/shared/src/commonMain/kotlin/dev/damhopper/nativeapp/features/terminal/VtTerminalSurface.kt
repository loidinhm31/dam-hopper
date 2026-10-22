package dev.damhopper.nativeapp.features.terminal

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.referentialEqualityPolicy
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.AnnotatedString

/**
 * Android/Compose terminal surface backed by the full [VtTerminalEngine].
 *
 * Implements [NativeTerminalSurface], providing a 2D VT100 character matrix,
 * dual buffers (main/alternate), ANSI cursor motion, line/screen erasing,
 * and live-fenced protocol responses (CPR/DA).
 *
 * State is published atomically as an immutable [TerminalDisplaySnapshot] to eliminate
 * element-by-element persistent vector comparisons and UI thread freezes.
 */
class VtTerminalSurface(
    initialCols: Int = 80,
    initialRows: Int = 24,
) : NativeTerminalSurface {

    private var _dimensions = TerminalDimensions(initialCols.coerceAtLeast(1), initialRows.coerceAtLeast(1))
    override val dimensions: TerminalDimensions get() = _dimensions

    private var _isAttached: Boolean = true
    override val isAttached: Boolean get() = _isAttached

    private var _isDisposed: Boolean = false
    override val isDisposed: Boolean get() = _isDisposed

    val engine = VtTerminalEngine(initialCols, initialRows)

    var displaySnapshot by mutableStateOf(TerminalDisplaySnapshot(), referentialEqualityPolicy())
        private set

    val lines: List<AnnotatedString> get() = displaySnapshot.lines
    val lineIds: List<Long> get() = displaySnapshot.lineIds
    val updateRevision: Long get() = displaySnapshot.revision

    var isCursorBlinkingOn: Boolean = true
        private set

    var surfaceGeneration: Long = 0L
        private set

    fun updateCursorBlink(visible: Boolean) {
        if (_isDisposed || isCursorBlinkingOn == visible) return
        isCursorBlinkingOn = visible
        // Lock-free presentation update on UI thread without taking bufferLock
        displaySnapshot = displaySnapshot.withCursorBlink(visible)
    }

    /**
     * Controls whether incoming feed chunks are considered live stream (enabling protocol replies like CPR)
     * or replay stream (suppressing protocol replies).
     */
    var isLiveStream: Boolean = true

    private var onInputListener: ((ByteArray) -> Unit)? = null
    private var onResizeListener: ((Int, Int) -> Unit)? = null
    val bufferLock = Any()

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
                surfaceGeneration++
                engine.reset()
            }
            engine.feedBytes(data, isLiveStream = isLiveStream)
            syncLinesFromEngine()
        }
    }

    fun clearDisplayBuffer() {
        if (_isDisposed) return
        synchronized(bufferLock) {
            surfaceGeneration++
            engine.reset()
            syncLinesFromEngine(geometryChanged = true)
        }
    }

    internal fun syncLinesFromEngine(geometryChanged: Boolean = false) {
        if (_isDisposed) return
        val grid = engine.activeGrid
        val includeHistory = !engine.isAltScreen
        val count = grid.renderedRowCount(includeHistory, trimTrailingEmptyRows = includeHistory)
        val oldSnapshot = displaySnapshot
        var contentChanged = geometryChanged || count != oldSnapshot.rows.size
        val cursorIdx = grid.renderedCursorIndex(includeHistory)
        val showCursor = engine.isCursorVisible && isCursorBlinkingOn
        val renderedRows = ArrayList<RenderedRow>(count)
        val linesList = ArrayList<AnnotatedString>(count)
        val idsList = ArrayList<Long>(count)
        for (i in 0 until count) {
            val row = grid.renderedRow(i, includeHistory)
            val isCursorRow = (i == cursorIdx)
            val base = row.render(cursorColumn = null, showCursor = false)
            val padded = if (isCursorRow) row.render(grid.cursorCol, showCursor = false) else null
            val cursor = if (isCursorRow) row.render(grid.cursorCol, showCursor = true) else null
            val id = row.id
            if (!contentChanged && (i >= oldSnapshot.rows.size || oldSnapshot.rows[i].id != id || oldSnapshot.rows[i].baseText !== base)) {
                contentChanged = true
            }
            renderedRows.add(RenderedRow(id, base, padded, cursor))
            linesList.add(if (isCursorRow && showCursor) cursor ?: padded ?: base else if (isCursorRow) padded ?: base else base)
            idsList.add(id)
        }
        val nextRevision = if (contentChanged) oldSnapshot.revision + 1 else oldSnapshot.revision
        displaySnapshot = TerminalDisplaySnapshot(
            rows = renderedRows,
            lines = linesList,
            lineIds = idsList,
            revision = nextRevision,
            cursorIndex = cursorIdx,
            cursorRow = grid.cursorRow,
            cursorCol = grid.cursorCol,
            isCursorVisible = engine.isCursorVisible,
            isAppCursorKeys = engine.isAppCursorKeys,
            isBracketedPaste = engine.isBracketedPaste,
            isCursorBlinkingOn = isCursorBlinkingOn,
            generation = surfaceGeneration,
        )
    }

    override fun resize(cols: Int, rows: Int) {
        if (_isDisposed) return
        val width = cols.coerceAtLeast(1)
        val height = rows.coerceAtLeast(1)
        if (width == _dimensions.cols && height == _dimensions.rows) return
        synchronized(bufferLock) {
            _dimensions = TerminalDimensions(width, height)
            engine.resize(width, height)
            syncLinesFromEngine(geometryChanged = true)
        }
        onResizeListener?.invoke(width, height)
    }

    override fun setOnInputListener(listener: (ByteArray) -> Unit) {
        onInputListener = listener
    }

    override fun setOnResizeListener(listener: (cols: Int, rows: Int) -> Unit) {
        onResizeListener = listener
    }

    override fun search(query: String, matchCase: Boolean): TerminalSearchResult {
        if (query.isEmpty()) return TerminalSearchResult(query, 0, -1)
        val currentLines = displaySnapshot.lines
        var totalMatches = 0
        for (line in currentLines) {
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
        return TerminalSearchResult(query, totalMatches, if (totalMatches > 0) 0 else -1)
    }

    override fun clearSearch() {
        // no-op for now
    }

    override fun getSelectedText(): String? = null

    override fun copySelection(): String? = null

    override fun pasteText(text: String) {
        if (_isDisposed) return
        val isBracketed = displaySnapshot.isBracketedPaste
        val bytes = if (isBracketed) {
            "\u001B[200~${text}\u001B[201~".encodeToByteArray()
        } else {
            text.encodeToByteArray()
        }
        onInputListener?.invoke(bytes)
    }

    override fun close() {
        _isDisposed = true
        _isAttached = false
        surfaceGeneration++
        onInputListener = null
        onResizeListener = null
        engine.onProtocolReply = null
        displaySnapshot = TerminalDisplaySnapshot(generation = surfaceGeneration)
    }
}
