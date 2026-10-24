package dev.damhopper.nativeapp.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
expect val JetBrainsMonoFontFamily: FontFamily

private val defaultTypography = Typography()

val DamHopperTypography = Typography(
    displayLarge = defaultTypography.displayLarge.copy(fontFamily = JetBrainsMonoFontFamily),
    displayMedium = defaultTypography.displayMedium.copy(fontFamily = JetBrainsMonoFontFamily),
    displaySmall = defaultTypography.displaySmall.copy(fontFamily = JetBrainsMonoFontFamily),
    headlineLarge = defaultTypography.headlineLarge.copy(fontFamily = JetBrainsMonoFontFamily),
    headlineMedium = defaultTypography.headlineMedium.copy(fontFamily = JetBrainsMonoFontFamily),
    headlineSmall = TextStyle(
        fontFamily = JetBrainsMonoFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        color = DamHopperColors.TextPrimary
    ),
    titleLarge = defaultTypography.titleLarge.copy(fontFamily = JetBrainsMonoFontFamily),
    titleMedium = TextStyle(
        fontFamily = JetBrainsMonoFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        color = DamHopperColors.TextPrimary
    ),
    titleSmall = defaultTypography.titleSmall.copy(fontFamily = JetBrainsMonoFontFamily),
    bodyLarge = defaultTypography.bodyLarge.copy(fontFamily = JetBrainsMonoFontFamily),
    bodyMedium = TextStyle(
        fontFamily = JetBrainsMonoFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        color = DamHopperColors.TextPrimary
    ),
    bodySmall = defaultTypography.bodySmall.copy(fontFamily = JetBrainsMonoFontFamily),
    labelLarge = defaultTypography.labelLarge.copy(fontFamily = JetBrainsMonoFontFamily),
    labelMedium = defaultTypography.labelMedium.copy(fontFamily = JetBrainsMonoFontFamily),
    labelSmall = TextStyle(
        fontFamily = JetBrainsMonoFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        color = DamHopperColors.TextSecondary
    )
)
