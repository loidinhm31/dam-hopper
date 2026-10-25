package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RemoteConfigEditorTest {
    private lateinit var server: SettingsTestServer
    private lateinit var registry: ConnectionRegistry
    private lateinit var resolver: FakeOwnerResolver
    private lateinit var scope: CoroutineScope
    private lateinit var settings: SettingsRepository
    private val revocations = CopyOnWriteArrayList<String>()
    private var failRevocation = false

    private val serverConfig = """
        {"workspace":{"name":"ws","root":"/srv/ws"},
         "server":{"telemetry":{"enabled":false}},
         "projects":[{"name":"api","path":"/srv/ws/api","type":"cargo","envFile":".env","tags":["core"],
           "services":[{"name":"svc","buildCommand":"cargo build","runCommand":"cargo run"}],
           "commands":{"test":"cargo test"},
           "terminals":[{"name":"main","command":"bash","cwd":"/srv/ws/api"}],
           "restartPolicy":"never","futureKey":{"x":1}}],
         "features":{}}
    """.trimIndent().replace("\n", "").replace("  ", "")

    @BeforeTest
    fun setUp() {
        server = SettingsTestServer()
        registry = ConnectionRegistry()
        resolver = FakeOwnerResolver(registry, server.baseUrl)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        settings = SettingsRepository(
            InMemoryPreferencesStore(), resolver, scope, debounceMillis = 20L,
            invalidateRuntime = { ref ->
                revocations += "revoke:${ref.profileId}"
                if (failRevocation) throw IllegalStateException("provider unavailable")
            },
        )
        server.route("/api/config") { req ->
            if (req.method == "PUT") 200 to """{"ok":true}""" else 200 to serverConfig
        }
        server.route("/api/config/projects/api") { _ -> 200 to """{"ok":true}""" }
        server.route("/api/global-config") { _ -> 200 to """{"defaults":{"workspace":"/srv/default"},"ui":{}}""" }
        server.route("/api/global-config/defaults") { _ -> 200 to """{"updated":true}""" }
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        server.stop()
    }

    private suspend fun editor(profile: String = "T"): RemoteConfigEditor {
        val binding = resolver.connect(profile)
        settings.setSettingsTarget(profile)
        return RemoteConfigEditor(RemoteConfigRepository(binding.client), binding.owner, settings.targetAuthority())
    }

    private suspend fun newEditor(profile: String): RemoteConfigEditor = editor(profile)

    private fun puts() = server.requests.filter { it.method == "PUT" && it.path == "/api/config" }

    @Test
    fun loadParsesStructuredRowsOwnerQualifiedAndNotDirty() = runBlocking {
        val editor = editor()
        assertTrue(editor.load())
        val state = editor.state.value
        assertFalse(state.isDirty)
        assertEquals(serverConfig, state.draftConfigJson)
        val structured = editor.structured.value
        assertTrue(structured.canSave)
        val config = assertNotNull(structured.config)
        assertEquals("ws", config.workspaceName)
        assertEquals("/srv/ws", config.workspaceRoot)
        val project = config.projects.single()
        assertEquals("cargo", project.type)
        assertEquals(".env", project.envFile)
        assertEquals(listOf("core"), project.tags.map { it.value })
        assertEquals("cargo build", project.services.single().buildCommand)
        assertEquals("test", project.commands.single().name)
        assertEquals("/srv/ws/api", project.terminals.single().cwd)
        assertEquals("T", editor.owner.connection.profileId)
    }

    @Test
    fun structuredEditsPreserveUnknownKeysAndSaveExactWireShape() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateStructured { config ->
            val project = config.projects.single()
            config.copy(
                workspaceName = "renamed",
                projects = listOf(
                    project.copy(
                        envFile = "",
                        tags = project.tags + ConfigTag(editor.newRowId(), "new"),
                        services = project.services.map { it.copy(name = "svc2") },
                        commands = project.commands + ConfigCommand(editor.newRowId(), "lint", "cargo clippy"),
                        terminals = project.terminals.map { it.copy(command = "zsh") },
                    ),
                ),
            )
        }
        assertTrue(editor.state.value.isDirty)
        val outcome = editor.saveFullConfig()
        assertTrue(outcome is SettingsOutcome.Confirmed, outcome.toString())

        val body = Json.parseToJsonElement(puts().single().body).jsonObject
        assertEquals("renamed", body["workspace"]!!.jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("/srv/ws", body["workspace"]!!.jsonObject["root"]!!.jsonPrimitive.content, "root stays authoritative")
        assertEquals(JsonPrimitive(false), body["server"]!!.jsonObject["telemetry"]!!.jsonObject["enabled"])
        val project = body["projects"]!!.jsonArray.single().jsonObject
        assertEquals(JsonPrimitive("never"), project["restartPolicy"], "unknown project keys survive")
        assertEquals(JsonPrimitive(1), project["futureKey"]!!.jsonObject["x"])
        assertNull(project["envFile"], "cleared optional field is removed")
        assertEquals(listOf("core", "new"), project["tags"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("svc2", project["services"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("cargo clippy", project["commands"]!!.jsonObject["lint"]!!.jsonPrimitive.content)
        assertEquals("zsh", project["terminals"]!!.jsonArray.single().jsonObject["command"]!!.jsonPrimitive.content)
        assertFalse(editor.state.value.isDirty)
        assertEquals(listOf("revoke:T"), revocations.toList(), "runtime readiness is revoked before the write")
    }

    @Test
    fun stableRowIdsSurviveRenamesAndValidationBlocksSaveWithZeroRequests() = runBlocking {
        val editor = editor()
        editor.load()
        val rowId = editor.structured.value.config!!.projects.single().rowId
        editor.updateStructured { c -> c.copy(projects = c.projects.map { it.copy(name = "api-renamed") }) }
        assertEquals(rowId, editor.structured.value.config!!.projects.single().rowId)

        editor.updateStructured { c ->
            c.copy(
                projects = c.projects + c.projects.single().copy(rowId = editor.newRowId(), path = "", type = "bazel"),
            )
        }
        val fields = editor.structured.value.issues.map { it.field }
        assertTrue("name" in fields, "duplicate project name")
        assertTrue("path" in fields, "required path")
        assertTrue("type" in fields, "unknown type")
        val outcome = editor.saveFullConfig()
        assertTrue(outcome is SettingsOutcome.NotSubmitted)
        assertEquals(0, puts().size)
    }

    @Test
    fun conflictKeepsDraftAndNeedsExplicitResolution() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateStructured { it.copy(workspaceName = "mine") }
        val draft = editor.state.value.draftConfigJson

        val external = serverConfig.replace("\"name\":\"ws\"", "\"name\":\"theirs\"")
        editor.handleServerRefresh(external)
        assertTrue(editor.state.value.hasConflict)
        assertEquals(draft, editor.state.value.draftConfigJson, "draft must not be clobbered")
        assertEquals(external, editor.state.value.conflictingServerJson)

        val blocked = editor.saveFullConfig()
        assertTrue(blocked is SettingsOutcome.NotSubmitted)
        assertEquals(0, puts().size)

        editor.keepLocalDraft()
        assertFalse(editor.state.value.hasConflict)
        assertTrue(editor.state.value.isDirty, "draft stays dirty against the newer base")
        assertEquals(external, editor.state.value.baseConfigJson)

        editor.handleServerRefresh(serverConfig.replace("\"name\":\"ws\"", "\"name\":\"third\""))
        assertTrue(editor.state.value.hasConflict)
        editor.discardDraft()
        assertFalse(editor.state.value.isDirty)
        assertEquals("third", editor.structured.value.config!!.workspaceName)

        editor.updateStructured { it.copy(workspaceName = "forced") }
        editor.handleServerRefresh(serverConfig)
        assertTrue(editor.state.value.hasConflict)
        assertTrue(editor.saveFullConfig(overwriteConflict = true) is SettingsOutcome.Confirmed)
        assertEquals(1, puts().size)
    }

    @Test
    fun serverAnswersMapToHonestOutcomesAndKeepTheDraftWithoutRetry() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateStructured { it.copy(workspaceName = "edited") }

        server.route("/api/config") { req -> if (req.method == "PUT") 200 to """{"ok":false}""" else 200 to serverConfig }
        assertTrue(editor.saveFullConfig() is SettingsOutcome.Unknown)
        server.route("/api/config") { req -> if (req.method == "PUT") 200 to "<html>" else 200 to serverConfig }
        assertTrue(editor.saveFullConfig() is SettingsOutcome.Unknown, "malformed 2xx after admission")
        server.route("/api/config") { req -> if (req.method == "PUT") 422 to """{"error":"bad"}""" else 200 to serverConfig }
        assertTrue(editor.saveFullConfig() is SettingsOutcome.Rejected)
        server.route("/api/config") { req -> if (req.method == "PUT") 503 to "" else 200 to serverConfig }
        assertTrue(editor.saveFullConfig() is SettingsOutcome.Unknown)

        assertTrue(editor.state.value.isDirty, "an unconfirmed save never clears the draft")
        assertEquals(4, puts().size, "one attempt per explicit save, never replayed")
        assertTrue(editor.state.value.lastError != null)
    }

    @Test
    fun failedRevocationAbortsTheWriteWithZeroRequests() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateStructured { it.copy(workspaceName = "edited") }
        failRevocation = true
        val outcome = editor.saveFullConfig()
        assertTrue(outcome is SettingsOutcome.NotSubmitted, outcome.toString())
        assertEquals(0, puts().size)
        assertFalse(editor.state.value.isSaving)
        assertTrue(editor.state.value.isDirty)
    }

    @Test
    fun cancelledRevocationPropagatesAndCleansUpWithoutRequest() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val binding = resolver.connect("T")
        settings.setSettingsTarget("T")
        val slow = SettingsRepository(
            InMemoryPreferencesStore(), resolver, scope, 20L,
            invalidateRuntime = { gate.await() },
        )
        slow.setSettingsTarget("T")
        val editor = RemoteConfigEditor(RemoteConfigRepository(binding.client), binding.owner, slow.targetAuthority())
        editor.load()
        editor.updateStructured { it.copy(workspaceName = "edited") }
        val job = launch(Dispatchers.IO) { editor.saveFullConfig() }
        withTimeout(10_000) { while (!editor.state.value.isSaving) delay(5) }
        job.cancel()
        job.join()
        assertFalse(editor.state.value.isSaving)
        assertEquals(0, puts().size)
    }

    @Test
    fun suspendedCredentialsAcrossTargetAbaAreNotSubmittedWithZeroRequests() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateStructured { it.copy(workspaceName = "edited") }
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        resolver.credentialGate = { entered.complete(Unit); release.await() }

        val call = async(Dispatchers.IO) { editor.saveFullConfig() }
        withTimeout(10_000) { entered.await() }
        resolver.credentialGate = null
        settings.setSettingsTarget("other")
        settings.setSettingsTarget("T") // A -> B -> A: the first A's guard must not admit
        release.complete(Unit)

        assertTrue(withTimeout(10_000) { call.await() } is SettingsOutcome.NotSubmitted)
        assertEquals(0, puts().size)
        assertTrue(editor.state.value.isDirty)
    }

    @Test
    fun retiredOwnerIsNotSubmittedAndStaleLoadIsNeverPublished() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateStructured { it.copy(workspaceName = "edited") }
        resolver.retire("T")
        assertTrue(editor.saveFullConfig() is SettingsOutcome.NotSubmitted)
        assertEquals(0, puts().size)

        val other = newEditor("U")
        settings.setSettingsTarget("someone-else") // U is no longer the selected target
        assertFalse(other.load(), "stale owner: nothing is published")
        assertNull(other.state.value.baseConfigJson)
    }

    @Test
    fun globalDefaultsSetAndClearSendExactPayloads() = runBlocking {
        val editor = editor()
        assertTrue(editor.loadGlobalDefaults())
        assertEquals("/srv/default", editor.defaults.value.workspace)

        assertTrue(editor.setGlobalDefaultWorkspace("/srv/other") is SettingsOutcome.Confirmed)
        assertEquals("""{"defaults":{"workspace":"/srv/other"}}""", server.posts("/api/global-config/defaults")[0].body)
        assertEquals("/srv/other", editor.defaults.value.workspace)

        assertTrue(editor.clearGlobalDefaultWorkspace() is SettingsOutcome.Confirmed)
        assertEquals("""{"defaults":{}}""", server.posts("/api/global-config/defaults")[1].body)
        assertNull(editor.defaults.value.workspace)
        assertTrue(editor.setGlobalDefaultWorkspace("  ") is SettingsOutcome.NotSubmitted)
        assertEquals(2, server.posts("/api/global-config/defaults").size)
        assertEquals(0, server.count(path = "/api/workspace/known"), "the known registry is untouched")
    }

    @Test
    fun projectPatchSendsOnlyChangedFieldsAndRenameNeedsFullSave() = runBlocking {
        val editor = editor()
        editor.load()
        val rowId = editor.structured.value.config!!.projects.single().rowId
        editor.updateStructured { c ->
            c.copy(projects = c.projects.map { it.copy(envFile = "", tags = it.tags + ConfigTag(editor.newRowId(), "x")) })
        }
        assertTrue(editor.saveProject(rowId) is SettingsOutcome.Confirmed)
        val patch = Json.parseToJsonElement(server.requests.single { it.method == "PATCH" }.body).jsonObject
        assertEquals(setOf("envFile", "tags"), patch.keys)
        assertEquals(kotlinx.serialization.json.JsonNull, patch["envFile"], "cleared optional field is sent as null")
        assertEquals(JsonArray(listOf(JsonPrimitive("core"), JsonPrimitive("x"))), patch["tags"])
        assertFalse(editor.state.value.isDirty)

        editor.updateStructured { c -> c.copy(projects = c.projects.map { it.copy(name = "other") }) }
        assertTrue(editor.saveProject(rowId) is SettingsOutcome.NotSubmitted)
        assertEquals(1, server.requests.count { it.method == "PATCH" })
    }

    @Test
    fun rawJsonDraftRederivesStructuredAndMalformedDraftBlocksSave() = runBlocking {
        val editor = editor()
        editor.load()
        editor.updateConfigDraft("{not json")
        assertNotNull(editor.structured.value.parseError)
        assertTrue(editor.state.value.isDirty)
        assertTrue(editor.saveFullConfig() is SettingsOutcome.NotSubmitted)
        assertEquals(0, puts().size)

        editor.updateConfigDraft(serverConfig)
        assertFalse(editor.state.value.isDirty)
        assertNull(editor.structured.value.parseError)
    }
}
