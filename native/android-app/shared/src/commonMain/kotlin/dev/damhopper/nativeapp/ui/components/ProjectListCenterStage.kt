package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.ProjectListCenterStageUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_CENTER_STAGE_CONTAINER: String = "center-stage:container"
const val TAG_CENTER_STAGE_SEARCH: String = "center-stage:search-input"
const val TAG_CENTER_STAGE_OPEN_PROJECT: String = "center-stage:open-project-btn"

@Composable
fun ProjectListCenterStage(
    state: ProjectListCenterStageUiState,
    callbacks: AgentHubLandingCallbacks,
    modifier: Modifier = Modifier,
) {
    val filteredProjects = if (state.searchQuery.isBlank()) {
        state.projects
    } else {
        state.projects.filter { it.name.contains(state.searchQuery, ignoreCase = true) }
    }

    Column(
        modifier = modifier
            .testTag(TAG_CENTER_STAGE_CONTAINER)
            .fillMaxHeight()
            .background(DamHopperColors.Background)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // 1. Search Bar & + Open Project Button
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Search field
            Box(
                modifier = Modifier
                    .weight(1f)
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(DamHopperColors.Surface)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (state.searchQuery.isEmpty()) {
                    Text("🔍 Filter projects...", color = DamHopperColors.TextSecondary, fontSize = 13.sp)
                }
                BasicTextField(
                    value = state.searchQuery,
                    onValueChange = callbacks::onSearchQueryChange,
                    textStyle = TextStyle(color = DamHopperColors.TextPrimary, fontSize = 13.sp),
                    cursorBrush = SolidColor(DamHopperColors.Primary),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag(TAG_CENTER_STAGE_SEARCH),
                )
            }

            // + Open Project button (dark blue background with white text gives 4.68:1 contrast)
            Box(
                modifier = Modifier
                    .testTag(TAG_CENTER_STAGE_OPEN_PROJECT)
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFF1F6FEB))
                    .clickable { callbacks.onOpenProjectPicker() }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("+ Open Project ▾", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }

        // 2. Section Header
        Text(
            text = "CONFIGURED & ACTIVE PROJECTS (${filteredProjects.size})",
            color = DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        // 3. Projects List
        if (state.isLoading) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
            }
        } else if (filteredProjects.isEmpty()) {
            Column(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = if (state.searchQuery.isNotBlank()) "No projects matching search" else "No open projects. Click + Open Project to get started.",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 13.sp,
                )
                // Projectless capability fallbacks
                Row(
                    modifier = Modifier.padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.SurfaceVariant)
                            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                            .clickable { callbacks.onOpenWorkspaceFiles() }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("📁 Workspace Files", color = DamHopperColors.Primary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Box(
                        modifier = Modifier
                            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.SurfaceVariant)
                            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                            .clickable { callbacks.onOpenWorkspaceEditor() }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("📄 Workspace Editor", color = DamHopperColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(filteredProjects, key = { it.id }) { project ->
                    ProjectCardItem(
                        project = project,
                        callbacks = callbacks,
                    )
                }
            }
        }
    }
}
