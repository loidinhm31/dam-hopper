package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Top action bar for the Files panel supporting sub-tab selection and item CRUD actions.
 */
@Composable
fun FilesTopBar(
    activeSubTab: FilesSubTab,
    selectedPath: String?,
    showHidden: Boolean,
    onSelectSubTab: (FilesSubTab) -> Unit,
    onToggleShowHidden: () -> Unit,
    onCreateFile: () -> Unit,
    onCreateDir: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(DamHopperColors.SurfaceVariant)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row {
            Button(
                onClick = { onSelectSubTab(FilesSubTab.EXPLORER) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (activeSubTab == FilesSubTab.EXPLORER) DamHopperColors.Primary else DamHopperColors.Surface,
                ),
            ) {
                Text("Explorer")
            }
            Spacer(modifier = Modifier.width(6.dp))
            Button(
                onClick = { onSelectSubTab(FilesSubTab.SEARCH_REPLACE) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (activeSubTab == FilesSubTab.SEARCH_REPLACE) DamHopperColors.Primary else DamHopperColors.Surface,
                ),
            ) {
                Text("Search & Replace")
            }
        }

        if (activeSubTab == FilesSubTab.EXPLORER) {
            Row {
                Button(
                    onClick = onToggleShowHidden,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface),
                ) {
                    Text(if (showHidden) "Hide ." else "Show .")
                }
                Spacer(modifier = Modifier.width(4.dp))
                Button(
                    onClick = onCreateFile,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface),
                ) {
                    Text("+File")
                }
                Spacer(modifier = Modifier.width(4.dp))
                Button(
                    onClick = onCreateDir,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface),
                ) {
                    Text("+Dir")
                }
                Spacer(modifier = Modifier.width(4.dp))
                Button(
                    onClick = onRename,
                    enabled = selectedPath != null,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface),
                ) {
                    Text("Rename")
                }
                Spacer(modifier = Modifier.width(4.dp))
                Button(
                    onClick = onDelete,
                    enabled = selectedPath != null,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                ) {
                    Text("Del")
                }
            }
        }
    }
}
