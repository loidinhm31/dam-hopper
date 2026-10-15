package dev.damhopper.nativeapp.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

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

@Composable
fun NativeTheme(
    content: @Composable () -> Unit
) {
    // DamHopper workbench adheres to a consistent dark terminal aesthetic
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = DamHopperTypography,
        content = content
    )
}
