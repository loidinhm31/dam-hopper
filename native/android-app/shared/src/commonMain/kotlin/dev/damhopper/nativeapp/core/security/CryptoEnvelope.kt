package dev.damhopper.nativeapp.core.security

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class FileBlobMetadata(
    val name: String,
    val size: Long,
    val type: String = "application/octet-stream"
)

@Serializable
data class TextBlobMetadata(
    val path: String,
    val size: Long
)

class CryptoEnvelopeException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

object CryptoEnvelope {
    const val IV_LENGTH: Int = 12
    const val TAG_LENGTH: Int = 16
    const val METADATA_MAX_LENGTH: Int = 4096
    const val KEY_LENGTH: Int = 32

    private val json = Json { ignoreUnknownKeys = true }

    fun buildFileMetadataJson(name: String, size: Long, type: String = "application/octet-stream"): String =
        json.encodeToString(FileBlobMetadata(name = name, size = size, type = type))

    fun buildTextMetadataJson(path: String, size: Long): String =
        json.encodeToString(TextBlobMetadata(path = path, size = size))

    /**
     * Packs metadata JSON, 0x00 delimiter, and content bytes into a single plaintext array.
     */
    fun packPlaintext(metadataJson: String, content: ByteArray): ByteArray {
        val metaBytes = metadataJson.encodeToByteArray()
        require(metaBytes.size <= METADATA_MAX_LENGTH) {
            "Metadata section exceeds maximum length of $METADATA_MAX_LENGTH bytes (was ${metaBytes.size})"
        }
        val plaintext = ByteArray(metaBytes.size + 1 + content.size)
        metaBytes.copyInto(plaintext, destinationOffset = 0)
        plaintext[metaBytes.size] = 0x00
        content.copyInto(plaintext, destinationOffset = metaBytes.size + 1)
        return plaintext
    }

    /**
     * Unpacks plaintext into metadata JSON string and content bytes.
     */
    fun unpackPlaintext(plaintext: ByteArray): Pair<String, ByteArray> {
        val sepIdx = plaintext.indexOf(0x00.toByte())
        if (sepIdx < 0) {
            throw CryptoEnvelopeException("Plaintext missing metadata separator (0x00)")
        }
        if (sepIdx > METADATA_MAX_LENGTH) {
            throw CryptoEnvelopeException("Metadata section too large: $sepIdx bytes (max $METADATA_MAX_LENGTH)")
        }
        val metaJson = try {
            plaintext.decodeToString(startIndex = 0, endIndex = sepIdx)
        } catch (e: Exception) {
            throw CryptoEnvelopeException("Metadata is not valid UTF-8", e)
        }
        val content = plaintext.copyOfRange(sepIdx + 1, plaintext.size)
        return Pair(metaJson, content)
    }

    /**
     * Encrypts metadata and content into the server-compatible envelope:
     * `iv(12) || ciphertext + tag(16)`.
     */
    fun encrypt(key: ByteArray, metadataJson: String, content: ByteArray): ByteArray {
        require(key.size == KEY_LENGTH) { "AES key must be exactly $KEY_LENGTH bytes" }
        val iv = PlatformCrypto.generateRandomBytes(IV_LENGTH)
        val plaintext = packPlaintext(metadataJson, content)
        val ctAndTag = try {
            PlatformCrypto.encryptAesGcm(key, iv, plaintext)
        } finally {
            plaintext.fill(0)
        }
        val envelope = ByteArray(IV_LENGTH + ctAndTag.size)
        iv.copyInto(envelope, destinationOffset = 0)
        ctAndTag.copyInto(envelope, destinationOffset = IV_LENGTH)
        return envelope
    }

    /**
     * Decrypts envelope `iv(12) || ciphertext + tag(16)` into metadata JSON string and content bytes.
     */
    fun decrypt(key: ByteArray, envelopeBytes: ByteArray): Pair<String, ByteArray> {
        require(key.size == KEY_LENGTH) { "AES key must be exactly $KEY_LENGTH bytes" }
        if (envelopeBytes.size < IV_LENGTH + TAG_LENGTH) {
            throw CryptoEnvelopeException("Encrypted envelope too short: ${envelopeBytes.size} bytes (min ${IV_LENGTH + TAG_LENGTH})")
        }
        val iv = envelopeBytes.copyOfRange(0, IV_LENGTH)
        val ctAndTag = envelopeBytes.copyOfRange(IV_LENGTH, envelopeBytes.size)

        val plaintext = try {
            PlatformCrypto.decryptAesGcm(key, iv, ctAndTag)
        } catch (e: Exception) {
            throw CryptoEnvelopeException("AES-GCM decryption failed — wrong key or corrupted data", e)
        }

        return try {
            unpackPlaintext(plaintext)
        } finally {
            plaintext.fill(0)
        }
    }
}
