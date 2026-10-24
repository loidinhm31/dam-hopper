package dev.damhopper.nativeapp.core.security

import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class CryptoSessionClosedException(message: String = "CryptoSession is closed") : IllegalStateException(message)

class CryptoSessionOwnerMismatchException(message: String) : IllegalStateException(message)

/**
 * Stateful, generation-fenced cryptographic session representing an authenticated OPAQUE session.
 * Holds the derived AES-256-GCM key in memory with explicit lifetime and zeroization on close.
 */
class CryptoSession(
    val sessionId: String,
    val ownerRef: ConnectionRef,
    aesKeyBytes: ByteArray,
    val createdAtEpochMs: Long = kotlinx.datetime.Clock.System.now().toEpochMilliseconds(),
) : AutoCloseable {
    init {
        require(sessionId.isNotBlank()) { "sessionId cannot be blank" }
        require(aesKeyBytes.size == CryptoEnvelope.KEY_LENGTH) {
            "AES key must be exactly ${CryptoEnvelope.KEY_LENGTH} bytes, got ${aesKeyBytes.size}"
        }
    }

    private val keyBytes: ByteArray = aesKeyBytes.copyOf()
    @kotlin.jvm.Volatile
    private var closed = false

    val isClosed: Boolean get() = closed

    /**
     * Asserts that the session is still active and bound to the expected connection generation.
     */
    fun assertValid(expectedOwner: ConnectionRef? = null) {
        if (closed) {
            throw CryptoSessionClosedException("CryptoSession '$sessionId' is closed")
        }
        if (expectedOwner != null) {
            if (ownerRef.profileId != expectedOwner.profileId || ownerRef.generation != expectedOwner.generation) {
                throw CryptoSessionOwnerMismatchException(
                    "CryptoSession owner mismatch: session owned by ${ownerRef.key}, current owner is ${expectedOwner.key}"
                )
            }
        }
    }

    /**
     * Encrypts plaintext payload with metadata JSON into the server envelope.
     */
    fun encrypt(metadataJson: String, content: ByteArray): ByteArray {
        assertValid()
        return CryptoEnvelope.encrypt(keyBytes, metadataJson, content)
    }

    /**
     * Decrypts server envelope into metadata JSON and plaintext content.
     */
    fun decrypt(envelopeBytes: ByteArray): Pair<String, ByteArray> {
        assertValid()
        return CryptoEnvelope.decrypt(keyBytes, envelopeBytes)
    }

    /**
     * Closes the session and wipes key material from memory.
     */
    override fun close() {
        if (!closed) {
            closed = true
            keyBytes.fill(0)
        }
    }
}

/**
 * Manages the active CryptoSession for the application, enforcing generation fences
 * and ensuring old sessions are wiped when connections retire or change profiles.
 */
class CryptoSessionManager {
    private val mutex = Mutex()
    private var activeSession: CryptoSession? = null

    suspend fun getActiveSession(expectedOwner: ConnectionRef? = null): CryptoSession? = mutex.withLock {
        val session = activeSession ?: return@withLock null
        if (session.isClosed) {
            activeSession = null
            return@withLock null
        }
        if (expectedOwner != null) {
            if (session.ownerRef.profileId != expectedOwner.profileId || session.ownerRef.generation != expectedOwner.generation) {
                session.close()
                activeSession = null
                return@withLock null
            }
        }
        session
    }

    suspend fun setSession(session: CryptoSession): Unit = mutex.withLock {
        if (activeSession != null && activeSession !== session) {
            activeSession?.close()
        }
        activeSession = session
    }

    suspend fun retireSession(owner: ConnectionRef): Unit = mutex.withLock {
        val current = activeSession
        if (current != null && current.ownerRef.profileId == owner.profileId && current.ownerRef.generation == owner.generation) {
            current.close()
            activeSession = null
        }
    }

    suspend fun closeAll(): Unit = mutex.withLock {
        activeSession?.close()
        activeSession = null
    }
}
