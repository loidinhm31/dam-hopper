package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.fail

/**
 * Explicit mandatory current-server S-WIRE live smoke test.
 *
 * Excluded from default JVM discovery by build configuration.
 * Requires isolated external server environment variables:
 * - DAMHOPPER_GIT_SMOKE_SERVER_URL
 * - DAMHOPPER_GIT_SMOKE_AUTH_TOKEN (optional, defaults to empty)
 * - DAMHOPPER_GIT_SMOKE_PROJECT (optional, defaults to "demo")
 */
class GitWireLiveSmoke {

    @Test
    fun testLiveWireSmoke() {
        runBlocking {
        val serverUrl = System.getenv("DAMHOPPER_GIT_SMOKE_SERVER_URL")
            ?: fail("Mandatory isolated DAMHOPPER_GIT_SMOKE_SERVER_URL environment variable is not set for S-WIRE smoke test.")

        val token = System.getenv("DAMHOPPER_GIT_SMOKE_AUTH_TOKEN") ?: ""
        val project = System.getenv("DAMHOPPER_GIT_SMOKE_PROJECT") ?: "demo"

        val client = ApiClient(
            connection = ConnectionRef("smoke-profile", 1L),
            baseUrl = serverUrl,
            authTokenProvider = { token }
        )
        val repository = GitRepository(client)

        val roots = repository.listRoots(project)
        assertNotNull(roots)

        val diff = repository.getDiffSummary(project)
        assertNotNull(diff)
        assertNotNull(diff.entries)
        }
    }
}
