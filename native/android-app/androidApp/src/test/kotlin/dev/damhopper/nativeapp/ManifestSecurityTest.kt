package dev.damhopper.nativeapp

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ManifestSecurityTest {

    @Test
    fun testManifestExcludesBackupAndDataExtraction() {
        val manifestFile = File("src/main/AndroidManifest.xml")
        assertTrue(manifestFile.exists(), "AndroidManifest.xml must exist at ${manifestFile.absolutePath}")

        val content = manifestFile.readText()

        // Security requirement: allowBackup must be explicitly false
        assertTrue(content.contains("android:allowBackup=\"false\""), "Manifest must explicitly disable allowBackup")

        // Security requirement: fullBackupContent must be false
        assertTrue(content.contains("android:fullBackupContent=\"false\""), "Manifest must disable fullBackupContent")

        // Security requirement: dataExtractionRules must point to data_extraction_rules
        assertTrue(content.contains("android:dataExtractionRules=\"@xml/data_extraction_rules\""), "Manifest must point to data_extraction_rules")

        // Security requirement: adjustResize ensures top panel row stays visible during IME
        assertTrue(content.contains("android:windowSoftInputMode=\"adjustResize\""), "MainActivity must use adjustResize")

        // Security requirement: no WebView activities or services
        assertFalse(content.contains("WebView"), "Manifest must not declare WebView components")

        // Security requirement: only MainActivity is exported
        val exportedMatches = Regex("android:exported=\"true\"").findAll(content).toList()
        assertEquals(1, exportedMatches.size, "Only MainActivity should be exported")
    }

    @Test
    fun testReleaseNetworkSecurityConfigStrictlyTLS() {
        val mainNetConfigFile = File("src/main/res/xml/network_security_config.xml")
        assertTrue(mainNetConfigFile.exists(), "main network_security_config.xml must exist")

        val content = mainNetConfigFile.readText()

        // Base config must disallow cleartext traffic by default
        assertTrue(
            content.contains("<base-config cleartextTrafficPermitted=\"false\">"),
            "Base config must set cleartextTrafficPermitted to false"
        )

        // Main release config must NOT permit cleartext on any domain
        assertFalse(
            content.contains("cleartextTrafficPermitted=\"true\""),
            "Main network_security_config.xml must not allow cleartext traffic on any domain"
        )
    }

    @Test
    fun testDebugNetworkSecurityConfigAllowsLocalLoopback() {
        val debugNetConfigFile = File("src/debug/res/xml/network_security_config.xml")
        assertTrue(debugNetConfigFile.exists(), "debug network_security_config.xml must exist")

        val content = debugNetConfigFile.readText()

        // Debug config allows local development cleartext
        assertTrue(
            content.contains("<domain-config cleartextTrafficPermitted=\"true\">"),
            "Debug config must permit cleartext for local development"
        )
        assertTrue(content.contains("10.0.2.2"), "Debug config must include 10.0.2.2")
        assertTrue(content.contains("127.0.0.1"), "Debug config must include 127.0.0.1")
    }

    @Test
    fun testDataExtractionRulesDisallowsAllDomains() {
        val rulesFile = File("src/main/res/xml/data_extraction_rules.xml")
        assertTrue(rulesFile.exists(), "data_extraction_rules.xml must exist")

        val content = rulesFile.readText()
        val requiredDomains = listOf("root", "file", "database", "sharedpref", "external")

        // Both sections must exist
        assertTrue(content.contains("<cloud-backup>"), "Rules must configure cloud-backup")
        assertTrue(content.contains("<device-transfer>"), "Rules must configure device-transfer")

        val cloudBackupSection = content.substringAfter("<cloud-backup>").substringBefore("</cloud-backup>")
        val deviceTransferSection = content.substringAfter("<device-transfer>").substringBefore("</device-transfer>")

        for (domain in requiredDomains) {
            assertTrue(
                cloudBackupSection.contains("domain=\"$domain\"") && cloudBackupSection.contains("path=\".\""),
                "cloud-backup must exclude domain '$domain' with path '.'"
            )
            assertTrue(
                deviceTransferSection.contains("domain=\"$domain\"") && deviceTransferSection.contains("path=\".\""),
                "device-transfer must exclude domain '$domain' with path '.'"
            )
        }
    }
}
