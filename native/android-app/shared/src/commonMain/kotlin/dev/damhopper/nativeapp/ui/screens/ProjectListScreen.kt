package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.workspace.ProjectSummary
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.CancellationException

/**
 * Mobile screen displaying workspace projects list.
 *
 * Implements core flow stage: Profile Login -> Project List -> Terminal.
 *
 * Supports both self-managed repository querying and externally controlled state.
 */
@Composable
fun ProjectListScreen(
    modifier: Modifier = Modifier,
    profileName: String? = null,
    serverUrl: String? = null,
    workspaceRepository: WorkspaceRepository? = null,
    projects: List<ProjectSummary>? = null,
    isLoading: Boolean = false,
    errorMessage: String? = null,
    onNavigateProfiles: () -> Unit = {},
    onSelectProject: (projectName: String) -> Unit = {},
    onRefresh: (() -> Unit)? = null,
) {
    var refreshTrigger by remember(workspaceRepository) { mutableStateOf(0) }
    var repoProjects by remember(workspaceRepository) { mutableStateOf<List<ProjectSummary>?>(null) }
    var repoLoading by remember(workspaceRepository) { mutableStateOf(false) }
    var repoError by remember(workspaceRepository) { mutableStateOf<String?>(null) }

    val handleRefresh: () -> Unit = {
        onRefresh?.invoke()
        if (workspaceRepository != null && projects == null) {
            refreshTrigger++
        }
    }

    LaunchedEffect(workspaceRepository, refreshTrigger) {
        if (workspaceRepository != null && projects == null) {
            repoLoading = true
            repoError = null
            try {
                repoProjects = workspaceRepository.listProjects()
            } catch (c: CancellationException) {
                throw c
            } catch (e: Exception) {
                repoError = e.message ?: "Failed to query workspace projects"
            } finally {
                repoLoading = false
            }
        }
    }

    val effectiveProjects = projects ?: repoProjects
    val effectiveLoading = isLoading || (projects == null && repoLoading)
    val effectiveError = errorMessage ?: (if (projects == null) repoError else null)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(16.dp)
    ) {
        ProjectListHeader(
            profileName = profileName,
            serverUrl = serverUrl,
            isLoading = effectiveLoading,
            onNavigateProfiles = onNavigateProfiles,
            onRefresh = handleRefresh
        )

        Spacer(modifier = Modifier.height(16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Projects",
                color = DamHopperColors.TextPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            if (!effectiveProjects.isNullOrEmpty()) {
                Text(
                    text = "${effectiveProjects.size} configured",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        when {
            effectiveLoading -> {
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(
                            color = DamHopperColors.Primary,
                            modifier = Modifier.size(36.dp)
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Loading workspace projects...",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 13.sp
                        )
                    }
                }
            }

            effectiveError != null -> {
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f).padding(vertical = 16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    ProjectErrorCard(
                        errorMessage = effectiveError,
                        onRetry = handleRefresh
                    )
                }
            }

            effectiveProjects.isNullOrEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f).padding(vertical = 16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    ProjectEmptyCard(onRefresh = handleRefresh)
                }
            }

            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    items(
                        items = effectiveProjects,
                        key = { project -> "${project.name}:${project.path}" }
                    ) { project ->
                        ProjectCard(
                            project = project,
                            onClick = { onSelectProject(project.name) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectListHeader(
    profileName: String?,
    serverUrl: String?,
    isLoading: Boolean,
    onNavigateProfiles: () -> Unit,
    onRefresh: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = DamHopperColors.Surface,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DamHopperColors.Border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = profileName?.ifBlank { null } ?: "Connected Workspace",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )

                if (!serverUrl.isNullOrBlank()) {
                    Spacer(modifier = Modifier.width(8.dp))
                    ProjectBadge(
                        text = serverUrl,
                        textColor = DamHopperColors.TextSecondary,
                        isMonospace = true
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = onNavigateProfiles,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = DamHopperColors.Primary),
                    border = BorderStroke(1.dp, DamHopperColors.Border),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text("Profiles / Switch", fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }

                Spacer(modifier = Modifier.width(8.dp))

                Button(
                    onClick = onRefresh,
                    enabled = !isLoading,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DamHopperColors.SurfaceVariant,
                        contentColor = DamHopperColors.TextPrimary
                    ),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text("Refresh", fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

/**
 * Individual card representation for a project in the workspace.
 */
@Composable
fun ProjectCard(
    project: ProjectSummary,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DamHopperColors.Border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = project.name,
                    color = DamHopperColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f, fill = false)
                )

                if (!project.projectType.isNullOrBlank()) {
                    Spacer(modifier = Modifier.width(8.dp))
                    ProjectBadge(
                        text = project.projectType,
                        textColor = DamHopperColors.Primary,
                        borderColor = DamHopperColors.Primary.copy(alpha = 0.5f),
                        backgroundColor = DamHopperColors.PrimaryVariant.copy(alpha = 0.25f),
                        isMonospace = true
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = project.path,
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace
            )

            val hasTags = !project.tags.isNullOrEmpty()
            val hasCommands = !project.commands.isNullOrEmpty()

            if (hasTags || hasCommands) {
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    project.tags?.forEach { tag ->
                        ProjectBadge(
                            text = "#$tag",
                            textColor = DamHopperColors.Secondary
                        )
                    }

                    project.commands?.keys?.forEach { cmd ->
                        ProjectBadge(
                            text = "> $cmd",
                            textColor = DamHopperColors.TextSecondary,
                            isMonospace = true
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectBadge(
    text: String,
    textColor: Color,
    borderColor: Color = DamHopperColors.Border,
    backgroundColor: Color = DamHopperColors.SurfaceVariant,
    isMonospace: Boolean = false,
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(backgroundColor)
            .border(1.dp, borderColor, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = text,
            color = textColor,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = if (isMonospace) FontFamily.Monospace else FontFamily.Default,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun ProjectErrorCard(
    errorMessage: String,
    onRetry: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DamHopperColors.Error)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Failed to load projects",
                color = DamHopperColors.Error,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = errorMessage,
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(14.dp))
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(
                    containerColor = DamHopperColors.Primary,
                    contentColor = DamHopperColors.Background
                )
            ) {
                Text("Retry", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun ProjectEmptyCard(
    onRefresh: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DamHopperColors.Border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "No projects configured in workspace",
                color = DamHopperColors.TextSecondary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedButton(
                onClick = onRefresh,
                border = BorderStroke(1.dp, DamHopperColors.Border),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = DamHopperColors.Primary)
            ) {
                Text("Refresh")
            }
        }
    }
}
