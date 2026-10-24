package dev.damhopper.nativeapp.features.git

import kotlin.math.max
import kotlin.math.min

/**
 * Computes deterministic line-level diffs and layout representations
 * with bounded computation budgets to guarantee UI responsiveness.
 */
object DiffCalculator {

    private const val MAX_DIFF_LINES = 10_000

    /**
     * Computes diff rows for either Side-by-Side or Inline layout mode.
     */
    fun computeDiffRows(
        original: String?,
        modified: String?,
        mode: DiffLayoutMode = DiffLayoutMode.SIDE_BY_SIDE,
        serverHunks: List<HunkInfo> = emptyList(),
    ): List<DiffRow> {
        val oldLines = if (original.isNullOrEmpty()) emptyList() else original.lines()
        val newLines = if (modified.isNullOrEmpty()) emptyList() else modified.lines()

        if (oldLines.isEmpty() && newLines.isEmpty()) {
            return emptyList()
        }

        if (oldLines.size > MAX_DIFF_LINES || newLines.size > MAX_DIFF_LINES) {
            return computeTruncatedRows(oldLines, newLines, mode)
        }

        val diffItems = LcsDiffEngine.computeDiff(oldLines, newLines)
        val rawRows = when (mode) {
            DiffLayoutMode.INLINE -> buildInlineRows(diffItems)
            DiffLayoutMode.SIDE_BY_SIDE -> buildSideBySideRows(diffItems)
        }

        if (serverHunks.isEmpty()) return rawRows
        return rawRows.map { row ->
            val matched = serverHunks.find { h ->
                (row.newLineNumber != null && row.newLineNumber in h.newStart until (h.newStart + maxOf(1, h.newLines))) ||
                (row.oldLineNumber != null && row.oldLineNumber in h.oldStart until (h.oldStart + maxOf(1, h.oldLines)))
            }
            if (matched != null) row.copy(hunkIndex = matched.index) else row
        }
    }

    private fun buildInlineRows(items: List<DiffItem>): List<DiffRow> {
        var hunkCounter = 0
        var inHunk = false

        return items.map { item ->
            val isChange = item.type == DiffLineType.ADDED || item.type == DiffLineType.DELETED
            if (isChange && !inHunk) {
                inHunk = true
                hunkCounter++
            } else if (!isChange && inHunk) {
                inHunk = false
            }

            DiffRow(
                oldLineNumber = item.oldLine,
                oldContent = item.oldText,
                oldType = item.type,
                newLineNumber = item.newLine,
                newContent = item.newText,
                newType = item.type,
                hunkIndex = if (isChange) hunkCounter - 1 else null
            )
        }
    }

    private fun buildSideBySideRows(items: List<DiffItem>): List<DiffRow> {
        val rows = mutableListOf<DiffRow>()
        var idx = 0
        var hunkCounter = 0

        while (idx < items.size) {
            val item = items[idx]
            when (item.type) {
                DiffLineType.UNCHANGED -> {
                    rows.add(
                        DiffRow(
                            oldLineNumber = item.oldLine,
                            oldContent = item.oldText,
                            oldType = DiffLineType.UNCHANGED,
                            newLineNumber = item.newLine,
                            newContent = item.newText,
                            newType = DiffLineType.UNCHANGED,
                            hunkIndex = null
                        )
                    )
                    idx++
                }

                DiffLineType.DELETED, DiffLineType.ADDED -> {
                    val deletedBlock = mutableListOf<DiffItem>()
                    val addedBlock = mutableListOf<DiffItem>()

                    while (idx < items.size && items[idx].type != DiffLineType.UNCHANGED) {
                        if (items[idx].type == DiffLineType.DELETED) {
                            deletedBlock.add(items[idx])
                        } else if (items[idx].type == DiffLineType.ADDED) {
                            addedBlock.add(items[idx])
                        }
                        idx++
                    }

                    val hunkId = hunkCounter++
                    val maxBlockSize = max(deletedBlock.size, addedBlock.size)

                    for (k in 0 until maxBlockSize) {
                        val del = deletedBlock.getOrNull(k)
                        val add = addedBlock.getOrNull(k)

                        rows.add(
                            DiffRow(
                                oldLineNumber = del?.oldLine,
                                oldContent = del?.oldText,
                                oldType = if (del != null) DiffLineType.DELETED else DiffLineType.UNCHANGED,
                                newLineNumber = add?.newLine,
                                newContent = add?.newText,
                                newType = if (add != null) DiffLineType.ADDED else DiffLineType.UNCHANGED,
                                hunkIndex = hunkId
                            )
                        )
                    }
                }

                DiffLineType.MODIFIED, DiffLineType.HEADER -> {
                    idx++
                }
            }
        }

        return rows
    }

    private fun computeTruncatedRows(
        oldLines: List<String>,
        newLines: List<String>,
        mode: DiffLayoutMode,
    ): List<DiffRow> {
        val rows = mutableListOf<DiffRow>()
        rows.add(
            DiffRow(
                oldLineNumber = null,
                oldContent = "[File exceeds diff limit ($MAX_DIFF_LINES lines) - displaying truncated preview]",
                oldType = DiffLineType.HEADER,
                newLineNumber = null,
                newContent = "[File exceeds diff limit ($MAX_DIFF_LINES lines) - displaying truncated preview]",
                newType = DiffLineType.HEADER
            )
        )
        val limit = min(500, max(oldLines.size, newLines.size))
        for (i in 0 until limit) {
            val oldL = oldLines.getOrNull(i)
            val newL = newLines.getOrNull(i)
            val type = if (oldL == newL) DiffLineType.UNCHANGED else DiffLineType.MODIFIED
            rows.add(
                DiffRow(
                    oldLineNumber = if (oldL != null) i + 1 else null,
                    oldContent = oldL,
                    oldType = type,
                    newLineNumber = if (newL != null) i + 1 else null,
                    newContent = newL,
                    newType = type,
                    hunkIndex = if (type != DiffLineType.UNCHANGED) 0 else null
                )
            )
        }
        return rows
    }
}
