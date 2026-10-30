package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperPalette
import kotlin.math.max

/**
 * Pure Compose UI Canvas renderer for Git ancestry graph lane primitives.
 *
 * Consumes immutable [GitGraphRow] and [laneCount]. Performs NO queries, dataset traversals,
 * or heavy graph allocations inside [Canvas] draw calls.
 */
@Composable
fun GitGraphLane(
    row: GitGraphRow,
    laneCount: Int,
    modifier: Modifier = Modifier,
) {
    val palette = DamHopperColors.current
    val laneColors = computeLaneColors(palette)
    val semanticDesc = gitGraphSemanticDescription(row, laneCount)
    val effectiveLaneCount = max(1, laneCount)

    val defaultWidth = maxOf(24.dp, (effectiveLaneCount * 16).dp)

    Canvas(
        modifier = modifier
            .width(defaultWidth)
            .fillMaxHeight()
            .defaultMinSize(minHeight = 44.dp)
            .semantics {
                contentDescription = semanticDesc
                role = Role.Image
            }
    ) {
        drawGitGraphRow(
            row = row,
            laneCount = effectiveLaneCount,
            palette = palette,
            laneColors = laneColors,
        )
    }
}

/**
 * Pure rendering function for drawing a [GitGraphRow] onto a [DrawScope].
 */
fun DrawScope.drawGitGraphRow(
    row: GitGraphRow,
    laneCount: Int,
    palette: DamHopperPalette,
    laneColors: List<Color>,
) {
    val width = size.width
    val height = size.height
    val laneWidth = width / max(1, laneCount)
    val baseStrokeWidth = 2.5.dp.toPx()
    val nodeRadius = 4.5.dp.toPx()

    val dashEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()), 0f)

    // 1. Draw connection segments
    for (segment in row.segments) {
        val geom = computeSegmentCoordinates(
            segment = segment,
            rowLane = row.lane,
            width = width,
            height = height,
            laneCount = laneCount,
            palette = palette,
            laneColors = laneColors,
            baseStrokeWidth = baseStrokeWidth,
        )

        val pathEffect = if (geom.isDashed) dashEffect else null

        if (!geom.isCurved) {
            drawLine(
                color = geom.color,
                start = Offset(geom.startX, geom.startY),
                end = Offset(geom.endX, geom.endY),
                strokeWidth = geom.strokeWidth,
                pathEffect = pathEffect,
            )
        } else {
            val path = Path().apply {
                moveTo(geom.startX, geom.startY)
                val midY = (geom.startY + geom.endY) / 2f
                cubicTo(
                    geom.startX, midY,
                    geom.endX, midY,
                    geom.endX, geom.endY,
                )
            }
            drawPath(
                path = path,
                color = geom.color,
                style = Stroke(
                    width = geom.strokeWidth,
                    pathEffect = pathEffect,
                ),
            )
        }
    }

    // 2. Draw commit node marker
    val nodeGeom = computeCommitNodeCoordinates(
        row = row,
        width = width,
        height = height,
        laneCount = laneCount,
        laneColors = laneColors,
        nodeRadius = nodeRadius,
    )

    // Outer solid node circle
    drawCircle(
        color = nodeGeom.color,
        radius = nodeGeom.radius,
        center = Offset(nodeGeom.centerX, nodeGeom.centerY),
    )

    // Inner contrasting center dot
    drawCircle(
        color = palette.surface,
        radius = nodeGeom.radius * 0.45f,
        center = Offset(nodeGeom.centerX, nodeGeom.centerY),
    )
}

/**
 * Pure projection of segment rendering coordinates and styling.
 */
data class SegmentCoordinates(
    val startX: Float,
    val startY: Float,
    val endX: Float,
    val endY: Float,
    val isCurved: Boolean,
    val isDashed: Boolean,
    val strokeWidth: Float,
    val color: Color,
)

/**
 * Pure projection of commit node marker coordinates and styling.
 */
data class CommitNodeCoordinates(
    val centerX: Float,
    val centerY: Float,
    val radius: Float,
    val color: Color,
)

/**
 * Computes projected physical coordinates and visual attributes for a [GitGraphSegment].
 */
fun computeSegmentCoordinates(
    segment: GitGraphSegment,
    rowLane: Int,
    width: Float,
    height: Float,
    laneCount: Int,
    palette: DamHopperPalette,
    laneColors: List<Color>,
    baseStrokeWidth: Float = 4f,
): SegmentCoordinates {
    val effectiveLaneCount = max(1, laneCount)
    val laneWidth = width / effectiveLaneCount

    val startX = (segment.from.lane + 0.5f) * laneWidth
    val startY = segment.from.row * height
    val endX = (segment.to.lane + 0.5f) * laneWidth
    val endY = segment.to.row * height

    val segmentLane = if (segment.from.row == 0.5f) segment.to.lane else segment.from.lane
    val color = if (segment.unresolved) {
        palette.warning
    } else {
        laneColors[segmentLane.coerceAtLeast(0) % laneColors.size]
    }

    val strokeWidth = if (segment.parentIndex > 0) {
        baseStrokeWidth * 0.85f
    } else {
        baseStrokeWidth
    }

    return SegmentCoordinates(
        startX = startX,
        startY = startY,
        endX = endX,
        endY = endY,
        isCurved = startX != endX,
        isDashed = segment.unresolved,
        strokeWidth = strokeWidth,
        color = color,
    )
}

/**
 * Computes projected physical coordinates and visual attributes for a commit node marker.
 */
fun computeCommitNodeCoordinates(
    row: GitGraphRow,
    width: Float,
    height: Float,
    laneCount: Int,
    laneColors: List<Color>,
    nodeRadius: Float = 8f,
): CommitNodeCoordinates {
    val effectiveLaneCount = max(1, laneCount)
    val laneWidth = width / effectiveLaneCount
    val centerX = (row.lane + 0.5f) * laneWidth
    val centerY = 0.5f * height
    val color = laneColors[row.lane.coerceAtLeast(0) % laneColors.size]

    return CommitNodeCoordinates(
        centerX = centerX,
        centerY = centerY,
        radius = nodeRadius,
        color = color,
    )
}

/**
 * Builds accessibility content description for a [GitGraphRow].
 */
fun gitGraphSemanticDescription(row: GitGraphRow, laneCount: Int): String {
    val shortOid = if (row.oid.length >= 7) row.oid.substring(0, 7) else row.oid
    val unresolvedCount = row.segments.count { it.unresolved }
    val mergeCount = row.segments.count { it.parentIndex > 0 }
    val details = buildList {
        add("lane ${row.lane + 1} of $laneCount")
        if (unresolvedCount > 0) add("$unresolvedCount unresolved stub(s)")
        if (mergeCount > 0) add("$mergeCount merge route(s)")
    }
    return "Commit $shortOid at row ${row.rowIndex}, ${details.joinToString(", ")}"
}

/**
 * Computes distinguishable themed palette for graph lanes based on the active theme.
 */
fun computeLaneColors(palette: DamHopperPalette): List<Color> {
    return if (palette.isDark) {
        listOf(
            palette.primary,          // Primary accent
            palette.secondary,        // Secondary accent
            palette.warning,          // Amber / Orange
            Color(0xFFBC8CFF),        // Soft Purple
            Color(0xFF39C5BB),        // Cyan / Teal
            Color(0xFFFF7B72),        // Coral
            Color(0xFF79C0FF),        // Sky blue
            Color(0xFFF0883E),        // Bright Orange
        )
    } else {
        listOf(
            palette.primary,          // Deep Blue
            palette.secondary,        // Forest Green
            palette.warning,          // Dark Amber
            Color(0xFF8250DF),        // Purple
            Color(0xFF1B7C83),        // Teal
            Color(0xFFCF222E),        // Coral Red
            Color(0xFF0969DA),        // Royal Blue
            Color(0xFFBC4C00),        // Burnt Orange
        )
    }
}
