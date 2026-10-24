package dev.damhopper.nativeapp.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import dev.damhopper.nativeapp.features.settings.WorkbenchTheme

private val DarkColorScheme = darkColorScheme(
    primary = DamHopperColors.Primary,
    onPrimary = DamHopperColors.Background,
    secondary = DamHopperColors.Secondary,
    onSecondary = DamHopperColors.Background,
    background = DamHopperColors.Background,
    onBackground = DamHopperColors.TextPrimary,
    surface = DamHopperColors.Surface,
    onSurface = DamHopperColors.TextPrimary,
    surfaceVariant = DamHopperColors.SurfaceVariant,
    onSurfaceVariant = DamHopperColors.TextSecondary,
    error = DamHopperColors.Error,
    onError = DamHopperColors.TextPrimary
)
private val HighContrastColorScheme = darkColorScheme(
    primary = Color(0xFF00FF66),
    onPrimary = Color.Black,
    secondary = Color(0xFF00E5FF),
    onSecondary = Color.Black,
    background = Color.Black,
    onBackground = Color.White,
    surface = Color(0xFF111111),
    onSurface = Color.White,
    surfaceVariant = Color(0xFF222222),
    onSurfaceVariant = Color.White,
    error = Color(0xFFFF3333),
    onError = Color.Black
)

@Composable
fun NativeTheme(
    theme: WorkbenchTheme = WorkbenchTheme.DARK,
    content: @Composable () -> Unit
) {
    val scheme = when (theme) {
        WorkbenchTheme.HIGH_CONTRAST -> HighContrastColorScheme
        else -> DarkColorScheme
    }
    MaterialTheme(
        colorScheme = scheme,
        typography = DamHopperTypography,
        content = content
    )
}
