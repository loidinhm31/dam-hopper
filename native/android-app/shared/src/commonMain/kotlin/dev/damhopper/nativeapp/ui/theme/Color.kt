package dev.damhopper.nativeapp.ui.theme

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import dev.damhopper.nativeapp.features.settings.WorkbenchTheme

/** One complete set of semantic colors; [isDark] selects the Material base scheme. */
data class DamHopperPalette(
    val isDark: Boolean,
    val background: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val border: Color,
    val primary: Color,
    val primaryVariant: Color,
    val secondary: Color,
    val error: Color,
    val warning: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val terminalCursor: Color,
    val navRowBackground: Color,
    val navButtonActive: Color,
    val navButtonInactive: Color,
)

/** The real palettes behind the dark / light / system / high-contrast theme choices. */
object DamHopperPalettes {
    val Dark = DamHopperPalette(
        isDark = true,
        background = Color(0xFF0D1117),
        surface = Color(0xFF161B22),
        surfaceVariant = Color(0xFF21262D),
        border = Color(0xFF30363D),
        primary = Color(0xFF58A6FF),
        primaryVariant = Color(0xFF1F6FEB),
        secondary = Color(0xFF7EE787),
        error = Color(0xFFF85149),
        warning = Color(0xFFD29922),
        textPrimary = Color(0xFFF0F6FC),
        textSecondary = Color(0xFF8B949E),
        terminalCursor = Color(0xFF58A6FF),
        navRowBackground = Color(0xFF161B22),
        navButtonActive = Color(0xFF238636),
        navButtonInactive = Color(0xFF21262D),
    )

    val Light = DamHopperPalette(
        isDark = false,
        background = Color(0xFFFFFFFF),
        surface = Color(0xFFF6F8FA),
        surfaceVariant = Color(0xFFEAEEF2),
        border = Color(0xFFD0D7DE),
        primary = Color(0xFF0969DA),
        primaryVariant = Color(0xFFDDF4FF),
        secondary = Color(0xFF1A7F37),
        error = Color(0xFFCF222E),
        warning = Color(0xFF9A6700),
        textPrimary = Color(0xFF1F2328),
        textSecondary = Color(0xFF59636E),
        terminalCursor = Color(0xFF0969DA),
        navRowBackground = Color(0xFFF6F8FA),
        navButtonActive = Color(0xFF1A7F37),
        navButtonInactive = Color(0xFFEAEEF2),
    )

    val HighContrast = DamHopperPalette(
        isDark = true,
        background = Color.Black,
        surface = Color(0xFF111111),
        surfaceVariant = Color(0xFF222222),
        border = Color.White,
        primary = Color(0xFF00FF66),
        primaryVariant = Color(0xFF004D1F),
        secondary = Color(0xFF00E5FF),
        error = Color(0xFFFF3333),
        warning = Color(0xFFFFD400),
        textPrimary = Color.White,
        textSecondary = Color(0xFFE0E0E0),
        terminalCursor = Color(0xFF00FF66),
        navRowBackground = Color(0xFF111111),
        navButtonActive = Color(0xFF00A844),
        navButtonInactive = Color(0xFF222222),
    )

    /** SYSTEM follows the Android configuration ([systemDark]); it is never a permanent dark no-op. */
    fun resolve(theme: WorkbenchTheme, systemDark: Boolean): DamHopperPalette = when (theme) {
        WorkbenchTheme.DARK -> Dark
        WorkbenchTheme.LIGHT -> Light
        WorkbenchTheme.HIGH_CONTRAST -> HighContrast
        WorkbenchTheme.SYSTEM -> if (systemDark) Dark else Light
    }
}

/**
 * Semantic colors of the active palette. Every property reads snapshot state, so a composable that reads
 * `DamHopperColors.Background` recomposes when the theme preference or the Android theme changes, without any
 * call-site migration. [NativeTheme] is the only writer.
 */
object DamHopperColors {
    private var palette: DamHopperPalette by mutableStateOf(DamHopperPalettes.Dark)

    internal fun apply(next: DamHopperPalette) {
        if (palette != next) palette = next
    }

    val current: DamHopperPalette get() = palette

    val Background: Color get() = palette.background
    val Surface: Color get() = palette.surface
    val SurfaceVariant: Color get() = palette.surfaceVariant
    val Border: Color get() = palette.border
    val Primary: Color get() = palette.primary
    val PrimaryVariant: Color get() = palette.primaryVariant
    val Secondary: Color get() = palette.secondary
    val Accent: Color get() = palette.primary
    val Success: Color get() = palette.secondary
    val Error: Color get() = palette.error
    val Warning: Color get() = palette.warning
    val TextPrimary: Color get() = palette.textPrimary
    val TextSecondary: Color get() = palette.textSecondary
    val TerminalCursor: Color get() = palette.terminalCursor
    val NavRowBackground: Color get() = palette.navRowBackground
    val NavButtonActive: Color get() = palette.navButtonActive
    val NavButtonInactive: Color get() = palette.navButtonInactive
}
