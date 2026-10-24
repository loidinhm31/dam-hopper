package dev.damhopper.nativeapp.platform.vault

import dev.damhopper.nativeapp.features.profiles.CredentialVault
import dev.damhopper.nativeapp.features.profiles.VaultKeyInvalidatedException
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidCredentialVaultTest {

    @Test
    fun testVaultKeyFormatInvariants() {
        val key = CredentialVault.makeKey("prof-123", "https://prod.damhopper.com/")
        assertEquals("token:prof-123:https://prod.damhopper.com", key)
    }

    @Test
    fun testVaultDataExtractionExclusionCoversVaultFile() {
        val rulesFile = File("src/main/res/xml/data_extraction_rules.xml")
        assertTrue(rulesFile.exists(), "data_extraction_rules.xml must exist")
        val content = rulesFile.readText()

        // Shared preferences must be excluded from cloud-backup and device-transfer
        assertTrue(
            content.contains("<exclude domain=\"sharedpref\" path=\".\" />"),
            "data_extraction_rules must exclude all sharedpref to protect Keystore vault tokens"
        )
    }

    @Test
    fun testVaultFailsClosedWithoutPlaintextFallback() {
        val vaultSource = File("src/main/kotlin/dev/damhopper/nativeapp/platform/vault/AndroidCredentialVault.kt")
        assertTrue(vaultSource.exists(), "AndroidCredentialVault.kt must exist")
        val text = vaultSource.readText()

        // Must throw VaultKeyInvalidatedException
        assertTrue(text.contains("throw VaultKeyInvalidatedException"), "Must throw VaultKeyInvalidatedException on failure")

        // Must not contain any plaintext SharedPreferences fallback
        assertFalse(
            text.contains("getSharedPreferences"),
            "Must never fall back to unencrypted getSharedPreferences"
        )

        // Must use AES-256-GCM
        assertTrue(
            text.contains("AES256_GCM"),
            "Must use MasterKey.KeyScheme.AES256_GCM"
        )
    }
}
