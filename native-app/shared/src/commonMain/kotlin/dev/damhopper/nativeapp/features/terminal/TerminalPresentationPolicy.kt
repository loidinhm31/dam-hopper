package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import kotlin.math.floor
import kotlin.math.roundToInt

internal data class TerminalScrollTarget(val index: Int, val offset: Int = 0)

/** Follow intent changes only through user scrolling, never through output layout or blink. */
internal class TerminalFollowPolicy {
    var isFollowing: Boolean = true
        private set
    private var anchorId: Long? = null
    private var anchorOffset: Int = 0

    fun beginUserScroll() {
        isFollowing = false
    }

    fun observeUserScroll(atBottom: Boolean, firstRowId: Long?, offset: Int) {
        isFollowing = atBottom
        rememberAnchor(firstRowId, offset)
    }

    fun rememberAnchor(firstRowId: Long?, offset: Int) {
        anchorId = firstRowId
        anchorOffset = offset.coerceAtLeast(0)
    }

    fun onContentChanged(lineIds: List<Long>): TerminalScrollTarget? {
        if (lineIds.isEmpty()) return null
        if (isFollowing) return TerminalScrollTarget(lineIds.lastIndex)
        val retainedIndex = anchorId?.let { lineIds.indexOf(it) } ?: -1
        // Reset, reflow and bounded eviction all retire anchors the same way: oldest survivor.
        return if (retainedIndex >= 0) TerminalScrollTarget(retainedIndex, anchorOffset)
        else TerminalScrollTarget(0)
    }
}

internal class TerminalGeometryPolicy {
    private var previous: TerminalGeometry? = null

    fun update(geometry: TerminalGeometry): Boolean {
        if (geometry == previous) return false
        previous = geometry
        return true
    }
}

internal data class TerminalGeometry(val columns: Int, val rows: Int)

/** Available pixels already exclude content padding; metrics come from the displayed TextStyle. */
internal fun terminalGeometry(
    contentWidthPx: Float,
    contentHeightPx: Float,
    glyphAdvancePx: Float,
    lineHeightPx: Float,
): TerminalGeometry {
    require(glyphAdvancePx.isFinite() && glyphAdvancePx > 0f)
    require(lineHeightPx.isFinite() && lineHeightPx > 0f)
    return TerminalGeometry(
        columns = floor(contentWidthPx.coerceAtLeast(0f) / glyphAdvancePx).toInt().coerceIn(1, 200),
        rows = floor(contentHeightPx.coerceAtLeast(0f) / lineHeightPx).toInt().coerceIn(1, 80),
    )
}

internal fun terminalLineHeightSp(fontSizeSp: Int): Int =
    WorkbenchPreferences.clampFont(fontSizeSp) + 4

internal fun stepTerminalFontSize(currentSp: Int, delta: Int): Int =
    WorkbenchPreferences.clampFont(currentSp + delta)

internal fun pinchedTerminalFontSize(startFontSizeSp: Int, zoomFactor: Float): Int {
    val clampedStart = WorkbenchPreferences.clampFont(startFontSizeSp)
    if (!zoomFactor.isFinite() || zoomFactor <= 0f) return clampedStart
    val scaled = (clampedStart.toDouble() * zoomFactor.toDouble()).coerceIn(
        WorkbenchPreferences.FONT_MIN.toDouble(),
        WorkbenchPreferences.FONT_MAX.toDouble(),
    )
    return WorkbenchPreferences.clampFont(scaled.roundToInt())
}
