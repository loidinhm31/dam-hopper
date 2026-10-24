package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FileOperationArbiterTest {

    private val ownerA = WorkspaceFileOwner(
        profileId = "prof-a",
        baseUrl = "http://127.0.0.1:4803",
        accountUser = "alice",
        project = "proj-x",
    )

    private val ownerB = WorkspaceFileOwner(
        profileId = "prof-b",
        baseUrl = "http://127.0.0.1:4803",
        accountUser = "bob",
        project = "proj-x",
    )

    @Test
    fun testSegmentAwarePathConflictDetection() {
        // 'a' and 'ab' do not conflict (distinct segments)
        assertFalse(FileOperationArbiter.pathsConflict("a", "ab"))
        assertFalse(FileOperationArbiter.pathsConflict("src/file.txt", "src/file.txt.bak"))

        // 'a' and 'a/b' DO conflict (ancestor-descendant)
        assertTrue(FileOperationArbiter.pathsConflict("a", "a/b"))
        assertTrue(FileOperationArbiter.pathsConflict("a/b", "a"))
        assertTrue(FileOperationArbiter.pathsConflict("src", "src/models/user.kt"))

        // Exact match conflicts
        assertTrue(FileOperationArbiter.pathsConflict("src/main.kt", "src/main.kt"))

        // Root ("" or ".") conflicts with all paths
        assertTrue(FileOperationArbiter.pathsConflict("", "src/main.kt"))
        assertTrue(FileOperationArbiter.pathsConflict(".", "src/main.kt"))
        assertTrue(FileOperationArbiter.pathsConflict("src/main.kt", ""))
    }

    @Test
    fun testOwnerIsolation() {
        val arbiter = FileOperationArbiter()

        // Reserve file under Owner A
        val tokenA = arbiter.tryReserveSave(ownerA, "src/main.kt")
        assertNotNull(tokenA)

        // Reserving the exact same path under Owner B succeeds (isolated by owner)
        val tokenB = arbiter.tryReserveSave(ownerB, "src/main.kt")
        assertNotNull(tokenB)

        arbiter.releaseToken(tokenA)
        arbiter.releaseToken(tokenB)
    }

    @Test
    fun testExactSaveConflictAndRelease() {
        val arbiter = FileOperationArbiter()

        val token1 = arbiter.tryReserveSave(ownerA, "src/main.kt")
        assertNotNull(token1)
        assertTrue(arbiter.isPathReserved(ownerA, "src/main.kt"))
        val token2 = arbiter.tryReserveSave(ownerA, "src/main.kt")
        assertNull(token2)

        // Attempting to reserve ancestor subtree conflicts
        val tokenAncestor = arbiter.tryReserveMutation(ownerA, "src")
        assertNull(tokenAncestor)

        // Releasing token1 frees the reservation
        arbiter.releaseToken(token1)
        assertFalse(arbiter.isPathReserved(ownerA, "src/main.kt"))

        val token3 = arbiter.tryReserveSave(ownerA, "src/main.kt")
        assertNotNull(token3)
        arbiter.releaseToken(token3)
    }

    @Test
    fun testAtomicMutationReservation() {
        val arbiter = FileOperationArbiter()

        // Existing save on destPath
        val saveToken = arbiter.tryReserveSave(ownerA, "dest/target.kt")
        assertNotNull(saveToken)

        // Attempting to rename src to dest/target.kt fails atomically (neither src nor dest is acquired)
        val mutationToken = arbiter.tryReserveMutation(ownerA, "src/origin.kt", "dest/target.kt")
        assertNull(mutationToken)
        assertFalse(arbiter.isPathReserved(ownerA, "src/origin.kt"))

        // After freeing conflicting destination, atomic reservation succeeds
        arbiter.releaseToken(saveToken)
        val successfulMutation = arbiter.tryReserveMutation(ownerA, "src/origin.kt", "dest/target.kt")
        assertNotNull(successfulMutation)
        assertTrue(arbiter.isPathReserved(ownerA, "src/origin.kt"))
        assertTrue(arbiter.isPathReserved(ownerA, "dest/target.kt"))

        arbiter.releaseToken(successfulMutation)
    }

    @Test
    fun testChildSaveCapability() {
        val arbiter = FileOperationArbiter()

        // Reserve entire 'src' directory for a directory move or refactor
        val parentToken = arbiter.tryReserveMutation(ownerA, "src", "src_backup")
        assertNotNull(parentToken)

        // Ordinary save on 'src/main.kt' would conflict with parent
        assertNull(arbiter.tryReserveSave(ownerA, "src/main.kt"))

        // Child save derived from parentToken succeeds without self-deadlock
        val childToken = arbiter.createChildSaveToken(parentToken, "src/main.kt")
        assertNotNull(childToken)
        assertEquals(parentToken.id, childToken.parentTokenId)
        assertEquals(ReservationKind.CHILD_SAVE, childToken.kind)

        // Creating child save outside parent enclosure fails
        assertFailsWith<IllegalArgumentException> {
            arbiter.createChildSaveToken(parentToken, "other/file.kt")
        }

        arbiter.releaseToken(childToken)
        arbiter.releaseToken(parentToken)
    }

    @Test
    fun testChildSaveExclusionAndDirectionalContainment() {
        val arbiter = FileOperationArbiter()

        // Parent reserving exact file cannot spawn child saves
        val exactToken = arbiter.tryReserveSave(ownerA, "src/main.kt")!!
        assertFailsWith<IllegalArgumentException> {
            arbiter.createChildSaveToken(exactToken, "src/main.kt")
        }
        arbiter.releaseToken(exactToken)

        // Mutation parent on 'src'
        val parent = arbiter.tryReserveMutation(ownerA, "src")!!

        // First child save on 'src/main.kt' succeeds
        val child1 = arbiter.createChildSaveToken(parent, "src/main.kt")
        assertNotNull(child1)

        // Second child save on SAME file 'src/main.kt' fails due to conflict
        assertFailsWith<IllegalStateException> {
            arbiter.createChildSaveToken(parent, "src/main.kt")
        }

        // Releasing first child allows another child save on 'src/main.kt'
        arbiter.releaseToken(child1)
        val child2 = arbiter.createChildSaveToken(parent, "src/main.kt")
        assertNotNull(child2)
        arbiter.releaseToken(child2)
        arbiter.releaseToken(parent)
    }

    @Test
    fun testQuarantinePreservation() {
        val arbiter = FileOperationArbiter()

        val token = arbiter.tryReserveSave(ownerA, "important.kt")
        assertNotNull(token)

        val quarantinedOp = QuarantinedOperation(
            owner = ownerA,
            path = "important.kt",
            stage = OperationStage.COMMIT_DISPATCHED,
            opId = "write-99",
            submittedRevision = null,
            baselineRevision = 1234L,
            submittedBytes = "hello".encodeToByteArray(),
            timestampMillis = 1000L,
        )

        arbiter.quarantineToken(token, quarantinedOp)
        assertEquals(ReservationState.QUARANTINED, token.state)

        // Ordinary release MUST fail for quarantined tokens
        assertFailsWith<IllegalStateException> {
            arbiter.releaseToken(token)
        }

        // Path remains reserved while in quarantine
        assertTrue(arbiter.isPathReserved(ownerA, "important.kt"))
        assertEquals(1, arbiter.getQuarantinedOperations(ownerA).size)

        // Explicit abandonment releases the quarantine
        arbiter.abandonQuarantine(token, "User abandoned after server check")
        assertFalse(arbiter.isPathReserved(ownerA, "important.kt"))
        assertEquals(0, arbiter.getQuarantinedOperations(ownerA).size)
    }

    @Test
    fun testForeignArbiterTokenRejected() {
        val arbiter1 = FileOperationArbiter()
        val arbiter2 = FileOperationArbiter()

        val token1 = arbiter1.tryReserveSave(ownerA, "file.kt")
        assertNotNull(token1)

        // Using token from arbiter1 in arbiter2 MUST throw IllegalArgumentException
        assertFailsWith<IllegalArgumentException> {
            arbiter2.releaseToken(token1)
        }
        assertFailsWith<IllegalArgumentException> {
            arbiter2.createChildSaveToken(token1, "file.kt")
        }
        assertFailsWith<IllegalArgumentException> {
            arbiter2.quarantineToken(
                token1,
                QuarantinedOperation(
                    owner = ownerA,
                    path = "file.kt",
                    stage = OperationStage.COMMIT_DISPATCHED,
                    timestampMillis = 100L,
                ),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            arbiter2.abandonQuarantine(token1, "abandon")
        }

        arbiter1.releaseToken(token1)
    }

    @Test
    fun testParentCannotReleaseWhileChildQuarantined() {
        val arbiter = FileOperationArbiter()
        val parent = arbiter.tryReserveMutation(ownerA, "src")
        assertNotNull(parent)

        val child = arbiter.createChildSaveToken(parent, "src/main.kt")
        assertNotNull(child)

        // Quarantine the child token
        val quarantinedChild = QuarantinedOperation(
            owner = ownerA,
            path = "src/main.kt",
            stage = OperationStage.COMMIT_DISPATCHED,
            opId = "save-1",
            timestampMillis = 500L,
        )
        arbiter.quarantineToken(child, quarantinedChild)

        // Parent release MUST fail because child save is unresolved/quarantined
        assertFailsWith<IllegalStateException> {
            arbiter.releaseToken(parent)
        }

        // Once child quarantine is abandoned or reconciled, parent can be released
        arbiter.abandonQuarantine(child, "Reconciled child save")
        arbiter.releaseToken(parent)
        assertFalse(arbiter.isPathReserved(ownerA, "src"))
        assertFalse(arbiter.isPathReserved(ownerA, "src/main.kt"))
    }

    @Test
    fun testParentReleaseCleansUpActiveChildren() {
        val arbiter = FileOperationArbiter()
        val parent = arbiter.tryReserveMutation(ownerA, "src")
        assertNotNull(parent)

        val child = arbiter.createChildSaveToken(parent, "src/main.kt")
        assertNotNull(child)
        assertEquals(ReservationState.ACTIVE, child.state)

        // Releasing parent releases active child
        arbiter.releaseToken(parent)
        assertEquals(ReservationState.RELEASED, parent.state)
        assertEquals(ReservationState.RELEASED, child.state)
        assertFalse(arbiter.isPathReserved(ownerA, "src"))
        assertFalse(arbiter.isPathReserved(ownerA, "src/main.kt"))
    }
}
