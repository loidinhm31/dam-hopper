package dev.damhopper.nativeapp.features.git

import kotlin.math.max

/**
 * Pure Kotlin ancestry graph layout generator for Git history entries.
 *
 * Deterministically constructs [GitGraphLayout] with exact OID ancestry, upward/downward
 * edges, merge/octopus routes, and unresolved stub segments for absent parents (shallow / off-page).
 *
 * Guaranteed properties:
 * 1. Global OID-to-row indexing upfront across accepted entries.
 * 2. Duplicate OIDs deduplicated, preserving first accepted occurrence.
 * 3. Deterministic lane allocation using interval coloring with first-parent continuity.
 * 4. Pass-through edges never collide with unrelated commit nodes.
 * 5. Segments split at row boundaries with normalized rowIndex-local coordinates [0.0f..1.0f].
 * 6. Absent parents create labelled unresolved stubs; no phantom nodes are fabricated.
 */
fun layoutGitGraph(entries: List<GitLogEntry>): GitGraphLayout {
    if (entries.isEmpty()) {
        return GitGraphLayout(rows = emptyList(), laneCount = 1)
    }

    // 1. Deduplicate entries by hash, accepting the first occurrence
    val acceptedEntries = mutableListOf<GitLogEntry>()
    val seenOids = mutableSetOf<String>()
    for (entry in entries) {
        if (seenOids.add(entry.hash)) {
            acceptedEntries.add(entry)
        }
    }

    val entryCount = acceptedEntries.size
    if (entryCount == 0) {
        return GitGraphLayout(rows = emptyList(), laneCount = 1)
    }

    // 2. Index full dataset: OID -> row
    val oidToRow = HashMap<String, Int>(entryCount)
    for (i in 0 until entryCount) {
        oidToRow[acceptedEntries[i].hash] = i
    }

    // 3. Collect raw edges
    val rawEdges = mutableListOf<InternalEdge>()
    for (c in 0 until entryCount) {
        val entry = acceptedEntries[c]
        for ((pIdx, parentOid) in entry.parents.withIndex()) {
            val pRow = oidToRow[parentOid]
            if (pRow == null) {
                rawEdges.add(
                    InternalEdge(
                        childRow = c,
                        parentRow = null,
                        parentOid = parentOid,
                        parentIndex = pIdx,
                        unresolved = true,
                    )
                )
            } else {
                rawEdges.add(
                    InternalEdge(
                        childRow = c,
                        parentRow = pRow,
                        parentOid = parentOid,
                        parentIndex = pIdx,
                        unresolved = false,
                    )
                )
            }
        }
    }

    // 4. Deterministic lane allocation
    val commitLanes = IntArray(entryCount) { -1 }
    val occupiedLanesPerRow = Array(entryCount) { mutableSetOf<Int>() }
    val downwardExitsPerRow = Array(entryCount) { mutableSetOf<Int>() }
    val upwardExitsPerRow = Array(entryCount) { mutableSetOf<Int>() }

    // Assign lanes row by row
    for (r in 0 until entryCount) {
        // Assign commit node lane if not already assigned
        if (commitLanes[r] == -1) {
            var candidate = 0
            while (candidate in occupiedLanesPerRow[r]) {
                candidate++
            }
            commitLanes[r] = candidate
        }
        occupiedLanesPerRow[r].add(commitLanes[r])

        val outgoing = rawEdges.filter { it.childRow == r }.sortedBy { it.parentIndex }
        for (edge in outgoing) {
            if (edge.unresolved) {
                // Absent / shallow / off-page parent stub in row r
                val preferred = if (edge.parentIndex == 0 && commitLanes[r] !in downwardExitsPerRow[r]) commitLanes[r] else null
                val stubLane = if (preferred != null) {
                    preferred
                } else {
                    var cand = 0
                    while (cand in occupiedLanesPerRow[r] || cand in downwardExitsPerRow[r]) {
                        cand++
                    }
                    cand
                }
                edge.lane = stubLane
                downwardExitsPerRow[r].add(stubLane)
                occupiedLanesPerRow[r].add(stubLane)
            } else {
                val targetRow = edge.parentRow!!
                if (targetRow > r) {
                    // Downward edge: r -> targetRow
                    fun isDownwardLaneFree(l: Int): Boolean {
                        if (l in downwardExitsPerRow[r]) return false
                        for (row in (r + 1) until targetRow) {
                            if (l in occupiedLanesPerRow[row]) return false
                        }
                        val targetCommitLane = commitLanes[targetRow]
                        if (targetCommitLane == -1) {
                            if (l in occupiedLanesPerRow[targetRow]) return false
                        } else if (targetCommitLane != l) {
                            if (l in occupiedLanesPerRow[targetRow]) return false
                        }
                        return true
                    }

                    val preferred = if (edge.parentIndex == 0) commitLanes[r] else null
                    val edgeLane = if (preferred != null && isDownwardLaneFree(preferred)) {
                        preferred
                    } else {
                        var cand = 0
                        while (!isDownwardLaneFree(cand)) {
                            cand++
                        }
                        cand
                    }

                    edge.lane = edgeLane
                    downwardExitsPerRow[r].add(edgeLane)
                    occupiedLanesPerRow[r].add(edgeLane)
                    for (row in (r + 1) until targetRow) {
                        occupiedLanesPerRow[row].add(edgeLane)
                    }
                    occupiedLanesPerRow[targetRow].add(edgeLane)

                    if (commitLanes[targetRow] == -1) {
                        commitLanes[targetRow] = edgeLane
                    }
                } else if (targetRow < r) {
                    // Upward edge: r -> targetRow (non-topological / date-skew)
                    fun isUpwardLaneFree(l: Int): Boolean {
                        if (l in upwardExitsPerRow[r]) return false
                        for (row in (targetRow + 1) until r) {
                            if (l in occupiedLanesPerRow[row]) return false
                        }
                        val parentLane = commitLanes[targetRow]
                        if (l != parentLane && l in occupiedLanesPerRow[targetRow]) return false
                        return true
                    }

                    val parentLane = commitLanes[targetRow]
                    val preferred = if (isUpwardLaneFree(parentLane)) parentLane else if (isUpwardLaneFree(commitLanes[r])) commitLanes[r] else null
                    val edgeLane = if (preferred != null) {
                        preferred
                    } else {
                        var cand = 0
                        while (!isUpwardLaneFree(cand)) {
                            cand++
                        }
                        cand
                    }

                    edge.lane = edgeLane
                    upwardExitsPerRow[r].add(edgeLane)
                    occupiedLanesPerRow[r].add(edgeLane)
                    for (row in (targetRow + 1) until r) {
                        occupiedLanesPerRow[row].add(edgeLane)
                    }
                    occupiedLanesPerRow[targetRow].add(edgeLane)
                } else {
                    // Degenerate self-loop
                    edge.lane = commitLanes[r]
                }
            }
        }
    }

    // 5. Generate row-clipped segments using rowIndex-local coordinates [0.0f..1.0f]
    var maxLaneFound = 0
    for (lane in commitLanes) {
        if (lane > maxLaneFound) maxLaneFound = lane
    }
    for (edge in rawEdges) {
        if (edge.lane > maxLaneFound) maxLaneFound = edge.lane
    }

    val rows = ArrayList<GitGraphRow>(entryCount)
    for (r in 0 until entryCount) {
        val entry = acceptedEntries[r]
        val rowSegments = mutableListOf<GitGraphSegment>()

        for (edge in rawEdges) {
            if (edge.unresolved) {
                if (edge.childRow == r) {
                    rowSegments.add(
                        GitGraphSegment(
                            from = GitGraphPoint(row = 0.5f, lane = commitLanes[r]),
                            to = GitGraphPoint(row = 1.0f, lane = edge.lane),
                            parentOid = edge.parentOid,
                            parentIndex = edge.parentIndex,
                            unresolved = true,
                        )
                    )
                }
            } else {
                val targetRow = edge.parentRow!!
                if (edge.childRow < targetRow) {
                    // Downward edge
                    val c = edge.childRow
                    val p = targetRow
                    if (r == c) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 0.5f, lane = commitLanes[c]),
                                to = GitGraphPoint(row = 1.0f, lane = edge.lane),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    } else if (r in (c + 1) until p) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 0.0f, lane = edge.lane),
                                to = GitGraphPoint(row = 1.0f, lane = edge.lane),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    } else if (r == p) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 0.0f, lane = edge.lane),
                                to = GitGraphPoint(row = 0.5f, lane = commitLanes[p]),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    }
                } else if (edge.childRow > targetRow) {
                    // Upward edge
                    val c = edge.childRow
                    val p = targetRow
                    if (r == c) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 0.5f, lane = commitLanes[c]),
                                to = GitGraphPoint(row = 0.0f, lane = edge.lane),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    } else if (r in (p + 1) until c) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 1.0f, lane = edge.lane),
                                to = GitGraphPoint(row = 0.0f, lane = edge.lane),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    } else if (r == p) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 1.0f, lane = edge.lane),
                                to = GitGraphPoint(row = 0.5f, lane = commitLanes[p]),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    }
                } else {
                    // Self-loop
                    if (r == edge.childRow) {
                        rowSegments.add(
                            GitGraphSegment(
                                from = GitGraphPoint(row = 0.5f, lane = commitLanes[r]),
                                to = GitGraphPoint(row = 0.5f, lane = commitLanes[r]),
                                parentOid = edge.parentOid,
                                parentIndex = edge.parentIndex,
                                unresolved = false,
                            )
                        )
                    }
                }
            }
        }

        // Sort deterministically: parentIndex, from.lane, to.lane, from.row, to.row
        rowSegments.sortWith(
            compareBy(
                { it.parentIndex },
                { it.from.lane },
                { it.to.lane },
                { it.from.row },
                { it.to.row }
            )
        )

        rows.add(
            GitGraphRow(
                oid = entry.hash,
                rowIndex = r,
                lane = commitLanes[r],
                segments = rowSegments,
            )
        )
    }

    val totalLaneCount = max(1, maxLaneFound + 1)
    return GitGraphLayout(rows = rows, laneCount = totalLaneCount)
}

private data class InternalEdge(
    val childRow: Int,
    val parentRow: Int?,
    val parentOid: String,
    val parentIndex: Int,
    val unresolved: Boolean,
    var lane: Int = -1,
)
