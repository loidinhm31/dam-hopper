package dev.damhopper.nativeapp.features.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Screen for the Agent Import sub-product.
 * Scans remote git repositories or server-local directories and imports skills/commands/hooks into central store.
 */
@Composable
fun AgentImportView(
    controller: AgentImportController,
    onImportComplete: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val state by controller.state.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(12.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 1. Source Selector (Remote Git Repo vs Server Local Directory)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface, RoundedCornerShape(8.dp))
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Import Source",
                color = DamHopperColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val isRepo = state.source == ImportSource.REPO
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isRepo) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                        .clickable { controller.setSource(ImportSource.REPO) }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = "Git Repository URL",
                        fontSize = 11.sp,
                        fontWeight = if (isRepo) FontWeight.Bold else FontWeight.Normal,
                        color = if (isRepo) Color.Black else DamHopperColors.TextPrimary
                    )
                }

                val isLocal = state.source == ImportSource.LOCAL
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isLocal) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                        .clickable { controller.setSource(ImportSource.LOCAL) }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = "Server-Local Directory",
                        fontSize = 11.sp,
                        fontWeight = if (isLocal) FontWeight.Bold else FontWeight.Normal,
                        color = if (isLocal) Color.Black else DamHopperColors.TextPrimary
                    )
                }
            }

            // Server-side context notice
            Text(
                text = if (state.source == ImportSource.REPO) {
                    "The remote DamHopper server performs a shallow clone (depth 1) of the Git repository into a temporary directory and scans for importable items."
                } else {
                    "Scan an existing path on the remote DamHopper server (e.g. /home/user/my-skills). Does not scan the Android device storage."
                },
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp
            )

            // Input field
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp)
                ) {
                    val currentVal = if (state.source == ImportSource.REPO) state.repoUrl else state.dirPath
                    if (currentVal.isEmpty()) {
                        Text(
                            text = if (state.source == ImportSource.REPO) "https://github.com/org/repo.git" else "/path/to/server/directory",
                            color = DamHopperColors.TextSecondary.copy(alpha = 0.5f),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                    BasicTextField(
                        value = currentVal,
                        onValueChange = {
                            if (state.source == ImportSource.REPO) controller.setRepoUrl(it) else controller.setDirPath(it)
                        },
                        textStyle = TextStyle(
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace
                        ),
                        cursorBrush = SolidColor(DamHopperColors.Primary),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }

                Button(
                    onClick = { controller.startScan() },
                    enabled = !state.isScanning && (if (state.source == ImportSource.REPO) state.repoUrl.isNotBlank() else state.dirPath.isNotBlank()),
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    if (state.isScanning) {
                        CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(16.dp))
                    } else {
                        Text("Scan", color = Color.Black, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            state.scanError?.let { err ->
                Text(text = err, color = DamHopperColors.Error, fontSize = 11.sp)
            }
        }

        // 2. Discovered Items Checklist
        state.capturedScan?.let { scan ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface, RoundedCornerShape(8.dp))
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "Found ${scan.items.size} Importable Item(s)",
                            color = DamHopperColors.TextPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Source: ${scan.sourceDirOrTmpDir}",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    TextButton(onClick = { controller.toggleSelectAll() }) {
                        Text(
                            text = if (state.allSelected) "Deselect All" else "Select All",
                            fontSize = 11.sp,
                            color = DamHopperColors.Primary
                        )
                    }
                }

                HorizontalDivider(color = DamHopperColors.Border)

                if (scan.items.isEmpty()) {
                    Text(
                        text = "No compatible skills, commands, or hooks found in this directory.",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(vertical = 12.dp)
                    )
                } else {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 300.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        scan.items.forEach { item ->
                            val isChecked = state.selectedItemKeys.contains(controller.itemKey(item))
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(if (isChecked) DamHopperColors.SurfaceVariant else Color.Transparent)
                                    .clickable { controller.toggleItem(item) }
                                    .padding(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Checkbox(
                                    checked = isChecked,
                                    onCheckedChange = { controller.toggleItem(item) },
                                    colors = CheckboxDefaults.colors(checkedColor = DamHopperColors.Primary)
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Text(item.name, color = DamHopperColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                        Box(
                                            modifier = Modifier
                                                .background(DamHopperColors.PrimaryVariant.copy(alpha = 0.3f), RoundedCornerShape(3.dp))
                                                .padding(horizontal = 4.dp, vertical = 1.dp)
                                        ) {
                                            Text(item.category.displayName, color = DamHopperColors.Primary, fontSize = 9.sp)
                                        }
                                    }
                                    Text(item.relativePath, color = DamHopperColors.TextSecondary, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                                    if (!item.description.isNullOrBlank()) {
                                        Text(item.description, color = DamHopperColors.TextSecondary, fontSize = 10.sp)
                                    }
                                }
                            }
                        }
                    }

                    state.importError?.let { err ->
                        Text(text = err, color = DamHopperColors.Error, fontSize = 11.sp)
                    }

                    // Confirm Import Button
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Button(
                            onClick = {
                                controller.confirmImport(onSuccess = onImportComplete)
                            },
                            enabled = state.selectedCount > 0 && !state.isImporting,
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            if (state.isImporting) {
                                CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(16.dp))
                            } else {
                                Text(
                                    text = "Import Selected (${state.selectedCount})",
                                    color = Color.Black,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            }
        }

        // 3. Import Results
        state.importResults?.let { results ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface, RoundedCornerShape(8.dp))
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val successCount = results.count { it.success }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Import Results: $successCount of ${results.size} succeeded",
                        color = if (successCount == results.size) DamHopperColors.Secondary else DamHopperColors.Warning,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Button(
                        onClick = { controller.resetScan() },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text("New Scan", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                    }
                }

                HorizontalDivider(color = DamHopperColors.Border)

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    results.forEach { res ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                                .padding(8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(res.name, fontSize = 11.sp, color = DamHopperColors.TextPrimary, fontWeight = FontWeight.SemiBold)
                                res.error?.let { err ->
                                    Text(err, fontSize = 10.sp, color = DamHopperColors.Error)
                                }
                            }
                            Text(
                                text = if (res.success) "✓ Imported" else "✗ Failed",
                                color = if (res.success) DamHopperColors.Secondary else DamHopperColors.Error,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}
