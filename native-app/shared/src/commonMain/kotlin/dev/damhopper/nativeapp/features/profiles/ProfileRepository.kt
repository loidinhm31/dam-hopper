package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Manages server profiles lifecycle, auth sessions, and credential custody.
 * Enforces generation retirement on edits/rotation/logout and monotonic attempt fencing.
 */
class ProfileRepository(
    val vault: CredentialVault,
    val registry: ConnectionRegistry,
    private val metadataStore: ProfileMetadataStore = InMemoryProfileMetadataStore(),
    private val apiClientFactory: (ConnectionRef, String, suspend () -> String?) -> ApiClient =
        { ref, url, token -> ApiClient(ref, url, token, registry) }
) {
    private val mutex = Mutex()
    private val _profiles = MutableStateFlow<List<ServerProfile>>(emptyList())
    val profiles: StateFlow<List<ServerProfile>> = _profiles.asStateFlow()

    private val _activeProfileId = MutableStateFlow<String?>(null)
    val activeProfileId: StateFlow<String?> = _activeProfileId.asStateFlow()

    private val _authStatuses = MutableStateFlow<Map<String, AuthStatus>>(emptyMap())
    val authStatuses: StateFlow<Map<String, AuthStatus>> = _authStatuses.asStateFlow()

    val attemptTracker = AuthAttemptTracker()

    suspend fun initialize() {
        val loaded = metadataStore.loadProfiles()
        val persistedActiveId = metadataStore.loadActiveProfileId()
        mutex.withLock {
            _profiles.value = loaded
            val resolvedActive = when {
                persistedActiveId != null && loaded.any { it.id == persistedActiveId } -> persistedActiveId
                _activeProfileId.value != null && loaded.any { it.id == _activeProfileId.value } -> _activeProfileId.value
                loaded.isNotEmpty() -> loaded.first().id
                else -> null
            }
            _activeProfileId.value = resolvedActive
        }
    }

    suspend fun addProfile(name: String, baseUrl: String, username: String? = null): ServerProfile {
        val validatedUrl = ServerProfile.validateServerUrl(baseUrl).getOrThrow()
        val newProfile = ServerProfile(ServerProfile.generateId(), name.trim(), validatedUrl, username?.trim())
        mutex.withLock {
            val updated = _profiles.value + newProfile
            _profiles.value = updated
            metadataStore.saveProfiles(updated)
            if (_activeProfileId.value == null) {
                _activeProfileId.value = newProfile.id
                metadataStore.saveActiveProfileId(newProfile.id)
            }
        }
        return newProfile
    }

    suspend fun updateProfile(id: String, name: String, baseUrl: String, username: String?): ServerProfile = mutex.withLock {
        val validatedUrl = ServerProfile.validateServerUrl(baseUrl).getOrThrow()
        val oldProfile = _profiles.value.find { it.id == id }
            ?: throw IllegalArgumentException("Profile not found: $id")

        val endpointChanged = oldProfile.baseUrl != validatedUrl || oldProfile.username != username
        if (endpointChanged) {
            attemptTracker.invalidate(id)
            vault.clearToken(id, oldProfile.baseUrl)
            retireProfileConnection(id)
            val statusMap = _authStatuses.value.toMutableMap()
            statusMap[id] = AuthStatus.LoginRequired(
                code = AuthErrorCodes.AUTH_REQUIRED,
                error = "Endpoint or account changed"
            )
            _authStatuses.value = statusMap
        }

        val updatedProfile = oldProfile.copy(name = name.trim(), baseUrl = validatedUrl, username = username?.trim())

        val updatedList = _profiles.value.map { if (it.id == id) updatedProfile else it }
        _profiles.value = updatedList
        metadataStore.saveProfiles(updatedList)
        updatedProfile
    }

    suspend fun deleteProfile(id: String) = mutex.withLock {
        attemptTracker.invalidate(id)
        retireProfileConnection(id)
        vault.clearAllForProfile(id)

        val updated = _profiles.value.filter { it.id != id }
        _profiles.value = updated
        metadataStore.saveProfiles(updated)
        if (_activeProfileId.value == id) {
            val newActive = updated.firstOrNull()?.id
            _activeProfileId.value = newActive
            metadataStore.saveActiveProfileId(newActive)
        }
        val statusMap = _authStatuses.value.toMutableMap()
        statusMap.remove(id)
        _authStatuses.value = statusMap
    }

    suspend fun selectProfile(id: String) = mutex.withLock {
        require(_profiles.value.any { it.id == id }) { "Profile does not exist: $id" }
        _activeProfileId.value = id
        metadataStore.saveActiveProfileId(id)
    }

    suspend fun getOrCreateApiClient(profileId: String): ApiClient {
        val profile = _profiles.value.find { it.id == profileId }
            ?: throw IllegalArgumentException("Profile not found: $profileId")
        val conn = registry.getOrCreateConnection(profileId)
        return apiClientFactory(conn, profile.baseUrl) {
            vault.getToken(profileId, profile.baseUrl)
        }
    }

    suspend fun getOrCreateWsConnection(profileId: String): dev.damhopper.nativeapp.core.transport.WsConnection {
        val profile = _profiles.value.find { it.id == profileId }
            ?: throw IllegalArgumentException("Profile not found: $profileId")
        val conn = registry.getOrCreateConnection(profileId)
        return dev.damhopper.nativeapp.core.transport.WsConnection(
            connection = conn,
            baseUrl = profile.baseUrl,
            authTokenProvider = {
                vault.getToken(profileId, profile.baseUrl)
            },
            registry = registry
        )
    }

    suspend fun applyAuthenticatedSession(
        profileId: String,
        session: AuthSession,
        attempt: AuthAttemptRef?
    ) = mutex.withLock {
        if (attempt != null) {
            require(attempt.profileId == profileId) {
                "Attempt profileId ${attempt.profileId} does not match target profileId $profileId"
            }
            attemptTracker.assertActive(attempt)
        }
        val profile = _profiles.value.find { it.id == profileId }
            ?: throw IllegalArgumentException("Profile not found: $profileId")

        vault.storeToken(profileId, profile.baseUrl, session.token)
        retireProfileConnection(profileId)

        val statusMap = _authStatuses.value.toMutableMap()
        statusMap[profileId] = AuthStatus.Authenticated(session)
        _authStatuses.value = statusMap
    }

    suspend fun logout(profileId: String) {
        val (profileToRevoke, tokenToRevoke) = mutex.withLock {
            attemptTracker.invalidate(profileId)
            val profile = _profiles.value.find { it.id == profileId }
            val token = profile?.let { vault.getToken(profileId, it.baseUrl) }
            if (profile != null) {
                vault.clearToken(profileId, profile.baseUrl)
            }
            retireProfileConnection(profileId)
            val statusMap = _authStatuses.value.toMutableMap()
            statusMap[profileId] = AuthStatus.LoginRequired(
                code = AuthErrorCodes.AUTH_REQUIRED,
                error = "Logged out"
            )
            _authStatuses.value = statusMap
            Pair(profile, token)
        }

        if (profileToRevoke != null && tokenToRevoke != null) {
            try {
                val tempConn = registry.getCurrentConnection(profileId) ?: ConnectionRef(profileId, 0L)
                val tempClient = apiClientFactory(tempConn, profileToRevoke.baseUrl) { tokenToRevoke }
                AuthRepository(tempClient).logout()
            } catch (_: Exception) {
                // Best effort remote revocation
            }
        }
    }

    suspend fun refreshAuthStatus(profileId: String): AuthStatus {
        val (client, expectedGen) = mutex.withLock {
            val profile = _profiles.value.find { it.id == profileId }
                ?: throw IllegalArgumentException("Profile not found: $profileId")
            val conn = registry.getOrCreateConnection(profileId)
            val cl = apiClientFactory(conn, profile.baseUrl) {
                vault.getToken(profileId, profile.baseUrl)
            }
            Pair(cl, conn.generation)
        }

        val authRepo = AuthRepository(client)
        val status = authRepo.checkAuthStatus()

        mutex.withLock {
            val currentProfile = _profiles.value.find { it.id == profileId }
            val currentConn = registry.getCurrentConnection(profileId)
            if (currentProfile != null && currentConn?.generation == expectedGen) {
                if (status is AuthStatus.LoginRequired) {
                    vault.clearToken(profileId, currentProfile.baseUrl)
                }
                val statusMap = _authStatuses.value.toMutableMap()
                statusMap[profileId] = status
                _authStatuses.value = statusMap
            }
        }
        return status
    }

    private suspend fun retireProfileConnection(profileId: String) {
        val conn = registry.getCurrentConnection(profileId) ?: registry.getOrCreateConnection(profileId)
        registry.retireConnection(conn)
    }
}
