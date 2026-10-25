package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsProjector
import dev.damhopper.nativeapp.features.terminal.RetainedTerminalAgentsService
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationResult
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRegistration
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarCallbacks
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarMode
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

/** Width at/above which the Agents sidebar is pinned beside the terminal (otherwise a modal sheet). */
val TERMINAL_AGENTS_PINNED_MIN_WIDTH: Dp = 600.dp

/** Pinned sidebar width. */
val TERMINAL_AGENTS_PINNED_WIDTH: Dp = 280.dp

/** Upper bound of the compact sheet; the sheet is additionally clamped to the available width. */
val TERMINAL_AGENTS_SHEET_MAX_WIDTH: Dp = 320.dp

/** True when [availableWidth] pins the sidebar (>= 600 dp). */
fun isTerminalAgentsPinned(availableWidth: Dp): Boolean = availableWidth >= TERMINAL_AGENTS_PINNED_MIN_WIDTH

/**
 * Narrow root-owned cover/exclusivity record of the Agents sidebar (NOT an overlay framework). The root keeps ONE
 * instance across rotation (only [open] is saved) and derives every input cover from it:
 *
 * - [externalCover]: privacy, Settings, workspace search or a pending departure dialog, written by the root.
 * - local terminal modals (create/kill/diagnostics...): reported per owner token via [setLocalCover]; a disposed owner
 *   clears only its own source.
 * - [popupVisible]: the sidebar's own filter/help popup.
 * - [compactSheetOpen]: the modal phone sheet.
 *
 * [requestOpen] refuses while any foreign cover is active and never closes another surface.
 */
class TerminalAgentsHostState(initialOpen: Boolean = false) {
    var open: Boolean by mutableStateOf(initialOpen)
        private set

    private val _pinned = mutableStateOf<Boolean?>(null)
    /** Width mode reported by the mounted host: true pinned, false compact, null before the first measurement. */
    val pinned: Boolean? get() = _pinned.value

    private val _externalCover = mutableStateOf(false)
    val externalCover: Boolean get() = _externalCover.value

    private val _popupVisible = mutableStateOf(false)
    val popupVisible: Boolean get() = _popupVisible.value
    private val localSources = mutableStateListOf<Any>()

    val localCover: Boolean get() = localSources.isNotEmpty()

    /** The modal compact sheet is showing (unknown width counts as compact: conservatively covering). */
    val compactSheetOpen: Boolean get() = open && pinned != true

    /** Agents may be opened: no search/departure/local modal/Settings/privacy cover is active. */
    val canOpen: Boolean get() = !externalCover && !localCover

    /** The one effective cover every input path (IME, hardware, accessory, shortcuts) must obey. */
    val effectiveCover: Boolean get() = externalCover || localCover || popupVisible || compactSheetOpen

    /** Opens Agents; false (nothing changes, nothing else closes) while a foreign cover is active. */
    fun requestOpen(): Boolean {
        if (!canOpen) return false
        open = true
        return true
    }

    /** Trigger action: closes when open, opens only when allowed. */
    fun toggle(): Boolean = if (open) {
        close()
        true
    } else {
        requestOpen()
    }

    fun close() {
        open = false
        _popupVisible.value = false
    }

    /** Back/Escape of the compact sheet: true when it was the visible surface and is now closed. */
    fun closeCompactSheet(): Boolean {
        if (!compactSheetOpen) return false
        close()
        return true
    }

    fun setPinned(pinned: Boolean) {
        _pinned.value = pinned
    }

    fun setExternalCover(cover: Boolean) {
        _externalCover.value = cover
    }

    fun setPopupVisible(visible: Boolean) {
        _popupVisible.value = visible
    }

    /** Reports whether [source] (identity token) currently shows a local modal/popup; never touches other sources. */
    fun setLocalCover(source: Any, active: Boolean) {
        val index = localSources.indexOfFirst { it === source }
        if (active && index < 0) localSources.add(source)
        if (!active && index >= 0) localSources.removeAt(index)
    }
}

/**
 * Closes the origin compact sheet only for the Committed receipt of the request that this sheet started; another
 * request's commit, a Refused/Deferred receipt or a stale id never closes it.
 */
class AgentsSheetCloseGate(initialRequestId: Long? = null) {
    private var requestId: Long? = initialRequestId

    fun begin(requestId: Long) {
        this.requestId = requestId
    }

    fun clear() {
        requestId = null
    }

    /** True exactly once, when [receipt] is the tracked request's `Committed` receipt. */
    fun shouldClose(receipt: TerminalAgentsActivationReceipt?): Boolean {
        val tracked = requestId ?: return false
        if (receipt == null || receipt.requestId != tracked) return false
        return when (receipt.result) {
            TerminalAgentsActivationResult.Committed -> {
                requestId = null
                true
            }
            is TerminalAgentsActivationResult.Refused -> {
                requestId = null
                false
            }
            is TerminalAgentsActivationResult.Deferred -> false
        }
    }
}

/**
 * Everything a terminal screen needs to participate in the retained Agents roster. [registration] is null when the
 * real authenticated owner is not known: the sidebar then renders an explicit unavailable notice and navigation stays
 * disabled (never fake global membership).
 */
class TerminalAgentsContext(
    val service: RetainedTerminalAgentsService,
    val registration: TerminalAgentsRegistration?,
    val host: TerminalAgentsHostState,
    val refreshAll: (TerminalAgentsRefreshReason) -> Unit,
    val onOpenSettings: () -> Unit,
)

private const val UNAVAILABLE_NOTICE = "Agents are unavailable until this server is signed in."

/** Terminal-only inline trigger of the Agents sidebar (count of qualified terminals). */
@Composable
fun TerminalAgentsTrigger(agents: TerminalAgentsContext, modifier: Modifier = Modifier) {
    val state by agents.service.state.collectAsState()
    val count = state.projection.counts.all
    val host = agents.host
    val enabled = host.open || host.canOpen
    Text(
        text = "Agents $count",
        color = if (enabled) DamHopperColors.Primary else DamHopperColors.TextSecondary,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(if (host.open) DamHopperColors.PrimaryVariant else DamHopperColors.SurfaceVariant)
            .sizeIn(minWidth = 48.dp, minHeight = 32.dp)
            .semantics { contentDescription = "Agents, $count eligible terminals" }
            .clickable(enabled = enabled) { host.toggle() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/**
 * One controlled host of the Agents sidebar around the terminal [content]. The content stays in one stable slot (only
 * its start padding changes), so the terminal is never recomposed into a different position when the sidebar opens,
 * closes or the width crosses the pinned breakpoint. >= 600 dp: pinned 280 dp column at the left; otherwise a modal
 * sheet clamped to the available width with scrim, Escape, IME hiding and focus handling.
 */
@Composable
fun TerminalAgentsSidebarOverlay(
    agents: TerminalAgentsContext,
    active: TerminalAgentsInstanceKey?,
    maxWidth: Dp,
    modifier: Modifier = Modifier,
) {
    val host = agents.host
    val state by agents.service.state.collectAsState()
    val scope = rememberCoroutineScope()
    val projector = remember { DefaultTerminalAgentsProjector() }
    var pendingRequestId by rememberSaveable { mutableStateOf<Long?>(null) }
    val closeGate = remember(pendingRequestId) { AgentsSheetCloseGate(pendingRequestId) }
    var inFlight by remember { mutableStateOf(false) }
    var localNotice by remember { mutableStateOf<String?>(null) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current

    // Origin sheet closes only for the matching Committed receipt; Refused/other ids only update the notice.
    val lastActivation = state.lastActivation
    LaunchedEffect(lastActivation) {
        if (closeGate.shouldClose(lastActivation)) host.closeCompactSheet()
        if (lastActivation != null && lastActivation.requestId == pendingRequestId) pendingRequestId = null
    }
    LaunchedEffect(host.open) {
        if (host.open) {
            agents.refreshAll(TerminalAgentsRefreshReason.SIDEBAR_OPENED)
        } else {
            localNotice = null
        }
    }

    val uiState = TerminalAgentsSidebarUiState(
        projection = state.projection,
        selection = state.filter,
        loading = state.loading,
        notice = localNotice ?: state.refreshNotice,
        active = active,
        activationPending = inFlight || pendingRequestId != null,
    )
    val callbacks = TerminalAgentsSidebarCallbacks(
        onGroupClick = { key ->
            val group = state.projection.groups.firstOrNull { it.key == key }
            val target = group?.let { projector.nextTarget(it, active) }
            if (target == null || inFlight || pendingRequestId != null) {
                if (target == null) localNotice = "That agent is no longer listed. Refresh Agents."
            } else {
                localNotice = null
                inFlight = true
                scope.launch {
                    try {
                        val receipt = agents.service.activate(target)
                        when (val result = receipt.result) {
                            TerminalAgentsActivationResult.Committed -> host.closeCompactSheet()
                            is TerminalAgentsActivationResult.Deferred -> {
                                closeGate.begin(receipt.requestId)
                                pendingRequestId = result.requestId
                            }
                            is TerminalAgentsActivationResult.Refused -> localNotice = result.reason
                        }
                    } finally {
                        inFlight = false
                    }
                }
            }
        },
        onFilterChange = { agents.service.setFilter(it) },
        onRefresh = { agents.refreshAll(TerminalAgentsRefreshReason.USER_RETRY) },
        onOpenSettings = { agents.onOpenSettings() },
        onDismiss = { host.close() },
        onPopupVisibilityChanged = { host.setPopupVisible(it) },
    )

    val pinned = isTerminalAgentsPinned(maxWidth)
    val pinnedOpen = host.open && pinned

    Box(modifier = modifier.fillMaxSize()) {
        if (pinnedOpen) {
            Box(modifier = Modifier.align(Alignment.CenterStart).fillMaxHeight().width(TERMINAL_AGENTS_PINNED_WIDTH)) {
                TerminalAgentsSidebar(
                    state = uiState,
                    mode = TerminalAgentsSidebarMode.PINNED,
                    callbacks = callbacks,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = TERMINAL_AGENTS_PINNED_WIDTH)
                    .width(1.dp)
                    .fillMaxHeight()
                    .background(DamHopperColors.Border),
            )
        } else if (host.open) {
            val sheetFocus = remember { FocusRequester() }
            LaunchedEffect(Unit) {

                keyboard?.hide()
                focusManager.clearFocus(force = true)
                try {
                    sheetFocus.requestFocus()
                } catch (_: Throwable) {

                }
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .clickable { host.close() },
            )
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxHeight()
                    .width(if (maxWidth < TERMINAL_AGENTS_SHEET_MAX_WIDTH) maxWidth else TERMINAL_AGENTS_SHEET_MAX_WIDTH)
                    .background(DamHopperColors.Surface)
                    .focusRequester(sheetFocus)
                    .focusable()
                    .onPreviewKeyEvent { event ->
                        if (event.key == Key.Escape && event.type == KeyEventType.KeyDown) {
                            host.closeCompactSheet()
                            true
                        } else {
                            false
                        }
                    },
            ) {
                TerminalAgentsSidebar(
                    state = uiState,
                    mode = TerminalAgentsSidebarMode.SHEET,
                    callbacks = callbacks,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
fun TerminalAgentsSidebarHost(
    agents: TerminalAgentsContext,
    active: TerminalAgentsInstanceKey?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val host = agents.host
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val pinned = isTerminalAgentsPinned(maxWidth)
        SideEffect { host.setPinned(pinned) }
        val pinnedOpen = host.open && pinned
        val startPadding = if (pinnedOpen) TERMINAL_AGENTS_PINNED_WIDTH + 1.dp else 0.dp
        Box(modifier = Modifier.fillMaxSize().padding(start = startPadding)) { content() }

        TerminalAgentsSidebarOverlay(agents = agents, active = active, maxWidth = maxWidth)
    }
}
