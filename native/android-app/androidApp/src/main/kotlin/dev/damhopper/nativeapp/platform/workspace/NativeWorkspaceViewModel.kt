package dev.damhopper.nativeapp.platform.workspace

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.notifications.NotificationCoordinator
import dev.damhopper.nativeapp.core.notifications.NotificationFeedState
import dev.damhopper.nativeapp.core.notifications.NotificationTarget
import dev.damhopper.nativeapp.core.notifications.toServerSafeLongOrNull
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.core.transport.WsState
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.host.IdleConsentController
import dev.damhopper.nativeapp.features.host.IdleSuspendRepository
import dev.damhopper.nativeapp.features.host.UsageController
import dev.damhopper.nativeapp.features.host.UsageRepository
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.features.settings.AgentIntegrationRepository
import dev.damhopper.nativeapp.features.settings.RemoteConfigEditor
import dev.damhopper.nativeapp.features.settings.RemoteConfigRepository
import dev.damhopper.nativeapp.features.settings.SettingsBinding
import dev.damhopper.nativeapp.features.settings.SettingsBusyKind
import dev.damhopper.nativeapp.features.settings.SettingsDiagnosticsInput
import dev.damhopper.nativeapp.features.settings.SettingsDocumentKind
import dev.damhopper.nativeapp.features.settings.SettingsDocumentPort
import dev.damhopper.nativeapp.features.settings.SettingsDocumentResult
import dev.damhopper.nativeapp.features.settings.SettingsDocumentWorkflow
import dev.damhopper.nativeapp.features.settings.SettingsDiagnostics
import dev.damhopper.nativeapp.features.settings.SettingsOperation
import dev.damhopper.nativeapp.features.settings.SettingsOwner
import dev.damhopper.nativeapp.features.settings.SettingsOwnerResolver
import dev.damhopper.nativeapp.features.settings.SettingsRepository
import dev.damhopper.nativeapp.features.settings.SettingsScreenServices
import dev.damhopper.nativeapp.features.settings.SettingsTargetServices
import dev.damhopper.nativeapp.features.settings.createNotificationCoordinator
import dev.damhopper.nativeapp.features.settings.fetchRuntimeAgentPaths
import dev.damhopper.nativeapp.features.settings.hostMutationAuthority
import dev.damhopper.nativeapp.features.terminal.AcceptedLiveAttention
import dev.damhopper.nativeapp.features.terminal.AgentAdmission
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentPathsVerification
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.ExtensionStatusReport
import dev.damhopper.nativeapp.features.terminal.IntegrationOwner
import dev.damhopper.nativeapp.features.terminal.IntegrationReadiness
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessProvider
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessState
import dev.damhopper.nativeapp.features.terminal.NativeIntegrationStatusReport
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.core.lifecycle.LifecycleState
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsFilterCodec
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsProjector
import dev.damhopper.nativeapp.features.terminal.RetainedTerminalAgentsService
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.platform.storage.AndroidTerminalAgentsFilterStore
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentFactory
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationAudio
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationPlatform
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.storage.AndroidCommandHistoryStore
import dev.damhopper.nativeapp.platform.storage.AndroidPreferencesStore
import dev.damhopper.nativeapp.platform.storage.AndroidProfileMetadataStore
import dev.damhopper.nativeapp.platform.vault.AndroidCredentialVault
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.screens.ObservableCommandHistory
import dev.damhopper.nativeapp.ui.screens.PreferenceAccess
import dev.damhopper.nativeapp.ui.screens.RetainedRootServices
import dev.damhopper.nativeapp.features.settings.HardwareShortcutRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Process-wide nonce: a notification created by another process lifetime can never route (cold click). */
object ProcessInstance {
    val id: String = UUID.randomUUID().toString()
}

/**
 * Runs every step even when earlier ones fail and rethrows the aggregate (cancellation preferred as primary,
 * the others suppressed), so no cleanup is ever skipped because a previous one threw.
 */

internal suspend fun attemptAllSuspending(steps: List<suspend () -> Unit>) {
    val failures = ArrayList<Throwable>()
    for (step in steps) {
        try {
            step()
        } catch (t: Throwable) {
            failures += t
        }
    }
    if (failures.isEmpty()) return
    val primary = failures.firstOrNull { it is CancellationException } ?: failures.first()
    for (other in failures) if (other !== primary) primary.addSuppressed(other)
    throw primary
}

// ------------------------------------------------------------------------------------------------------
// Runtime readiness / effect gate (C3a)
// ------------------------------------------------------------------------------------------------------

/**
 * Retained runtime-readiness provider: ONE readiness/effect [Mutex] serializes publication, revision, revocation and
 * [withVerified] (the final exact-key / current-runtime / VERIFIED / registry-availability check plus the
 * synchronous history/post/audio is effect admission). Availability is read directly from
 * `registry.connectionsState.value` (an immutable snapshot that omits pending/failed retirements) through
 * [availableOwners], never from an eventually collected cache, and nothing under the gate suspends on the registry
 * or profile repository or touches the network.
 *
 * [invalidate] advances the profile's revision first (so any suspended refresh result is rejected), drops every
 * readiness of that profile's retired generations, then runs the cleanup [effect] (old-owner prune/cancel/audio)
 * and propagates its failure. An already-admitted effect holds the gate, so invalidate waits for it to complete.
 */
class RuntimeReadinessProvider(
    private val availableOwners: () -> Map<String, ConnectionRef>,
    private val isProfileMutating: (String) -> Boolean,
) : IntegrationReadinessProvider {
    constructor(availableOwners: () -> Map<String, ConnectionRef>) : this(availableOwners, { false })
    private data class Key(val owner: IntegrationOwner, val agent: AgentKind)

    private val gate = Mutex()
    private val entries = HashMap<Key, IntegrationReadiness>()
    private val revisions = HashMap<String, Long>()

    @Volatile
    private var revisionView: Map<String, Long> = emptyMap()

    @Volatile
    private var snapshot: Map<Key, IntegrationReadiness> = emptyMap()

    private val _display = MutableStateFlow<Map<ConnectionRef, Map<AgentKind, IntegrationReadinessState>>>(emptyMap())

    /** Display-only readiness per exact owner and agent (never effect authorization). */
    val displayStates: StateFlow<Map<ConnectionRef, Map<AgentKind, IntegrationReadinessState>>> = _display.asStateFlow()

    /** The profile's current path/config revision; capture it BEFORE any suspension that precedes publication. */
    fun revisionOf(profileId: String): Long = revisionView[profileId] ?: 0L

    override fun current(owner: IntegrationOwner, agent: AgentKind): IntegrationReadiness? = snapshot[Key(owner, agent)]

    /**
     * Publishes an immutable result iff its captured revision and owner are still current. Returns false (result
     * discarded) for a stale revision or a pending/failed/replaced owner.
     */
    private val activeMutationTokens = HashMap<String, HashSet<Long>>()
    private var tokenSequence = 0L

    suspend fun beginMutation(owner: ConnectionRef): Long = gate.withLock {
        val token = ++tokenSequence
        activeMutationTokens.getOrPut(owner.profileId) { HashSet() }.add(token)
        token
    }

    suspend fun endMutation(owner: ConnectionRef, token: Long) = gate.withLock {
        val set = activeMutationTokens[owner.profileId] ?: return@withLock
        if (set.remove(token)) {
            if (set.isEmpty()) {
                activeMutationTokens.remove(owner.profileId)
                revisions[owner.profileId] = (revisions[owner.profileId] ?: 0L) + 1L
                revisionView = HashMap(revisions)
            }
        }
    }

    private fun isMutatingLocked(profileId: String): Boolean =
        (activeMutationTokens[profileId]?.isNotEmpty() == true) || isProfileMutating(profileId)

    /**
     * Publishes an immutable result iff its captured revision and owner are still current. Returns false (result
     * discarded) for a stale revision or a pending/failed/replaced owner.
     */
    suspend fun publish(readiness: IntegrationReadiness): Boolean = gate.withLock {
        val owner = readiness.owner
        if (isMutatingLocked(owner.owner.profileId)) return@withLock false
        if ((revisions[owner.owner.profileId] ?: 0L) != owner.pathConfigRevision) return@withLock false
        if (availableOwners()[owner.owner.profileId] != owner.owner) return@withLock false
        entries[Key(owner, readiness.agent)] = readiness
        publishLocked()
        true
    }

    override suspend fun withVerified(
        owner: IntegrationOwner,
        agent: AgentKind,
        effect: (IntegrationReadiness) -> Unit,
    ): Boolean = gate.withLock {
        val readiness = entries[Key(owner, agent)] ?: return@withLock false
        if (isMutatingLocked(owner.owner.profileId)) return@withLock false
        if (readiness.state != IntegrationReadinessState.VERIFIED) return@withLock false
        if ((revisions[owner.owner.profileId] ?: 0L) != owner.pathConfigRevision) return@withLock false
        if (availableOwners()[owner.owner.profileId] != owner.owner) return@withLock false
        effect(readiness)
        true
    }

    override suspend fun invalidate(owner: ConnectionRef, effect: () -> Unit) {
        gate.withLock {
            val profileId = owner.profileId
            revisions[profileId] = (revisions[profileId] ?: 0L) + 1L
            revisionView = HashMap(revisions)
            entries.keys
                .filter { it.owner.owner.profileId == profileId && it.owner.owner.generation <= owner.generation }
                .forEach { entries.remove(it) }
            publishLocked()
            effect()
        }
    }


    suspend fun advanceRevision(profileId: String) = gate.withLock {
        revisions[profileId] = (revisions[profileId] ?: 0L) + 1L
        revisionView = HashMap(revisions)
    }
    private fun publishLocked() {
        snapshot = HashMap(entries)
        _display.value = entries.values.groupBy { it.owner.owner }.mapValues { (_, list) ->
            list.associate { it.agent to it.state }
        }
    }
}

private fun pathsAgree(install: String?, runtime: String?): Boolean =
    install == null || runtime == null || install == runtime

private fun isInstalledStatus(status: String): Boolean =
    status.equals("current", ignoreCase = true) || status.equals("installed", ignoreCase = true)

/**
 * Builds the readiness of one agent for the exact runtime [owner] from AUTHORITATIVE path/status results of that
 * runtime's own server (never row labels, Android path probes, or evidence of another owner).
 *
 * - OMP: VERIFIED only with `ompCanEnable` (the server computed install path == notification runtime path and a
 *   current extension) plus a valid installed extension status and agreeing paths.
 * - Claude: VERIFIED only with `claudeCanEnable == true` plus an installed/ready native integration for that path.
 * - Codex is status-only and never VERIFIED.
 * Missing evidence is UNAVAILABLE.
 */
internal fun evaluateReadiness(
    owner: IntegrationOwner,
    agent: AgentKind,
    paths: AgentPathsVerification?,
    omp: ExtensionStatusReport?,
    claude: NativeIntegrationStatusReport?,
): IntegrationReadiness {
    val state = when (agent) {
        AgentKind.CODEX -> IntegrationReadinessState.UNAVAILABLE
        AgentKind.OMP -> if (paths != null && omp != null && paths.ompCanEnable &&
            isInstalledStatus(omp.status) && pathsAgree(paths.ompInstallDir, paths.ompNotificationDir)
        ) {
            IntegrationReadinessState.VERIFIED
        } else {
            IntegrationReadinessState.UNAVAILABLE
        }
        AgentKind.CLAUDE -> if (paths != null && claude != null && paths.claudeCanEnable == true &&
            isInstalledStatus(claude.status) && claude.readiness.equals("ready", ignoreCase = true) &&
            pathsAgree(paths.claudeConfigDir, paths.claudeNotificationDir)
        ) {
            IntegrationReadinessState.VERIFIED
        } else {
            IntegrationReadinessState.UNAVAILABLE
        }
    }
    return IntegrationReadiness(
        owner = owner,
        agent = agent,
        state = state,
        paths = paths,
        omp = if (agent == AgentKind.OMP) omp else null,
        integration = if (agent == AgentKind.CLAUDE) claude else null,
    )
}

// ------------------------------------------------------------------------------------------------------
// C2a1 consumption: register-before-eligibility, close-drain-before-unregister
// ------------------------------------------------------------------------------------------------------

/**
 * Consumes the registry's awaited retirement barrier (C2a1).
 *
 * - [register] awaits `addRetirementBarrier` (retaining the returned token) and the compliant synchronous observer
 *   BEFORE anything is [eligible]: watchers, effects, readiness and binding publication all wait for it. A
 *   registration failure or cancellation leaves everything ineligible; there is no listener or detached-launch
 *   fallback.
 * - The barrier records the exact old ref as owned and awaits [retireOwner] (stop collectors, provider
 *   invalidate + prune/cancel/audio cleanup, unpublish). It never calls back into the registry or profile
 *   repository.
 * - [close] disables producers, then - NonCancellable - drains EVERY owned ref (including retained pending/failed
 *   refs the registry no longer lists), and only after a fully successful drain removes the barrier token. A failed
 *   drain keeps the barrier registered (fenced capability preserved) for one explicit bounded [recoverClose].
 */
class RetirementLifetime(
    private val registry: ConnectionRegistry,
    private val retireOwner: suspend (ConnectionRef) -> Unit,
    private val observer: (ConnectionRef) -> Unit = {},
) {
    private val lock = Any()
    private val owned = LinkedHashSet<ConnectionRef>()
    private val eligibility = CompletableDeferred<Boolean>()

    @Volatile
    var eligible: Boolean = false
        private set

    @Volatile
    private var token: Long? = null

    /** The barrier registration token while registered (null before registration and after a successful close). */
    val registeredToken: Long? get() = token

    suspend fun register(): Boolean {
        try {
            val registered = registry.addRetirementBarrier { old ->
                own(old)
                retireOwner(old)
            }
            token = registered
            try {
                registry.addRetirementListener { old -> observer(old) }
            } catch (t: Throwable) {
                registry.removeRetirementBarrier(registered)
                token = null
                throw t
            }
            eligible = true
            eligibility.complete(true)
            return true
        } catch (ce: CancellationException) {
            eligibility.complete(false)
            throw ce
        } catch (_: Throwable) {
            eligibility.complete(false)
            return false
        }
    }

    /** True only when registration succeeded; producers await it before becoming eligible. */
    suspend fun awaitEligible(): Boolean = eligibility.await()

    fun own(ref: ConnectionRef) {
        synchronized(lock) { owned += ref }
    }

    fun ownedRefs(): List<ConnectionRef> = synchronized(lock) { owned.toList() }

    @Volatile
    private var closed = false

    /** Returns true when every owned ref drained and the token was removed. */
    suspend fun close(): Boolean = withContext(NonCancellable) {
        eligible = false
        val drained = HashSet<ConnectionRef>()
        val failures = ArrayList<Throwable>()
        while (true) {
            val batch = synchronized(lock) { owned.filter { it !in drained } }
            if (batch.isEmpty()) break
            for (ref in batch) {
                try {
                    retireOwner(ref)
                } catch (t: Throwable) {
                    failures += t
                }
                drained += ref
            }
        }
        if (failures.isNotEmpty()) return@withContext false
        token?.let { registry.removeRetirementBarrier(it) }
        token = null
        closed = true
        true
    }

    /** One explicit bounded retry of a failed [close]; never a loop. */
    suspend fun recoverClose(): Boolean = if (closed) true else close()
}

// ------------------------------------------------------------------------------------------------------
// Published Settings bindings (transition-fenced identity publication)
// ------------------------------------------------------------------------------------------------------

/**
 * Immutable per-profile [SettingsBinding]s. A binding is published ONLY inside the registry's
 * `admitCurrentOwner(ref) { ... }` non-suspending commit, which rejects pending/failed retirement and generation
 * mismatch; there is no same-generation identity replacement and no publication after cancellation. Reads
 * ([currentSnapshot]) never take a lock: they validate the published value against `registry.connectionsState.value`.
 */
class PublishedSettingsBindings(
    private val registry: ConnectionRegistry,
    private val profiles: ProfileRepository,
    private val isEligible: () -> Boolean,
    private val onOwned: (ConnectionRef) -> Unit,
) : SettingsOwnerResolver {
    private val _bindings = MutableStateFlow<Map<String, SettingsBinding>>(emptyMap())
    val bindings: StateFlow<Map<String, SettingsBinding>> = _bindings.asStateFlow()

    override fun currentSnapshot(profileId: String): SettingsBinding? {
        val binding = _bindings.value[profileId] ?: return null
        return if (registry.connectionsState.value[profileId] == binding.owner.connection) binding else null
    }

    override suspend fun current(profileId: String): SettingsBinding? {
        if (!isEligible()) return null
        return publish(profileId)
    }

    /** Ensures (never replaces) the binding of the profile's current owner; null when unavailable/unauthenticated. */
    suspend fun publish(profileId: String): SettingsBinding? {
        if (!isEligible()) return null
        val profile = profiles.profiles.value.firstOrNull { it.id == profileId } ?: return null
        val status = profiles.authStatuses.value[profileId] as? AuthStatus.Authenticated ?: return null
        val live = registry.connectionsState.value[profileId]
        val existing = _bindings.value[profileId]
        if (existing != null && existing.owner.connection == live) {
            // Same generation: identity never changes in place. Unchanged => reuse; changed => fail closed.
            val sameIdentity = existing.owner.accountId == status.session.user
            return if (sameIdentity) existing else null
        }
        val client = try {
            profiles.getOrCreateApiClient(profileId) // profile lock; outside registry/operation locks
        } catch (ce: CancellationException) {
            throw ce
        } catch (_: Exception) {
            return null
        }
        val freshStatus = profiles.authStatuses.value[profileId] as? AuthStatus.Authenticated ?: return null
        val binding = SettingsBinding(SettingsOwner(client.connection, client.normalizedBaseUrl, freshStatus.session.user), client)
        var published = false
        val admitted = registry.admitCurrentOwner(client.connection) {
            val liveStatus = profiles.authStatuses.value[profileId] as? AuthStatus.Authenticated
            if (liveStatus == null || liveStatus.session.user != freshStatus.session.user) return@admitCurrentOwner false
            val current = _bindings.value[profileId]
            if (current != null && current.owner.connection == client.connection) {
                false // never replace a same-generation binding
            } else {
                _bindings.value = _bindings.value + (profileId to binding)
                published = true
                true
            }
        }
        if (!admitted || !published) return _bindings.value[profileId]?.takeIf { registry.connectionsState.value[profileId] == it.owner.connection }
        onOwned(client.connection)
        return binding
    }

    /** Drops the exact retired owner's binding (never a successor's). */
    fun unpublish(ref: ConnectionRef) {
        val current = _bindings.value[ref.profileId] ?: return
        if (current.owner.connection == ref) _bindings.value = _bindings.value - ref.profileId
    }
}

// ------------------------------------------------------------------------------------------------------
// One semantic watcher per existing runtime
// ------------------------------------------------------------------------------------------------------

/** The existing runtime of one already-connected profile: its socket, reducer and own collector scope. */
class AgentRuntime internal constructor(
    val owner: ConnectionRef,
    val client: ApiClient,
    val ws: WsConnection,
    val endpoint: String,
    val accountId: String,
    val reducer: AgentStatusReducer,
    internal val scope: CoroutineScope,
) {
    internal val job: Job get() = scope.coroutineContext[Job]!!
    internal var reconcileJob: Job? = null
    internal var refreshJob: Job? = null
    /** The roster attachment of THIS connection object (new incarnation for every replaced object). */
    internal var agents: TerminalAgentsAttachment? = null
}

/**
 * Owns exactly ONE collector + reducer + readiness refresh per runtime the root already created
 * ([attach] is idempotent per socket object); it never connects another profile or keeps a socket alive.
 *
 * Event path: the frame's [IntegrationOwner] (owner, socket, endpoint, account, path revision) is captured BEFORE the
 * reducer suspends and passed unchanged with the accepted event to the coordinator, whose effects only run through
 * [IntegrationReadinessProvider.withVerified]. Reconcile requests are handled here by a job of the runtime's own scope,
 * not by a detached coroutine. Runtime/socket replacement stops the old collector and awaits
 * provider.invalidate before the new runtime can publish anything.
 */
class AgentRuntimeHost(
    private val scope: CoroutineScope,
    private val provider: RuntimeReadinessProvider,
    private val coordinator: () -> NotificationCoordinator,
    private val isEligible: () -> Boolean,
    private val onOwned: (ConnectionRef) -> Unit,
    private val inventory: TerminalAgentsInventoryCoordinator,
) {
    private val lock = Mutex()

    @Volatile
    private var runtimes: Map<String, AgentRuntime> = emptyMap()

    fun current(profileId: String): AgentRuntime? = runtimes[profileId]

    /** Synchronous exact owner/socket recheck for effects (the live socket must still be the captured one). */
    fun isCurrent(owner: IntegrationOwner): Boolean {
        val rt = runtimes[owner.owner.profileId] ?: return false
        return rt.owner == owner.owner && rt.ws.activeSocketRef() == owner.socket
    }

    suspend fun attach(client: ApiClient, ws: WsConnection, accountId: String): Boolean {
        if (!isEligible()) return false
        val owner = client.connection
        if (ws.connection != owner) return false
        return lock.withLock {
            val existing = runtimes[owner.profileId]
            if (existing != null && existing.ws === ws && existing.owner == owner && existing.accountId == accountId) return@withLock true
            if (existing != null) stopLocked(existing)
            if (!isEligible()) return@withLock false
            val runtimeScope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
            val terminalRepository = TerminalRepository(client, ws)
            val reducer = AgentStatusReducer(terminalRepository)
            val listing = TerminalRepository(client, null)
            val runtime = AgentRuntime(
                owner = owner,
                client = client,
                ws = ws,
                endpoint = client.normalizedBaseUrl,
                accountId = accountId,
                reducer = reducer,
                scope = runtimeScope,
            )
            // The roster's attachment token is allocated for THIS connection object before any collector exists.
            runtime.agents = inventory.attach(
                TerminalAgentsRuntimeBinding(
                    owner = owner,
                    endpoint = client.normalizedBaseUrl,
                    accountUser = accountId,
                    ws = ws,
                    reducer = reducer,
                    scope = runtimeScope,
                    listDetailed = { listing.listDetailed() },
                ),
            )
            onOwned(owner)
            runtimes = runtimes + (owner.profileId to runtime)
            runtimeScope.launch(start = CoroutineStart.UNDISPATCHED) {
                launch(start = CoroutineStart.UNDISPATCHED) { ws.socketBoundMessages.collect { handle(runtime, it) } }
                launch {
                    ws.state.collect { state ->
                        val attachment = runtime.agents
                        if (attachment != null) {
                            val socket = (state as? WsState.Connected)?.socketRef
                            inventory.onSocketState(
                                attachment,
                                socket,
                                if (socket != null) TerminalAgentsRefreshReason.CONNECTED else TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE,
                            )
                        }
                    }
                }
                launch { ws.state.collect { state -> if (state is WsState.Connected) onConnected(runtime, state.socketRef) } }
            }
            true
        }
    }

    /** Stops exactly [owner]'s runtime (collectors, reducer authority); another generation is untouched. */
    suspend fun retire(owner: ConnectionRef) {
        // Identity loss first: revoke roster authority + purge the display cache under the short roster gate only.
        inventory.retireIdentity(owner)
        lock.withLock {
            val rt = runtimes[owner.profileId] ?: return@withLock
            if (rt.owner == owner) stopLocked(rt)
        }
    }

    /** Re-verifies every attached runtime against its own server (after path/config/install changes). */
    fun refreshAll() {
        for (rt in runtimes.values) scheduleRefresh(rt, rt.ws.activeSocketRef())
    }

    fun refresh(profileId: String) {
        runtimes[profileId]?.let { scheduleRefresh(it, it.ws.activeSocketRef()) }
    }

    suspend fun stopAll() {
        lock.withLock { runtimes.values.toList().forEach { stopLocked(it) } }
    }

    private suspend fun stopLocked(rt: AgentRuntime) {
        runtimes = runtimes - rt.owner.profileId
        // Revoke this attachment under the roster gate BEFORE awaiting the children (never held across the drain).
        rt.agents?.let { inventory.detach(it) }
        val failures = ArrayList<suspend () -> Unit>()
        failures += { rt.job.cancelAndJoin() }
        failures += { rt.reducer.retireOwner(rt.owner) }
        failures += { provider.invalidate(rt.owner) {} }
        attemptAllSuspending(failures)
    }

    private suspend fun onConnected(rt: AgentRuntime, socket: SocketInstanceRef) {
        if (!isEligible()) return
        rt.reducer.bindRuntime(rt.owner, socket)
        rt.reducer.reloadSnapshot(rt.owner, socket)
        scheduleRefresh(rt, socket)
    }

    private fun scheduleRefresh(rt: AgentRuntime, socket: SocketInstanceRef?) {
        if (socket == null || !isEligible()) return
        rt.refreshJob?.cancel()
        rt.refreshJob = rt.scope.launch { refreshReadiness(rt, socket) }
    }

    private suspend fun handle(rt: AgentRuntime, bound: SocketBoundMessage) {
        val socket = bound.socketRef
        if (socket.connection != rt.owner || !isEligible()) return
        // Roster callbacks only act for the live attachment of THIS object and its currently connected socket.
        val attachment = rt.agents?.takeIf { inventory.isCurrentSocket(it, socket) }
        when (val msg = bound.message) {
            is ServerMsg.AgentStatusChanged -> {
                // Frame capture BEFORE the reducer can suspend.
                val integration = IntegrationOwner(rt.owner, socket, rt.endpoint, rt.accountId, provider.revisionOf(rt.owner.profileId))
                when (val admission = rt.reducer.applyStatusChanged(rt.owner, socket, msg)) {
                    is AgentAdmission.Accepted -> coordinator().admit(admission.event, integration)
                    AgentAdmission.Reconcile -> reconcile(rt, socket)
                    AgentAdmission.Silent -> Unit
                }
            }
            is ServerMsg.AgentStatusRemoved -> {
                val admission = rt.reducer.applyStatusRemoved(rt.owner, socket, msg)
                if (attachment != null) inventory.invalidate(attachment, TerminalAgentsRefreshReason.AGENT_MEMBERSHIP_CHANGED)
                if (admission == AgentAdmission.Reconcile) reconcile(rt, socket)
            }
            is ServerMsg.AgentStatusInvalidated -> {
                val admission = rt.reducer.applyStatusInvalidated(rt.owner, socket, msg)
                if (attachment != null) inventory.invalidate(attachment, TerminalAgentsRefreshReason.AGENT_MEMBERSHIP_CHANGED)
                if (admission == AgentAdmission.Reconcile) reconcile(rt, socket)
            }
            // Lifecycle/restart only invalidate inventory; an exact non-null exit may also prune its own instance.
            is ServerMsg.TerminalLifecycle, is ServerMsg.ProcessRestarted ->
                if (attachment != null) inventory.invalidate(attachment, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
            is ServerMsg.TermExit ->
                if (attachment != null) inventory.onTerminalExit(attachment, msg.id, msg.incarnation, msg.willRestart)
            else -> Unit
        }
    }

    private fun reconcile(rt: AgentRuntime, socket: SocketInstanceRef) {
        if (rt.reconcileJob?.isActive == true) return
        rt.reconcileJob = rt.scope.launch { rt.reducer.reloadSnapshot(rt.owner, socket) }
    }

    private suspend fun refreshReadiness(rt: AgentRuntime, socket: SocketInstanceRef) {
        val profileId = rt.owner.profileId
        val revision = provider.revisionOf(profileId) // captured before any suspension
        val integrationOwner = IntegrationOwner(rt.owner, socket, rt.endpoint, rt.accountId, revision)
        val terminal = TerminalRepository(rt.client, null)
        var paths: AgentPathsVerification? = null
        var omp: ExtensionStatusReport? = null
        var claude: NativeIntegrationStatusReport? = null
        try {
            val inputs = fetchRuntimeAgentPaths(rt.client)
            paths = terminal.getAgentPathsVerification(inputs.omp, inputs.codex, inputs.claude)
            omp = terminal.getOmpExtensionStatus(inputs.omp)
            claude = terminal.getNativeIntegrationStatus(AgentKind.CLAUDE, inputs.claude)
        } catch (ce: CancellationException) {
            throw ce
        } catch (_: Throwable) {
            // Any missing evidence is UNAVAILABLE below: alerts stay silent, nothing is guessed.
        }
        for (agent in AgentKind.entries) {
            provider.publish(evaluateReadiness(integrationOwner, agent, paths, omp, claude))
        }
    }
}

// ------------------------------------------------------------------------------------------------------
// Notification click validation
// ------------------------------------------------------------------------------------------------------

sealed interface NotificationRouteDecision {
    /** Authoritative terminal of exactly the clicked identity; project/worktree come from the server. */
    data class OpenTerminal(
        val profileId: String,
        val project: String,
        val worktreePath: String?,
        val terminalId: String,
    ) : NotificationRouteDecision

    data class Refused(val reason: String) : NotificationRouteDecision
}

/**
 * Authoritative target validator shared by cold/live intents and feed clicks. Labels never authorize: the click's
 * process nonce, registry owner generation, endpoint/account, live socket, server epoch and terminal
 * existence/incarnation are checked ([checkLive], synchronous, rerun immediately before the route commit) and the
 * terminal's project/worktree are read from the server's own session list. A newer attentionRevision alone never
 * rejects an otherwise current terminal.
 */
class NotificationRouteResolver(
    private val registry: ConnectionRegistry,
    private val runtimes: AgentRuntimeHost,
    private val processInstanceId: String,
) {
    /** Null when the target is still live and exact; otherwise the explicit user-facing refusal. */
    fun checkLive(target: NotificationTarget): String? {
        val current = registry.connectionsState.value[target.profileId]
            ?: return "The server for this notification is not connected. Open it from the profile list."
        if (current.generation != target.generation) {
            return "The server connection changed after this notification arrived."
        }
        val terminalId = target.terminalId ?: return null // generic (transfer/idle) target: profile only
        val sessionOwner = target.processInstanceId
        if (sessionOwner == null || sessionOwner != processInstanceId) {
            return "This notification belongs to an earlier app session. Open the project from the project list."
        }
        val rt = runtimes.current(target.profileId) ?: return "The terminal connection is not active. Reconnect and try again."
        if (rt.owner != current) return "The server connection changed after this notification arrived."
        if (target.endpoint != rt.endpoint || target.accountId != rt.accountId) {
            return "The server address or account changed after this notification arrived."
        }
        if (rt.ws.activeSocketRef() == null) return "The server connection is offline. Reconnect and try again."
        val state = rt.reducer.state.value
        if (!state.baselineInstalled || state.serverEpoch.toServerSafeLongOrNull() != target.serverEpoch) {
            return "The server restarted since this notification arrived; its terminal can no longer be verified."
        }
        val row = state.agents[terminalId] ?: return "That terminal no longer exists."
        if (row.incarnation.toServerSafeLongOrNull() != target.incarnation) return "That terminal was restarted."
        if (target.agentSessionId != null && row.agentSessionId != target.agentSessionId) return "That agent session has ended."
        if (target.agentKind != null && row.agentKind.name.lowercase() != target.agentKind) return "That agent changed."
        return null
    }

    suspend fun resolve(target: NotificationTarget): NotificationRouteDecision {
        checkLive(target)?.let { return NotificationRouteDecision.Refused(it) }
        val terminalId = target.terminalId
            ?: return NotificationRouteDecision.Refused("This notification has no terminal to open.")
        val rt = runtimes.current(target.profileId)
            ?: return NotificationRouteDecision.Refused("The terminal connection is not active.")
        val session = try {
            TerminalRepository(rt.client, null).listDetailed().firstOrNull { it.id == terminalId }
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            return NotificationRouteDecision.Refused("The terminal could not be verified on the server (${t.message ?: "request failed"}).")
        } ?: return NotificationRouteDecision.Refused("That terminal no longer exists on the server.")
        if (session.incarnation.toServerSafeLongOrNull() != target.incarnation || !session.alive) {
            return NotificationRouteDecision.Refused("That terminal was restarted or has exited.")
        }
        val project = session.project?.takeIf { it.isNotBlank() }
            ?: return NotificationRouteDecision.Refused("That terminal is not assigned to a project.")
        val projectMatches = target.project == null || target.project == project
        val worktreeMatches = target.worktreePath == null || target.worktreePath == session.worktreePath
        if (!projectMatches || !worktreeMatches) {
            return NotificationRouteDecision.Refused("That terminal moved to another project or worktree.")
        }
        // Server fetch finished: the live exactness must still hold before anything may commit.
        checkLive(target)?.let { return NotificationRouteDecision.Refused(it) }
        return NotificationRouteDecision.OpenTerminal(target.profileId, project, session.worktreePath, terminalId)
    }
}

// ------------------------------------------------------------------------------------------------------
// System document port (no Activity or URI type crosses it)
// ------------------------------------------------------------------------------------------------------

/** Activity-owned picker launchers; supplied on attach, dropped on detach, never retained by the retained owner. */
interface DocumentLaunchers {
    fun launchOpen()
    fun launchCreate(suggestedName: String, mime: String)
}

/**
 * Retained [SettingsDocumentPort]. Results carry the exact captured [SettingsOperation] and kind; it keeps at
 * most one in-flight open and one in-flight create (the launchers themselves are single-flight), so a recreated
 * Activity's callback maps to the owned token. Destroy-detach cancels only these owned tokens.
 */
class RetainedSettingsDocumentPort : SettingsDocumentPort {
    private val lock = Any()
    private val _results = MutableSharedFlow<SettingsDocumentResult>(extraBufferCapacity = 16)
    override val results: SharedFlow<SettingsDocumentResult> = _results.asSharedFlow()

    private class Create(val operation: SettingsOperation, val kind: SettingsDocumentKind, val bytes: ByteArray)

    private var launchers: DocumentLaunchers? = null
    private var openOperation: SettingsOperation? = null
    private var create: Create? = null

    fun attach(launchers: DocumentLaunchers) {
        synchronized(lock) { this.launchers = launchers }
    }

    /** Drops Activity references. A config-change detach keeps owned in-flight tokens; [cancelOwned] ends them. */
    fun detach(cancelOwned: Boolean) {
        val toCancel = ArrayList<SettingsDocumentResult>()
        synchronized(lock) {
            launchers = null
            if (cancelOwned) {
                openOperation?.let { toCancel += result(it, SettingsDocumentKind.OPEN_TOML, null, saved = false, cancelled = true, error = null) }
                create?.let { toCancel += result(it.operation, it.kind, null, saved = false, cancelled = true, error = null) }
                openOperation = null
                create = null
            }
        }
        toCancel.forEach { _results.tryEmit(it) }
    }

    override fun openToml(operation: SettingsOperation) {
        val launcher = synchronized(lock) {
            val l = launchers ?: throw IllegalStateException("No system file picker is attached.")
            if (openOperation != null) throw IllegalStateException("Another file open is already in progress.")
            openOperation = operation
            l
        }
        try {
            launcher.launchOpen()
        } catch (t: Throwable) {
            synchronized(lock) { if (openOperation == operation) openOperation = null }
            throw t
        }
    }

    override fun createDocument(operation: SettingsOperation, name: String, mime: String, bytes: ByteArray) {
        val kind = if (mime == SettingsDiagnostics.MIME_TYPE) SettingsDocumentKind.CREATE_DIAGNOSTICS else SettingsDocumentKind.CREATE_TOML
        val launcher = synchronized(lock) {
            val l = launchers ?: throw IllegalStateException("No system file picker is attached.")
            if (create != null) throw IllegalStateException("Another file save is already in progress.")
            create = Create(operation, kind, bytes)
            l
        }
        try {
            launcher.launchCreate(name, mime)
        } catch (t: Throwable) {
            synchronized(lock) { if (create?.operation == operation) create = null }
            throw t
        }
    }

    /** The bytes a pending create must write, or null (already handled/cancelled). Consumed by [onCreateResult]. */
    fun pendingCreateBytes(): ByteArray? = synchronized(lock) { create?.bytes }

    fun onOpenResult(bytes: ByteArray?, cancelled: Boolean, error: String?) {
        val operation = synchronized(lock) { openOperation.also { openOperation = null } } ?: return
        _results.tryEmit(result(operation, SettingsDocumentKind.OPEN_TOML, if (error == null && !cancelled) bytes else null, saved = false, cancelled = cancelled, error = error))
    }

    fun onCreateResult(saved: Boolean, cancelled: Boolean, error: String?) {
        val pending = synchronized(lock) { create.also { create = null } } ?: return
        _results.tryEmit(result(pending.operation, pending.kind, null, saved = saved && error == null && !cancelled, cancelled = cancelled, error = error))
    }

    private fun result(
        operation: SettingsOperation,
        kind: SettingsDocumentKind,
        bytes: ByteArray?,
        saved: Boolean,
        cancelled: Boolean,
        error: String?,
    ) = SettingsDocumentResult(operation, kind, bytes, saved, cancelled, error)
}

// ------------------------------------------------------------------------------------------------------
// Retained ViewModel
// ------------------------------------------------------------------------------------------------------

/**
 * Retained ViewModel owning the application-level singletons and per-owner [ProjectWorkspaceState] instances
 * across Activity configuration changes, plus the active-root services (Settings, notifications, runtime
 * readiness, local history) the UI consumes through [RetainedRootServices].
 *
 * Invariants:
 * 1. Initialized with the Application context only; zero Activity context retained (Activity launchers are
 *    attached/detached through [documentPort] and [notificationPlatform]).
 * 2. Activity destruction during rotation only calls [onActivityDestroy] (detaching view adapters/widgets).
 * 3. Final teardown occurs exclusively in [onCleared]: producers are disabled, every owned ref is drained
 *    NonCancellable, and only then the registry barrier token is removed and resources are released.
 * 4. Barrier registration precedes every watcher/effect/readiness/binding publication (see [RetirementLifetime]).
 */
class NativeWorkspaceViewModel(
    application: Application,
) : AndroidViewModel(application), RetainedRootServices {

    val vault: AndroidCredentialVault = AndroidCredentialVault(application.applicationContext)
    val registry: ConnectionRegistry = ConnectionRegistry()
    val metadataStore: AndroidProfileMetadataStore = AndroidProfileMetadataStore(application.applicationContext)
    val profileRepository: ProfileRepository = ProfileRepository(
        vault = vault,
        registry = registry,
        metadataStore = metadataStore,
    )
    val preferencesStore: AndroidPreferencesStore = AndroidPreferencesStore(application.applicationContext)
    val notificationSink: AndroidNotificationSink = AndroidNotificationSink(application.applicationContext)
    val notificationPlatform: AndroidNotificationPlatform = AndroidNotificationPlatform(application.applicationContext)
    val notificationAudio: AndroidNotificationAudio = AndroidNotificationAudio()
    val flowNavigation: AppFlowNavigation = AppFlowNavigation()
    val lifecycleCoordinator: LifecycleCoordinator = LifecycleCoordinator()
    val targetStore: ProjectTargetStore = ProjectTargetStore()
    val documentPort: RetainedSettingsDocumentPort = RetainedSettingsDocumentPort()
    override val commandHistory: AndroidCommandHistoryStore = AndroidCommandHistoryStore(application.applicationContext)
    override val privacyController: PrivacyController = PrivacyController()
    override val shortcutRegistry: HardwareShortcutRegistry = HardwareShortcutRegistry()

    private val documentFactory = AndroidEditorDocumentFactory()
    private val workspaceStates = ConcurrentHashMap<WorkspaceFileOwner, ProjectWorkspaceState>()

    /** Collectors, runtimes and teardown run here (not viewModelScope) so final drain outlives viewModelScope. */
    private val runtimeScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val targetServices: TargetServicesHolder = TargetServicesHolder()

    private val readiness: RuntimeReadinessProvider = RuntimeReadinessProvider(
        availableOwners = { registry.connectionsState.value },
        isProfileMutating = { profileId ->
            val target = targetServices.findServices(profileId)
            val isTargetBusy = target?.agentIntegration?.state?.value?.busy != null ||
                target?.configEditor?.state?.value?.isSaving == true ||
                (settingsRepository.busy.value.isNotEmpty() && settingsRepository.sourceTargetState.value.settingsProfileId == profileId)
            val isSourcePathBusy = settingsRepository.busy.value.containsKey(SettingsBusyKind.AGENT_PATHS) &&
                settingsRepository.sourceTargetState.value.preferencesProfileId == profileId
            isTargetBusy || isSourcePathBusy
        },
    )
    val readinessProvider: RuntimeReadinessProvider get() = readiness

    private val lifetime: RetirementLifetime = RetirementLifetime(
        registry = registry,
        retireOwner = { old ->
            attemptAllSuspending(
                listOf(
                    { agents.cancelPendingActivations("The server connection was retired.") },
                    { runtimes.retire(old) },
                    { coordinator.retire(old) },
                    { bindings.unpublish(old) },
                    { targetServices.retireOwner(old) },
                ),
            )
        },
        observer = { old ->
            // Compliant synchronous observer: revoke retained workspace authority; no registry/profile access.
            workspaceStates.values.filter { it.owner.profileId == old.profileId }.forEach { it.revokeAuthority() }
        },
    )

    private val bindings: PublishedSettingsBindings = PublishedSettingsBindings(
        registry = registry,
        profiles = profileRepository,
        isEligible = { lifetime.eligible },
        onOwned = { lifetime.own(it) },
    )

    override val settingsRepository: SettingsRepository = SettingsRepository(
        preferencesStore = preferencesStore,
        ownerResolver = bindings,
        coroutineScope = viewModelScope,
        invalidateRuntime = { ref -> invalidateRuntimeWithMutationFence(ref) },
    )

    private val coordinator: NotificationCoordinator = createNotificationCoordinator(
        provider = readiness,
        sink = notificationSink,
        audio = notificationAudio,
        platform = notificationPlatform,
        lifecycle = lifecycleCoordinator.state,
        settings = settingsRepository,
        isCurrentOwner = { runtimes.isCurrent(it) },
        processInstanceId = ProcessInstance.id,
        nowMs = { System.currentTimeMillis() },
    )

    private val agentsCodec = DefaultTerminalAgentsFilterCodec()

    /** Roster identity authority: registry-current owner, authenticated account and the profile's normalized endpoint. */
    private val agentsInventory: TerminalAgentsInventoryCoordinator = TerminalAgentsInventoryCoordinator(
        isCurrentIdentity = { connection, endpoint, account ->
            val profile = profileRepository.profiles.value.firstOrNull { it.id == connection.profileId }
            val status = profileRepository.authStatuses.value[connection.profileId] as? AuthStatus.Authenticated
            val expectedUser = status?.session?.user
            registry.connectionsState.value[connection.profileId] == connection &&
                profile != null && WorkspaceFileOwner.normalizeBaseUrl(profile.baseUrl) == endpoint &&
                expectedUser != null && expectedUser == account
        },
    )

    /** Retained panel/session seam of an admitted manual route (mutation-only inside the gates). */
    private val agentsSelection = object : TerminalAgentsSelectionPort {
        override fun canCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey): Boolean {
            val state = workspaceStates[owner] ?: return true
            val terminal = state.terminalState ?: return true
            return !state.isAuthorityRetired.value && terminal.destroyingSessionIds[instance.terminalId] != true
        }

        override fun commit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {
            workspaceStates[owner]?.commitVerifiedTerminalSelection(instance)
        }

        override fun afterCommit(owner: WorkspaceFileOwner, instance: TerminalAgentsInstanceKey) {
            workspaceStates[owner]?.applyVerifiedSelectionEffects()
        }
    }

    private val agentsActivation: TerminalAgentsActivationCoordinator = TerminalAgentsActivationCoordinator(
        scope = runtimeScope,
        inventory = agentsInventory,
        flow = flowNavigation,
        profiles = profileRepository,
        selection = agentsSelection,
        mainContext = Dispatchers.Main.immediate,
    )

    /** The ONE retained Agents service of this process-retained owner. */
    private val agents: RetainedTerminalAgentsCoordinator = RetainedTerminalAgentsCoordinator(
        scope = runtimeScope,
        inventory = agentsInventory,
        activation = agentsActivation,
        projector = DefaultTerminalAgentsProjector(agentsCodec),
        filterStore = AndroidTerminalAgentsFilterStore(application.applicationContext, agentsCodec),
        codec = agentsCodec,
        profileLabels = { profileRepository.profiles.value.associate { it.id to it.name } },
    )

    private val runtimes: AgentRuntimeHost = AgentRuntimeHost(
        scope = runtimeScope,
        provider = readiness,
        coordinator = { coordinator },
        isEligible = { lifetime.eligible },
        onOwned = { lifetime.own(it) },
        inventory = agentsInventory,
    )

    private val routeResolver: NotificationRouteResolver = NotificationRouteResolver(registry, runtimes, ProcessInstance.id)

    override val notificationFeed: StateFlow<NotificationFeedState> get() = coordinator.feed

    private val _routeNotice = MutableStateFlow<String?>(null)
    override val routeNotice: StateFlow<String?> = _routeNotice.asStateFlow()
    private val _settingsServices = MutableStateFlow(SettingsScreenServices())
    override val settingsScreenServices: StateFlow<SettingsScreenServices> = _settingsServices.asStateFlow()

    private val documentWorkflow = SettingsDocumentWorkflow(settingsRepository, documentPort, viewModelScope)

    /** Click request keys already consumed in this process (rotation replay guard); bounded. */
    private val consumedClicks = object : LinkedHashMap<String, Boolean>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean = size > 64
    }

    private val teardownStarted = java.util.concurrent.atomic.AtomicBoolean(false)

    init {
        // Ordinary navigation spends any pending Agents activation immediately; the verified route never calls this.
        flowNavigation.onOrdinaryNavigationRequested = { agents.cancelPendingActivations("Superseded by navigation.") }
    }

    init {
        // Register BEFORE anything becomes eligible: bindings, runtimes, readiness and effects wait for it.
        viewModelScope.launch(start = CoroutineStart.UNDISPATCHED) {
            if (lifetime.register()) startProducers()
        }
    }

    private fun startProducers() {
        // Proactive immutable binding publication for authenticated, currently usable profiles.
        runtimeScope.launch {
            combine(profileRepository.profiles, profileRepository.authStatuses, registry.connectionsState) { p, a, c -> Triple(p, a, c) }
                .collect { (profiles, statuses, connections) ->
                    for (profile in profiles) {
                        if (statuses[profile.id] is AuthStatus.Authenticated && connections.containsKey(profile.id)) {
                            try {
                                bindings.publish(profile.id)
                            } catch (ce: CancellationException) {
                                throw ce
                            } catch (_: Throwable) {
                            }
                        }
                    }
                }
        }
        // Local-only history consent follows the one local preference (default off).
        runtimeScope.launch {
            settingsRepository.preferences.map { it.commandHistoryEnabled }.distinctUntilChanged().collect { commandHistory.setEnabled(it) }
        }
        // Foreground resume refreshes the roster inventory of every existing attached runtime (no polling).
        runtimeScope.launch {
            var previous = lifecycleCoordinator.state.value
            lifecycleCoordinator.state.collect { current ->
                if (previous == LifecycleState.BACKGROUND && current == LifecycleState.FOREGROUND) {
                    agents.refreshAll(TerminalAgentsRefreshReason.FOREGROUND)
                }
                previous = current
            }
        }
        // Path/config edits re-verify every existing runtime after the edit settled.
        runtimeScope.launch {
            settingsRepository.busy.map { it[SettingsBusyKind.AGENT_PATHS] }.distinctUntilChanged().collect { busy ->
                if (busy == null) {
                    val profileId = settingsRepository.sourceTargetState.value.preferencesProfileId
                    if (profileId != null) readiness.advanceRevision(profileId)
                    runtimes.refreshAll()
                }
            }
        }
        // Selected Settings target B services + display readiness of the active profile.
        runtimeScope.launch {
            combine(
                settingsRepository.sourceTargetState.map { it.settingsProfileId }.distinctUntilChanged(),
                bindings.bindings,
                profileRepository.activeProfileId,
                readiness.displayStates,
                notificationPlatform.status,
            ) { targetId, published, activeId, display, _ ->
                val binding = targetId?.let { published[it]?.takeIf { b -> bindings.currentSnapshot(it) === b } }
                val services = binding?.let { targetServices.servicesFor(it) }
                val active = activeId?.let { registry.connectionsState.value[it] }
                SettingsScreenServices(
                    targetServices = services,
                    commandHistory = commandHistory,
                    documentWorkflow = documentWorkflow,
                    notificationPlatform = notificationPlatform,
                    notificationAudio = notificationAudio,
                    integrationReadiness = active?.let { display[it] } ?: emptyMap(),
                )
            }.collect { _settingsServices.value = it }
        }
    }

    private inner class TargetServicesHolder {
        private val cache = HashMap<SettingsOwner, SettingsTargetServices>()
        private val lock = Any()
        private val integrationJobs = java.util.concurrent.ConcurrentHashMap<SettingsOwner, Job>()
        private val configJobs = java.util.concurrent.ConcurrentHashMap<SettingsOwner, Job>()

        fun servicesFor(binding: SettingsBinding): SettingsTargetServices = synchronized(lock) {
            cache.getOrPut(binding.owner) { build(binding) }
        }

        fun retireOwner(old: ConnectionRef) {
            val dropped = synchronized(lock) {
                val keys = cache.keys.filter { it.connection.profileId == old.profileId && it.connection.generation <= old.generation }
                keys.forEach {
                    integrationJobs.remove(it)?.cancel()
                    configJobs.remove(it)?.cancel()
                }
                keys.mapNotNull { cache.remove(it) }
            }
            dropped.forEach {
                it.usageController?.dispose()
                it.idleController?.retire()
            }
        }

        fun findServices(profileId: String): SettingsTargetServices? = synchronized(lock) {
            cache.entries.firstOrNull { it.key.connection.profileId == profileId }?.value
        }

        private fun build(binding: SettingsBinding): SettingsTargetServices {
            val client = binding.client
            val owner = binding.owner
            val authority = settingsRepository.targetAuthority()
            val workspace = WorkspaceRepository(client, targetStore)
            val integration = AgentIntegrationRepository(
                terminal = TerminalRepository(client, null),
                owner = owner,
                authority = authority,
                invalidateRuntime = { ref -> invalidateRuntimeWithMutationFence(ref) },
                pathRevision = { settingsRepository.agentPathsRevision.value },
            )
            val configEditor = RemoteConfigEditor(RemoteConfigRepository(client), owner, authority)
            // Re-verify the runtime after each integration action settled (busy -> idle).
            val integrationJob = runtimeScope.launch {
                integration.state.map { it.busy }.distinctUntilChanged().collect { busy ->
                    if (busy == null) {
                        readiness.advanceRevision(owner.connection.profileId)
                        runtimes.refresh(owner.connection.profileId)
                    }
                }
            }
            val configJob = runtimeScope.launch {
                configEditor.state.map { it.isSaving }.distinctUntilChanged().collect { saving ->
                    if (!saving) {
                        readiness.advanceRevision(owner.connection.profileId)
                        runtimes.refresh(owner.connection.profileId)
                    }
                }
            }
            integrationJobs[owner] = integrationJob
            configJobs[owner] = configJob
            return SettingsTargetServices(
                owner = owner,
                configEditor = configEditor,
                workspaceRepository = workspace,
                agentIntegration = integration,
                usageController = UsageController(owner.connection, UsageRepository(client), runtimeScope),
                idleController = IdleConsentController(
                    connection = owner.connection,
                    repository = IdleSuspendRepository(client),
                    mutationBlockedReason = {
                        val status = profileRepository.authStatuses.value[owner.connection.profileId]
                        if ((status as? AuthStatus.Authenticated)?.session?.devMode == true) {
                            "This server runs without authentication; it does not accept idle-suspend changes."
                        } else {
                            null
                        }
                    },
                    receiptProvider = { runtimes.current(owner.connection.profileId)?.takeIf { it.owner == owner.connection }?.ws?.currentReceipt?.value },
                ),
                mutationAuthority = settingsRepository.hostMutationAuthority(),
            )
        }
    }

    private suspend fun invalidateRuntimeWithMutationFence(ref: ConnectionRef) {
        val token = readiness.beginMutation(ref)
        try {
            coordinator.invalidateRuntime(ref)
        } finally {
            withContext(NonCancellable) {
                readiness.endMutation(ref, token)
            }
        }
    }

    /**
     * Retrieves or constructs a retained [ProjectWorkspaceState] bound strictly to [owner].
     */
    fun getOrCreateWorkspaceState(
        owner: WorkspaceFileOwner,
        target: ProjectTargetRef,
        apiClient: ApiClient,
        wsConnection: WsConnection,
    ): ProjectWorkspaceState {
        val access = PreferenceAccess(
            settingsRepository.preferences,
            settingsRepository::updatePreferences,
            settingsRepository::setExplorerLanguageFilter,
        )
        val historyOwner = SettingsOwner(apiClient.connection, apiClient.normalizedBaseUrl, owner.accountUser)
        val existing = workspaceStates[owner]
        if (existing != null) {
            val fileRepo = FileRepository(
                owner = owner,
                apiClient = apiClient,
                wsConnection = wsConnection,
            )
            val editorRepo = EditorRepository(
                fileRepository = fileRepo,
                connectionRegistry = registry,
                profileId = owner.profileId ?: "",
            )
            existing.rebindTransports(fileRepo, editorRepo, apiClient.connection)
            existing.bindPreferenceConsumers(access, commandHistory, historyOwner)
            return existing
        }

        val fileRepo = FileRepository(
            owner = owner,
            apiClient = apiClient,
            wsConnection = wsConnection,
        )
        val editorRepo = EditorRepository(
            fileRepository = fileRepo,
            connectionRegistry = registry,
            profileId = owner.profileId ?: "",
        )

        val newState = ProjectWorkspaceState.create(
            owner = owner,
            target = target,
            fileRepository = fileRepo,
            editorRepository = editorRepo,
            documentFactory = documentFactory,
            lifecycleCoordinator = lifecycleCoordinator,
            preferenceAccess = access,
            commandHistory = commandHistory,
            historyOwner = historyOwner,
        )
        workspaceStates[owner] = newState
        lifetime.own(apiClient.connection)
        val navState = flowNavigation.state.value
        if (navState.stage == AppFlowStage.TERMINAL &&
            navState.activeProfileId == target.profileId &&
            navState.activeProject == target.project &&
            navState.activeWorktreePath == target.worktreePath &&
            navState.activeSessionId != null
        ) {
            newState.selectPanel(WorkspacePanel.TERMINAL)
            newState.terminalState?.selectSession(navState.activeSessionId)
        }
        return newState
    }

    /**
     * Returns an existing retained workspace state for [owner], if any.
     */
    fun getWorkspaceState(owner: WorkspaceFileOwner): ProjectWorkspaceState? {
        return workspaceStates[owner]
    }

    /**
     * Handles Activity onDestroy events.
     * When [isChangingConfigurations] is true, detaches native widgets/adapters without clearing state; a final
     * destroy also ends only this retained owner's in-flight document tokens.
     */
    fun onActivityDestroy(isChangingConfigurations: Boolean) {
        if (isChangingConfigurations) {
            workspaceStates.values.forEach { it.detachWidgets() }
        }
        documentPort.detach(cancelOwned = !isChangingConfigurations)
        notificationPlatform.unbindLaunchers()
    }

    /**
     * Revokes authority on all workspace states on profile logout or connection retirement.
     */
    fun revokeAllAuthority() {
        workspaceStates.values.forEach { it.revokeAuthority() }
    }

    // ---- RetainedRootServices ----

    override fun markNotificationRead(key: String) = coordinator.markRead(key)
    override fun markAllNotificationsRead() = coordinator.markAllRead()
    override fun clearNotifications() = coordinator.clear()
    override fun dismissTransient(key: String) = coordinator.dismissTransient(key)
    override fun dismissRouteNotice() {
        _routeNotice.value = null
    }

    override suspend fun attachRuntime(client: ApiClient, ws: WsConnection, accountId: String) {
        if (!lifetime.awaitEligible()) return
        runtimes.attach(client, ws, accountId)
    }

    override fun diagnosticsInput(): SettingsDiagnosticsInput {
        val source = settingsRepository.sourceTargetState.value
        return SettingsDiagnosticsInput(
            generatedAtMs = System.currentTimeMillis(),
            preferences = settingsRepository.preferences.value,
            sourceStatus = source.preferencesStatus,
            syncStatus = settingsRepository.syncState.value.status,
            sourceSelected = source.preferencesProfileId != null,
            targetSelected = source.settingsProfileId != null,
            unsupportedRemotePolicy = settingsRepository.unsupportedPolicy.value != null,
            legacyLanguageFilterNotice = settingsRepository.languageFilterMigrationNotice.value != null,
            storageRecoverableError = settingsRepository.storageError != null,
            configuredServerCount = profileRepository.profiles.value.size,
            notificationPlatform = notificationPlatform.status.value,
        )
    }

    override fun onTargetRevalidated(profileId: String) {
        runtimes.refresh(profileId)
    }

    override val terminalAgents: RetainedTerminalAgentsService get() = agents

    override fun refreshTerminalAgents(reason: TerminalAgentsRefreshReason) = agents.refreshAll(reason)

    /** Records a click request as consumed; false when this process already handled it (rotation replay). */
    fun consumeNotificationClick(key: String): Boolean = synchronized(consumedClicks) {
        if (consumedClicks.containsKey(key)) false else {
            consumedClicks[key] = true
            true
        }
    }

    /**
     * Validates [target] against authoritative live state and, when exact, routes through the departure guard.
     * Returns null when routed (or deferred behind the guard) and the explicit refusal text otherwise; a refusal is
     * also surfaced inline. Never auto-activates a stale or different owner.
     */
    override suspend fun openNotification(target: NotificationTarget): String? {
        val refusal = routeNotification(target)
        if (refusal != null) {
            _routeNotice.value = refusal
            flowNavigation.openNotifications()
        } else {
            _routeNotice.value = null
        }
        return refusal
    }

    private suspend fun routeNotification(target: NotificationTarget): String? {
        if (target.terminalId == null) {
            // Generic target: only the exact current profile's project list.
            routeResolver.checkLive(target)?.let { return it }
            if (profileRepository.authStatuses.value[target.profileId] !is AuthStatus.Authenticated) {
                return "Sign in to this server first."
            }
            profileRepository.selectProfile(target.profileId)
            flowNavigation.onProfileAuthenticated(target.profileId)
            return null
        }
        when (val decision = routeResolver.resolve(target)) {
            is NotificationRouteDecision.Refused -> return decision.reason
            is NotificationRouteDecision.OpenTerminal -> {
                if (profileRepository.authStatuses.value[decision.profileId] !is AuthStatus.Authenticated) {
                    return "Sign in to this server first."
                }
                val flow = flowNavigation.state.value
                val switching = flow.stage == AppFlowStage.TERMINAL &&
                    (flow.activeProject != decision.project || flow.activeProfileId != decision.profileId)
                if (switching && !settingsRepository.preferences.value.terminalAutoSwitchProjectEnabled) {
                    return "Automatic project switching is off. Open project \"${decision.project}\" to view this terminal."
                }
                val routed = flowNavigation.routeToTerminal(
                    profileId = decision.profileId,
                    project = decision.project,
                    worktreePath = decision.worktreePath,
                    sessionId = decision.terminalId,
                    revalidate = { routeResolver.checkLive(target) == null },
                    onCommitted = {
                        val liveStatus = profileRepository.authStatuses.value[decision.profileId] as? AuthStatus.Authenticated
                        val expectedAccount = liveStatus?.session?.user
                        if (expectedAccount != null) {
                            val state = workspaceStates.values.firstOrNull {
                                it.target.profileId == decision.profileId &&
                                it.target.project == decision.project &&
                                it.target.worktreePath == decision.worktreePath &&
                                it.owner.accountUser == expectedAccount &&
                                !it.isAuthorityRetired.value
                            }
                            state?.selectPanel(WorkspacePanel.TERMINAL)
                            state?.terminalState?.selectSession(decision.terminalId)
                        }
                        viewModelScope.launch {
                            try {
                                profileRepository.selectProfile(decision.profileId)
                            } catch (ce: CancellationException) {
                                throw ce
                            } catch (_: Throwable) {
                            }
                        }
                    },
                )
                return if (routed) null else "The terminal changed before it could be opened."
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        workspaceStates.values.forEach { it.close() }
        workspaceStates.clear()
        lifecycleCoordinator.onDestroy()
        agents.close()
        if (!teardownStarted.compareAndSet(false, true)) return
        // Disable producers, drain every owned ref NonCancellable (including pending/failed refs), and only after a
        // successful drain remove the barrier token and release resources. A failed drain keeps the barrier fenced.
        runtimeScope.launch {
            val drained = withContext(NonCancellable) {
                try {
                    runtimes.stopAll()
                } catch (_: Throwable) {
                }
                lifetime.close()
            }
            if (drained) {
                notificationAudio.close()
                runtimeScope.cancel()
            }
        }
    }
}
