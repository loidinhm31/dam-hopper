package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.settings.CognitoModeStyle
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Full-viewport ephemeral Cognito privacy mask.
 *
 * Invariants:
 * - When active, covers entire workbench and freezes input at dispatch boundaries.
 * - Consumes all pointer and touch interactions.
 * - Removes accessibility tree of covered content.
 * - Provides both hardware-chord and touch-accessible emergency dismissal.
 * - Zero FABs and zero browser engines.
 */
@Composable
fun CognitoOverlay(
    privacyController: PrivacyController,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val isMaskActive by privacyController.isMaskActive.collectAsState()
    val activeStyle by privacyController.activeStyle.collectAsState()
    val activationChord by privacyController.activationChord.collectAsState()

    Box(modifier = modifier.fillMaxSize()) {
        // Underlying productive content
        Box(
            modifier = Modifier
                .fillMaxSize()
                .then(
                    if (isMaskActive) {
                        Modifier.semantics { invisibleToUser() }
                    } else {
                        Modifier
                    }
                )
        ) {
            content()
        }

        // Mask overlay
        if (isMaskActive) {
            val maskColor = when (activeStyle) {
                CognitoModeStyle.BLACK_SCREEN -> Color.Black
                CognitoModeStyle.HEAVY_BLUR -> Color(0xF20D1117) // Heavy slate tint fallback
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .zIndex(10000f)
                    .background(maskColor)
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                event.changes.forEach { it.consume() }
                            }
                        }
                    }
                    .clearAndSetSemantics {
                        contentDescription = "Cognito Privacy Mode Active. Tap to dismiss or press shortcut."
                    },
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    modifier = Modifier
                        .padding(24.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(DamHopperColors.Surface)
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(12.dp))
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = "Cognito Privacy Mode",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "Workbench content is masked and input is frozen.\nPress '${activationChord ?: "shortcut"}' or tap below to dismiss.",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        lineHeight = 18.sp,
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.SurfaceVariant)
                            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                            .clickable {
                                privacyController.dismissTouchEmergency()
                            }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "Tap to Dismiss Mask",
                            color = DamHopperColors.Accent,
                            fontSize = 13.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}
