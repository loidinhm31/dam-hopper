package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.editor.CloseDecision
import dev.damhopper.nativeapp.features.editor.EditorPanelScreen
import dev.damhopper.nativeapp.features.editor.LocalNativeEditorSurfaceHost
import dev.damhopper.nativeapp.features.editor.NativeEditorSurfaceHost
import dev.damhopper.nativeapp.features.files.FileOperationOutcome
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.ui.components.TerminalAgentsContext
import dev.damhopper.nativeapp.features.files.FocusedFilesExplorerScreen
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.stepTerminalFontSize
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureIntent
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily
import kotlinx.coroutines.launch

private val EDITOR_SIDEBAR_WIDTH = 280.dp
private val EDITOR_SIDEBAR_PINNED_MIN_WIDTH = 600.dp

/** True when the available width pins the file tree beside the editor (split view) instead of a slide-over. */
fun isEditorSidebarPinned(availableWidth: Dp): Boolean = availableWidth >= EDITOR_SIDEBAR_PINNED_MIN_WIDTH

/**
 * Background editor input policy: a compact slide-over sidebar covers the editor, so IME and hardware
 * input must be suppressed while it is open. The pinned split view leaves the editor usable.
 */
fun isEditorInputAllowed(isSidebarOpen: Boolean, isPinned: Boolean): Boolean = !isSidebarOpen || isPinned

/** Escape (on key down) dismisses the compact slide-over sidebar. */
fun isEditorSidebarDismissKey(key: Key, type: KeyEventType): Boolean =
    key == Key.Escape && type == KeyEventType.KeyDown

/**
 * Focused Project Workspace composable hosting Terminal, Files Explorer, and Native Editor
 * in a single unified view above the IME.
 *
 * Invariants:
 * 1. Exactly one visible panel at any time across phones and tablets.
 * 2. Shared top navigation row with inline panel tabs (Terminal, Files, Editor) and project header.
 * 3. File open from explorer automatically switches active panel to [WorkspacePanel.EDITOR].
 * 4. All voluntary exits (Back, Projects, Profile/Project switches) route strictly through the
 *    retained departure guard before clearing route or terminal sessions.
 * 5. Zero Floating Action Buttons (FAB) and zero WebView components.
 */
@Composable
fun ProjectWorkspaceScreen(
    projectName: String,
    workspaceState: ProjectWorkspaceState,
    terminalRepo: TerminalRepository?,
    navigation: AppFlowNavigation,
    modifier: Modifier = Modifier,
    initialSessionId: String? = null,
    onSessionSelected: ((String?) -> Unit)? = null,
    profileId: String? = null,
    preferenceAccess: PreferenceAccess? = null,
    languageFilterNotice: String? = null,
    headerEntries: HeaderEntries? = null,
    nativeSurfaceHost: NativeEditorSurfaceHost? = LocalNativeEditorSurfaceHost.current,
    /** Exact manual-activation intent forwarded to the terminal panel (never a first-terminal fallback). */
    requiredTerminalInstance: TerminalAgentsInstanceKey? = null,
    /** Retained Agents roster participation of this workspace (null: no Agents sidebar). */
    agents: TerminalAgentsContext? = null,
) {
    val coroutineScope = rememberCoroutineScope()
    val activePanel by workspaceState.activePanel.collectAsState()
    val pendingDeparture by workspaceState.pendingDeparture.collectAsState()
    val inputSuspended by workspaceState.isInputSuspended.collectAsState()
    val tabs by workspaceState.editorTabsState.tabs.collectAsState()
    val hasDirtyDocs = tabs.any { it.isDirty }

    // One reactive preference truth (the retained repository); hidden files and the language family follow it live.
    val prefAccess = preferenceAccess ?: workspaceState.preferenceAccess
        ?: remember { PreferenceAccess(MutableStateFlow(WorkbenchPreferences()), {}) }
    val prefs by prefAccess.preferences.collectAsState()
    LaunchedEffect(workspaceState, prefs.explorerShowHidden) {
        workspaceState.fileTreeState.setShowHidden(prefs.explorerShowHidden)
    }
    LaunchedEffect(workspaceState, prefs.explorerLanguageFilter) {
        workspaceState.fileTreeState.setLanguageFilter(prefs.explorerLanguageFilter)
    }
    LaunchedEffect(activePanel) {
        workspaceState.terminalState?.setPanelVisible(activePanel == WorkspacePanel.TERMINAL)
    }

    // A compact Agents sheet consumes route controls: nothing routes under it.
    val routeLocked = agents?.host?.compactSheetOpen == true

    // Register departure guard with flow navigation
    DisposableEffect(navigation, workspaceState) {
        navigation.departureGuard = { request ->
            if (workspaceState.hasDirtyDocuments() && !workspaceState.isAuthorityRetired.value) {
                val dirtyIds = workspaceState.getDirtyDocumentIds()
                val dirtyRevs = workspaceState.getDirtyRevisions()
                workspaceState.setPendingDeparture(
                    WorkspaceDepartureIntent.WorkspaceLeave(
                        targetStageName = request.targetStage.name,
                        dirtyDocuments = dirtyIds,
                        dirtyRevisions = dirtyRevs,
                        onConfirmed = request.onProceed,
                        onCancelled = request.onCancelled,
                    )
                )
                true // Intercept navigation!
            } else {
                false // Allow immediate navigation
            }
        }
        onDispose {
            navigation.departureGuard = null
            workspaceState.detachWidgets()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // 1. Shared Workspace Header & Inline Navigation
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // Row 1: Compact Back button + Project Name + Global Actions (Alerts, Settings)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Compact Back Button
                Box(
                    modifier = Modifier
                        .sizeIn(minWidth = 34.dp, minHeight = 32.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .border(BorderStroke(1.dp, DamHopperColors.Border), RoundedCornerShape(6.dp))
                        .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.7f))
                        .clickable {
                            if (!routeLocked && !navigation.handleBackPress()) {
                                // Handled by system or departure guard
                            }
                        }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .semantics { contentDescription = "Back to Projects" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "←",
                        color = DamHopperColors.Primary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                // Dedicated Project Name (takes remaining space in middle)
                Text(
                    text = projectName,
                    color = DamHopperColors.TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )

                headerEntries?.let { HeaderEntryButtons(it) }
            }

            // Row 2: Inline panel tabs (Terminal | Files | Editor) across full width
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                PanelTabButton(
                    label = "Terminal",
                    isSelected = activePanel == WorkspacePanel.TERMINAL,
                    onClick = { if (!routeLocked) workspaceState.selectPanel(WorkspacePanel.TERMINAL) }
                )

                PanelTabButton(
                    label = "Files",
                    isSelected = activePanel == WorkspacePanel.FILES,
                    onClick = { if (!routeLocked) workspaceState.selectPanel(WorkspacePanel.FILES) }
                )

                val editorLabel = if (hasDirtyDocs) "Editor *" else "Editor"
                PanelTabButton(
                    label = editorLabel,
                    isSelected = activePanel == WorkspacePanel.EDITOR,
                    badgeCount = tabs.size,
                    onClick = { if (!routeLocked) workspaceState.selectPanel(WorkspacePanel.EDITOR) }
                )
            }
        }
        // 2. Active Focused Panel (Single content host)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            when (activePanel) {
                WorkspacePanel.TERMINAL -> {
                    ProjectTerminalScreen(
                        projectName = projectName,
                        terminalRepo = terminalRepo,
                        onBackToProjects = {
                            navigation.handleBackPress()
                        },
                        initialSessionId = initialSessionId,
                        onSessionSelected = onSessionSelected,
                        profileId = profileId,
                        preferenceAccess = prefAccess,
                        retainedState = workspaceState.terminalState,
                        requiredTerminalInstance = requiredTerminalInstance,
                        agents = agents,
                        worktreePath = workspaceState.target.worktreePath,
                        inputCovered = inputSuspended,
                        showHeader = false,
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                WorkspacePanel.FILES -> {
                    FocusedFilesExplorerScreen(
                        treeState = workspaceState.fileTreeState,
                        mutationCoordinator = workspaceState.fileMutationCoordinator,
                        onSelectLanguageFilter = { prefAccess.selectLanguageFilter(it) },
                        languageFilterNotice = languageFilterNotice,
                        onOpenFile = { target, path ->
                            coroutineScope.launch {
                                workspaceState.editorTabsState.openTab(target, path)
                                workspaceState.selectPanel(WorkspacePanel.EDITOR)
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                WorkspacePanel.EDITOR -> {
                    val isSidebarOpen by workspaceState.isEditorSidebarOpen.collectAsState()
                    // Single BoxWithConstraints: EditorPanelScreen keeps one stable composition slot across
                    // sidebar toggles and the 600 dp breakpoint, so the native editor view is never remounted.
                    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
                        val isPinned = isEditorSidebarPinned(maxWidth)

                        DisposableEffect(isSidebarOpen, isPinned, navigation, workspaceState) {
                            val unregister = if (!isPinned && isSidebarOpen) {
                                navigation.registerBackInterceptor {
                                    workspaceState.setEditorSidebarOpen(false)
                                    true
                                }
                            } else {
                                {}
                            }
                            onDispose { unregister() }
                        }

                        Row(modifier = Modifier.fillMaxSize()) {
                            if (isPinned && isSidebarOpen) {
                                Box(modifier = Modifier.width(EDITOR_SIDEBAR_WIDTH).fillMaxHeight()) {
                                    FocusedFilesExplorerScreen(
                                        treeState = workspaceState.fileTreeState,
                                        mutationCoordinator = workspaceState.fileMutationCoordinator,
                                        onSelectLanguageFilter = { prefAccess.selectLanguageFilter(it) },
                                        languageFilterNotice = languageFilterNotice,
                                        onOpenFile = { target, path ->
                                            coroutineScope.launch {
                                                workspaceState.editorTabsState.openTab(target, path)
                                            }
                                        },
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .width(1.dp)
                                        .fillMaxHeight()
                                        .background(DamHopperColors.Border)
                                )
                            }

                            EditorPanelScreen(
                                tabsState = workspaceState.editorTabsState,
                                nativeSurfaceHost = nativeSurfaceHost,
                                onToggleSidebar = { workspaceState.toggleEditorSidebar() },
                                isSidebarOpen = isSidebarOpen,
                                isInputAllowed = isEditorInputAllowed(isSidebarOpen, isPinned) && !inputSuspended,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                            )
                        }

                        // Slide-over overlay on compact screens
                        if (!isPinned && isSidebarOpen) {
                            val sidebarFocusRequester = remember { FocusRequester() }
                            LaunchedEffect(Unit) {
                                sidebarFocusRequester.requestFocus()
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(Color.Black.copy(alpha = 0.5f))
                                    .clickable { workspaceState.setEditorSidebarOpen(false) }
                            )
                            Box(
                                modifier = Modifier
                                    .align(Alignment.CenterStart)
                                    .fillMaxHeight()
                                    .width(EDITOR_SIDEBAR_WIDTH)
                                    .background(DamHopperColors.Surface)
                                    .focusRequester(sidebarFocusRequester)
                                    .focusable()
                                    .onPreviewKeyEvent { event ->
                                        if (isEditorSidebarDismissKey(event.key, event.type)) {
                                            workspaceState.setEditorSidebarOpen(false)
                                            true
                                        } else {
                                            false
                                        }
                                    }
                            ) {
                                FocusedFilesExplorerScreen(
                                    treeState = workspaceState.fileTreeState,
                                    mutationCoordinator = workspaceState.fileMutationCoordinator,
                                    onSelectLanguageFilter = { prefAccess.selectLanguageFilter(it) },
                                    languageFilterNotice = languageFilterNotice,
                                    onOpenFile = { target, path ->
                                        coroutineScope.launch {
                                            workspaceState.editorTabsState.openTab(target, path)
                                            workspaceState.setEditorSidebarOpen(false)
                                        }
                                    },
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Retained Departure Modal Guard
    pendingDeparture?.let { departure ->
        when (departure) {
            is WorkspaceDepartureIntent.WorkspaceLeave -> {
                AlertDialog(
                    onDismissRequest = {
                        if (!workspaceState.isSavingDeparture) {
                            workspaceState.clearPendingDeparture()
                        }
                    },
                    title = {
                        Text(
                            text = "Unsaved Changes",
                            color = DamHopperColors.TextPrimary,
                            fontWeight = FontWeight.Bold
                        )
                    },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "You have ${departure.dirtyDocuments.size} unsaved file(s) in this workspace. Save changes before leaving?",
                                color = DamHopperColors.TextSecondary,
                                fontSize = 14.sp
                            )
                            workspaceState.departureError?.let { err ->
                                Text(
                                    text = err,
                                    color = DamHopperColors.Error,
                                    fontSize = 12.sp
                                )
                            }
                            if (workspaceState.isSavingDeparture) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    CircularProgressIndicator(
                                        color = DamHopperColors.Primary,
                                        modifier = Modifier.sizeIn(maxWidth = 18.dp, maxHeight = 18.dp)
                                    )
                                    Text("Saving changes...", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
                                }
                            }
                        }
                    },
                    confirmButton = {
                        Button(
                            enabled = !workspaceState.isSavingDeparture,
                            onClick = {
                                coroutineScope.launch {
                                    workspaceState.commitDepartureSave(departure)
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                        ) {
                            Text("Save All & Leave")
                        }
                    },
                    dismissButton = {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            TextButton(
                                enabled = !workspaceState.isSavingDeparture,
                                onClick = {
                                    workspaceState.completePendingDeparture(departure)
                                    departure.onConfirmed()
                                }
                            ) {
                                Text("Discard & Leave", color = DamHopperColors.Error)
                            }

                            TextButton(
                                enabled = !workspaceState.isSavingDeparture,
                                onClick = {
                                    workspaceState.clearPendingDeparture()
                                }
                            ) {
                                Text("Cancel")
                            }
                        }
                    }
                )
            }

            is WorkspaceDepartureIntent.TabClose -> {
                val intent = departure.intent
                AlertDialog(
                    onDismissRequest = {
                        if (!workspaceState.isSavingDeparture) {
                            workspaceState.clearPendingDeparture()
                        }
                    },
                    title = {
                        Text("Unsaved Changes", color = DamHopperColors.TextPrimary, fontWeight = FontWeight.Bold)
                    },
                    text = {
                        Text(
                            text = "Save changes to ${intent.id.relativePath} before closing?",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 14.sp
                        )
                    },
                    confirmButton = {
                        Button(
                            enabled = !workspaceState.isSavingDeparture,
                            onClick = {
                                workspaceState.isSavingDeparture = true
                                coroutineScope.launch {
                                    try {
                                        val doc = workspaceState.editorTabsState.getDocument(intent.id)
                                        val outcome = workspaceState.editorRepository.saveDocument(intent.id)
                                        if (outcome is FileOperationOutcome.Confirmed && doc?.revision?.value == intent.dirtyRevision) {
                                            workspaceState.editorTabsState.confirmClose(intent.copy(decision = CloseDecision.DISCARD))
                                            workspaceState.clearPendingDeparture()
                                        }
                                    } finally {
                                        workspaceState.isSavingDeparture = false
                                    }
                                }
                            }
                        ) {
                            Text("Save")
                        }
                    },
                    dismissButton = {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            TextButton(
                                enabled = !workspaceState.isSavingDeparture,
                                onClick = {
                                    workspaceState.editorTabsState.confirmClose(intent.copy(decision = CloseDecision.DISCARD))
                                    workspaceState.clearPendingDeparture()
                                }
                            ) {
                                Text("Discard", color = DamHopperColors.Error)
                            }

                            TextButton(
                                enabled = !workspaceState.isSavingDeparture,
                                onClick = {
                                    workspaceState.clearPendingDeparture()
                                }
                            ) {
                                Text("Cancel")
                            }
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun PanelTabButton(
    label: String,
    isSelected: Boolean,
    badgeCount: Int? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val bgColor = if (isSelected) DamHopperColors.PrimaryVariant else DamHopperColors.SurfaceVariant
    val textColor = if (isSelected) DamHopperColors.Primary else DamHopperColors.TextSecondary

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(bgColor)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = label,
                color = textColor,
                fontSize = 13.sp,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
            )
            if (badgeCount != null && badgeCount > 0) {
                Text(
                    text = "($badgeCount)",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
        }
    }
}
