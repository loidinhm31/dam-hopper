package dev.damhopper.nativeapp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import dev.damhopper.nativeapp.features.settings.WorkbenchTheme

private fun DamHopperPalette.toColorScheme(): ColorScheme =
    if (isDark) {
        darkColorScheme(
            primary = primary,
            onPrimary = background,
            secondary = secondary,
            onSecondary = background,
            background = background,
            onBackground = textPrimary,
            surface = surface,
            onSurface = textPrimary,
            surfaceVariant = surfaceVariant,
            onSurfaceVariant = textSecondary,
            error = error,
            onError = if (this === DamHopperPalettes.HighContrast) Color.Black else textPrimary,
            outline = border,
            primaryContainer = primaryVariant,
            onPrimaryContainer = textPrimary,
        )
    } else {
        lightColorScheme(
            primary = primary,
            onPrimary = Color.White,
            secondary = secondary,
            onSecondary = Color.White,
            background = background,
            onBackground = textPrimary,
            surface = surface,
            onSurface = textPrimary,
            surfaceVariant = surfaceVariant,
            onSurfaceVariant = textSecondary,
            error = error,
            onError = Color.White,
            outline = border,
            primaryContainer = primaryVariant,
            onPrimaryContainer = textPrimary,
        )
    }

/**
 * Reactive native theme.
 *
 * - [theme]: dark / light / high-contrast palettes; SYSTEM follows the Android night configuration.
 * - [systemFontSize]: the synchronized `systemFontSize` preference, applied as a multiplier of the Android font
 *   scale for every `sp` below this point (see [systemFontScale]). Terminal/editor surfaces keep their own font
 *   preferences by re-providing [LocalBaseDensity] (see [UnscaledDensity]).
 *
 * Nesting is idempotent: an inner theme scales the original [LocalBaseDensity], never an already-scaled density.
 */
@Composable
fun NativeTheme(
    theme: WorkbenchTheme = WorkbenchTheme.DARK,
    systemFontSize: Int = REFERENCE_SYSTEM_FONT_SIZE,
    content: @Composable () -> Unit,
) {
    val palette = DamHopperPalettes.resolve(theme, isSystemInDarkTheme())
    DamHopperColors.apply(palette)
    val inherited = LocalDensity.current
    val base = LocalBaseDensity.current ?: inherited
    val scale = systemFontScale(systemFontSize)
    val scaled = remember(base.density, base.fontScale, scale) { Density(base.density, base.fontScale * scale) }
    val typography = remember(palette) { damHopperTypography(palette) }
    val scheme = remember(palette) { palette.toColorScheme() }
    CompositionLocalProvider(
        LocalBaseDensity provides base,
        LocalDensity provides scaled,
        LocalSystemFontScale provides scale,
    ) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}

/**
 * Runs [content] with the Android font scale only (no `systemFontSize` multiplier): terminal and editor
 * text sizes are their own preferences and must not be scaled twice.
 */
@Composable
fun UnscaledDensity(content: @Composable () -> Unit) {
    val base = LocalBaseDensity.current
    if (base == null) {
        content()
    } else {
        CompositionLocalProvider(LocalDensity provides base, content = content)
    }
}
