# Code Review Summary: Phase 03 — Files, Editor, Federated Search, and Git (Review Cycle 2)

**Date:** 2026-09-17  
**Reviewer:** Phase03ReviewerCycle2  
**Score:** 9.7/10  

---

### Scope
- **Files reviewed (20):**
  - `packages/ui/src/hooks/use-fs-subscription.ts`
  - `packages/ui/src/hooks/use-fs-upload.ts`
  - `packages/ui/src/stores/editor.ts`
  - `packages/ui/src/stores/project-target.ts`
  - `packages/ui/src/stores/explorer-tree.ts`
  - `packages/ui/src/lib/explorer-language-scan.ts`
  - `packages/ui/src/hooks/use-fs-ops.ts`
  - `packages/ui/src/components/organisms/LargeFileViewer.tsx`
  - `packages/ui/src/components/organisms/MonacoHost.tsx`
  - `packages/ui/src/api/video-tickets.ts`
  - `packages/ui/src/lib/search-matches.ts`
  - `packages/ui/src/api/fs-types.ts`
  - `packages/ui/src/hooks/use-file-search.ts`
  - `packages/ui/src/components/organisms/SearchPanel.tsx`
  - `packages/ui/src/components/organisms/SearchPanelResults.tsx`
  - `packages/ui/src/lib/search-replace-next.ts`
  - `packages/ui/src/hooks/use-search-panel-replace.ts`
  - `packages/ui/src/hooks/use-git-with-ssh-retry.ts`
  - `packages/ui/src/api/phase-03-files-editor-search-git.test.ts`
  - `plans/260916-2137-unified-profile/phase-03-files-editor-search-and-git.md`
- **Lines of code analyzed:** ~1,600 LOC across 20 files.
- **Review focus:** Cycle 2 verification of warning remediations in `useFsSubscription` (`loadChildren` bound transport, `treeQueryKey` profile qualification, `toServerProjectTarget` wire serialization) and `useFsUpload` (qualified `targetRef` passed to `invalidateGitFileOperation` and `markTargetUnavailableIfNeeded`, transport capture, connection freshness check).

---

### Overall Assessment
All warnings reported in Review Cycle 1 successfully resolved with clean, resilient code:
1. `useFsSubscription.ts`: `loadChildren` correctly binds to `originatingTransportRef.current ?? (getTransport() as WsTransport)`, formats wire payload with `toServerProjectTarget(targetRef)`, updates profile-qualified `treeQueryKey`, and maintains backward-compatible sync with the unadorned cache key if `profileId` is present.
2. `useFsUpload.ts`: `invalidateGitFileOperation(qc, targetRef, path)` and `markTargetUnavailableIfNeeded(targetRef, error)` now receive fully qualified `targetRef` instead of stripped `requestTarget`. Additionally, transport capture via `captureConnection(profileId)` and mid-flight disconnect detection via `isCurrentConnection(connectionRef)` prevent stale-connection upload leaks.
3. Clean build and test execution: all 21 test files (172 tests) pass in 1.20s; `@dam-hopper/ui` TypeScript compilation and `@dam-hopper/web` production Vite build complete without errors or warnings.

---

### Critical Issues
*None.*

---

### Warnings
*None.*

---

### Suggestions
1. **`use-fs-subscription.ts:178` — Capture local transport reference in effect cleanup**
   - In `useEffect`, `t` is established as `const t = originatingTransportRef.current ?? (getTransport() as WsTransport)`. In the cleanup closure, calling `t.fsUnsubscribeTree(subId)` directly instead of `originatingTransportRef.current?.fsUnsubscribeTree(subId)` guarantees unsubscription against the exact instance bound during effect creation.
2. **`use-fs-upload.ts:141` — Primitive closure dependency extraction**
   - In `useFsUpload`, extracting `const profileId = targetRef.profileId;` outside `upload` and adding `profileId` cleanly aligns the `useCallback` dependency array with lint conventions.

---

### Reviewed Files
- `packages/ui/src/hooks/use-fs-subscription.ts`
- `packages/ui/src/hooks/use-fs-upload.ts`
- `packages/ui/src/stores/editor.ts`
- `packages/ui/src/stores/project-target.ts`
- `packages/ui/src/stores/explorer-tree.ts`
- `packages/ui/src/lib/explorer-language-scan.ts`
- `packages/ui/src/hooks/use-fs-ops.ts`
- `packages/ui/src/components/organisms/LargeFileViewer.tsx`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/api/video-tickets.ts`
- `packages/ui/src/lib/search-matches.ts`
- `packages/ui/src/api/fs-types.ts`
- `packages/ui/src/hooks/use-file-search.ts`
- `packages/ui/src/components/organisms/SearchPanel.tsx`
- `packages/ui/src/components/organisms/SearchPanelResults.tsx`
- `packages/ui/src/lib/search-replace-next.ts`
- `packages/ui/src/hooks/use-search-panel-replace.ts`
- `packages/ui/src/hooks/use-git-with-ssh-retry.ts`
- `packages/ui/src/api/phase-03-files-editor-search-git.test.ts`
- `plans/260916-2137-unified-profile/phase-03-files-editor-search-and-git.md`

---

### Validation Commands & Results
- `pnpm --filter @dam-hopper/ui test run src/api/phase-03-files-editor-search-git.test.ts src/stores/editor.test.ts src/stores/project-target.test.ts src/stores/explorer-tree.test.ts src/lib/explorer-language-scan.test.ts src/hooks/use-fs-ops.test.ts src/hooks/use-fs-subscription.test.tsx src/hooks/use-fs-upload.test.tsx src/components/organisms/LargeFileViewer.test.tsx src/api/video-tickets.test.ts src/lib/start-video-download.test.ts src/hooks/use-search-panel-replace.test.tsx src/lib/search-matches.test.ts src/lib/search-replace-next.test.ts src/hooks/use-git-with-ssh-retry.test.ts`: **PASS** (21 files, 172 tests, 0 failures, 1.20s)
- `pnpm --filter @dam-hopper/ui build`: **PASS** (`tsc -p tsconfig.json` clean, 0 errors, 6.33s)
- `pnpm --filter @dam-hopper/web build`: **PASS** (Vite production build clean, 6051 modules, 31.46s)

---

### Unresolved Questions
*None.*
