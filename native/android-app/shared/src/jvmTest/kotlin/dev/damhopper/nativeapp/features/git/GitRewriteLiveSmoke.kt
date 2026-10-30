package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.runBlocking
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.fail

/**
 * Explicit mandatory current-server S-REWRITE live smoke test.
 *
 * Excluded from default JVM discovery by build configuration.
 * Requires isolated external server environment variables:
 * - DAMHOPPER_GIT_SMOKE_SERVER_URL
 * - DAMHOPPER_GIT_SMOKE_AUTH_TOKEN (optional, defaults to empty)
 * - DAMHOPPER_GIT_SMOKE_PROJECT (optional, defaults to "demo")
 */
class GitRewriteLiveSmoke {

    @Test
    fun testLiveRewriteSmoke() {
        runBlocking {
            val serverUrl = System.getenv("DAMHOPPER_GIT_SMOKE_SERVER_URL")
                ?: fail("Mandatory isolated DAMHOPPER_GIT_SMOKE_SERVER_URL environment variable is not set for S-REWRITE smoke test.")

            val token = System.getenv("DAMHOPPER_GIT_SMOKE_AUTH_TOKEN") ?: ""
            val project = System.getenv("DAMHOPPER_GIT_SMOKE_PROJECT") ?: "demo"

            val client = ApiClient(
                connection = ConnectionRef("smoke-profile", 1L),
                baseUrl = serverUrl,
                authTokenProvider = { token }
            )
            val repo = GitRepository(client)
            val owner = WorkspaceFileOwner(
                profileId = "smoke-profile",
                baseUrl = serverUrl,
                accountUser = "smoke-user",
                project = project,
            )
            val conn = ConnectionRef("smoke-profile", 1L)
            val safety = WorkspaceGitSafety(
                boundOwner = owner,
                connectionGetter = { conn },
                fileRepositoryGetter = { null },
                editorRepositoryGetter = { null },
                terminalRepositoryGetter = { null },
                workspaceStateGetter = { null },
                retainedDirtyDocsProvider = { emptyList() },
            )
            val host = object : GitHostPorts {
                override suspend fun <T> withMutationGuard(
                    scope: GitOperationScope,
                    impact: GitMutationImpact,
                    paths: List<String>,
                    dispatch: suspend () -> T,
                ): Result<T> = safety.withMutationGuard(scope, impact, paths, dispatch)

                override suspend fun preflightRemoval(
                    scope: GitOperationScope,
                    worktree: ProjectWorktree,
                ): WorktreeRemovalPrecheck = safety.preflightRemoval(scope, worktree)

                override suspend fun requestWorktreeSwitch(
                    scope: GitOperationScope,
                    target: ProjectTargetRef,
                ): Result<Unit> = safety.requestWorktreeSwitch(scope, target)

                override suspend fun openWorkspaceFile(
                    scope: GitOperationScope,
                    rootRelativePath: String,
                ): Result<Unit> = safety.openWorkspaceFile(scope, rootRelativePath)

                override fun onMutationOutcome(event: GitMutationEvent) {
                    safety.onMutationOutcome(event)
                }

                override fun refresh(reason: GitRefreshReason) {}
                override fun openRecoveryTerminal(scope: GitOperationScope) {}
            }
            val rewriteController = GitRewriteActionController(repo, this, host)
            val publishController = LeasedPublishController(repo, this, host)
            val scope = GitOperationScope.from(owner, conn)
            rewriteController.updateScope(scope)
            publishController.updateScope(scope)

            val log = repo.getLog(project = project, limit = 1)
            val headHash = log.firstOrNull()?.hash
            if (headHash != null) {
                var loadedSnapshot: CommitMessageSnapshot? = null
                val loadJob = rewriteController.loadMessageSnapshot(
                    hash = headHash,
                    onLoaded = { loadedSnapshot = it },
                    onError = {}
                )
                loadJob.join()
                assertNotNull(loadedSnapshot)
            }
        }
    }
}
