package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

sealed class MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock()
    data class Paragraph(val text: String) : MarkdownBlock()
    data class ListItem(val text: String, val isOrdered: Boolean, val index: Int = 1) : MarkdownBlock()
    data class Blockquote(val text: String) : MarkdownBlock()
    data class CodeBlock(val language: String, val code: String) : MarkdownBlock()
    data class MermaidFence(val code: String) : MarkdownBlock()
}

@Composable
fun MarkdownPreviewView(
    markdownContent: String,
    modifier: Modifier = Modifier,
) {
    val blocks = remember(markdownContent) { parseMarkdownBlocks(markdownContent) }

    LazyColumn(
        modifier = modifier.fillMaxSize().background(DamHopperColors.Background).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(blocks) { block ->
            when (block) {
                is MarkdownBlock.Heading -> {
                    val fontSize = when (block.level) {
                        1 -> 22.sp
                        2 -> 18.sp
                        3 -> 15.sp
                        else -> 14.sp
                    }
                    Text(
                        text = block.text,
                        fontSize = fontSize,
                        fontWeight = FontWeight.Bold,
                        color = DamHopperColors.Primary,
                        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                    )
                }
                is MarkdownBlock.Paragraph -> {
                    Text(
                        text = block.text,
                        style = DamHopperTypography.bodyMedium,
                        color = DamHopperColors.TextPrimary
                    )
                }
                is MarkdownBlock.ListItem -> {
                    Row(modifier = Modifier.fillMaxWidth().padding(start = 12.dp)) {
                        Text(
                            text = if (block.isOrdered) "${block.index}. " else "• ",
                            color = DamHopperColors.Secondary,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = block.text,
                            style = DamHopperTypography.bodyMedium,
                            color = DamHopperColors.TextPrimary
                        )
                    }
                }
                is MarkdownBlock.Blockquote -> {
                    Row(modifier = Modifier.fillMaxWidth().padding(start = 8.dp)) {
                        Box(modifier = Modifier.width(3.dp).height(24.dp).background(DamHopperColors.Border))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = block.text,
                            style = DamHopperTypography.bodyMedium,
                            fontStyle = FontStyle.Italic,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                }
                is MarkdownBlock.MermaidFence -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant, RoundedCornerShape(6.dp))
                            .border(1.dp, DamHopperColors.Warning, RoundedCornerShape(6.dp)).padding(10.dp)
                    ) {
                        Text(
                            text = "⚠ Mermaid rendering deferred for this release",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = DamHopperColors.Warning
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = block.code,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                }
                is MarkdownBlock.CodeBlock -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface, RoundedCornerShape(6.dp))
                            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp)).padding(10.dp)
                    ) {
                        if (block.language.isNotBlank()) {
                            Text(text = block.language, fontSize = 10.sp, color = DamHopperColors.TextSecondary)
                            Spacer(modifier = Modifier.height(2.dp))
                        }
                        Text(
                            text = block.code,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = DamHopperColors.TextPrimary
                        )
                    }
                }
            }
        }
    }
}

private fun parseMarkdownBlocks(text: String): List<MarkdownBlock> {
    val lines = text.lines()
    val blocks = mutableListOf<MarkdownBlock>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        if (trimmed.startsWith("```")) {
            val lang = trimmed.removePrefix("```").trim()
            val codeLines = mutableListOf<String>()
            i++
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                codeLines.add(lines[i])
                i++
            }
            val code = codeLines.joinToString("\n")
            if (lang.equals("mermaid", ignoreCase = true)) {
                blocks.add(MarkdownBlock.MermaidFence(code))
            } else {
                blocks.add(MarkdownBlock.CodeBlock(lang, code))
            }
        } else if (trimmed.startsWith("#")) {
            val level = trimmed.takeWhile { it == '#' }.length
            val headingText = trimmed.removePrefix("#".repeat(level)).trim()
            blocks.add(MarkdownBlock.Heading(level, headingText))
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            blocks.add(MarkdownBlock.ListItem(trimmed.substring(2), isOrdered = false))
        } else if (Regex("""^\d+\.\s""").containsMatchIn(trimmed)) {
            val numStr = trimmed.substringBefore('.')
            val itemText = trimmed.substringAfter(". ").trim()
            blocks.add(MarkdownBlock.ListItem(itemText, isOrdered = true, index = numStr.toIntOrNull() ?: 1))
        } else if (trimmed.startsWith("> ")) {
            blocks.add(MarkdownBlock.Blockquote(trimmed.removePrefix("> ")))
        } else if (trimmed.isNotEmpty()) {
            blocks.add(MarkdownBlock.Paragraph(line))
        }
        i++
    }
    return blocks
}
