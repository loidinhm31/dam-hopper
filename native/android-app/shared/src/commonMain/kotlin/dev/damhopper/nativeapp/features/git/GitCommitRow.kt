package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitCommitRow(
    entry: GitLogEntry,
    isSelected: Boolean,
    canSelect: Boolean,
    onToggleSelect: () -> Unit,
    onInspect: () -> Unit,
    onEditMessage: () -> Unit,
    onCherryPick: () -> Unit,
    onRevert: () -> Unit,
    onReset: () -> Unit,
    onDrop: () -> Unit,
    isLocal: Boolean,
    isActive: Boolean,
    graphRow: GitGraphRow? = null,
    laneCount: Int = 1,
    modifier: Modifier = Modifier,
) {
    val shortHash = if (entry.hash.length >= 7) entry.hash.substring(0, 7) else entry.hash

    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (graphRow != null) {
            GitGraphLane(
                row = graphRow,
                laneCount = laneCount,
                modifier = Modifier
                    .fillMaxHeight()
                    .padding(end = 4.dp),
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 3.dp)
                .background(DamHopperColors.Surface, shape = RoundedCornerShape(4.dp))
                .padding(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                if (canSelect) {
                    Checkbox(
                        checked = isSelected,
                        onCheckedChange = { onToggleSelect() },
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
                Text(shortHash, style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary, modifier = Modifier.clickable { onInspect() })
                Spacer(modifier = Modifier.width(6.dp))
                Text(entry.message, style = DamHopperTypography.bodySmall, color = DamHopperColors.TextPrimary, maxLines = 1, modifier = Modifier.weight(1f))
                Text(if (entry.isPushed) "pushed" else "unpushed", fontSize = 10.sp, color = if (entry.isPushed) DamHopperColors.TextSecondary else DamHopperColors.Warning)
            }
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                TextButton(onClick = onInspect) { Text("Details", fontSize = 10.sp) }
                if (isLocal) {
                    TextButton(onClick = onEditMessage) { Text("Edit Msg", fontSize = 10.sp) }
                }
                TextButton(onClick = onCherryPick) { Text("Cherry-Pick", fontSize = 10.sp) }
                TextButton(onClick = onRevert) { Text("Revert", fontSize = 10.sp) }
                if (isActive) {
                    TextButton(onClick = onReset) { Text("Reset", fontSize = 10.sp) }
                    if (!entry.isPushed) {
                        TextButton(onClick = onDrop) { Text("Drop", fontSize = 10.sp, color = DamHopperColors.Error) }
                    }
                }
            }
        }
    }
}
