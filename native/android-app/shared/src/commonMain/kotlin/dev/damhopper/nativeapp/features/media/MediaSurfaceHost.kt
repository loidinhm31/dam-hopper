package dev.damhopper.nativeapp.features.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import dev.damhopper.nativeapp.features.editor.EditorTab

/**
 * Platform-provided composable that renders a native image or video viewer for an editor tab.
 *
 * - [tab]: preview-only media tab (FileTier.IMAGE or FileTier.VIDEO).
 * - [isImage]: true renders the image viewer, false renders the video player.
 * - [onDownloadClicked]: optional SAF download trigger surfaced inline in the viewer controls.
 */
typealias NativeMediaSurfaceHost = @Composable (
    tab: EditorTab,
    isImage: Boolean,
    modifier: Modifier,
    onDownloadClicked: (() -> Unit)?,
) -> Unit

/**
 * Composition local carrying the platform media surface host. Null when the platform
 * provides no native media viewer (callers fall back to a placeholder card).
 */
val LocalNativeMediaSurfaceHost = compositionLocalOf<NativeMediaSurfaceHost?> { null }
