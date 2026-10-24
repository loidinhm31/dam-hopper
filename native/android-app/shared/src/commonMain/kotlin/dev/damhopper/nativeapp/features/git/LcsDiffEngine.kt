package dev.damhopper.nativeapp.features.git

import kotlin.math.max
import kotlin.math.min

/**
 * Token representation for line diffing.
 */
internal data class DiffItem(
    val type: DiffLineType,
    val oldLine: Int? = null,
    val newLine: Int? = null,
    val oldText: String? = null,
    val newText: String? = null,
)

/**
 * Low-level LCS line difference engine with prefix/suffix trimming.
 */
internal object LcsDiffEngine {

    fun computeDiff(oldLines: List<String>, newLines: List<String>): List<DiffItem> {
        val result = mutableListOf<DiffItem>()

        var prefixLen = 0
        val minSize = min(oldLines.size, newLines.size)
        while (prefixLen < minSize && oldLines[prefixLen] == newLines[prefixLen]) {
            result.add(
                DiffItem(
                    type = DiffLineType.UNCHANGED,
                    oldLine = prefixLen + 1,
                    newLine = prefixLen + 1,
                    oldText = oldLines[prefixLen],
                    newText = newLines[prefixLen]
                )
            )
            prefixLen++
        }

        var suffixLen = 0
        while (suffixLen < (minSize - prefixLen) &&
            oldLines[oldLines.size - 1 - suffixLen] == newLines[newLines.size - 1 - suffixLen]
        ) {
            suffixLen++
        }

        val oldMiddle = oldLines.subList(prefixLen, oldLines.size - suffixLen)
        val newMiddle = newLines.subList(prefixLen, newLines.size - suffixLen)

        if (oldMiddle.isNotEmpty() || newMiddle.isNotEmpty()) {
            val midDiff = computeMiddleLcs(oldMiddle, newMiddle, prefixLen)
            result.addAll(midDiff)
        }

        for (i in 0 until suffixLen) {
            val oldIdx = oldLines.size - suffixLen + i
            val newIdx = newLines.size - suffixLen + i
            result.add(
                DiffItem(
                    type = DiffLineType.UNCHANGED,
                    oldLine = oldIdx + 1,
                    newLine = newIdx + 1,
                    oldText = oldLines[oldIdx],
                    newText = newLines[newIdx]
                )
            )
        }

        return result
    }

    private const val MAX_DP_CELLS = 1_000_000L

    private fun computeMiddleLcs(
        oldLines: List<String>,
        newLines: List<String>,
        baseOffset: Int,
    ): List<DiffItem> {
        val n = oldLines.size
        val m = newLines.size

        if (n == 0) {
            return newLines.mapIndexed { idx, line ->
                DiffItem(DiffLineType.ADDED, newLine = baseOffset + idx + 1, newText = line)
            }
        }
        if (m == 0) {
            return oldLines.mapIndexed { idx, line ->
                DiffItem(DiffLineType.DELETED, oldLine = baseOffset + idx + 1, oldText = line)
            }
        }

        if ((n.toLong() * m.toLong()) > MAX_DP_CELLS) {
            val items = mutableListOf<DiffItem>()
            val limit = max(n, m)
            for (k in 0 until limit) {
                if (k < n) items.add(DiffItem(DiffLineType.DELETED, oldLine = baseOffset + k + 1, oldText = oldLines[k]))
                if (k < m) items.add(DiffItem(DiffLineType.ADDED, newLine = baseOffset + k + 1, newText = newLines[k]))
            }
            return items
        }

        val dp = Array(n + 1) { IntArray(m + 1) }
        for (i in 0 until n) {
            for (j in 0 until m) {
                if (oldLines[i] == newLines[j]) {
                    dp[i + 1][j + 1] = dp[i][j] + 1
                } else {
                    dp[i + 1][j + 1] = max(dp[i + 1][j], dp[i][j + 1])
                }
            }
        }

        var i = n
        var j = m
        val items = mutableListOf<DiffItem>()

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] == newLines[j - 1]) {
                items.add(
                    DiffItem(
                        type = DiffLineType.UNCHANGED,
                        oldLine = baseOffset + i,
                        newLine = baseOffset + j,
                        oldText = oldLines[i - 1],
                        newText = newLines[j - 1]
                    )
                )
                i--
                j--
            } else if (j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                items.add(
                    DiffItem(
                        type = DiffLineType.ADDED,
                        newLine = baseOffset + j,
                        newText = newLines[j - 1]
                    )
                )
                j--
            } else if (i > 0 && (j == 0 || dp[i][j - 1] < dp[i - 1][j])) {
                items.add(
                    DiffItem(
                        type = DiffLineType.DELETED,
                        oldLine = baseOffset + i,
                        oldText = oldLines[i - 1]
                    )
                )
                i--
            }
        }

        return items.reversed()
    }
}
