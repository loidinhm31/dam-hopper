package dev.damhopper.nativeapp.features.git

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class GitWireCutoverTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createRepository(): GitRepository {
        val conn = ConnectionRef("prof-cutover", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return GitRepository(client)
    }

    @Test
    fun testServerShapedGitStatusAndRootsDecode() = runTest {
        val serverJson = """
            [
                {
                    "rootId": "primary-root",
                    "path": ".",
                    "absolutePath": "/repo/root",
                    "kind": "primary",
                    "mappingState": "mapped",
                    "gitlink": null,
                    "status": {
                        "projectName": "dam-hopper",
                        "branch": "main",
                        "isClean": false,
                        "ahead": 2,
                        "behind": 1,
                        "staged": 1,
                        "modified": 3,
                        "untracked": 2,
                        "hasStash": true,
                        "lastCommit": {
                            "hash": "0123456789abcdef0123456789abcdef01234567",
                            "message": "fix: resolve edge cases",
                            "date": "2026-10-30T12:00:00Z"
                        },
                        "pathExists": true,
                        "statusError": null
                    },
                    "warnings": []
                }
            ]
        """.trimIndent()

        server!!.createContext("/api/git/dam-hopper/roots") { exchange ->
            exchange.sendResponseHeaders(200, serverJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(serverJson.toByteArray()) }
        }

        val repo = createRepository()
        val roots = repo.listRoots("dam-hopper")

        assertEquals(1, roots.size)
        val primary = roots[0]
        assertEquals("primary-root", primary.rootId)
        assertEquals(".", primary.path)
        assertEquals("mapped", primary.mappingState)
        assertNotNull(primary.status)
        assertEquals("main", primary.status?.branch)
        assertFalse(primary.status?.isClean == true)
        assertEquals(2, primary.status?.ahead)
        assertEquals(1, primary.status?.behind)
        assertEquals(1, primary.status?.staged)
        assertEquals(3, primary.status?.modified)
        assertEquals(2, primary.status?.untracked)
        assertTrue(primary.status?.hasStash == true)
        assertEquals("0123456789abcdef0123456789abcdef01234567", primary.status?.lastCommit?.hash)
        assertEquals("fix: resolve edge cases", primary.status?.lastCommit?.message)
    }

    @Test
    fun testServerShapedConflictAndOperationEndpoints() = runTest {
        val conflictJson = """
            {
                "targetRevision": "refs/heads/feature",
                "entries": [
                    {
                        "conflictId": "conf-42",
                        "path": "src/conflict.rs",
                        "status": "bothModified",
                        "isBinary": false,
                        "unsupportedReason": null
                    }
                ],
                "truncated": false,
                "nextCursor": null
            }
        """.trimIndent()

        val opJson = """
            {
                "operation": "rebase",
                "canContinue": true,
                "canAbort": true,
                "operationFingerprint": "op-fingerprint-123",
                "fullIndexFingerprint": "idx-fingerprint-456",
                "stoppedReason": "conflict",
                "stageRoleLabels": {
                    "ours": "HEAD",
                    "theirs": "feature/branch",
                    "base": "upstream/main"
                },
                "terminalHandoffRequired": {
                    "reason": "manual rebase conflict resolution",
                    "worktreeRoot": "/worktrees/demo"
                },
                "blockers": ["unresolved conflict in src/conflict.rs"]
            }
        """.trimIndent()

        server!!.createContext("/api/git/dam-hopper/conflicts") { exchange ->
            exchange.sendResponseHeaders(200, conflictJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(conflictJson.toByteArray()) }
        }
        server!!.createContext("/api/git/dam-hopper/operation") { exchange ->
            exchange.sendResponseHeaders(200, opJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(opJson.toByteArray()) }
        }

        val repo = createRepository()
        val conflicts = repo.getConflicts("dam-hopper")
        assertEquals("refs/heads/feature", conflicts.targetRevision)
        assertEquals(1, conflicts.entries.size)
        assertEquals("conf-42", conflicts.entries[0].conflictId)
        assertFalse(conflicts.truncated)

        val op = repo.getOperation("dam-hopper")
        assertEquals("rebase", op.operation)
        assertTrue(op.canContinue)
        assertTrue(op.canAbort)
        assertEquals("conflict", op.stoppedReason)
        assertEquals("HEAD", op.stageRoleLabels?.ours)
        assertEquals("manual rebase conflict resolution", op.terminalHandoffRequired?.reason)
        assertEquals(1, op.blockers.size)
    }

    @Test
    fun testNonGitProject409ProducesDistinctError() = runTest {
        server!!.createContext("/api/git/non-git/diff") { exchange ->
            val json = """{"error":"Git is not initialized for this project","code":"GIT_NOT_INITIALIZED"}"""
            exchange.sendResponseHeaders(409, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val err = assertFailsWith<ApiRequestError> {
            repo.getDiffSummary("non-git")
        }
        assertEquals(409, err.status)
        assertEquals("GIT_NOT_INITIALIZED", err.code)
    }

    @Test
    fun testGitOperationScopeMatchesExactLogicalOwner() {
        val owner1 = WorkspaceFileOwner(
            profileId = "prof-1",
            baseUrl = "http://127.0.0.1:8080/",
            accountUser = "alice",
            project = "proj-1",
            worktreePath = "/wt-1",
        )
        val conn1 = ConnectionRef("prof-1", 1L)
        val scope1 = GitOperationScope.from(owner1, conn1)

        val owner1SameNormalized = WorkspaceFileOwner(
            profileId = "prof-1",
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "alice",
            project = "proj-1",
            worktreePath = "wt-1",
        )
        val scope1Same = GitOperationScope.from(owner1SameNormalized, conn1)
        assertTrue(scope1.matches(scope1Same))

        // Different user
        val ownerDifferentUser = owner1.copy(accountUser = "bob")
        val scopeDifferentUser = GitOperationScope.from(ownerDifferentUser, conn1)
        assertFalse(scope1.matches(scopeDifferentUser))

        // Different generation
        val conn2 = ConnectionRef("prof-1", 2L)
        val scopeDifferentGen = GitOperationScope.from(owner1, conn2)
        assertFalse(scope1.matches(scopeDifferentGen))
    }
}
