package dev.damhopper.nativeapp.features.workflow

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.yield
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkflowAndPlanControllersTest {

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

    private fun createWorkflowRepository(): WorkflowRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return WorkflowRepository(client)
    }

    private fun createProjectPlansRepository(): ProjectPlansRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return ProjectPlansRepository(client)
    }

    @Test
    fun testWorkflowControllerConflictWarningPreservation() = runTest {
        server!!.createContext("/api/workflow/overview") { exchange ->
            val json = """{"workspace":{"id":"w1","name":"ws"},"serverTime":"2026-09-02T10:00:00.000Z","projects":[],"plans":[],"standaloneTasks":[],"runningSessions":[],"recentEvents":[],"truncated":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        server!!.createContext("/api/workflow/items/item-1") { exchange ->
            val json = """{"error":"Workflow request conflicts with current state","code":"workflow_conflict"}"""
            exchange.sendResponseHeaders(409, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createWorkflowRepository()
        val controller = WorkflowController(repo, this, "test-profile", 1L)
        delay(50) // Let initial overview load

        val res = controller.updateItem(
            id = "item-1",
            updatedAt = "2026-09-02T09:00:00.000Z",
            title = "My edited title"
        )
        assertTrue(res.isFailure)
        assertNotNull(controller.state.value.conflictWarning)
        assertTrue(controller.state.value.conflictWarning!!.contains("modified remotely"))

        controller.clearConflictWarning()
        assertNull(controller.state.value.conflictWarning)
    }

    @Test
    fun testProjectPlansControllerBackNavigationHierarchy() = runTest {
        val repo = createProjectPlansRepository()
        val controller = ProjectPlansController(
            repository = repo,
            scope = this,
            initialProject = "dam-hopper",
            initialWorktreePath = null,
            profileId = "test-profile",
            generation = 1L
        )

        // Set state to active document viewing
        controller.openDocument("plans/261015-1647-android-native-app/phase-01.md")
        assertNotNull(controller.state.value.activeDocumentPath)

        // Step 1: Back from document should close document, staying on plan
        val handled1 = controller.handleBack()
        assertTrue(handled1)
        assertNull(controller.state.value.activeDocumentPath)

        // Step 2: Set selected plan path
        controller.selectPlan("plans/261015-1647-android-native-app/plan.md")
        assertEquals("plans/261015-1647-android-native-app/plan.md", controller.state.value.selectedPlanPath)

        // Back from plan should deselect plan, staying in folder
        val handled2 = controller.handleBack()
        assertTrue(handled2)
        assertNull(controller.state.value.selectedPlanPath)

        // Step 3: Set subfolder path
        controller.loadFolders("plans/subgroup/deep")
        assertEquals("plans/subgroup/deep", controller.state.value.currentPath)

        // Back from subfolder should navigate to parent
        val handled3 = controller.handleBack()
        assertTrue(handled3)
        assertEquals("plans/subgroup", controller.state.value.currentPath)
    }

    @Test
    fun testProjectPlansControllerAutoOpensPlanOnPlanKindFolder() = runTest {
        var planFetchCount = 0
        server!!.createContext("/api/plans/folders") { exchange ->
            val query = exchange.requestURI.query ?: ""
            val json = if (query.contains("path=plans%2Fmy-plan") || query.contains("path=plans/my-plan")) {
                """{"target":{"project":"dam-hopper","targetKey":"dam-hopper:root"},"path":"plans/my-plan","kind":"plan","folderState":"present","folders":[],"listing":{"complete":true,"entriesVisited":0,"limitsReached":[]},"watchPaths":["plans/my-plan"],"diagnostics":[]}"""
            } else {
                """{"target":{"project":"dam-hopper","targetKey":"dam-hopper:root"},"path":"plans","kind":"group","folderState":"present","folders":[{"name":"my-plan","path":"plans/my-plan","kind":"plan"}],"listing":{"complete":true,"entriesVisited":1,"limitsReached":[]},"watchPaths":["plans"],"diagnostics":[]}"""
            }
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        server!!.createContext("/api/plans") { exchange ->
            planFetchCount++
            val json = """{"target":{"project":"dam-hopper","targetKey":"dam-hopper:root"},"plan":{"id":"my-plan","metadata":{},"documents":{"plan":{"path":"plans/my-plan/plan.md","state":"readable"}},"reportedStatus":{"value":"in-progress","authority":"plan"},"phases":[],"completion":{"completed":0},"dates":{},"diagnostics":[]},"watchPaths":[],"diagnostics":[]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createProjectPlansRepository()
        val controller = ProjectPlansController(
            repository = repo,
            scope = this,
            initialProject = "",
            initialWorktreePath = null,
            profileId = "test-profile",
            generation = 1L
        )
        controller.updateTarget("dam-hopper", null, "test-profile", 1L)

        controller.loadFolders("plans/my-plan")
        var attempts = 0
        while (controller.state.value.selectedPlanResponse == null && attempts < 100) {
            attempts++
            Thread.sleep(20)
            yield()
        }
        // Additional wait window to confirm no secondary/loop fetch occurs
        Thread.sleep(50)
        yield()

        assertEquals("plans/my-plan", controller.state.value.selectedPlanPath)
        assertNotNull(controller.state.value.selectedPlanResponse)
        assertEquals(1, planFetchCount, "Plan should be fetched exactly once without loop")
    }
}
