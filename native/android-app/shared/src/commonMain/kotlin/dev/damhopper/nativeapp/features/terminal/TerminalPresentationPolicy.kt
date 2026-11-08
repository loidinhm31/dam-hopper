package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import kotlinx.serialization.Serializable
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

/**
 * Exact qualified identity of a terminal session across profiles, projects, worktrees,
 * PTY manager epochs and incarnations.
 */
@Serializable
data class TerminalQualifiedKey(
    val profileId: String,
    val project: String?,
    val worktreePath: String? = null,
    val terminalId: String,
    val serverPtyEpoch: String? = null,
    val incarnation: ULong = 0uL,
) {
    fun matchesSession(currentProfileId: String, session: TerminalSessionDetailed): Boolean {
        return this.profileId == currentProfileId &&
            this.terminalId == session.id &&
            this.project == session.project &&
            this.worktreePath == session.worktreePath &&
            this.incarnation == session.incarnation &&
            (this.serverPtyEpoch == null || session.serverPtyEpoch == null || this.serverPtyEpoch == session.serverPtyEpoch)
    }
}

/**
 * Captured termination target frozen when opening the close dialog.
 * Prevents ambient / raw-ID fallback and re-validates authority and syntax.
 */
data class CapturedTerminationTarget(
    val profileId: String,
    val connectionGeneration: Long,
    val terminalId: String,
    val project: String? = null,
    val worktreePath: String? = null,
    val serverPtyEpoch: String? = null,
    val incarnationExact: String? = null,
    val terminationVersion: Int? = 1,
    val isPinned: Boolean = false,
    val isAlive: Boolean = true,
    val willRestart: Boolean = false,
    val isDestructiveOpInProgress: Boolean = false,
) {
    val isValidEpoch: Boolean = !serverPtyEpoch.isNullOrBlank() && TerminateSessionRequest.isValidEpoch(serverPtyEpoch)
    val isValidIncarnation: Boolean = !incarnationExact.isNullOrBlank() && TerminateSessionRequest.isValidIncarnation(incarnationExact)
    val isValidVersion: Boolean = terminationVersion == 1
    val isProtocolSupported: Boolean = isValidVersion && isValidEpoch && isValidIncarnation

    val canCloseViewLocally: Boolean = !isPinned
    val canEndSessionDestructively: Boolean = !isPinned && isProtocolSupported && !isDestructiveOpInProgress

    val destructiveDisabledReason: String? = when {
        isPinned -> "Cannot close or end pinned session; unpin first."
        isDestructiveOpInProgress -> "Destructive operation already in progress."
        !isValidVersion -> "Cannot end session: unsupported or missing termination protocol version"
        !isValidEpoch -> "Cannot end session: missing verified server PTY epoch"
        !isValidIncarnation -> "Cannot end session: missing verified server PTY incarnation"
        else -> null
    }
}

data class TerminalCloseGuard(
    val isPinned: Boolean,
    val canCloseViewLocally: Boolean,
    val canEndSessionDestructively: Boolean,
    val destructiveDisabledReason: String?,
)

fun evaluateCloseGuard(target: CapturedTerminationTarget): TerminalCloseGuard =
    TerminalCloseGuard(
        isPinned = target.isPinned,
        canCloseViewLocally = target.canCloseViewLocally,
        canEndSessionDestructively = target.canEndSessionDestructively,
        destructiveDisabledReason = target.destructiveDisabledReason,
    )

enum class AccessoryCollapseMode {
    EXPANDED,
    COLLAPSED_SINGLE_ROW,
    HIDDEN,
}

fun resolveAccessoryCollapseMode(
    contentHeightPx: Float,
    lineHeightPx: Float,
    singleRowAccessoryHeightPx: Float,
    doubleRowAccessoryHeightPx: Float,
    minTerminalRows: Int = 3,
): AccessoryCollapseMode {
    if (!contentHeightPx.isFinite() || contentHeightPx <= 0f) return AccessoryCollapseMode.HIDDEN
    val safeLineHeight = if (lineHeightPx.isFinite() && lineHeightPx > 0f) lineHeightPx else 30f
    val heightForDouble = (minTerminalRows * safeLineHeight) + doubleRowAccessoryHeightPx
    val heightForSingle = (minTerminalRows * safeLineHeight) + singleRowAccessoryHeightPx
    return when {
        contentHeightPx >= heightForDouble -> AccessoryCollapseMode.EXPANDED
        contentHeightPx >= heightForSingle -> AccessoryCollapseMode.COLLAPSED_SINGLE_ROW
        else -> AccessoryCollapseMode.HIDDEN
    }
}

fun calculateTerminalViewportHeight(
    usableHeightPx: Float,
    actualChromeHeightPx: Float,
    accessoryHeightPx: Float,
    bannerHeightPx: Float,
): Float = (usableHeightPx - actualChromeHeightPx - accessoryHeightPx - bannerHeightPx).coerceAtLeast(0f)

fun calculateTerminalVisibleRows(
    terminalHeightPx: Float,
    lineHeightPx: Float,
): Int {
    if (!lineHeightPx.isFinite() || lineHeightPx <= 0f) return 1
    return floor(terminalHeightPx.coerceAtLeast(0f) / lineHeightPx).toInt().coerceAtLeast(1)
}

fun canDismissWorkspace(
    isInventoryAuthoritativeLoaded: Boolean,
    isConnected: Boolean,
    liveSessions: List<TerminalSessionDetailed>,
    hiddenSessions: List<TerminalQualifiedKey>,
    restartPendingTerminalIds: Set<String>,
    pendingCreateIntents: List<UncertainCreateRecord>,
): Boolean {
    if (!isInventoryAuthoritativeLoaded || !isConnected) return false
    val liveCount = liveSessions.size
    val hiddenCount = hiddenSessions.size
    val restartCount = restartPendingTerminalIds.size
    val pendingCreateCount = pendingCreateIntents.size
    return (liveCount + hiddenCount + restartCount + pendingCreateCount) == 0
}
