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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

@Composable
fun WorkflowScreen(
    controller: WorkflowController,
    modifier: Modifier = Modifier
) {
    val state by controller.state.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var showCreateItemDialog by remember { mutableStateOf(false) }
    var showStartSessionDialog by remember { mutableStateOf(false) }
    var showPurgeDialog by remember { mutableStateOf(false) }
    var activeTab by remember { mutableStateOf(0) } // 0: Overview/Items, 1: Running Sessions, 2: Activity Events

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(8.dp)
    ) {
        // Stale CAS conflict warning banner
        state.conflictWarning?.let { warning ->
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
                    .border(1.dp, DamHopperColors.Warning, RoundedCornerShape(8.dp))
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Conflict Detected",
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Warning,
                            fontSize = 13.sp
                        )
                        Text(
                            text = warning,
                            style = DamHopperTypography.bodyMedium,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp
                        )
                    }
                    Button(
                        onClick = { controller.clearConflictWarning() },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Warning),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Text("Dismiss", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // Profile-scoped 404 unavailable banner
        if (state.isUnavailable) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentAlignment = Alignment.Center
            ) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "Workflow Tracking Unavailable",
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.TextSecondary,
                            fontSize = 16.sp
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = state.unavailableMessage ?: "Workflow tracking is unavailable for this profile.",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 13.sp
                        )
                    }
                }
            }
            return
        }

        // Top action and subtabs bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            val tabs = listOf("Items", "Sessions (${state.overview?.runningSessions?.size ?: 0})", "History")
            tabs.forEachIndexed { index, label ->
                val selected = activeTab == index
                Box(
                    modifier = Modifier
                        .background(
                            if (selected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                            RoundedCornerShape(6.dp)
                        )
                        .clickable { activeTab = index }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = label,
                        fontSize = 12.sp,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                        color = if (selected) Color.Black else DamHopperColors.TextPrimary
                    )
                }
            }

            Spacer(modifier = Modifier.width(4.dp))

            Button(
                onClick = { showCreateItemDialog = true },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.PrimaryVariant),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                modifier = Modifier.height(30.dp)
            ) {
                Text("+ Item", fontSize = 11.sp, color = Color.White)
            }

            Button(
                onClick = { showStartSessionDialog = true },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Secondary),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                modifier = Modifier.height(30.dp)
            ) {
                Text("+ Session", fontSize = 11.sp, color = Color.Black, fontWeight = FontWeight.Bold)
            }

            Button(
                onClick = { controller.refreshOverview() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier.height(30.dp)
            ) {
                Text("Refresh", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
            }

            Button(
                onClick = { showPurgeDialog = true },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier.height(30.dp)
            ) {
                Text("Purge", fontSize = 11.sp, color = DamHopperColors.Error)
            }
        }

        // Filter bar for items tab
        if (activeTab == 0 && state.overview != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text("Project:", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                Box(
                    modifier = Modifier
                        .background(
                            if (state.projectFilter == null) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                            RoundedCornerShape(4.dp)
                        )
                        .clickable { controller.setProjectFilter(null) }
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text("All", fontSize = 10.sp, color = if (state.projectFilter == null) Color.Black else DamHopperColors.TextPrimary)
                }
                state.overview?.projects?.forEach { p ->
                    val isSel = state.projectFilter == p.project
                    Box(
                        modifier = Modifier
                            .background(
                                if (isSel) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                                RoundedCornerShape(4.dp)
                            )
                            .clickable { controller.setProjectFilter(if (isSel) null else p.project) }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(p.project, fontSize = 10.sp, color = if (isSel) Color.Black else DamHopperColors.TextPrimary)
                    }
                }

                Spacer(modifier = Modifier.width(6.dp))
                Text("Status:", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                ItemStatus.entries.forEach { status ->
                    val isSel = state.statusFilter == status
                    Box(
                        modifier = Modifier
                            .background(
                                if (isSel) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                                RoundedCornerShape(4.dp)
                            )
                            .clickable { controller.setStatusFilter(if (isSel) null else status) }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(status.wireName, fontSize = 10.sp, color = if (isSel) Color.Black else DamHopperColors.TextPrimary)
                    }
                }
            }
        }

        if (state.isLoading && state.overview == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
            }
            return
        }

        // Subtabs content
        when (activeTab) {
            0 -> WorkflowItemsView(controller = controller, state = state)
            1 -> WorkflowSessionsView(controller = controller, state = state)
            2 -> WorkflowEventsView(controller = controller, state = state)
        }
    }

    // Dialogs
    if (showCreateItemDialog) {
        CreateItemDialog(
            defaultProject = state.overview?.projects?.firstOrNull()?.project ?: "default",
            onDismiss = { showCreateItemDialog = false },
            onCreate = { target, kind, title, parentId, summary, status ->
                coroutineScope.launch {
                    controller.createItem(
                        target = target,
                        kind = kind,
                        title = title,
                        parentId = parentId,
                        summary = summary,
                        status = status
                    )
                    showCreateItemDialog = false
                }
            }
        )
    }

    if (showStartSessionDialog) {
        StartSessionDialog(
            defaultProject = state.overview?.projects?.firstOrNull()?.project ?: "default",
            onDismiss = { showStartSessionDialog = false },
            onStart = { target, itemId, startedAt ->
                coroutineScope.launch {
                    controller.startSession(target = target, itemId = itemId, startedAt = startedAt)
                    showStartSessionDialog = false
                }
            }
        )
    }

    if (showPurgeDialog) {
        PurgeHistoryDialog(
            onDismiss = { showPurgeDialog = false },
            onPurge = { before ->
                coroutineScope.launch {
                    controller.purgeHistory(before)
                    showPurgeDialog = false
                }
            }
        )
    }

    // Detail dialog when an item is selected
    state.selectedItem?.let { item ->
        val notes = remember(state.overview, item.id) {
            findNotesForItem(state.overview, item.id)
        }

        ItemDetailDialog(
            item = item,
            notes = notes,
            conflictWarning = state.conflictWarning,
            onDismiss = { controller.selectItem(null) },
            onUpdate = { title, summary, summarySpecified, status ->
                coroutineScope.launch {
                    val result = controller.updateItem(
                        id = item.id,
                        updatedAt = item.updatedAt,
                        title = title,
                        summary = summary,
                        summarySpecified = summarySpecified,
                        status = status
                    )
                    if (result.isSuccess) {
                        controller.selectItem(null)
                    }
                }
            },
            onDelete = {
                coroutineScope.launch {
                    controller.deleteItem(item.id, item.updatedAt)
                }
            },
            onAddNote = { body ->
                coroutineScope.launch {
                    controller.addNote(body = body, itemId = item.id)
                }
            },
            onDeleteNote = { noteId, noteUpdatedAt ->
                coroutineScope.launch {
                    controller.deleteNote(noteId, noteUpdatedAt)
                }
            }
        )
    }
}

@Composable
fun WorkflowItemsView(
    controller: WorkflowController,
    state: WorkflowState
) {
    val overview = state.overview
    if (overview == null || (overview.plans.isEmpty() && overview.standaloneTasks.isEmpty())) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Text("No workflow items found. Click '+ Item' to track a plan or task.", color = DamHopperColors.TextSecondary)
        }
        return
    }

    val plans = remember(overview.plans, state.projectFilter, state.statusFilter, state.kindFilter) {
        overview.plans.filter { node ->
            (state.projectFilter == null || node.item.target.project == state.projectFilter) &&
            (state.statusFilter == null || node.item.status == state.statusFilter) &&
            (state.kindFilter == null || node.item.kind == state.kindFilter)
        }
    }

    val standaloneTasks = remember(overview.standaloneTasks, state.projectFilter, state.statusFilter, state.kindFilter) {
        overview.standaloneTasks.filter { node ->
            (state.projectFilter == null || node.item.target.project == state.projectFilter) &&
            (state.statusFilter == null || node.item.status == state.statusFilter) &&
            (state.kindFilter == null || node.item.kind == state.kindFilter)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (plans.isNotEmpty()) {
            item {
                Text(
                    text = "PLANS & PHASES",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextSecondary,
                    modifier = Modifier.padding(vertical = 4.dp)
                )
            }
            items(plans) { planNode ->
                WorkflowNodeItem(
                    node = planNode,
                    expandedIds = state.expandedItemIds,
                    onToggle = { controller.toggleItemExpanded(it) },
                    onSelect = { controller.selectItem(it) }
                )
            }
        }

        if (standaloneTasks.isNotEmpty()) {
            item {
                Text(
                    text = "STANDALONE TASKS",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextSecondary,
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)
                )
            }
            items(standaloneTasks) { taskNode ->
                WorkflowNodeItem(
                    node = taskNode,
                    expandedIds = state.expandedItemIds,
                    onToggle = { controller.toggleItemExpanded(it) },
                    onSelect = { controller.selectItem(it) }
                )
            }
        }
    }
}

@Composable
fun WorkflowNodeItem(
    node: ItemOverviewNodeDto,
    expandedIds: Set<String>,
    onToggle: (String) -> Unit,
    onSelect: (ItemDto) -> Unit,
    depth: Int = 0
) {
    val isExpanded = expandedIds.contains(node.item.id)
    val hasChildren = node.children.isNotEmpty()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (depth * 14).dp)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                .clickable { onSelect(node.item) }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (hasChildren) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clickable { onToggle(node.item.id) },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (isExpanded) "▼" else "▶",
                            fontSize = 10.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                } else {
                    Spacer(modifier = Modifier.width(16.dp))
                }

                // Kind badge
                Box(
                    modifier = Modifier
                        .background(
                            when (node.item.kind) {
                                ItemKind.PLAN -> DamHopperColors.PrimaryVariant
                                ItemKind.PHASE -> DamHopperColors.SurfaceVariant
                                ItemKind.TASK -> DamHopperColors.Border
                            },
                            RoundedCornerShape(4.dp)
                        )
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = node.item.kind.wireName.uppercase(),
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = node.item.title,
                        fontWeight = FontWeight.SemiBold,
                        color = DamHopperColors.TextPrimary,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    WorkflowDomainHelpers.formatTrackedTasksProgress(node.progress)?.let { prog ->
                        Text(text = prog, fontSize = 10.sp, color = DamHopperColors.Secondary)
                    }
                }

                // Status badge
                StatusBadge(status = node.item.status)
            }
        }

        if (hasChildren && isExpanded) {
            Column(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                node.children.forEach { child ->
                    WorkflowNodeItem(
                        node = child,
                        expandedIds = expandedIds,
                        onToggle = onToggle,
                        onSelect = onSelect,
                        depth = depth + 1
                    )
                }
            }
        }
    }
}

@Composable
fun StatusBadge(status: ItemStatus) {
    val (bgColor, textColor) = when (status) {
        ItemStatus.DONE -> DamHopperColors.Secondary to Color.Black
        ItemStatus.IN_PROGRESS -> DamHopperColors.Primary to Color.Black
        ItemStatus.BLOCKED -> DamHopperColors.Error to Color.White
        ItemStatus.CANCELED -> DamHopperColors.Border to DamHopperColors.TextSecondary
        ItemStatus.NEXT -> DamHopperColors.Warning to Color.Black
        ItemStatus.BACKLOG -> DamHopperColors.SurfaceVariant to DamHopperColors.TextSecondary
    }

    Box(
        modifier = Modifier
            .background(bgColor, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = status.wireName.replace('_', ' ').uppercase(),
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
            color = textColor
        )
    }
}

fun findNotesForItem(overview: WorkflowOverviewDto?, itemId: String): List<NoteDto> {
    if (overview == null) return emptyList()
    for (plan in overview.plans) {
        val notes = findNotesInNode(plan, itemId)
        if (notes != null) return notes
    }
    for (task in overview.standaloneTasks) {
        val notes = findNotesInNode(task, itemId)
        if (notes != null) return notes
    }
    return emptyList()
}

private fun findNotesInNode(node: ItemOverviewNodeDto, itemId: String): List<NoteDto>? {
    if (node.item.id == itemId) return node.notes
    for (child in node.children) {
        val found = findNotesInNode(child, itemId)
        if (found != null) return found
    }
    return null
}
