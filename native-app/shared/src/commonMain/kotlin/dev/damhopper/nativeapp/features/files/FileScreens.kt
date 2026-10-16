package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

enum class FilesSubTab {
    EXPLORER,
    SEARCH_REPLACE,
}

/**
 * Files panel container rendering the file tree explorer, action modals,
 * and search/replace within the single authoritative content area.
 */
@Composable
fun FilesPanelScreen(
    treeState: FileTreeState,
    mutationCoordinator: FileMutationCoordinator,
    searchRepo: SearchRepository,
    replaceCoordinator: ReplaceCoordinator,
    bindings: List<ProfileTargetBinding>,
    onOpenFile: (target: ProjectTargetRef, path: String) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier,
) {
    val coroutineScope = rememberCoroutineScope()
    var activeSubTab by remember { mutableStateOf(FilesSubTab.EXPLORER) }

    val rootNode by treeState.root.collectAsState()
    val selectedPath by treeState.selectedPath.collectAsState()
    val showHidden by treeState.showHidden.collectAsState()
    val error by treeState.error.collectAsState()

    var showCreateFileDialog by remember { mutableStateOf(false) }
    var showCreateDirDialog by remember { mutableStateOf(false) }
    var showRenameDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    var searchQuery by remember { mutableStateOf("") }
    var replaceQuery by remember { mutableStateOf("") }
    var caseSensitive by remember { mutableStateOf(false) }
    var isSearching by remember { mutableStateOf(false) }
    var searchResult by remember { mutableStateOf<FederatedSearchResult?>(null) }
    var replaceSummary by remember { mutableStateOf<ReplacePreviewSummary?>(null) }
    var batchResult by remember { mutableStateOf<ReplaceBatchResult?>(null) }

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        FilesTopBar(
            activeSubTab = activeSubTab,
            selectedPath = selectedPath,
            showHidden = showHidden,
            onSelectSubTab = { activeSubTab = it },
            onToggleShowHidden = { treeState.setShowHidden(!showHidden) },
            onCreateFile = { showCreateFileDialog = true },
            onCreateDir = { showCreateDirDialog = true },
            onRename = { if (selectedPath != null) showRenameDialog = true },
            onDelete = { if (selectedPath != null) showDeleteDialog = true },
        )

        when (activeSubTab) {
            FilesSubTab.EXPLORER -> {
                if (error != null) {
                    Text(
                        text = "Notice: $error",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Warning,
                        modifier = Modifier.padding(8.dp),
                    )
                }
                val visibleNodes = remember(rootNode, showHidden) {
                    FileTreeHelpers.flattenVisibleNodes(rootNode, showHidden = showHidden)
                }
                LazyColumn(modifier = Modifier.fillMaxSize().padding(4.dp)) {
                    items(visibleNodes, key = { it.first.path }) { (node, depth) ->
                        FileTreeNodeRow(
                            node = node,
                            depth = depth,
                            isSelected = selectedPath == node.path,
                            onToggleFolder = { treeState.toggleFolder(it) },
                            onSelectNode = { path ->
                                treeState.selectPath(path)
                                if (!node.isDirectory) {
                                    onOpenFile(treeState.target, path)
                                }
                            },
                        )
                    }
                }
            }

            FilesSubTab.SEARCH_REPLACE -> {
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

    FileModalsHost(
        rootNode = rootNode,
        selectedPath = selectedPath,
        showCreateFileDialog = showCreateFileDialog,
        showCreateDirDialog = showCreateDirDialog,
        showRenameDialog = showRenameDialog,
        showDeleteDialog = showDeleteDialog,
        onDismissCreateFile = { showCreateFileDialog = false },
        onDismissCreateDir = { showCreateDirDialog = false },
        onDismissRename = { showRenameDialog = false },
        onDismissDelete = { showDeleteDialog = false },
        mutationCoordinator = mutationCoordinator,
        coroutineScope = coroutineScope,
    )
}
