# Diagnostic Report: PluginHostPage Deprecation & origin/main Merge Conflict Analysis

**Author:** DebuggerInvestigate (Senior Software Engineer)  
**Date:** 2026-09-30  
**Target Path:** `plans/reports/debugger-investigate-260930-1329-plugin-host-page-merge-analysis.md`  
**Target Branches:** `feat/plugin-platform` (`HEAD`: `b3046625`) ↔ `origin/main` (`bdd7f0e4`)  
**Merge Base:** `443b934c78f72bc76b8ec008265f74b60d263255`  

---

## 1. Executive Summary

### Issue Description
The codebase contains a legacy standalone plugin page component (`PluginHostPage.tsx`) mounted at `/plugins/:installationId`. Following the migration of EVCrate Advisor into the integrated Workspace Advisor (Phases 00–09: IDE dock, Terminal float, compact overlay), `PluginHostPage.tsx` was temporarily kept as a fail-closed stub rendering `PluginUnavailableState` for `evcrate.advisor` bookmarks. The goal is to completely remove `PluginHostPage.tsx`, delete its test suite, delete its route and lazy import in `dam-hopper-app.tsx` without maintaining a stub route for bookmarks, and cleanly merge `origin/main` (`bdd7f0e4`) into `feat/plugin-platform`.

### Root Cause of Merge Divergence
Between merge-base `443b934c` and `origin/main` (`bdd7f0e4`), main completed Linux qualification for Codex/Claude native hooks (Phase 06) and added multi-profile project resolution logic to `PluginHostPage.tsx`, `use-plugin-navigation.ts`, and `use-plugin-host.ts`. Concurrently, `feat/plugin-platform` (`HEAD`) completed paired qualification for Workspace-integrated Advisor, cutting over Advisor from standalone routing and adding ESLint-compliance fixes. Exactly **9 files** experience merge conflicts during `git merge origin/main`.

### Recommended Resolution Plan
1. **P0 (Immediate Removal):** Remove `PluginHostPage.tsx`, remove `PluginHostPage.test.tsx`, and strip the lazy import and `<Route path="/plugins/:installationId" ... />` from `packages/ui/src/embed/dam-hopper-app.tsx`.
2. **P0 (Merge Execution):** Merge `origin/main` using the per-file conflict resolution strategies defined in this report.
3. **P1 (Documentation Reconciliation):** Reconcile `docs/CHANGELOG.md`, `docs/codebase-summary.md`, and `docs/frontend-components.md` to record both completed milestones while removing stale references to `PluginHostPage`.

---

## 2. All References to PluginHostPage Across Codebase

### A. Production Code
1. **`packages/ui/src/embed/dam-hopper-app.tsx`**
   - **Lines 112–116:** Lazy import definition:
     ```tsx
     const PluginHostPage = lazy(() =>
       import("@/components/PluginHostPage.js").then((module) => ({
         default: module.PluginHostPage,
       })),
     );
     ```
   - **Lines 424–433:** Route declaration:
     ```tsx
     <Route
       path="/plugins/:installationId"
       element={
         <ErrorBoundary>
           <Suspense fallback={LOADING_FALLBACK}>
             <PluginHostPage />
           </Suspense>
         </ErrorBoundary>
       }
     />
     ```
2. **`packages/ui/src/components/PluginHostPage.tsx`**
   - Entire file (lines 1–26) defining `export function PluginHostPage()`.

### B. Test Suites
3. **`packages/ui/src/components/PluginHostPage.test.tsx`**
   - Entire file (lines 1–200) testing `PluginHostPage` routing behavior.

### C. Documentation & Historical Reports
4. **`docs/CHANGELOG.md`** (line 20): Historical entry from 2026-09-28 referencing `PluginHostPage` multi-profile routing.
5. **`docs/frontend-components.md`** (lines 171, 173 in `origin/main`): Mentions `PluginHostPage.tsx` and `PluginHostPage.test.tsx` routing.
6. **`plans/260920-1603-plugin-platform/phase-04-isolated-ui-host.md`** (line 81): Historical roadmap file.
7. **`plans/260928-0252-multi-profile-page-endpoint-routing/plan.md`**: Historical plan file.
8. **`plans/reports/code-review-260928-0252-multi-profile-page-endpoint-routing.md`**: Historical review.
9. **`plans/reports/debugger-260928-0252-multi-profile-page-endpoint-routing.md`**: Historical debugger report.
10. **`plans/reports/code-review-260930-1053-phase-06-linux-qualification.md`**: Phase 06 qualification review on `origin/main`.

*Note: In CSS (`packages/ui/src/index.css`), the class `.plugin-host-page` is used by `PluginHost.tsx` and `workspace-advisor.browser.tsx`. The CSS class belongs to the frame container and is not tied to `PluginHostPage.tsx`.*

---

## 3. Plan for Removing PluginHostPage Without Breaking Router or Components

### Router Modification (`packages/ui/src/embed/dam-hopper-app.tsx`)
1. **Remove Lazy Import:**
   Delete lines 112–116:
   ```tsx
   -const PluginHostPage = lazy(() =>
   -  import("@/components/PluginHostPage.js").then((module) => ({
   -    default: module.PluginHostPage,
   -  })),
   -);
   ```
2. **Remove Route:**
   Delete lines 424–433:
   ```tsx
   -              <Route
   -                path="/plugins/:installationId"
   -                element={
   -                  <ErrorBoundary>
   -                    <Suspense fallback={LOADING_FALLBACK}>
   -                      <PluginHostPage />
   -                    </Suspense>
   -                  </ErrorBoundary>
   -                }
   -              />
   ```
3. **Router Invariants & Fallback Behavior:**
   - React Router v6 in `dam-hopper-app.tsx` does not have a global wildcard `*` catch-all route.
   - Deleting the route means requests to `/plugins/:installationId` simply render empty within `<Routes>` rather than loading chunks or displaying a stub.
   - All other routes (`/`, `/workspace`, `/git`, `/settings`, `/agent-store`, `/usage`, `/ssh-forwarding`, and legacy redirects `/terminals` / `/ide`) remain completely unaffected.

### Component & Test Deletion
1. **Delete Component:** `git rm packages/ui/src/components/PluginHostPage.tsx`
2. **Delete Test File:** `git rm packages/ui/src/components/PluginHostPage.test.tsx`
   - Inspection confirms `PluginHostPage.test.tsx` contains only one suite (`describe("PluginHostPage Settings Target Server routing")`), which exclusively mounts `<PluginHostPage />`. There are no shared test utilities or secondary component tests in this file.

---

## 4. Conflict Resolution Strategy for origin/main Merge

Git `merge-tree` between `HEAD` and `origin/main` (`bdd7f0e4`) identifies conflicts in exactly 9 files:

```
1. docs/CHANGELOG.md
2. docs/codebase-summary.md
3. packages/ui/browser-tests/project-worktree-target.browser.tsx
4. packages/ui/src/components/PluginHostPage.tsx
5. packages/ui/src/components/PluginHostPage.test.tsx
6. packages/ui/src/contexts/WorkspaceAdvisorContext.tsx
7. packages/ui/src/plugins/use-plugin-host.ts
8. packages/ui/src/plugins/use-plugin-navigation.ts
9. server/tests/plugin_api_integration.rs
```

### Detailed Resolution Strategy Per File

#### 1. `docs/CHANGELOG.md`
- **Conflict Cause:** Both branches inserted a milestone entry under `# 2026-09-30`. `origin/main` also normalized blank lines before older date headers.
- **Resolution:**
  - Retain both `# 2026-09-30` entries:
    1. `Workspace-integrated Advisor — Phase 09 paired qualification, docs, and release handoff DONE (2026-09-30; 100%)` (from HEAD).
    2. `Codex and Claude native-hook status — Phase 06 DONE (2026-09-30 Asia/Saigon; 100%)` (from origin/main).
  - Adopt origin/main's blank line formatting before older headings.

#### 2. `docs/codebase-summary.md`
- **Conflict Cause:**
  - HEAD updated the Repomix compaction summary header (v1.18.0 stats) and added the Workspace Advisor integration summary under Plugins.
  - `origin/main` updated D03 descriptions to document `POST /api/plugins/view-context`, updated markdown table columns, and added Agent Status Phase 06 qualification notes.
- **Resolution:**
  - Accept `origin/main`'s table column formatting, D03 view-context notes, and agent status Phase 06 text.
  - Retain the Repomix header and the Workspace Advisor summary from HEAD, updating the Advisor text to state that standalone `/plugins/:installationId` routing has been cleanly excised.

#### 3. `packages/ui/browser-tests/project-worktree-target.browser.tsx`
- **Conflict Cause:**
  - Both branches added a `Link` mock to `vi.mock("react-router-dom")` (differing only in line wrapping).
  - Both branches added `useGitPrepareLeasedPush` and `useGitPublishLeasedPush` to `vi.mock("@/api/queries.js")`. `origin/main` wrapped the return values in `vi.fn(...)`.
  - HEAD added `toServerProjectTarget` to `vi.mock("@/api/client.js")`.
- **Resolution:**
  - Use the clean multiline `Link` mock from `origin/main`.
  - Use the `vi.fn(...)`-wrapped leased push hooks from `origin/main`.
  - Retain the `toServerProjectTarget` mock from HEAD.

#### 4. `packages/ui/src/components/PluginHostPage.tsx`
- **Conflict Cause:** HEAD added an early-return unavailable stub for Advisor; `origin/main` added multi-profile project resolution logic.
- **Resolution:**
  - **Delete the file completely:** `git rm packages/ui/src/components/PluginHostPage.tsx`.

#### 5. `packages/ui/src/components/PluginHostPage.test.tsx`
- **Conflict Cause:** HEAD updated tests for the unavailable state; `origin/main` added `describeView` mocking and routing assertions.
- **Resolution:**
  - **Delete the file completely:** `git rm packages/ui/src/components/PluginHostPage.test.tsx`.

#### 6. `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx`
- **Conflict Cause:**
  - HEAD added `// eslint-disable-next-line react-hooks/immutability` to `setLauncherElement`.
  - `origin/main` refactored `setLauncherElement` to handle both `internalLauncherRef` and `externalLauncherRef` (with the same eslint disable directive) and removed unused import `AdvisorSlotPlacementMode`.
- **Resolution:**
  - Take `origin/main`'s version entirely. It satisfies the lint rule and handles external ref synchronization cleanly.

#### 7. `packages/ui/src/plugins/use-plugin-host.ts`
- **Conflict Cause:**
  - HEAD wrapped `onUiIntentRef.current = onUiIntent;` in an unparameterized `useEffect` and added `/* eslint-disable react-hooks/refs */` around synchronous ref checks.
  - `origin/main` changed the import to `from "@/api/ownership.js"`, gave `onUiIntentRef` an explicit dependency `[onUiIntent]`, and migrated the owner-change session revocation into a proper `useEffect(..., [ownerKey])`, avoiding ESLint disable directives altogether.
- **Resolution:**
  - Take `origin/main`'s version. It is cleaner, properly obeys React hooks ESLint rules, and uses the canonical `@/api/ownership.js` module.

#### 8. `packages/ui/src/plugins/use-plugin-navigation.ts`
- **Conflict Cause:**
  - HEAD tightened `isAdvisorMetadata` to exact ID match `metadata.id === "evcrate.advisor"` and filtered out `evcrate.advisor` from navigation items (since Advisor is hosted in the Workspace UI).
  - `origin/main` reformatted code and migrated `toServerProjectTarget` import to `@/api/ownership.js`.
- **Resolution:**
  - Merge both changes:
    - Keep `import { toServerProjectTarget } from "@/api/ownership.js";` from `origin/main`.
    - Keep HEAD's strict `isAdvisorMetadata(metadata): metadata.id === "evcrate.advisor"`.
    - Keep HEAD's filters excluding `evcrate.advisor` from standalone navigation item lists (`meta.id !== "evcrate.advisor"`).

#### 9. `server/tests/plugin_api_integration.rs`
- **Conflict Cause:**
  In `test_describe_view_api_behavioral`:
  - HEAD added `"bob-view-user"` to `setup_test_mongo`.
  - `origin/main` pointed the test token to `"bob-new-user"`, which was already seeded in `setup_test_mongo`.
- **Resolution:**
  - Take `origin/main`'s change using `"bob-new-user"`. It avoids modifying the database fixture seeder and cleanly passes authentication.

---

## 5. Risk Factors and Precautions

| Risk Factor | Impact | Mitigation / Precaution |
|:---|:---|:---|
| **Stale Documentation Mentions** | Minor / Documentation debt | In `docs/frontend-components.md` (introduced by `origin/main`), lines 171–173 mention `PluginHostPage.tsx`. Post-merge, update this paragraph to reference `WorkspaceAdvisorHost.tsx` instead. |
| **TopNav Plugin Links Without Routes** | Minor / UX edge case | `use-plugin-navigation.ts` still builds `to: /plugins/${encodeURIComponent(metadata.id)}` for third-party plugins. Currently only `evcrate.advisor` exists (which is filtered out). If third-party plugins are introduced, either a generic plugin host route or a notification is required. |
| **Bookmark Breakage** | Expected / Acceptance requirement | Users with bookmarked `/plugins/evcrate.advisor` URLs will no longer see a dedicated "Plugin · Unavailable" screen. The requirement explicitly requested "no show unavailable for bookmark". |
| **Git Merge Conflict on Deleted Files** | Workflow | If `PluginHostPage.tsx` and `PluginHostPage.test.tsx` are deleted prior to merging, Git will flag `CONFLICT (modify/delete)`. Resolving via `git rm` confirms file deletion. |
| **Test Suite Alignment** | High / CI failure | Must ensure all tests previously covering `PluginHostPage` are completely deleted, and remaining suites (`WorkspaceAdvisorHost.test.tsx`, `use-plugin-navigation.test.tsx`, `project-worktree-target.browser.tsx`) pass cleanly with Vitest. |

---

## 6. Unresolved Questions

None. The exact conflict boundaries and routing mechanics have been verified across both branches.
