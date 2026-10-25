package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarCallbacks
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarMode
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

internal const val TERMINAL_AGENTS_SIDEBAR_TAG_PREFIX = "terminal-agents-sidebar:"
internal const val TERMINAL_AGENTS_COUNT_TAG = "terminal-agents-count"

/** Touch-sized text button used by the sidebar controls and filter trigger. */
@Composable
internal fun TerminalAgentsActionButton(
    label: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val shape = RoundedCornerShape(4.dp)
    Box(
        modifier = modifier
            .clip(shape)
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, DamHopperColors.Border, shape)
            .semantics { contentDescription = description }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (enabled) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Controlled Agents sidebar content for a retained Traditional terminal roster.
 *
 * Presentation only: [state] and [mode] are authoritative inputs from the host, which owns width, open state,
 * input suspension and activation. This composable performs no navigation, storage, polling or service access;
 * every user action is reported through [callbacks].
 */
@Composable
fun TerminalAgentsSidebar(
    state: TerminalAgentsSidebarUiState,
    mode: TerminalAgentsSidebarMode,
    callbacks: TerminalAgentsSidebarCallbacks,
    modifier: Modifier = Modifier,
) {
    val projection = state.projection
    val counts = projection.counts
    val showProfile = remember(projection.rows) {
        projection.rows.map { it.target.instance.profileId }.distinct().size > 1
    }
    Column(
        modifier = modifier
            .background(DamHopperColors.Surface)
            .testTag(TERMINAL_AGENTS_SIDEBAR_TAG_PREFIX + mode.name)
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Agents",
                color = DamHopperColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = "${counts.all}",
                color = DamHopperColors.TextSecondary,
                fontSize = 13.sp,
                modifier = Modifier
                    .testTag(TERMINAL_AGENTS_COUNT_TAG)
                    .semantics {
                        contentDescription =
                            if (counts.all == 1) "1 eligible terminal" else "${counts.all} eligible terminals"
                    },
            )
            Spacer(Modifier.weight(1f))
            if (mode == TerminalAgentsSidebarMode.SHEET) {
                TerminalAgentsActionButton(
                    label = "Close",
                    description = "Close Agents",
                    onClick = callbacks.onDismiss,
                )
            }
        }
        if (state.selection != TerminalAgentsFilterSelection.All) {
            Text(
                text = "Showing ${projection.filteredCount} of ${counts.all}",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp,
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TerminalAgentsFilterMenu(
                selection = state.selection,
                counts = counts,
                onFilterChange = callbacks.onFilterChange,
                onPopupVisibilityChanged = callbacks.onPopupVisibilityChanged,
                modifier = Modifier.weight(1f),
            )
            TerminalAgentsActionButton(
                label = "Refresh",
                description = "Refresh agents",
                onClick = callbacks.onRefresh,
            )
            TerminalAgentsActionButton(
                label = "Settings",
                description = "Agent settings",
                onClick = callbacks.onOpenSettings,
            )
        }
        state.notice?.let { notice ->
            TerminalAgentsNotice(notice = notice, onRetry = callbacks.onRefresh)
        }
        if (state.loading) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            ) {
                CircularProgressIndicator(
                    color = DamHopperColors.Primary,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(text = "Refreshing agents\u2026", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
            }
        }
        if (state.activationPending) {
            Text(
                text = "Opening terminal\u2026",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            when {
                counts.all == 0 && state.loading -> Unit
                counts.all == 0 -> TerminalAgentsEmptyState(
                    title = "No observed agents",
                    detail = "Agents appear when an OMP, Codex or Claude session is observed in an open terminal.",
                )
                projection.filteredCount == 0 -> TerminalAgentsEmptyState(
                    title = "No matching filter",
                    detail = "${counts.all} observed ${if (counts.all == 1) "agent is" else "agents are"} " +
                        "hidden by the current status filter.",
                    actionLabel = "Show all",
                    onAction = { callbacks.onFilterChange(TerminalAgentsFilterSelection.All) },
                )
                else -> projection.groups.forEach { group ->
                    key(group.key) {
                        TerminalAgentsGroupRow(
                            group = group,
                            active = state.active,
                            enabled = !state.activationPending,
                            showProfile = showProfile,
                            onClick = { callbacks.onGroupClick(group.key) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TerminalAgentsNotice(notice: String, onRetry: () -> Unit) {
    val shape = RoundedCornerShape(4.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, DamHopperColors.Warning, shape)
            .padding(start = 10.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = notice,
            color = DamHopperColors.TextPrimary,
            fontSize = 12.sp,
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 8.dp),
        )
        TerminalAgentsActionButton(
            label = "Retry",
            description = "Retry refreshing agents",
            onClick = onRetry,
            modifier = Modifier.padding(4.dp),
        )
    }
}

@Composable
private fun TerminalAgentsEmptyState(
    title: String,
    detail: String,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 16.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = title,
            color = DamHopperColors.TextPrimary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = detail,
            color = DamHopperColors.TextSecondary,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
        if (actionLabel != null) {
            TerminalAgentsActionButton(label = actionLabel, description = actionLabel, onClick = onAction)
        }
    }
}
