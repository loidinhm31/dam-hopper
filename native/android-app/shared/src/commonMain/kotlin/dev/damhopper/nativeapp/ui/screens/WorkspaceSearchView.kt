package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.files.SearchRepository
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

enum class WorkspaceSearchMode(val title: String, val minQueryLength: Int) {
    FILENAME("Find file", 1),
    TEXT("Search text", 2),
}

private data class SearchHit(val path: String, val line: ULong?, val text: String?)

/**
 * Inline workspace search over the existing current-owner project search endpoints (filename: `/api/fs/search-paths`,
 * text: `/api/fs/search`) for exactly [target] through [apiClient]. Results are fenced by the (mode, query,
 * target, client) key: a change of any of them cancels the in-flight request, so a late answer for another owner or
 * query can never be shown or opened. Opening a hit hands only the project-relative path to [onOpen].
 */
@Composable
fun WorkspaceSearchView(
    mode: WorkspaceSearchMode,
    target: ProjectTargetRef,
    apiClient: ApiClient,
    searchRepository: SearchRepository,
    onOpen: (path: String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember(mode, target, apiClient) { mutableStateOf("") }
    var hits by remember(mode, target, apiClient) { mutableStateOf<List<SearchHit>>(emptyList()) }
    var truncated by remember(mode, target, apiClient) { mutableStateOf(false) }
    var error by remember(mode, target, apiClient) { mutableStateOf<String?>(null) }
    var searching by remember(mode, target, apiClient) { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(mode, target, apiClient) { focus.requestFocus() }

    LaunchedEffect(mode, query, target, apiClient) {
        val trimmed = query.trim()
        if (trimmed.length < mode.minQueryLength) {
            hits = emptyList()
            truncated = false
            error = null
            searching = false
            return@LaunchedEffect
        }
        delay(250) // debounce typing; cancelled by the next key
        searching = true
        error = null
        try {
            when (mode) {
                WorkspaceSearchMode.FILENAME -> {
                    val response = searchRepository.searchPaths(apiClient, target, trimmed)
                    hits = response.matches.map { SearchHit(it.path, null, null) }
                    truncated = response.truncated
                }
                WorkspaceSearchMode.TEXT -> {
                    val response = searchRepository.searchContent(apiClient, target, trimmed)
                    hits = response.matches.map { SearchHit(it.path, it.line, it.text) }
                    truncated = response.truncated
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            hits = emptyList()
            error = e.message ?: "Search failed"
        } finally {
            searching = false
        }
    }

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text(mode.title) },
                singleLine = true,
                modifier = Modifier.weight(1f).focusRequester(focus),
            )
            TextButton(onClick = onClose, modifier = Modifier.sizeIn(minHeight = 48.dp)) { Text("Close") }
        }
        when {
            error != null -> Text(
                text = "Search failed: $error",
                color = DamHopperColors.Error,
                fontSize = 12.sp,
                modifier = Modifier.padding(12.dp),
            )
            searching -> Text("Searching...", color = DamHopperColors.TextSecondary, fontSize = 12.sp, modifier = Modifier.padding(12.dp))
            query.trim().length >= mode.minQueryLength && hits.isEmpty() ->
                Text("No matches.", color = DamHopperColors.TextSecondary, fontSize = 12.sp, modifier = Modifier.padding(12.dp))
        }
        if (truncated) {
            Text(
                text = "Showing the first results only; refine the query for more.",
                color = DamHopperColors.Warning,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
            )
        }
        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
            itemsIndexed(hits, key = { index, _ -> index }) { _, hit ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .sizeIn(minHeight = 48.dp)
                        .clickable { onOpen(hit.path) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(
                        text = if (hit.line != null) "${hit.path}:${hit.line}" else hit.path,
                        color = DamHopperColors.TextPrimary,
                        fontSize = 13.sp,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    hit.text?.let {
                        Text(
                            text = it.trim(),
                            color = DamHopperColors.TextSecondary,
                            fontSize = 11.sp,
                            fontFamily = JetBrainsMonoFontFamily,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
