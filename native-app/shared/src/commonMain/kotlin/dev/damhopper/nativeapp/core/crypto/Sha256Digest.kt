package dev.damhopper.nativeapp.core.crypto

/**
 * Computes hexadecimal SHA-256 digest of exact raw byte array.
 */
expect fun computeSha256(bytes: ByteArray): String

/**
 * Computes hexadecimal SHA-256 digest of exact UTF-8 encoded string bytes.
 */
fun computeSha256(text: String): String = computeSha256(text.encodeToByteArray())
