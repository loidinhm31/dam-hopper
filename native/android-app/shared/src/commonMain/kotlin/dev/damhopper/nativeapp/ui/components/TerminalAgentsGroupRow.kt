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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentObservationSource
import dev.damhopper.nativeapp.features.terminal.BlockedReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsGroup
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsGroupKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/** Visible English labels shared by the sidebar rows and the filter menu (canonical web status labels). */
internal fun TerminalAgentsStatus.label(): String = dev.damhopper.nativeapp.features.terminal.TerminalAgentsPresenter.statusLabel(this)

internal fun BlockedReason.label(): String = dev.damhopper.nativeapp.features.terminal.TerminalAgentsPresenter.reasonLabel(this)

internal fun AgentKind.label(): String = when (this) {
    AgentKind.OMP -> "OMP"
    AgentKind.CODEX -> "Codex"
    AgentKind.CLAUDE -> "Claude"
}

internal fun AgentObservationSource.label(): String = dev.damhopper.nativeapp.features.terminal.TerminalAgentsPresenter.sourceLabel(this)

/** Status accent. Always paired with the visible status label, never the only status signal. */
private fun statusColor(status: TerminalAgentsStatus): Color = when (status) {
    TerminalAgentsStatus.NEEDS_ATTENTION -> DamHopperColors.Warning
    TerminalAgentsStatus.WORKING -> DamHopperColors.Primary
    TerminalAgentsStatus.IDLE -> DamHopperColors.Success
    TerminalAgentsStatus.UNKNOWN,
    TerminalAgentsStatus.UNAVAILABLE,
    TerminalAgentsStatus.PLATFORM_UNQUALIFIED,
    TerminalAgentsStatus.UNSUPPORTED,
    -> DamHopperColors.TextSecondary
}

/**
 * Semantics/test tag derived from the typed group identity fields (profile, endpoint, account, project, worktree,
 * status, reason). A selector aid only: composition identity uses the typed [TerminalAgentsGroupKey] itself.
 */
internal fun terminalAgentsGroupTag(key: TerminalAgentsGroupKey): String =
    "terminal-agents-group:${key.workspace.profileId}|${key.workspace.normalizedBaseUrl}|" +
        "${key.workspace.accountUser}|${key.workspace.project}|${key.workspace.normalizedWorktreePath.orEmpty()}|" +
        "${key.status.name}|${key.reason?.name.orEmpty()}"

/**
 * One status group of observed terminal agents. Controlled and stateless: [active] marks the group that
 * contains the currently selected terminal instance; [enabled] is false while an activation is pending.
 * All text is visible and merged into one button node so status/reason/count/harness/source are read together.
 */
@Composable
internal fun TerminalAgentsGroupRow(
    group: TerminalAgentsGroup,
    active: TerminalAgentsInstanceKey?,
    enabled: Boolean,
    showProfile: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isActive = active != null && group.members.any { it.target.instance == active }
    val status = group.key.status
    val accent = statusColor(status)
    val shape = RoundedCornerShape(4.dp)
    val members = group.members.size
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (isActive) DamHopperColors.SurfaceVariant else DamHopperColors.Surface)
            .border(
                width = if (isActive) 2.dp else 1.dp,
                color = if (isActive) DamHopperColors.Primary else DamHopperColors.Border,
                shape = shape,
            )
            .testTag(terminalAgentsGroupTag(group.key))
            .semantics { selected = isActive }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .sizeIn(minHeight = 48.dp)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .padding(top = 4.dp)
                .size(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(accent),
        )
        Spacer(Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = group.projectLabel,
                    color = DamHopperColors.TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (members == 1) "1 agent" else "$members agents",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
            if (showProfile && group.profileLabel.isNotBlank()) {
                Text(
                    text = "Profile: ${group.profileLabel}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = status.label(),
                color = accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
            group.key.reason?.let { reason ->
                Text(
                    text = "Reason: ${reason.label()}",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 11.sp,
                )
            }
            if (group.doneTurnEnded) {
                Text(
                    text = "Done (turn ended)",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
            if (group.agentKinds.isNotEmpty()) {
                Text(
                    text = "Harness: ${group.agentKinds.joinToString(", ") { it.label() }}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
            if (group.sources.isNotEmpty()) {
                Text(
                    text = "Source: ${group.sources.joinToString(", ") { it.label() }}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
            group.coverageHints.forEach { hint ->
                Text(
                    text = hint,
                    color = DamHopperColors.Warning,
                    fontSize = 11.sp,
                )
            }
            if (isActive) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "Current terminal",
                    color = DamHopperColors.Primary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
