package dev.damhopper.nativeapp.features.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration

/**
 * Default foreground color matching DamHopper dark theme text primary (off-white).
 */
val VT_DEFAULT_FOREGROUND = Color(0xFFF0F6FC)

/**
 * Represents a single character cell within a VT100 2D terminal grid.
 *
 * Stores character string (supporting full Unicode scalar values and wide glyphs),
 * foreground/background colors, and SGR style flags.
 */
data class VtCell(
    val char: String = " ",
    val fg: Color = VT_DEFAULT_FOREGROUND,
    val bg: Color = Color.Transparent,
    val isBold: Boolean = false,
    val isUnderline: Boolean = false,
    val isDim: Boolean = false,
    val isInverse: Boolean = false,
    val width: Int = 1,
) {
    fun toSpanStyle(): SpanStyle {
        val effectiveFg = if (isInverse) (if (bg == Color.Transparent) Color(0xFF0D1117) else bg) else fg
        val effectiveBg = if (isInverse) fg else bg
        return SpanStyle(
            color = effectiveFg,
            background = effectiveBg,
            fontWeight = if (isBold) FontWeight.Bold else if (isDim) FontWeight.Light else FontWeight.Normal,
            textDecoration = if (isUnderline) TextDecoration.Underline else null,
        )
    }

    companion object {
        val EMPTY = VtCell()
    }
}
