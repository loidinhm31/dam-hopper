package dev.damhopper.nativeapp.core.ownership

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConnectionRegistryTest {

    @Test
    fun testIndependentProfileGenerations() = runTest {
        val registry = ConnectionRegistry()

        val connA = registry.getOrCreateConnection("profile-a")
        val connB = registry.getOrCreateConnection("profile-b")

        assertEquals("profile-a", connA.profileId)
        assertEquals(1L, connA.generation)
        assertEquals("profile-b", connB.profileId)
        assertEquals(1L, connB.generation)

        assertTrue(registry.isCurrentOwner(connA))
        assertTrue(registry.isCurrentOwner(connB))

        // Retiring profile A must NOT affect profile B
        val retiredA = registry.retireConnection(connA)
        assertEquals("profile-a", retiredA.profileId)
        assertEquals(2L, retiredA.generation)

        assertFalse(registry.isCurrentOwner(connA)) // Old generation 1 is now stale
        assertTrue(registry.isCurrentOwner(retiredA)) // New generation 2 is active
        assertTrue(registry.isCurrentOwner(connB)) // Profile B is untouched at gen 1
    }

    @Test
    fun testStaleOwnerAssertionThrows() = runTest {
        val registry = ConnectionRegistry()
        val initial = registry.getOrCreateConnection("server-1")

        // First assertion passes
        registry.assertCurrentOwner(initial, "initial-op")

        // Retire connection
        val updated = registry.retireConnection(initial)
        assertEquals(2L, updated.generation)

        // Attempting operation with stale initial connection MUST throw ConnectionOwnerError.STALE
        val err = assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(initial, "stale-op")
        }
        assertEquals(ConnectionErrorReason.STALE, err.reason)
        assertTrue(err.message?.contains("stale") == true)

        // Operation with updated connection passes
        registry.assertCurrentOwner(updated, "new-op")
    }

    @Test
    fun testRetirementListenerNotification() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection("prod-server")

        var notifiedRef: ConnectionRef? = null
        val listener: (ConnectionRef) -> Unit = { ref -> notifiedRef = ref }
        registry.addRetirementListener(listener)

        val newConn = registry.retireConnection(conn)
        assertEquals(conn, notifiedRef)

        // Removing listener
        registry.removeRetirementListener(listener)
        notifiedRef = null
        registry.retireConnection(newConn)
        assertEquals(null, notifiedRef)
    }

    @Test
    fun testRemoveProfileCleansUpState() = runTest {
        val registry = ConnectionRegistry()
        val conn = registry.getOrCreateConnection("temp-server")

        assertTrue(registry.isCurrentOwner(conn))
        val removed = registry.removeProfile("temp-server")
        assertEquals(conn, removed)

        assertFalse(registry.isCurrentOwner(conn))
        assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(conn, "post-remove")
        }
    }

    @Test
    fun testAbaGenerationPreventionOnRecreation() = runTest {
        val registry = ConnectionRegistry()
        val conn1 = registry.getOrCreateConnection("recreated-profile")
        assertEquals(1L, conn1.generation)

        val conn2 = registry.retireConnection(conn1)
        assertEquals(2L, conn2.generation)

        // Profile is removed (e.g. logged out)
        registry.removeProfile("recreated-profile")

        // Profile is re-added; its new generation MUST be monotonic (3L, NOT resetting to 1L or 2L)
        val conn3 = registry.getOrCreateConnection("recreated-profile")
        assertEquals(3L, conn3.generation)
        assertTrue(conn3.generation > conn2.generation)

        // Old callbacks with conn1 or conn2 are rejected
        assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(conn1, "old-stale-callback")
        }
        assertFailsWith<ConnectionOwnerError> {
            registry.assertCurrentOwner(conn2, "old-stale-callback")
        }
        registry.assertCurrentOwner(conn3, "valid-active-callback")
    }
}
