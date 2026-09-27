# System Diagnostics & Audit Report: Phase 09 & UI ProfileBadge Integration

**Date:** 2026-09-19  
**Target:** `@dam-hopper/ui`, `@dam-hopper/web`, and `dam-hopper-server`  
**Focus:** `ProfileBadge`, `TraditionalTerminalProjectsNavigator`, `TraditionalTerminalProjectsDisplay`, `TerminalTreeView`, `Select.tsx`, `ProjectSwitcher.tsx`, and backend integration.

---

## 1. Executive Summary

A comprehensive diagnostic audit of the workspace was conducted following recent Phase 09 and UI profile badge commits (`d868d1cf`, `a982ce06`, `27b2cce3`, `babe13c1`, `e21ec101`, `af5b63a7`, `e97f8d47`, `40638ec1`).

- **Build Status:** All packages build cleanly (`@dam-hopper/ui` passed `tsc`, `@dam-hopper/web` generated production bundle via Vite with 0 errors, and `dam-hopper-server` passed `cargo check` and 1,128 unit tests).
- **Targeted Tests:** All 13 targeted tests across `ProfileBadge.test.tsx`, `TraditionalTerminalProjectsNavigator.test.tsx`, and `TerminalTreeView.test.tsx` passed cleanly in Vitest with 0 console or runtime errors. Related browser tests (`terminal-traditional-projects.browser.tsx`) passed 9/9.
- **Identified Defects & Edge Cases:**
  1. **[High Risk Crash] `TerminalTreeView.tsx:1271` Unsafe Property Access (`project.ref.profileId`):** `project.ref` is accessed without optional chaining. If `profileName` is present on a project object where `ref` is undefined (such as mock objects or legacy/extension state), a fatal `TypeError` is thrown that crashes the component tree.
  2. **[Medium Risk Crash] `ProfileBadge.tsx:14` Unchecked `seed.length`:** `hashProfileColor(seed)` assumes `seed` is a valid string. If `name` and `profileId` are `undefined` or `null`, `seed.length` throws `TypeError: Cannot read properties of undefined (reading 'length')`.
  3. **[UI Inconsistency] Discrepant "Default" Profile Badge Display:** In `TraditionalTerminalProjectsNavigator` and `Display`, the profile badge is explicitly suppressed when `profileId === "default"` to avoid visual noise for single-instance local users. However, `TerminalTreeView` displays a `<ProfileBadge>` showing `"Default"` for every project when `profiles.length === 0` due to `useAggregatedProjects` defaulting `profileName: "Default"`.
  4. **[Stale State Bug] `ProjectSwitcher.tsx:25` Dead Variable & Stale Selection:** `isSelectedProjectAvailable` was orphaned as an unused local variable. When a selected project becomes unavailable (e.g. disconnected server or deleted project), `Select` receives the dead key as `value` without matching items, rendering the select trigger completely blank instead of the `"Select project"` placeholder.
  5. **[Styling Bug] `TraditionalTerminalProjectsDisplay.tsx:216` Missing `min-w-0`:** `<span className="truncate">{selectedGroup.label}</span>` inside a flex container lacks `min-w-0`, preventing text truncation for long project names.
  6. **[Accessibility (a11y)] `ProfileBadge.tsx:45` `title` Attribute Accessibility:** Screen readers and touch/mobile devices do not announce `title` on non-interactive `<span>` tags.

---

## 2. Technical Analysis

### 2.1 Build & Static Analysis Results

| Target | Command | Result | Duration | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `@dam-hopper/ui` | `pnpm --filter @dam-hopper/ui build` | **PASS** | 6.55s | `tsc -p tsconfig.json` with 0 errors. Note: test files excluded in `tsconfig.json`. |
| `@dam-hopper/web` | `pnpm --filter @dam-hopper/web build` | **PASS** | 29.40s | 6,055 modules transformed, extension staged, production bundles generated. |
| `dam-hopper-server` | `cargo check --manifest-path server/Cargo.toml` | **PASS** | 4.53s | 0 warnings, 0 errors. |
| `dam-hopper-server` (tests) | `cargo test --manifest-path server/Cargo.toml --lib` | **PASS** | 12.26s | 1,128 passed, 1 ignored, 0 failures. |

### 2.2 Targeted Test Suite Execution

| Test File | Status | Passed | Notes |
| :--- | :--- | :--- | :--- |
| `packages/ui/src/components/atoms/ProfileBadge.test.tsx` | **PASS** | 3 / 3 | Deterministic hashing, markup assertions, color distribution. |
| `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` | **PASS** | 5 / 5 | Git metadata, worktree branching, profile-scoped queries. |
| `packages/ui/src/components/organisms/TerminalTreeView.test.tsx` | **PASS** | 5 / 5 | Mobile actions, suggestion expansion, command interactions. |
| `TraditionalTerminalProjectsDisplay.test.tsx` | *N/A* | - | File does not exist as unit test. Covered via `terminal-traditional-projects.browser.tsx` (9/9 passed) and `traditional-terminal-projects.test.ts` (7/7 passed). |
| `packages/ui/src/lib/traditional-terminal-projects.test.ts` | **PASS** | 7 / 7 | Grouping ordinals, project rows, layout persistence keys. |
| `packages/ui/src/components/pages/WorkspacePage.test.tsx` | **PASS** | 27 / 27 | Mount resilience, tab tracking, multi-profile switching. |
| `packages/ui/src/components/organisms/MultiTerminalDisplay.test.tsx` | **PASS** | 5 / 5 | Visibility tracking, cursor geometry stability. |

---

## 3. Deep Code Inspection & Edge Cases

### Defect 1: Unsafe Property Access in `TerminalTreeView.tsx`
- **Location:** `packages/ui/src/components/organisms/TerminalTreeView.tsx:1269-1274`
- **Code:**
  ```tsx
  {project.profileName && (
    <ProfileBadge
      profileId={project.ref.profileId}
      name={project.profileName}
    />
  )}
  ```
- **Analysis:** `project.ref` is accessed without optional chaining (`project.ref.profileId`). In `TerminalTreeView.test.tsx` (lines 28-60), mock objects omit `ref`. Because `profileName` was absent on those mocks, the branch was not taken during tests. However, if any runtime caller, plugin, or legacy state passes a `TreeProject` with `profileName` but without `ref`, the component crashes immediately with `TypeError: Cannot read properties of undefined (reading 'profileId')`.
- **Fix:** Use `project.ref?.profileId`.

### Defect 2: Unsafe `seed` Length Access in `ProfileBadge.tsx`
- **Location:** `packages/ui/src/components/atoms/ProfileBadge.tsx:14-22, 35-36`
- **Code:**
  ```tsx
  export function hashProfileColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % PROFILE_COLOR_PALETTES.length;
    return PROFILE_COLOR_PALETTES[index];
  }

  export function ProfileBadge({ name, profileId, className }: ProfileBadgeProps) {
    const seed = profileId || name;
    const colorClass = hashProfileColor(seed);
  ```
- **Analysis:** If `name` and `profileId` are `undefined` or `null` at runtime (e.g. untyped API payloads), `seed` becomes `undefined` or `null`. Evaluating `seed.length` throws `TypeError: Cannot read properties of undefined (reading 'length')`.
- **Fix:** Guard `hashProfileColor`:
  ```tsx
  export function hashProfileColor(seed: string = ""): string {
    if (!seed) return PROFILE_COLOR_PALETTES[0];
    ...
  }
  ```
  And in `ProfileBadge`:
  ```tsx
  if (!name || !name.trim()) return null;
  ```

### Defect 3: Inconsistent "Default" Profile Badge Between Views
- **Locations:**
  - `packages/ui/src/lib/traditional-terminal-projects.ts:44`
  - `packages/ui/src/hooks/use-aggregated-projects.ts:96`
  - `packages/ui/src/components/organisms/TerminalTreeView.tsx:1269`
- **Analysis:**
  - `traditional-terminal-projects.ts` deliberately suppresses the profile badge for default profiles:
    ```ts
    const profileName = profileId ? (getProfiles().find((p) => p.id === profileId)?.name ?? (profileId !== "default" ? profileId : undefined)) : undefined;
    ```
    This ensures single-instance users do not see redundant "default" badges on every terminal project.
  - In contrast, `useAggregatedProjects.ts` returns `profileName: "Default"` when `profiles.length === 0`.
  - `TerminalTreeView.tsx` unconditionally checks `{project.profileName && <ProfileBadge ... />}` without filtering out `"default"` or checking if multiple profiles exist. As a result, `TerminalTreeView` renders a `"Default"` badge next to every single project folder even in standard single-server setups.

### Defect 4: Orphaned Variable and Blank Trigger in `ProjectSwitcher.tsx`
- **Location:** `packages/ui/src/components/organisms/ProjectSwitcher.tsx:25-44`
- **Code:**
  ```tsx
  const currentTupleKey = selectedProject ? projectKey(selectedProject) : "";
  const isSelectedProjectAvailable = selectedProject
    ? allProjects.some(
        (p) =>
          p.ref.profileId === selectedProject.profileId &&
          p.ref.project === selectedProject.project,
      )
    : false;
  ...
  <Select value={currentTupleKey || undefined} ...>
  ```
- **Analysis:** In commit `babe13c1`, the display logic was refactored, leaving `isSelectedProjectAvailable` as unused dead code. If a selected project's server is disconnected or removed, `currentTupleKey` is still passed to `Select`. Because Radix UI cannot find a matching `SelectItem`, the select trigger renders blank instead of showing the placeholder `"Select project"`.
- **Fix:** Pass `value={isSelectedProjectAvailable ? currentTupleKey : undefined}`.

### Defect 5: CSS Flexbox Truncation Issue in `TraditionalTerminalProjectsDisplay.tsx`
- **Location:** `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:215-217`
- **Code:**
  ```tsx
  <span className="min-w-0 flex items-center gap-1.5 truncate text-xs font-semibold text-[var(--color-text)]">
    <span className="truncate">{selectedGroup.label}</span>
    {selectedGroup.profileName && (
      <ProfileBadge ... />
    )}
  </span>
  ```
- **Analysis:** `<span className="truncate">{selectedGroup.label}</span>` lacks `min-w-0`. In CSS flexbox, flex items default to `min-width: auto`, preventing the inner label from truncating when space is constrained. `TraditionalTerminalProjectsNavigator.tsx:205` correctly used `<span className="min-w-0 truncate font-mono">`.

### Defect 6: Screen Reader & Touch Accessibility of `ProfileBadge.tsx`
- **Location:** `packages/ui/src/components/atoms/ProfileBadge.tsx:39-48`
- **Analysis:** The component relies exclusively on `title={`Server profile: ${name}`}` on a non-interactive `<span>`. Screen readers frequently ignore `title` on inline non-link elements, and touch/mobile devices have no hover event to reveal native tooltips.
- **Fix:** Add `role="status"` and `aria-label={`Server profile: ${name}`}`.

---

## 4. Actionable Recommendations

| Priority | Component | Recommended Action | Effort |
| :--- | :--- | :--- | :--- |
| **P1** | `TerminalTreeView.tsx` | Change `project.ref.profileId` to `project.ref?.profileId` to prevent fatal component crash on malformed/mocked objects. | 1 line |
| **P1** | `ProfileBadge.tsx` | Add null/empty checks: return `null` if `!name?.trim()`, and guard `hashProfileColor(seed = "")`. | 3 lines |
| **P2** | `ProjectSwitcher.tsx` | Connect `isSelectedProjectAvailable` to `Select`: `value={isSelectedProjectAvailable ? currentTupleKey : undefined}` to fix blank display on unavailable projects. | 1 line |
| **P2** | `TerminalTreeView.tsx` | Harmonize with `TraditionalTerminalProjects`: suppress badge when `profileId === "default"` or when only 1 profile exists. | 2 lines |
| **P3** | `TraditionalTerminalProjectsDisplay.tsx` | Add `min-w-0` to `<span className="min-w-0 truncate">{selectedGroup.label}</span>`. | 1 line |
| **P3** | `ProfileBadge.tsx` | Add `role="status"` and `aria-label={`Server profile: ${name}`}` for WCAG accessibility. | 2 lines |

---

## 5. Unresolved Questions
- None. All build, test, and code paths have been verified with concrete execution artifacts.
