package dev.damhopper.nativeapp.core.security

/**
 * Platform cryptographic primitives for AES-256-GCM and HKDF-SHA256.
 */
expect object PlatformCrypto {
    /**
     * Encrypts plaintext with AES-256-GCM using a 12-byte IV and 128-bit authentication tag.
     * Returns ciphertext with the 16-byte tag appended.
     */
    fun encryptAesGcm(key: ByteArray, iv: ByteArray, plaintext: ByteArray): ByteArray

    /**
     * Decrypts ciphertext+tag with AES-256-GCM using the 12-byte IV.
     * Throws an exception if authentication tag verification fails.
     */
    fun decryptAesGcm(key: ByteArray, iv: ByteArray, ciphertextAndTag: ByteArray): ByteArray

    /**
     * Generates cryptographically secure random bytes.
     */
    fun generateRandomBytes(size: Int): ByteArray

    /**
     * Derives key bytes using HKDF-SHA256 (RFC 5869).
     */
    fun deriveHkdfSha256(ikm: ByteArray, salt: ByteArray?, info: ByteArray, length: Int): ByteArray
}
