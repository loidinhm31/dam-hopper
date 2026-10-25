package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsCounts
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

internal const val TERMINAL_AGENTS_FILTER_TRIGGER_TAG = "terminal-agents-filter-trigger"
internal const val TERMINAL_AGENTS_FILTER_ALL_TAG = "terminal-agents-filter-option:all"
internal fun terminalAgentsFilterOptionTag(status: TerminalAgentsStatus): String =
    "terminal-agents-filter-option:${status.name}"

/** Canonical selection from an unordered status set: empty or all seven statuses => All, else enum order. */
private fun canonicalSelection(statuses: Set<TerminalAgentsStatus>): TerminalAgentsFilterSelection {
    val ordered = TerminalAgentsStatus.entries.filter { it in statuses }
    return if (ordered.isEmpty() || ordered.size == TerminalAgentsStatus.entries.size) {
        TerminalAgentsFilterSelection.All
    } else {
        TerminalAgentsFilterSelection.Selected(ordered)
    }
}

/**
 * Multi-select toggle shared with the web filter: from All a status isolates to that single status;
 * from Selected it toggles membership, and emptying the set resets to All.
 */
internal fun toggleTerminalAgentsStatus(
    current: TerminalAgentsFilterSelection,
    status: TerminalAgentsStatus,
): TerminalAgentsFilterSelection {
    val base = when (current) {
        TerminalAgentsFilterSelection.All -> emptySet()
        is TerminalAgentsFilterSelection.Selected -> current.statuses.toSet()
    }
    return canonicalSelection(if (status in base) base - status else base + status)
}

private fun triggerLabel(selection: TerminalAgentsFilterSelection): String = when (selection) {
    TerminalAgentsFilterSelection.All -> "All statuses"
    is TerminalAgentsFilterSelection.Selected ->
        TerminalAgentsStatus.entries
            .filter { it in selection.statuses }
            .joinToString(", ") { it.label() }
            .ifEmpty { "All statuses" }
}

/** Reports `true` while this composable is in composition and `false` when it leaves, so every open is balanced. */
@Composable
private fun PopupVisibilityReporter(onVisibilityChanged: (Boolean) -> Unit) {
    val latest by rememberUpdatedState(onVisibilityChanged)
    DisposableEffect(Unit) {
        latest(true)
        onDispose { latest(false) }
    }
}

/**
 * Controlled status filter. [selection] is the only authority; only the transient expansion is local.
 * The dropdown popup is the single owned modal: it reports [onPopupVisibilityChanged] for exactly its own lifetime
 * (opened, dismissed, or disposed with the sidebar) and nothing else.
 */
@Composable
internal fun TerminalAgentsFilterMenu(
    selection: TerminalAgentsFilterSelection,
    counts: TerminalAgentsCounts,
    onFilterChange: (TerminalAgentsFilterSelection) -> Unit,
    onPopupVisibilityChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val label = triggerLabel(selection)
    Box(modifier = modifier) {
        TerminalAgentsActionButton(
            label = "$label \u25BE",
            description = "Filter agents by status: $label",
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth().testTag(TERMINAL_AGENTS_FILTER_TRIGGER_TAG),
        )
        if (expanded) {
            DropdownMenu(
                expanded = true,
                onDismissRequest = { expanded = false },
                modifier = Modifier.background(DamHopperColors.SurfaceVariant),
            ) {
                PopupVisibilityReporter(onPopupVisibilityChanged)
                FilterOption(
                    label = "All statuses",
                    count = counts.all,
                    checked = selection == TerminalAgentsFilterSelection.All,
                    onClick = { onFilterChange(TerminalAgentsFilterSelection.All) },
                    modifier = Modifier.testTag(TERMINAL_AGENTS_FILTER_ALL_TAG),
                )
                TerminalAgentsStatus.entries.forEach { status ->
                    FilterOption(
                        label = status.label(),
                        count = counts.byStatus[status] ?: 0,
                        checked = selection is TerminalAgentsFilterSelection.Selected &&
                            status in selection.statuses,
                        onClick = { onFilterChange(toggleTerminalAgentsStatus(selection, status)) },
                        modifier = Modifier.testTag(terminalAgentsFilterOptionTag(status)),
                    )
                }
            }
        }
    }
}

@Composable
private fun FilterOption(
    label: String,
    count: Int,
    checked: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    DropdownMenuItem(
        text = {
            Text(
                text = label,
                color = DamHopperColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = if (checked) FontWeight.Bold else FontWeight.Normal,
            )
        },
        leadingIcon = {
            Checkbox(
                checked = checked,
                onCheckedChange = null,
                colors = CheckboxDefaults.colors(checkedColor = DamHopperColors.Primary),
            )
        },
        trailingIcon = {
            Spacer(Modifier.width(4.dp))
            Text(text = "$count", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
        },
        onClick = onClick,
        modifier = modifier.semantics {
            role = Role.Checkbox
            toggleableState = if (checked) ToggleableState.On else ToggleableState.Off
        },
    )
}
