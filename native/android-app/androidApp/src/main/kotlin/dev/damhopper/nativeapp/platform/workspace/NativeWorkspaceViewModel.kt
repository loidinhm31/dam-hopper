package dev.damhopper.nativeapp.platform.workspace

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentFactory
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.storage.AndroidPreferencesStore
import dev.damhopper.nativeapp.platform.storage.AndroidProfileMetadataStore
import dev.damhopper.nativeapp.platform.vault.AndroidCredentialVault
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

/**
 * Retained ViewModel managing application-level singletons and per-owner
 * [ProjectWorkspaceState] instances across Activity configuration changes.
 *
 * Invariants:
 * 1. Initialized with [Application.getApplicationContext]; zero Activity context retained.
 * 2. Activity destruction during rotation only calls [onActivityDestroy] (detaching view adapters/widgets).
 * 3. Final teardown occurs exclusively when [onCleared] is invoked by the Android ViewModel store.
 * 4. Retains navigation route, active profile, and all dirty/unresolved document buffers across rotation.
 */
class NativeWorkspaceViewModel(
    application: Application,
) : AndroidViewModel(application) {

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
    val flowNavigation: AppFlowNavigation = AppFlowNavigation()
    val lifecycleCoordinator: LifecycleCoordinator = LifecycleCoordinator()
    val targetStore: ProjectTargetStore = ProjectTargetStore()

    private val documentFactory = AndroidEditorDocumentFactory()
    private val workspaceStates = mutableMapOf<WorkspaceFileOwner, ProjectWorkspaceState>()

    init {
        viewModelScope.launch {
            registry.addRetirementListener { connectionRef ->
                workspaceStates.values.filter { it.owner.profileId == connectionRef.profileId }
                    .forEach { it.revokeAuthority() }
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
        )
        workspaceStates[owner] = newState
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
     * When [isChangingConfigurations] is true, detaches native widgets/adapters without clearing state.
     */
    fun onActivityDestroy(isChangingConfigurations: Boolean) {
        if (isChangingConfigurations) {
            workspaceStates.values.forEach { it.detachWidgets() }
        }
    }

    /**
     * Revokes authority on all workspace states on profile logout or connection retirement.
     */
    fun revokeAllAuthority() {
        workspaceStates.values.forEach { it.revokeAuthority() }
    }

    override fun onCleared() {
        super.onCleared()
        workspaceStates.values.forEach { it.close() }
        workspaceStates.clear()
        lifecycleCoordinator.onDestroy()
    }
}
