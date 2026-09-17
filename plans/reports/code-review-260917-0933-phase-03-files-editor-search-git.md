# Code Review Summary: Phase 03 — Files, Editor, Federated Search, and Git

**Date:** 2026-09-17  
**Reviewer:** Phase03Reviewer  
**Score:** 8.5/10  

---

### Scope
- **Files reviewed (19):**
  - `packages/ui/src/stores/project-target.ts`
  - `packages/ui/src/stores/explorer-tree.ts`
  - `packages/ui/src/stores/editor.ts`
  - `packages/ui/src/components/organisms/MonacoHost.tsx`
  - `packages/ui/src/lib/explorer-language-scan.ts`
  - `packages/ui/src/hooks/use-fs-ops.ts`
  - `packages/ui/src/hooks/use-fs-subscription.ts`
  - `packages/ui/src/hooks/use-fs-upload.ts`
  - `packages/ui/src/components/organisms/LargeFileViewer.tsx`
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
- **Lines of code analyzed:** ~1,500 LOC across 19 files.
- **Review focus:** Multi-profile key qualification, editor model separation, owner-bound transport/CRUD, federated search & replace isolation, selective Git SSH retry, dirty draft preservation.
- **Updated plans:** `plans/260916-2137-unified-profile/phase-03-files-editor-search-and-git.md`.

---

### Overall Assessment
High-quality implementation of Phase 03 contracts. Completely decouples ambient active profile from file/editor/search/git operations. Monaco editor models correctly keyed by URI-encoded composite tabKey (`inmemory://dam-hopper/${encodeURIComponent(tabKey)}`), preventing cross-profile collision when identical file paths are open. Federated search bounds concurrency to 4 servers, local cap 500 matches, isolates query generations, and handles offline profiles gracefully via `Promise.allSettled`. Search replace verifies open dirty tabs per-owner and skips them honestly. Git SSH selective retry preserves initial successes and aborts stale generations upon reconnect.

Two non-blocking warnings identified: `loadChildren` in `useFsSubscription` uses bare query key without profile ID and ambient `api.fs.list`, and `useFsUpload` passes stripped `requestTarget` instead of `targetRef` to Git invalidation.

---

### Critical Issues (Must Fix)
*None.* All security, boundary, and build invariants hold.

---

### Warnings (Should Fix)

1. **`use-fs-subscription.ts:206` — `loadChildren` misses profileId in queryKey and uses ambient transport**
   - **Problem:** `treeQueryKey` is defined as `targetRef.profileId ? ["fs-tree", targetRef.profileId, project, targetKey, path] : ["fs-tree", project, targetKey, path]`. However, `loadChildren` hardcodes `["fs-tree", project, targetKey, path]` in `qc.setQueryData`, and calls ambient `api.fs.list(requestTarget, nodeId)` instead of `originatingTransportRef.current`.
   - **Impact:** Expanding a folder in a non-default profile does not update the tree UI for that profile, and pollutes the bare cache key.
   - **Fix:** In `loadChildren`, update `treeQueryKey` and invoke `originatingTransportRef.current?.invoke("fs:list", { ...toWireTarget(targetRef), path: nodeId })`.

2. **`use-fs-upload.ts:116, 118` — Git invalidation and target unavailable check uses unadorned `requestTarget`**
   - **Problem:** `requestTarget` is `{ project, worktreePath }` or `project`, which omits `targetRef.profileId`.
   - **Impact:** `invalidateGitFileOperation(qc, requestTarget, path)` and `markTargetUnavailableIfNeeded(requestTarget, result.error)` lose profile qualification, failing to invalidate profile-specific Git diffs.
   - **Fix:** Pass `targetRef` instead of `requestTarget` to `invalidateGitFileOperation` and `markTargetUnavailableIfNeeded`.

---

### Suggestions (Nice to Have)

1. **`explorer-language-scan.ts:218-241` — Scoped profile cache eviction gap for unvisited targets**
   - In `removeExplorerLanguageScanCaches`, scoped profile invalidation increments `epochsByScope` only for already known scope keys in the Map. For unvisited scopes, default epoch is `runtime.workspaceEpoch`. A profile-level epoch or pre-seeding ensures in-flight scans for newly accessed scopes are also invalidated.

2. **`use-file-search.ts:83` — Reactive profile list subscription**
   - `const allProfiles = getProfiles()` is read per render. Binding to profile state store or passing profiles via hook ensures search panel updates immediately if profiles change without triggering panel re-render.

---

### Positive Observations
- **Monaco Isolation:** `path={`inmemory://dam-hopper/${encodeURIComponent(tabKey)}`}` ensures separate Monaco models and distinct view states across profiles.
- **Honest Federated Search:** `Promise.allSettled` over at most 4 connected profiles, per-profile badges/statuses, stable sort (`profileId` -> `project` -> `path` -> `line`), and explicit truncation warning.
- **Search Replace Safety:** Partitions by `${profileId}:${project}:${path}`, checks dirty tabs on exact target scope, preserves dirty drafts without overwriting, and returns granular file outcome counts.
- **Git SSH Retry Hygiene:** `initialSuccessfulResultsRef` prevents replay of already-pushed targets. `isCurrentConnection(ownerRef.current)` cancels stale generation retry on reconnect.
- **Save Integrity:** `isCurrentRequest` + `isCurrentConnection` post-await verification prevents out-of-order save clobbering.

---

### Metrics
- **Type Safety:** 100% strict TypeScript. `pnpm --filter @dam-hopper/ui build` passed with 0 errors.
- **Build Validation:** `@dam-hopper/web build` passed cleanly (Vite production bundle generated with no regressions).
- **Test Pass Rate:** 100% (15 test files, 122 tests passed in UI package for Phase 03 suite).

---

### Validation Commands & Results
- `pnpm --filter @dam-hopper/ui test run src/api/phase-03-files-editor-search-git.test.ts`: PASS (7 files, 59 tests, 669ms)
- `pnpm --filter @dam-hopper/ui test <15 Phase 03 test suites>`: PASS (15 files, 122 tests, 854ms)
- `pnpm --filter @dam-hopper/ui build`: PASS (tsc clean)
- `pnpm --filter @dam-hopper/web build`: PASS (Vite clean, 32s)

---

### Unresolved Questions
*None.*
