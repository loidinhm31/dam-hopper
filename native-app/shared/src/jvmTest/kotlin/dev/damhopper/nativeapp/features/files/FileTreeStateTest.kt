package dev.damhopper.nativeapp.features.files

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FileTreeStateTest {

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

    private fun createRepository(): FileRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        val ws = WsConnection(conn, "http://127.0.0.1:$serverPort", { "test-token" })
        return FileRepository(client, ws)
    }

    @Test
    fun testFileTreeHelpersResolveParentPath() {
        assertEquals("src/main", FileTreeHelpers.resolveParentPath("src/main/kotlin"))
        assertEquals("src", FileTreeHelpers.resolveParentPath("src/main"))
        assertEquals("", FileTreeHelpers.resolveParentPath("src"))
        assertEquals("", FileTreeHelpers.resolveParentPath(""))
        assertEquals("", FileTreeHelpers.resolveParentPath("/root"))
    }

    @Test
    fun testFileTreeHelpersUpdateChildrenAndSorting() {
        val target = ProjectTargetRef(project = "demo")
        val root = FileTreeNode(target, "", "demo", isDirectory = true)

        val entries = listOf(
            DirEntryDto("zebra.txt", "file", 100uL),
            DirEntryDto("build", "dir", 0uL),
            DirEntryDto("apple.txt", "file", 200uL),
            DirEntryDto("src", "dir", 0uL),
        )

        val updated = FileTreeHelpers.updateChildren(root, "", entries, target)

        assertEquals(4, updated.children.size)
        // Directories must be sorted first, alphabetically
        assertEquals("build", updated.children[0].name)
        assertTrue(updated.children[0].isDirectory)
        assertEquals("src", updated.children[1].name)
        assertTrue(updated.children[1].isDirectory)
        // Files follow, alphabetically
        assertEquals("apple.txt", updated.children[2].name)
        assertFalse(updated.children[2].isDirectory)
        assertEquals("zebra.txt", updated.children[3].name)
        assertFalse(updated.children[3].isDirectory)

        // Find child node
        val found = FileTreeHelpers.findNode(updated, "src")
        assertNotNull(found)
        assertEquals("src", found.name)
        assertTrue(found.isDirectory)
    }

    @Test
    fun testMutationCoordinatorRejectsPathTraversal() = runTest {
        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo")
        val state = FileTreeState(target, repo)
        val coordinator = FileMutationCoordinator(repo, state)

        assertFailsWith<IllegalArgumentException> {
            coordinator.createFile("../outside", "evil.sh")
        }
        assertFailsWith<IllegalArgumentException> {
            coordinator.createDirectory("src/../../outside", "sub")
        }
        assertFailsWith<IllegalArgumentException> {
            coordinator.delete("..")
        }
        assertFailsWith<IllegalArgumentException> {
            coordinator.delete("")
        }
        assertFailsWith<IllegalArgumentException> {
            coordinator.rename("", "newroot")
        }
        assertFailsWith<IllegalArgumentException> {
            coordinator.rename("file.txt", "invalid/name")
        }
        assertFailsWith<IllegalArgumentException> {
            coordinator.rename("file.txt", "../escaped.txt")
        }
    }

    @Test
    fun testFsEventAndOverflowHandlingDoNotCrash() = runTest {
        server!!.createContext("/api/fs/list") { exchange ->
            val json = """{"entries":[{"name":"test.txt","kind":"file","size":10,"mtime":100,"isSymlink":false}]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val target = ProjectTargetRef(project = "demo")
        val state = FileTreeState(target, repo)

        // Simulate incoming event
        state.handleFsEvent(
            FsEventDto(
                kind = "modify",
                path = "/project/test.txt",
                targetRelativePath = "test.txt",
            )
        )

        // Simulate overflow notice
        state.handleFsOverflow("Buffer overflow detected on watcher")

        // State surfaces explicit status without crashing or throwing
        assertNotNull(state.error.value)
    }
}
