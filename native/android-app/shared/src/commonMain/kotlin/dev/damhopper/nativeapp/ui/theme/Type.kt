package dev.damhopper.nativeapp.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences

expect val JetBrainsMonoFontFamily: FontFamily

/** Reference system font size (the web default): the `systemFontSize` preference scales relative to it. */
const val REFERENCE_SYSTEM_FONT_SIZE = 14

/**
 * Reactive system font scale for the `systemFontSize` preference (10..32 sp, reference 14). Applied through
 * [NativeTheme] as a multiplier of the density's font scale, so every `sp` on the login/project/workspace/
 * Settings paths (including formerly hard-coded text styles) follows it without per-call-site code.
 */
fun systemFontScale(systemFontSize: Int): Float =
    WorkbenchPreferences.clampFont(systemFontSize).toFloat() / REFERENCE_SYSTEM_FONT_SIZE

/** The Android-provided density at the root, before the preference scale; null outside [NativeTheme]. */
val LocalBaseDensity = compositionLocalOf<Density?> { null }

/** The scale [NativeTheme] currently applies on top of [LocalBaseDensity] (1f outside it). */
val LocalSystemFontScale = compositionLocalOf { 1f }

/**
 * Typography for [palette]; sizes are the unscaled reference sizes, the preference scale is applied via density.
 */
fun damHopperTypography(palette: DamHopperPalette): Typography {
    val base = Typography()
    return Typography(
        displayLarge = base.displayLarge.copy(fontFamily = JetBrainsMonoFontFamily),
        displayMedium = base.displayMedium.copy(fontFamily = JetBrainsMonoFontFamily),
        displaySmall = base.displaySmall.copy(fontFamily = JetBrainsMonoFontFamily),
        headlineLarge = base.headlineLarge.copy(fontFamily = JetBrainsMonoFontFamily),
        headlineMedium = base.headlineMedium.copy(fontFamily = JetBrainsMonoFontFamily),
        headlineSmall = TextStyle(
            fontFamily = JetBrainsMonoFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 20.sp,
            lineHeight = 26.sp,
            color = palette.textPrimary,
        ),
        titleLarge = base.titleLarge.copy(fontFamily = JetBrainsMonoFontFamily),
        titleMedium = TextStyle(
            fontFamily = JetBrainsMonoFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            color = palette.textPrimary,
        ),
        titleSmall = base.titleSmall.copy(fontFamily = JetBrainsMonoFontFamily),
        bodyLarge = base.bodyLarge.copy(fontFamily = JetBrainsMonoFontFamily),
        bodyMedium = TextStyle(
            fontFamily = JetBrainsMonoFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = palette.textPrimary,
        ),
        bodySmall = base.bodySmall.copy(fontFamily = JetBrainsMonoFontFamily),
        labelLarge = base.labelLarge.copy(fontFamily = JetBrainsMonoFontFamily),
        labelMedium = base.labelMedium.copy(fontFamily = JetBrainsMonoFontFamily),
        labelSmall = TextStyle(
            fontFamily = JetBrainsMonoFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            color = palette.textSecondary,
        ),
    )
}

/** Dark-palette typography for callers that read the type scale outside a theme (explicit colors win there). */
val DamHopperTypography: Typography = damHopperTypography(DamHopperPalettes.Dark)
