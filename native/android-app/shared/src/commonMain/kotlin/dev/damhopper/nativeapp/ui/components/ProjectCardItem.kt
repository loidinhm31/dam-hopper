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
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.ProjectCardUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_PROJECT_CARD_PREFIX: String = "project-card-item:"
const val TAG_PROJECT_CARD_FILES_PREFIX: String = "project-card-files:"
const val TAG_PROJECT_CARD_TERM_PREFIX: String = "project-card-term:"
const val TAG_PROJECT_CARD_GIT_PREFIX: String = "project-card-git:"
const val TAG_PROJECT_CARD_DISMISS_PREFIX: String = "project-card-dismiss:"

@Composable
fun ProjectCardItem(
    project: ProjectCardUiState,
    callbacks: AgentHubLandingCallbacks,
    modifier: Modifier = Modifier,
) {
    val isSelected = project.isSelectedForTree
    val hasAttention = project.attentionMessage != null
    val isZero = project.isZeroSessionTarget

    val borderColor = when {
        isSelected -> DamHopperColors.Primary
        hasAttention -> Color(0xFFD29922)
        else -> DamHopperColors.Border
    }
    val borderWidth = if (isSelected) 1.5.dp else 1.dp

    Column(
        modifier = modifier
            .testTag("$TAG_PROJECT_CARD_PREFIX${project.name}")
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.SurfaceVariant)
            .border(borderWidth, borderColor, RoundedCornerShape(8.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Header: Project Name, Profile, Status Badges, and Sibling Dismiss
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = project.name,
                color = DamHopperColors.TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.Surface)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(project.profileTag, color = DamHopperColors.TextSecondary, fontSize = 10.sp)
            }
            if (isSelected) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text("● ACTIVE TREE", color = DamHopperColors.Primary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
            if (isZero && project.isDismissible) {
                Box(
                    modifier = Modifier
                        .testTag("$TAG_PROJECT_CARD_DISMISS_PREFIX${project.name}")
                        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { callbacks.onDismissZeroSessionProject(project.target) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("✕", color = DamHopperColors.TextSecondary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        // 2. Git & Session Metadata
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (project.worktreeBranch != null) {
                Text("⎇ ${project.worktreeBranch}", color = DamHopperColors.TextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            }
            if (project.commitHash != null) {
                Text("#${project.commitHash}", color = DamHopperColors.TextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            }
            Spacer(Modifier.weight(1f))
            Text(
                text = if (isZero) "○ 0 sessions" else ">_ ${project.activeTerminalCount} Term",
                color = if (project.activeTerminalCount > 0) Color(0xFF3FB950) else DamHopperColors.TextSecondary,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }

        // 3. Attention Message or Agents Summary
        if (hasAttention) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(4.dp))
                    .background(Color(0xFFD29922).copy(alpha = 0.2f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text("! ${project.attentionMessage}", color = Color(0xFFE3B341), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        } else if (project.runningAgents.isNotEmpty()) {
            Text("● ${project.runningAgents.joinToString(", ")}", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
        }

        // 4. Quick Action Buttons Row (>=48dp touch targets)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CardActionBtn(
                tag = "$TAG_PROJECT_CARD_FILES_PREFIX${project.name}",
                label = "📁 Files",
                color = DamHopperColors.Primary,
                onClick = { callbacks.onSelectProjectForTree(project.target) },
                modifier = Modifier.weight(1f),
            )
            CardActionBtn(
                tag = "$TAG_PROJECT_CARD_TERM_PREFIX${project.name}",
                label = ">_ Term",
                color = DamHopperColors.TextPrimary,
                onClick = { callbacks.onLaunchTerminalInProject(project.target) },
                modifier = Modifier.weight(1f),
            )
            CardActionBtn(
                tag = "$TAG_PROJECT_CARD_GIT_PREFIX${project.name}",
                label = "⎇ Git",
                color = DamHopperColors.TextSecondary,
                onClick = { callbacks.onOpenGitForProject(project.target) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun CardActionBtn(tag: String, label: String, color: Color, onClick: () -> Unit, modifier: Modifier) {
    Box(
        modifier = modifier
            .testTag(tag)
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(DamHopperColors.Surface)
            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}
