---
title: "Fix multi-profile Git and EVCrate Advisor endpoint routing"
description: "Keep Git project ownership through selection and operations, and bind EVCrate Advisor navigation and host to the Settings Target Server."
status: complete
priority: P1
effort: 6h
branch: main
tags: [bugfix, frontend, api, multi-profile, plugins]
created: 2026-09-28
---

# Multi-profile page endpoint routing

## Context, decision, scope

[Diagnosis](../reports/debugger-260928-0252-multi-profile-page-endpoint-routing.md). `GitPage` lists only ambient projects and drops `profileId` before Git reads, mutations, and diff tabs. Plugin navigation and hosting look only at the workspace project; EVCrate Advisor may be installed on a different, explicitly selected Settings server. This is a correction to the existing [qualified project/target ownership](../../docs/system-architecture.md#phase-03-files-editor-search-and-git-ownership-2026-09-17) and [independent Settings selector](../../docs/system-architecture.md#phase-06-preferences-settings-usage-and-host-resources-2026-09-17) contracts; no schema, new backend endpoint, or architecture diagram required.

**Boundary:** Git project-owned traffic goes only to the owning profile. EVCrate Advisor plugin traffic goes only to `settingsProfileId || getActiveProfileId() || ""`, independently of workspace selection. Other plugins remain scoped to selected workspace project when present; when absent, a valid target project on Settings server can supply the target. Plugin API requires an actual configured project: backend `server/src/api/plugins.rs` resolves `query.project` before listing, so `"*"`, empty project, and invented project names are invalid. Do not silently route disconnected/missing qualified targets to ambient API. No dashboard/terminal migration, generic plugin-platform redesign, or global removal of string project inputs.

| Phase | Work | Estimate | Depends on |
| --- | --- | --- | --- |
| 1 | Git selector, qualified reads/diffs, per-profile bulk operations | 2.5h | None |
| 2 | Advisor Settings-server navigation and host, ordinary plugin behavior | 2h | None |
| 3 | Focused Vitest regressions, actual page smoke, documentation and full UI check | 1.5h | 1–2 |

## Phase 1 — Git selection and endpoint-safe operations

**Files to modify:** `packages/ui/src/components/pages/GitPage.tsx`; possibly `packages/ui/src/components/organisms/ProgressList.tsx` for profile-qualified progress rendering. Reuse `packages/ui/src/hooks/use-aggregated-projects.ts`, `packages/ui/src/api/ownership.ts`, `packages/ui/src/hooks/use-project-target.ts`, `packages/ui/src/components/organisms/ProjectInfoHelpers.ts` and `packages/ui/src/stores/editor.ts`; do not duplicate aggregation or change backend wire format.

1. Replace `useProjects()` with `useAggregatedProjects()`. Iterate `allProjects` (`{profileId, profileName, project, ref}`), or existing `groups` for headings. Render project name plus visible profile name/badge (URL as secondary disambiguator if necessary); checkbox `key`, `checked`, selection updates use `projectKey(item.ref)`. Keep `selected: Set<string>` but store **tuple keys**, never names. `selectedList` resolves keys with `parseProjectKey`, intersected with currently available `allProjects`; empty selection means all aggregated projects for fetch/pull. Distinguish an empty loaded list from a loading state. Drop stale keys when a profile/project disappears rather than sending them to another owner.
2. Seed initial selection from `useWorkspaceStore(state => state.selectedProject)` when that qualified project is present; handle persisted hydration arriving after first render without overriding a GitPage selection the user has already changed. On selecting/switching to exactly one project, `setSelectedProject(parsedRef)`; on explicitly clearing or selecting multiple, avoid leaving a misleading single-project Git context (clear workspace selection when this page changes to no unique selection). Never rewrite Settings target. Reset selected commit/history scope and root state when the **tuple key** changes, including when two profiles have the same project name; do not leak prior logs, worktree, operation results, or push root to a newly selected owner.
3. Derive `selectedRef = selected.size === 1 ? parseProjectKey([...selected][0]) : null`, checking it exists in `allProjects`; `selectedProjectName = selectedRef?.project ?? null` only for display/legacy string-only props. Use `useProjectTarget(selectedRef)` and `targetRef = selectedTarget?.target ?? selectedRef ?? ""`. Pass `targetRef` through `useGitLog`, `useProjectStatus`, `useGitHistoryActions`, `useGitRoots` and qualified `selectedTarget?.target` to `GitLocalChanges`, `CommitDetailsPanel`, `buildProjectInfoPushTarget(WithMode)`; retain push limited to exactly one project. Key `BulkGitOperations` and any project-specific UI by `projectKey(selectedRef)`, not name. In `handleFileDoubleClick`, `openDiff(selectedTarget?.target ?? selectedRef, ...)`, guarded by non-null `selectedRef`; editor already accepts `ProjectTargetInput`, preserves profile/worktree, and keys tabs by target.
4. In `BulkGitOperations`, accept qualified `ProjectRef[]` for selected/all targets and `selectedRef` for root/push. Build target inputs preserving `profileId` for every fetch/pull; use selected worktree target only for the corresponding tuple. **Partition fetch/pull by `profileId` before invoking `useGitFetch().mutateAsync` / `useGitPull().mutateAsync`:** current hooks choose their client from `targets[0]`, then wire projection drops profile IDs. Never pass mixed-profile arrays in a mutation and never call mutation with `undefined` for “all” in this page. Execute batches sequentially where SSH dialog/retry is used (one pending retry per hook); pass that group's connection `owner` and qualified `targets` to `executeWithRetry` so stale connections cannot retry against a replacement. Keep per-group successes even if a different group fails; display failed group/target, not swallowed `.catch(() => {})`. An event/result contains just `projectName`: label failures and progress by associated profile, especially for duplicate project names. If `ProgressList` must change, use `IpcEvent.profileId` plus project name as its identity; do not make a name-only progress map report the other profile's status. Preserve owner-scoped cache invalidation by calling existing mutation per group; do not add a second Git mutation implementation.
   **SSH auth path:** `useGitWithSshRetry` currently passes `owner` only to its stale-connection check; `useSshAddKey` and `useSshListKeys` in `packages/ui/src/api/queries.ts` call ambient `getTransport()`. Before enabling per-profile retry dialogs, modify `packages/ui/src/hooks/use-git-with-ssh-retry.ts` and those two query hooks to bind key listing/loading to the captured group `ConnectionRef` via `connections.getTransport(owner)` and owner-qualified query keys (keep existing ambient behavior only for callers with no owner). On retry, recheck current owner before loading the key and invoking Git; cancel instead of adding a key on a different server. Verify key-list and key-add traffic on profile B while A is active. Never silently move credentials across servers.
5. Ensure result display and running state cover the **whole** sequence, not merely `gitFetch.isPending`/`gitPull.isPending` on the latest group. Disable duplicate submits while batch in progress. Keep force-push and normal-push profiles qualified through existing push target helper.

**Acceptance:** Same-named repositories on profiles A/B have independent selection, Git reads/actions/diff tabs and push go to selected profile; Fetch/Pull All sends a separate qualified request to each connected owner, aggregates successes/failures without cross-routing or duplicate retry; no-project or disconnected selections cannot mutate ambient repositories.

## Phase 2 — Advisor follows Settings Target Server

**Files to modify:** `packages/ui/src/components/PluginHostPage.tsx`, `packages/ui/src/plugins/use-plugin-navigation.ts`; touch `packages/ui/src/components/organisms/TopNavRouteMenu.tsx` only if a hook interface must change. Reuse `useWorkbenchSelectionsStore`, `getActiveProfileId`, `useAggregatedProjects`, `useConnectionSnapshot`, `useProjectTarget`, `toServerProjectTarget`, `getApi` and existing `plugin:availability.changed` subscriptions.

1. In both host and navigation, subscribe reactively to `settingsProfileId` via `useWorkbenchSelectionsStore(s => s.settingsProfileId)`; compute `targetProfileId = settingsProfileId || getActiveProfileId() || ""`. Active-profile changes must trigger re-render when Settings selection is empty: use existing `subscribeToProfileChanges`/`getProfileChangeVersion` with `useSyncExternalStore`, as `getActiveProfileId()` by itself does not subscribe. An explicitly chosen Settings profile wins; a disconnected chosen profile **never** falls back to the workspace/ambient profile.
2. Choose a **real target on the Settings server** from `useAggregatedProjects().allProjects`: if `selectedProject?.profileId === targetProfileId` and it still exists there, use it (and its `useProjectTarget` worktree if appropriate); otherwise first project whose `profileId === targetProfileId`, using `{ profileId: targetProfileId, project: item.ref.project }` as root target. Keep this logic small and shared between navigation/host only if duplication warrants a tiny helper; no extra target persistence. Wait through aggregation loading before declaring no-project. If Settings server has no configured project, show honest unavailable/no-project state; do not pretend a wildcard is accepted by backend. Ensure the same project/owner pair is used for list, asset request, and `FrameSession` bridge target.
3. `PluginHostPage`: special-case **installation ID `evcrate.advisor`** before deriving the connection or target: connect with `useConnectionSnapshot(targetProfileId)`, compute Advisor target as above, then call `useProjectTarget(advisorRef)` and `toServerProjectTarget` for the request/bridge. Non-Advisor installations continue on selected workspace project's owner/target when present (or valid Settings target when no workspace selection). Guard missing target **before** API calls, but not solely because workspace selection is null. Include `targetProfileId`, selected target's `profileId`, project/worktree, connection owner generation, installation ID and availability revision in load/revoke dependencies. On owner or Settings-target change, revoke prior `FrameSession`, abort asset fetch, clear prior ready metadata/document, prevent late responses from repainting the previous server; retain digest, generation, capability, visibility, and CSP verification.
4. `usePluginNavigation(project)`: query Settings server independently for Advisor even when `project` is null/on another profile. Continue querying the selected project owner for other plugins; when there is no selected project, query a valid Settings-server project for ordinary plugins if applicable. Use the same real-project target rules as host; if both target tuples coincide, fetch once. Merge by `installationId`: Advisor entry only from Settings response, never from workspace response on another profile; ordinary IDs remain from workspace response when a workspace project is selected. Distinct owner generation and `plugin:availability.changed` listeners refresh each source; clean up both on target changes. Clear stale items on profile/target switch; a request failure on one owner cannot mask successful items from the other, but report error for the failed source. Do not use an unbound `api` fallback or display an Advisor item from a stale server.

**Acceptance:** Settings A + workspace B (or no workspace selection) displays Advisor in top nav when visible on A and loads its metadata, verified UI asset, and bridge only via A; ordinary plugins still use B when selected. Changing Settings A→C updates/removes Advisor without needing a workspace switch; missing/disconnected Settings server cannot accidentally expose Advisor from B. Server visibility still governs whether Advisor is shown.

## Phase 3 — Regression proof, smoke, docs

**Tests to modify/create, following local jsdom/React `act` patterns:** `packages/ui/src/components/pages/GitPage.test.tsx` (create), `packages/ui/src/plugins/use-plugin-navigation.test.tsx` (create), `packages/ui/src/components/PluginHostPage.test.tsx` (create); extend `packages/ui/src/api/queries-git-diff.test.ts` only if batching changes hook contract. Keep fixtures owner-distinct and mock only transport/connection boundaries, not the routing decisions under test. Existing plugin metadata test is `packages/ui/src/plugins/plugin-document.test.ts`; use valid metadata/digest fixtures. Test actual observable calls and state, not hook pass-through or snapshot/source text.

1. Two profiles with same project name: A and B selectors distinct, workspace store updates `{profileId,project}`, query/mutation owner selection correct, diff tab target qualified. Fetch/Pull All verifies **two** profile-local calls and no mixed-profile request; a failed B batch leaves A results visible; second submit blocked while first runs; single push/force push respects selected owner/root.
2. Advisor tests with Settings A and selected workspace B, plus null workspace: nav includes A's Advisor, excludes B's Advisor, non-Advisor on B still works, host `plugins.list`, `readUiAsset` and bridge target use A's real project. Test change of Settings target while asset pending; prior session revoked/response discarded. Test missing/disconnected A, no real project A, and profile switch/reconnect; no fallback to B or fake `"*"` target. Test non-Advisor host continues on workspace B. Validate two-profile duplicate labels and no stale entry on switch.
3. Run focused Vitest from repo root: `pnpm --filter @dam-hopper/ui test -- src/components/pages/GitPage.test.tsx src/plugins/use-plugin-navigation.test.tsx src/components/PluginHostPage.test.tsx src/api/queries-git-diff.test.ts` (omit unchanged test file if not relevant). Run `pnpm --filter @dam-hopper/ui build`, then `pnpm --filter @dam-hopper/ui test` **once after both phases**. Do not run mid-flight project-wide checks.
4. Actual UI smoke in web host with two connected server profiles and duplicate repo names: visit `/git`, switch A→B, inspect network/transport endpoint for log/status and a safe fetch, open same-path diff tabs, verify distinct profile badges and no cross-target mutation; Fetch All/Pull only on disposable repos with permission and backup. Visit `/plugins/evcrate.advisor` with Settings A/workspace B and with no workspace project; verify A's asset and UI; switch Settings to C and confirm item/host refresh. If authenticated plugin server or browser unavailable, report that specific smoke limit; run a throwaway mounted-page integration scenario and inspect owner-bound calls, not just Vitest. Remove temporary scripts.
5. Update `docs/user-guide-multi-server-profiles.md` with Git selector profile badges, selected-project synchronization, per-profile bulk request behavior, and Advisor's Settings server origin (including requirement for at least one configured target project); update `docs/CHANGELOG.md` with delivered fix after verification. Cross-check [architecture ownership invariants](../../docs/system-architecture.md#phase-03-files-editor-search-and-git-ownership-2026-09-17); update architecture only if implementation changes its stated contract.

**Release/risk notes:** Keeping `profileId` on client refs but excluding it from wire target is essential: `getApi(owner)` picks server; `toServerProjectTarget` picks its local project. `GitOpResult` lacks `profileId`, so annotate at presentation boundary without changing wire DTO. Failing the Settings server must not trigger an ambient request. SSH passphrase retry has one pending callback: process profile batches serially, owner-bind key-list/key-add as above, and preserve successful batches. Invalid selection/worktree and concurrent profile disconnect fail closed. No backend or deployment migration.

## Unresolved questions

- None blocking. Deliberate choice: scope only `evcrate.advisor` to Settings; other plugins follow selected workspace project, using Settings project only when workspace selection absent. Bulk profile failures produce partial results; no global abort. A Settings server with zero configured projects cannot list plugins under the current backend contract; display unavailable rather than fabricate a target.

## Review Status and Next Steps

**Review Date:** 2026-09-28
**Reviewer:** Code Reviewer (Senior Software Engineer)
**Overall Score:** 5.5/10 (Remediation Required)

### Completed Items
- [x] Phase 1 Item 1: Replace `useProjects()` with `useAggregatedProjects()` and tuple keys in `GitPage.tsx`.
- [x] Phase 1 Item 3: Project-target derivation and passing `targetRef` to Git operations, logs, status, diff tabs, and push.
- [x] Phase 1 Item 4: Partition bulk fetch/pull by `profileId` before calling mutations.
- [x] Phase 1 Item 5 / Push helper: `buildProjectInfoPushTargetWithMode` annotates `profileId` for push routing.
- [x] Phase 2 Item 1: Subscribe reactively to `settingsProfileId` and active profile changes via `useSyncExternalStore`.
- [x] Phase 2 Item 3: `PluginHostPage` routes `evcrate.advisor` to Settings server target.

### Remediation Items Required (Next Steps)
1. **Fix ordinary plugin navigation on matching profile (`use-plugin-navigation.ts`):**
   - When `settingsProfileId === workspaceProfileId` (`isSameTarget`), fetch once and populate both Advisor AND ordinary plugins into `itemMap`. Do not skip ordinary plugins from the first query when `canQueryWorkspace` is true.
2. **Fix Advisor leakage from workspace server (`use-plugin-navigation.ts`):**
   - In workspace query results, strictly filter out Advisor metadata (`if (!isAdvisorMetadata(meta)) itemMap.set(...)`). Never fallback to workspace Advisor when missing on Settings server.
3. **Implement owner-bound SSH authentication path (`use-git-with-ssh-retry.ts` & `queries.ts`):**
   - Bind `useSshAddKey` and `useSshListKeys` to the specific connection owner (`getTransport(owner)`).
   - Pass `{ operation, owner, targets }` to `executeWithRetry` in `GitPage.tsx` for each profile batch and push.
   - Ensure SSH passphrase dialog on Profile B lists keys from Profile B and loads keys to Profile B, not ambient Profile A.
4. **Fix batch operation results aggregation and failure handling (`GitPage.tsx`):**
   - Accumulate results from `await executeWithRetry(...)` return value, not by pushing inside the retry callback (which duplicates results on retry).
   - Retain and display partial results if a subsequent profile batch throws or cancels.
5. **Refine selection synchronization & React state hygiene (`GitPage.tsx`):**
   - Move `setSelectedProject` call outside of `setSelected` state updater to eliminate React side-effect anti-pattern.
   - Clear `selectedProject(null)` when multiple projects are selected (`next.size > 1`).
   - Reset operation results (`fetchResults`, `pullResults`, `pushResults`) when switching projects.
   - Drop stale keys and intersect selection with currently available `allProjects` instead of synthesizing non-existent projects with `parseProjectKey`.
   - Ensure persisted hydration arriving after `allProjects` loads is not blocked if user has not interacted.
6. **Verify and check `allProjects` existence in `PluginHostPage.tsx` and `use-plugin-navigation.ts`:**
   - Verify that `workspaceProject` exists in `allProjects` for `settingsTargetProfileId` before using it as the target.
7. **Complete Phase 3 documentation and changelog updates:**
   - Update `docs/user-guide-multi-server-profiles.md` and `docs/CHANGELOG.md`.
   - Add Vitest test covering `usePluginNavigation` when workspace and settings profile coincide.
