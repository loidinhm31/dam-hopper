package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

@Composable
fun DiffReviewScreen(
    controller: DiffReviewController,
    onSaveModified: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val coroutineScope = rememberCoroutineScope()
    val query by controller.activeQuery.collectAsState()
    val content by controller.diffContent.collectAsState()
    val layoutMode by controller.layoutMode.collectAsState()
    val diffRows by controller.diffRows.collectAsState()
    val currentHunk by controller.currentHunkIndex.collectAsState()
    val totalHunks by controller.totalHunks.collectAsState()
    val isReadOnly by controller.isReadOnly.collectAsState()
    val isDirty by controller.isModifiedDirty.collectAsState()
    val modifiedDraft by controller.modifiedDraft.collectAsState()
    val isLoading by controller.isLoading.collectAsState()
    val errorMsg by controller.errorMessage.collectAsState()
    var isEditing by remember { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Diff Top Action Toolbar (Zero FABs)
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = query?.path ?: "No file loaded",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextPrimary,
                modifier = Modifier.padding(end = 8.dp)
            )

            Button(
                onClick = {
                    val next = if (layoutMode == DiffLayoutMode.SIDE_BY_SIDE) DiffLayoutMode.INLINE else DiffLayoutMode.SIDE_BY_SIDE
                    controller.setLayoutMode(next)
                },
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
            ) {
                Text(if (layoutMode == DiffLayoutMode.SIDE_BY_SIDE) "Side-by-Side" else "Inline", fontSize = 11.sp, color = DamHopperColors.Primary)
            }

            Spacer(modifier = Modifier.width(6.dp))
            Button(
                onClick = { controller.prevHunk() },
                enabled = totalHunks > 0,
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text("Prev Hunk", fontSize = 11.sp)
            }

            Spacer(modifier = Modifier.width(4.dp))
            Button(
                onClick = { controller.nextHunk() },
                enabled = totalHunks > 0,
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text("Next Hunk", fontSize = 11.sp)
            }

            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = if (totalHunks > 0) "${currentHunk + 1}/$totalHunks" else "0 hunks",
                fontSize = 11.sp,
                color = DamHopperColors.TextSecondary
            )

            if (!isReadOnly) {
                Spacer(modifier = Modifier.width(6.dp))
                Button(
                    onClick = { isEditing = !isEditing },
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = if (isEditing) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                ) {
                    Text(if (isEditing) "Done" else "Edit", fontSize = 11.sp, color = if (isEditing) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(4.dp))
                Button(
                    onClick = { coroutineScope.launch { controller.discardHunk(currentHunk) } },
                    enabled = totalHunks > 0 && !isDirty,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Revert Hunk", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                }
                if (isDirty && onSaveModified != null) {
                    Spacer(modifier = Modifier.width(6.dp))
                    Button(
                        onClick = { onSaveModified() },
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Success)
                    ) {
                        Text("Save", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            } else if (query?.commitHash != null) {
                Spacer(modifier = Modifier.width(6.dp))
                Button(
                    onClick = { controller.exitCommitDiff() },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
                ) {
                    Text("Exit Commit", fontSize = 11.sp, color = DamHopperColors.Primary)
                }
            }
        }

        HorizontalDivider(color = DamHopperColors.Border, thickness = 1.dp)

        // Status banners
        if (isLoading) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(8.dp)) {
                Text("Loading diff...", fontSize = 12.sp, color = DamHopperColors.Primary)
            }
        }
        if (errorMsg != null) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Error).padding(8.dp)) {
                Text("⚠ $errorMsg", fontSize = 12.sp, color = DamHopperColors.TextPrimary)
            }
        }

        // Diff lines viewer
        if (content == null && !isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No file diff loaded.\nSelect a file or commit to review diff.", style = DamHopperTypography.bodyMedium, color = DamHopperColors.TextSecondary)
            }
        } else if (isEditing && !isReadOnly) {
            TextField(
                value = modifiedDraft,
                onValueChange = { controller.updateModifiedDraft(it) },
                modifier = Modifier.fillMaxSize(),
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DamHopperColors.TextPrimary),
                colors = TextFieldDefaults.colors(focusedContainerColor = DamHopperColors.Background, unfocusedContainerColor = DamHopperColors.Background)
            )
        } else {
            val horizScroll = rememberScrollState()
            LazyColumn(modifier = Modifier.fillMaxSize().horizontalScroll(horizScroll)) {
                itemsIndexed(diffRows) { _, row ->
                    DiffRowItem(row, layoutMode)
                }
            }
        }
    }
}
