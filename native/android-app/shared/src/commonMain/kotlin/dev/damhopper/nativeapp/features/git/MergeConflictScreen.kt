package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

@Composable
fun MergeConflictScreen(
    controller: MergeConflictController,
    onResolved: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val coroutineScope = rememberCoroutineScope()
    val files by controller.conflictFiles.collectAsState()
    val selectedFile by controller.selectedFile.collectAsState()
    val regions by controller.currentRegions.collectAsState()
    val selectedIdx by controller.selectedConflictIndex.collectAsState()
    val resultContent by controller.resultContent.collectAsState()
    val theirsContent by controller.theirsContent.collectAsState()
    val oursContent by controller.oursContent.collectAsState()
    val ancestorContent by controller.ancestorContent.collectAsState()
    val allResolved by controller.allResolved.collectAsState()
    val isMalformed by controller.isMalformed.collectAsState()
    val isLoading by controller.isLoading.collectAsState()
    val isResolving by controller.isResolving.collectAsState()
    val resolveError by controller.resolveError.collectAsState()
    var activePane by remember { mutableStateOf("Result") }

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Files Strip
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = "Files (${files.size}):", fontSize = 11.sp, color = DamHopperColors.TextSecondary, modifier = Modifier.padding(end = 4.dp))
            files.forEach { file ->
                val isSel = file.path == selectedFile?.path
                Box(
                    modifier = Modifier.padding(horizontal = 2.dp)
                        .background(if (isSel) DamHopperColors.SurfaceVariant else DamHopperColors.Surface, RoundedCornerShape(4.dp))
                        .border(1.dp, if (isSel) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(4.dp))
                        .clickable { controller.selectFile(file) }
                        .padding(horizontal = 6.dp, vertical = 3.dp)
                ) {
                    Text(text = file.path.substringAfterLast('/'), fontSize = 11.sp, color = if (isSel) DamHopperColors.Primary else DamHopperColors.TextPrimary)
                }
            }
        }
        HorizontalDivider(color = DamHopperColors.Border, thickness = 1.dp)

        // Actions Toolbar (Zero FABs)
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = if (regions.isNotEmpty()) "${selectedIdx + 1}/${regions.size}" else "0 conflicts", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
            Spacer(modifier = Modifier.width(4.dp))
            Button(onClick = { if (selectedIdx > 0) controller.selectConflictIndex(selectedIdx - 1) }, enabled = selectedIdx > 0, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp)) {
                Text("<", fontSize = 11.sp)
            }
            Spacer(modifier = Modifier.width(2.dp))
            Button(onClick = { if (selectedIdx < regions.size - 1) controller.selectConflictIndex(selectedIdx + 1) }, enabled = selectedIdx < regions.size - 1, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp)) {
                Text(">", fontSize = 11.sp)
            }
            Spacer(modifier = Modifier.width(4.dp))
            Button(onClick = { controller.acceptCurrentConflict(ConflictSide.OURS) }, enabled = regions.isNotEmpty(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                Text("Ours", fontSize = 11.sp)
            }
            Spacer(modifier = Modifier.width(2.dp))
            Button(onClick = { controller.acceptCurrentConflict(ConflictSide.THEIRS) }, enabled = regions.isNotEmpty(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                Text("Theirs", fontSize = 11.sp)
            }
            if (ancestorContent != null) {
                Spacer(modifier = Modifier.width(2.dp))
                Button(onClick = { controller.acceptCurrentConflict(ConflictSide.ANCESTOR) }, enabled = regions.isNotEmpty(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                    Text("Base", fontSize = 11.sp)
                }
            }
            Spacer(modifier = Modifier.width(2.dp))
            Button(onClick = { controller.acceptCurrentConflict(ConflictSide.BOTH_OURS_FIRST) }, enabled = regions.isNotEmpty(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                Text("Both", fontSize = 11.sp)
            }
            Spacer(modifier = Modifier.width(4.dp))
            Button(onClick = { controller.acceptAllConflicts(ConflictSide.OURS) }, enabled = regions.isNotEmpty(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                Text("All Ours", fontSize = 11.sp)
            }
            Spacer(modifier = Modifier.width(2.dp))
            Button(onClick = { controller.acceptAllConflicts(ConflictSide.THEIRS) }, enabled = regions.isNotEmpty(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
                Text("All Theirs", fontSize = 11.sp)
            }
            Spacer(modifier = Modifier.width(6.dp))
            Button(
                onClick = {
                    coroutineScope.launch {
                        val res = controller.markResolved()
                        if (res.isSuccess) onResolved()
                    }
                },
                enabled = allResolved && !isMalformed && !isResolving && !isLoading,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
            ) {
                Text(if (isResolving) "Resolving..." else "Mark Resolved", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
            }
        }
        HorizontalDivider(color = DamHopperColors.Border, thickness = 1.dp)

        // Banners
        if (isMalformed) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Warning).padding(6.dp)) {
                Text("⚠ Malformed conflict markers detected. Manual resolution required.", fontSize = 11.sp, color = DamHopperColors.Background)
            }
        }
        if (allResolved && !isMalformed) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Success.copy(alpha = 0.2f)).padding(6.dp)) {
                Text("✔ All conflicts resolved. Tap 'Mark Resolved' to stage and complete.", fontSize = 11.sp, color = DamHopperColors.Success)
            }
        }
        if (resolveError != null) {
            Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Error).padding(6.dp)) {
                Text("⚠ $resolveError", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
            }
        }

        val panes = remember(ancestorContent) {
            val list = mutableListOf("Result (Editable)" to "Result", "Theirs (Incoming)" to "Theirs", "Ours (HEAD)" to "Ours")
            if (ancestorContent != null) list.add("Ancestor (Base)" to "Ancestor")
            list
        }
        Row(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(horizontal = 6.dp, vertical = 2.dp)) {
            panes.forEach { (label, key) ->
                val isSel = activePane == key
                Text(
                    text = label,
                    fontSize = 11.sp,
                    color = if (isSel) DamHopperColors.Primary else DamHopperColors.TextSecondary,
                    modifier = Modifier.clickable { activePane = key }.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }
        HorizontalDivider(color = DamHopperColors.Border, thickness = 1.dp)

        // Content Area
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (activePane) {
                "Theirs" -> ConflictReadonlyPane(theirsContent)
                "Ours" -> ConflictReadonlyPane(oursContent)
                "Ancestor" -> ConflictReadonlyPane(ancestorContent ?: "")
                else -> {
                    TextField(
                        value = resultContent,
                        onValueChange = { controller.updateResultContent(it) },
                        modifier = Modifier.fillMaxSize(),
                        textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DamHopperColors.TextPrimary),
                        colors = TextFieldDefaults.colors(focusedContainerColor = DamHopperColors.Background, unfocusedContainerColor = DamHopperColors.Background)
                    )
                }
            }
        }
    }
}

@Composable
private fun ConflictReadonlyPane(content: String) {
    Box(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(8.dp)) {
        Text(text = content.ifEmpty { "(Empty)" }, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DamHopperColors.TextSecondary)
    }
}
