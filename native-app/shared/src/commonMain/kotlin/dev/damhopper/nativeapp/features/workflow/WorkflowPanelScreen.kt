package dev.damhopper.nativeapp.features.workflow

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

enum class WorkflowSubProduct {
    TRACKING,
    PROJECT_PLANS
}

/**
 * Single authoritative panel host for WorkbenchPanel.WORKFLOW.
 * Switches between manual SQLite-backed workflow tracking and file-backed read-only project plans.
 * Strictly adheres to 0 FABs and dark workbench theme.
 */
@Composable
fun WorkflowPanelScreen(
    workflowController: WorkflowController,
    projectPlansController: ProjectPlansController,
    onActiveProductChanged: (WorkflowSubProduct) -> Unit = {},
    modifier: Modifier = Modifier
) {
    var activeProduct by remember { mutableStateOf(WorkflowSubProduct.TRACKING) }

    LaunchedEffect(activeProduct) {
        onActiveProductChanged(activeProduct)
    }
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // Top product switcher (segmented bar)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val tabs = listOf(
                WorkflowSubProduct.TRACKING to "Workflow Tracking",
                WorkflowSubProduct.PROJECT_PLANS to "Project Plans"
            )
            tabs.forEach { (prod, title) ->
                val isSelected = activeProduct == prod
                Box(
                    modifier = Modifier
                        .background(
                            if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                            RoundedCornerShape(6.dp)
                        )
                        .clickable { activeProduct = prod }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = title,
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                        color = if (isSelected) Color.Black else DamHopperColors.TextSecondary
                    )
                }
            }
        }

        Box(modifier = Modifier.fillMaxSize().weight(1f)) {
            when (activeProduct) {
                WorkflowSubProduct.TRACKING -> {
                    WorkflowScreen(controller = workflowController)
                }
                WorkflowSubProduct.PROJECT_PLANS -> {
                    ProjectPlanScreen(controller = projectPlansController)
                }
            }
        }
    }
}
