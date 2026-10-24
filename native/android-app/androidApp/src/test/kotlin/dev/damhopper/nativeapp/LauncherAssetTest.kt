package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LauncherAssetTest {

    @Test
    fun testLauncherManifestReferences() {
        val manifestFile = File("src/main/AndroidManifest.xml")
        assertTrue(manifestFile.exists(), "AndroidManifest.xml must exist")
        val content = manifestFile.readText()

        assertTrue(
            content.contains("android:icon=\"@mipmap/ic_launcher\""),
            "Manifest must reference @mipmap/ic_launcher"
        )
        assertTrue(
            content.contains("android:roundIcon=\"@mipmap/ic_launcher_round\""),
            "Manifest must reference @mipmap/ic_launcher_round"
        )
    }

    @Test
    fun testAdaptiveIconXmlDefinitions() {
        val v26Dir = File("src/main/res/mipmap-anydpi-v26")
        assertTrue(v26Dir.exists(), "mipmap-anydpi-v26 must exist")
        val v26Launcher = File(v26Dir, "ic_launcher.xml")
        assertTrue(v26Launcher.exists(), "ic_launcher.xml must exist in mipmap-anydpi-v26")
        val v26Content = v26Launcher.readText()
        assertTrue(
            v26Content.contains("android:drawable=\"@color/ic_launcher_background\""),
            "v26 adaptive icon background must reference @color/ic_launcher_background"
        )
        assertTrue(
            v26Content.contains("android:drawable=\"@drawable/ic_launcher_foreground\""),
            "v26 adaptive icon foreground must reference @drawable/ic_launcher_foreground"
        )
        val v26LauncherRound = File(v26Dir, "ic_launcher_round.xml")
        assertTrue(v26LauncherRound.exists(), "ic_launcher_round.xml must exist in mipmap-anydpi-v26")

        val v33Dir = File("src/main/res/mipmap-anydpi-v33")
        assertTrue(v33Dir.exists(), "mipmap-anydpi-v33 must exist")
        val v33Launcher = File(v33Dir, "ic_launcher.xml")
        assertTrue(v33Launcher.exists(), "ic_launcher.xml must exist in mipmap-anydpi-v33")
        val v33Content = v33Launcher.readText()
        assertTrue(
            v33Content.contains("android:drawable=\"@color/ic_launcher_background\""),
            "v33 adaptive icon background must reference @color/ic_launcher_background"
        )
        assertTrue(
            v33Content.contains("android:drawable=\"@drawable/ic_launcher_foreground\""),
            "v33 adaptive icon foreground must reference @drawable/ic_launcher_foreground"
        )
        assertTrue(
            v33Content.contains("android:drawable=\"@drawable/ic_launcher_monochrome\""),
            "v33 adaptive icon monochrome must reference @drawable/ic_launcher_monochrome"
        )
        val v33LauncherRound = File(v33Dir, "ic_launcher_round.xml")
        assertTrue(v33LauncherRound.exists(), "ic_launcher_round.xml must exist in mipmap-anydpi-v33")
    }

    @Test
    fun testPackagedOflLicenseFile() {
        val licenseFile = File("src/main/assets/licenses/jetbrains-mono.txt")
        assertTrue(licenseFile.exists(), "Packaged OFL license must exist in assets/licenses/jetbrains-mono.txt")
        val text = licenseFile.readText()
        assertTrue(text.contains("SIL OPEN FONT LICENSE Version 1.1"), "License must contain SIL OFL 1.1 preamble")
        assertTrue(text.contains("The JetBrains Mono Project Authors"), "License must contain JetBrains copyright notice")
    }

    @Test
    fun testLauncherColorAndVectorDrawables() {
        val bgXml = File("src/main/res/values/ic_launcher_background.xml")
        assertTrue(bgXml.exists(), "ic_launcher_background.xml must exist in values")
        assertTrue(
            bgXml.readText().contains("#1C2637"),
            "ic_launcher_background must define DamHopper background color #1C2637"
        )

        val fgXml = File("src/main/res/drawable/ic_launcher_foreground.xml")
        assertTrue(fgXml.exists(), "ic_launcher_foreground.xml must exist in drawable")
        val fgContent = fgXml.readText()
        assertTrue(
            fgContent.contains("viewportWidth=\"642\""),
            "ic_launcher_foreground must contain DamHopper vector viewport"
        )

        val monoXml = File("src/main/res/drawable/ic_launcher_monochrome.xml")
        assertTrue(monoXml.exists(), "ic_launcher_monochrome.xml must exist in drawable")
    }

    @Test
    fun testLauncherBitmapDensities() {
        val densities = listOf("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
        val requiredBitmaps = listOf("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png")

        for (density in densities) {
            val dir = File("src/main/res/mipmap-$density")
            assertTrue(dir.exists(), "mipmap-$density directory must exist")
            for (bitmap in requiredBitmaps) {
                val file = File(dir, bitmap)
                assertTrue(file.exists(), "$bitmap must exist in mipmap-$density")
                assertTrue(file.length() > 0, "$bitmap in mipmap-$density must not be empty")
            }
        }
    }

    @Test
    fun testJetBrainsMonoFontFilesExistAndHaveValidHeaders() {
        val fontDir = File("../shared/src/androidMain/res/font")
        assertTrue(fontDir.exists(), "Font directory must exist at shared/src/androidMain/res/font")

        val expectedFonts = listOf(
            "jetbrains_mono_regular.ttf",
            "jetbrains_mono_medium.ttf",
            "jetbrains_mono_semibold.ttf",
            "jetbrains_mono_bold.ttf",
            "jetbrains_mono_extrabold.ttf",
            "jetbrains_mono_light.ttf",
            "jetbrains_mono_thin.ttf",
            "jetbrains_mono_italic.ttf",
            "jetbrains_mono_bold_italic.ttf"
        )

        for (fontName in expectedFonts) {
            val file = File(fontDir, fontName)
            assertTrue(file.exists(), "Font file $fontName must exist")
            assertTrue(file.length() > 50_000, "Font file $fontName must be substantial (>50KB)")

            // Verify OpenType/TrueType signature (0x00010000 or 'OTTO')
            val bytes = file.readBytes()
            val isTrueType = (bytes[0] == 0x00.toByte() && bytes[1] == 0x01.toByte() &&
                    bytes[2] == 0x00.toByte() && bytes[3] == 0x00.toByte())
            val isOpenType = (bytes[0] == 'O'.code.toByte() && bytes[1] == 'T'.code.toByte() &&
                    bytes[2] == 'T'.code.toByte() && bytes[3] == 'O'.code.toByte())
            assertTrue(isTrueType || isOpenType, "$fontName must have valid TrueType or OpenType header")
        }
    }

    @Test
    fun testTypographyAppliesJetBrainsMonoToAllRoles() {
        assertNotNull(JetBrainsMonoFontFamily, "JetBrainsMonoFontFamily must not be null")

        val typography = DamHopperTypography
        val allRoles = listOf(
            typography.displayLarge,
            typography.displayMedium,
            typography.displaySmall,
            typography.headlineLarge,
            typography.headlineMedium,
            typography.headlineSmall,
            typography.titleLarge,
            typography.titleMedium,
            typography.titleSmall,
            typography.bodyLarge,
            typography.bodyMedium,
            typography.bodySmall,
            typography.labelLarge,
            typography.labelMedium,
            typography.labelSmall
        )

        for (style in allRoles) {
            assertEquals(
                JetBrainsMonoFontFamily,
                style.fontFamily,
                "All typography roles must use JetBrainsMonoFontFamily"
            )
        }
    }
}
