package dev.damhopper.nativeapp.features.profiles

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Thread-safe tracker for monotonic authentication attempts per profile.
 * Prevents race conditions and late asynchronous authentication callbacks.
 */
class AuthAttemptTracker {
    private val mutex = Mutex()
    private val watermarks = mutableMapOf<String, Long>()

    suspend fun startAttempt(profileId: String): AuthAttemptRef = mutex.withLock {
        val nextId = (watermarks[profileId] ?: 0L) + 1L
        watermarks[profileId] = nextId
        AuthAttemptRef(profileId, nextId)
    }

    suspend fun assertActive(attempt: AuthAttemptRef) = mutex.withLock {
        val current = watermarks[attempt.profileId]
        if (current == null || current != attempt.attemptId) {
            throw AuthAttemptStaleException(attempt)
        }
    }

    suspend fun invalidate(profileId: String) = mutex.withLock {
        val current = watermarks[profileId] ?: 0L
        watermarks[profileId] = current + 1L
    }
}
