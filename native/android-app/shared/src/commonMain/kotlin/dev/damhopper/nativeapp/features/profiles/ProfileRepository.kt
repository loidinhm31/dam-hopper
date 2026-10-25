package dev.damhopper.nativeapp.features.profiles

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Result of the final profile/registry-qualified admission of a manual Agents route. */
enum class ProfileRouteAdmission { COMMITTED, BUSY, STALE }

/**
 * Manages server profiles lifecycle, auth sessions, and credential custody.
 * Enforces generation retirement on edits/rotation/logout and monotonic attempt fencing.
 *
 * Identity/credential discipline (C2a/C2a1):
 * - Endpoint/account/auth/credential changes first retire (or remove) the profile connection through
 *   the registry's awaited drain, then replace credentials, then publish identity/auth state.
 *   A failed or cancelled retirement leaves credentials and identity untouched.
 * - The profile [mutex] may be held for the whole drain, so retirement barriers and observers MUST NOT
 *   call back into this repository or the registry (transitive no-reentry).
 * - API/WS client creation and every identity/auth commit are serialized under the same [mutex];
 *   commits are applied only inside `registry.admitCurrentOwner(successor)`, after a caller-activity
 *   check, so a cancelled caller or a superseded/pending/failed transition never publishes identity.
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

        val updatedProfile = oldProfile.copy(name = name.trim(), baseUrl = validatedUrl, username = username?.trim())
        val updatedList = _profiles.value.map { if (it.id == id) updatedProfile else it }
        val endpointChanged = oldProfile.baseUrl != validatedUrl || oldProfile.username != username

        if (endpointChanged) {
            attemptTracker.invalidate(id)
            // Drain first: nothing below runs when retirement fails or the caller is cancelled.
            val successor = retireProfileConnection(id)
            currentCoroutineContext().ensureActive()
            vault.clearToken(id, oldProfile.baseUrl)
            metadataStore.saveProfiles(updatedList)
            commitIdentity(successor) {
                _authStatuses.value = _authStatuses.value + (id to AuthStatus.LoginRequired(
                    code = AuthErrorCodes.AUTH_REQUIRED,
                    error = "Endpoint or account changed"
                ))
                _profiles.value = _profiles.value.map { if (it.id == id) updatedProfile else it }
            }
        } else {
            metadataStore.saveProfiles(updatedList)
            currentCoroutineContext().ensureActive()
            _profiles.value = _profiles.value.map { if (it.id == id) updatedProfile else it }
        }
        updatedProfile
    }

    suspend fun deleteProfile(id: String) = mutex.withLock {
        attemptTracker.invalidate(id)
        // Awaited drain with removal disposition: no successor authority is ever published.
        registry.removeProfile(id)
        currentCoroutineContext().ensureActive()
        vault.clearAllForProfile(id)

        val updated = _profiles.value.filter { it.id != id }
        metadataStore.saveProfiles(updated)
        val newActive = if (_activeProfileId.value == id) updated.firstOrNull()?.id else _activeProfileId.value
        if (_activeProfileId.value == id) metadataStore.saveActiveProfileId(newActive)
        currentCoroutineContext().ensureActive()
        _profiles.value = updated
        _activeProfileId.value = newActive
        _authStatuses.value = _authStatuses.value - id
    }

    suspend fun selectProfile(id: String) = mutex.withLock {
        require(_profiles.value.any { it.id == id }) { "Profile does not exist: $id" }
        _activeProfileId.value = id
        metadataStore.saveActiveProfileId(id)
    }

    /**
     * Persistence-only follow-up of a committed manual route: saves [id] as the persisted active profile iff it is
     * still the published active profile, so a late write can never resurrect an older destination after newer
     * navigation or another profile choice.
     */
    suspend fun persistActiveProfileIfCurrent(id: String): Boolean = mutex.withLock {
        if (_activeProfileId.value != id || _profiles.value.none { it.id == id }) return@withLock false
        metadataStore.saveActiveProfileId(id)
        true
    }

    /**
     * First two awaited gates of the manual Agents route admission: the existing profile [mutex], an exact
     * profile/endpoint/authenticated-account check, then the registry's `admitCurrentOwner`. [admitRoute] is
     * exclusively the private known roster -> socket -> reducer try-gate chain (never a user callback); it receives
     * the fixed non-suspending `publishActiveProfile` which MUST be called from the deepest admitted leaf only. A
     * registry denial before [admitRoute] runs is [ProfileRouteAdmission.STALE]; a BUSY from the chain is returned as is.
     */
    suspend fun commitExistingProfileRoute(
        connection: ConnectionRef,
        endpoint: String,
        accountUser: String,
        admitRoute: (publishActiveProfile: () -> Unit) -> ProfileRouteAdmission,
    ): ProfileRouteAdmission = mutex.withLock {
        val profileId = connection.profileId
        val profile = _profiles.value.find { it.id == profileId } ?: return@withLock ProfileRouteAdmission.STALE
        if (WorkspaceFileOwner.normalizeBaseUrl(profile.baseUrl) != WorkspaceFileOwner.normalizeBaseUrl(endpoint)) {
            return@withLock ProfileRouteAdmission.STALE
        }
        val auth = _authStatuses.value[profileId] as? AuthStatus.Authenticated
            ?: return@withLock ProfileRouteAdmission.STALE
        if (auth.session.user != accountUser) return@withLock ProfileRouteAdmission.STALE
        var result = ProfileRouteAdmission.STALE
        registry.admitCurrentOwner(connection) {
            result = admitRoute { _activeProfileId.value = profileId }
            result == ProfileRouteAdmission.COMMITTED
        }
        result
    }

    /**
     * Serialized with identity/auth commits. The profile snapshot and connection ref are read together
     * under the profile mutex; a pending or failed retirement makes the registry throw OWNER_MISMATCH
     * instead of waiting or allocating a new generation.
     */
    suspend fun getOrCreateApiClient(profileId: String): ApiClient = mutex.withLock {
        val profile = _profiles.value.find { it.id == profileId }
            ?: throw IllegalArgumentException("Profile not found: $profileId")
        val conn = registry.getOrCreateConnection(profileId)
        apiClientFactory(conn, profile.baseUrl) {
            vault.getToken(profileId, profile.baseUrl)
        }
    }

    suspend fun getOrCreateWsConnection(profileId: String): dev.damhopper.nativeapp.core.transport.WsConnection = mutex.withLock {
        val profile = _profiles.value.find { it.id == profileId }
            ?: throw IllegalArgumentException("Profile not found: $profileId")
        val conn = registry.getOrCreateConnection(profileId)
        dev.damhopper.nativeapp.core.transport.WsConnection(
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

        // Drain first, then replace credentials, then publish auth state.
        val successor = retireProfileConnection(profileId)
        currentCoroutineContext().ensureActive()
        if (attempt != null) attemptTracker.assertActive(attempt)
        vault.storeToken(profileId, profile.baseUrl, session.token)
        commitIdentity(successor) {
            _authStatuses.value = _authStatuses.value + (profileId to AuthStatus.Authenticated(session))
        }
    }

    suspend fun logout(profileId: String) {
        val (profileToRevoke, tokenToRevoke) = mutex.withLock {
            attemptTracker.invalidate(profileId)
            val profile = _profiles.value.find { it.id == profileId }
            val token = profile?.let { vault.getToken(profileId, it.baseUrl) }
            // Drain first: credential removal and auth-loss publication wait for it.
            val successor = retireProfileConnection(profileId)
            currentCoroutineContext().ensureActive()
            if (profile != null) {
                vault.clearToken(profileId, profile.baseUrl)
            }
            commitIdentity(successor) {
                _authStatuses.value = _authStatuses.value + (profileId to AuthStatus.LoginRequired(
                    code = AuthErrorCodes.AUTH_REQUIRED,
                    error = "Logged out"
                ))
            }
            Pair(profile, token)
        }

        if (profileToRevoke != null && tokenToRevoke != null) {
            try {
                val tempConn = registry.getCurrentConnection(profileId) ?: ConnectionRef(profileId, 0L)
                val tempClient = apiClientFactory(tempConn, profileToRevoke.baseUrl) { tokenToRevoke }
                AuthRepository(tempClient).logout()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
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
            val expectedOwner = ConnectionRef(profileId, expectedGen)
            // Pending/failed transitions and superseded generations make the registry deny this result.
            if (currentProfile != null && registry.isCurrentOwner(expectedOwner)) {
                if (status is AuthStatus.LoginRequired) {
                    vault.clearToken(profileId, currentProfile.baseUrl)
                }
                currentCoroutineContext().ensureActive()
                // false => owner superseded or in transition: the stale status result is discarded.
                registry.admitCurrentOwner(expectedOwner) {
                    _authStatuses.value = _authStatuses.value + (profileId to status)
                    true
                }
            }
            Unit
        }
        return status
    }

    /**
     * Retires the profile's connection through the registry's awaited drain and returns the real
     * successor. Throws if the profile is in a pending/failed transition or the drain fails.
     */
    private suspend fun retireProfileConnection(profileId: String): ConnectionRef {
        val conn = registry.getCurrentConnection(profileId) ?: registry.getOrCreateConnection(profileId)
        return registry.retireConnection(conn)
    }

    /**
     * Applies a non-suspending identity/auth publication only if [owner] is still the current
     * available authority and the caller is still active; otherwise nothing is published.
     */
    private suspend fun commitIdentity(owner: ConnectionRef, commit: () -> Unit) {
        currentCoroutineContext().ensureActive()
        val committed = registry.admitCurrentOwner(owner) {
            commit()
            true
        }
        if (!committed) {
            throw ConnectionOwnerError(
                "Identity commit for $owner rejected: connection authority changed or is in transition",
                ConnectionErrorReason.OWNER_MISMATCH,
            )
        }
    }
}
