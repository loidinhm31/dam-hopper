package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun UsageDeleteDialog(
    isDeleting: Boolean,
    errorMessage: String?,
    onConfirm: (confirmation: String, from: Long?, to: Long?) -> Unit,
    onDismiss: () -> Unit,
) {
    var confirmText by remember { mutableStateOf("") }
    var isRangeDelete by remember { mutableStateOf(false) }
    var daysBackText by remember { mutableStateOf("7") }
    val daysVal = daysBackText.toLongOrNull()
    val isDaysValid = !isRangeDelete || (daysVal != null && daysVal in 1L..1825L)
    val isValid = confirmText == "delete-usage-data" && isDaysValid

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DamHopperColors.Surface)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("Delete Usage Telemetry", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text(
                "Deletes local telemetry data behind a server capture barrier. Type 'delete-usage-data' to confirm.",
                fontSize = 11.sp,
                color = DamHopperColors.TextSecondary
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = isRangeDelete, onCheckedChange = { isRangeDelete = it })
                Text("Delete specific past day range only", fontSize = 11.sp, color = Color.White)
            }

            if (isRangeDelete) {
                OutlinedTextField(
                    value = daysBackText,
                    onValueChange = { daysBackText = it.filter { ch -> ch.isDigit() } },
                    label = { Text("Days to delete (most recent)", fontSize = 10.sp) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            val now = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
            val (fromUtc, todayUtc) = UsageBoundsHelper.calculateUtcDayRange(now, daysVal ?: 7L)

            if (isRangeDelete && !isDaysValid) {
                Text("Range must be between 1 and 1825 days (up to 5 years)", fontSize = 10.sp, color = Color(0xFFEF4444))
            } else if (isRangeDelete) {
                Text("Completed UTC days [from, to): ${UsageBoundsHelper.formatUtcDate(fromUtc)} to ${UsageBoundsHelper.formatUtcDate(todayUtc)}", fontSize = 10.sp, color = DamHopperColors.Primary)
                Text("Excludes partial current day (floored to UTC midnight; epoch ms $fromUtc..$todayUtc).", fontSize = 10.sp, color = DamHopperColors.TextSecondary)
            }

            OutlinedTextField(
                value = confirmText,
                onValueChange = { confirmText = it },
                label = { Text("Confirmation string", fontSize = 10.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            if (!errorMessage.isNullOrBlank()) {
                Text(errorMessage, fontSize = 11.sp, color = Color(0xFFEF4444))
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss, enabled = !isDeleting) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = {
                        val from = if (isRangeDelete) fromUtc else null
                        val to = if (isRangeDelete) todayUtc else null
                        onConfirm(confirmText, from, to)
                    },
                    enabled = isValid && !isDeleting,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))
                ) {
                    Text(if (isDeleting) "Deleting..." else "Delete", color = Color.White)
                }
            }
        }
    }
}

@Composable
fun SessionDetailDialog(
    sessionDetail: SessionDetailResponse,
    onDismiss: () -> Unit,
) {
    val s = sessionDetail.session
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DamHopperColors.Surface)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("Session Details", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text("HMAC ID: ${s.id.take(16)}...", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
            Text("Model: ${s.model ?: "Default"}", fontSize = 12.sp, color = Color.White)

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(8.dp)
            ) {
                Text("TOKEN USAGE", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                val inTok = s.tokens.inputTokens?.toString() ?: "--"
                val cInTok = s.tokens.cachedInputTokens?.toString() ?: "--"
                val outTok = s.tokens.outputTokens?.toString() ?: "--"
                val rTok = s.tokens.reasoningTokens?.toString() ?: "--"
                Text("Input: $inTok  •  Cached: $cInTok", fontSize = 11.sp, color = Color.White)
                Text("Output: $outTok  •  Reasoning: $rTok", fontSize = 11.sp, color = Color.White)
                Text("Responses: ${s.tokens.responseCount}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) {
                    Text("Close", color = DamHopperColors.Primary)
                }
            }
        }
    }
}
