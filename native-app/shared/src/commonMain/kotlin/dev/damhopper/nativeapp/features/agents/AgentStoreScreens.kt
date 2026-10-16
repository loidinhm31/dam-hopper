package dev.damhopper.nativeapp.features.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.editor.MarkdownPreviewView
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Main view for the Agent Store tab within WorkbenchPanel.AGENTS.
 * Strictly adheres to 0 FABs and dark workbench theme.
 */
@Composable
fun AgentStoreView(
    controller: AgentStoreController,
    availableProjects: List<String>,
    modifier: Modifier = Modifier
) {
    val state by controller.state.collectAsState()
    var showMatrix by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // 1. Top Bar: Search, Category Chips, Scan Projects, Matrix toggle, Refresh
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Search box
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    if (state.searchQuery.isEmpty()) {
                        Text(
                            text = "Search store items...",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 12.sp
                        )
                    }
                    BasicTextField(
                        value = state.searchQuery,
                        onValueChange = { controller.setSearchQuery(it) },
                        textStyle = TextStyle(color = DamHopperColors.TextPrimary, fontSize = 12.sp),
                        cursorBrush = SolidColor(DamHopperColors.Primary),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }

                // Scan Projects button
                Button(
                    onClick = { controller.scanProjects() },
                    enabled = !state.isScanningProjects,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    if (state.isScanningProjects) {
                        CircularProgressIndicator(color = DamHopperColors.Primary, modifier = Modifier.size(12.dp))
                    } else {
                        Text("Scan Projects", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                    }
                }

                // Matrix toggle
                Button(
                    onClick = { showMatrix = !showMatrix },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (showMatrix) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
                    ),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        text = if (showMatrix) "Items" else "Matrix",
                        fontSize = 11.sp,
                        color = if (showMatrix) Color.Black else DamHopperColors.TextPrimary
                    )
                }

                // Refresh button
                Button(
                    onClick = { controller.loadStore() },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text("Refresh", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                }
            }

            // Category filter chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val isAllSelected = state.selectedCategory == null
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isAllSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                        .clickable { controller.setCategoryFilter(null) }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = "All",
                        fontSize = 11.sp,
                        fontWeight = if (isAllSelected) FontWeight.Bold else FontWeight.Normal,
                        color = if (isAllSelected) Color.Black else DamHopperColors.TextSecondary
                    )
                }

                AgentItemCategory.entries.forEach { cat ->
                    val isSelected = state.selectedCategory == cat
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                            .clickable { controller.setCategoryFilter(cat) }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = cat.displayName,
                            fontSize = 11.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = if (isSelected) Color.Black else DamHopperColors.TextSecondary
                        )
                    }
                }
            }
        }

        // 2. Health check alert banner if broken symlinks or orphaned items detected
        state.health?.let { health ->
            val brokenCount = health.brokenSymlinks.size
            val orphanedCount = health.orphanedItems.size
            if (brokenCount > 0 || orphanedCount > 0) {
                var expandedHealth by remember { mutableStateOf(false) }
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(DamHopperColors.Warning.copy(alpha = 0.15f))
                        .border(1.dp, DamHopperColors.Warning.copy(alpha = 0.4f))
                        .padding(8.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { expandedHealth = !expandedHealth },
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "⚠ Store Health: $brokenCount broken symlink(s), $orphanedCount orphaned item(s)",
                            color = DamHopperColors.Warning,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = if (expandedHealth) "Hide" else "Show Details",
                            color = DamHopperColors.Primary,
                            fontSize = 10.sp
                        )
                    }
                    if (expandedHealth) {
                        Column(modifier = Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            health.brokenSymlinks.forEach { sym ->
                                Text(
                                    text = "Broken: [${sym.project}] ${sym.path} -> ${sym.target}",
                                    fontSize = 10.sp,
                                    color = DamHopperColors.TextSecondary,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                            health.orphanedItems.forEach { orph ->
                                Text(
                                    text = "Orphaned: [${orph.project}] ${orph.path} (${orph.reason})",
                                    fontSize = 10.sp,
                                    color = DamHopperColors.TextSecondary,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                    }
                }
            }
        }

        // View-level mutation error banner (fixes W2)
        state.mutationError?.let { mutErr ->
            if (state.shipDialogItem == null && state.cellActionModalData == null && state.deleteConfirmationItem == null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(DamHopperColors.Error.copy(alpha = 0.2f))
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "Action Error: $mutErr", color = DamHopperColors.Error, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    TextButton(
                        onClick = { controller.loadStore() },
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text("Dismiss & Refresh", color = DamHopperColors.TextPrimary, fontSize = 10.sp)
                    }
                }
            }
        }

        // General error banner
        state.error?.let { err ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Error.copy(alpha = 0.2f))
                    .padding(8.dp)
            ) {
                Text(text = err, color = DamHopperColors.Error, fontSize = 11.sp)
            }
        }

        if (state.isUnavailable) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = state.unavailableMessage ?: "Agent Store is unavailable for this profile.",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 13.sp
                )
            }
            return
        }

        if (state.isLoading && state.items.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = DamHopperColors.Primary, modifier = Modifier.size(32.dp))
            }
            return
        }

        // 3. Main Content: Distribution Matrix or Inventory & Detail View
        if (showMatrix) {
            AgentDistributionMatrixView(
                items = state.filteredItems,
                projects = availableProjects,
                matrix = state.matrix,
                onCellClick = { item, project, agent ->
                    controller.openCellActionModal(item, project, agent)
                },
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Row(modifier = Modifier.fillMaxSize()) {
                // Left Column: Items Inventory List
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (state.filteredItems.isEmpty()) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "No agent store items found",
                                    color = DamHopperColors.TextSecondary,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                    items(state.filteredItems, key = { AgentStoreHelpers.itemKey(it.category, it.name) }) { item ->
                        val isSelected = state.selectedItem?.name == item.name && state.selectedItem?.category == item.category
                        val shipCount = state.shipCounts[AgentStoreHelpers.itemKey(item.category, item.name)] ?: 0

                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DamHopperColors.SurfaceVariant else DamHopperColors.Surface)
                                .border(
                                    1.dp,
                                    if (isSelected) DamHopperColors.Primary else DamHopperColors.Border,
                                    RoundedCornerShape(6.dp)
                                )
                                .clickable { controller.selectItem(item) }
                                .padding(10.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = item.name,
                                    color = DamHopperColors.TextPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Box(
                                    modifier = Modifier
                                        .background(DamHopperColors.PrimaryVariant.copy(alpha = 0.3f), RoundedCornerShape(4.dp))
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = item.category.displayName,
                                        color = DamHopperColors.Primary,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }

                            if (!item.description.isNullOrBlank()) {
                                Text(
                                    text = item.description,
                                    color = DamHopperColors.TextSecondary,
                                    fontSize = 11.sp,
                                    maxLines = 2,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Shipped to $shipCount project target(s)",
                                    color = if (shipCount > 0) DamHopperColors.Secondary else DamHopperColors.TextSecondary,
                                    fontSize = 10.sp
                                )
                                Text(
                                    text = AgentStoreHelpers.formatBytes(item.sizeBytes),
                                    color = DamHopperColors.TextSecondary,
                                    fontSize = 10.sp
                                )
                            }
                        }
                    }
                }

                // Right Column: Selected Item Detail & Content Preview
                Box(
                    modifier = Modifier
                        .weight(1.2f)
                        .fillMaxHeight()
                        .background(DamHopperColors.Surface)
                        .border(1.dp, DamHopperColors.Border)
                ) {
                    val selItem = state.selectedItem
                    if (selItem != null) {
                        Column(modifier = Modifier.fillMaxSize().padding(10.dp)) {
                            // Detail Header
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = selItem.name,
                                        color = DamHopperColors.TextPrimary,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Text(
                                        text = "${selItem.category.displayName} • ${selItem.relativePath}",
                                        color = DamHopperColors.TextSecondary,
                                        fontSize = 10.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }

                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Button(
                                        onClick = { controller.openShipDialog(selItem) },
                                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                        shape = RoundedCornerShape(4.dp)
                                    ) {
                                        Text("Ship", fontSize = 11.sp, color = Color.Black)
                                    }

                                    Button(
                                        onClick = { controller.requestDeleteItem(selItem) },
                                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error.copy(alpha = 0.8f)),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                        shape = RoundedCornerShape(4.dp)
                                    ) {
                                        Text("Delete", fontSize = 11.sp, color = Color.White)
                                    }
                                }
                            }

                            // Compatible agents tags
                            if (selItem.compatibleAgents.isNotEmpty()) {
                                Row(
                                    modifier = Modifier.padding(vertical = 6.dp),
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Text("Agents:", fontSize = 10.sp, color = DamHopperColors.TextSecondary)
                                    selItem.compatibleAgents.forEach { ag ->
                                        Box(
                                            modifier = Modifier
                                                .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(3.dp))
                                                .padding(horizontal = 4.dp, vertical = 1.dp)
                                        ) {
                                            Text(ag.wireName, fontSize = 9.sp, color = DamHopperColors.TextPrimary)
                                        }
                                    }
                                }
                            }

                            HorizontalDivider(color = DamHopperColors.Border, modifier = Modifier.padding(vertical = 6.dp))

                            // Markdown content preview
                            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                                if (state.isLoadingContent) {
                                    CircularProgressIndicator(
                                        color = DamHopperColors.Primary,
                                        modifier = Modifier.size(24.dp).align(Alignment.Center)
                                    )
                                } else {
                                    val content = state.itemContent ?: ""
                                    if (content.isNotBlank()) {
                                        MarkdownPreviewView(
                                            markdownContent = content,
                                            modifier = Modifier.fillMaxSize()
                                        )
                                    } else {
                                        Text(
                                            text = "No content available for preview",
                                            color = DamHopperColors.TextSecondary,
                                            fontSize = 11.sp,
                                            modifier = Modifier.align(Alignment.Center)
                                        )
                                    }
                                }
                            }
                        }
                    } else {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                text = "Select an item to preview its details and markdown",
                                color = DamHopperColors.TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }
        }
    }

    // 4. Modals and Dialogs
    state.shipDialogItem?.let { item ->
        ShipItemDialog(
            item = item,
            availableProjects = availableProjects,
            isMutating = state.isMutating,
            errorMessage = state.mutationError,
            onShip = { selectedProjects, method ->
                controller.bulkShip(
                    items = listOf(item),
                    projects = selectedProjects,
                    method = method,
                    onSuccess = { controller.closeShipDialog() }
                )
            },
            onDismiss = { controller.closeShipDialog() }
        )
    }

    state.cellActionModalData?.let { modalData ->
        CellActionDialog(
            data = modalData,
            isMutating = state.isMutating,
            errorMessage = state.mutationError,
            onShip = { method ->
                controller.shipItem(
                    item = modalData.item,
                    projectName = modalData.projectName,
                    agent = modalData.agent,
                    method = method,
                    onSuccess = { controller.closeCellActionModal() }
                )
            },
            onUnship = { force ->
                controller.unshipItem(
                    item = modalData.item,
                    projectName = modalData.projectName,
                    agent = modalData.agent,
                    force = force
                )
                controller.closeCellActionModal()
            },
            onAbsorb = {
                controller.absorbItem(
                    item = modalData.item,
                    projectName = modalData.projectName,
                    agent = modalData.agent
                )
                controller.closeCellActionModal()
            },
            onDismiss = { controller.closeCellActionModal() }
        )
    }

    state.deleteConfirmationItem?.let { item ->
        DeleteConfirmDialog(
            item = item,
            isMutating = state.isMutating,
            errorMessage = state.mutationError,
            onConfirm = { controller.confirmDeleteItem() },
            onDismiss = { controller.dismissDeleteDialog() }
        )
    }

    state.bulkResults?.let { results ->
        BulkShipResultsDialog(
            results = results,
            onDismiss = { controller.clearBulkResults() }
        )
    }

    state.projectScanResults?.let { scanList ->
        ProjectScanResultsDialog(
            scanResults = scanList,
            onDismiss = { controller.clearProjectScanResults() }
        )
    }
}
