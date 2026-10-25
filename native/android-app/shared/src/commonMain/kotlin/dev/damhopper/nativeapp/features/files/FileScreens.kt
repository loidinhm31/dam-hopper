package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import dev.damhopper.nativeapp.features.settings.ExplorerLanguageFilter
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

enum class FilesSubTab {
    EXPLORER,
    SEARCH_REPLACE,
}

/**
 * Focused workspace entry point for the Files explorer.
 * Exposes only approved explorer actions and hides project-wide search/replace and transfer.
 */
@Composable
fun FocusedFilesExplorerScreen(
    treeState: FileTreeState,
    mutationCoordinator: FileMutationCoordinator,
    onOpenFile: (target: ProjectTargetRef, path: String) -> Unit = { _, _ -> },
    onCopyRemotePath: ((String) -> Unit)? = null,
    onSelectLanguageFilter: ((ExplorerLanguageFilter) -> Unit)? = null,
    languageFilterNotice: String? = null,
    modifier: Modifier = Modifier,
) {
    FilesPanelScreen(
        treeState = treeState,
        mutationCoordinator = mutationCoordinator,
        searchRepo = null,
        replaceCoordinator = null,
        bindings = emptyList(),
        onOpenFile = onOpenFile,
        modifier = modifier,
        focusedWorkspaceMode = true,
        onCopyRemotePath = onCopyRemotePath,
        onSelectLanguageFilter = onSelectLanguageFilter,
        languageFilterNotice = languageFilterNotice,
    )
}

/**
 * Files panel container rendering the file tree explorer, inline action modals,
 * and (when not in [focusedWorkspaceMode]) dormant search/replace for Workbench.
 */
@Composable
fun FilesPanelScreen(
    treeState: FileTreeState,
    mutationCoordinator: FileMutationCoordinator,
    searchRepo: SearchRepository? = null,
    replaceCoordinator: ReplaceCoordinator? = null,
    bindings: List<ProfileTargetBinding> = emptyList(),
    onOpenFile: (target: ProjectTargetRef, path: String) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier,
    focusedWorkspaceMode: Boolean = false,
    onCopyRemotePath: ((String) -> Unit)? = null,
    onSelectLanguageFilter: ((ExplorerLanguageFilter) -> Unit)? = null,
    languageFilterNotice: String? = null,
) {
    val coroutineScope = rememberCoroutineScope()
    val clipboardManager = LocalClipboardManager.current
    var activeSubTab by remember { mutableStateOf(FilesSubTab.EXPLORER) }
    var contextMenuNode by remember { mutableStateOf<FileTreeNode?>(null) }
    val transferHost = LocalFileTransferPlatformHost.current
    val rootNode by treeState.root.collectAsState()
    val selectedPath by treeState.selectedPath.collectAsState()
    val showHidden by treeState.showHidden.collectAsState()
    val isLoading by treeState.isLoading.collectAsState()
    val error by treeState.error.collectAsState()
    val refreshWarning by treeState.refreshWarning.collectAsState()
    val connectionStatus by treeState.connectionStatus.collectAsState()
    val scrollIndex by treeState.scrollIndex.collectAsState()
    val scrollOffset by treeState.scrollOffset.collectAsState()
    val languageFilter by treeState.languageFilter.collectAsState()
    val languageScan by treeState.languageScan.collectAsState()
    val familyActive = languageFilter != ExplorerLanguageFilter.ALL

    val isMutating by mutationCoordinator.isMutating.collectAsState()
    val unresolvedOperations by mutationCoordinator.unresolvedOperations.collectAsState()
    val feedbackNotice by mutationCoordinator.lastFeedbackNotice.collectAsState()

    var searchQuery by remember { mutableStateOf("") }
    var replaceQuery by remember { mutableStateOf("") }
    var caseSensitive by remember { mutableStateOf(false) }
    var isSearching by remember { mutableStateOf(false) }
    var searchResult by remember { mutableStateOf<FederatedSearchResult?>(null) }
    var replaceSummary by remember { mutableStateOf<ReplacePreviewSummary?>(null) }
    var batchResult by remember { mutableStateOf<ReplaceBatchResult?>(null) }

    val isWriteReady by treeState.isWriteReady.collectAsState()
    val canMutate = connectionStatus == ExplorerConnectionStatus.CONNECTED && isWriteReady
    val isSelectionUnresolved = remember(selectedPath, unresolvedOperations) {
        selectedPath?.let { mutationCoordinator.isPathUnresolved(it) } ?: false
    }

    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = scrollIndex,
        initialFirstVisibleItemScrollOffset = scrollOffset,
    )

    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .distinctUntilChanged()
            .collect { (idx, off) ->
                treeState.updateScrollPosition(idx, off)
            }
    }

    val effectiveSubTab = if (focusedWorkspaceMode) FilesSubTab.EXPLORER else activeSubTab

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        FilesTopBar(
            activeSubTab = effectiveSubTab,
            selectedPath = selectedPath,
            showHidden = showHidden,
            onSelectSubTab = { if (!focusedWorkspaceMode) activeSubTab = it },
            onToggleShowHidden = { treeState.setShowHidden(!showHidden) },
            onCreateFile = { mutationCoordinator.openCreateFileDialog() },
            onCreateDir = { mutationCoordinator.openCreateDirectoryDialog() },
            onRename = { if (selectedPath != null) mutationCoordinator.openRenameDialog(selectedPath) },
            onDelete = { if (selectedPath != null) mutationCoordinator.openDeleteDialog(selectedPath) },
            onMove = { if (selectedPath != null) mutationCoordinator.openMoveDialog(selectedPath) },
            onRefresh = { treeState.refresh() },
            onCopyPath = {
                mutationCoordinator.copyRemotePath(selectedPath) { remotePath ->
                    clipboardManager.setText(AnnotatedString(remotePath))
                    onCopyRemotePath?.invoke(remotePath)
                }
            },
            focusedWorkspaceMode = focusedWorkspaceMode,
            isMutating = isMutating,
            canMutate = canMutate,
            isSelectionUnresolved = isSelectionUnresolved,
        )

        when (effectiveSubTab) {
            FilesSubTab.EXPLORER -> {
                LanguageFilterRow(
                    selected = languageFilter,
                    onSelect = onSelectLanguageFilter,
                    migrationNotice = languageFilterNotice,
                )
                if (connectionStatus == ExplorerConnectionStatus.TARGET_UNAVAILABLE) {
                    Text(
                        text = "Target unavailable: project/worktree does not match active workspace authority.",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Error,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                } else if (connectionStatus == ExplorerConnectionStatus.DISCONNECTED) {
                    Text(
                        text = "WebSocket disconnected — live directory watch and remote mutations require an active connection.",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Warning,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }

                if (unresolvedOperations.isNotEmpty()) {
                    unresolvedOperations.forEach { op ->
                        Text(
                            text = "Unresolved ${op.operation} on '${op.sourcePath}' (${op.stage}): ${op.message}. Retry is disabled until server state is reconciled.",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.Warning,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }

                if (error != null) {
                    Text(
                        text = "Notice: $error",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Warning,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }

                if (refreshWarning != null) {
                    Text(
                        text = refreshWarning!!,
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Warning,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }

                if (feedbackNotice != null) {
                    Text(
                        text = feedbackNotice!!,
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Success,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }

                if (isLoading && !familyActive) {
                    Text(
                        text = "Loading directory...",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }

                if (familyActive) {
                    val familyLabel = languageFilterLabel(languageFilter)
                    when (languageScan.status) {
                        LanguageScanStatus.LOADING -> Text(
                            text = "Scanning the project for $familyLabel files...",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.TextSecondary,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                        LanguageScanStatus.FAILED -> Text(
                            text = "$familyLabel scan failed: ${languageScan.error ?: "unknown error"}. Use Refresh to retry; the ordinary tree is unaffected.",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.Warning,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                        LanguageScanStatus.READY -> if (languageScan.truncated) {
                            Text(
                                text = "Partial result: the scan stopped at ${languageScan.limit} files, so some $familyLabel files may be missing.",
                                style = DamHopperTypography.labelSmall,
                                color = DamHopperColors.Warning,
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                        LanguageScanStatus.IDLE -> Unit
                    }
                }

                val displayRoot = if (familyActive) languageScan.tree else rootNode
                val visibleNodes = remember(displayRoot, showHidden) {
                    displayRoot?.let { FileTreeHelpers.flattenVisibleNodes(it, showHidden = showHidden) } ?: emptyList()
                }

                val showEmpty = if (familyActive) {
                    languageScan.status == LanguageScanStatus.READY && visibleNodes.isEmpty()
                } else {
                    !isLoading && error == null && visibleNodes.isEmpty()
                }
                if (showEmpty) {
                    val emptyText = if (familyActive) {
                        if (!showHidden && (displayRoot?.children?.isNotEmpty() == true)) {
                            "No visible ${languageFilterLabel(languageFilter)} files (enable 'Show .' to view hidden files)."
                        } else {
                            "No ${languageFilterLabel(languageFilter)} files in this project."
                        }
                    } else if (!showHidden && rootNode.children.isNotEmpty()) {
                        "No visible items (enable 'Show .' to view hidden files)."
                    } else {
                        "Directory is empty."
                    }
                    Text(
                        text = emptyText,
                        style = DamHopperTypography.bodyMedium,
                        color = DamHopperColors.TextSecondary,
                        modifier = Modifier.padding(16.dp),
                    )
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize().padding(4.dp),
                    ) {
                        items(visibleNodes, key = { it.first.path }) { (node, depth) ->
                            FileTreeNodeRow(
                                node = node,
                                depth = depth,
                                isSelected = selectedPath == node.path,
                                isUnresolved = mutationCoordinator.isPathUnresolved(node.path),
                                onToggleFolder = { if (!familyActive) treeState.toggleFolder(it) },
                                onSelectNode = { path ->
                                    treeState.selectPath(path)
                                    if (!node.isDirectory) {
                                        onOpenFile(treeState.target, path)
                                    }
                                },
                                onHoldNode = { node ->
                                    treeState.selectPath(node.path)
                                    contextMenuNode = node
                                },
                            )
                        }
                    }
                }
            }

            FilesSubTab.SEARCH_REPLACE -> {
                if (!focusedWorkspaceMode && searchRepo != null && replaceCoordinator != null) {
                    SearchReplaceView(
                        searchQuery = searchQuery,
                        replaceQuery = replaceQuery,
                        caseSensitive = caseSensitive,
                        isSearching = isSearching,
                        searchResult = searchResult,
                        replaceSummary = replaceSummary,
                        batchResult = batchResult,
                        onSearchQueryChange = {
                            searchQuery = it
                            replaceSummary = null
                        },
                        onReplaceQueryChange = {
                            replaceQuery = it
                            replaceSummary = null
                        },
                        onCaseSensitiveChange = {
                            caseSensitive = it
                            replaceSummary = null
                        },
                        onExecuteSearch = {
                            coroutineScope.launch {
                                isSearching = true
                                batchResult = null
                                replaceSummary = null
                                searchResult = searchRepo.federateContentSearch(
                                    bindings = bindings,
                                    query = searchQuery,
                                    caseSensitive = caseSensitive,
                                )
                                isSearching = false
                            }
                        },
                        onPreviewReplace = {
                            coroutineScope.launch {
                                val res = searchResult ?: return@launch
                                replaceSummary = replaceCoordinator.preview(
                                    matches = res.matches,
                                    searchQuery = res.query,
                                    replaceQuery = replaceQuery,
                                    caseSensitive = res.caseSensitive,
                                    isSearchTruncated = res.isTruncated,
                                )
                            }
                        },
                        onApplyReplace = {
                            coroutineScope.launch {
                                val summary = replaceSummary ?: return@launch
                                batchResult = replaceCoordinator.applyBatch(summary)
                                searchResult = searchRepo.federateContentSearch(
                                    bindings = bindings,
                                    query = summary.searchQuery,
                                    caseSensitive = summary.caseSensitive,
                                )
                                replaceSummary = null
                            }
                        },
                        onMatchClick = { match ->
                            onOpenFile(match.target, match.path)
                        },
                    )
                }
            }
        }
    }

    FileModalsHost(
        rootNode = rootNode,
        selectedPath = selectedPath,
        mutationCoordinator = mutationCoordinator,
        coroutineScope = coroutineScope,
        showHidden = showHidden,
    )

    contextMenuNode?.let { node ->
        FileItemActionsModal(
            node = node,
            onDismiss = { contextMenuNode = null },
            onRename = { path ->
                mutationCoordinator.openRenameDialog(path)
            },
            onDelete = { path ->
                mutationCoordinator.openDeleteDialog(path)
            },
            onNewFile = { parentDir ->
                mutationCoordinator.openCreateFileDialog(parentDir)
            },
            onNewFolder = { parentDir ->
                mutationCoordinator.openCreateDirectoryDialog(parentDir)
            },
            onUploadFile = transferHost?.let { host ->
                { targetDir -> host.onUploadFile(targetDir) }
            },
            onDownloadFile = transferHost?.let { host ->
                { path, filename -> host.onDownloadFile(path, filename) }
            },
            onCopyRelativePath = { path ->
                clipboardManager.setText(AnnotatedString(path))
                mutationCoordinator.clearFeedbackNotice()
            },
            onCopyRemotePath = { path ->
                mutationCoordinator.copyRemotePath(path) { remotePath ->
                    clipboardManager.setText(AnnotatedString(remotePath))
                    onCopyRemotePath?.invoke(remotePath)
                }
            }
        )
    }
}

/** User-facing family name of an Explorer language filter. */
fun languageFilterLabel(filter: ExplorerLanguageFilter): String = when (filter) {
    ExplorerLanguageFilter.ALL -> "All"
    ExplorerLanguageFilter.RUST -> "Rust"
    ExplorerLanguageFilter.JAVASCRIPT_TYPESCRIPT -> "JS/TS"
    ExplorerLanguageFilter.JAVA -> "Java"
}

/**
 * Explorer language-family selector (all / rust / javascript-typescript / java). [onSelect] null renders the
 * current value read-only. [migrationNotice] is the explicit, non-dirty note that a legacy local filter fell back
 * to All (it is never saved to a server automatically; only an explicit choice here writes a real value).
 */
@Composable
private fun LanguageFilterRow(
    selected: ExplorerLanguageFilter,
    onSelect: ((ExplorerLanguageFilter) -> Unit)?,
    migrationNotice: String?,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ExplorerLanguageFilter.entries.forEach { entry ->
                FilterChip(
                    selected = entry == selected,
                    enabled = onSelect != null,
                    onClick = { onSelect?.invoke(entry) },
                    label = { Text(languageFilterLabel(entry)) },
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                )
            }
        }
        if (migrationNotice != null) {
            Text(
                text = migrationNotice,
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.Warning,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
}
