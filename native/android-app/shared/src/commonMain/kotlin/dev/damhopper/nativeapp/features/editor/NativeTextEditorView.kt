package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isCtrlPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Functional slot for injecting platform-native code editor surfaces into shared Compose UI.
 */
typealias NativeEditorSurfaceHost = @Composable (
    document: EditorDocument,
    isReadOnly: Boolean,
    modifier: Modifier
) -> Unit

/**
 * Ambient composition local providing the platform-native editor surface host.
 */
val LocalNativeEditorSurfaceHost = compositionLocalOf<NativeEditorSurfaceHost?> { null }

/**
 * The synchronized `editorFontSize` preference (sp), supplied by the active root. The platform host applies it to
 * the live widget on every change without recreating the document, selection or undo history.
 */
val LocalEditorFontSize = compositionLocalOf { 14 }

/**
 * Editor zoom wiring: [enabled] mirrors the `editorZoomWheelEnabled` preference; pinch and hardware Ctrl+wheel call
 * [onFontSize] with the next clamped size (they update the same preference, not a separate copy).
 */
class EditorZoom(
    val enabled: Boolean,
    val fontSize: Int,
    val onFontSize: (Int) -> Unit,
)

val LocalEditorZoom = compositionLocalOf<EditorZoom?> { null }

/** Next editor font size for a Ctrl+wheel [scrollDeltaY] (up = larger), clamped to the preference range. */
fun wheelZoomedEditorFontSize(current: Int, scrollDeltaY: Float): Int {
    if (scrollDeltaY == 0f || !scrollDeltaY.isFinite()) return WorkbenchPreferences.clampFont(current)
    return WorkbenchPreferences.clampFont(current + if (scrollDeltaY < 0f) 1 else -1)
}

/** Next editor font size for a cumulative pinch [zoomFactor] relative to [startSize]. */
fun pinchZoomedEditorFontSize(startSize: Int, zoomFactor: Float): Int {
    val start = WorkbenchPreferences.clampFont(startSize)
    if (!zoomFactor.isFinite() || zoomFactor <= 0f) return start
    return WorkbenchPreferences.clampFont((start * zoomFactor).toInt())
}

private fun Modifier.editorZoom(zoomState: State<EditorZoom?>, blocked: Boolean): Modifier {
    val enabled = zoomState.value?.enabled == true && !blocked
    if (!enabled) return this
    return pointerInput(enabled) {
        // Observed in the Initial pass so the hosted native view keeps its own handling for everything else.
        awaitPointerEventScope {
            var startSize = 0
            var cumulative = 1f
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val zoom = zoomState.value ?: continue
                if (event.type == PointerEventType.Scroll && event.keyboardModifiers.isCtrlPressed) {
                    val dy = event.changes.firstOrNull()?.scrollDelta?.y ?: 0f
                    if (dy != 0f) {
                        val next = wheelZoomedEditorFontSize(zoom.fontSize, dy)
                        if (next != zoom.fontSize) zoom.onFontSize(next)
                        event.changes.forEach { it.consume() }
                    }
                    continue
                }
                val pressed = event.changes.count { it.pressed }
                if (pressed >= 2) {
                    if (startSize == 0) {
                        startSize = zoom.fontSize
                        cumulative = 1f
                    }
                    val a = event.changes[0]
                    val b = event.changes[1]
                    val before = (a.previousPosition - b.previousPosition).getDistance()
                    val now = (a.position - b.position).getDistance()
                    if (before > 0f && now > 0f) {
                        cumulative *= now / before
                        val next = pinchZoomedEditorFontSize(startSize, cumulative)
                        if (next != zoom.fontSize) zoom.onFontSize(next)
                    }
                    event.changes.forEach { it.consume() }
                } else if (pressed == 0) {
                    startSize = 0
                    cumulative = 1f
                }
            }
        }
    }
}

/**
 * Host container for the native code editor surface.
 *
 * Replaces the obsolete Compose TextField and eager custom line gutter with an injected
 * platform surface (e.g. Sora CodeEditor on Android). Passes only the authoritative
 * [EditorDocument] handle and metadata, never copying full text into Compose state. The editor font arrives
 * through [LocalEditorFontSize]/[fontSize]; pinch and Ctrl+wheel zoom ([LocalEditorZoom]) only run when enabled
 * and never for a read-only, hidden or privacy-gated editor.
 */
@Composable
fun NativeTextEditorView(
    document: EditorDocument?,
    metadata: EditorTabMetadata? = null,
    isReadOnly: Boolean = false,
    fontSize: Int = LocalEditorFontSize.current,
    modifier: Modifier = Modifier,
    nativeSurfaceHost: NativeEditorSurfaceHost? = LocalNativeEditorSurfaceHost.current,
) {
    val effectiveReadOnly = isReadOnly || (metadata?.isReadOnly == true)
    val zoomState = rememberUpdatedState(LocalEditorZoom.current)
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .editorZoom(zoomState, blocked = effectiveReadOnly),
    ) {
        if (document != null && nativeSurfaceHost != null) {
            CompositionLocalProvider(LocalEditorFontSize provides fontSize) {
                nativeSurfaceHost(
                    document,
                    effectiveReadOnly,
                    Modifier.fillMaxSize()
                )
            }
        } else if (document != null) {
            Box(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "Native editor surface attached (${metadata?.relativePath ?: document.id.relativePath})",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary
                )
            }
        } else {
            Box(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No document attached",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary
                )
            }
        }
    }
}
