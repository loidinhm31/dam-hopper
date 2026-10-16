package dev.damhopper.nativeapp.features.workflow

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.test.assertNotNull

class ProjectPlansRepositoryAndParsingTest {

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

    private fun createRepository(): ProjectPlansRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return ProjectPlansRepository(client)
    }

    @Test
    fun testSelectedPlanResponseDeserialization() {
        val rawJson = """
            {
              "target": {
                "project": "dam-hopper",
                "worktreePath": null,
                "targetKey": "dam-hopper:root"
              },
              "plan": {
                "id": "261015-1647-android-native-app",
                "title": "Android-first native workbench",
                "description": "Build native app",
                "metadata": {
                  "priority": "P2",
                  "effort": "unestimated",
                  "branch": "feat/android-native-app",
                  "tags": ["android", "kmp"]
                },
                "documents": {
                  "plan": {
                    "path": "plans/261015-1647-android-native-app/plan.md",
                    "state": "readable",
                    "sizeBytes": 14200,
                    "modifiedAt": "2026-10-15T16:47:00Z"
                  }
                },
                "reportedStatus": {
                  "value": "in-progress",
                  "authority": "plan",
                  "raw": "in-progress",
                  "evidence": [
                    { "path": "plans/261015-1647-android-native-app/plan.md", "lineStart": 4, "lineEnd": 4 }
                  ],
                  "captured": []
                },
                "phases": [
                  {
                    "id": "phase-01",
                    "number": 1,
                    "title": "Scope baseline",
                    "path": "phase-01-scope.md",
                    "reportedStatus": {
                      "value": "completed",
                      "authority": "plan"
                    },
                    "evidenceLinks": []
                  }
                ],
                "completion": {
                  "declared": 19,
                  "completed": 12,
                  "unknown": 0,
                  "conflicted": 0,
                  "fraction": 0.6315
                },
                "dates": {},
                "lastDocumentUpdate": "2026-10-16T10:00:00Z",
                "diagnostics": []
              },
              "watchPaths": ["plans/261015-1647-android-native-app"],
              "diagnostics": []
            }
        """.trimIndent()

        val response = ProtocolJson.decodeFromString(SelectedPlanResponse.serializer(), rawJson)
        assertEquals("dam-hopper", response.target.project)
        assertEquals("261015-1647-android-native-app", response.plan.id)
        assertEquals(PlanStatus.IN_PROGRESS, response.plan.reportedStatus.value)
        assertEquals(1, response.plan.phases.size)
        assertEquals(PlanStatus.COMPLETED, response.plan.phases.first().reportedStatus.value)
        assertEquals(12, response.plan.completion.completed)
    }

    @Test
    fun testPlanFoldersResponseDeserialization() {
        val rawJson = """
            {
              "target": {
                "project": "dam-hopper",
                "worktreePath": null,
                "targetKey": "dam-hopper:root"
              },
              "path": "plans",
              "kind": "collection",
              "folderState": "present",
              "folders": [
                { "path": "plans/261015-1647-android-native-app", "name": "261015-1647-android-native-app" }
              ],
              "listing": {
                "complete": true,
                "entriesVisited": 1,
                "limitsReached": []
              },
              "watchPaths": ["plans"],
              "diagnostics": []
            }
        """.trimIndent()

        val response = ProtocolJson.decodeFromString(PlanFoldersResponse.serializer(), rawJson)
        assertEquals(PlanFolderKind.COLLECTION, response.kind)
        assertEquals(PlanFolderState.PRESENT, response.folderState)
        assertEquals(1, response.folders.size)
        assertEquals("261015-1647-android-native-app", response.folders.first().name)
    }
    @Test
    fun testGetSelectedPlanSendsPlanPathQueryParam() = runTest {
        var capturedQuery: String? = null
        server!!.createContext("/api/plans") { exchange ->
            capturedQuery = exchange.requestURI.query
            val json = """{"target":{"project":"api","targetKey":"api:root"},"plan":{"id":"p1","metadata":{},"documents":{"plan":{"path":"plans/p1/plan.md","state":"readable"}},"reportedStatus":{"value":"in-progress","authority":"plan"},"phases":[],"completion":{"completed":0},"dates":{},"diagnostics":[]},"watchPaths":[],"diagnostics":[]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val res = repo.getSelectedPlan("api", null, "plans/p1/plan.md")
        assertTrue(res.isSuccess)
        assertNotNull(capturedQuery)
        assertTrue(capturedQuery!!.contains("planPath=plans%2Fp1%2Fplan.md") || capturedQuery!!.contains("planPath=plans/p1/plan.md"), "Query must contain planPath, got: $capturedQuery")
    }

    @Test
    fun testReadPlanDocumentPathTraversalRejection() = runTest {
        val repo = createRepository()

        // Path traversal with ..
        val res1 = repo.readPlanDocument("api", null, "../secret.txt")
        assertIs<PlanDocumentReadResult.Unreadable>(res1)
        assertTrue(res1.reason.contains("rejected", ignoreCase = true))

        // Absolute path
        val res2 = repo.readPlanDocument("api", null, "/etc/passwd")
        assertIs<PlanDocumentReadResult.Unreadable>(res2)

        // External URL
        val res3 = repo.readPlanDocument("api", null, "https://example.com/malicious.md")
        assertIs<PlanDocumentReadResult.Unreadable>(res3)
    }

    @Test
    fun testReadPlanDocumentBounded64KiBRead() = runTest {
        // Return 65 KiB of content (exceeding 64 KiB ceiling)
        val largeContent = "A".repeat(65 * 1024)
        server!!.createContext("/api/fs/read") { exchange ->
            exchange.sendResponseHeaders(200, largeContent.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(largeContent.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.readPlanDocument("api", null, "plans/test/oversize.md")
        assertIs<PlanDocumentReadResult.Oversize>(result)
        assertTrue(result.sizeBytes > 64 * 1024)
    }

    @Test
    fun testReadPlanDocumentWithinBoundSuccess() = runTest {
        val content = "# Phase 1\nClean documentation."
        server!!.createContext("/api/fs/read") { exchange ->
            exchange.sendResponseHeaders(200, content.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(content.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.readPlanDocument("api", null, "plans/test/phase-01.md")
        assertIs<PlanDocumentReadResult.Success>(result)
        assertEquals(content, result.content)
    }

    @Test
    fun testReadPlanDocument404Absent() = runTest {
        server!!.createContext("/api/fs/read") { exchange ->
            val json = """{"error":"File not found","code":"not_found"}"""
            exchange.sendResponseHeaders(404, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.readPlanDocument("api", null, "plans/test/absent.md")
        assertIs<PlanDocumentReadResult.Absent>(result)
    }
}
