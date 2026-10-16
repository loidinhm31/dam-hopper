package dev.damhopper.nativeapp.features.files

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SearchAndReplaceTest {

    private var server1: HttpServer? = null
    private var server2: HttpServer? = null
    private var port1: Int = 0
    private var port2: Int = 0

    @BeforeTest
    fun setUp() {
        server1 = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        port1 = server1!!.address.port
        server1!!.start()

        server2 = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        port2 = server2!!.address.port
        server2!!.start()
    }

    @AfterTest
    fun tearDown() {
        server1?.stop(0)
        server2?.stop(0)
    }

    @Test
    fun testSearchContentScopeAndParams() = runTest {
        server1!!.createContext("/api/fs/search") { exchange ->
            val query = exchange.requestURI.query
            if (query.contains("scope=workspace")) {
                assertFalse(query.contains("worktreePath"))
                val json = """{"query":"foo","matches":[{"path":"proj1/file.kt","line":1,"col":5,"text":"val foo = 1"}],"truncated":false}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                assertTrue(query.contains("project=demo"))
                assertTrue(query.contains("worktreePath"))
                val json = """{"query":"foo","matches":[{"path":"file.kt","line":1,"col":5,"text":"val foo = 1"}],"truncated":false}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        val client = ApiClient(ConnectionRef("p1", 1L), "http://127.0.0.1:$port1", { "tok" })
        val searchRepo = SearchRepository()

        // 1. Project scope
        val projResult = searchRepo.searchContent(
            apiClient = client,
            target = ProjectTargetRef(project = "demo", worktreePath = "/tmp/wt"),
            query = "foo",
            scope = SearchScope.PROJECT,
        )
        assertEquals(1, projResult.matches.size)

        // 2. Workspace scope
        val wsResult = searchRepo.searchContent(
            apiClient = client,
            target = ProjectTargetRef(project = "demo", worktreePath = "/tmp/wt"),
            query = "foo",
            scope = SearchScope.WORKSPACE,
        )
        assertEquals(1, wsResult.matches.size)
    }

    @Test
    fun testFederatedSearchAggregatesAndIsolatesFailures() = runTest {
        // Server 1 returns 2 matches
        server1!!.createContext("/api/fs/search") { exchange ->
            val json = """{"query":"test","matches":[{"path":"a.kt","line":1,"col":1,"text":"test1"},{"path":"b.kt","line":2,"col":1,"text":"test2"}],"truncated":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        // Server 2 throws 500 error
        server2!!.createContext("/api/fs/search") { exchange ->
            exchange.sendResponseHeaders(500, 0)
            exchange.responseBody.close()
        }

        val client1 = ApiClient(ConnectionRef("p1", 1L), "http://127.0.0.1:$port1", { "tok1" })
        val client2 = ApiClient(ConnectionRef("p2", 1L), "http://127.0.0.1:$port2", { "tok2" })

        val bindings = listOf(
            ProfileTargetBinding("p1", client1, ProjectTargetRef(project = "proj1")),
            ProfileTargetBinding("p2", client2, ProjectTargetRef(project = "proj2")),
        )

        val coordinator = FederatedSearchCoordinator(SearchRepository())
        val fedResult = coordinator.federateContentSearch(bindings, "test")

        // Server 1 matches preserved
        assertEquals(2, fedResult.matches.size)
        assertEquals("p1", fedResult.matches[0].profileId)
        assertEquals("a.kt", fedResult.matches[0].path)

        // Server 2 failure recorded in partialFailures without killing overall search
        assertEquals(1, fedResult.partialFailures.size)
        assertTrue(fedResult.partialFailures[0].contains("p2"))
    }
    @Test
    fun testWorkspaceScopeSearchPreservesProjectIdentity() = runTest {
        server1!!.createContext("/api/fs/search") { exchange ->
            val json = """{"query":"test","matches":[{"path":"src/App.tsx","line":10,"col":5,"text":"test","project":"web"}],"truncated":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val client = ApiClient(ConnectionRef("p1", 1L), "http://127.0.0.1:$port1", { "tok" })
        val bindings = listOf(
            ProfileTargetBinding("p1", client, ProjectTargetRef(project = "server"))
        )

        val coordinator = FederatedSearchCoordinator(SearchRepository())
        val result = coordinator.federateContentSearch(bindings, "test", scope = SearchScope.WORKSPACE)

        assertEquals(1, result.matches.size)
        // Must be qualified with the actual match project "web", NOT the bound project "server"
        assertEquals("web", result.matches[0].target.project)
    }


    @Test
    fun testReplaceLiteralPreservesSpecialCharacters() {
        val coordinator = ReplaceCoordinator({ null })

        // Dollars and backslashes must remain literal (no regex group or escape interpretation)
        val text1 = "Price is \$10 for item."
        val result1 = coordinator.replaceLiteral(text1, "\$10", "\$25.50", false)
        assertEquals("Price is \$25.50 for item.", result1)

        val text2 = "C:\\path\\to\\dir"
        val result2 = coordinator.replaceLiteral(text2, "\\", "/", false)
        assertEquals("C:/path/to/dir", result2)

        // Unicode and emojis
        val text3 = "Hello 🚀 world 🚀!"
        val result3 = coordinator.replaceLiteral(text3, "🚀", "✨", false)
        assertEquals("Hello ✨ world ✨!", result3)

        // Case insensitivity
        val text4 = "Alpha beta ALPHA"
        val result4 = coordinator.replaceLiteral(text4, "alpha", "gamma", true)
        assertEquals("gamma beta gamma", result4)
    }

    @Test
    fun testReplaceCoordinatorBlocksDirtyFiles() = runTest {
        val target = ProjectTargetRef(project = "proj")
        val coordinator = ReplaceCoordinator(
            repositoryProvider = { null },
            isDirtyFile = { t, path -> path == "dirty.kt" }
        )
        val previews = listOf(
            ReplaceFilePreview("p1", target, "clean.kt", 1, 100L, false),
            ReplaceFilePreview("p1", target, "dirty.kt", 1, 100L, true),
        )
        val summary = ReplacePreviewSummary(
            searchQuery = "needle",
            replaceQuery = "replacement",
            caseSensitive = false,
            totalMatches = 2,
            files = previews,
            isSearchTruncated = false,
        )

        val batch = coordinator.applyBatch(summary)

        assertEquals(1, batch.skippedDirtyCount)
        assertTrue(batch.outcomes.any { it is ReplaceFileOutcome.SkippedDirty && it.path == "dirty.kt" })

        // Truncated search must fail closed
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            coordinator.applyBatch(summary.copy(isSearchTruncated = true))
        }
    }
}
