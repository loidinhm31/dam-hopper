package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Explicit mandatory current-server S-HISTORY live smoke test.
 *
 * Excluded from default JVM discovery by build configuration.
 * Requires isolated external server environment variables:
 * - DAMHOPPER_GIT_SMOKE_SERVER_URL
 * - DAMHOPPER_GIT_SMOKE_AUTH_TOKEN (optional, defaults to empty)
 * - DAMHOPPER_GIT_SMOKE_PROJECT (optional, defaults to "demo")
 */
class GitHistoryQueryLiveSmoke {

    @Test
    fun testLiveHistoryQuerySmoke() {
        runBlocking {
            val serverUrl = System.getenv("DAMHOPPER_GIT_SMOKE_SERVER_URL")
                ?: fail("Mandatory isolated DAMHOPPER_GIT_SMOKE_SERVER_URL environment variable is not set for S-HISTORY smoke test.")

            val token = System.getenv("DAMHOPPER_GIT_SMOKE_AUTH_TOKEN") ?: ""
            val project = System.getenv("DAMHOPPER_GIT_SMOKE_PROJECT") ?: "demo"

            val client = ApiClient(
                connection = ConnectionRef("smoke-profile", 1L),
                baseUrl = serverUrl,
                authTokenProvider = { token }
            )
            val repo = GitRepository(client)
            val controller = GitHistoryController(repo, this)
            val owner = WorkspaceFileOwner(
                profileId = "smoke-profile",
                baseUrl = serverUrl,
                accountUser = "smoke-user",
                project = project,
            )
            val scope = GitOperationScope.from(owner, ConnectionRef("smoke-profile", 1L))
            controller.updateScope(scope, viewed = GitBranch("HEAD"), active = GitBranch("HEAD"))
            val job = controller.loadHistory(resetOffset = true)
            job.join()

            val identity = controller.lastRequestIdentity
            assertNotNull(identity)
            assertTrue(controller.entries.value.isNotEmpty(), "Smoke repository log must not be empty")
        }
    }
}
