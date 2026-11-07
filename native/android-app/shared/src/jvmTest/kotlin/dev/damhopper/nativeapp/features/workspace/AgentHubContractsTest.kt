package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.FilesystemTargetRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.ServerFsTarget
import dev.damhopper.nativeapp.features.editor.AliasLeaseToken
import dev.damhopper.nativeapp.features.editor.CloseDecision
import dev.damhopper.nativeapp.features.editor.DocumentSaveSnapshot
import dev.damhopper.nativeapp.features.editor.EditorLoadResult
import dev.damhopper.nativeapp.features.editor.FileTier
import dev.damhopper.nativeapp.features.editor.ViewLeaseToken
import dev.damhopper.nativeapp.features.files.CanonicalDocumentKey
import dev.damhopper.nativeapp.features.files.FileIdentityDto
import dev.damhopper.nativeapp.features.files.FileStatDto
import dev.damhopper.nativeapp.features.settings.PatchValue
import dev.damhopper.nativeapp.features.settings.SparseUiConfigPatch
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentState
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentHubContractsTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Test
    fun testFilesystemTargetRefQueryParamsAndWsTarget() {
        val wsTarget = FilesystemTargetRef.Workspace(profileId = "p1", workspaceEpoch = 42L)
        val wsQueryParams = wsTarget.toQueryParams()
        assertEquals(listOf("targetType" to "workspace", "workspaceEpoch" to "42"), wsQueryParams)

        val wsServerTarget = wsTarget.toServerTarget()
        assertEquals("workspace", wsServerTarget.type)
        assertEquals(42L, wsServerTarget.workspaceEpoch)
        assertNull(wsServerTarget.project)

        val projectTarget = FilesystemTargetRef.Project(
            profileId = "p1",
            project = "dam-hopper",
            worktreePath = "sub/worktree",
        )
        val projectQueryParams = projectTarget.toQueryParams()
        assertEquals(
            listOf(
                "targetType" to "project",
                "project" to "dam-hopper",
                "worktreePath" to "sub/worktree",
            ),
            projectQueryParams,
        )

        val projectServerTarget = projectTarget.toServerTarget()
        assertEquals("project", projectServerTarget.type)
        assertEquals("dam-hopper", projectServerTarget.project)
        assertEquals("sub/worktree", projectServerTarget.worktreePath)
    }

    @Test
    fun testCanonicalDocumentKeyFormat() {
        val key = CanonicalDocumentKey(
            profileId = "prof-1",
            normalizedEndpoint = "http://127.0.0.1:4801",
            authenticatedAccount = "admin",
            workspaceId = "ws-root",
            workspaceEpoch = 1001L,
            canonicalPath = "/src/main.kt",
        )

        val expected = """["prof-1","http://127.0.0.1:4801","admin","ws-root",1001,"/src/main.kt"]"""
        assertEquals(expected, key.key)
    }

    @Test
    fun testSparseUiConfigPatchNullVersusOmitted() {
        val patch = SparseUiConfigPatch(
            ui = mapOf(
                "systemFontSize" to JsonPrimitive(16),
                "terminalScrollStep" to JsonNull, // explicit unbound
            ),
        )

        val encoded = json.encodeToString(patch)
        assertTrue(encoded.contains("\"systemFontSize\":16"))
        assertTrue(encoded.contains("\"terminalScrollStep\":null"))
        assertFalse(encoded.contains("editorFontSize")) // omitted

        val explicitNull: PatchValue<String> = PatchValue.ExplicitNull
        assertTrue(explicitNull.isExplicitNull())
        assertTrue(explicitNull.isChanged())
        assertNull(explicitNull.toNullable())

        val unchanged: PatchValue<String> = PatchValue.Unchanged
        assertFalse(unchanged.isExplicitNull())
        assertFalse(unchanged.isChanged())
    }

    @Test
    fun testMixedIdentityCasingInFileStat() {
        val camelJson = """
            {
                "kind": "file",
                "size": 128,
                "fileIdentity": {
                    "workspaceId": "ws-1",
                    "workspaceEpoch": 50,
                    "canonicalPath": "/Cargo.toml"
                }
            }
        """.trimIndent()
        val camelStat = json.decodeFromString<FileStatDto>(camelJson)
        assertNotNull(camelStat.fileIdentity)
        assertEquals(50L, camelStat.effectiveEpoch)

        val snakeJson = """
            {
                "kind": "file",
                "size": 128,
                "file_identity": {
                    "workspaceId": "ws-1",
                    "workspaceEpoch": 75,
                    "canonicalPath": "/Cargo.toml"
                }
            }
        """.trimIndent()
        val snakeStat = json.decodeFromString<FileStatDto>(snakeJson)
        assertNotNull(snakeStat.fileIdentitySnake)
        assertEquals(75L, snakeStat.effectiveEpoch)
    }

    @Test
    fun testAgentHubSnapshotAndActionContracts() {
        val target = ProjectTargetRef(project = "dam-hopper")
        val t1 = HubTerminalRow(
            id = "t1",
            displayName = "Cargo Build",
            command = "cargo build",
            projectTarget = target,
            isPinned = true,
            isHidden = false,
        )
        val t2 = HubTerminalRow(
            id = "t2",
            displayName = "Background Monitor",
            command = "htop",
            projectTarget = target,
            isPinned = false,
            isHidden = true,
        )

        val snapshot = AgentHubSnapshot(
            profileId = "local",
            selectedProjectTarget = target,
            terminalRows = listOf(t1, t2),
            pinnedTerminalIds = setOf("t1"),
            hiddenTerminalIds = setOf("t2"),
            isInventoryLoaded = true,
        )

        assertEquals(listOf(t1), snapshot.activeTerminals)
        assertEquals(listOf(t2), snapshot.hiddenTerminals)
        assertEquals(listOf(t1), snapshot.pinnedTerminals)

        val hideAction = AgentHubAction.HideTerminal("t1")
        assertEquals("t1", hideAction.terminalId)

        val terminateAction = AgentHubAction.TerminateTerminal(
            terminalId = "t1",
            expectedServerEpoch = "uuid-1234",
            expectedIncarnation = "1",
        )
        assertEquals("t1", terminateAction.terminalId)
        assertEquals("uuid-1234", terminateAction.expectedServerEpoch)
        assertEquals("1", terminateAction.expectedIncarnation)
    }

    @Test
    fun testDocumentRetentionAndLeaseTransitions() {
        var activeAliases = setOf<AliasLeaseToken>()
        var activeViews = setOf<ViewLeaseToken>()
        var isDirty = false

        fun canDispose(): Boolean = activeAliases.isEmpty() && activeViews.isEmpty() && !isDirty

        // Step 1: Open first alias
        val lease1 = AliasLeaseToken(token = "tok-1", aliasId = "tab-a", capturedRevision = 1L)
        activeAliases = activeAliases + lease1
        assertFalse(canDispose())

        // Step 2: Open second alias to same canonical document
        val lease2 = AliasLeaseToken(token = "tok-2", aliasId = "tab-b", capturedRevision = 1L)
        activeAliases = activeAliases + lease2
        assertFalse(canDispose())

        // Step 3: Close first alias — another alias survives close!
        activeAliases = activeAliases - lease1
        assertEquals(1, activeAliases.size)
        assertFalse(canDispose())

        // Step 4: Attach a UI view surface
        val viewLease = ViewLeaseToken(token = "view-1", surfaceId = "sora-surface")
        activeViews = activeViews + viewLease
        assertFalse(canDispose())

        // Step 5: Close second alias, but view lease is still attached
        activeAliases = activeAliases - lease2
        assertEquals(0, activeAliases.size)
        assertFalse(canDispose()) // View lease prevents disposal!

        // Step 6: Detach view
        activeViews = activeViews - viewLease
        assertTrue(canDispose())

        // Step 7: Final dirty close choices contract
        val closeChoices = listOf(
            CloseDecision.SAVE,
            CloseDecision.DISCARD,
            CloseDecision.CANCEL,
        )
        assertEquals(3, closeChoices.size)
    }

    @Test
    fun testEditorLoadResultAndSaveSnapshotIdentityBearing() {
        val identity = FileIdentityDto(
            workspaceId = "ws-prod",
            workspaceEpoch = 200L,
            canonicalPath = "/app/index.ts",
        )

        val loadResult = EditorLoadResult.Success(
            content = "console.log('hi')",
            mtime = 1710000000L,
            size = 17L,
            tier = FileTier.NORMAL,
            fileIdentity = identity,
            canonicalPath = "/app/index.ts",
        )
        assertEquals(identity, loadResult.fileIdentity)
        assertEquals("/app/index.ts", loadResult.canonicalPath)

        val snapshot = DocumentSaveSnapshot(
            id = dev.damhopper.nativeapp.features.workspace.DocumentId(
                owner = dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner(
                    profileId = "p1",
                    baseUrl = "http://127.0.0.1:4801",
                    accountUser = "admin",
                    project = "dam-hopper",
                    workspaceEpoch = 200L,
                ),
                relativePath = "app/index.ts",
                tabIncarnation = 1L,
            ),
            revision = 5L,
            utf8Bytes = "console.log('hi')".encodeToByteArray(),
            mtime = 1710000000L,
            fileIdentity = identity,
            canonicalPath = "/app/index.ts",
        )
        assertEquals(identity, snapshot.fileIdentity)
        assertEquals("/app/index.ts", snapshot.canonicalPath)
    }
}
