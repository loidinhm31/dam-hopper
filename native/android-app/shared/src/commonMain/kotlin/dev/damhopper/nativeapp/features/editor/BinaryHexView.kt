@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

data class HexDumpLine(
    val offsetHex: String,
    val hexBytes: String,
    val asciiChars: String,
)

@Composable
fun BinaryHexView(
    tab: EditorTab,
    modifier: Modifier = Modifier,
) {
    val hexLines = remember(tab.binaryBase64) {
        val bytes = tab.binaryBase64?.let {
            try { Base64.decode(it) } catch (_: Throwable) { null }
        } ?: byteArrayOf()

        val lines = mutableListOf<HexDumpLine>()
        var offset = 0
        while (offset < bytes.size) {
            val chunkLen = minOf(16, bytes.size - offset)
            val chunk = bytes.copyOfRange(offset, offset + chunkLen)

            val hexPart = chunk.joinToString(" ") { b ->
                val v = b.toInt() and 0xFF
                v.toString(16).padStart(2, '0').uppercase()
            }.padEnd(47, ' ')

            val asciiPart = chunk.map { b ->
                val c = b.toInt().toChar()
                if (c in ' '..'~') c else '.'
            }.joinToString("")

            lines.add(HexDumpLine(offset.toString(16).padStart(8, '0').uppercase(), hexPart, asciiPart))
            offset += 16
        }
        lines
    }

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        Box(modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(
                text = "Binary File (${tab.size} bytes) • Hex Preview (Read-only)",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.Warning
            )
        }

        LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 4.dp)) {
            items(hexLines) { line ->
                Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    Text(
                        text = line.offsetHex,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = DamHopperColors.TextSecondary,
                        modifier = Modifier.width(70.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = line.hexBytes,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = DamHopperColors.Primary,
                        modifier = Modifier.width(280.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = line.asciiChars,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = DamHopperColors.TextPrimary
                    )
                }
            }
        }
    }
}
