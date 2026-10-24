package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.normalizeProjectTargetPath
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProjectTargetStoreTest {

    @Test
    fun testWorkspaceRevisionFencing() {
        val store = ProjectTargetStore()
        assertEquals(0L, store.getWorkspaceRevision("prof-1"))

        store.invalidateWorkspace("prof-1", "/home/user/workspace-a/dam-hopper.toml")
        assertEquals(1L, store.getWorkspaceRevision("prof-1"))
        assertEquals("/home/user/workspace-a/dam-hopper.toml", store.getActiveWorkspaceConfigPath("prof-1"))

        store.invalidateWorkspace("prof-1", "/home/user/workspace-b/dam-hopper.toml")
        assertEquals(2L, store.getWorkspaceRevision("prof-1"))
        assertEquals("/home/user/workspace-b/dam-hopper.toml", store.getActiveWorkspaceConfigPath("prof-1"))

        // Other profiles remain isolated
        assertEquals(0L, store.getWorkspaceRevision("prof-2"))
    }

    @Test
    fun testSameProjectNameAcrossDifferentWorkspacesAndProfiles() {
        val store = ProjectTargetStore()
        val profA = "profile-alpha"
        val profB = "profile-beta"
        val ws1 = "/path/to/ws1/dam-hopper.toml"
        val ws2 = "/path/to/ws2/dam-hopper.toml"
        val projectName = "dam-hopper"

        store.selectTarget(profA, ws1, projectName, "worktree-1")
        store.selectTarget(profA, ws2, projectName, "worktree-2")
        store.selectTarget(profB, ws1, projectName, null)

        val snapA1 = store.getSnapshot(profA, ws1, projectName)
        val snapA2 = store.getSnapshot(profA, ws2, projectName)
        val snapB1 = store.getSnapshot(profB, ws1, projectName)

        assertEquals("worktree-1", snapA1.target.worktreePath)
        assertEquals("worktree-2", snapA2.target.worktreePath)
        assertNull(snapB1.target.worktreePath)
        assertTrue(snapB1.isRoot)
        assertNotEquals(snapA1.targetKey, snapA2.targetKey)
        assertNotEquals(snapA1.targetKey, snapB1.targetKey)
    }

    @Test
    fun testStructuredTargetKeyCollisionSafetyWithSpecialCharacters() {
        val key1 = ProjectTargetSnapshot.buildStructuredTargetKey(
            profileId = "prof\"1",
            workspaceConfigPath = "path\\with\\backslashes",
            project = "proj,with,commas",
            worktreePath = "wt\"quote"
        )
        val key2 = ProjectTargetSnapshot.buildStructuredTargetKey(
            profileId = "prof\"1",
            workspaceConfigPath = "path\\with\\backslashes",
            project = "proj,with,commas",
            worktreePath = "wt'single"
        )
        assertNotEquals(key1, key2)
        assertTrue(key1.contains("wt\\\"quote"))
    }

    @Test
    fun testRootTargetSelectionAndReset() {
        val store = ProjectTargetStore()
        val snapInitial = store.getSnapshot("p1", "/ws", "frontend")
        assertTrue(snapInitial.isRoot)
        assertEquals("Project root", snapInitial.label)
        assertTrue(snapInitial.isAvailable)

        store.selectTarget("p1", "/ws", "frontend", "feature-x")
        val snapWt = store.getSnapshot("p1", "/ws", "frontend")
        assertFalse(snapWt.isRoot)
        assertEquals("feature-x", snapWt.target.worktreePath)

        store.resetTargetToRoot("p1", "/ws", "frontend")
        val snapReset = store.getSnapshot("p1", "/ws", "frontend")
        assertTrue(snapReset.isRoot)
        assertNull(snapReset.target.worktreePath)
    }

    @Test
    fun testUnavailableTargetDoesNotSilentlyRedirectToRoot() {
        val store = ProjectTargetStore()
        val prof = "p1"
        val ws = "/ws"
        val proj = "backend"
        val wtPath = "missing-worktree"

        store.selectTarget(prof, ws, proj, wtPath)
        store.markTargetUnavailable(prof, ws, proj, wtPath)

        val snap = store.getSnapshot(prof, ws, proj)
        // INVARIANT: Must NOT silently fall back to isRoot=true!
        assertFalse(snap.isRoot, "Unavailable target must not silently redirect to root")
        assertFalse(snap.isAvailable, "Target must be marked unavailable")
        assertEquals(wtPath, snap.target.worktreePath)
        assertEquals("Target unavailable", snap.statusLabel)
    }

    @Test
    fun testWorktreeReconciliationOnDiscovery() {
        val store = ProjectTargetStore()
        val prof = "p1"
        val ws = "/ws"
        val proj = "api"
        val wtGood = ProjectWorktree(
            path = "good-wt",
            repositoryPath = "/repo",
            branch = "feature-good",
            commitHash = "abc1234",
            isAvailable = true,
            isPrunable = false
        )
        val wtPrunable = ProjectWorktree(
            path = "prunable-wt",
            repositoryPath = "/repo",
            branch = "feature-prunable",
            commitHash = "def5678",
            isAvailable = true,
            isPrunable = true // Prunable worktree is not selectable!
        )

        store.selectTarget(prof, ws, proj, "good-wt")
        store.setKnownWorktrees(prof, ws, proj, listOf(wtGood, wtPrunable))

        val snapGood = store.getSnapshot(prof, ws, proj)
        assertTrue(snapGood.isAvailable)
        assertEquals("feature-good", snapGood.label)

        // Select prunable worktree
        store.selectTarget(prof, ws, proj, "prunable-wt")
        store.setKnownWorktrees(prof, ws, proj, listOf(wtGood, wtPrunable))

        val snapPrunable = store.getSnapshot(prof, ws, proj)
        assertFalse(snapPrunable.isAvailable)
        assertEquals("Prunable — unavailable", snapPrunable.statusLabel)
    }
}
