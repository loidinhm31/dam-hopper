package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun SearchReplaceView(
    searchQuery: String,
    replaceQuery: String,
    caseSensitive: Boolean,
    isSearching: Boolean,
    searchResult: FederatedSearchResult?,
    replaceSummary: ReplacePreviewSummary?,
    batchResult: ReplaceBatchResult?,
    onSearchQueryChange: (String) -> Unit,
    onReplaceQueryChange: (String) -> Unit,
    onCaseSensitiveChange: (Boolean) -> Unit,
    onExecuteSearch: () -> Unit,
    onPreviewReplace: () -> Unit,
    onApplyReplace: () -> Unit,
    onMatchClick: (QualifiedSearchMatch) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().padding(8.dp)) {
        OutlinedTextField(
            value = searchQuery,
            onValueChange = onSearchQueryChange,
            label = { Text("Search text") },
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = DamHopperColors.TextPrimary,
                unfocusedTextColor = DamHopperColors.TextPrimary,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(4.dp))
        OutlinedTextField(
            value = replaceQuery,
            onValueChange = onReplaceQueryChange,
            label = { Text("Replace with (literal)") },
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = DamHopperColors.TextPrimary,
                unfocusedTextColor = DamHopperColors.TextPrimary,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(4.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = caseSensitive, onCheckedChange = onCaseSensitiveChange)
                Text("Case sensitive", style = DamHopperTypography.bodyMedium, color = DamHopperColors.TextSecondary)
            }
            Row {
                Button(
                    onClick = onExecuteSearch,
                    enabled = searchQuery.isNotBlank() && !isSearching,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                ) {
                    Text(if (isSearching) "Searching…" else "Search")
                }
                Spacer(modifier = Modifier.width(6.dp))
                Button(
                    onClick = onPreviewReplace,
                    enabled = searchResult != null && searchResult.matches.isNotEmpty() && !searchResult.isTruncated,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                ) {
                    Text("Preview")
                }
            }
        }

        if (replaceSummary != null) {
            Spacer(modifier = Modifier.height(6.dp))
            ReplacePreviewCard(replaceSummary = replaceSummary, onApplyReplace = onApplyReplace)
        }

        if (searchResult != null) {
            Spacer(modifier = Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "${searchResult.matches.size} matches in ${searchResult.profileCount} profile(s)",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                )
                if (searchResult.isTruncated) {
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "⚠ Truncated at 500 cap — Replace disabled",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Warning,
                    )
                }
            }
        }

        if (batchResult != null) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Replaced: ${batchResult.replacedFilesCount} | Skipped dirty: ${batchResult.skippedDirtyCount} | Conflicts: ${batchResult.conflictCount} | Failed: ${batchResult.failureCount}",
                style = DamHopperTypography.labelSmall,
                color = if (batchResult.failureCount > 0 || batchResult.conflictCount > 0) DamHopperColors.Warning else DamHopperColors.Success,
            )
        }

        Spacer(modifier = Modifier.height(6.dp))

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            if (searchResult != null) {
                items(searchResult.matches) { match ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(DamHopperColors.Surface)
                            .clickable { onMatchClick(match) }
                            .padding(vertical = 4.dp, horizontal = 6.dp),
                    ) {
                        Text(
                            text = "[${match.profileId}] ${match.target.project} • ${match.path}:${match.line}:${match.col}",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.Primary,
                        )
                        Text(
                            text = match.text.trim(),
                            style = DamHopperTypography.bodyMedium,
                            color = DamHopperColors.TextSecondary,
                        )
                    }
                    Spacer(modifier = Modifier.height(2.dp))
                }
            }
        }
    }
}
