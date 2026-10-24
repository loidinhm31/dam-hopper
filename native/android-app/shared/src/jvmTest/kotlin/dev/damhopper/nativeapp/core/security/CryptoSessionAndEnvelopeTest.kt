package dev.damhopper.nativeapp.core.security

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class CryptoSessionAndEnvelopeTest {

    @Test
    fun testPlatformCryptoAesGcmRoundtrip() {
        val key = ByteArray(32) { (it + 1).toByte() }
        val iv = ByteArray(12) { (it + 10).toByte() }
        val plaintext = "Hello DamHopper AES-256-GCM Secure Workbench".encodeToByteArray()

        val ciphertextAndTag = PlatformCrypto.encryptAesGcm(key, iv, plaintext)
        assertEquals(plaintext.size + 16, ciphertextAndTag.size)

        val decrypted = PlatformCrypto.decryptAesGcm(key, iv, ciphertextAndTag)
        assertContentEquals(plaintext, decrypted)
    }

    @Test
    fun testPlatformCryptoHkdfSha256Parity() {
        val ikm = "opaque-session-key-32-bytes-test".encodeToByteArray()
        val info = "dam-hopper-aes-256-gcm-v1".encodeToByteArray()
        val key1 = PlatformCrypto.deriveHkdfSha256(ikm, null, info, 32)
        val key2 = PlatformCrypto.deriveHkdfSha256(ikm, ByteArray(32), info, 32)
        assertEquals(32, key1.size)
        assertContentEquals(key1, key2, "HKDF with null salt must default to 32 zero bytes")
    }

    @Test
    fun testCryptoEnvelopePackAndUnpack() {
        val metaJson = """{"name":"document.pdf","size":12345,"type":"application/pdf"}"""
        val content = ByteArray(50) { it.toByte() }

        val packed = CryptoEnvelope.packPlaintext(metaJson, content)
        val (unpackedMeta, unpackedContent) = CryptoEnvelope.unpackPlaintext(packed)

        assertEquals(metaJson, unpackedMeta)
        assertContentEquals(content, unpackedContent)
    }

    @Test
    fun testCryptoEnvelopeMetadataSizeCap() {
        val hugeMeta = "x".repeat(5000)
        val content = "content".encodeToByteArray()
        assertFailsWith<IllegalArgumentException> {
            CryptoEnvelope.packPlaintext(hugeMeta, content)
        }
    }

    @Test
    fun testCryptoEnvelopeEncryptAndDecryptRoundtrip() {
        val key = ByteArray(32) { 42.toByte() }
        val metaJson = """{"path":"src/test.kt","size":100}"""
        val content = "println(\"Hello World\")".encodeToByteArray()

        val envelope = CryptoEnvelope.encrypt(key, metaJson, content)
        assertTrue(envelope.size >= CryptoEnvelope.IV_LENGTH + CryptoEnvelope.TAG_LENGTH)

        val (decMeta, decContent) = CryptoEnvelope.decrypt(key, envelope)
        assertEquals(metaJson, decMeta)
        assertContentEquals(content, decContent)
    }

    @Test
    fun testCryptoEnvelopeTamperRejection() {
        val key = ByteArray(32) { 77.toByte() }
        val metaJson = """{"name":"file.txt","size":10}"""
        val content = "0123456789".encodeToByteArray()

        val envelope = CryptoEnvelope.encrypt(key, metaJson, content)

        // 1. Bit flip in ciphertext
        val tampered = envelope.copyOf()
        tampered[tampered.size - 1] = (tampered[tampered.size - 1].toInt() xor 0x01).toByte()
        assertFailsWith<CryptoEnvelopeException> {
            CryptoEnvelope.decrypt(key, tampered)
        }

        // 2. Wrong key
        val wrongKey = ByteArray(32) { 99.toByte() }
        assertFailsWith<CryptoEnvelopeException> {
            CryptoEnvelope.decrypt(wrongKey, envelope)
        }

        // 3. Truncated envelope
        val truncated = envelope.copyOfRange(0, 20)
        assertFailsWith<CryptoEnvelopeException> {
            CryptoEnvelope.decrypt(key, truncated)
        }
    }

    @Test
    fun testCryptoSessionLifecycleAndZeroization() {
        val owner = ConnectionRef("profile-alpha", 1L)
        val key = ByteArray(32) { 0x5A.toByte() }
        val session = CryptoSession("session-test-123", owner, key)

        assertFalse(session.isClosed)
        session.assertValid(owner)

        // Mismatched owner assertion fails
        val otherOwner = ConnectionRef("profile-alpha", 2L)
        assertFailsWith<CryptoSessionOwnerMismatchException> {
            session.assertValid(otherOwner)
        }

        // Close wipes session
        session.close()
        assertTrue(session.isClosed)

        assertFailsWith<CryptoSessionClosedException> {
            session.assertValid()
        }
        assertFailsWith<CryptoSessionClosedException> {
            session.encrypt("{}", "test".encodeToByteArray())
        }
    }

    @Test
    fun testCryptoSessionManagerGenerationScoping() = runTest {
        val manager = CryptoSessionManager()
        val owner1 = ConnectionRef("profile-omega", 1L)
        val key = ByteArray(32) { 0x3C.toByte() }
        val session1 = CryptoSession("sess-1", owner1, key)

        manager.setSession(session1)
        assertSame(session1, manager.getActiveSession(owner1))

        // Querying with retired generation retires and wipes session
        val owner2 = ConnectionRef("profile-omega", 2L)
        assertNull(manager.getActiveSession(owner2))
        assertTrue(session1.isClosed, "Stale session must be closed upon owner mismatch")

        // New session replacement closes prior session
        val session2 = CryptoSession("sess-2", owner2, key)
        manager.setSession(session2)
        assertSame(session2, manager.getActiveSession(owner2))

        val session3 = CryptoSession("sess-3", owner2, key)
        manager.setSession(session3)
        assertTrue(session2.isClosed, "Prior active session must be closed when replaced")

        manager.closeAll()
        assertTrue(session3.isClosed)
        assertNull(manager.getActiveSession())
    }
}
