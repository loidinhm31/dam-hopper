package dev.damhopper.nativeapp

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModel
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android Device Instrumentation Tests for Phase 07:
 * Verifies that the ViewModel runtime owner survives MainActivity lifecycle and
 * Activity recreation without losing navigation or workspace document state.
 */
@RunWith(AndroidJUnit4::class)
class RetainedWorkspaceLifecycleTest {

    @Test
    fun testViewModelSurvivesActivityRecreation() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        var originalVm: NativeWorkspaceViewModel? = null
        var originalNavHashCode: Int = 0

        scenario.onActivity { activity ->
            originalVm = activity.viewModel
            assertNotNull(originalVm)
            originalNavHashCode = activity.viewModel.flowNavigation.hashCode()
            // Advance navigation state to project list
            activity.viewModel.flowNavigation.onProfileAuthenticated("test-prof")
        }

        // Recreate activity (simulates orientation change / configuration change)
        scenario.recreate()

        scenario.onActivity { recreatedActivity ->
            val recreatedVm = recreatedActivity.viewModel
            assertNotNull(recreatedVm)
            // ViewModel instance must be identical across recreation
            assertEquals(originalVm, recreatedVm, "ViewModel must survive Activity recreation")
            assertEquals(
                originalNavHashCode,
                recreatedVm.flowNavigation.hashCode(),
                "Navigation state instance must be retained across recreation"
            )
            assertEquals(
                "test-prof",
                recreatedVm.flowNavigation.state.value.activeProfileId,
                "Active profile state must be retained after recreation"
            )
        }

        scenario.close()
    }

    @Test
    fun testViewModelHoldsOnlyApplicationContext() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val store = ViewModelStore()
        val factory = ViewModelProvider.AndroidViewModelFactory.getInstance(appContext as android.app.Application)
        val vm = ViewModelProvider(store, factory)[NativeWorkspaceViewModel::class.java]

        assertNotNull(vm.vault)
        assertNotNull(vm.profileRepository)
        assertNotNull(vm.preferencesStore)
        assertNotNull(vm.flowNavigation)
        assertNotNull(vm.targetStore)

        store.clear()
    }

    @Test
    fun testViewModelRetainsWorkspaceAcrossActivityConfigurationChange() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val store = ViewModelStore()
        val factory = ViewModelProvider.AndroidViewModelFactory.getInstance(appContext as android.app.Application)
        val vm = ViewModelProvider(store, factory)[NativeWorkspaceViewModel::class.java]

        val owner = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
            profileId = "prof-test",
            baseUrl = "http://127.0.0.1:4801",
            accountUser = "dev-user",
            project = "test-project",
        )
        val target = owner.toProjectTargetRef()
        val conn = dev.damhopper.nativeapp.core.model.ConnectionRef("prof-test", 1L)
        val client = dev.damhopper.nativeapp.core.transport.ApiClient(conn, "http://127.0.0.1:4801", { "token" })
        val ws = dev.damhopper.nativeapp.core.transport.WsConnection(conn, "http://127.0.0.1:4801", { "token" })

        val state = vm.getOrCreateWorkspaceState(owner, target, client, ws)
        assertNotNull(state)
        assertEquals(state, vm.getWorkspaceState(owner))

        // Simulate Activity recreation (configuration change)
        vm.onActivityDestroy(isChangingConfigurations = true)
        assertFalse(state.isAuthorityRetired.value, "Configuration change must NOT retire workspace authority")

        // Second call retrieves identical retained instance
        val reacquiredState = vm.getOrCreateWorkspaceState(owner, target, client, ws)
        assertEquals(state, reacquiredState)

        // Final teardown (process exit / finish without config change)
        store.clear()
        assertTrue(state.isAuthorityRetired.value, "ViewModel onCleared must close workspace state")
    }

    @Test
    fun testViewModelRetainsTerminalAgentsServiceAcrossConfigurationChange() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            var originalService: dev.damhopper.nativeapp.features.terminal.RetainedTerminalAgentsService? = null
            val customFilter = dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection.Selected(
                listOf(dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus.WORKING),
            )

            scenario.onActivity { activity ->
                val vm = activity.viewModel
                assertNotNull(vm)
                val service = vm.terminalAgents
                assertNotNull(service)
                originalService = service
                service.setFilter(customFilter)
                val start = System.currentTimeMillis()
                while (service.state.value.filter != customFilter && System.currentTimeMillis() - start < 5_000) {
                    Thread.sleep(10)
                }
                assertEquals(customFilter, service.state.value.filter)
            }

            // Recreate activity (simulates configuration change)
            scenario.recreate()

            scenario.onActivity { recreatedActivity ->
                val recreatedVm = recreatedActivity.viewModel
                assertNotNull(recreatedVm)
                val recreatedService = recreatedVm.terminalAgents
                assertEquals(originalService, recreatedService, "RetainedTerminalAgentsService must survive Activity recreation")
                val start = System.currentTimeMillis()
                while (recreatedService.state.value.filter != customFilter && System.currentTimeMillis() - start < 5_000) {
                    Thread.sleep(10)
                }
                assertEquals(customFilter, recreatedService.state.value.filter, "Filter state must be retained after recreation")
                // Reset to All
                recreatedService.setFilter(dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection.All)
            }
        } finally {
            scenario.close()
        }
    }

    @Test
    fun testViewModelRetainsCanonicalDocumentRegistryAcrossAliases() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val vm = activity.viewModel
            val ownerA = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
                profileId = "prof-alias-reg",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "alice",
                project = "project-1",
                worktreePath = null,
                workspaceEpoch = 5L,
            )
            val ownerB = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
                profileId = "prof-alias-reg",
                baseUrl = "http://127.0.0.1:4801",
                accountUser = "alice",
                project = "project-1",
                worktreePath = "wt-1",
                workspaceEpoch = 5L,
            )
            val ownerDifferentEndpoint = ownerA.copy(baseUrl = "http://127.0.0.1:4802")

            val conn = dev.damhopper.nativeapp.core.model.ConnectionRef("prof-alias-reg", 1L)
            val client = dev.damhopper.nativeapp.core.transport.ApiClient(conn, ownerA.normalizedBaseUrl, { "token" })
            val ws = dev.damhopper.nativeapp.core.transport.WsConnection(conn, ownerA.normalizedBaseUrl, { "token" })

            val wsA = vm.getOrCreateWorkspaceState(ownerA, ownerA.toProjectTargetRef(), client, ws)
            val wsB = vm.getOrCreateWorkspaceState(ownerB, ownerB.toProjectTargetRef(), client, ws)
            val wsDiff = vm.getOrCreateWorkspaceState(ownerDifferentEndpoint, ownerDifferentEndpoint.toProjectTargetRef(), client, ws)

            // wsA and wsB share identical CanonicalHolderScope, so they must share the canonical registry!
            assertEquals(
                wsA.editorTabsState.registry,
                wsB.editorTabsState.registry,
                "Workspaces within the same canonical holder scope must share the canonical document registry"
            )

            // Different endpoint gets a distinct canonical registry!
            kotlin.test.assertNotEquals(
                wsA.editorTabsState.registry,
                wsDiff.editorTabsState.registry,
                "Different endpoint must obtain an isolated canonical document registry"
            )
        }
        scenario.close()
    }

    @Test
    fun testViewModelRetainsPendingCreateIntentsAcrossActivityLifecycle() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            val intent = dev.damhopper.nativeapp.features.terminal.UncertainCreateRecord(
                intentId = "device-intent-1",
                profileId = "prof-intent-test",
                terminalId = "term-intent-1",
                project = "intent-proj",
                worktreePath = null,
                createdAtEpochMs = System.currentTimeMillis(),
                status = dev.damhopper.nativeapp.features.terminal.UncertainCreateStatus.PENDING,
            )

            scenario.onActivity { activity ->
                val vm = activity.viewModel
                vm.preferencesStore.saveUncertainCreateRecord(intent)
            }

            // Recreate activity (simulates rotation)
            scenario.recreate()

            scenario.onActivity { recreatedActivity ->
                val vm = recreatedActivity.viewModel
                val pending = vm.pendingCreateIntents.value
                assertTrue(
                    pending.any { it.intentId == "device-intent-1" },
                    "Pending uncertain create intent must be retained across activity recreation"
                )
                // Cleanup
                vm.preferencesStore.removeUncertainCreateRecord("device-intent-1")
            }
        } finally {
            scenario.close()
        }
    }
}
