# Code Review Summary: Phase 02 — Unified Shell and Profile Migration (Cycle 2)

## Scope
- Files reviewed:
  - `packages/ui/src/api/server-config.ts`
  - `packages/ui/src/api/server-config.test.ts`
  - `packages/ui/src/embed/dam-hopper-app.tsx`
  - `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`
  - `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`
  - `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`
  - `packages/ui/src/components/organisms/ProjectSwitcher.tsx`
  - `packages/ui/src/components/organisms/TopNavUtilityStrip.tsx`
  - `packages/ui/src/components/molecules/TopNavBrand.tsx`
  - `packages/ui/src/components/molecules/TopNavConnectionButton.tsx`
  - `packages/ui/src/components/pages/DashboardPage.tsx`
  - `packages/ui/src/stores/workspace.ts`
  - `packages/ui/src/stores/workbench-selections.ts`
  - `packages/ui/src/stores/workbench-selections.test.ts`
  - `packages/ui/src/hooks/use-aggregated-projects.ts`
  - `packages/ui/src/lib/fresh-state-reset.ts`
  - `packages/ui/src/lib/fresh-state-reset.test.ts`
  - `packages/ui/src/api/phase-02-unified-shell.test.tsx`
  - `packages/ui/src/api/ownership.ts`
  - `packages/ui/src/components/organisms/TopNav.test.tsx`
  - `apps/web/src/main.tsx`
  - `apps/native/src/main.tsx`
  - `apps/native/src/native-server-url.ts`
  - `apps/native/src/native-server-url.test.ts`
- Lines of code analyzed: ~3,200 LOC
- Review focus: Phase 02 Unified shell, profile migration, connection isolation, type safety, native platform restriction enforcement, build validity
- Updated plans: `plans/260916-2137-unified-profile/phase-02-unified-shell-and-profile-migration.md`

---

## Overall Assessment
Score: **7.5 / 10**

Cycle 2 re-review confirms that the compilation and runtime crash blockers identified in Cycle 1 have been successfully remediated:
1. `DashboardPage.tsx` runtime `ReferenceError` crashes and typecheck failures are fixed (`aliveSessions`, `projects`, `totalProjects` defined; safe status casting).
2. `apps/native/src/main.tsx` missing `initializeClientDiagnostics` import restored.
3. Both `@dam-hopper/ui` (`tsc -p tsconfig.json`), `@dam-hopper/native` (native build including `tsc`), and `@dam-hopper/web` compile with zero errors.
4. Vitest suites (108 focused tests, 1,766 full suite) pass cleanly.

However, **Remediation Item 3 (Non-Windows Native Same-Origin Restriction Bypass)** remains **unresolved** in `DamHopperApp` (`dam-hopper-app.tsx:280-315`) and `connections.ts`:
On non-Windows native platforms (Linux, macOS, Android, iOS), `DamHopperApp` continues to iterate through remote cross-origin profiles and trigger unauthorized auto-login HTTP fetches and WebSocket connection attempts, violating the Step 8 security specification.

---

## Critical Issues
None currently causing build failures or root-route runtime crashes (Cycle 1 Critical Issues #1 and #2 have been verified fixed).

---

## High Priority Findings / Warnings

### 1. Non-Windows Native Same-Origin Restriction Bypass (Unresolved from Cycle 1)
- **Files**: `packages/ui/src/embed/dam-hopper-app.tsx:280-315` & `packages/ui/src/api/connections.ts:229-285`
- **Impact**: Security contract breach. Step 8 states:
  > *"Browser/Windows allow current HTTP(S) remote transport; non-Windows native stays exact same-origin-only. Unsupported profiles remain editable/listed and produce no fallback traffic."*
- **Problem**:
  While `apps/native/src/main.tsx` checks `isProfileSupportedOnNative(profile)` before auto-connecting on entry, when `DamHopperApp` mounts, its `bootstrapProfiles()` effect executes:
  ```tsx
  for (const profile of profilesResult.profiles) {
    if (profile.autoConnect === false) continue;
    if (profile.authType === "none" && !getAuthToken(profile.id)) {
      // Unconstrained fetch to remote URL on non-Windows native
      const res = await fetch(`${profile.url}/api/auth/login`, ...);
    }
    void connectProfile(profile.id);
  }
  ```
  `performConnectProfile()` in `connections.ts` does not check platform origin support either; it initiates HTTP `/api/status` requests and opens WebSocket connections to cross-origin targets on non-Windows native.
- **Remediation**:
  1. Export `isSameOriginProfile(profile: ServerProfile): boolean` from `packages/ui/src/api/server-config.ts`.
  2. In `packages/ui/src/embed/dam-hopper-app.tsx`, guard the `bootstrapProfiles` loop:
     ```tsx
     if (!isSameOriginProfile(profile)) continue;
     ```
  3. In `packages/ui/src/api/connections.ts:performConnectProfile`:
     ```tsx
     if (!isSameOriginProfile(profile)) {
       const entry = getOrCreateEntry(profileId, cleanUrl);
       clearReconnectTimer(entry);
       entry.generation += 1;
       updateSnapshot(profileId, {
         status: "unsupported",
         intent: false,
         serverUrl: profile.url,
         error: "Remote connections are not supported on this native host. Only same-origin connections are allowed.",
       });
       return;
     }
     ```

---

## Medium Priority Improvements

### 2. Unstable `profiles` Reference & `localStorage` Thrashing in `useAggregatedProjects`
- **Files**: `packages/ui/src/hooks/use-aggregated-projects.ts:45, 54-72`, `packages/ui/src/components/molecules/TopNavConnectionButton.tsx:43`
- **Problem**:
  `const profiles = getProfiles();` executes on every render. Because `getProfiles()` reads and parses `localStorage` every time, it returns a new array reference on each component render.
  In `useAggregatedProjects.ts`, `useMemo(() => ..., [profiles])` on line 72 and line 117 re-evaluates on every render, invalidating TanStack query specifications and defeating memoization.
- **Fix**:
  Memoize `profiles` against profile version:
  ```tsx
  const version = useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );
  const profiles = useMemo(() => getProfiles(), [version]);
  ```

### 3. Duplicated Connection Bootstrapping
- **Files**: `apps/web/src/main.tsx:40-45`, `apps/native/src/main.tsx:103-108`, `packages/ui/src/embed/dam-hopper-app.tsx:273-322`
- **Problem**:
  Both `apps/web/src/main.tsx` and `apps/native/src/main.tsx` iterate over profiles and call `connectProfile(profile.id)` prior to rendering. When `DamHopperApp` mounts, it runs its own `bootstrapProfiles()` effect and calls `connectProfile(profile.id)` a second time for the exact same profiles.
- **Fix**:
  Consolidate profile connection orchestration to prevent redundant double-triggering during application startup.

---

## Low Priority Suggestions

### 4. Unused `PRESERVED_PREFIXES` in `fresh-state-reset.ts`
- **File**: `packages/ui/src/lib/fresh-state-reset.ts:15-28`
- **Observation**: `const PRESERVED_PREFIXES = [...]` is declared but never referenced. `isLegacyResourceKey` uses specific key checks. Remove the unused constant or use it to validate preserved keys.

### 5. Cross-Tab Profile Sync in `ServerProfilesDialog.tsx`
- **File**: `packages/ui/src/components/organisms/ServerProfilesDialog.tsx:102-107`
- **Observation**: `ServerProfilesDialog` subscribes to `subscribeConnections`, but not to `subscribeToProfileChanges`. If another browser tab creates, updates, or deletes a profile, the dialog list does not immediately re-render until an action or connection event occurs.

---

## Positive Observations
1. **Compilation & Type Safety**: `tsc -p tsconfig.json` in `@dam-hopper/ui` passes with 0 errors. Native and web production builds succeed with 0 errors.
2. **Endpoint-Bound Credentials (`ProfileAuthV2`)**: `getAuthToken` and `setAuthToken` verify URL and `authType` coherence, preventing token leakage when server URLs are modified.
3. **Deterministic Navigation Architecture**: `stores/workspace.ts` stores qualified `ProjectRef | null` and persists only `selectedProject`, discarding legacy `dam-hopper:active-project`.
4. **Disambiguated Tuple Keys**: `ProjectSwitcher` correctly groups by profile and encodes selections via deterministic tuple keys (`projectKey` / `parseProjectKey`), preventing collisions across servers.
5. **Fresh Reset Safety**: `performFreshStateReset` cleans up legacy stores and sets upgrade notifications without calling `localStorage.clear()` or deleting user profiles.
6. **Robust Test Suite**: 108 focused unit and integration tests across 13 test files passing in < 2.5s.

---

## Validation Commands and Results

| Command | Target | Result | Notes |
|---|---|---|---|
| `pnpm --filter @dam-hopper/ui build` | `@dam-hopper/ui` | **PASSED** (0 errors) | `tsc -p tsconfig.json` clean |
| `pnpm --filter @dam-hopper/native build` | `@dam-hopper/native` | **PASSED** (0 errors) | Native app compiled and bundled |
| `pnpm --filter @dam-hopper/web build` | `@dam-hopper/web` | **PASSED** (0 errors) | Web production bundle built |
| `pnpm --filter @dam-hopper/ui test run ...` | Focused UI tests (12 files) | **PASSED** (106/106) | All unit & integration tests pass |
| `pnpm --filter @dam-hopper/native test run ...` | Native URL tests (1 file) | **PASSED** (2/2) | Platform origin checks pass |
| Full monorepo Vitest suite | Monorepo | **PASSED** (1,766/1,766) | Zero test regressions |

---

## Recommended Actions
1. **Export `isSameOriginProfile`** from `packages/ui/src/api/server-config.ts`.
2. **Enforce `isSameOriginProfile`** in `packages/ui/src/embed/dam-hopper-app.tsx` inside `bootstrapProfiles` to block remote auto-logins on non-Windows native.
3. **Enforce `isSameOriginProfile`** in `packages/ui/src/api/connections.ts:performConnectProfile` to immediately mark cross-origin profiles as `unsupported` without network activity on non-Windows native hosts.
4. **Memoize `profiles`** in `useAggregatedProjects.ts` to prevent render thrashing and query specification churn.
5. **Remove dead constant `PRESERVED_PREFIXES`** in `fresh-state-reset.ts`.

---

## Unresolved Questions
1. When non-Windows native users configure an unsupported remote profile, should the UI provide an inline notice badge on the profile card explaining that remote connections are supported only on Browser and Windows desktop?
2. Should `DamHopperApp` completely delegate profile connection bootstrapping to the entry points (`apps/web/src/main.tsx` and `apps/native/src/main.tsx`), or should the entry points delegate entirely to `DamHopperApp`?
