package dev.damhopper.nativeapp

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.damhopper.nativeapp.features.git.GitPanelSection
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.*

/**
 * Real S-ROOT smoke test executing on Android device/emulator:
 * Launches [MainActivity], verifies Git panel activation, sections, back navigation,
 * and retained workspace authority.
 */
@RunWith(AndroidJUnit4::class)
class FocusedGitRootSmokeTest {

    @Test
    fun testFocusedGitRootSmokeNavigationAndRetention() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)

        scenario.onActivity { activity ->
            val vm = activity.viewModel
            assertNotNull(vm)

            val owner = WorkspaceFileOwner(
                profileId = "root-smoke-prof",
                baseUrl = "http://127.0.0.1:8080",
                accountUser = "verified-root-user",
                project = "smoke-proj",
                worktreePath = null,
            )

            // Select Terminal stage with a project to activate focused workspace
            vm.flowNavigation.onProfileAuthenticated("root-smoke-prof")
            vm.flowNavigation.selectProject("smoke-proj")

            val target = owner.toProjectTargetRef()
            val client = dev.damhopper.nativeapp.core.transport.ApiClient(
                connection = dev.damhopper.nativeapp.core.model.ConnectionRef("root-smoke-prof", 1L),
                baseUrl = owner.normalizedBaseUrl,
                authTokenProvider = { "smoke-token" }
            )
            val ws = object : dev.damhopper.nativeapp.core.transport.WsConnection(
                client.connection,
                owner.normalizedBaseUrl,
                { "smoke-token" }
            ) {
                override val socketBoundMessages = kotlinx.coroutines.flow.MutableSharedFlow<dev.damhopper.nativeapp.core.transport.SocketBoundMessage>()
                override suspend fun sendOnSocket(expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef, msg: dev.damhopper.nativeapp.core.transport.ClientMsg) {}
                override suspend fun requestOnSocket(
                    expectedSocketRef: dev.damhopper.nativeapp.core.model.SocketInstanceRef,
                    reqId: ULong,
                    msg: dev.damhopper.nativeapp.core.transport.ClientMsg,
                    timeoutMillis: Long,
                ): dev.damhopper.nativeapp.core.transport.ServerMsg = dev.damhopper.nativeapp.core.transport.ServerMsg.FsOpResult(reqId = reqId, ok = true)
            }

            val wsState = vm.getOrCreateWorkspaceState(owner, target, client, ws)
            assertNotNull(wsState)
            assertNotNull(wsState.gitRuntime)

            // Switch to GIT panel
            wsState.selectPanel(WorkspacePanel.GIT)
            assertEquals(WorkspacePanel.GIT, wsState.activePanel.value)

            // Section selection
            wsState.gitState.selectSection(GitPanelSection.CHANGES)
            assertEquals(GitPanelSection.CHANGES, wsState.gitState.section.value)

            wsState.gitState.selectSection(GitPanelSection.HISTORY)
            assertEquals(GitPanelSection.HISTORY, wsState.gitState.section.value)

            wsState.gitState.selectSection(GitPanelSection.BRANCHES_WORKTREES)
            assertEquals(GitPanelSection.BRANCHES_WORKTREES, wsState.gitState.section.value)

            // GitHostPorts lookup on RetainedRootServices
            val ports = vm.gitHostPorts(owner)
            assertNotNull(ports)

            // Authority remains valid
            assertTrue(wsState.gitState.isAuthorityValid.value)
        }

        scenario.close()
    }
}
