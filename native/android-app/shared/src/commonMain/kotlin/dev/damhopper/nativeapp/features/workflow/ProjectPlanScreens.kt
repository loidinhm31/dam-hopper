package dev.damhopper.nativeapp.features.workflow

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.editor.MarkdownPreviewView
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun ProjectPlanScreen(
    controller: ProjectPlansController,
    modifier: Modifier = Modifier
) {
    val state by controller.state.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(8.dp)
    ) {
        // Top breadcrumb and navigation bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (state.activeDocumentPath != null || state.selectedPlanPath != null || state.currentPath != "plans") {
                    Button(
                        onClick = { controller.handleBack() },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Text("← Back", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                }

                Text(
                    text = state.activeDocumentPath?.let { "Doc: ${it.substringAfterLast('/')}" }
                        ?: state.selectedPlanPath?.let { "Plan: ${it.substringAfterLast('/')}" }
                        ?: "Path: ${state.currentPath}",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = DamHopperColors.TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Button(
                onClick = {
                    if (state.selectedPlanPath != null) {
                        controller.selectPlan(state.selectedPlanPath!!)
                    } else {
                        controller.loadFolders(state.currentPath)
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                modifier = Modifier.height(28.dp)
            ) {
                Text("Refresh", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
            }
        }

        if (state.isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
            }
            return
        }

        state.error?.let { err ->
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
                    .border(1.dp, DamHopperColors.Error, RoundedCornerShape(8.dp))
            ) {
                Text(
                    text = "Error: $err",
                    color = DamHopperColors.Error,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(12.dp)
                )
            }
        }

        when {
            state.activeDocumentPath != null -> {
                PlanDocumentViewer(state = state, onBack = { controller.closeDocument() })
            }
            state.selectedPlanResponse != null -> {
                SelectedPlanDetailView(
                    response = state.selectedPlanResponse!!,
                    onOpenDoc = { controller.openDocument(it) },
                    onSelectPhase = { controller.selectPhase(it) }
                )
            }
            else -> {
                PlanFoldersListView(
                    response = state.foldersResponse,
                    currentPath = state.currentPath,
                    onSelectFolder = { controller.loadFolders(it) },
                    onSelectPlan = { controller.selectPlan(it) }
                )
            }
        }
    }
}

@Composable
fun PlanFoldersListView(
    response: PlanFoldersResponse?,
    currentPath: String,
    onSelectFolder: (String) -> Unit,
    onSelectPlan: (String) -> Unit
) {
    if (response == null || (response.folders.isEmpty() && response.kind != PlanFolderKind.PLAN)) {
        Box(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No plan folders found at '$currentPath'.",
                color = DamHopperColors.TextSecondary,
                fontSize = 13.sp
            )
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (response.kind == PlanFolderKind.PLAN) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp)
                        .border(1.dp, DamHopperColors.Primary, RoundedCornerShape(8.dp))
                        .clickable { onSelectPlan(response.path) }
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Plan Detected", fontWeight = FontWeight.Bold, color = DamHopperColors.Primary, fontSize = 13.sp)
                            Text("Open plan overview for '${response.path}'", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                        }
                        Button(
                            onClick = { onSelectPlan(response.path) },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                        ) {
                            Text("Open", color = Color.Black, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
        items(response.folders) { entry ->
            val isPlanFile = entry.name.endsWith(".md", ignoreCase = true) || entry.path.endsWith(".md", ignoreCase = true)
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                    .clickable {
                        if (isPlanFile) {
                            onSelectPlan(entry.path)
                        } else {
                            onSelectFolder(entry.path)
                        }
                    }
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (isPlanFile) "📄" else "📁",
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = entry.name,
                            fontWeight = FontWeight.SemiBold,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 13.sp
                        )
                        Text(
                            text = entry.path,
                            fontSize = 11.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                    Text(
                        text = if (isPlanFile) "PLAN" else "DIR",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isPlanFile) DamHopperColors.Primary else DamHopperColors.TextSecondary
                    )
                }
            }
        }
    }
}

@Composable
fun SelectedPlanDetailView(
    response: SelectedPlanResponse,
    onOpenDoc: (String) -> Unit,
    onSelectPhase: (FilePlanPhase) -> Unit
) {
    val plan = response.plan

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Plan Header Card
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = plan.title ?: plan.id,
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Primary,
                            fontSize = 16.sp
                        )
                        // Plan reported status badge with explicit authority label
                        PlanStatusBadge(status = plan.reportedStatus.value)
                    }

                    plan.description?.let { desc ->
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = desc,
                            style = DamHopperTypography.bodyMedium,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // Metadata chips
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        plan.metadata.priority?.let { p ->
                            MetaChip(label = "Priority: $p")
                        }
                        plan.metadata.branch?.let { b ->
                            MetaChip(label = "Branch: $b")
                        }
                        plan.metadata.tags.forEach { tag ->
                            MetaChip(label = "#$tag")
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Button(
                        onClick = { onOpenDoc(plan.documents.plan.path) },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        modifier = Modifier.height(30.dp),
                        contentPadding = PaddingValues(horizontal = 10.dp)
                    ) {
                        Text("📄 View Plan Markdown Document", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            }
        }

        // Completion metrics
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "DECLARED PHASES & COMPLETION",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = DamHopperColors.TextSecondary
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Completed: ${plan.completion.completed} / ${plan.completion.declared ?: plan.phases.size}",
                            fontSize = 12.sp,
                            color = DamHopperColors.Secondary,
                            fontWeight = FontWeight.Bold
                        )
                        plan.completion.fraction?.let { frac ->
                            Text(
                                text = "${(frac * 100).toInt()}%",
                                fontSize = 12.sp,
                                color = DamHopperColors.Primary,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
        // Timeline & Milestones Card
        val dates = plan.dates
        if (dates.created != null || dates.plannedStart != null || dates.plannedEnd != null || dates.actualStart != null || dates.actualEnd != null) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "TIMELINE & MILESTONES",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.TextSecondary
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        dates.created?.let { Text("Created: ${it.value}", fontSize = 11.sp, color = DamHopperColors.TextPrimary) }
                        dates.plannedStart?.let { Text("Planned Start: ${it.value}", fontSize = 11.sp, color = DamHopperColors.TextPrimary) }
                        dates.plannedEnd?.let { Text("Planned End: ${it.value}", fontSize = 11.sp, color = DamHopperColors.TextPrimary) }
                        dates.actualStart?.let { Text("Actual Start: ${it.value}", fontSize = 11.sp, color = DamHopperColors.Secondary) }
                        dates.actualEnd?.let { Text("Actual End: ${it.value}", fontSize = 11.sp, color = DamHopperColors.Secondary) }
                    }
                }
            }
        }

        // Diagnostics if present
        if (response.diagnostics.isNotEmpty()) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, DamHopperColors.Warning, RoundedCornerShape(8.dp))
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "DIAGNOSTICS (${response.diagnostics.size})",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Warning
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        response.diagnostics.forEach { diag ->
                            Text(
                                text = "• [${diag.code}] ${diag.message}",
                                fontSize = 11.sp,
                                color = DamHopperColors.TextPrimary
                            )
                        }
                    }
                }
            }
        }

        // Phases list
        item {
            Text(
                text = "PHASES",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextSecondary,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        items(plan.phases) { phase ->
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                    .clickable {
                        onSelectPhase(phase)
                        phase.path?.let { onOpenDoc(it) }
                    }
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "${phase.number?.let { "Phase $it: " } ?: ""}${phase.title ?: phase.id}",
                            fontWeight = FontWeight.SemiBold,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 13.sp
                        )
                        phase.path?.let { p ->
                            Text(
                                text = p,
                                fontSize = 10.sp,
                                color = DamHopperColors.TextSecondary
                            )
                        }
                        if (phase.evidenceLinks.isNotEmpty()) {
                            Row(modifier = Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                phase.evidenceLinks.forEach { link ->
                                    MetaChip(label = link)
                                }
                            }
                        }
                    }

                    PlanStatusBadge(status = phase.reportedStatus.value)
                }
            }
        }
    }
}

@Composable
fun PlanDocumentViewer(
    state: ProjectPlansState,
    onBack: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Card(
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 8.dp)
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = state.activeDocumentPath ?: "",
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = DamHopperColors.Primary
                )
                Button(
                    onClick = onBack,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    modifier = Modifier.height(26.dp),
                    contentPadding = PaddingValues(horizontal = 8.dp)
                ) {
                    Text("Close", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                }
            }
        }

        if (state.isLoadingDocument) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
            }
            return
        }

        when (val result = state.documentReadResult) {
            is PlanDocumentReadResult.Success -> {
                MarkdownPreviewView(
                    markdownContent = result.content,
                    modifier = Modifier.fillMaxSize()
                )
            }
            is PlanDocumentReadResult.Oversize -> {
                Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                        modifier = Modifier.border(1.dp, DamHopperColors.Warning, RoundedCornerShape(8.dp)).padding(16.dp)
                    ) {
                        Text(
                            text = "Document Oversize",
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Warning,
                            fontSize = 14.sp
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "This plan document (${result.sizeBytes} bytes) exceeds the strict 64 KiB resource ceiling. Loading aborted to preserve device performance.",
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp
                        )
                    }
                }
            }
            is PlanDocumentReadResult.Unreadable -> {
                Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text("Failed to read document: ${result.reason}", color = DamHopperColors.Error)
                }
            }
            is PlanDocumentReadResult.Absent -> {
                Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text("Document not found.", color = DamHopperColors.TextSecondary)
                }
            }
            null -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DamHopperColors.Primary)
                }
            }
        }
    }
}

@Composable
fun PlanStatusBadge(status: PlanStatus) {
    val (bgColor, textColor) = when (status) {
        PlanStatus.COMPLETED -> DamHopperColors.Secondary to Color.Black
        PlanStatus.IN_PROGRESS -> DamHopperColors.Primary to Color.Black
        PlanStatus.BLOCKED -> DamHopperColors.Error to Color.White
        PlanStatus.CANCELLED -> DamHopperColors.Border to DamHopperColors.TextSecondary
        PlanStatus.CONFLICT -> DamHopperColors.Warning to Color.Black
        PlanStatus.PENDING, PlanStatus.UNKNOWN -> DamHopperColors.SurfaceVariant to DamHopperColors.TextSecondary
    }

    Box(
        modifier = Modifier
            .background(bgColor, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = status.wireName.uppercase(),
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
            color = textColor
        )
    }
}

@Composable
fun MetaChip(label: String) {
    Box(
        modifier = Modifier
            .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = label,
            fontSize = 10.sp,
            color = DamHopperColors.TextSecondary
        )
    }
}
