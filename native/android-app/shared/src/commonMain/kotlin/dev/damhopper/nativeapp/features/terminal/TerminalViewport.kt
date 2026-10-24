package dev.damhopper.nativeapp.features.terminal

import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.launch

/** Retained by owner/controller/incarnation, independently of which tab is currently composed. */
internal class TerminalReadingState {
    val list = LazyListState()
    val geometry = TerminalGeometryPolicy()
    val follow = TerminalFollowPolicy()
    var programmaticScroll = false
    var userScrolling = false
}

/** Controller identity scopes owner/session/lifetime; incarnation scopes a restarted remote process. */
internal class TerminalReadingStates {
    private class Entry(val incarnation: ULong?, val state: TerminalReadingState)
    private val states = mutableMapOf<TerminalSessionController?, Entry>()

    fun forController(controller: TerminalSessionController?): TerminalReadingState {
        val incarnation = controller?.incarnation
        val retained = states[controller]
        if (retained != null && retained.incarnation == incarnation) return retained.state
        return TerminalReadingState().also { states[controller] = Entry(incarnation, it) }
    }

    fun remove(controller: TerminalSessionController) {
        states.remove(controller)
    }

    fun clear() = states.clear()
}

private data class TerminalReadingPosition(
    val rowId: Long?,
    val offset: Int,
    val scrolling: Boolean,
    val atBottom: Boolean,
)

private fun LazyListState.readingPosition() = TerminalReadingPosition(
    rowId = layoutInfo.visibleItemsInfo.firstOrNull()?.key as? Long,
    offset = firstVisibleItemScrollOffset,
    scrolling = isScrollInProgress,
    atBottom = !canScrollForward,
)

@Composable
internal fun TerminalViewportEffects(
    state: TerminalReadingState,
    lineIds: List<Long>,
    contentRevision: Long?,
) {
    LaunchedEffect(state) {
        launch {
            state.list.interactionSource.interactions.collect { interaction ->
                if (interaction is DragInteraction.Start) {
                    state.userScrolling = true
                    state.follow.beginUserScroll()
                    val position = state.list.readingPosition()
                    state.follow.rememberAnchor(position.rowId, position.offset)
                } else if ((interaction is DragInteraction.Stop || interaction is DragInteraction.Cancel) &&
                    !state.list.isScrollInProgress
                ) {
                    val position = state.list.readingPosition()
                    state.follow.observeUserScroll(position.atBottom, position.rowId, position.offset)
                    state.userScrolling = false
                }
            }
        }
        snapshotFlow { state.list.readingPosition() }.collect { position ->
            if (!state.programmaticScroll) {
                // This also covers accessibility/keyboard scrolling; our own moves are excluded.
                if (position.scrolling) {
                    state.userScrolling = true
                    state.follow.beginUserScroll()
                }
                if (state.userScrolling) {
                    state.follow.observeUserScroll(
                        atBottom = !position.scrolling && position.atBottom,
                        firstRowId = position.rowId,
                        offset = position.offset,
                    )
                    if (!position.scrolling) state.userScrolling = false
                }
            }
        }
    }
    // No line object or blink key here. Keep the intent established BEFORE output changed layout.
    LaunchedEffect(state, contentRevision) {
        if (state.userScrolling) return@LaunchedEffect
        val target = state.follow.onContentChanged(lineIds) ?: return@LaunchedEffect
        state.programmaticScroll = true
        try {
            state.list.scrollToItem(target.index, target.offset)
            val position = state.list.readingPosition()
            state.follow.rememberAnchor(position.rowId, position.offset)
        } finally {
            state.programmaticScroll = false
        }
    }
}
