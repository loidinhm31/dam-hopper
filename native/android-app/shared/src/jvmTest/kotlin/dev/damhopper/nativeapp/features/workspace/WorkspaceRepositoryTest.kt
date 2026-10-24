package dev.damhopper.nativeapp.features.workspace

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class WorkspaceRepositoryTest {

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

    private fun createRepository(targetStore: ProjectTargetStore? = null): WorkspaceRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return WorkspaceRepository(client, targetStore)
    }

    @Test
    fun testGetWorkspaceStatusWithNullableFields() = runTest {
        server!!.createContext("/api/workspace/status") { exchange ->
            val json = """{"ready":true,"path":"/home/user/workspace","configPath":"/home/user/workspace/dam-hopper.toml","name":"demo-workspace","projectCount":3}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val status = repo.getWorkspaceStatus()
        assertTrue(status.ready)
        assertEquals("/home/user/workspace/dam-hopper.toml", status.configPath)
        assertEquals("demo-workspace", status.name)
        assertEquals(3, status.projectCount)
    }

    @Test
    fun testListProjectsBareJsonArray() = runTest {
        server!!.createContext("/api/projects") { exchange ->
            // Invariant: Server returns bare array, NOT { "projects": [...] }
            val json = """[{"name":"server","path":"/path/to/server","type":"rust","restartPolicy":"never","restartMaxRetries":0},{"name":"web","path":"/path/to/web","type":"node","restartPolicy":"never","restartMaxRetries":0}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val projects = repo.listProjects()
        assertEquals(2, projects.size)
        assertEquals("server", projects[0].name)
        assertEquals("rust", projects[0].projectType)
        assertEquals("web", projects[1].name)
        assertEquals("node", projects[1].projectType)
    }

    @Test
    fun testGetProjectWithUrlEncoding() = runTest {
        var observedPath: String? = null
        server!!.createContext("/api/projects/") { exchange ->
            observedPath = exchange.requestURI.rawPath
            val json = """{"name":"special/project name","path":"/abs/path","type":"custom","restartPolicy":"never","restartMaxRetries":0}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val project = repo.getProject("special/project name")
        assertEquals("special/project name", project.name)
        // Verified: ApiClient.encodePathSegment encodes slashes and spaces safely
        assertNotNull(observedPath)
        assertTrue(observedPath!!.contains("special%2Fproject%20name"))
    }

    @Test
    fun testListWorktreesBareJsonArrayAndStoreUpdate() = runTest {
        server!!.createContext("/api/git/dam-hopper/worktrees") { exchange ->
            // Invariant: Server returns bare array of ProjectWorktree
            val json = """[{"path":"/repo/main","repositoryPath":"/repo","branch":"main","commitHash":"1111111","isMain":true,"isLocked":false,"isDetached":false,"isBare":false,"isPrunable":false,"isAvailable":true},{"path":"/repo/feat","repositoryPath":"/repo","branch":"feature","commitHash":"2222222","isMain":false,"isLocked":true,"isDetached":false,"isBare":false,"isPrunable":false,"isAvailable":true}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/workspace/status") { exchange ->
            val json = """{"ready":true,"path":"/ws","configPath":"/ws/dam-hopper.toml","name":"ws","projectCount":1}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val store = ProjectTargetStore()
        val repo = createRepository(store)
        val worktrees = repo.listWorktrees("dam-hopper")

        assertEquals(2, worktrees.size)
        assertEquals("main", worktrees[0].branch)
        assertTrue(worktrees[0].isMain)
        assertTrue(worktrees[0].isSelectable)

        assertEquals("feature", worktrees[1].branch)
        assertTrue(worktrees[1].isLocked)
        assertEquals("Locked", worktrees[1].statusLabel)
    }

    @Test
    fun testSwitchWorkspaceInvalidatesTargetStore() = runTest {
        var observedBody: String? = null
        server!!.createContext("/api/workspace/switch") { exchange ->
            observedBody = exchange.requestBody.bufferedReader().readText()
            val json = """{"ok":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val store = ProjectTargetStore()
        assertEquals(0L, store.getWorkspaceRevision("test-profile"))

        val repo = createRepository(store)
        val switchSuccess = repo.switchWorkspace("/path/to/new-workspace/dam-hopper.toml")

        assertTrue(switchSuccess)
        assertNotNull(observedBody)
        assertTrue(observedBody!!.contains("/path/to/new-workspace/dam-hopper.toml"))

        // Fencing check: TargetStore workspace revision must increment on switch
        assertEquals(1L, store.getWorkspaceRevision("test-profile"))
        assertEquals("/path/to/new-workspace/dam-hopper.toml", store.getActiveWorkspaceConfigPath("test-profile"))
    }

    @Test
    fun testKnownWorkspacesCrud() = runTest {
        server!!.createContext("/api/workspace/known") { exchange ->
            val method = exchange.requestMethod
            when (method) {
                "GET" -> {
                    val json = """{"workspaces":[{"path":"/ws/a","name":"Alpha"},{"path":"/ws/b","name":"Beta"}],"current":"/ws/a"}"""
                    exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(json.toByteArray()) }
                }
                "POST" -> {
                    val json = """{"ok":true}"""
                    exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(json.toByteArray()) }
                }
                "DELETE" -> {
                    val body = exchange.requestBody.bufferedReader().readText()
                    assertTrue(body.contains("/ws/b"))
                    val json = """{"ok":true}"""
                    exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(json.toByteArray()) }
                }
                else -> exchange.sendResponseHeaders(405, 0)
            }
        }

        val repo = createRepository()
        val list = repo.listKnownWorkspaces()
        assertEquals(2, list.workspaces.size)
        assertEquals("/ws/a", list.current)

        val addOk = repo.addKnownWorkspace("/ws/c", "Gamma")
        assertTrue(addOk)

        val delOk = repo.removeKnownWorkspace("/ws/b")
        assertTrue(delOk)
    }
}
