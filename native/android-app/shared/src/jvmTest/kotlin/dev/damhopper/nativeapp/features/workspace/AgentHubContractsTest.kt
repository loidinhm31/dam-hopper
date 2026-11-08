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
        val openZero = AgentHubAction.OpenZeroSessionProject(target)
        assertEquals(target, openZero.target)

        val dismissZero = AgentHubAction.DismissZeroSessionProject(target)
        assertEquals(target, dismissZero.target)

        val openFiles = AgentHubAction.OpenFiles(FilesystemTargetRef.Project("local", "dam-hopper", null))
        assertEquals("dam-hopper", (openFiles.target as FilesystemTargetRef.Project).project)

        val openGit = AgentHubAction.OpenGit(target)
        assertEquals(target, openGit.target)

        val openEditor = AgentHubAction.OpenEditor("src/main.kt")
        assertEquals("src/main.kt", openEditor.fileRef)

        val openSettings = AgentHubAction.OpenSettings("NOTIFICATIONS")
        assertEquals("NOTIFICATIONS", openSettings.targetCategory)

        assertEquals(AgentHubAction.OpenNotifications, AgentHubAction.OpenNotifications)
        assertEquals(AgentHubAction.HandleBackPressed, AgentHubAction.HandleBackPressed)
    }

    @Test
    fun testZeroSessionDismissalSafetyContract() {
        val targetA = ProjectTargetRef(profileId = "p1", project = "proj-active")
        val targetZ = ProjectTargetRef(profileId = "p1", project = "proj-zero")
        val tActive = HubTerminalRow(
            id = "t1",
            displayName = "Active",
            command = "bash",
            projectTarget = targetA,
            alive = true,
        )

        val snapshot = AgentHubSnapshot(
            profileId = "p1",
            selectedProjectTarget = targetA,
            zeroSessionOpenTargets = listOf(targetZ),
            terminalRows = listOf(tActive),
            isInventoryLoaded = true,
            isConnected = true,
        )

        // Active target has live sessions -> cannot be dismissed as zero-session
        val activeSessions = snapshot.terminalRows.filter { it.projectTarget == targetA }
        assertEquals(1, activeSessions.size)

        // Zero-session target has 0 sessions -> eligible for dismissal
        val zeroSessions = snapshot.terminalRows.filter { it.projectTarget == targetZ }
        assertEquals(0, zeroSessions.size)
        assertTrue(snapshot.zeroSessionOpenTargets.contains(targetZ))
    }

    @Test
    fun testSameTerminalIdAcrossDifferentProfilesPreservesProfileIdentity() {
        val targetP1 = ProjectTargetRef(profileId = "prof-1", project = "proj-alpha")
        val targetP2 = ProjectTargetRef(profileId = "prof-2", project = "proj-alpha")
        val t1 = HubTerminalRow(
            id = "common-term-id",
            displayName = "Server 1 Terminal",
            command = "sh",
            projectTarget = targetP1,
            alive = true,
        )
        val t2 = HubTerminalRow(
            id = "common-term-id",
            displayName = "Server 2 Terminal",
            command = "zsh",
            projectTarget = targetP2,
            alive = true,
        )

        val snapshot = AgentHubSnapshot(
            profileId = "prof-1",
            selectedProjectTarget = targetP1,
            terminalRows = listOf(t1, t2),
            isInventoryLoaded = true,
            isConnected = true,
        )

        assertEquals(2, snapshot.terminalRows.size)
        assertEquals("prof-1", snapshot.terminalRows[0].projectTarget?.profileId)
        assertEquals("prof-2", snapshot.terminalRows[1].projectTarget?.profileId)

        val termActionP1 = AgentHubAction.TerminateTerminal(
            terminalId = "common-term-id",
            expectedServerEpoch = "uuid-1",
            expectedIncarnation = "1",
            profileId = "prof-1",
        )
        val termActionP2 = AgentHubAction.TerminateTerminal(
            terminalId = "common-term-id",
            expectedServerEpoch = "uuid-2",
            expectedIncarnation = "2",
            profileId = "prof-2",
        )
        assertEquals("prof-1", termActionP1.profileId)
        assertEquals("prof-2", termActionP2.profileId)
    }

    @Test
    fun testZeroSessionDismissalLifecycleSimulation() {
        var zeroTargets = setOf<ProjectTargetRef>()
        val target = ProjectTargetRef(profileId = "p1", project = "empty-proj")

        // 1. Open zero-session project
        zeroTargets = zeroTargets + target
        assertTrue(zeroTargets.contains(target))

        // 2. Simulation: dismissal with sessions present fails
        fun tryDismiss(target: ProjectTargetRef, hasSessions: Boolean): Boolean {
            if (hasSessions) return false
            zeroTargets = zeroTargets - target
            return true
        }

        assertFalse(tryDismiss(target, hasSessions = true), "Cannot dismiss while sessions exist")
        assertTrue(zeroTargets.contains(target))

        // 3. Dismissal when 0 sessions exist succeeds
        assertTrue(tryDismiss(target, hasSessions = false), "Dismiss succeeds with 0 sessions")
        assertFalse(zeroTargets.contains(target))
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
