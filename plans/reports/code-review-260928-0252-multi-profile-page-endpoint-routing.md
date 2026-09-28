# Code Review: Multi-Profile Page Endpoint Routing

**Date:** 2026-09-28
**Plan:** `plans/260928-0252-multi-profile-page-endpoint-routing/plan.md`
**Reviewer:** Senior Software Engineer (Code Quality & Security)
**Score:** 5.5 / 10 (Remediation Required)

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `packages/ui/src/components/pages/GitPage.tsx`
  - `packages/ui/src/plugins/use-plugin-navigation.ts`
  - `packages/ui/src/components/PluginHostPage.tsx`
  - `packages/ui/src/components/organisms/ProjectInfoHelpers.ts`
  - `packages/ui/src/components/pages/GitPage.test.tsx`
  - `packages/ui/src/plugins/use-plugin-navigation.test.tsx`
  - `packages/ui/src/components/PluginHostPage.test.tsx`
  - `packages/ui/src/components/organisms/TopNav.test.tsx`
  - `packages/ui/src/hooks/use-git-with-ssh-retry.ts` (cross-check against plan contract)
  - `packages/ui/src/api/queries.ts` (cross-check against plan contract)
- **Lines of code analyzed:** ~1,500 LOC
- **Review focus:** Multi-profile isolation, security, type safety, performance, YAGNI/KISS/DRY, and plan contract adherence.
- **Updated plans:** `plans/260928-0252-multi-profile-page-endpoint-routing/plan.md` (status set to `remediation` with explicit remediation checklist).

---

## Overall Assessment
Good structural direction on project aggregation (`useAggregatedProjects`), tuple keys in `GitPage`, reactive subscriptions to `settingsProfileId`, and routing `PluginHostPage` for `evcrate.advisor`. Vitest suites and TypeScript compilation pass cleanly.

However, several severe bugs and incomplete requirements from Phase 1 and Phase 2 prevent production release:
1. **Critical functional bug in navigation:** When Settings server and Workspace profile coincide (the default/primary mode for most users), all ordinary (non-Advisor) plugins disappear completely from the top navigation.
2. **Critical security & auth vulnerability:** The planned SSH auth owner binding in `useGitWithSshRetry` and `queries.ts` was entirely omitted. Bulk Git retry on Profile B prompts against and adds keys to Profile A (ambient server), leaking credentials across servers and failing the retry.
3. **Critical boundary violation:** Workspace server plugins leak EVCrate Advisor into top navigation if missing on the Settings server, violating the strict Settings-only Advisor contract.
4. **Data integrity & UX issues in Git bulk operations:** Duplicate result reporting during retries, complete loss of prior successful results upon any batch failure/cancellation, and multi-selection workspace store desync.

---

## Critical Issues (Must Fix Before Merge)

### 1. Ordinary Plugins Dropped from Top Nav When Workspace Profile Equals Settings Profile
- **Location:** `packages/ui/src/plugins/use-plugin-navigation.ts:210-251`
- **Impact:** In any single-profile setup or whenever the user's active workspace project is on the same profile as Settings, NO non-Advisor plugins ever appear in the top navigation.
- **Root Cause:**
  - Query 1 (Settings server): when `canQueryWorkspace` is true, the `else if (meta && !canQueryWorkspace)` branch is never entered, so only `isAdvisorMetadata` items are added to `itemMap`.
  - Query 2 (Workspace server): gated by `if (!isSameTarget)`. When workspace profile == settings profile, `isSameTarget` is true, completely skipping Query 2!
  - As a result, non-Advisor plugins are discarded by Query 1 and bypassed by Query 2.
- **Fix:** When `isSameTarget` is true, Query 1 is querying the shared target: add ALL valid plugins (both Advisor and ordinary) to `itemMap`. Only restrict to Advisor when `!isSameTarget` and `canQueryWorkspace` is true.

```ts
// packages/ui/src/plugins/use-plugin-navigation.ts
const isSameTarget =
  canQuerySettings &&
  project?.profileId === settingsTargetProfileId &&
  project?.project === settingsProjectRef?.project;

// Query 1: Settings target server
if (canQuerySettings && settingsConnection?.owner && settingsProjectTarget) {
  const api = getApi(settingsConnection.owner);
  const target = toServerProjectTarget(settingsProjectTarget.target);
  const response = await api.plugins.list(target);
  if (!active || revision !== requestRevision) return;
  if (response && Array.isArray(response.plugins)) {
    const parsed = response.plugins.map(parsePluginMetadata);
    for (const meta of parsed) {
      if (!meta) continue;
      // If same target or workspace cannot be queried, keep all plugins from this server;
      // otherwise, keep ONLY Advisor plugins from Settings server.
      if (isSameTarget || !canQueryWorkspace || isAdvisorMetadata(meta)) {
        itemMap.set(meta.id, pluginNavigationItem(meta));
      }
    }
  }
}
```

---

### 2. SSH Credential Leakage & Broken Auth on Multi-Profile Git Operations
- **Location:** `packages/ui/src/components/pages/GitPage.tsx:180,209`, `packages/ui/src/hooks/use-git-with-ssh-retry.ts:176-177`, `packages/ui/src/api/queries.ts`
- **Impact:** Credential compromise across servers and functional failure.
- **Root Cause:**
  - Plan Phase 1 Item 4 explicitly required binding `useSshAddKey` and `useSshListKeys` to the captured group `ConnectionRef` via `connections.getTransport(owner)`.
  - In `GitPage.tsx`, `executeWithRetry({ operation: "fetch" })` does not pass `owner` or `targets`.
  - `useGitWithSshRetry` continues calling ambient `useSshAddKey()` and `useSshListKeys()` (bound to Profile A).
  - When Profile B experiences an SSH auth challenge, keys are listed from Profile A, passphrases submitted to Profile A, and retry on Profile B fails. Stale connection checking (`isCurrentConnection`) is disabled because `ownerRef.current` is null.
- **Fix:**
  1. Pass `owner: getConnectionSnapshot(pId)?.owner` and `targets: profileTargets` into `executeWithRetry`.
  2. In `use-git-with-ssh-retry.ts`, accept an optional `owner?: ConnectionRef` in `useGitWithSshRetry` or bind dynamically to `ownerRef.current` before calling `sshAddKey`.

---

### 3. EVCrate Advisor Leaks into Navigation from Workspace Server When Missing on Settings Server
- **Location:** `packages/ui/src/plugins/use-plugin-navigation.ts:244-246`
- **Impact:** Violation of architecture boundary. If Settings server A does not have Advisor installed, but Workspace server B does, Advisor is added to top nav. Clicking it navigates to `/plugins/evcrate.advisor`, where `PluginHostPage` tries to load it on Server A, showing an error/broken host.
- **Root Cause:**
  ```ts
  if (meta) {
    if (!isAdvisorMetadata(meta) || !itemMap.has(meta.id)) {
      itemMap.set(meta.id, pluginNavigationItem(meta));
    }
  }
  ```
  `!itemMap.has(meta.id)` evaluates to `true` when Settings server had no Advisor, allowing Workspace server B's Advisor to be added.
- **Fix:** In the workspace server query, strictly exclude Advisor metadata:
  ```ts
  if (meta && !isAdvisorMetadata(meta)) {
    itemMap.set(meta.id, pluginNavigationItem(meta));
  }
  ```

---

## High Priority Findings

### 4. Git Bulk Operations Duplicate Results on Retry and Lose Partial Results on Error
- **Location:** `packages/ui/src/components/pages/GitPage.tsx:165-221`
- **Impact:** UI shows duplicated result cards on successful retry; if user cancels or a profile fails, all prior successful operations disappear from the UI.
- **Root Cause:**
  1. `allResults.push(...res)` is placed inside the retry lambda passed to `executeWithRetry`. On initial failure, `res` is pushed. On user passphrase entry, the lambda re-executes, pushing `res` again. Meanwhile `executeWithRetry` returns the resolved/combined results, but its return value is ignored.
  2. If any profile batch in the loop throws or rejects (e.g. `SSH_CANCELLED_STALE_CONNECTION`), the loop terminates, jumping to `catch {}` before `setFetchResults(allResults)` is executed.
- **Fix:**
  ```ts
  const allResults: GitOpResult[] = [];
  try {
    for (const [pId, profileTargets] of byProfile) {
      try {
        const owner = getConnectionSnapshot(pId)?.owner;
        const groupResults = await executeWithRetry(
          { operation: "fetch", owner, targets: profileTargets },
          () => gitFetch.mutateAsync(profileTargets),
        );
        allResults.push(...groupResults);
        setFetchResults([...allResults]);
      } catch (err) {
        // Record partial failure and continue or preserve completed
      }
    }
  } finally {
    setIsFetching(false);
  }
  ```

---

### 5. Multi-Selection Does Not Clear Workspace Selection; Hydration Race Condition
- **Location:** `packages/ui/src/components/pages/GitPage.tsx:415-424, 480-494`
- **Impact:** Misleading single-project context in workspace store when user selects multiple projects; persisted workspace project hydration ignored if it arrives after `allProjects` loads.
- **Root Cause:**
  1. When `next.size > 1`, `setSelectedProject` is not called, leaving the previous single project selected in `workspaceStore`.
  2. `hasInitializedRef.current` is set to `true` on mount whenever `allProjects.length > 0`, even if `workspaceProject` is null. Late hydration is permanently blocked.
  3. `setSelectedProject` is invoked directly inside `setSelected((prev) => { ... })` state updater, which violates React's pure-updater rule and triggers concurrent rendering warnings.
- **Fix:**
  - Compute `next` outside `setSelected` before setting state.
  - Call `setSelectedProject(next.size === 1 ? nextRef : null)`.
  - Use a `userInteractedRef` to allow hydration to set the initial project unless the user has explicitly changed the selection.

---

## Medium Priority Improvements

### 6. Stale Selection on Deleted/Disconnected Projects
- **Location:** `packages/ui/src/components/pages/GitPage.tsx:435,444`, `packages/ui/src/components/PluginHostPage.tsx:87-89`
- **Problem:** When a project disappears from `allProjects`, `GitPage` falls back to `parseProjectKey(key)` rather than intersecting with available projects. `PluginHostPage` and `use-plugin-navigation.ts` also use `workspaceProject` without verifying it still exists in `allProjects`.
- **Fix:** Intersect `selected` keys with `availableProjectMap` and drop stale keys. Verify existence before defaulting to `workspaceProject`.

### 7. Results Not Cleared on Project Switch
- **Location:** `packages/ui/src/components/pages/GitPage.tsx:475-495`
- **Problem:** Toggling or switching projects calls `resetHistoryView()`, but does not reset `fetchResults`, `pullResults`, or `pushResults`. Pushing in Repo A leaves the success banner visible when switching to Repo B.
- **Fix:** Clear operation results in `resetHistoryView()` or on `toggleProject`.

### 8. Phase 3 Documentation & Tests Incomplete
- **Location:** `docs/user-guide-multi-server-profiles.md`, `docs/CHANGELOG.md`
- **Problem:** Phase 3 Item 5 documentation updates were not created. Test suite is missing a test for `usePluginNavigation` when workspace profile equals settings profile.
- **Fix:** Update documentation with multi-profile Git selection and Advisor target rules; add the missing Vitest case.

---

## Positive Observations
1. **Aggregated Project Integration:** Good adoption of `useAggregatedProjects` and `projectKey` tuple serialization (`${profileId}:${project}`).
2. **Push Target Profile Qualification:** `buildProjectInfoPushTargetWithMode` cleanly attaches `profileId`, allowing `useGitPush` to resolve the bound API client without changing wire DTOs.
3. **Session Lifecycle Cleanup:** `PluginHostPage` properly revokes `FrameSession` and aborts fetch controllers on unmount or owner generation changes.
4. **TypeScript Safety:** 100% typecheck passing without `any` casts or ts-expect-error escapes.

---

## Recommended Actions (Prioritized)
1. **Fix Navigation Logic (`use-plugin-navigation.ts`):** Fix Query 1 / Query 2 merge condition so ordinary plugins load when workspace and settings profiles coincide, and never leak Advisor from workspace.
2. **Wire SSH Retry Owner (`use-git-with-ssh-retry.ts` & `GitPage.tsx`):** Pass `owner` to `executeWithRetry`, bind `useSshAddKey`/`useSshListKeys` to the owner transport, and prevent cross-server credential transmission.
3. **Refactor Batch Result Accumulation (`GitPage.tsx`):** Accumulate return values from `executeWithRetry`, preserve partial results on error, and avoid duplicate pushes.
4. **Fix Selection Hygiene (`GitPage.tsx`):** Move `setSelectedProject` out of `setSelected` callback, clear on multi-selection, and handle hydration properly.
5. **Add Regression Tests:** Add Vitest test covering coincident settings/workspace profiles in `use-plugin-navigation.test.tsx`.
6. **Update Docs:** Complete `docs/user-guide-multi-server-profiles.md` and `docs/CHANGELOG.md`.

---

## Metrics
- **Score:** 5.5 / 10
- **Type Coverage:** 100% (passes `tsc -p tsconfig.json`)
- **Test Pass Rate:** 100% (63 focused tests passed, 274 total test files passed)
- **Critical Issues:** 3
- **High Priority Issues:** 2
- **Medium Priority Issues:** 3
- **Lint / Compiler Errors:** 0

---

## Unresolved Questions
1. Should `ProgressList` be upgraded in this phase to accept `ProjectRef` (with profile badge) instead of plain `projectName: string`, or should duplicate repo names in bulk progress wait for a dedicated SSE protocol update?
2. In `PluginHostPage`, should installation ID matching strictly require `installationId === "evcrate.advisor"`, or continue supporting prefix aliases (`evcrate.*` and `evcrate-advisor`)?
