package dev.damhopper.nativeapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.lifecycle.lifecycleScope
import dev.damhopper.nativeapp.features.editor.LocalNativeEditorSurfaceHost
import dev.damhopper.nativeapp.platform.editor.AndroidNativeEditorSurfaceHost
import dev.damhopper.nativeapp.platform.lifecycle.AndroidLifecycleCoordinator
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModel
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.screens.DamHopperMobileApp
import dev.damhopper.nativeapp.ui.theme.NativeTheme
import kotlinx.coroutines.launch

/**
 * Main Android host Activity rendering the native DamHopper application.
 *
 * All runtime state (profiles, connections, navigation, and workspace documents)
 * is retained in [NativeWorkspaceViewModel] and survives Activity destruction and recreation.
 */
class MainActivity : ComponentActivity() {
    val viewModel: NativeWorkspaceViewModel by viewModels()

    private val lifecycleCoordinator by lazy {
        AndroidLifecycleCoordinator(
            coordinator = viewModel.lifecycleCoordinator,
            onDetach = { viewModel.onActivityDestroy(isChangingConfigurations) },
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(lifecycleCoordinator)
        lifecycleScope.launch {
            viewModel.profileRepository.initialize()
            handleDeepLink(intent)
        }
        setContent {
            NativeTheme {
                CompositionLocalProvider(LocalNativeEditorSurfaceHost provides AndroidNativeEditorSurfaceHost) {
                    val flowNavigation = viewModel.flowNavigation
                    BackHandler(enabled = true) {
                        if (!flowNavigation.handleBackPress()) {
                            finish()
                        }
                    }
                    DamHopperMobileApp(
                        profileRepository = viewModel.profileRepository,
                        targetStore = viewModel.targetStore,
                        navigation = flowNavigation,
                        preferencesStore = viewModel.preferencesStore,
                        lifecycleCoordinator = viewModel.lifecycleCoordinator,
                        workspaceStateProvider = { owner, target, client, ws ->
                            viewModel.getOrCreateWorkspaceState(owner, target, client, ws)
                        },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val targetProfileId = intent?.getStringExtra(AndroidNotificationSink.EXTRA_TARGET_PROFILE_ID) ?: return
        val targetGeneration = intent.getLongExtra(AndroidNotificationSink.EXTRA_TARGET_GENERATION, -1L)
        lifecycleScope.launch {
            val profiles = viewModel.profileRepository.profiles.value
            val matchingProfile = profiles.find { it.id == targetProfileId } ?: return@launch
            if (targetGeneration > 0) {
                val currentConn = viewModel.registry.getCurrentConnection(targetProfileId)
                if (currentConn != null && currentConn.generation != targetGeneration) {
                    return@launch
                }
            }
            // Check departure guard before mutating profile selection
            val guard = viewModel.flowNavigation.departureGuard
            if (guard != null) {
                val intercepted = guard(AppFlowStage.PROJECT_LIST) {
                    lifecycleScope.launch {
                        viewModel.profileRepository.selectProfile(matchingProfile.id)
                    }
                }
                if (!intercepted) {
                    viewModel.profileRepository.selectProfile(matchingProfile.id)
                }
            } else {
                viewModel.profileRepository.selectProfile(matchingProfile.id)
            }
        }
    }
}
