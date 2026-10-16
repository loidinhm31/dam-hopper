package dev.damhopper.nativeapp.features.workflow

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

@Composable
fun WorkflowSessionsView(
    controller: WorkflowController,
    state: WorkflowState
) {
    val sessions = state.overview?.runningSessions ?: emptyList()
    val coroutineScope = rememberCoroutineScope()
    var linkingTerminalSessionId by remember { mutableStateOf<String?>(null) }
    var linkingAgentSessionId by remember { mutableStateOf<String?>(null) }

    if (sessions.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Text("No active sessions running. Click '+ Session' to start one.", color = DamHopperColors.TextSecondary)
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(sessions) { session ->
            val links = state.sessionLinks[session.id] ?: emptyList()

            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Session ${session.id.take(8)}",
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Primary,
                            fontSize = 13.sp
                        )
                        Box(
                            modifier = Modifier
                                .background(DamHopperColors.Secondary, RoundedCornerShape(4.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text("RUNNING", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color.Black)
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Project: ${session.target.project}${session.target.worktreePath?.let { " ($it)" } ?: ""}",
                        fontSize = 11.sp,
                        color = DamHopperColors.TextSecondary
                    )
                    Text(
                        text = "Started at: ${session.startedAt}",
                        fontSize = 11.sp,
                        color = DamHopperColors.TextSecondary
                    )

                    // Linked resources
                    if (links.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Linked Resources (${links.size}):",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.TextSecondary
                        )
                        links.forEach { link ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp)
                                    .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                                    .padding(6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "[${link.resourceType.wireName.uppercase()}] ${link.externalId}",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = DamHopperColors.TextPrimary
                                    )
                                    Text(
                                        text = "Status: ${link.observedState.wireName}${link.suggestedEndTime?.let { " • End suggested: $it" } ?: ""}",
                                        fontSize = 10.sp,
                                        color = if (WorkflowDomainHelpers.isResourceAttentionRequired(link.observedState)) DamHopperColors.Warning else DamHopperColors.TextSecondary
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    link.suggestedEndTime?.let { suggestedTime ->
                                        Button(
                                            onClick = {
                                                coroutineScope.launch {
                                                    controller.endSession(session.id, suggestedTime)
                                                }
                                            },
                                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Secondary),
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                            modifier = Modifier.height(24.dp)
                                        ) {
                                            Text("Apply End Time", fontSize = 9.sp, color = Color.Black, fontWeight = FontWeight.Bold)
                                        }
                                    }
                                    Button(
                                        onClick = {
                                            coroutineScope.launch {
                                                controller.unlinkResource(session.id, link.updatedAt, link.resourceType, link.externalId)
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface),
                                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                        modifier = Modifier.height(24.dp)
                                    ) {
                                        Text("Unlink", fontSize = 9.sp, color = DamHopperColors.Error)
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // Action buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Button(
                            onClick = {
                                coroutineScope.launch {
                                    val now = WorkflowDomainHelpers.formatIsoNow()
                                    controller.endSession(session.id, now)
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                            modifier = Modifier.height(28.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Text("End", fontSize = 11.sp, color = Color.Black, fontWeight = FontWeight.Bold)
                        }

                        Button(
                            onClick = {
                                coroutineScope.launch {
                                    controller.abandonSession(session.id)
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                            modifier = Modifier.height(28.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Text("Abandon", fontSize = 11.sp, color = Color.White)
                        }

                        Button(
                            onClick = { linkingTerminalSessionId = session.id },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                            modifier = Modifier.height(28.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Text("+ Terminal Link", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                        }

                        Button(
                            onClick = { linkingAgentSessionId = session.id },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                            modifier = Modifier.height(28.dp),
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Text("+ Agent Link", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                        }
                    }
                }
            }
        }
    }

    linkingTerminalSessionId?.let { sId ->
        LinkTerminalDialog(
            sessionId = sId,
            onDismiss = { linkingTerminalSessionId = null },
            onLink = { tId, inc ->
                coroutineScope.launch {
                    controller.linkTerminal(sId, tId, inc)
                    linkingTerminalSessionId = null
                }
            }
        )
    }

    linkingAgentSessionId?.let { sId ->
        LinkAgentDialog(
            sessionId = sId,
            onDismiss = { linkingAgentSessionId = null },
            onLink = { aId, hLabel, rId ->
                coroutineScope.launch {
                    controller.linkAgent(sId, aId, hLabel, rId)
                    linkingAgentSessionId = null
                }
            }
        )
    }
}

@Composable
fun WorkflowEventsView(
    controller: WorkflowController,
    state: WorkflowState
) {
    LaunchedEffect(Unit) {
        if (!state.eventsHasLoaded) {
            controller.loadEvents(initial = true)
        }
    }
    val events = state.events.ifEmpty { state.overview?.recentEvents ?: emptyList() }

    if (events.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Text("No recorded workflow events.", color = DamHopperColors.TextSecondary)
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(events) { event ->
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
            ) {
                Row(
                    modifier = Modifier.padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = event.eventType.replace('_', ' ').uppercase(),
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Primary,
                            fontSize = 11.sp
                        )
                        Text(
                            text = "Target: ${event.target?.project ?: "Workspace"}",
                            fontSize = 10.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                    Text(
                        text = event.occurredAt.take(19).replace('T', ' '),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        color = DamHopperColors.TextSecondary
                    )
                }
            }
        }

        if (state.eventsNextCursor != null) {
            item {
                Box(modifier = Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                    Button(
                        onClick = { controller.loadMoreEvents() },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text(
                            text = if (state.isLoadingEvents) "Loading..." else "Load More Events",
                            fontSize = 12.sp,
                            color = DamHopperColors.TextPrimary
                        )
                    }
                }
            }
        }
    }
}
