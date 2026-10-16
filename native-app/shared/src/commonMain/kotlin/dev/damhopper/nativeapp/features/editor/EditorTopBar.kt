package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun EditorTopBar(
    tabs: List<EditorTab>,
    activeTabKey: String?,
    onSelectTab: (String) -> Unit,
    onCloseTab: (String) -> Unit,
    onSave: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    canUndo: Boolean,
    canRedo: Boolean,
    onToggleFind: () -> Unit,
    onToggleMarkdownPreview: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val activeTab = tabs.find { it.key == activeTabKey }

    Column(modifier = modifier.fillMaxWidth().background(DamHopperColors.Surface)) {
        // Tab strip (horizontally scrolling)
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = 2.dp)
        ) {
            tabs.forEach { tab ->
                val isActive = tab.key == activeTabKey
                Row(
                    modifier = Modifier.padding(horizontal = 2.dp)
                        .background(if (isActive) DamHopperColors.SurfaceVariant else DamHopperColors.Surface, RoundedCornerShape(4.dp))
                        .border(1.dp, if (isActive) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(4.dp))
                        .clickable { onSelectTab(tab.key) }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = tab.displayName,
                        fontSize = 12.sp,
                        color = if (isActive) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "×",
                        fontSize = 14.sp,
                        color = DamHopperColors.TextSecondary,
                        modifier = Modifier.clickable { onCloseTab(tab.key) }.padding(horizontal = 2.dp)
                    )
                }
            }
        }

        HorizontalDivider(color = DamHopperColors.Border, thickness = 1.dp)

        // Action Toolbar (Zero FABs)
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Button(
                onClick = onSave,
                enabled = activeTab != null && activeTab.isDirty && !activeTab.isSaving,
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.NavButtonActive)
            ) {
                Text(if (activeTab?.isSaving == true) "Saving..." else "Save", fontSize = 12.sp)
            }

            Spacer(modifier = Modifier.width(6.dp))
            Button(
                onClick = onUndo,
                enabled = canUndo,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
            ) {
                Text("Undo", fontSize = 12.sp, color = if (canUndo) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary)
            }

            Spacer(modifier = Modifier.width(4.dp))
            Button(
                onClick = onRedo,
                enabled = canRedo,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
            ) {
                Text("Redo", fontSize = 12.sp, color = if (canRedo) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary)
            }

            Spacer(modifier = Modifier.width(6.dp))
            Button(
                onClick = onToggleFind,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
            ) {
                Text("Find", fontSize = 12.sp, color = DamHopperColors.Primary)
            }

            if (activeTab != null && FileTierPolicy.isMarkdownFile(activeTab.path)) {
                Spacer(modifier = Modifier.width(6.dp))
                Button(
                    onClick = onToggleMarkdownPreview,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
                ) {
                    Text(if (activeTab.markdownPreviewMode) "Source" else "Preview", fontSize = 12.sp, color = DamHopperColors.Secondary)
                }
            }

            if (activeTab != null && activeTab.diagnostics.isNotEmpty()) {
                Spacer(modifier = Modifier.width(8.dp))
                val errCount = activeTab.diagnostics.count { it.severity == DiagnosticSeverity.ERROR }
                Text(
                    text = "$errCount errors",
                    fontSize = 11.sp,
                    color = DamHopperColors.Error
                )
            }
        }
    }
}
