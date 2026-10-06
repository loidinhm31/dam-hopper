# Code Review: Phase 06 Editor Host Integration and Edge States

**Date**: 2026-10-06  
**Reviewer**: Senior Software Engineer (ReviewerPhase06)  
**Phase**: `phase-06-editor-host-integration-and-edge-states`  
**Score**: 9.1/10  

---

## Code Review Summary

### Scope
- **Files reviewed**: 10 files (6 modified, 4 newly created tests)
  - `packages/ui/src/hooks/use-editor-git-blame.ts` (modified)
  - `packages/ui/src/components/organisms/MonacoHost.tsx` (modified)
  - `packages/ui/src/components/organisms/MarkdownHost.tsx` (modified)
  - `packages/ui/src/components/organisms/HtmlHost.tsx` (modified)
  - `packages/ui/src/components/organisms/EditorTabs.tsx` (modified)
  - `packages/ui/src/components/pages/WorkspacePage.tsx` (modified)
  - `packages/ui/src/components/organisms/EditorTabsBlame.test.tsx` (new)
  - `packages/ui/src/components/organisms/MarkdownHostBlame.test.tsx` (new)
  - `packages/ui/src/components/organisms/HtmlHostBlame.test.tsx` (new)
  - `packages/ui/src/components/pages/WorkspacePageBlameReveal.test.tsx` (new)
- **Lines of code analyzed**: ~1,280 LOC
- **Review focus**: End-to-end Explorer→EditorHost→blame annotation→Workspace Git reveal flow, clean-file eligibility, visibility and inactive host pause/resume, responsive container geometry, Android read-only policy isolation, security, and React hook stability.
- **Updated plans**:
  - `plans/261005-2106-editor-git-blame-annotations/phase-06-editor-host-integration-and-edge-states.md`
  - `plans/261005-2106-editor-git-blame-annotations/progress.md`

---

## Overall Assessment

Phase 06 delivers robust end-to-end wiring across editor hosts (`MonacoHost`, `MarkdownHost`, `HtmlHost`, `EditorTabs`, `WorkspacePage`). Key strengths:
- **Clean-File Blame**: Clean unchanged text files without entries in `gitDiff` (`activeGitState == null`) successfully compute blame annotations and reveal commits via server-side root resolution.
- **Precise Inactivity Lifecycle**: `sourceActive` correctly halts background network calls, aborts active requests, and clears gutter views during Preview mode or inactive surfaces, while preserving the user's session toggle.
- **Responsive Layout**: Outer container wrapper measurements (<640px vs >=640px) ensure accurate compact/full annotation mode switches even inside narrow Markdown/HTML split panes on high-resolution viewports.
- **Owner-Bound Security**: `handleRevealCommit` validates connection status, profile generation, server URL bindings, and target availability prior to firing `onRevealGitCommit`.
- **Zero Test Regressions**: All 10 targeted test suites (68 tests) pass in 1.95s; full UI test suite passes (312 files, 2,422 tests) with 0 failures; TypeScript compilation has 0 errors.

Two warnings require action: an ESLint build blocker from `useCallback` manual memoization in `EditorTabs.tsx`, and a stale closure in `WorkspacePage.tsx` where `compactIdeSurfaces` omits `activeCompactSurface` and `handleRevealGitCommit` in `useMemo`.

---

## Critical Issues (MUST FIX)

*None.* No security vulnerabilities, data corruption, or runtime fatal crashes observed.

---

## High Priority Findings / Warnings (SHOULD FIX)

### 1. `EditorTabs.tsx`: React Compiler memoization failure breaks `pnpm lint`
- **Location**: `packages/ui/src/components/organisms/EditorTabs.tsx:262:5`, `295:6`
- **Issue**: ESLint rule `react-hooks/preserve-manual-memoization` emits compilation errors:
  ```
  262:5 error Compilation Skipped: Existing memoization could not be preserved
  295:6 error Compilation Skipped: Existing memoization could not be preserved
  ```
  `handleRevealCommit` wraps `useCallback` with dependency `activeTab`. `activeTab` is derived in the component from store state `projectTabs.find(...)`. The React 19 compiler flags that manual memoization cannot be safely preserved because `activeTab` changes frequently.
- **Impact**: Monorepo build gate `pnpm lint` fails with exit code 1. Blocks CI qualification.
- **Fix**: Either eliminate `useCallback` (similar to `openActiveDiff` at line 238, since `MonacoHost`, `MarkdownHost`, and `HtmlHost` are not wrapped in `React.memo`), or use a ref (`activeTabRef.current = activeTab`) and remove `activeTab` from dependencies:
  ```ts
  // Option A (KISS / matches openActiveDiff):
  const handleRevealCommit = (commitHash: string, rootId: string) => {
    if (!activeTab || !activeTab.targetAvailable || !activeTab.path) return;
    if (!commitHash || !rootId) return;
    if (!connectionSnapshot || connectionSnapshot.status !== "connected") return;
    if (
      activeTab.resourceBinding?.serverUrl &&
      connectionSnapshot.serverUrl !== activeTab.resourceBinding.serverUrl
    ) return;
    if (onRevealGitCommit) {
      const nonce = ++revealNonceRef.current;
      onRevealGitCommit({
        nonce,
        owner: {
          profileId: connectionSnapshot.owner.profileId,
          generation: connectionSnapshot.owner.generation,
        },
        target: activeTab.target,
        rootId,
        hash: commitHash,
      });
    }
    onRevealCommitProp?.(commitHash, rootId);
  };
  ```

### 2. `WorkspacePage.tsx`: Missing `useMemo` dependencies for `compactIdeSurfaces` cause stale `sourceActive`
- **Location**: `packages/ui/src/components/pages/WorkspacePage.tsx:2375-2422`
- **Issue**: In `compactIdeSurfaces`, `EditorTabs` is passed:
  ```tsx
  sourceActive={activeCompactSurface === "editor"}
  onRevealGitCommit={handleRevealGitCommit}
  ```
  However, `activeCompactSurface` and `handleRevealGitCommit` are omitted from the dependency array `[compactGitSurface, compactProjectSurface, handleFileOpen, ...]`.
- **Impact**: In compact/mobile viewports, when switching surfaces (e.g. from editor to git or terminal), `compactIdeSurfaces` is not recreated. `sourceActive` remains stale. Blame queries and debouncers continue running in the background when navigating away from the editor, or fail to activate when navigating into the editor.
- **Fix**: Add `activeCompactSurface` and `handleRevealGitCommit` to the dependency array of `compactIdeSurfaces` at line 2421.

---

## Medium Priority Improvements / Suggestions (NICE TO HAVE)

### 1. Document visibility restoration vs initial `runBlame` invocation
- **Location**: `packages/ui/src/hooks/use-editor-git-blame.ts:126-140`, `533-548`
- **Observation**: When `document.visibilityState` toggles from `hidden` to `visible`, `isDocumentVisible` becomes true, triggering effect 434 to immediately call `runBlame()`. The listener effect (line 533) that registers `visibilitychange` for `triggerRepositoryRefresh(true)` was previously torn down while hidden. Coalescing is handled by debounce, but if HEAD or roots were rewritten while the browser tab was backgrounded, `runBlame()` may execute before root invalidation completes.
- **Suggestion**: Ensure `triggerRepositoryRefresh(true)` is explicitly invoked whenever `isDocumentVisible` transitions from false to true.

### 2. Unused imports and test variables
- **Locations**:
  - `packages/ui/src/hooks/use-editor-git-blame.ts:2`: `QueryClient` unused.
  - `packages/ui/src/components/organisms/EditorTabsBlame.test.tsx:11`: `EditorStore` unused.
  - `packages/ui/src/components/pages/WorkspacePageBlameReveal.test.tsx:95,97`: `mockCompactSurfaces`, `mockOnSurfaceChange` assigned but unused.
- **Fix**: Clean up unused symbols to keep lint reports pristine.

---

## Low Priority Suggestions

- **Act warning mitigation**: Minor React 19 testing act warnings in `EditorTabsBlame.test.tsx` and `WorkspacePageBlameReveal.test.tsx` for microtask flushes can be suppressed by wrapping the promise resolution helpers in `act(...)`.

---

## Positive Observations

1. **Non-Intrusive Gutter**: Gutter right-click toggle works cleanly; existing git line indicator clicks retain primary-button-only diff action without collision.
2. **Deterministic Unmount/Remount**: Markdown and HTML Edit↔Split↔Preview mode toggles properly unmount and remount MonacoHost, correctly triggering `useEditorGitBlame` cleanup while preserving `tab.blameEnabled` session preference.
3. **Android Policy Adherence**: Android Chrome native input policy remains strictly enforced; blame views render without mutating editor read-only mode or triggering keyboard popups.
4. **Clean File Support**: Clean files without git modifications resolve blame via server root resolution seamlessly without requiring dirty entries.

---

## Recommended Actions

1. Fix `handleRevealCommit` in `EditorTabs.tsx` to resolve the `react-hooks/preserve-manual-memoization` ESLint compiler error.
2. Add `activeCompactSurface` and `handleRevealGitCommit` to `compactIdeSurfaces` `useMemo` dependencies in `WorkspacePage.tsx`.
3. Clean up unused imports in `use-editor-git-blame.ts` and test files.
4. Run full `pnpm lint` and `pnpm --filter @dam-hopper/ui test` to verify zero compiler errors and 100% test pass rate.

---

## Metrics

- **Score**: 9.1/10
- **TypeScript Compilation**: Pass (0 errors, `tsc --noEmit` exit 0, 8.14s)
- **Targeted Unit Tests**: 10 suites, 68 tests passed, 0 failed (100% pass rate, 1.95s)
- **Full UI Regression Suite**: 312 suites, 2,422 tests passed, 0 failed (100% pass rate, 18.55s)
- **Linting Issues**: 2 compiler errors in `EditorTabs.tsx:262,295`, 3 minor warnings in test files.

---

## Validation Commands / Results

```bash
# TypeScript verification
pnpm --filter @dam-hopper/ui exec tsc --noEmit
# Result: Pass (exit code 0, 0 diagnostics)

# Targeted Phase 06 test suite
pnpm --filter @dam-hopper/ui exec vitest run \
  src/components/organisms/EditorTabsBlame.test.tsx \
  src/components/organisms/MarkdownHostBlame.test.tsx \
  src/components/organisms/HtmlHostBlame.test.tsx \
  src/components/pages/WorkspacePageBlameReveal.test.tsx \
  src/components/organisms/EditorTabs.test.tsx \
  src/components/organisms/HtmlHost.test.tsx \
  src/components/organisms/MonacoHost.test.tsx \
  src/hooks/use-editor-git-blame.test.tsx \
  src/components/organisms/WorkspaceGitPanelBlame.test.tsx \
  src/components/organisms/EditorGitBlameGutter.test.tsx
# Result: 10 test files passed, 68 tests passed, 0 failed (100%)

# Full UI regression suite
pnpm --filter @dam-hopper/ui test
# Result: 312 test files passed, 2,422 tests passed, 0 failed (100%)

# Monorepo lint verification
pnpm exec eslint packages/ui/src/components/organisms/EditorTabs.tsx
# Result: 2 errors (react-hooks/preserve-manual-memoization)
```

---

## Unresolved Questions

*None.* All contracts and edge states are accounted for. The implementation is ready for Phase 07 qualification upon applying the two recommended fixes.
