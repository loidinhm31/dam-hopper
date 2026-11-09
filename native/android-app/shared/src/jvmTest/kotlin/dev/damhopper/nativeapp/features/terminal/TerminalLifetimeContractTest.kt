package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TerminalLifetimeContractTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Test
    fun testTerminateSessionRequestSerializationAndWireLimit() {
        val req = TerminateSessionRequest(
            version = 1,
            expectedServerEpoch = "e4d2a1b0-1234-5678-9abc-def012345678",
            expectedIncarnation = "18446744073709551615", // ULong.MAX_VALUE
        )
        val encoded = json.encodeToString(req)
        assertTrue(encoded.encodeToByteArray().size <= 512, "Wire payload must be <= 512 bytes")
        assertTrue(encoded.contains("\"version\":1"))
        assertTrue(encoded.contains("\"expectedServerEpoch\":\"e4d2a1b0-1234-5678-9abc-def012345678\""))
        assertTrue(encoded.contains("\"expectedIncarnation\":\"18446744073709551615\""))

        val decoded = json.decodeFromString<TerminateSessionRequest>(encoded)
        assertEquals(req.version, decoded.version)
        assertEquals(req.expectedServerEpoch, decoded.expectedServerEpoch)
        assertEquals(req.expectedIncarnation, decoded.expectedIncarnation)
    }

    @Test
    fun testTerminalSessionMetaIncarnationExactAndTerminationState() {
        val raw = """
            {
                "id": "term-pty-42",
                "incarnation": 9007199254740991,
                "command": "cargo test",
                "cwd": "/repo",
                "incarnationExact": "18446744073709551615",
                "terminationState": "terminationRequested",
                "alive": true
            }
        """.trimIndent()

        val detailed = json.decodeFromString<TerminalSessionDetailed>(raw)
        assertEquals("term-pty-42", detailed.id)
        assertEquals("18446744073709551615", detailed.incarnationExact)
        assertEquals("terminationRequested", detailed.terminationState)

        val meta = detailed.toMeta()
        assertEquals("term-pty-42", meta.id)
        assertEquals("18446744073709551615", meta.incarnationExact)
        assertEquals("terminationRequested", meta.terminationState)
    }

    @Test
    fun testUncertainCreateRecordSerializationAndSafety() {
        val record = UncertainCreateRecord(
            intentId = "uuid-intent-999",
            profileId = "profile-local",
            terminalId = "term-42",
            project = "dam-hopper",
            worktreePath = null,
            createdAtEpochMs = 1710000000000L,
            status = UncertainCreateStatus.PENDING,
        )

        val encoded = json.encodeToString(record)
        // Assert no secret or command text is present in the schema
        assertFalse(encoded.contains("password"))
        assertFalse(encoded.contains("token"))
        assertFalse(encoded.contains("command"))
        assertFalse(encoded.contains("buffer"))

        val decoded = json.decodeFromString<UncertainCreateRecord>(encoded)
        assertEquals("uuid-intent-999", decoded.intentId)
        assertEquals("profile-local", decoded.profileId)
        assertEquals(UncertainCreateStatus.PENDING, decoded.status)

        val confirmed = decoded.copy(status = UncertainCreateStatus.CONFIRMED)
        assertEquals(UncertainCreateStatus.CONFIRMED, confirmed.status)
    }

    @Test
    fun testTerminalTerminationOutcomeSemantics() {
        // 202 terminationRequested != observed exit
        val requestedOutcome = TerminalTerminationOutcome(
            id = "t1",
            requested = true,
            restartCancelled = false,
            statusCode = 202,
        )
        assertTrue(requestedOutcome.requested)
        assertFalse(requestedOutcome.restartCancelled)
        assertEquals(202, requestedOutcome.statusCode)

        // 200 restartCancelled != observed process exit
        val cancelledOutcome = TerminalTerminationOutcome(
            id = "t1",
            requested = false,
            restartCancelled = true,
            statusCode = 200,
        )
        assertFalse(cancelledOutcome.requested)
        assertTrue(cancelledOutcome.restartCancelled)
        assertEquals(200, cancelledOutcome.statusCode)
    }

    @Test
    fun testTerminalCreateOutcomeDecoding() {
        val outcome = TerminalCreateOutcome(
            id = "term-101",
            incarnation = 18446744073709551615uL,
            ptyEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456",
            alive = true,
        )
        val encoded = json.encodeToString(outcome)
        val decoded = json.decodeFromString<TerminalCreateOutcome>(encoded)
        assertEquals("term-101", decoded.id)
        assertEquals(18446744073709551615uL, decoded.incarnation)
        assertEquals("3f8c7b6a-9123-4567-890a-bcdef0123456", decoded.ptyEpoch)
        assertTrue(decoded.alive)
    }

    @Test
    fun testPreferencesStoreUncertainCreatePersistence() {
        val store = InMemoryPreferencesStore()
        assertEquals(emptyList(), store.loadUncertainCreateRecords())

        val record1 = UncertainCreateRecord(
            intentId = "intent-1",
            profileId = "p1",
            terminalId = "term-1",
            createdAtEpochMs = 1710000000L,
        )
        val record2 = UncertainCreateRecord(
            intentId = "intent-2",
            profileId = "p1",
            terminalId = "term-2",
            createdAtEpochMs = 1710000100L,
        )
        store.saveUncertainCreateRecord(record1)
        store.saveUncertainCreateRecord(record2)
        assertEquals(2, store.loadUncertainCreateRecords().size)

        // Updating record1
        store.saveUncertainCreateRecord(record1.copy(status = UncertainCreateStatus.CONFIRMED))
        val loaded = store.loadUncertainCreateRecords()
        assertEquals(2, loaded.size)
        assertEquals(UncertainCreateStatus.CONFIRMED, loaded.find { it.intentId == "intent-1" }?.status)

        // Remove record1
        store.removeUncertainCreateRecord("intent-1")
        val afterRemove = store.loadUncertainCreateRecords()
        assertEquals(1, afterRemove.size)
        assertEquals("intent-2", afterRemove.first().intentId)
    }

    @Test
    fun testTerminateSessionRequestEpochValidation() {
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "", expectedIncarnation = "1")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "not-a-valid-uuid", expectedIncarnation = "1")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456", expectedIncarnation = "")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456", expectedIncarnation = "0")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456", expectedIncarnation = "-1")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 2, expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456", expectedIncarnation = "1")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "3F8C7B6A-9123-4567-890A-BCDEF0123456", expectedIncarnation = "1")
        }
        assertFailsWith<IllegalArgumentException> {
            TerminateSessionRequest(version = 1, expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456", expectedIncarnation = "18446744073709551616") // > ULong.MAX_VALUE
        }

        // Valid request
        val valid = TerminateSessionRequest(
            version = 1,
            expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456",
            expectedIncarnation = "18446744073709551615",
        )
        assertEquals(1, valid.version)
    }
}
