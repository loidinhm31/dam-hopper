# Code Review: Phase 05 Settings and Workspace Cutover

**Score: 6.5 / 10**

## Scope
- **Reviewed files:**
  - `packages/ui/src/hooks/use-advisor.ts`
  - `packages/ui/src/hooks/use-advisor.test.tsx`
  - `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx`
  - `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.test.tsx`
  - `packages/ui/src/components/pages/SettingsPage.tsx`
  - `packages/ui/src/components/pages/WorkspacePage.tsx`
  - `packages/ui/src/components/pages/WorkspacePage.test.tsx`
  - `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx`
  - `packages/ui/src/components/organisms/WorkspaceAdvisorHost.test.tsx`
  - `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx`
  - `packages/ui/browser-tests/workspace-advisor.browser.tsx`
  - `packages/ui/src/lib/workspace-advisor-placement.ts`
- **Lines analyzed:** ~1,850 LOC
- **Review focus:** Phase 05 per-server toggle, workspace placement, multi-profile isolation, admin gating, and browser DOM persistence.

---

## Critical Issues

1. **Test Suite Regression in `SettingsPage.test.tsx` (7/7 tests failing)**
   - **Problem:** `SettingsPage.tsx` was cut over from `PluginManagementSection` to `AdvisorSettingsSection`. `AdvisorSettingsSection` invokes TanStack Query hooks (`useAdvisorAuth`, `useAdvisorStatus`, `useAdvisorToggle`). However, `SettingsPage.test.tsx` still mocks the obsolete `PluginManagementSection` and renders `<SettingsPage />` without `<QueryClientProvider>` or an `AdvisorSettingsSection` mock.
   - **Impact:** `pnpm --filter @dam-hopper/ui exec vitest run src/components/pages/SettingsPage.test.tsx` fails with `Error: No QueryClient set, use QueryClientProvider to set one`.
   - **Fix:** Update `SettingsPage.test.tsx` to mock `AdvisorSettingsSection`:
     ```tsx
     vi.mock("@/components/pages/settings-page/AdvisorSettingsSection.js", () => ({
       AdvisorSettingsSection: () => <div data-testid="advisor-settings-section">AdvisorSettingsSection</div>,
     }));
     ```

2. **Multi-Profile Isolation Breach & Un-gated Network Calls in `useAdvisorAuth`**
   - **Problem:** `useAdvisorAuth` in `packages/ui/src/hooks/use-advisor.ts` lacks an `enabled` condition.
     - When `profileId` is undefined or null (such as when `workspaceOwner` is null in `WorkspacePage`), `snap` and `profile` are null, and `baseUrl` falls back to `getServerUrl()`.
     - When `effectiveProfileId` is provided for a server not yet present in client memory, it falls back to `getServerUrl()` (Profile 1) while sending Profile 2's token (`getAuthToken(effectiveProfileId)`), sending foreign credentials to Profile 1 and reporting Profile 1's role for Profile 2.
     - Even when completely disconnected, `useAdvisorVisibility` triggers background HTTP traffic to `/api/auth/status` on the ambient server every 30 seconds, violating the core acceptance requirement: *"disabled/non-admin absent everywhere and sends no data traffic"*.
   - **Fix:** Add `enabled?: boolean` option to `useAdvisorAuth`. Disable query when `effectiveProfileId` is missing or when `options?.enabled === false`. Disallow fallback to `getServerUrl()` when checking auth for a specific profile; if the profile URL cannot be resolved, return unauthenticated.

---

## Warnings (High & Medium Priority)

1. **Missing `useMemo` Dependency in `WorkspacePage.tsx` (High)**
   - **Problem:** In `WorkspacePage.tsx:1849`, `terminalContent` renders the floating panel shortcut button (`...(isAdvisorVisible ? [{ id: "advisor", label: "Advisor" }] : [])` at line 1528) and passes `activeProfileId` (line 1766). Neither `isAdvisorVisible` nor `activeProfileId` is in `terminalContent`'s `useMemo` dependency array.
   - **Impact:** When Advisor toggle state or auth status changes, the terminal shortcut strip fails to re-render until an unrelated dependency forces re-memoization.
   - **Fix:** Add `isAdvisorVisible` and `activeProfileId` to `terminalContent` dependencies at line 1849.

2. **Status Query Error Masquerades as "Disabled" (High)**
   - **Problem:** In `AdvisorSettingsSection.tsx`, when `statusError` occurs, `status` is undefined, causing `const isEnabled = status?.enabled ?? false;` to be `false`. The status badge displays `"Disabled"` (`isEnabled ? "Enabled" : "Disabled"`), and the toggle button remains enabled.
   - **Impact:** Directly violates requirement: *"Status error does not masquerade as disabled."* If a network or 503 error occurs, user clicking the toggle sends `updateSettings(true)` unexpectedly.
   - **Fix:** Render badge as `"Error"` or `"Unavailable"` when `statusError` is truthy, and disable toggle switch when `Boolean(statusError || !status)`.

3. **Unused Imports and Dead Code (Medium)**
   - `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx:27`: `project` prop in `WorkspaceAdvisorHostProps` is assigned but never used (vestige of legacy `PluginHost`).
   - `packages/ui/src/lib/workspace-advisor-placement.ts:1`: `import type { UiIntent } from "@/plugins/bridge-validators.js";` is unused.
   - `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx:8`: `getConnectionSnapshot` is imported but never used.
   - `packages/ui/browser-tests/workspace-advisor.browser.tsx:4`: `page` import from `@vitest/browser/context` is unused.

4. **Synchronous `setState` in `useLayoutEffect` (Medium)**
   - **Problem:** `WorkspaceAdvisorHost.tsx:40` calls `setGeometry(null)` synchronously in `useLayoutEffect` when `!activeSlot || !activeSlot.element || !activeSlot.visible`, triggering ESLint `react-hooks/set-state-in-effect` and cascading renders. Additionally, `activeSlot` is missing from the dependency array at line 84.

5. **`isAdvisorVisible` Omitted in Mode Switch Surface Resolvers (Medium)**
   - **Problem:** In `WorkspacePage.tsx:1157, 1177`, `setWorkspaceMode` and `toggleWorkspaceMode` invoke `getCompactSurfaceIds(mode)` without passing `isAdvisorVisible`. Because `getCompactSurfaceIds` defaults `isAdvisorVisible = true`, `requestedCompactSurface` temporarily retains `"advisor"` before `activeCompactSurface` normalizes it at line 480.

---

## Suggestions (Low Priority)

1. **Focus Restoration on Host Unmount (Low)**
   - In `WorkspaceAdvisorHost.tsx`, `useEffect` only listens to `[isVisible, placement?.launcherRef]`. If the host unmounts because Advisor is toggled off in settings or connection drops, focus drops to `document.body`. A cleanup function restoring focus to `launcherRef.current` if `containerRef.current.contains(document.activeElement)` improves accessibility.

---

## Positive Observations

1. **Owner-Bound Toggle Mutation & Atomic Invalidation:**
   - `useAdvisorToggle` captures `ConnectionRef` and intended boolean before mutation execution and invalidates only that owner's query keys (`advisorQueryKeys.status` and `advisorQueryKeys.profile`), preventing cross-server query invalidation.
2. **DOM Element Persistence Across Layout Modes:**
   - Playwright browser test (`workspace-advisor.browser.tsx`) verifies `<AdvisorPanel>` retains identical DOM element identity across IDE, Terminal, and Compact layout switches without re-mounting or losing internal state.
3. **Clean Teardown on Disable:**
   - When `isAdvisorVisible` flips to false, `WorkspaceAdvisorHost` completely unmounts, terminating queries and listeners immediately.
4. **Strong Typing:**
   - Strict TypeScript models across all hooks, slots, contexts, and API clients with zero `any` usage.

---

## Validation Commands & Results

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-advisor.test.tsx` | **PASS** (7/7 tests) | Hooks auth, status, visibility, toggle |
| `pnpm --filter @dam-hopper/ui exec vitest run src/components/pages/settings-page/AdvisorSettingsSection.test.tsx` | **PASS** (6/6 tests) | Settings section states & errors |
| `pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/WorkspaceAdvisorHost.test.tsx` | **PASS** (5/5 tests) | Offscreen placement, Escape, layout changes |
| `pnpm --filter @dam-hopper/ui exec vitest run src/components/pages/WorkspacePage.test.tsx` | **PASS** (29/29 tests) | Surface gating & rightTools filtering |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/workspace-advisor.browser.tsx` | **PASS** (2/2 tests) | Playwright Chromium persistence |
| `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) | **PASS** (0 errors) | Full UI type check clean |
| `pnpm --filter @dam-hopper/ui exec vitest run src/components/pages/SettingsPage.test.tsx` | **FAIL** (7/7 failed) | `No QueryClient set` regression |
| `pnpm exec eslint packages/ui/src/hooks/use-advisor.ts ...` | **WARNINGS** | Unused vars, missing hook deps |

---

## Unresolved Questions

1. In multi-profile setups where a target server profile is known but disconnected, should `useAdvisorAuth` strictly fail closed without attempting any HTTP requests, guaranteeing zero network traffic until connection is established?
2. When `statusError` is present in `AdvisorSettingsSection`, should the toggle button remain disabled until a successful refresh, or should an explicit retry action be embedded in the error banner?
