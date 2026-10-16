package dev.damhopper.nativeapp.platform.crypto

import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OpaqueClientBridgeTest {

    @Test
    fun testCipherSuiteMetadataMatchesServer() {
        assertEquals("DamHopperOpaqueSuite", OpaqueCipherSuiteMetadata.SUITE_NAME)
        assertEquals("Ristretto255", OpaqueCipherSuiteMetadata.OPRF_GROUP)
        assertEquals("TripleDH<Ristretto255, Sha512>", OpaqueCipherSuiteMetadata.KEY_EXCHANGE)
        assertEquals("Identity", OpaqueCipherSuiteMetadata.KSF)
        assertEquals("dam-hopper-aes-256-gcm-v1", OpaqueCipherSuiteMetadata.HKDF_INFO)
        assertEquals(32, OpaqueCipherSuiteMetadata.AES_KEY_LENGTH_BYTES)
    }

    @Test
    fun testHkdfAesKeyDerivationDeterministicAndMatchesRfc5869GoldenVector() {
        val sessionKey = ByteArray(32) { (it * 7).toByte() }
        val derivedKey1 = OpaqueClientBridge.deriveAesKey(sessionKey)
        val derivedKey2 = OpaqueClientBridge.deriveAesKey(sessionKey)

        assertEquals(32, derivedKey1.size)
        assertTrue(derivedKey1.contentEquals(derivedKey2), "HKDF derivation must be deterministic")

        // Verify exact match against known HKDF-SHA256 golden test vector (matches Python & Rust test results)
        val hexOutput = derivedKey1.joinToString("") { "%02x".format(it) }
        assertEquals("78b435ccd1f36b95c5175310d2cf37a623854f3c98174f6d80bb5c20fe85c0b3", hexOutput)

        // Differing session key produces different derived key
        val sessionKeyDiff = ByteArray(32) { (it * 7 + 1).toByte() }
        val derivedKeyDiff = OpaqueClientBridge.deriveAesKey(sessionKeyDiff)
        assertFalse(derivedKey1.contentEquals(derivedKeyDiff))
    }

    @Test
    fun testFailsClosedWhenNativeLibraryUnavailable() {
        if (!OpaqueClientBridge.isNativeLoaded()) {
            assertFailsWith<OpaqueCryptoException>("Bridge must fail closed without insecure fallback") {
                OpaqueClientBridge.startRegistration("secret-password")
            }
            assertFailsWith<OpaqueCryptoException>("Bridge must fail closed without insecure fallback") {
                OpaqueClientBridge.startLogin("secret-password")
            }
        }
    }

    @Test
    fun testMaskingInToString() {
        val finishResult = OpaqueLoginFinishResult(
            finalizationBytes = "mock-finalization".toByteArray(StandardCharsets.UTF_8),
            aesKey = ByteArray(32) { 0x42 }
        )
        val str = finishResult.toString()
        assertTrue(str.contains("[REDACTED]"), "toString() must mask aesKey")
        assertFalse(str.contains("42424242"), "toString() must never expose key bytes")
    }
    @Test
    fun testValidationOfEmptyInputs() {
        assertFailsWith<IllegalArgumentException> {
            OpaqueClientBridge.startRegistration("")
        }

        assertFailsWith<IllegalArgumentException> {
            OpaqueClientBridge.startLogin("")
        }

        assertFailsWith<IllegalArgumentException> {
            OpaqueClientBridge.deriveAesKey(ByteArray(0))
        }
    }
}
