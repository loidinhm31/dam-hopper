package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun LargeFileView(
    tab: EditorTab,
    onPreviousChunk: () -> Unit,
    onNextChunk: () -> Unit,
    modifier: Modifier = Modifier,
    rangeWindow: BoundedRangeWindow? = tab.rangeWindow,
) {
    val windowText = rangeWindow?.text ?: tab.content
    val lines = windowText.lines()
    val startOffset = rangeWindow?.offset ?: tab.largeFileOffset
    val isEof = rangeWindow?.isEof ?: tab.largeFileEof
    val endOffset = if (rangeWindow != null) startOffset + rangeWindow.receivedBytes else minOf(tab.size, startOffset + FileTierPolicy.LARGE_CHUNK_BYTES)

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Range indicator header
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "Large file (${tab.size / (1024 * 1024)} MiB) • Range: $startOffset – $endOffset bytes (Read-only)",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.Warning
            )
            Row {
                Button(
                    onClick = onPreviousChunk,
                    enabled = startOffset > 0,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface)
                ) {
                    Text("< Prev 64K", fontSize = 11.sp, color = if (startOffset > 0) DamHopperColors.Primary else DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(6.dp))
                Button(
                    onClick = onNextChunk,
                    enabled = !isEof,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface)
                ) {
                    Text("Next 64K >", fontSize = 11.sp, color = if (!isEof) DamHopperColors.Primary else DamHopperColors.TextSecondary)
                }
            }
        }

        // Chunk lines with line numbers
        LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 4.dp)) {
            itemsIndexed(lines) { idx, line ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = (idx + 1).toString().padStart(4, ' '),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = DamHopperColors.TextSecondary,
                        modifier = Modifier.width(40.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = line,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = DamHopperColors.TextPrimary,
                        modifier = Modifier.horizontalScroll(rememberScrollState())
                    )
                }
            }
        }
    }
}
