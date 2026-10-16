package dev.damhopper.nativeapp.features.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.features.editor.MarkdownPreviewView
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Screen for the Agent Memory management sub-product.
 * Manages project CLAUDE.md / GEMINI.md memory files, template previews, and safe saves.
 */
@Composable
fun AgentMemoryView(
    controller: AgentMemoryController,
    modifier: Modifier = Modifier
) {
    val state by controller.state.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // 1. Target Selector Top Bar (Project + Agent + Status)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Agent Selector (Claude vs Gemini)
                Row(
                    modifier = Modifier
                        .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                        .padding(2.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    AgentType.entries.forEach { agent ->
                        val isSel = state.selectedAgent == agent
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(3.dp))
                                .background(if (isSel) DamHopperColors.Primary else Color.Transparent)
                                .clickable {
                                    state.selectedProject?.let { proj ->
                                        controller.requestTargetSwitch(proj, agent)
                                    }
                                }
                                .padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = agent.wireName.replaceFirstChar { it.uppercase() },
                                fontSize = 11.sp,
                                fontWeight = if (isSel) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSel) Color.Black else DamHopperColors.TextPrimary
                            )
                        }
                    }
                }

                // Status Chips: Dirty, Saving, Saved, Error
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (state.isDirty) {
                        Box(
                            modifier = Modifier
                                .background(DamHopperColors.Warning.copy(alpha = 0.2f), RoundedCornerShape(3.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text("● Unsaved Draft", color = DamHopperColors.Warning, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }

                    when (state.saveStatus) {
                        MemorySaveStatus.SAVED -> {
                            Text("✓ Saved", color = DamHopperColors.Secondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        MemorySaveStatus.ERROR -> {
                            Text("✗ Save Failed", color = DamHopperColors.Error, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        MemorySaveStatus.IDLE -> {}
                    }

                    // Save Button
                    val isTargetLoaded = state.selectedProject != null &&
                        state.loadedProject == state.selectedProject &&
                        state.loadedAgent == state.selectedAgent
                    Button(
                        onClick = { controller.saveMemory() },
                        enabled = !state.isSaving && !state.isLoading && state.error == null && isTargetLoaded,
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        if (state.isSaving) {
                            CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(14.dp))
                        } else {
                            Text("Save", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // Project Selector Chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (state.projects.isEmpty()) {
                    Text("No projects discovered in workspace", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                } else {
                    state.projects.forEach { proj ->
                        val isSel = state.selectedProject == proj
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(if (isSel) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                                .clickable { controller.requestTargetSwitch(proj, state.selectedAgent) }
                                .padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = proj,
                                fontSize = 11.sp,
                                fontWeight = if (isSel) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSel) Color.Black else DamHopperColors.TextPrimary
                            )
                        }
                    }
                }
            }
        }

        // 2. Template Bar (Template Selector + Preview Button)
        if (state.templates.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.5f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Template:", fontSize = 11.sp, color = DamHopperColors.TextSecondary)

                Row(
                    modifier = Modifier
                        .weight(1f)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    state.templates.forEach { tmpl ->
                        val isSel = state.selectedTemplateName == tmpl.name
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(3.dp))
                                .background(if (isSel) DamHopperColors.Primary.copy(alpha = 0.3f) else DamHopperColors.Surface)
                                .border(1.dp, if (isSel) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(3.dp))
                            .clickable { controller.selectTemplate(tmpl.name) }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            Text(tmpl.name, fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                        }
                    }
                }

                Button(
                    onClick = {
                        state.selectedTemplateName?.let { controller.applyTemplatePreview(it) }
                    },
                    enabled = state.selectedTemplateName != null && !state.isApplyingTemplate,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    if (state.isApplyingTemplate) {
                        CircularProgressIndicator(color = DamHopperColors.Primary, modifier = Modifier.size(12.dp))
                    } else {
                        Text("Preview", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            }
        }

        // Error message if any
        state.error?.let { err ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Error.copy(alpha = 0.2f))
                    .padding(6.dp)
            ) {
                Text(text = err, color = DamHopperColors.Error, fontSize = 11.sp)
            }
        }

        // 3. Editor Content Area
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            if (state.isLoading) {
                CircularProgressIndicator(
                    color = DamHopperColors.Primary,
                    modifier = Modifier.size(32.dp).align(Alignment.Center)
                )
            } else if (state.selectedProject == null) {
                Text(
                    text = "No project selected",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                    modifier = Modifier.align(Alignment.Center)
                )
            } else {
                // Multi-line editor
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(DamHopperColors.Surface, RoundedCornerShape(4.dp))
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
                        .padding(10.dp)
                ) {
                    if (state.content.isEmpty()) {
                        Text(
                            text = "Memory file is currently empty (${if (state.selectedAgent == AgentType.CLAUDE) "CLAUDE.md" else "GEMINI.md"}). Type to add instructions or apply a template above.",
                            color = DamHopperColors.TextSecondary.copy(alpha = 0.6f),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                    BasicTextField(
                        value = state.content,
                        onValueChange = { controller.updateContent(it) },
                        textStyle = TextStyle(
                            color = DamHopperColors.TextPrimary,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            lineHeight = 18.sp
                        ),
                        cursorBrush = SolidColor(DamHopperColors.Primary),
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }

        // 4. Footer info bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            val lines = if (state.content.isEmpty()) 0 else state.content.lines().size
            val chars = state.content.length
            Text(
                text = "${if (state.selectedAgent == AgentType.CLAUDE) "CLAUDE.md" else "GEMINI.md"} • $lines line(s) • $chars char(s)",
                fontSize = 10.sp,
                color = DamHopperColors.TextSecondary,
                fontFamily = FontFamily.Monospace
            )

            if (state.isDirty) {
                TextButton(
                    onClick = { controller.loadMemory(state.selectedProject ?: "", state.selectedAgent) },
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text("Revert Changes", fontSize = 10.sp, color = DamHopperColors.Error)
                }
            }
        }
    }

    // 5. Template Preview Dialog
    state.previewContent?.let { previewText ->
        TemplatePreviewDialog(
            templateName = state.selectedTemplateName ?: "Template",
            previewContent = previewText,
            onSaveAsMemory = { controller.savePreviewAsMemory() },
            onAdoptIntoEditor = { controller.requestAdoptPreview() },
            onDiscard = { controller.requestDiscardPreview() }
        )
    }

    // 6. Target Switch Confirmation Dialog (Unsaved changes protection)
    state.pendingTargetSwitch?.let { target ->
        AlertDialog(
            onDismissRequest = { controller.cancelTargetSwitch() },
            title = { Text("Unsaved Changes", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "You have unsaved changes in your current memory draft. Switching to ${target.first} (${target.second.wireName}) will discard these edits.",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = { controller.confirmTargetSwitch() },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Discard and Switch", color = Color.White)
                }
            },
            dismissButton = {
                TextButton(onClick = { controller.cancelTargetSwitch() }) {
                    Text("Keep Editing", color = DamHopperColors.TextSecondary)
                }
            },
            containerColor = DamHopperColors.Surface
        )
    }

    // 7. Discard Edited Preview Confirmation Dialog
    if (state.showDiscardPreviewConfirm) {
        AlertDialog(
            onDismissRequest = { controller.cancelDiscardPreview() },
            title = { Text("Discard Preview Edits", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "Discard your edits to this template preview?",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = { controller.confirmDiscardPreview() },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Discard", color = Color.White)
                }
            },
            dismissButton = {
                TextButton(onClick = { controller.cancelDiscardPreview() }) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
            },
            containerColor = DamHopperColors.Surface
        )
    }
    // 8. Overwrite Draft Confirmation Dialog for Template Adoption
    if (state.showOverwriteDraftConfirmForPreview) {
        AlertDialog(
            onDismissRequest = { controller.cancelAdoptPreview() },
            title = { Text("Overwrite Unsaved Draft", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "Adopting this template preview will replace your current unsaved edits in the memory editor.",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = { controller.confirmAdoptPreview() },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Overwrite Draft", color = Color.White)
                }
            },
            dismissButton = {
                TextButton(onClick = { controller.cancelAdoptPreview() }) {
                    Text("Keep Draft", color = DamHopperColors.TextSecondary)
                }
            },
            containerColor = DamHopperColors.Surface
        )
    }
}

/**
 * Modal dialog for inspecting and applying template output.
 * Crucial invariant: Renders with MarkdownPreviewView without active HTML/Mermaid engines.
 */
@Composable
fun TemplatePreviewDialog(
    templateName: String,
    previewContent: String,
    onSaveAsMemory: () -> Unit,
    onAdoptIntoEditor: () -> Unit,
    onDiscard: () -> Unit
) {
    Dialog(onDismissRequest = onDiscard) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.85f)
                .background(DamHopperColors.Surface, RoundedCornerShape(8.dp))
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Template Preview: $templateName",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = DamHopperColors.TextPrimary
                    )
                    Text(
                        text = "Preview only. Not saved to server until confirmed.",
                        fontSize = 10.sp,
                        color = DamHopperColors.TextSecondary
                    )
                }
            }

            HorizontalDivider(color = DamHopperColors.Border, modifier = Modifier.padding(vertical = 8.dp))

            // Markdown preview
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(DamHopperColors.Background, RoundedCornerShape(4.dp))
                    .padding(8.dp)
            ) {
                MarkdownPreviewView(
                    markdownContent = previewContent,
                    modifier = Modifier.fillMaxSize()
                )
            }

            HorizontalDivider(color = DamHopperColors.Border, modifier = Modifier.padding(vertical = 8.dp))

            // Actions: Save Directly, Adopt to Editor, Discard
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onDiscard) {
                    Text("Discard Preview", color = DamHopperColors.Error, fontSize = 11.sp)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = onAdoptIntoEditor,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text("Adopt to Editor", color = DamHopperColors.TextPrimary, fontSize = 11.sp)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = onSaveAsMemory,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text("Save As Memory", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
