package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class WireSerializationTest {

    @Test
    fun testClientMsgSerialization() {
        val msg = ClientMsg.FsSubscribeTree(
            reqId = 100UL,
            project = "test-proj",
            worktreePath = "sub/tree",
            path = "src",
            watchOnly = true,
        )
        val json = ProtocolJson.encodeToString(ClientMsg.serializer(), msg)

        assertTrue(json.contains(""""kind":"fs:subscribe_tree""""))
        assertTrue(json.contains(""""req_id":100"""))
        assertTrue(json.contains(""""worktree_path":"sub/tree""""))
        assertTrue(json.contains(""""watchOnly":true"""))
    }

    @Test
    fun testServerMsgTerminalOutputUnsignedBounds() {
        // Test offset and incarnation exceeding signed Long.MAX_VALUE (e.g. 18446744073709551615UL)
        val maxULongStr = ULong.MAX_VALUE.toString()
        val json = """
            {
                "kind": "terminal:output",
                "id": "term-1",
                "data": "hello world",
                "offset": $maxULongStr,
                "incarnation": 42
            }
        """.trimIndent()

        val parsed = ProtocolJson.decodeFromString(ServerMsgSerializer, json)
        assertIs<ServerMsg.TermOutput>(parsed)
        assertEquals("term-1", parsed.id)
        assertEquals("hello world", parsed.data)
        assertEquals(ULong.MAX_VALUE, parsed.offset)
        assertEquals(42UL, parsed.incarnation)
    }

    @Test
    fun testServerMsgTerminalExitFieldRenames() {
        val json = """
            {
                "kind": "terminal:exit",
                "id": "term-1",
                "exitCode": 0,
                "willRestart": true,
                "restartIn": 1500,
                "restartCount": 2,
                "incarnation": 5
            }
        """.trimIndent()

        val parsed = ProtocolJson.decodeFromString(ServerMsgSerializer, json)
        assertIs<ServerMsg.TermExit>(parsed)
        assertEquals(0, parsed.exitCode)
        assertTrue(parsed.willRestart)
        assertEquals(1500UL, parsed.restartIn)
        assertEquals(2u, parsed.restartCount)
        assertEquals(5UL, parsed.incarnation)
    }

    @Test
    fun testUiConnectionReceiptRedaction() {
        val json = """
            {
                "kind": "host:uiConnection",
                "version": 2,
                "connectionId": "conn-xyz",
                "decisionCapability": "secret-signing-key-12345"
            }
        """.trimIndent()

        val parsed = ProtocolJson.decodeFromString(ServerMsgSerializer, json)
        assertIs<ServerMsg.UiConnection>(parsed)
        assertEquals(2, parsed.version)
        assertEquals("conn-xyz", parsed.connectionId)
        assertEquals("secret-signing-key-12345", parsed.decisionCapability)

        // Sensitive capability must NEVER appear in toString()
        val str = parsed.toString()
        assertTrue(str.contains("[REDACTED]"))
        assertFalse(str.contains("secret-signing-key-12345"))
    }

    @Test
    fun testResilientUnknownServerMsgHandling() {
        val futureJson = """
            {
                "kind": "future:unannounced_push_event",
                "foo": "bar",
                "count": 123
            }
        """.trimIndent()

        // Must not throw SerializationException
        val parsed = ProtocolJson.decodeFromString(ServerMsgSerializer, futureJson)
        assertIs<ServerMsg.Unknown>(parsed)
        assertEquals("future:unannounced_push_event", parsed.kind)
    }

    @Test
    fun testProjectTargetRefStrippingProfileIdOnWire() {
        val target = ProjectTargetRef(
            profileId = "profile-sensitive-99",
            project = "my-backend",
            worktreePath = "/nested/worktree/",
        )
        val payload = target.toServerPayload()

        assertEquals("my-backend", payload.project)
        assertEquals("/nested/worktree", payload.worktreePath)

        val json = ProtocolJson.encodeToString(payload)
        assertFalse(json.contains("profile-sensitive-99"))
        assertFalse(json.contains("profileId"))
    }

    @Test
    fun testConnectionRefKeyFormat() {
        val ref = ConnectionRef("dev-profile", 7L)
        assertEquals("""["dev-profile",7]""", ref.key)

        val parsed = ConnectionRef.parseKey(ref.key)
        assertNotNull(parsed)
        assertEquals("dev-profile", parsed.profileId)
        assertEquals(7L, parsed.generation)
    }
}
