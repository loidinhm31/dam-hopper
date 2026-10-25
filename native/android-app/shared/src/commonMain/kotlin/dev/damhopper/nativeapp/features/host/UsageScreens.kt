package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.settings.HostMutationAuthority
import dev.damhopper.nativeapp.features.settings.HostMutationTicket
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.describe
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

@Composable
fun UsageScreens(
    controller: UsageController,
    modifier: Modifier = Modifier,
    /** Null keeps every mutation disabled (read-only); there is never an unguarded fallback. */
    mutationAuthority: HostMutationAuthority? = null,
    targetLabel: String = controller.owner.profileId,
) {
    val uiState by controller.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    var showDeleteDialog by remember { mutableStateOf(false) }
    var deleteTicket by remember { mutableStateOf<HostMutationTicket?>(null) }
    var deleteMessage by remember { mutableStateOf<String?>(null) }
    if (showDeleteDialog) {
        UsageDeleteDialog(
            isDeleting = uiState.isDeleting,
            errorMessage = uiState.deleteError ?: deleteMessage,
            onConfirm = { conf, from, to ->
                val ticket = deleteTicket
                if (ticket == null) {
                    deleteMessage = "Read-only: deletion needs the selected Settings server."
                } else {
                    // The SAME captured operation routes the confirmation: a target change while the dialog
                    // was open makes admission fail instead of deleting on another server.
                    controller.deleteUsage(conf, from, to, ticket.newGuard()) { outcome ->
                        if (outcome is SettingsOutcome.Confirmed) {
                            showDeleteDialog = false
                            deleteTicket = null
                            deleteMessage = null
                        } else {
                            deleteMessage = outcome.describe("Usage deletion")
                        }
                    }
                }
            },
            onDismiss = {
                showDeleteDialog = false
                deleteTicket = null
            }
        )
    }

    uiState.selectedSessionDetail?.let { detail ->
        SessionDetailDialog(
            sessionDetail = detail,
            onDismiss = { controller.selectSession(null) }
        )
    }

    val dynamicModels = remember(uiState.knownModels, uiState.sessions) {
        val models = (uiState.knownModels + uiState.sessions.mapNotNull { it.model }).filter { it.isNotBlank() }.distinct()
        listOf(null to "All Models") + models.map { it to it }
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Filter Chips & Delete Action
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                listOf("24h", "7d", "30d").forEach { w ->
                    val isSel = uiState.timeWindow == w
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isSel) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                            .clickable { controller.setTimeWindow(w) }
                            .padding(horizontal = 10.dp, vertical = 5.dp)
                    ) {
                        Text(w, fontSize = 11.sp, color = if (isSel) Color.Black else Color.White, fontWeight = FontWeight.Bold)
                    }
                }

                listOf("hour", "day").forEach { b ->
                    val isSel = uiState.bucket == b
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isSel) DamHopperColors.Secondary else DamHopperColors.SurfaceVariant)
                            .clickable { controller.setBucket(b) }
                            .padding(horizontal = 8.dp, vertical = 5.dp)
                    ) {
                        Text(b, fontSize = 11.sp, color = if (isSel) Color.Black else Color.White, fontWeight = FontWeight.SemiBold)
                    }
                }

                dynamicModels.forEach { (mVal, mLabel) ->
                    val isSel = uiState.modelFilter == mVal
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isSel) DamHopperColors.PrimaryVariant else DamHopperColors.SurfaceVariant)
                            .clickable { controller.setModelFilter(mVal) }
                            .padding(horizontal = 8.dp, vertical = 5.dp)
                    ) {
                        Text(mLabel, fontSize = 11.sp, color = Color.White, fontWeight = FontWeight.Medium)
                    }
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFFEF4444).copy(alpha = 0.2f))
                        .clickable {
                            scope.launch {
                                val ticket = mutationAuthority?.capture(controller.owner)
                                deleteTicket = ticket
                                deleteMessage = if (ticket == null) "Read-only: deletion needs the selected Settings server." else null
                                showDeleteDialog = true
                            }
                        }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                ) {
                    Text("Delete Telemetry", fontSize = 11.sp, color = Color(0xFFEF4444), fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // Token Summary Card (No fabricated zeros)
        item {
            val codex = uiState.summary?.codex
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp)
            ) {
                Text("TOKEN USAGE TOTALS", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                Spacer(modifier = Modifier.height(8.dp))

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MetricGaugeCard("INPUT", codex?.inputTokens?.toString() ?: "--", "Cached: ${codex?.cachedInputTokens ?: "--"}", modifier = Modifier.weight(1f))
                    MetricGaugeCard("OUTPUT", codex?.outputTokens?.toString() ?: "--", "Reasoning: ${codex?.reasoningTokens ?: "--"}", modifier = Modifier.weight(1f))
                    MetricGaugeCard("RESPONSES", codex?.responseCount?.toString() ?: "--", modifier = Modifier.weight(1f))
                }
            }
        }

        // Settings & Health Section (all mutations capture the selected Settings target first)
        item {
            UsageSettingsPanel(
                controller = controller,
                mutationAuthority = mutationAuthority,
                targetLabel = targetLabel,
                onOpenData = null,
            )
        }

        // Sessions Header
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("CODEX SESSIONS (${uiState.sessions.size})", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                if (uiState.isLoadingSessions) {
                    Text("Loading...", fontSize = 11.sp, color = DamHopperColors.Primary)
                }
            }
        }

        // Sessions List
        items(uiState.sessions) { sess ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .clickable { controller.selectSession(sess.id) }
                    .padding(10.dp)
            ) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(sess.model ?: "Standard Codex", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    Text("Responses: ${sess.tokens.responseCount}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("In: ${sess.tokens.inputTokens ?: "--"}  •  Out: ${sess.tokens.outputTokens ?: "--"}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
            }
        }

        // Load More button
        if (uiState.nextCursor != null) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(DamHopperColors.Surface)
                        .clickable { controller.loadSessions(initial = false) }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("Load More Sessions", fontSize = 12.sp, color = DamHopperColors.Primary, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/**
 * Usage settings of ONE selected Settings target. Every mutation first captures the exact selected target
 * (no active-profile fallback); [mutationAuthority] == null keeps all controls read-only with a visible reason.
 */
@Composable
fun UsageSettingsPanel(
    controller: UsageController,
    mutationAuthority: HostMutationAuthority?,
    targetLabel: String,
    onOpenData: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val uiState by controller.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    var busy by remember(controller) { mutableStateOf(false) }
    var message by remember(controller) { mutableStateOf<String?>(null) }
    val readOnlyReason = if (mutationAuthority == null) "Read-only: no Settings authority is attached to this server." else null

    fun mutate(label: String, send: (HostMutationTicket, (SettingsOutcome<*>) -> Unit) -> Unit) {
        val authority = mutationAuthority ?: return
        busy = true
        message = null
        scope.launch {
            val ticket = authority.capture(controller.owner)
            if (ticket == null) {
                busy = false
                message = SettingsOutcome.NotSubmitted("The selected Settings server changed or is not connected.").describe(label)
                return@launch
            }
            send(ticket) { outcome ->
                busy = false
                message = outcome.describe(label)
            }
        }
    }

    UsageSettingsSection(
        uiState = uiState,
        targetLabel = targetLabel,
        readOnlyReason = readOnlyReason,
        busy = busy,
        lastMessage = message,
        onUpdateSettings = { patch ->
            mutate("Usage settings update") { ticket, done -> controller.updateSettings(patch, ticket.newGuard(), done) }
        },
        onUpdateSetup = { patch ->
            mutate("Usage setup update") { ticket, done -> controller.updateSetup(patch, ticket.newGuard(), done) }
        },
        onOpenData = onOpenData,
        modifier = modifier,
    )
}
