package dev.damhopper.nativeapp.core.crypto

import java.security.MessageDigest

actual fun computeSha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val hash = digest.digest(bytes)
    val sb = StringBuilder(hash.size * 2)
    for (b in hash) {
        val v = b.toInt() and 0xFF
        if (v < 16) sb.append('0')
        sb.append(v.toString(16))
    }
    return sb.toString()
}
