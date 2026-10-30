package dev.damhopper.nativeapp.features.git

data class GitGraphPoint(
    val row: Float,
    val lane: Int,
)

data class GitGraphSegment(
    val from: GitGraphPoint,
    val to: GitGraphPoint,
    val parentOid: String,
    val parentIndex: Int,
    val unresolved: Boolean,
)

data class GitGraphRow(
    val oid: String,
    val rowIndex: Int,
    val lane: Int,
    val segments: List<GitGraphSegment>,
)

data class GitGraphLayout(
    val rows: List<GitGraphRow>,
    val laneCount: Int,
)
