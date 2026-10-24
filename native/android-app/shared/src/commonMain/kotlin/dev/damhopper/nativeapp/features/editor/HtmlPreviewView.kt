package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Platform HTML renderer slot. The host receives an already-bounded HTML snapshot and must render it
 * natively (no WebView). Android supplies an `AnnotatedString.fromHtml` implementation.
 */
typealias NativeHtmlSurfaceHost = @Composable (htmlContent: String, isTruncated: Boolean, modifier: Modifier) -> Unit

val LocalNativeHtmlSurfaceHost = compositionLocalOf<NativeHtmlSurfaceHost?> { null }

/**
 * Read-only HTML preview of an immutable snapshot ([content]). Delegates to [LocalNativeHtmlSurfaceHost]
 * when present; otherwise shows the raw markup as monospace text. When [isTruncated] a notice banner is
 * pinned above the content in both paths.
 */
@Composable
fun HtmlPreviewView(
    content: String,
    isTruncated: Boolean,
    modifier: Modifier = Modifier,
) {
    val host = LocalNativeHtmlSurfaceHost.current
    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        if (isTruncated) {
            Text(
                text = PREVIEW_TRUNCATION_NOTICE,
                fontSize = 12.sp,
                color = DamHopperColors.Warning,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        if (host != null) {
            host(content, isTruncated, Modifier.weight(1f).fillMaxWidth())
        } else {
            SelectionContainer(modifier = Modifier.weight(1f).fillMaxWidth()) {
                Text(
                    text = content,
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                )
            }
        }
    }
}
