# Code Review Summary: Phase 02 — Unified Shell and Profile Migration

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
- Review focus: Phase 02 Unified shell, profile migration, connection isolation, type safety, build validity
- Updated plans: `plans/260916-2137-unified-profile/phase-02-unified-shell-and-profile-migration.md`

---

## Overall Assessment
Score: **5.5 / 10**

The architectural core of Phase 02 is well conceived: `ProfileAuthV2` endpoint-bound credential records prevent token leakage across endpoints; idempotent `fresh-state-reset` cleanly strips legacy keys without touching server data or saved profiles; `useWorkbenchSelectionsStore` preserves cached preference snapshots on source removal; and `ProjectSwitcher` uses deterministic tuple keys with no fallback.

However, the implementation suffered from incomplete refactoring in high-impact entry points:
1. `DashboardPage.tsx` has broken identifier references (`aliveSessions`, `projects`) that trigger immediate runtime `ReferenceError` crashes on the root route (`/`) and fail TypeScript compilation.
2. `apps/native/src/main.tsx` calls `initializeClientDiagnostics()` without importing it, causing `pnpm --filter @dam-hopper/native build` to fail.
3. `DamHopperApp` auto-login bypasses non-Windows native same-origin restrictions, generating prohibited network traffic to unsupported remote profiles.

Vitest suites passed (62 focused tests, 1,766 full suite) only because Vite/esbuild bypasses TypeScript checking and `DashboardPage.tsx` lacks test coverage.

---

## Critical Issues

### 1. `DashboardPage.tsx` Runtime Crash (`ReferenceError`) & Typecheck Failure
- **File**: `packages/ui/src/components/pages/DashboardPage.tsx:156, 291`
- **Impact**: Breaking runtime crash on root application route (`/`) and 17 compilation errors during `tsc --noEmit`.
- **Cause**:
  1. `const aliveSessions = sessions.filter((s) => s.alive);` was accidentally deleted during the refactor, but `aliveSessions` is referenced in lines 156, 161, 220, 226, 264, 337, 344. In browser runtime, accessing `aliveSessions` throws `ReferenceError: aliveSessions is not defined`.
  2. `projects` was renamed/replaced with `allProjects` on line 144 (`const { allProjects } = useAggregatedProjects();`), but lines 291, 300, 307, 324 still reference `projects.length` and `projects`.
  3. Lines 151-152 filter `p.project.status?.isClean`, but `ProjectConfig` does not define a `status` field.
- **Fix**:
  Restore `aliveSessions` definition, replace `projects` references with `totalProjects` / `allProjects`, and safely typecast or resolve `status`.

```tsx
// packages/ui/src/components/pages/DashboardPage.tsx
const { allProjects } = useAggregatedProjects();
const { data: sessions = [] } = useTerminalSessions();
const aliveSessions = sessions.filter((s) => s.alive); // RESTORE
const totalProjects = allProjects.length;

// For lines 291, 300, 307, 324:
{totalProjects > 0 && (
  ...
  style={{ width: `${(clean / totalProjects) * 100}%` }}
  ...
  <span>{totalProjects - clean - dirty}</span> unknown
)}
```

### 2. `apps/native/src/main.tsx` Missing Import Breaks Native Build
- **File**: `apps/native/src/main.tsx:95`
- **Impact**: `pnpm --filter @dam-hopper/native build` fails with `TS2304: Cannot find name 'initializeClientDiagnostics'`.
- **Cause**: Import was deleted during transport cleanup, but call remains on line 95.
- **Fix**:
```tsx
// apps/native/src/main.tsx
import { initializeClientDiagnostics } from "@dam-hopper/ui/diagnostics-client";
```

---

## High Priority Findings

### 3. Non-Windows Native Same-Origin Restriction Bypass
- **File**: `packages/ui/src/embed/dam-hopper-app.tsx:280-315` & `packages/ui/src/api/connections.ts:243-260`
- **Impact**: Security contract breach. Step 8 states:
  > *"Browser/Windows allow current HTTP(S) remote transport; non-Windows native stays exact same-origin-only. Unsupported profiles remain editable/listed and produce no fallback traffic."*
- **Problem**:
  `apps/native/src/main.tsx` checks `isProfileSupportedOnNative(profile)` before auto-connecting. However, when `DamHopperApp` mounts, its `useEffect` calls `readServerProfiles()` and iterates over all profiles:
  - If `profile.authType === "none"`, it performs an unconstrained `fetch(`${profile.url}/api/auth/login`)`.
  - It then calls `connectProfile(profile.id)`.
  - `connections.ts` `performConnectProfile` only validates URL scheme (`http:`/`https:`) and does not check native host platform or `isSameOriginProfile(profile)`. It attempts HTTP fetch and WebSocket connection even for unsupported profiles.
- **Fix**:
  1. Add `isSameOriginProfile(profile)` check in `DamHopperApp` before auto-login/auto-connect.
  2. In `connections.ts:performConnectProfile`, mark unsupported profiles immediately with `{ status: "unsupported", intent: false }` without making network calls when on non-Windows native and URL origin is cross-origin.

---

## Medium Priority Improvements

### 4. Unstable Dependency & `localStorage` Thrashing in `useAggregatedProjects`
- **File**: `packages/ui/src/hooks/use-aggregated-projects.ts:45, 54-72`
- **Problem**:
  `const profiles = getProfiles();` is executed on every component render. Because `getProfiles()` parses `localStorage` each time, it creates a new array reference every render.
  Line 54: `useMemo(() => { ... }, [profiles])` depends on `[profiles]`, causing `querySpecs` to be recreated on every single render, defeating memoization and triggering TanStack Query comparisons.
  The same pattern exists in `TopNavConnectionButton.tsx:43-50`.
- **Fix**:
  Use `getProfileChangeVersion()` or subscribe `profiles` via `useSyncExternalStore` so that the array reference only changes when profiles are created, updated, or removed.

### 5. Duplicated Connection Bootstrapping
- **File**: `apps/web/src/main.tsx:40-45`, `apps/native/src/main.tsx:102-107`, `packages/ui/src/embed/dam-hopper-app.tsx:273-322`
- **Problem**:
  Profiles are iterated and connected in `main.tsx` right before React renders, and then `DamHopperApp` mounts and iterates over the same profiles to auto-login and connect again.
- **Fix**:
  Consolidate profile bootstrapping into a single shared helper, ensuring native restrictions and no-auth auto-logins are handled cohesively in one place.

---

## Low Priority Suggestions

### 6. Leftover Dead Code and Unused Variables
- `packages/ui/src/embed/dam-hopper-app.tsx`:
  - `const qc = useQueryClient();` (line 243) — unused.
  - `const activeProfile = useServerProfile();` (line 244) — unused.
  - `activeProfileId`, `activeProfileUrl`, and `activeProfileConnectionKey` (lines 249–256) — leftover from removed transport switch code; completely unused.
- `packages/ui/src/lib/fresh-state-reset.ts`:
  - `const PRESERVED_PREFIXES = [...]` (lines 15–28) is declared but never referenced in any function.
- `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`:
  - Add `subscribeToProfileChanges` subscription so dialog dynamically updates if another tab edits/deletes profiles.

---

## Positive Observations
- **Endpoint-Bound Credentials (`ProfileAuthV2`)**: `setAuthToken` and `getAuthToken` verify `serverUrl` and `authType` match the profile before returning credentials. If a profile URL is edited, the old bearer token is never sent to the new host.
- **Deterministic Navigation State**: `stores/workspace.ts` stores qualified `ProjectRef | null` and persists only `selectedProject`, dropping legacy `dam-hopper:active-project`.
- **ProjectSwitcher Tuple Keys**: `projectKey` / `parseProjectKey` tuple encoding prevents collision between projects with the same name across different servers.
- **Fresh Reset Safety**: `performFreshStateReset` specifically removes legacy unowned and obsolete version keys while preserving profiles, auth v2 records, and theme settings.
- **Comprehensive Unit Tests**: `server-config.test.ts`, `workbench-selections.test.ts`, `fresh-state-reset.test.ts`, and `phase-02-unified-shell.test.tsx` thoroughly test edge cases including migration and storage unavailability.

---

## Recommended Actions

1. **Fix `DashboardPage.tsx`**:
   - Restore `const aliveSessions = sessions.filter((s) => s.alive);`.
   - Replace `projects` references with `totalProjects`.
   - Cast status access: `(p.project as unknown as { status?: { isClean?: boolean } }).status?.isClean`.
2. **Fix `apps/native/src/main.tsx`**:
   - Add `import { initializeClientDiagnostics } from "@dam-hopper/ui/diagnostics-client";`.
3. **Enforce Native Origin Guard in `DamHopperApp` & `connections.ts`**:
   - Guard `bootstrapProfiles()` and `performConnectProfile()` with `isSameOriginProfile(profile)`.
4. **Clean up Dead Variables**:
   - Remove `qc`, `activeProfile`, and `activeProfileConnectionKey` from `DamHopperApp`.
   - Remove unused `PRESERVED_PREFIXES` in `fresh-state-reset.ts`.
5. **Add Regression Test for `DashboardPage.tsx`**:
   - Create `packages/ui/src/components/pages/DashboardPage.test.tsx` to ensure root page renders without runtime exceptions.

---

## Metrics
- **Type Coverage / Compiler**: 18 errors in `tsc --noEmit` across `packages/ui` and `apps/native`.
- **Build Status**:
  - `pnpm --filter @dam-hopper/web build`: Succeeded (Vite skips typecheck).
  - `pnpm --filter @dam-hopper/native build`: **FAILED** (exit code 2 due to `tsc` error).
- **Test Suite**:
  - Focused: 62/62 passing across 7 test files.
  - Full suite: 1,766/1,766 passing in Vitest (did not catch runtime errors due to missing component test).

---

## Unresolved Questions
1. Should `ProjectConfig` in `@dam-hopper/ui/api/client.ts` formally include an optional `status?: GitStatus` property, or should `DashboardPage` query project status via `useProjectStatus` per project target?
