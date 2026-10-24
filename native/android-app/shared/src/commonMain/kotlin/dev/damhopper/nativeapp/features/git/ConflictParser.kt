package dev.damhopper.nativeapp.features.git

import kotlin.math.max

/**
 * Parses and resolves Git conflict markers in worktree files.
 * Supports standard 2-way (<<<<<<< / ======= / >>>>>>>) and 3-way/diff3
 * (<<<<<<< / ||||||| / ======= / >>>>>>>) with label preservation.
 */
object ConflictParser {

    private const val MARKER_OURS = "<<<<<<<"
    private const val MARKER_ANCESTOR = "|||||||"
    private const val MARKER_SEP = "======="
    private const val MARKER_THEIRS = ">>>>>>>"

    fun parseConflictRegions(content: String): List<ConflictRegion> {
        val lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        val regions = mutableListOf<ConflictRegion>()
        var i = 0

        while (i < lines.size) {
            val line = lines[i]
            if (line.startsWith(MARKER_OURS)) {
                val startLine = i + 1
                val markerWidth = line.takeWhile { it == '<' }.length
                val ourLabel = line.substring(markerWidth).trim()
                val oursLines = mutableListOf<String>()
                var ancestorLine: Int? = null
                var ancestorLabel: String? = null
                val ancestorLines = mutableListOf<String>()
                var separatorLine = -1
                var endLine = -1
                var theirLabel = ""
                i++

                var inAncestor = false
                while (i < lines.size) {
                    val cur = lines[i]
                    if (cur.startsWith(MARKER_OURS)) { i--; break }
                    if (cur.startsWith(MARKER_ANCESTOR)) {
                        inAncestor = true; ancestorLine = i + 1
                        ancestorLabel = cur.substring(cur.takeWhile { it == '|' }.length).trim()
                        i++; continue
                    }
                    if (cur.startsWith(MARKER_SEP)) { separatorLine = i + 1; i++; break }
                    if (inAncestor) ancestorLines.add(cur) else oursLines.add(cur)
                    i++
                }

                if (separatorLine == -1 || i > lines.size) { i++; continue }

                val theirsLines = mutableListOf<String>()
                while (i < lines.size) {
                    val cur = lines[i]
                    if (cur.startsWith(MARKER_THEIRS)) {
                        endLine = i + 1
                        val w = cur.takeWhile { it == '>' }.length
                        theirLabel = cur.substring(w).trim()
                        break
                    }
                    if (cur.startsWith(MARKER_OURS)) break
                    theirsLines.add(cur)
                    i++
                }

                if (endLine != -1) {
                    regions.add(
                        ConflictRegion(
                            index = regions.size,
                            startLine = startLine,
                            ancestorLine = ancestorLine,
                            separatorLine = separatorLine,
                            endLine = endLine,
                            oursContent = oursLines.joinToString("\n"),
                            ancestorContent = if (ancestorLine != null) ancestorLines.joinToString("\n") else null,
                            theirsContent = theirsLines.joinToString("\n"),
                            markerWidth = markerWidth,
                            ourLabel = ourLabel,
                            ancestorLabel = ancestorLabel,
                            theirLabel = theirLabel
                        )
                    )
                }
            }
            i++
        }
        return regions
    }

    fun hasMalformedConflicts(content: String): Boolean {
        val lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        var opens = 0; var seps = 0; var closes = 0; var ancestors = 0
        for (line in lines) {
            when {
                line.startsWith(MARKER_OURS) -> opens++
                line.startsWith(MARKER_ANCESTOR) -> ancestors++
                line.startsWith(MARKER_SEP) -> seps++
                line.startsWith(MARKER_THEIRS) -> closes++
            }
        }
        return opens != closes || (opens > 0 && opens != seps) || ancestors > opens
    }

    fun hasRemainingConflicts(content: String): Boolean = content.contains(MARKER_OURS)

    fun acceptConflict(content: String, region: ConflictRegion, side: ConflictSide): String {
        val newline = if (content.contains("\r\n")) "\r\n" else "\n"
        val lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        val searchStart = max(0, region.startLine - 3)
        var blockStart = -1; var blockSep = -1; var blockEnd = -1; var blockAncestor = -1

        for (i in searchStart until lines.size) {
            if (lines[i].startsWith(MARKER_OURS)) {
                blockStart = i
                for (j in (i + 1) until lines.size) {
                    if (lines[j].startsWith(MARKER_ANCESTOR)) blockAncestor = j
                    else if (lines[j].startsWith(MARKER_SEP)) blockSep = j
                    else if (lines[j].startsWith(MARKER_THEIRS)) { blockEnd = j; break }
                }
                if (blockSep != -1 && blockEnd != -1) break
                blockStart = -1; blockSep = -1; blockEnd = -1; blockAncestor = -1
            }
        }

        if (blockStart == -1 || blockSep == -1 || blockEnd == -1) return content

        val oursLines = if (blockAncestor != -1) lines.subList(blockStart + 1, blockAncestor) else lines.subList(blockStart + 1, blockSep)
        val ancestorLines = if (blockAncestor != -1) lines.subList(blockAncestor + 1, blockSep) else emptyList()
        val theirsLines = lines.subList(blockSep + 1, blockEnd)

        val replacement: List<String> = when (side) {
            ConflictSide.OURS -> oursLines
            ConflictSide.THEIRS -> theirsLines
            ConflictSide.ANCESTOR -> ancestorLines
            ConflictSide.BOTH_OURS_FIRST -> oursLines + theirsLines
            ConflictSide.BOTH_THEIRS_FIRST -> theirsLines + oursLines
        }
        return (lines.subList(0, blockStart) + replacement + lines.subList(blockEnd + 1, lines.size)).joinToString(newline)
    }

    fun acceptAll(content: String, side: ConflictSide): String {
        var current = content
        val regions = parseConflictRegions(current)
        for (i in regions.indices.reversed()) {
            current = acceptConflict(current, regions[i], side)
        }
        return current
    }
}
