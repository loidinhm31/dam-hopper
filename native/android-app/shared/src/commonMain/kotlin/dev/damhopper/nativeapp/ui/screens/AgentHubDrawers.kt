package dev.damhopper.nativeapp.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

const val TAG_MODAL_AGENTS_DRAWER: String = "agent-hub-landing:modal-agents-drawer"
const val TAG_MODAL_FILES_DRAWER: String = "agent-hub-landing:modal-files-drawer"

@Composable
fun ModalAgentsDrawer(
    isOpen: Boolean,
    onClose: () -> Unit,
    drawerWidth: Dp = 280.dp,
    content: @Composable () -> Unit,
) {
    if (!isOpen) return

    Box(
        modifier = Modifier
            .testTag(TAG_MODAL_AGENTS_DRAWER)
            .fillMaxSize(),
    ) {
        // 50% Dark Scrim
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.5f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClose,
                ),
        )

        // Slide-in drawer from left
        AnimatedVisibility(
            visible = isOpen,
            enter = slideInHorizontally(initialOffsetX = { -it }) + fadeIn(),
            exit = slideOutHorizontally(targetOffsetX = { -it }) + fadeOut(),
            modifier = Modifier.align(Alignment.CenterStart),
        ) {
            Box(
                modifier = Modifier
                    .width(drawerWidth)
                    .fillMaxHeight(),
            ) {
                content()
            }
        }
    }
}

@Composable
fun ModalFilesDrawer(
    isOpen: Boolean,
    onClose: () -> Unit,
    drawerWidth: Dp = 300.dp,
    content: @Composable () -> Unit,
) {
    if (!isOpen) return

    Box(
        modifier = Modifier
            .testTag(TAG_MODAL_FILES_DRAWER)
            .fillMaxSize(),
    ) {
        // 50% Dark Scrim
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.5f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClose,
                ),
        )

        // Slide-in drawer from right
        AnimatedVisibility(
            visible = isOpen,
            enter = slideInHorizontally(initialOffsetX = { it }) + fadeIn(),
            exit = slideOutHorizontally(targetOffsetX = { it }) + fadeOut(),
            modifier = Modifier.align(Alignment.CenterEnd),
        ) {
            Box(
                modifier = Modifier
                    .width(drawerWidth)
                    .fillMaxHeight(),
            ) {
                content()
            }
        }
    }
}
