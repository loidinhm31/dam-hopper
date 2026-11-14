package dev.damhopper.nativeapp.features.git

import kotlin.test.*

class GitWorkspaceNavigationTest {

    @Test
    fun testSectionSelectionAndPersistence() {
        val state = GitWorkspaceState()
        assertEquals(GitPanelSection.CHANGES, state.section.value)

        state.selectSection(GitPanelSection.HISTORY)
        assertEquals(GitPanelSection.HISTORY, state.section.value)

        state.selectSection(GitPanelSection.BRANCHES_WORKTREES)
        assertEquals(GitPanelSection.BRANCHES_WORKTREES, state.section.value)
    }

    @Test
    fun testRouteNavigationAndBackStackOrder() {
        val state = GitWorkspaceState()
        assertEquals(GitRoute.Overview, state.route.value)

        // Navigate to details
        state.navigate(GitRoute.Details("commit-123"))
        assertEquals(GitRoute.Details("commit-123"), state.route.value)

        // Open modal above route
        state.updateModal(GitModalState(showCreateBranchDialog = true))
        assertNotNull(state.modal.value.showCreateBranchDialog)

        // First back press closes modal, route remains Details
        val firstBack = state.back()
        assertTrue(firstBack)
        assertEquals(GitModalState(), state.modal.value)
        assertEquals(GitRoute.Details("commit-123"), state.route.value)

        // Second back press pops route back to Overview
        val secondBack = state.back()
        assertTrue(secondBack)
        assertEquals(GitRoute.Overview, state.route.value)

        // Third back press returns false (allows departure guard / workspace leave)
        val thirdBack = state.back()
        assertFalse(thirdBack)
    }

    @Test
    fun testDiffRouteNavigation() {
        val state = GitWorkspaceState()
        state.navigate(GitRoute.Diff("src/main.kt", "head-oid"))
        assertEquals(GitRoute.Diff("src/main.kt", "head-oid"), state.route.value)

        assertTrue(state.back())
        assertEquals(GitRoute.Overview, state.route.value)
    }

    @Test
    fun testInvalidateAuthoritySpendsModalAndPreservesNavigation() {
        val state = GitWorkspaceState()
        state.selectSection(GitPanelSection.HISTORY)
        state.navigate(GitRoute.Details("c-456"))
        state.updateModal(GitModalState(showAddWorktreeDialog = true))

        state.invalidateAuthority()
        assertFalse(state.isAuthorityValid.value)
        assertEquals(GitModalState(), state.modal.value)
        assertEquals(GitPanelSection.HISTORY, state.section.value)
        assertEquals(GitRoute.Details("c-456"), state.route.value)

        state.revalidateAuthority()
        assertTrue(state.isAuthorityValid.value)
    }

    @Test
    fun testNestedRouteBackStackDiffToDetailsToOverview() {
        val state = GitWorkspaceState()
        assertEquals(GitRoute.Overview, state.route.value)

        // Navigate from Overview -> Details -> Diff
        state.navigate(GitRoute.Details("commit-abc"))
        assertEquals(GitRoute.Details("commit-abc"), state.route.value)

        state.navigate(GitRoute.Diff("src/App.kt", "commit-abc"))
        assertEquals(GitRoute.Diff("src/App.kt", "commit-abc"), state.route.value)

        // Open modal on top of nested diff
        state.updateModal(GitModalState(showLeasedPushDialog = true))
        assertTrue(state.modal.value.showLeasedPushDialog)

        // 1st back: closes modal, preserves nested Diff route
        assertTrue(state.back())
        assertEquals(GitModalState(), state.modal.value)
        assertEquals(GitRoute.Diff("src/App.kt", "commit-abc"), state.route.value)

        // 2nd back: pops Diff back to Details
        assertTrue(state.back())
        assertEquals(GitRoute.Details("commit-abc"), state.route.value)

        // 3rd back: pops Details back to Overview
        assertTrue(state.back())
        assertEquals(GitRoute.Overview, state.route.value)

        // 4th back: returns false, allowing workspace departure
        assertFalse(state.back())
    }

    @Test
    fun testNavigateOverviewClearsNestedBackStack() {
        val state = GitWorkspaceState()
        state.navigate(GitRoute.Details("c1"))
        state.navigate(GitRoute.Diff("f1", "c1"))

        // Explicit navigate to Overview clears back stack
        state.navigate(GitRoute.Overview)
        assertEquals(GitRoute.Overview, state.route.value)

        assertFalse(state.back())
    }
}
