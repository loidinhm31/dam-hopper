package dev.damhopper.nativeapp.core.security

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

actual object PlatformCrypto {
    private const val GCM_TAG_LENGTH_BITS = 128
    private val secureRandom = SecureRandom()

    actual fun encryptAesGcm(key: ByteArray, iv: ByteArray, plaintext: ByteArray): ByteArray {
        require(key.size == 32) { "AES-256 key must be exactly 32 bytes, got ${key.size}" }
        require(iv.size == 12) { "AES-GCM IV must be exactly 12 bytes, got ${iv.size}" }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
        return cipher.doFinal(plaintext)
    }

    actual fun decryptAesGcm(key: ByteArray, iv: ByteArray, ciphertextAndTag: ByteArray): ByteArray {
        require(key.size == 32) { "AES-256 key must be exactly 32 bytes, got ${key.size}" }
        require(iv.size == 12) { "AES-GCM IV must be exactly 12 bytes, got ${iv.size}" }
        require(ciphertextAndTag.size >= 16) { "Ciphertext must include at least 16 bytes for auth tag" }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)
        return cipher.doFinal(ciphertextAndTag)
    }

    actual fun generateRandomBytes(size: Int): ByteArray {
        val bytes = ByteArray(size)
        secureRandom.nextBytes(bytes)
        return bytes
    }

    actual fun deriveHkdfSha256(ikm: ByteArray, salt: ByteArray?, info: ByteArray, length: Int): ByteArray {
        require(ikm.isNotEmpty()) { "IKM cannot be empty" }
        require(length in 1..255 * 32) { "Invalid output length for HKDF-SHA256" }

        val actualSalt = salt ?: ByteArray(32)
        val prkMac = Mac.getInstance("HmacSHA256")
        prkMac.init(SecretKeySpec(actualSalt, "HmacSHA256"))
        val prk = prkMac.doFinal(ikm)

        val prkSpec = SecretKeySpec(prk, "HmacSHA256")
        val okm = ByteArray(length)
        var t = ByteArray(0)
        var offset = 0
        var blockIndex = 1

        while (offset < length) {
            val expandMac = Mac.getInstance("HmacSHA256")
            expandMac.init(prkSpec)
            if (t.isNotEmpty()) {
                expandMac.update(t)
            }
            expandMac.update(info)
            expandMac.update(blockIndex.toByte())
            t = expandMac.doFinal()

            val toCopy = minOf(t.size, length - offset)
            System.arraycopy(t, 0, okm, offset, toCopy)
            offset += toCopy
            blockIndex++
        }

        return okm
    }
}
