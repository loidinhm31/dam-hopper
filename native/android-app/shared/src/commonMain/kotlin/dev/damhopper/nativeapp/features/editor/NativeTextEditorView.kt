package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
 * Host container for the native code editor surface.
 *
 * Replaces the obsolete Compose TextField and eager custom line gutter with an injected
 * platform surface (e.g. Sora CodeEditor on Android). Passes only the authoritative
 * [EditorDocument] handle and metadata, never copying full text into Compose state.
 */
@Composable
fun NativeTextEditorView(
    document: EditorDocument?,
    metadata: EditorTabMetadata? = null,
    isReadOnly: Boolean = false,
    fontSize: Int = 14,
    modifier: Modifier = Modifier,
    nativeSurfaceHost: NativeEditorSurfaceHost? = LocalNativeEditorSurfaceHost.current,
) {
    Box(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        if (document != null && nativeSurfaceHost != null) {
            nativeSurfaceHost(
                document,
                isReadOnly || (metadata?.isReadOnly == true),
                Modifier.fillMaxSize()
            )
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
