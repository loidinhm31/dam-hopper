package dev.damhopper.nativeapp.features.settings

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

class RemoteConfigEditorTest {

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

    private fun createEditor(): Pair<RemoteConfigEditor, RemoteConfigRepository> {
        val conn = ConnectionRef("config-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "token" }
        )
        val repo = RemoteConfigRepository(client)
        val editor = RemoteConfigEditor(repo)
        return Pair(editor, repo)
    }

    @Test
    fun testLoadAndDirtyTracking() = runTest {
        val initialConfig = """{"workspace":{"name":"test-ws"},"projects":[]}"""
        server!!.createContext("/api/config") { exchange ->
            exchange.sendResponseHeaders(200, initialConfig.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(initialConfig.toByteArray()) }
        }
        server!!.createContext("/api/global-config") { exchange ->
            val global = """{"defaults":null,"workspaces":null,"ui":{"terminalFontSize":16,"editorFontSize":14,"systemFontSize":12,"cognitoModeStyle":"heavy-blur"}}"""
            exchange.sendResponseHeaders(200, global.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(global.toByteArray()) }
        }

        val (editor, _) = createEditor()
        editor.load()

        var state = editor.state.value
        assertFalse(state.isDirty)
        assertFalse(state.hasConflict)
        assertEquals(initialConfig, state.draftConfigJson)
        assertEquals(16, state.uiPreferencesBase.terminalFontSize)

        // Make an edit to config JSON
        val modifiedConfig = """{"workspace":{"name":"test-ws-edited"},"projects":[]}"""
        editor.updateConfigDraft(modifiedConfig)
        state = editor.state.value
        assertTrue(state.isDirty)
        assertEquals(modifiedConfig, state.draftConfigJson)

        // Reverting back to base resets isDirty
        editor.updateConfigDraft(initialConfig)
        assertFalse(editor.state.value.isDirty)
    }

    @Test
    fun testConflictDetectionOnServerRefresh() = runTest {
        val initialConfig = """{"workspace":{"name":"initial"}}"""
        server!!.createContext("/api/config") { exchange ->
            exchange.sendResponseHeaders(200, initialConfig.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(initialConfig.toByteArray()) }
        }
        server!!.createContext("/api/global-config") { exchange ->
            val global = """{"ui":{}}"""
            exchange.sendResponseHeaders(200, global.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(global.toByteArray()) }
        }

        val (editor, _) = createEditor()
        editor.load()

        // User makes local uncommitted edit
        val userDraft = """{"workspace":{"name":"user-edited"}}"""
        editor.updateConfigDraft(userDraft)
        assertTrue(editor.state.value.isDirty)

        // Server refresh arrives with external changes
        val externalServerConfig = """{"workspace":{"name":"externally-modified"}}"""
        editor.handleServerRefresh(externalServerConfig)

        val state = editor.state.value
        // Invariant: User draft must NOT be overwritten!
        assertEquals(userDraft, state.draftConfigJson, "Draft must be preserved during external change")
        assertTrue(state.isDirty)
        assertTrue(state.hasConflict, "Conflict must be flagged")
        assertEquals(externalServerConfig, state.conflictingServerJson)

        // Discarding draft resolves conflict and applies latest server state
        editor.discardDraft()
        val discardedState = editor.state.value
        assertFalse(discardedState.isDirty)
        assertFalse(discardedState.hasConflict)
        assertEquals(externalServerConfig, discardedState.draftConfigJson)
    }

    @Test
    fun testSaveFullConfigAndUiPreferences() = runTest {
        var observedPutBody: String? = null
        var observedUiBody: String? = null

        server!!.createContext("/api/config") { exchange ->
            if (exchange.requestMethod == "PUT") {
                observedPutBody = exchange.requestBody.bufferedReader().readText()
                val resp = """{"ok":true}"""
                exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(resp.toByteArray()) }
            } else {
                val resp = """{"workspace":{"name":"base"}}"""
                exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(resp.toByteArray()) }
            }
        }
        server!!.createContext("/api/global-config/ui") { exchange ->
            observedUiBody = exchange.requestBody.bufferedReader().readText()
            val resp = """{"updated":true}"""
            exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(resp.toByteArray()) }
        }
        server!!.createContext("/api/global-config") { exchange ->
            val resp = """{"ui":{"terminalFontSize":14}}"""
            exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(resp.toByteArray()) }
        }

        val (editor, _) = createEditor()
        editor.load()

        editor.updateConfigDraft("""{"workspace":{"name":"saved-draft"}}""")
        val fullSaveSuccess = editor.saveFullConfig()
        assertTrue(fullSaveSuccess)
        assertNotNull(observedPutBody)
        assertTrue(observedPutBody!!.contains("saved-draft"))
        assertFalse(editor.state.value.isDirty)

        editor.updateUiPreferencesDraft(UiPreferences(terminalFontSize = 18, cognitoModeStyle = "black-screen"))
        assertTrue(editor.state.value.isUiPreferencesDirty)
        val uiSaveSuccess = editor.saveUiPreferences()
        assertTrue(uiSaveSuccess)
        assertNotNull(observedUiBody)
        assertTrue(observedUiBody!!.contains("black-screen"))
        assertFalse(editor.state.value.isUiPreferencesDirty)
    }
}
