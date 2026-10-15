package dev.damhopper.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import androidx.lifecycle.lifecycleScope
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.platform.storage.AndroidProfileMetadataStore
import dev.damhopper.nativeapp.platform.vault.AndroidCredentialVault
import dev.damhopper.nativeapp.ui.navigation.WorkbenchNavigation
import dev.damhopper.nativeapp.ui.screens.WorkbenchScreen
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            profileRepository.initialize()
        }
        setContent {
            NativeTheme {
                val navigation = remember { WorkbenchNavigation() }
                BackHandler(enabled = true) {
                    if (!navigation.handleBackPress()) {
                        finish()
                    }
                }
                WorkbenchScreen(
                    profileRepository = profileRepository,
                    navigation = navigation
                )
            }
        }
    }
}
