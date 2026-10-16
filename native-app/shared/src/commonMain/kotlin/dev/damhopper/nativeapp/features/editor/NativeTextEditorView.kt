package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Text editor view rendering synchronized line number gutters and editable monospace buffer,
 * backed by the Phase 05 Sora Editor adapter candidate contract.
 */
@Composable
fun NativeTextEditorView(
    session: EditorSession?,
    content: String,
    onContentChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val lines = content.lines()
    val scrollState = rememberScrollState()

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Adapter metadata indicator
        Box(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(horizontal = 12.dp, vertical = 2.dp)
        ) {
            Text(
                text = "Native Workbench Editor (Candidate: Sora Editor 0.23.4 evaluated under Phase 05/18)",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextSecondary
            )
        }

        Row(
            modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(scrollState)
        ) {
            // Line numbers column (synchronized with scroll)
            Column(
                modifier = Modifier.width(44.dp).background(DamHopperColors.SurfaceVariant).padding(vertical = 4.dp, horizontal = 4.dp)
            ) {
                lines.forEachIndexed { idx, _ ->
                    Text(
                        text = (idx + 1).toString(),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = DamHopperColors.TextSecondary,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            VerticalDivider(modifier = Modifier.width(1.dp), color = DamHopperColors.Border)

            TextField(
                value = content,
                onValueChange = onContentChange,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                textStyle = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    color = DamHopperColors.TextPrimary,
                    lineHeight = 18.sp
                ),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = DamHopperColors.Primary
                )
            )
        }
    }
}
