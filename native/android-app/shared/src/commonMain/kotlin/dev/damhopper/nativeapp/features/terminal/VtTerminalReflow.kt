package dev.damhopper.nativeapp.features.terminal

internal data class VtReflowCursor(var row: Int, var col: Int, var pending: Boolean)

/** Reflow only soft continuations. Hard line endings and explicitly written spaces survive. */
internal fun reflowTerminalRows(
    source: List<VtTerminalRow>,
    oldCols: Int,
    newCols: Int,
    current: VtReflowCursor,
    saved: VtReflowCursor,
): MutableList<VtTerminalRow> {
    val result = mutableListOf<VtTerminalRow>()
    var first = 0
    val cursors = listOf(current, saved)
    val sourceRows = cursors.map { it.row }
    while (first < source.size) {
        var end = first
        while (end < source.lastIndex && source[end].softWrapped) end++
        val markerIndices = cursors.indices.filter { sourceRows[it] in first..end }
        val markers = markerIndices.map { cursors[it] }
        val offsets = IntArray(markers.size)
        val pending = BooleanArray(markers.size) { markers[it].pending }
        val mapped = BooleanArray(markers.size)
        val lengths = IntArray(end - first + 1)
        var logicalLength = 0
        for (r in first..end) {
            val row = source[r]
            var length = row.extent
            for (i in markers.indices) {
                if (sourceRows[markerIndices[i]] == r) {
                    val column = if (markers[i].pending) oldCols else markers[i].col
                    offsets[i] = logicalLength + column
                    length = maxOf(length, column)
                }
            }
            lengths[r - first] = length
            logicalLength += length
        }
        var output = VtTerminalRow(Array(newCols) { VtCell.EMPTY }, source[first].id)
        result.add(output)
        var col = 0
        var offset = 0
        for (r in first..end) {
            for (c in 0 until lengths[r - first]) {
                val cell = source[r].cells[c]
                if (cell.width == 0) continue
                val oldWidth = minOf(cell.width.coerceAtLeast(1), oldCols)
                // One-column viewports retain the scalar and its natural width; growing
                // restores its pair. Actual glyph clipping still depends on the device font.
                val width = minOf(cell.width.coerceAtLeast(1), newCols)
                if (col + width > newCols) {
                    output.softWrapped = true
                    output = VtTerminalRow.blank(newCols)
                    result.add(output)
                    col = 0
                }
                for (i in markers.indices) {
                    if (!mapped[i] && offsets[i] in offset until offset + oldWidth) {
                        markers[i].row = result.lastIndex
                        markers[i].col = col + (offsets[i] - offset).coerceAtMost(width - 1)
                        markers[i].pending = false
                        mapped[i] = true
                    }
                }
                output.cells[col] = cell
                if (width == 2) output.cells[col + 1] = cell.copy(char = "", width = 0)
                col += width
                output.extent = col
                offset += oldWidth
                for (i in markers.indices) {
                    if (!mapped[i] && pending[i] && offsets[i] == offset) {
                        markers[i].row = result.lastIndex
                        markers[i].col = if (col == newCols) col - 1 else col
                        markers[i].pending = col == newCols
                        mapped[i] = true
                    }
                }
            }
        }
        for (i in markers.indices) {
            if (mapped[i]) continue
            markers[i].row = result.lastIndex
            markers[i].col = if (col == newCols) col - 1 else col
            markers[i].pending = col == newCols
        }
        first = end + 1
    }
    return result
}
