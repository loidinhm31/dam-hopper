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
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.RequestAdmissionState
import dev.damhopper.nativeapp.core.transport.RequestNotSubmittedError
import dev.damhopper.nativeapp.features.settings.TestGuard
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertFailsWith

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
    fun testKnownWorkspacesCrudSendsExactPayloadsThroughGuards() = runBlocking {
        val posts = CopyOnWriteArrayList<String>()
        val deletes = CopyOnWriteArrayList<String>()
        server!!.createContext("/api/workspace/known") { exchange ->
            when (exchange.requestMethod) {
                "GET" -> {
                    val json = """{"workspaces":[{"path":"/ws/a","name":"Alpha"},{"path":"/ws/b","name":"Beta"}],"current":"/ws/a"}"""
                    exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(json.toByteArray()) }
                }
                "POST" -> {
                    posts += exchange.requestBody.bufferedReader().readText()
                    val json = """{"ok":true}"""
                    exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(json.toByteArray()) }
                }
                "DELETE" -> {
                    deletes += exchange.requestBody.bufferedReader().readText()
                    val json = """{"ok":true}"""
                    exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(json.toByteArray()) }
                }
                else -> exchange.sendResponseHeaders(405, -1)
            }
        }

        val (repo, _) = createGuardedRepository()
        val list = repo.listKnownWorkspaces()
        assertEquals(2, list.workspaces.size)
        assertEquals("/ws/a", list.current)

        assertTrue(repo.addKnownWorkspace("/ws/c", "Gamma", TestGuard()))
        assertTrue(repo.addKnownWorkspace("/ws/d", guard = TestGuard()))
        assertEquals(listOf("""{"path":"/ws/c","name":"Gamma"}""", """{"path":"/ws/d"}"""), posts.toList())

        assertTrue(repo.removeKnownWorkspace("/ws/b", TestGuard()))
        assertEquals(listOf("""{"path":"/ws/b"}"""), deletes.toList())
    }

    @Test
    fun testKnownWorkspaceFalseOkIsNotConfirmed() = runBlocking {
        server!!.createContext("/api/workspace/known") { exchange ->
            exchange.requestBody.readBytes()
            val json = """{"ok":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        val (repo, _) = createGuardedRepository()
        assertFalse(repo.addKnownWorkspace("/ws/x", guard = TestGuard()))
        assertFalse(repo.removeKnownWorkspace("/ws/x", TestGuard()))
    }

    @Test
    fun testSuspendedCredentialsThenRetirementSendsNothingAndGuardIsRejected() = runBlocking {
        val hits = AtomicInteger()
        server!!.createContext("/api/workspace/known") { exchange ->
            hits.incrementAndGet()
            exchange.requestBody.readBytes()
            exchange.sendResponseHeaders(200, -1)
            exchange.close()
        }
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("test-profile")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val client = ApiClient(ref, "http://127.0.0.1:$serverPort", { entered.complete(Unit); release.await(); "t" }, registry)
        val repo = WorkspaceRepository(client)
        val guard = TestGuard()

        val call = async(Dispatchers.IO) { runCatching { repo.addKnownWorkspace("/ws/z", guard = guard) } }
        withTimeout(10_000) { entered.await() }
        registry.retireConnection(ref)
        release.complete(Unit)

        assertTrue(withTimeout(10_000) { call.await() }.exceptionOrNull() is RequestNotSubmittedError)
        assertEquals(0, hits.get())
        assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
    }

    @Test
    fun testReusedGuardCannotAuthorizeASecondMutation() = runBlocking {
        val hits = AtomicInteger()
        server!!.createContext("/api/workspace/known") { exchange ->
            hits.incrementAndGet()
            exchange.requestBody.readBytes()
            val json = """{"ok":true}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        val (repo, _) = createGuardedRepository()
        val guard = TestGuard()
        assertTrue(repo.addKnownWorkspace("/ws/1", guard = guard))
        assertFailsWith<RequestNotSubmittedError> { repo.removeKnownWorkspace("/ws/1", guard) }
        assertEquals(1, hits.get())
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
    }

    private fun createGuardedRepository(): Pair<WorkspaceRepository, ConnectionRegistry> {
        val registry = ConnectionRegistry()
        val ref = runBlocking { registry.getOrCreateConnection("test-profile") }
        val client = ApiClient(ref, "http://127.0.0.1:$serverPort", { "test-token" }, registry)
        return WorkspaceRepository(client) to registry
    }
}
