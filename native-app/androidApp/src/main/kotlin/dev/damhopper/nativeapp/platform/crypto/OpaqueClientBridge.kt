package dev.damhopper.nativeapp.platform.crypto

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Metadata record documenting the exact OPAQUE CipherSuite and derivation parameters.
 * Must match `server/src/crypto/opaque.rs` and `native-app/crypto-bridge/src/lib.rs`.
 */
object OpaqueCipherSuiteMetadata {
    const val SUITE_NAME = "DamHopperOpaqueSuite"
    const val OPRF_GROUP = "Ristretto255"
    const val KEY_EXCHANGE = "TripleDH<Ristretto255, Sha512>"
    const val KSF = "Identity"
    const val HKDF_SALT_SPEC = "32 zero bytes (RFC 5869 None default for SHA-256)"
    const val HKDF_INFO = "dam-hopper-aes-256-gcm-v1"
    const val AES_KEY_LENGTH_BYTES = 32
    const val JNI_LIB_NAME = "damhopper_crypto_bridge"
}

class OpaqueCryptoException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/**
 * Stateful registration session handle.
 */
class OpaqueRegistrationState(val handle: Long) : AutoCloseable {
    private var isClosed = false

    override fun close() {
        if (!isClosed) {
            isClosed = true
            OpaqueClientBridge.closeHandle(handle, isLogin = false)
        }
    }
}

/**
 * Stateful login session handle.
 */
class OpaqueLoginState(val handle: Long) : AutoCloseable {
    private var isClosed = false

    override fun close() {
        if (!isClosed) {
            isClosed = true
            OpaqueClientBridge.closeHandle(handle, isLogin = true)
        }
    }
}

data class OpaqueRegistrationStartResult(
    val state: OpaqueRegistrationState,
    val requestBytes: ByteArray
)

data class OpaqueLoginStartResult(
    val state: OpaqueLoginState,
    val requestBytes: ByteArray
)

data class OpaqueLoginFinishResult(
    val finalizationBytes: ByteArray,
    val aesKey: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is OpaqueLoginFinishResult) return false
        return finalizationBytes.contentEquals(other.finalizationBytes) &&
                aesKey.contentEquals(other.aesKey)
    }

    override fun hashCode(): Int {
        var result = finalizationBytes.contentHashCode()
        result = 31 * result + aesKey.contentHashCode()
        return result
    }

    override fun toString(): String =
        "OpaqueLoginFinishResult(finalizationBytes.size=${finalizationBytes.size}, aesKey=[REDACTED])"
}

/**
 * Client bridge for OPAQUE PAKE operations and HKDF AES-256-GCM key derivation.
 *
 * Implements JNI native bindings to `libdamhopper_crypto_bridge.so` when loaded,
 * and provides a pure-JVM fallback derivation for unit test environments.
 */
object OpaqueClientBridge {

    private var isNativeLibraryLoaded = false

    init {
        try {
            System.loadLibrary(OpaqueCipherSuiteMetadata.JNI_LIB_NAME)
            isNativeLibraryLoaded = true
        } catch (_: UnsatisfiedLinkError) {
            // In JVM unit tests or environments without native shared library loaded,
            // fallback behavior permits testing derivation and interface invariants.
            isNativeLibraryLoaded = false
        }
    }

    fun isNativeLoaded(): Boolean = isNativeLibraryLoaded

    /**
     * Phase 1 of Registration: generate registration request bytes and create state handle.
     */
    fun startRegistration(password: String): OpaqueRegistrationStartResult {
        require(password.isNotEmpty()) { "Password cannot be empty" }
        if (!isNativeLibraryLoaded) {
            throw OpaqueCryptoException("Native crypto library '${OpaqueCipherSuiteMetadata.JNI_LIB_NAME}' is not loaded; failing closed without insecure fallback")
        }
        val handleBuffer = ByteArray(8)
        val reqBytes = nativeRegisterStart(password, handleBuffer)
            ?: throw OpaqueCryptoException("nativeRegisterStart returned null")
        val handle = ByteBuffer.wrap(handleBuffer).order(ByteOrder.BIG_ENDIAN).long
        return OpaqueRegistrationStartResult(OpaqueRegistrationState(handle), reqBytes)
    }

    /**
     * Phase 2 of Registration: finish registration and generate upload record bytes.
     */
    fun finishRegistration(
        state: OpaqueRegistrationState,
        password: String,
        responseBytes: ByteArray
    ): ByteArray {
        require(responseBytes.isNotEmpty()) { "Response bytes cannot be empty" }
        if (!isNativeLibraryLoaded) {
            throw OpaqueCryptoException("Native crypto library '${OpaqueCipherSuiteMetadata.JNI_LIB_NAME}' is not loaded; failing closed without insecure fallback")
        }
        return nativeRegisterFinish(state.handle, password, responseBytes)
            ?: throw OpaqueCryptoException("nativeRegisterFinish returned null")
    }

    /**
     * Phase 1 of Login: generate credential request bytes and create state handle.
     */
    fun startLogin(password: String): OpaqueLoginStartResult {
        require(password.isNotEmpty()) { "Password cannot be empty" }
        if (!isNativeLibraryLoaded) {
            throw OpaqueCryptoException("Native crypto library '${OpaqueCipherSuiteMetadata.JNI_LIB_NAME}' is not loaded; failing closed without insecure fallback")
        }
        val handleBuffer = ByteArray(8)
        val reqBytes = nativeLoginStart(password, handleBuffer)
            ?: throw OpaqueCryptoException("nativeLoginStart returned null")
        val handle = ByteBuffer.wrap(handleBuffer).order(ByteOrder.BIG_ENDIAN).long
        return OpaqueLoginStartResult(OpaqueLoginState(handle), reqBytes)
    }

    /**
     * Phase 2 of Login: finish login, produce finalization bytes, and derive 32-byte AES key.
     */
    fun finishLogin(
        state: OpaqueLoginState,
        password: String,
        responseBytes: ByteArray
    ): OpaqueLoginFinishResult {
        require(responseBytes.isNotEmpty()) { "Response bytes cannot be empty" }
        if (!isNativeLibraryLoaded) {
            throw OpaqueCryptoException("Native crypto library '${OpaqueCipherSuiteMetadata.JNI_LIB_NAME}' is not loaded; failing closed without insecure fallback")
        }
        val aesKeyBuffer = ByteArray(OpaqueCipherSuiteMetadata.AES_KEY_LENGTH_BYTES)
        val finalizationBytes = nativeLoginFinish(state.handle, password, responseBytes, aesKeyBuffer)
            ?: throw OpaqueCryptoException("nativeLoginFinish returned null")
        return OpaqueLoginFinishResult(finalizationBytes, aesKeyBuffer)
    }

    /**
     * Pure HKDF-SHA256 expansion matching the server's exact derivation:
     *   Hkdf::<Sha256>::new(None, session_key).expand(b"dam-hopper-aes-256-gcm-v1", &mut aes_key)
     */
    fun deriveAesKey(sessionKey: ByteArray): ByteArray {
        require(sessionKey.isNotEmpty()) { "Session key cannot be empty" }

        // RFC 5869 Extract: PRK = HMAC-Hash(salt, IKM). When salt is None/empty, salt = HashLen zero bytes.
        val zeroSalt = ByteArray(32)
        val prkMac = Mac.getInstance("HmacSHA256")
        prkMac.init(SecretKeySpec(zeroSalt, "HmacSHA256"))
        val prk = prkMac.doFinal(sessionKey)

        // RFC 5869 Expand: OKM = HMAC-Hash(PRK, info || 0x01) for 32 bytes output
        val expandMac = Mac.getInstance("HmacSHA256")
        expandMac.init(SecretKeySpec(prk, "HmacSHA256"))
        val infoBytes = OpaqueCipherSuiteMetadata.HKDF_INFO.toByteArray(StandardCharsets.UTF_8)
        expandMac.update(infoBytes)
        expandMac.update(1.toByte())
        val okm = expandMac.doFinal()

        return okm.copyOf(OpaqueCipherSuiteMetadata.AES_KEY_LENGTH_BYTES)
    }

    fun closeHandle(handle: Long, isLogin: Boolean): Boolean {
        if (isNativeLibraryLoaded) {
            return nativeCloseHandle(handle, isLogin)
        }
        return true
    }

    fun encryptEnvelope(key: ByteArray, metadataJson: String, content: ByteArray): ByteArray {
        if (isNativeLibraryLoaded) {
            val res = nativeEncryptEnvelope(key, metadataJson, content)
            if (res != null) return res
        }
        return dev.damhopper.nativeapp.core.security.CryptoEnvelope.encrypt(key, metadataJson, content)
    }

    fun decryptEnvelope(key: ByteArray, envelopeBytes: ByteArray): Pair<String, ByteArray> {
        if (isNativeLibraryLoaded) {
            val res = nativeDecryptEnvelope(key, envelopeBytes)
            if (res != null && res.size == 2) {
                val meta = res[0] as String
                val content = res[1] as ByteArray
                return Pair(meta, content)
            }
        }
        return dev.damhopper.nativeapp.core.security.CryptoEnvelope.decrypt(key, envelopeBytes)
    }

    // ---------------------------------------------------------------------------
    // Native JNI Declarations
    // ---------------------------------------------------------------------------

    @JvmStatic
    private external fun nativeRegisterStart(password: String, outHandle: ByteArray): ByteArray?

    @JvmStatic
    private external fun nativeRegisterFinish(
        handle: Long,
        password: String,
        responseBytes: ByteArray
    ): ByteArray?

    @JvmStatic
    private external fun nativeLoginStart(password: String, outHandle: ByteArray): ByteArray?

    @JvmStatic
    private external fun nativeLoginFinish(
        handle: Long,
        password: String,
        responseBytes: ByteArray,
        outAesKey: ByteArray
    ): ByteArray?

    @JvmStatic
    private external fun nativeCloseHandle(handle: Long, isLogin: Boolean): Boolean

    @JvmStatic
    private external fun nativeEncryptEnvelope(key: ByteArray, metadataJson: String, content: ByteArray): ByteArray?

    @JvmStatic
    private external fun nativeDecryptEnvelope(key: ByteArray, envelope: ByteArray): Array<Any>?
}
