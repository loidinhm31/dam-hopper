package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.FileChangeSummaryUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_FILE_CHANGES_CONTAINER: String = "file-changes:container"
const val TAG_FILE_CHANGES_OPEN_EDITOR: String = "file-changes:open-editor-btn"
const val TAG_FILE_CHANGES_REVIEW_DIFF: String = "file-changes:review-diff-btn"

@Composable
fun WorkspaceFileChangesSection(
    changes: FileChangeSummaryUiState,
    projectName: String,
    onOpenEditor: () -> Unit,
    onReviewDiff: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .testTag(TAG_FILE_CHANGES_CONTAINER)
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Header
        Text(
            text = "FILE CHANGES (${changes.stagedCount} staged, ${changes.unstagedCount} unstaged)",
            color = DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        // 2. Staged Files List
        if (changes.stagedFiles.isNotEmpty()) {
            Text("● Staged Changes (${changes.stagedCount})", color = Color(0xFF3FB950), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            changes.stagedFiles.take(5).forEach { file ->
                Text(
                    text = "  + M $file",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        // 3. Unstaged Files List
        if (changes.unstagedFiles.isNotEmpty()) {
            Text("○ Unstaged Changes (${changes.unstagedCount})", color = Color(0xFFE3B341), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            changes.unstagedFiles.take(5).forEach { file ->
                Text(
                    text = "  • M $file",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (changes.stagedFiles.isEmpty() && changes.unstagedFiles.isEmpty()) {
            Text("Clean working tree", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
        }

        // 4. CTAs
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .testTag(TAG_FILE_CHANGES_OPEN_EDITOR)
                    .weight(1f)
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFF1F6FEB))
                    .clickable(onClick = onOpenEditor)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Open in Editor ↗", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
            Box(
                modifier = Modifier
                    .testTag(TAG_FILE_CHANGES_REVIEW_DIFF)
                    .weight(1f)
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(DamHopperColors.Surface)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                    .clickable(onClick = onReviewDiff)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Review Diff ⎇", color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
