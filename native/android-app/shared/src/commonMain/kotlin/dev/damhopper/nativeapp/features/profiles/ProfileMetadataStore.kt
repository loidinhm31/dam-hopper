package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/**
 * Non-secret navigation state snapshot for restoring the user's active page/session across app switches.
 */
@Serializable
data class LastNavigationState(
    val profileId: String?,
    val stage: String,
    val project: String? = null,
    val sessionId: String? = null,
    val worktreePath: String? = null,
    val panel: String? = null,
)

/**
 * Persists non-secret server profile metadata.
 * Passwords, tokens, challenges, and TOTP secrets must NEVER pass through this store.
 */
interface ProfileMetadataStore {
    suspend fun loadProfiles(): List<ServerProfile>
    suspend fun saveProfiles(profiles: List<ServerProfile>)
    suspend fun loadActiveProfileId(): String? = null
    suspend fun saveActiveProfileId(id: String?) {}
    suspend fun loadLastNavigationState(): LastNavigationState? = null
    suspend fun saveLastNavigationState(state: LastNavigationState?) {}
}

/**
 * In-memory profile metadata store for testing and initial bootstrap.
 */
class InMemoryProfileMetadataStore(
    initialProfiles: List<ServerProfile> = emptyList(),
    initialActiveProfileId: String? = null
) : ProfileMetadataStore {
    private val mutex = Mutex()
    private var profiles: List<ServerProfile> = initialProfiles
    private var activeProfileId: String? = initialActiveProfileId
    private var lastNav: LastNavigationState? = null

    override suspend fun loadLastNavigationState(): LastNavigationState? = mutex.withLock { lastNav }
    override suspend fun saveLastNavigationState(state: LastNavigationState?) = mutex.withLock { lastNav = state }

    override suspend fun loadProfiles(): List<ServerProfile> = mutex.withLock {
        profiles.toList()
    }

    override suspend fun saveProfiles(profiles: List<ServerProfile>) = mutex.withLock {
        this.profiles = profiles.toList()
    }

    override suspend fun loadActiveProfileId(): String? = mutex.withLock {
        activeProfileId
    }

    override suspend fun saveActiveProfileId(id: String?) = mutex.withLock {
        activeProfileId = id
    }
}

