# Completion Report: retain-canonical-documents (P06 / W06) [Approved with Noted Issues]

## Status: APPROVED_WITH_NOTED_ISSUES
- **Implementation Status**: Canonical document registry, alias management, dirty buffer retention, and unit tests complete.
- **Review Status**: Reviewed across 3 interactive review cycles (final score: 6/10). Admitted under explicit user approval with noted issues.
- **Qualification Prerequisites**: Multi-workspace retained-owner lifecycle across full application navigation remains future P07/P08 qualification scope.

## Implemented Behaviors
1. **Canonical Document Key Resolution**:
   - `resolveCanonicalKey` prioritizes server `FileIdentityDto` (profileId, endpoint, accountUser, workspaceId, workspaceEpoch, verbatim canonicalPath without lowercasing or slash stripping).
2. **Single Native Buffer & Undo Chain Across Aliases**:
   - Workspace/project/worktree aliases of the same logical file share the exact same `EditorDocument` and undo chain.
   - `EditorSession.close` and `EditorTabsState.close` release only their own lease/view; surviving aliases keep the document alive.
   - Closing the final dirty alias triggers `CloseIntent` (save/discard/cancel guard).
3. **Atomic Tier Replacement & Save Synchronization**:
   - Clean documents undergoing tier replacement notify replacement listeners and update all aliases atomically across states.
   - In-flight save and dirty states protect documents from mid-air tier replacement.
   - CAS baseline mtime propagates across aliases upon save completion.
4. **Late Old-View Detach Protection**:
   - `AndroidEditorDocument` and `AndroidEditorSurface` enforce single active view and exact widget+token binding. Late detach of a superseded widget does not damage successor receipt or view state.

## Verification Evidence
- **Shared JVM Compilation**: `compileKotlinJvm` exit 0 (SUCCESS).
- **Android Debug Compilation**: `compileDebugKotlin` exit 0 (SUCCESS).
- **Focused Regression Tests**: 82/82 passed:
  - `ProjectWorkspaceStateTest`: 12/12 passed.
  - `EditorTabsStateTest`: 21/21 passed.
  - `EditorSaveRaceTest`: 9/9 passed.
  - `EditorSessionTest`: 8/8 passed.
  - `EditorRepositoryTest`: 10/10 passed.
  - `FileEditorMutationTest`: 12/12 passed.
  - `FileWatchCoordinatorTest`: 10/10 passed.

## Known Residual Issues (Noted for downstream P07/P08)
1. Complete integration of `FileIdentity` baseline validation on direct `saveDocument` path remains aligned with root ViewModel scope (P07).
2. Native widget input suppression on detached views to be verified on device in P08.
