package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle

/**
 * 2D Character grid implementing a VT100 / ANSI screen buffer.
 *
 * Maintains a 2D matrix of [VtCell] with cursor addressing, scroll margins (DECSTBM),
 * line and screen erasing, and optional scrollback history.
 */
class VtTerminalGrid(
    initialCols: Int = 80,
    initialRows: Int = 24,
    val hasScrollback: Boolean = true,
    val maxScrollback: Int = 2000,
) {
    var cols: Int = initialCols
        private set
    var rows: Int = initialRows
        private set

    private var screen: Array<Array<VtCell>> = createBlankScreen(cols, rows)
    val scrollback: MutableList<Array<VtCell>> = if (hasScrollback) mutableListOf() else mutableListOf()

    var cursorRow: Int = 0
        private set
    var cursorCol: Int = 0
        private set

    var savedCursorRow: Int = 0
        private set
    var savedCursorCol: Int = 0
        private set

    var scrollTop: Int = 0
        private set
    var scrollBottom: Int = rows - 1
        private set

    var isAutoWrap: Boolean = true
    private var wrapPending: Boolean = false

    private fun createBlankScreen(c: Int, r: Int): Array<Array<VtCell>> {
        return Array(r) { Array(c) { VtCell.EMPTY } }
    }

    private fun createBlankRow(c: Int): Array<VtCell> {
        return Array(c) { VtCell.EMPTY }
    }

    fun setCursor(row: Int, col: Int) {
        cursorRow = row.coerceIn(0, rows - 1)
        cursorCol = col.coerceIn(0, cols - 1)
        wrapPending = false
    }

    fun moveCursor(deltaRow: Int, deltaCol: Int) {
        setCursor(cursorRow + deltaRow, cursorCol + deltaCol)
    }

    fun saveCursor() {
        savedCursorRow = cursorRow
        savedCursorCol = cursorCol
    }

    fun restoreCursor() {
        setCursor(savedCursorRow, savedCursorCol)
    }

    fun setScrollMargins(top: Int, bottom: Int) {
        val safeTop = top.coerceIn(0, rows - 1)
        val safeBottom = bottom.coerceIn(safeTop, rows - 1)
        scrollTop = safeTop
        scrollBottom = safeBottom
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

    fun newLine() {
        wrapPending = false
        if (cursorRow == scrollBottom) {
            scrollUp(1)
        } else if (cursorRow < rows - 1) {
            cursorRow++
        }
    }

    fun backspace() {
        wrapPending = false
        if (cursorCol > 0) {
            cursorCol--
        }
    }

    fun writeCell(cell: VtCell) {
        if (wrapPending && isAutoWrap) {
            carriageReturn()
            newLine()
        }

        if (cursorRow in 0 until rows && cursorCol in 0 until cols) {
            screen[cursorRow][cursorCol] = cell
            if (cell.width > 1 && cursorCol + 1 < cols) {
                screen[cursorRow][cursorCol + 1] = VtCell(char = "", fg = cell.fg, bg = cell.bg, width = 0)
            }
        }

        val advance = cell.width.coerceAtLeast(1)
        if (cursorCol + advance >= cols) {
            cursorCol = cols - 1
            wrapPending = true
        } else {
            cursorCol += advance
            wrapPending = false
        }
    }

    fun eraseInLine(mode: Int) {
        if (cursorRow !in 0 until rows) return
        val row = screen[cursorRow]
        when (mode) {
            0 -> {
                // Erase from cursor to end of line
                for (c in cursorCol until cols) {
                    row[c] = VtCell.EMPTY
                }
            }
            1 -> {
                // Erase from start of line to cursor
                for (c in 0..cursorCol.coerceAtMost(cols - 1)) {
                    row[c] = VtCell.EMPTY
                }
            }
            2 -> {
                // Erase entire line
                for (c in 0 until cols) {
                    row[c] = VtCell.EMPTY
                }
            }
        }
        wrapPending = false
    }

    fun eraseInDisplay(mode: Int) {
        when (mode) {
            0 -> {
                // Erase from cursor to end of screen
                eraseInLine(0)
                for (r in (cursorRow + 1) until rows) {
                    screen[r] = createBlankRow(cols)
                }
            }
            1 -> {
                // Erase from start of screen to cursor
                for (r in 0 until cursorRow) {
                    screen[r] = createBlankRow(cols)
                }
                eraseInLine(1)
            }
            2 -> {
                // Erase entire screen
                for (r in 0 until rows) {
                    screen[r] = createBlankRow(cols)
                }
            }
            3 -> {
                // Erase scrollback
                if (hasScrollback) {
                    scrollback.clear()
                }
            }
        }
        wrapPending = false
    }

    fun scrollUp(count: Int) {
        val n = count.coerceIn(1, scrollBottom - scrollTop + 1)
        for (step in 0 until n) {
            if (scrollTop == 0 && hasScrollback) {
                scrollback.add(screen[0].copyOf())
                while (scrollback.size > maxScrollback) {
                    scrollback.removeAt(0)
                }
            }
            for (r in scrollTop until scrollBottom) {
                screen[r] = screen[r + 1]
            }
            screen[scrollBottom] = createBlankRow(cols)
        }
    }

    fun scrollDown(count: Int) {
        val n = count.coerceIn(1, scrollBottom - scrollTop + 1)
        for (step in 0 until n) {
            for (r in scrollBottom downTo scrollTop + 1) {
                screen[r] = screen[r - 1]
            }
            screen[scrollTop] = createBlankRow(cols)
        }
    }

    fun insertLines(count: Int) {
        if (cursorRow in scrollTop..scrollBottom) {
            val oldScrollTop = scrollTop
            scrollTop = cursorRow
            scrollDown(count)
            scrollTop = oldScrollTop
        }
    }

    fun deleteLines(count: Int) {
        if (cursorRow in scrollTop..scrollBottom) {
            val oldScrollTop = scrollTop
            scrollTop = cursorRow
            scrollUp(count)
            scrollTop = oldScrollTop
        }
    }

    fun clearAll() {
        for (r in 0 until rows) {
            screen[r] = createBlankRow(cols)
        }
        if (hasScrollback) {
            scrollback.clear()
        }
        cursorRow = 0
        cursorCol = 0
        wrapPending = false
        resetScrollMargins()
    }

    fun resize(newCols: Int, newRows: Int) {
        if (newCols == cols && newRows == rows) return
        val newScreen = createBlankScreen(newCols, newRows)
        val copyRows = minOf(rows, newRows)
        val copyCols = minOf(cols, newCols)

        for (r in 0 until copyRows) {
            for (c in 0 until copyCols) {
                newScreen[r][c] = screen[r][c]
            }
        }

        cols = newCols
        rows = newRows
        screen = newScreen
        scrollTop = 0
        scrollBottom = newRows - 1
        cursorRow = cursorRow.coerceIn(0, newRows - 1)
        cursorCol = cursorCol.coerceIn(0, newCols - 1)
        wrapPending = false
    }

    fun getRowText(r: Int): String {
        if (r !in 0 until rows) return ""
        val row = screen[r]
        val sb = StringBuilder()
        for (cell in row) {
            if (cell.width > 0) sb.append(cell.char)
        }
        return sb.toString().trimEnd()
    }

    fun renderRowToAnnotatedString(
        row: Array<VtCell>,
        cursorCol: Int? = null,
    ): AnnotatedString {
        return buildAnnotatedString {
            var lastIndex = cursorCol ?: -1
            for (i in row.indices.reversed()) {
                if (row[i].char != " " && row[i].char.isNotEmpty()) {
                    lastIndex = maxOf(lastIndex, i)
                    break
                }
            }

            if (lastIndex == -1) {
                return@buildAnnotatedString
            }

            for (i in 0..lastIndex.coerceAtMost(cols - 1)) {
                val cell = row[i]
                if (cell.width == 0) continue // placeholder for wide char

                if (cursorCol != null && i == cursorCol) {
                    val cursorChar = if (cell.char.isNotEmpty() && cell.char != " ") cell.char else "█"
                    withStyle(
                        androidx.compose.ui.text.SpanStyle(
                            color = if (cursorChar == "█") androidx.compose.ui.graphics.Color(0xFF58A6FF) else androidx.compose.ui.graphics.Color(0xFF0D1117),
                            background = if (cursorChar == "█") androidx.compose.ui.graphics.Color.Transparent else androidx.compose.ui.graphics.Color(0xFF58A6FF),
                            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        )
                    ) {
                        append(cursorChar)
                    }
                } else {
                    withStyle(cell.toSpanStyle()) {
                        append(cell.char)
                    }
                }
            }
        }
    }

    fun renderAllLines(
        includeScrollback: Boolean = true,
        cursorRow: Int? = null,
        cursorCol: Int? = null,
        trimTrailingEmptyRows: Boolean = false,
    ): List<AnnotatedString> {
        val result = mutableListOf<AnnotatedString>()
        if (includeScrollback && hasScrollback) {
            for (row in scrollback) {
                result.add(renderRowToAnnotatedString(row))
            }
        }

        val maxRowToRender = if (trimTrailingEmptyRows) {
            var lastNonEmpty = cursorRow ?: 0
            for (r in (rows - 1) downTo 0) {
                if (screen[r].any { it.char != " " && it.char.isNotEmpty() }) {
                    lastNonEmpty = maxOf(lastNonEmpty, r)
                    break
                }
            }
            lastNonEmpty
        } else {
            rows - 1
        }

        for (r in 0..maxRowToRender) {
            val isCursorRow = (r == cursorRow)
            result.add(renderRowToAnnotatedString(screen[r], if (isCursorRow) cursorCol else null))
        }
        return result
    }
}
