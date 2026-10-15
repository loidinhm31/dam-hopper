package dev.damhopper.nativeapp.features.terminal

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TerminalModelsTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun testTerminalSessionMetaSerialization() {
        val rawJson = """
            {
                "id": "term-1",
                "incarnation": 3,
                "project": "dam-hopper",
                "command": "bash",
                "cwd": "/workspace",
                "worktreePath": "/workspace/worktree-1",
                "name": "Dev Shell",
                "type": "traditional",
                "alive": true,
                "exit_code": null,
                "started_at": 1700000000,
                "restart_count": 0,
                "last_exit_at": null,
                "restart_policy": "on-failure",
                "targetUnavailable": false
            }
        """.trimIndent()

        val meta = json.decodeFromString<TerminalSessionMeta>(rawJson)
        assertEquals("term-1", meta.id)
        assertEquals(3uL, meta.incarnation)
        assertEquals("dam-hopper", meta.project)
        assertEquals("bash", meta.command)
        assertEquals("/workspace", meta.cwd)
        assertEquals("/workspace/worktree-1", meta.worktreePath)
        assertEquals("Dev Shell", meta.name)
        assertEquals("Dev Shell", meta.displayName)
        assertEquals("traditional", meta.sessionType)
        assertTrue(meta.alive)
        assertNull(meta.exitCode)
        assertEquals(0u, meta.restartCount)
        assertFalse(meta.targetUnavailable)
    }

    @Test
    fun testTerminalSessionDetailedSerialization() {
        val rawJson = """
            {
                "id": "term-2",
                "incarnation": 1,
                "command": "vim",
                "cwd": "/tmp",
                "type": "traditional",
                "alive": false,
                "exit_code": 130,
                "started_at": 1700000000,
                "restart_count": 2,
                "last_exit_at": 1700001000,
                "restart_policy": "always",
                "targetUnavailable": false,
                "buffer_bytes": 1048576
            }
        """.trimIndent()

        val detailed = json.decodeFromString<TerminalSessionDetailed>(rawJson)
        assertEquals("term-2", detailed.id)
        assertFalse(detailed.alive)
        assertEquals(130, detailed.exitCode)
        assertEquals(2u, detailed.restartCount)
        assertEquals(1048576L, detailed.bufferBytes)
        assertEquals("term-2", detailed.displayName)

        val meta = detailed.toMeta()
        assertEquals(detailed.id, meta.id)
        assertEquals(detailed.alive, meta.alive)
    }

    @Test
    fun testCreateAndRenameSessionRequests() {
        val create = CreateSessionRequest(
            id = "sess-new",
            command = "zsh",
            cwd = "/home/user",
            env = mapOf("FOO" to "BAR"),
            cols = 120,
            rows = 40,
            project = "my-proj",
            worktreePath = "/path/to/wt",
            name = "Custom Name"
        )
        val serializedCreate = json.encodeToString(CreateSessionRequest.serializer(), create)
        val deserializedCreate = json.decodeFromString<CreateSessionRequest>(serializedCreate)
        assertEquals(create, deserializedCreate)

        val rename = RenameSessionRequest(name = "New Title")
        val serializedRename = json.encodeToString(RenameSessionRequest.serializer(), rename)
        val deserializedRename = json.decodeFromString<RenameSessionRequest>(serializedRename)
        assertEquals("New Title", deserializedRename.name)
    }

    @Test
    fun testAgentStatusSnapshotAndRowSerialization() {
        val snapshotJson = """
            {
                "version": 1,
                "serverEpoch": 42,
                "revision": 105,
                "availability": "ready",
                "terminals": [
                    {
                        "id": "term-omp-1",
                        "incarnation": 5,
                        "agentKind": "omp",
                        "agentSessionId": "omp-sess-100",
                        "reporterEpoch": 1,
                        "state": "working",
                        "source": "lifecycle",
                        "observedAtMs": 1710000000,
                        "expiresAtMs": 1710015000,
                        "turnId": "turn-42",
                        "attentionRevision": 2,
                        "lastOutcome": "ended"
                    },
                    {
                        "id": "term-codex-2",
                        "incarnation": 2,
                        "agentKind": "codex",
                        "agentSessionId": "codex-sess-200",
                        "reporterEpoch": 1,
                        "state": "blocked",
                        "source": "hook",
                        "reason": "approval",
                        "attentionRevision": 3
                    }
                ]
            }
        """.trimIndent()

        val snapshot = json.decodeFromString<AgentStatusSnapshotV1>(snapshotJson)
        assertEquals(1u, snapshot.version)
        assertEquals(42uL, snapshot.serverEpoch)
        assertEquals(105uL, snapshot.revision)
        assertEquals(AgentStatusAvailability.READY, snapshot.availability)
        assertEquals(2, snapshot.terminals.size)

        val omp = snapshot.terminals[0]
        assertEquals(AgentKind.OMP, omp.agentKind)
        assertEquals(AgentState.WORKING, omp.state)
        assertEquals(AgentObservationSource.LIFECYCLE, omp.source)
        assertEquals(TurnOutcome.ENDED, omp.lastOutcome)

        val codex = snapshot.terminals[1]
        assertEquals(AgentKind.CODEX, codex.agentKind)
        assertEquals(AgentState.BLOCKED, codex.state)
        assertEquals(BlockedReason.APPROVAL, codex.reason)
    }

    @Test
    fun testAgentAttentionEventSerialization() {
        val raw = """
            {
                "id": "42:term-1:1:5",
                "kind": "needs-attention",
                "terminalId": "term-1",
                "incarnation": 1,
                "agentKind": "claude",
                "agentSessionId": "claude-xyz",
                "reason": "question",
                "attentionRevision": 5,
                "timestampMs": 1710005000
            }
        """.trimIndent()

        val attention = json.decodeFromString<AgentAttentionEvent>(raw)
        assertEquals("42:term-1:1:5", attention.id)
        assertEquals(AttentionKind.NEEDS_ATTENTION, attention.kind)
        assertEquals(AgentKind.CLAUDE, attention.agentKind)
        assertEquals(BlockedReason.QUESTION, attention.reason)
        assertEquals(5uL, attention.attentionRevision)
    }

    @Test
    fun testIntegrationReportsSerialization() {
        val extJson = """
            {
                "status": "current",
                "target_path": "/home/user/.omp/agent",
                "version": "1.0.0",
                "bundled_version": "1.0.0",
                "content_hash": "abc123hash",
                "bundled_hash": "abc123hash",
                "details": "Extension up to date"
            }
        """.trimIndent()
        val extReport = json.decodeFromString<ExtensionStatusReport>(extJson)
        assertEquals("current", extReport.status)
        assertEquals("/home/user/.omp/agent", extReport.targetPath)
        assertEquals("1.0.0", extReport.version)

        val nativeJson = """
            {
                "agentKind": "codex",
                "status": "absent",
                "readiness": "unverified",
                "target_path": "/home/user/.codex/launcher.sh",
                "launcher_path": "/home/user/.codex/launcher.sh",
                "manifest_path": "/home/user/.codex/manifest.json",
                "bundled_version": "0.13.2",
                "bundled_hash": "hash456"
            }
        """.trimIndent()
        val nativeReport = json.decodeFromString<NativeIntegrationStatusReport>(nativeJson)
        assertEquals(AgentKind.CODEX, nativeReport.agentKind)
        assertEquals("absent", nativeReport.status)
        assertEquals("unverified", nativeReport.readiness)

        val pathsJson = """
            {
                "effectiveHome": "/home/user",
                "ompInstallDir": "/home/user/.omp/agent",
                "ompNotificationDir": "/home/user/.omp/agent",
                "ompStatus": "current",
                "ompCanEnable": true,
                "codexConfigDir": "/home/user/.codex",
                "codexNotificationDir": "/home/user/.codex",
                "codexConfigExists": true,
                "codexCanEnable": true
            }
        """.trimIndent()
        val paths = json.decodeFromString<AgentPathsVerification>(pathsJson)
        assertEquals("/home/user", paths.effectiveHome)
        assertTrue(paths.ompCanEnable)
        assertTrue(paths.codexCanEnable)
        assertNull(paths.claudeConfigDir)
    }
}
