package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.features.settings.RemoteConfigRepository
import dev.damhopper.nativeapp.features.settings.SparseUiConfigPatch
import dev.damhopper.nativeapp.features.settings.TestGuard
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LiveDaemonSmokeTest {

    private val liveBaseUrl = "http://127.0.0.1:4899"

    @Test
    fun testLiveDaemonWindowsPtyCreateAndSignalFailureMapping() = runBlocking {
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("smoke-profile")
        val client = ApiClient(ref, liveBaseUrl, { null }, registry)
        val store = InMemoryPreferencesStore()
        val repo = TerminalRepository(client, null, store)

        // 1. Live health check
        val health = client.health()
        assertTrue(health.status.isNotBlank(), "Daemon must be healthy: ${health.status}")

        // 2. Live PTY Creation
        val terminalId = "live-pty-${kotlinx.datetime.Clock.System.now().toEpochMilliseconds()}"
        val outcome = repo.createSessionGuarded(
            CreateSessionRequest(
                id = terminalId,
                command = "ping 127.0.0.1 -n 31 >NUL",
                cwd = ".",
            )
        )
        assertEquals(terminalId, outcome.id)
        assertTrue(outcome.incarnation > 0uL, "Incarnation must be positive numeric u64")
        assertTrue(
            TerminateSessionRequest.isValidEpoch(outcome.ptyEpoch),
            "Server must emit valid lowercase UUID epoch: '${outcome.ptyEpoch}'"
        )

        // Wait for Windows ConPTY initialization
        kotlinx.coroutines.delay(500)

        // 3. Live Detailed List inspection
        val detailed = repo.listDetailed()
        val createdSession = detailed.find { it.id == terminalId }
        assertNotNull(createdSession, "Created session must appear in live daemon inventory")
        assertEquals(outcome.ptyEpoch, createdSession.serverPtyEpoch, "Detailed list must carry matching PTY epoch")

        // 4. Wrong-epoch termination refusal (409)
        val wrongOutcome = repo.terminateSession(
            id = terminalId,
            expectedServerEpoch = "00000000-0000-0000-0000-000000000001",
            expectedIncarnation = outcome.incarnation.toString(),
        )
        assertFalse(wrongOutcome.requested, "Wrong epoch must be refused")
        assertFalse(wrongOutcome.restartCancelled)
        assertEquals(409, wrongOutcome.statusCode, "Server must respond with HTTP 409 Conflict")

        // Session must remain alive after refusal
        val afterRefusal = repo.listDetailed().find { it.id == terminalId }
        assertNotNull(afterRefusal)

        // 5. Correct-epoch guarded termination
        val termOutcome = repo.terminateSession(
            id = terminalId,
            expectedServerEpoch = outcome.ptyEpoch,
            expectedIncarnation = outcome.incarnation.toString(),
        )
        assertTrue(termOutcome.statusCode in listOf(200, 202, 500), "Status code must be 202, 200 or 500: ${termOutcome.statusCode}")
        if (termOutcome.statusCode == 202) {
            assertTrue(termOutcome.requested)
        } else if (termOutcome.statusCode == 500) {
            assertFalse(termOutcome.requested)
            assertEquals("OS process signal dispatch failed", termOutcome.message)
        }
    }

    @Test
    fun testLiveDaemonSettingsSparsePatchAndUnknownKeyPreservation() = runBlocking {
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("smoke-settings-profile")
        val client = ApiClient(ref, liveBaseUrl, { null }, registry)
        val remoteRepo = RemoteConfigRepository(client)
        val guard = TestGuard()

        // 1. Seed initial global config with non-default web OS key ("floating") and bound shortcut
        val seedPatch = SparseUiConfigPatch(
            ui = mapOf(
                "defaultWindowPlacement" to JsonPrimitive("floating"),
                "searchTextShortcut" to JsonPrimitive("Ctrl+F"),
            )
        )
        assertTrue(remoteRepo.updateGlobalUiSparse(seedPatch, guard), "Seed update must succeed")

        val initialConfig = remoteRepo.getGlobalConfig()
        val initialUi = initialConfig["ui"] as JsonObject
        assertEquals(
            "floating",
            (initialUi["defaultWindowPlacement"] as? JsonPrimitive)?.content,
            "Seeded non-default web OS key must be set to 'floating'"
        )

        // 2. Dispatch sparse patch: unbind searchTextShortcut (send null) and update terminalFontSize to 24
        val patch = SparseUiConfigPatch(
            ui = mapOf(
                "searchTextShortcut" to JsonNull,
                "terminalFontSize" to JsonPrimitive(24),
            )
        )
        val updated = remoteRepo.updateGlobalUiSparse(patch, guard)
        assertTrue(updated, "Sparse patch update must succeed on live daemon")

        // 3. Re-read global config and verify persistence and preservation
        val afterConfig = remoteRepo.getGlobalConfig()
        val afterUi = afterConfig["ui"] as JsonObject

        // Unbound key is now absent or explicit JsonNull in JSON response
        val rawVal = afterUi["searchTextShortcut"]
        val isProperlyUnbound = when (rawVal) {
            null -> true
            is JsonNull -> true
            is JsonPrimitive -> rawVal.isString && rawVal.content.isEmpty()
            else -> false // Objects and arrays are NEVER valid unbound values!
        }
        assertTrue(isProperlyUnbound, "Unbound shortcut must be absent, JsonNull, or empty string (got $rawVal)")

        // Changed value is updated
        assertEquals("24", (afterUi["terminalFontSize"] as? JsonPrimitive)?.content)

        // Non-default web OS key is preserved untouched (proves server did not reset to 'tiling' default)
        assertEquals(
            "floating",
            (afterUi["defaultWindowPlacement"] as? JsonPrimitive)?.content,
            "Non-default web OS key 'floating' must be preserved untouched by live daemon"
        )
    }

    @Test
    fun testUncertainCreateBlocksDuplicateAgainstLiveDaemon() = runBlocking {
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("smoke-barrier-profile")
        val client = ApiClient(ref, liveBaseUrl, { null }, registry)
        val store = InMemoryPreferencesStore()
        val repo = TerminalRepository(client, null, store)

        val project = "smoke-project-barrier"
        // Seed an unsettled pending intent
        store.saveUncertainCreateRecord(
            UncertainCreateRecord(
                intentId = "intent-live-test",
                profileId = ref.profileId,
                terminalId = "term-first-attempt",
                project = project,
                createdAtEpochMs = 1710000000L,
                status = UncertainCreateStatus.PENDING,
            )
        )

        // Attempting to create another terminal for the same project must be BLOCKED before network dispatch
        assertFailsWith<IllegalStateException> {
            repo.createSession(
                CreateSessionRequest(id = "term-second-attempt", command = "cmd.exe", project = project)
            )
        }

        // Verify no session was created on the live daemon
        val detailed = repo.listDetailed()
        assertFalse(detailed.any { it.project == project }, "No session should be created while pending intent exists")
    }
}
