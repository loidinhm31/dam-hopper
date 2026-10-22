package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.text.AnnotatedString

/** Physical rows share one bounded main-buffer backing, including resize-displaced lower rows. */
class VtTerminalGrid(
    initialCols: Int = 80,
    initialRows: Int = 24,
    val hasScrollback: Boolean = true,
    val maxScrollback: Int = 2000,
) {
    var cols: Int = initialCols.coerceAtLeast(1)
        private set
    var rows: Int = initialRows.coerceAtLeast(1)
        private set
    private var screen = MutableList(rows) { VtTerminalRow.blank(cols) }
    private val history = ArrayDeque<VtTerminalRow>()
    private val below = ArrayDeque<VtTerminalRow>()

    var cursorRow: Int = 0
        private set
    var cursorCol: Int = 0
        private set
    private var savedRow = screen[0]
    val savedCursorRow: Int get() = screen.indexOf(savedRow).let { if (it < 0) 0 else it }
    var savedCursorCol: Int = 0
        private set
    private var savedWrapPending = false
    var scrollTop: Int = 0
        private set
    var scrollBottom: Int = rows - 1
        private set
    var isAutoWrap: Boolean = true
        set(value) {
            field = value
            if (!value) wrapPending = false
        }
    private var wrapPending = false

    fun setCursor(row: Int, col: Int) {
        cursorRow = row.coerceIn(0, rows - 1)
        cursorCol = col.coerceIn(0, cols - 1)
        wrapPending = false
    }

    fun moveCursor(deltaRow: Int, deltaCol: Int) = setCursor(cursorRow + deltaRow, cursorCol + deltaCol)

    fun saveCursor() {
        savedRow = screen[cursorRow]
        savedCursorCol = cursorCol
        savedWrapPending = wrapPending
    }

    fun restoreCursor() {
        var index = screen.indexOf(savedRow)
        if (index < 0 && hasScrollback) {
            val retained = retainedRows()
            val absolute = retained.indexOf(savedRow)
            if (absolute >= 0) {
                val start = absolute.coerceAtMost((retained.size - rows).coerceAtLeast(0))
                installRows(retained, start)
                index = absolute - start
            }
        }
        setCursor(index.coerceAtLeast(0), savedCursorCol)
        wrapPending = savedWrapPending && cursorCol == cols - 1
    }

    fun setScrollMargins(top: Int, bottom: Int) {
        scrollTop = top.coerceIn(0, rows - 1)
        scrollBottom = bottom.coerceIn(scrollTop, rows - 1)
        setCursor(0, 0)
    }

    fun resetScrollMargins() {
        scrollTop = 0
        scrollBottom = rows - 1
    }

    fun carriageReturn() {
        cursorCol = 0
        wrapPending = false
    }

    fun newLine() = advanceLine(soft = false)

    private fun advanceLine(soft: Boolean) {
        screen[cursorRow].softWrapped = soft
        wrapPending = false
        if (cursorRow == scrollBottom) scrollUpRows(1) else if (cursorRow < rows - 1) cursorRow++
    }

    fun backspace() {
        wrapPending = false
        if (cursorCol > 0) cursorCol--
    }

    fun writeCell(cell: VtCell) {
        if (wrapPending && isAutoWrap) {
            advanceLine(soft = true)
            cursorCol = 0
        }
        var value = cell
        val width = minOf(cell.width.coerceAtLeast(1), cols)
        if (width == 2 && cursorCol == cols - 1) {
            if (isAutoWrap) {
                advanceLine(soft = true)
                cursorCol = 0
            } else {
                // A two-cell glyph cannot occupy a clipped half-pair at the right margin.
                value = cell.copy(char = " ", width = 1)
            }
        }
        val advance = minOf(value.width.coerceAtLeast(1), cols)
        val row = screen[cursorRow]
        val oldExtent = row.extent
        row.erase(cursorCol, cursorCol + advance)
        row.cells[cursorCol] = value
        if (advance == 2) row.cells[cursorCol + 1] = value.copy(char = "", width = 0)
        row.extent = maxOf(row.extent, minOf(oldExtent, cursorCol), cursorCol + advance)
        if (cursorCol + advance >= cols) {
            cursorCol = cols - 1
            wrapPending = isAutoWrap
        } else {
            cursorCol += advance
            wrapPending = false
        }
    }

    fun eraseInLine(mode: Int) {
        val row = screen[cursorRow]
        if (mode == 0 || mode == 2) clearHiddenContinuation(cursorRow)
        when (mode) {
            0 -> row.erase(cursorCol, cols)
            1 -> row.erase(0, cursorCol + 1)
            2 -> row.clear()
            else -> return
        }
        if (mode != 1) {
            row.softWrapped = false
        }
        wrapPending = false
    }

    /** Only resize-displaced continuation rows are affected, not visible addressed rows. */
    private fun clearHiddenContinuation(rowIndex: Int) {
        if (rowIndex != screen.lastIndex || !screen[rowIndex].softWrapped) return
        var continuation = true
        for (row in below) {
            if (!continuation) break
            continuation = row.softWrapped
            row.clear()
        }
    }

    fun eraseInDisplay(mode: Int) {
        when (mode) {
            0 -> {
                eraseInLine(0)
                for (r in cursorRow + 1 until rows) screen[r].clear()
                below.forEach { it.clear() }
            }
            1 -> {
                for (r in 0 until cursorRow) screen[r].clear()
                eraseInLine(1)
            }
            2 -> {
                screen.forEach { it.clear() }
                below.forEach { it.clear() }
            }
            3 -> history.clear()
        }
        wrapPending = false
    }

    fun deleteCharacters(count: Int) {
        val row = screen[cursorRow]
        val n = count.coerceAtLeast(1).coerceAtMost(cols - cursorCol)
        // Clear intersected pairs before shifting so neither boundary leaves an orphan.
        row.erase(cursorCol, cursorCol + n)
        for (c in cursorCol until cols - n) row.cells[c] = row.cells[c + n]
        for (c in cols - n until cols) row.cells[c] = VtCell.EMPTY
        row.extent = maxOf(cursorCol.coerceAtMost(row.extent), row.extent - n)
        repairWideCells(row)
        clearHiddenContinuation(cursorRow)
        row.softWrapped = false
        row.invalidate()
        wrapPending = false
    }

    private fun repairWideCells(row: VtTerminalRow) {
        for (c in row.cells.indices) {
            val cell = row.cells[c]
            if (cell.width == 0 && (c == 0 || row.cells[c - 1].width != 2)) row.cells[c] = VtCell.EMPTY
            if (cell.width == 2 && cols > 1 && (c == cols - 1 || row.cells[c + 1].width != 0)) {
                row.cells[c] = VtCell.EMPTY
            }
        }
    }

    fun scrollUp(count: Int) {
        screen[scrollBottom].softWrapped = false
        scrollUpRows(count)
    }

    private fun scrollUpRows(count: Int) {
        if (scrollTop > 0) screen[scrollTop - 1].softWrapped = false
        repeat(count.coerceIn(1, scrollBottom - scrollTop + 1)) {
            val removed = screen.removeAt(scrollTop)
            if (scrollTop == 0 && scrollBottom == rows - 1 && hasScrollback) history.addLast(removed)
            screen.add(scrollBottom, VtTerminalRow.blank(cols))
        }
        trimRetention()
    }

    fun scrollDown(count: Int) {
        if (scrollTop > 0) screen[scrollTop - 1].softWrapped = false
        repeat(count.coerceIn(1, scrollBottom - scrollTop + 1)) {
            screen.removeAt(scrollBottom)
            screen.add(scrollTop, VtTerminalRow.blank(cols))
        }
        screen[scrollBottom].softWrapped = false
    }

    fun insertLines(count: Int) {
        if (cursorRow !in scrollTop..scrollBottom) return
        val top = scrollTop
        scrollTop = cursorRow
        scrollDown(count)
        scrollTop = top
    }

    fun deleteLines(count: Int) {
        if (cursorRow !in scrollTop..scrollBottom) return
        if (cursorRow > 0) screen[cursorRow - 1].softWrapped = false
        // DL discards addressed rows, even at row zero; it is not a history scroll.
        repeat(count.coerceIn(1, scrollBottom - cursorRow + 1)) {
            screen.removeAt(cursorRow)
            screen.add(scrollBottom, VtTerminalRow.blank(cols))
            if (scrollBottom > cursorRow) screen[scrollBottom - 1].softWrapped = false
        }
    }

    fun clearAll() {
        screen = MutableList(rows) { VtTerminalRow.blank(cols) }
        history.clear()
        below.clear()
        cursorRow = 0
        cursorCol = 0
        savedRow = screen[0]
        savedCursorCol = 0
        savedWrapPending = false
        wrapPending = false
        isAutoWrap = true
        resetScrollMargins()
    }

    private fun retainedRows(): MutableList<VtTerminalRow> = ArrayList<VtTerminalRow>(history.size + rows + below.size).also {
        it.addAll(history)
        it.addAll(screen)
        it.addAll(below)
    }

    private fun installRows(retained: List<VtTerminalRow>, start: Int) {
        history.clear()
        history.addAll(retained.subList(0, start))
        screen = retained.subList(start, minOf(start + rows, retained.size)).toMutableList()
        while (screen.size < rows) screen.add(VtTerminalRow.blank(cols))
        below.clear()
        if (start + rows < retained.size) below.addAll(retained.subList(start + rows, retained.size))
        trimRetention()
    }

    /** Both off-viewport directions share one budget; oldest offscreen rows evict first. */
    private fun trimRetention() {
        val budget = if (hasScrollback) maxScrollback.coerceAtLeast(0) else 0
        while (history.size + below.size > budget) {
            if (history.isNotEmpty()) history.removeFirst() else below.removeFirst()
        }
    }

    fun resize(newCols: Int, newRows: Int) {
        val width = newCols.coerceAtLeast(1)
        val height = newRows.coerceAtLeast(1)
        if (width == cols && height == rows) return
        if (!hasScrollback) {
            val savedIndex = savedCursorRow
            val cropped = MutableList(height) { r ->
                if (r >= rows) VtTerminalRow.blank(width) else {
                    val old = screen[r]
                    VtTerminalRow(Array(width) { c -> old.cells.getOrElse(c) { VtCell.EMPTY } }, old.id).also {
                        it.extent = minOf(old.extent, width)
                    }
                }
            }
            cols = width
            rows = height
            screen = cropped
            screen.forEach { repairWideCells(it) }
            cursorRow = cursorRow.coerceAtMost(rows - 1)
            cursorCol = cursorCol.coerceAtMost(cols - 1)
            savedRow = screen[savedIndex.coerceAtMost(rows - 1)]
            savedCursorCol = savedCursorCol.coerceAtMost(cols - 1)
            wrapPending = false
            savedWrapPending = false
            resetScrollMargins()
            return
        }
        var retained = retainedRows()
        val oldStart = history.size
        val current = VtReflowCursor(oldStart + cursorRow, cursorCol, wrapPending)
        val saved = VtReflowCursor(retained.indexOf(savedRow).coerceAtLeast(0), savedCursorCol, savedWrapPending)
        var start = oldStart
        if (width != cols) {
            // Map the previous viewport origin as well, so offscreen history stays offscreen.
            val originId = screen[0].id
            retained = reflowTerminalRows(retained, cols, width, current, saved)
            start = retained.indexOfFirst { it.id == originId }.let { if (it < 0) current.row - cursorRow else it }
        }
        start = (start - (height - rows).coerceAtLeast(0)).coerceAtLeast(0)
        start = start.coerceAtMost(current.row)
        start = maxOf(start, current.row - height + 1)
        cols = width
        rows = height
        savedRow = retained[saved.row]
        savedCursorCol = saved.col
        savedWrapPending = saved.pending
        installRows(retained, start)
        cursorRow = current.row - start
        cursorCol = current.col
        wrapPending = current.pending
        resetScrollMargins()
    }

    fun getRowText(r: Int): String {
        if (r !in screen.indices) return ""
        return buildString { for (cell in screen[r].cells) if (cell.width > 0) append(cell.char) }.trimEnd()
    }

    internal fun renderedRowCount(includeScrollback: Boolean, trimTrailingEmptyRows: Boolean): Int {
        var last = rows - 1
        if (trimTrailingEmptyRows) {
            while (last > cursorRow && screen[last].extent == 0) last--
        }
        return (if (includeScrollback) history.size else 0) + last + 1
    }

    internal fun renderedRow(index: Int, includeScrollback: Boolean): VtTerminalRow {
        val historySize = if (includeScrollback) history.size else 0
        return if (index < historySize) history[index] else screen[index - historySize]
    }

    internal fun renderedRowId(index: Int, includeScrollback: Boolean): Long = renderedRow(index, includeScrollback).id

    internal fun renderedCursorIndex(includeScrollback: Boolean): Int = (if (includeScrollback) history.size else 0) + cursorRow

    internal fun renderLine(index: Int, includeScrollback: Boolean, showCursor: Boolean): AnnotatedString {
        val column = if (index == renderedCursorIndex(includeScrollback)) cursorCol else null
        return renderedRow(index, includeScrollback).render(column, showCursor)
    }

    fun renderAllLines(
        includeScrollback: Boolean = true,
        cursorRow: Int? = null,
        cursorCol: Int? = null,
        trimTrailingEmptyRows: Boolean = false,
    ): List<AnnotatedString> {
        val includeHistory = includeScrollback && hasScrollback
        return List(renderedRowCount(includeHistory, trimTrailingEmptyRows)) { index ->
            val screenIndex = index - if (includeHistory) history.size else 0
            val column = if (screenIndex == this.cursorRow) this.cursorCol else null
            renderedRow(index, includeHistory).render(column, screenIndex == cursorRow && cursorCol != null)
        }
    }
}
