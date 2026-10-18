package dev.damhopper.nativeapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import androidx.lifecycle.lifecycleScope
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.platform.lifecycle.AndroidLifecycleCoordinator
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.storage.AndroidPreferencesStore
import dev.damhopper.nativeapp.platform.storage.AndroidProfileMetadataStore
import dev.damhopper.nativeapp.platform.vault.AndroidCredentialVault
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.screens.DamHopperMobileApp
import dev.damhopper.nativeapp.ui.theme.NativeTheme
import kotlinx.coroutines.launch
class MainActivity : ComponentActivity() {
    private val vault by lazy { AndroidCredentialVault(applicationContext) }
    private val registry by lazy { ConnectionRegistry() }
    private val metadataStore by lazy { AndroidProfileMetadataStore(applicationContext) }
    private val profileRepository by lazy {
        ProfileRepository(
            vault = vault,
            registry = registry,
            metadataStore = metadataStore
        )
    }
    private val preferencesStore by lazy { AndroidPreferencesStore(applicationContext) }
    private val notificationSink by lazy { AndroidNotificationSink(applicationContext) }
    private val lifecycleCoordinator by lazy { AndroidLifecycleCoordinator() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(lifecycleCoordinator)
        lifecycleScope.launch {
            profileRepository.initialize()
            handleDeepLink(intent)
        }
        setContent {
            NativeTheme {
                val flowNavigation = remember { AppFlowNavigation() }
                BackHandler(enabled = true) {
                    if (!flowNavigation.handleBackPress()) {
                        finish()
                    }
                }
                DamHopperMobileApp(
                    profileRepository = profileRepository,
                    navigation = flowNavigation,
                    preferencesStore = preferencesStore,
                    lifecycleCoordinator = lifecycleCoordinator.coordinator,
                )
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
            val profiles = profileRepository.profiles.value
            val matchingProfile = profiles.find { it.id == targetProfileId } ?: return@launch
            if (targetGeneration > 0) {
                val currentConn = registry.getCurrentConnection(targetProfileId)
                if (currentConn != null && currentConn.generation != targetGeneration) {
                    return@launch
                }
            }
            profileRepository.selectProfile(matchingProfile.id)
        }
    }
}
