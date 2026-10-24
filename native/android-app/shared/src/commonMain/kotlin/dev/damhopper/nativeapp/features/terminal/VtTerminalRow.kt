package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/** Cells, wrap metadata, identity and styled caches always travel together. */
internal class VtTerminalRow(val cells: Array<VtCell>, val id: Long = nextId()) {
    var extent = 0
    var softWrapped = false
    private var base: AnnotatedString? = null
    private var padded: AnnotatedString? = null
    private var cursor: AnnotatedString? = null
    private var paddedColumn = -1

    fun invalidate() {
        base = null
        padded = null
        cursor = null
        paddedColumn = -1
    }

    fun clear() {
        cells.fill(VtCell.EMPTY)
        extent = 0
        softWrapped = false
        invalidate()
    }

    /** Erasing either half of a wide glyph erases the complete glyph. */
    fun erase(start: Int, end: Int) {
        if (start >= end) return
        var first = start.coerceAtLeast(0)
        var last = end.coerceAtMost(cells.size)
        if (first < cells.size && cells[first].width == 0) first--
        if (last < cells.size && cells[last].width == 0) last++
        for (i in first.coerceAtLeast(0) until last) cells[i] = VtCell.EMPTY
        if (last >= extent) extent = minOf(extent, first.coerceAtLeast(0))
        invalidate()
    }

    fun render(cursorColumn: Int? = null, showCursor: Boolean = false): AnnotatedString {
        val column = cursorColumn?.takeIf { it in cells.indices }?.let {
            if (cells[it].width == 0 && it > 0) it - 1 else it
        } ?: -1
        if (base == null) base = styled(extent, -1)
        if (column < 0) return base!!
        if (paddedColumn != column) {
            paddedColumn = column
            padded = null
            cursor = null
        }
        val length = maxOf(extent, column + minOf(cells[column].width.coerceAtLeast(1), cells.size - column))
        if (!showCursor) {
            if (length == extent) return base!!
            if (padded == null) padded = styled(length, -1)
            return padded!!
        }
        if (cursor == null) cursor = styled(length, column)
        return cursor!!
    }

    private fun styled(length: Int, cursorColumn: Int): AnnotatedString = buildAnnotatedString {
        for (i in 0 until length.coerceAtMost(cells.size)) {
            val cell = cells[i]
            if (cell.width == 0) continue
            if (i == cursorColumn) {
                val blank = cell.char.isEmpty() || cell.char == " "
                withStyle(SpanStyle(
                    color = if (blank) Color(0xFF58A6FF) else Color(0xFF0D1117),
                    background = if (blank) Color.Transparent else Color(0xFF58A6FF),
                    fontWeight = FontWeight.Bold,
                )) { append(if (blank) "█" else cell.char) }
            } else {
                withStyle(cell.toSpanStyle()) { append(cell.char) }
            }
        }
    }

    companion object {
        private val identityLock = Any()
        private var identity = 0L
        private fun nextId(): Long = synchronized(identityLock) { ++identity }
        fun blank(cols: Int) = VtTerminalRow(Array(cols) { VtCell.EMPTY })
    }
}
