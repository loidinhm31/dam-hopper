package dev.damhopper.nativeapp.features.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.logging.DiagnosticEntry
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

fun formatTimestamp(timestampMs: Long): String {
    return try {
        val instant = Instant.fromEpochMilliseconds(timestampMs)
        val ldt = instant.toLocalDateTime(TimeZone.currentSystemDefault())
        val h = ldt.hour.toString().padStart(2, '0')
        val m = ldt.minute.toString().padStart(2, '0')
        val s = ldt.second.toString().padStart(2, '0')
        val ms = (ldt.nanosecond / 1_000_000).toString().padStart(3, '0')
        "$h:$m:$s.$ms"
    } catch (_: Throwable) {
        timestampMs.toString()
    }
}

@Composable
fun DiagnosticEntryRow(entry: DiagnosticEntry) {
    val isError = entry.type == "error" || entry.message.contains("error", ignoreCase = true) || entry.message.contains("failed", ignoreCase = true)
    val isWarn = entry.message.contains("gap", ignoreCase = true) || entry.message.contains("dropped", ignoreCase = true) || entry.message.contains("lagged", ignoreCase = true)
    val indicatorColor = when {
        isError -> DamHopperColors.Error
        isWarn -> DamHopperColors.Warning
        else -> DamHopperColors.Success
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .background(DamHopperColors.Surface)
            .border(0.5.dp, DamHopperColors.Border, RoundedCornerShape(4.dp))
            .padding(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Box(
                    modifier = Modifier
                        .width(6.dp)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(indicatorColor),
                )
                Text(
                    text = "${entry.scope} / ${entry.type}",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                )
            }
            Text(
                text = formatTimestamp(entry.timestampMs),
                color = DamHopperColors.TextSecondary,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
            )
        }

        Spacer(modifier = Modifier.height(2.dp))

        Text(
            text = entry.message,
            color = indicatorColor,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
        )

        if (entry.metadata != null && entry.metadata.isNotEmpty()) {
            Spacer(modifier = Modifier.height(2.dp))
            val metaString = entry.metadata.entries.joinToString(" | ") { "${it.key}=${it.value}" }
            Text(
                text = metaString,
                color = DamHopperColors.TextSecondary,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}
