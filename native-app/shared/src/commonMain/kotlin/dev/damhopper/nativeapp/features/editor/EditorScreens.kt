package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

@Composable
fun EditorPanelScreen(
    tabsState: EditorTabsState,
    blameRepo: BlameRepository? = null,
    onInspectCommit: (String) -> Unit = {},
    onDownloadMedia: ((EditorTab) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val coroutineScope = rememberCoroutineScope()
    val tabs by tabsState.tabs.collectAsState()
    val activeTabKey by tabsState.activeTabKey.collectAsState()
    val activeTab = tabs.find { it.key == activeTabKey }
    val session = activeTabKey?.let { tabsState.getSession(it) }
    var findState by remember(activeTabKey) { mutableStateOf(session?.findReplaceState ?: FindReplaceState()) }
    var showBlame by remember { mutableStateOf(false) }
    var lineAttributions by remember(activeTabKey, showBlame) { mutableStateOf<Map<Int, BlameLineAttribution>?>(null) }

    LaunchedEffect(activeTabKey, showBlame, activeTab?.content) {
        if (!showBlame || activeTab == null || blameRepo == null) {
            lineAttributions = null
            return@LaunchedEffect
        }
        lineAttributions = null
        val expectedKey = activeTab.key
        val expectedVersion = activeTab.modelVersion
        blameRepo.requestBlameDebounced(
            target = activeTab.target,
            path = activeTab.path,
            content = activeTab.content,
            snapshotId = "editor-${activeTab.key}",
            modelVersion = activeTab.modelVersion
        ) { res ->
            if (res is BlameValidator.ValidationResult.Valid &&
                showBlame &&
                activeTabKey == expectedKey &&
                tabsState.activeTab?.modelVersion == expectedVersion
            ) {
                lineAttributions = blameRepo.deriveLineAttributions(res.response)
            }
        }
    }
    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        EditorTopBar(
            tabs = tabs,
            activeTabKey = activeTabKey,
            onSelectTab = { tabsState.selectTab(it) },
            onCloseTab = { tabsState.closeTab(it) },
            onSave = { activeTabKey?.let { key -> coroutineScope.launch { tabsState.saveTab(key) } } },
            onUndo = { session?.undo() },
            onRedo = { session?.redo() },
            canUndo = session?.canUndo() == true,
            canRedo = session?.canRedo() == true,
            onToggleFind = {
                session?.let {
                    if (it.findReplaceState.isOpen) it.closeFindReplace() else it.openFindReplace()
                    findState = it.findReplaceState
                }
            },
            onToggleMarkdownPreview = { activeTabKey?.let { tabsState.toggleMarkdownPreview(it) } },
            onToggleBlame = { showBlame = !showBlame },
            showBlame = showBlame,
            onToggleEncrypted = { activeTabKey?.let { tabsState.toggleEncryptedSession(it) } }
        )
        // Find/Replace Bar
        if (session != null && findState.isOpen) {
            Column(modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(horizontal = 8.dp, vertical = 4.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = findState.searchQuery,
                        onValueChange = { session.setFindQuery(it); findState = session.findReplaceState },
                        placeholder = { Text("Find...", fontSize = 11.sp) },
                        modifier = Modifier.weight(1f).height(42.dp),
                        textStyle = TextStyle(fontSize = 12.sp, color = DamHopperColors.TextPrimary)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Button(onClick = { session.findNext(); findState = session.findReplaceState }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                        Text("Next", fontSize = 11.sp)
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    Button(onClick = { session.findPrevious(); findState = session.findReplaceState }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                        Text("Prev", fontSize = 11.sp)
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(text = "${if (findState.matches.isEmpty()) 0 else findState.currentMatchIndex + 1}/${findState.totalMatches}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = findState.replaceQuery,
                        onValueChange = { session.setReplaceQuery(it); findState = session.findReplaceState },
                        placeholder = { Text("Replace with...", fontSize = 11.sp) },
                        modifier = Modifier.weight(1f).height(42.dp),
                        textStyle = TextStyle(fontSize = 12.sp, color = DamHopperColors.TextPrimary)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Button(onClick = { session.replaceCurrent(); findState = session.findReplaceState }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) { Text("Replace", fontSize = 11.sp) }
                    Spacer(modifier = Modifier.width(4.dp))
                    Button(onClick = { session.replaceAll(); findState = session.findReplaceState }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) { Text("Replace All", fontSize = 11.sp) }
                }
            }
        }

        // Banners
        if (activeTab?.isLoading == true) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(horizontal = 12.dp, vertical = 4.dp)) {
                Text("⏳ Loading file from server...", style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
            }
        }

        if (activeTab?.error != null) {
            Row(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Error).padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(text = "⚠ ${activeTab.error}", style = DamHopperTypography.labelSmall, color = DamHopperColors.TextPrimary, modifier = Modifier.weight(1f))
                TextButton(onClick = { tabsState.dismissError(activeTab.key) }, contentPadding = PaddingValues(0.dp)) {
                    Text("Dismiss", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                }
            }
        }

        if (activeTab?.isStale == true) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Warning).padding(horizontal = 12.dp, vertical = 4.dp)) {
                Text("⚠ File modified on server while local buffer has unsaved changes.", style = DamHopperTypography.labelSmall, color = DamHopperColors.Background)
            }
        }

        if (activeTab != null && !activeTab.targetAvailable) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Error).padding(horizontal = 12.dp, vertical = 4.dp)) {
                Text("⚠ Project target unavailable. Local edits preserved.", style = DamHopperTypography.labelSmall, color = DamHopperColors.TextPrimary)
            }
        }

        // Main View
        if (activeTab == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No files open in editor.\nSelect a file from Files to edit.", style = DamHopperTypography.bodyMedium, color = DamHopperColors.TextSecondary)
            }
        } else when {
            activeTab.tier == FileTier.IMAGE || activeTab.tier == FileTier.VIDEO -> {
                MediaPreviewCard(
                    tab = activeTab,
                    onDownloadClicked = onDownloadMedia?.let { cb -> { cb(activeTab) } }
                )
            }
            activeTab.markdownPreviewMode && FileTierPolicy.isMarkdownFile(activeTab.path) -> {
                MarkdownPreviewView(markdownContent = activeTab.content)
            }
            activeTab.tier == FileTier.LARGE -> {
                LargeFileView(
                    tab = activeTab,
                    onPreviousChunk = {
                        coroutineScope.launch {
                            val newOffset = maxOf(0L, activeTab.largeFileOffset - FileTierPolicy.LARGE_CHUNK_BYTES)
                            tabsState.loadLargeFileRange(activeTab.key, newOffset)
                        }
                    },
                    onNextChunk = {
                        coroutineScope.launch {
                            val newOffset = activeTab.largeFileOffset + FileTierPolicy.LARGE_CHUNK_BYTES
                            tabsState.loadLargeFileRange(activeTab.key, newOffset)
                        }
                    }
                )
            }
            activeTab.tier == FileTier.BINARY -> {
                BinaryHexView(tab = activeTab)
            }
            else -> {
                NativeTextEditorView(
                    session = session,
                    content = activeTab.content,
                    onContentChange = { newText -> session?.setText(newText) },
                    lineAttributions = lineAttributions,
                    showBlameGutter = showBlame,
                    onInspectCommit = onInspectCommit
                )
            }
        }

        // Save Conflict Dialog
        if (activeTab?.isConflicted == true) {
            SaveConflictDialog(
                filename = activeTab.name,
                onReload = { coroutineScope.launch { tabsState.discardAndReloadTab(activeTab.key) } },
                onForceOverwrite = { coroutineScope.launch { tabsState.forceOverwriteTab(activeTab.key) } },
                onDismiss = { /* Leaves tab conflicted */ }
            )
        }
    }
}
