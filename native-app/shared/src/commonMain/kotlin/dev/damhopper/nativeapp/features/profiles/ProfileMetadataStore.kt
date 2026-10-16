package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer

/**
 * Persists non-secret server profile metadata.
 * Passwords, tokens, challenges, and TOTP secrets must NEVER pass through this store.
 */
interface ProfileMetadataStore {
    suspend fun loadProfiles(): List<ServerProfile>
    suspend fun saveProfiles(profiles: List<ServerProfile>)
}

/**
 * In-memory profile metadata store for testing and initial bootstrap.
 */
class InMemoryProfileMetadataStore(
    initialProfiles: List<ServerProfile> = emptyList()
) : ProfileMetadataStore {
    private val mutex = Mutex()
    private var profiles: List<ServerProfile> = initialProfiles

    override suspend fun loadProfiles(): List<ServerProfile> = mutex.withLock {
        profiles.toList()
    }

    override suspend fun saveProfiles(profiles: List<ServerProfile>) = mutex.withLock {
        this.profiles = profiles.toList()
    }
}
