# Diagnostic Report: Top Navigation Plugin Page References & Dead Route Root Cause Analysis

**Report Date:** 2026-10-01  
**Author:** DebuggerPluginNav (Senior Software Engineer)  
**File Target:** `plans/reports/debugger-261001-1011-plugin-navigation-dead-links.md`  
**Classification:** Incident Investigation & Clean Cutover Analysis  

---

## 1. Executive Summary

### Issue Description
Following the complete removal of the standalone `PluginHostPage.tsx` and the `/plugins/:installationId` route (commit `6a73637b`), top navigation still references plugin pages and dynamically renders links pointing to `/plugins/:id` when non-advisor plugins are installed. Clicking these navigation links navigates to nonexistent routes, rendering an empty route viewport inside `dam-hopper-app.tsx`.

### Root Cause Identification
Incomplete cutover during standalone plugin host removal. When EVCrate Advisor was migrated into the workspace dock/float (`WorkspaceAdvisorHost.tsx`, commit `4542075a`), `use-plugin-navigation.ts` excluded `evcrate.advisor` but preserved discovery and route generation for "ordinary/third-party" plugins under the assumption that `PluginHostPage` would host them. In commit `6a73637b`, `PluginHostPage.tsx`, its test suite, and the `/plugins/:installationId` route in `dam-hopper-app.tsx` were excised, but:
1. `TopNavRouteMenu.tsx` still calls `usePluginNavigation(project)` and passes `pluginEntries` to `getNavEntries`.
2. `navigation.ts` still splices `pluginEntries` into the primary navigation array before `SETTINGS`.
3. `use-plugin-navigation.ts` still discovers plugins and builds links with `to: /plugins/:id`.
4. Code review `code-review-260930-1400` previously flagged this inconsistency but dismissed it as YAGNI because only `evcrate.advisor` existed at that moment.

### Recommended Fix Priority
- **P0 (Critical / Clean Cutover):** Remove `pluginEntries` from `TopNavRouteMenu.tsx` and `navigation.ts`. Stop rendering dead `/plugins/:id` links in primary and mobile navigation.
- **P1 (Dead Code Elimination):** Extract `parsePluginMetadata` (used by `use-plugin-host.ts`) into a standalone metadata validator module or `packages/ui/src/plugins/plugin-document.ts`. Deprecate or delete `use-plugin-navigation.ts` and its obsolete tests.
- **P2 (Test & Doc Hygiene):** Remove obsolete `usePluginNavigation` mocks from `ssh-forward-availability.browser.tsx` and `usage-page.browser.tsx`. Correct stale claims in `docs/user-guide-multi-server-profiles.md` and `docs/frontend-components.md`.

---

## 2. Technical Analysis

### Commit Sequence & Evolution Timeline
- **`d27702e1` (2026-09-22):** Introduced standalone `PluginHostPage.tsx`, `/plugins/:installationId` route in `dam-hopper-app.tsx`, `use-plugin-navigation.ts`, and injected `pluginEntries` into `TopNavRouteMenu.tsx` / `navigation.ts`.
- **`4542075a` (2026-09-30):** Integrated EVCrate Advisor into Workspace (`WorkspaceAdvisorHost.tsx`). Specifically excluded `evcrate.advisor` from `use-plugin-navigation.ts`, but left generic plugin discovery and navigation intact for third-party plugins.
- **`6a73637b` (2026-09-30):** Excised `PluginHostPage.tsx`, `PluginHostPage.test.tsx`, and the `<Route path="/plugins/:installationId">` element from `dam-hopper-app.tsx`. Failed to excise `TopNavRouteMenu.tsx` integration or `use-plugin-navigation.ts`.
- **`code-review-260930-1400` (2026-09-30):** Section "Medium Priority Improvements" noted: `use-plugin-navigation.ts:314` builds `to: /plugins/:id` without matching route in `dam-hopper-app.tsx`, but marked it out-of-scope / YAGNI.

### Execution Path Leading to Dead Links
```
[User App Load]
   │
   ├──> TopNav.tsx renders TopNavRouteMenu.tsx
   │       │
   │       ├──> useWorkspaceStore.selectedProject
   │       ├──> usePluginNavigation(project)
   │       │       ├──> Queries Settings Server plugins (api.plugins.list)
   │       │       ├──> Queries Workspace Server plugins (api.plugins.list)
   │       │       ├──> Filters out meta.id === "evcrate.advisor"
   │       │       └──> Maps remaining plugins via pluginNavigationItem():
   │       │               to: `/plugins/${encodeURIComponent(metadata.id)}`
   │       │
   │       └──> getNavEntries({ sshForwardHostAvailable, pluginEntries })
   │               └──> Splices plugin entries into BASE_NAV before SETTINGS
   │
   ├──> TopNavRouteMenu renders <TopNavRouteLink entry={entry} />
   │       └──> Desktop nav bar: renders <Link to="/plugins/:id" />
   │       └──> Mobile compact nav: renders <Link to="/plugins/:id" />
   │
   └──> User clicks plugin tab:
           └──> React Router v6 matches URL `/plugins/:id` against `dam-hopper-app.tsx` <Routes>
           └──> NO MATCHING ROUTE (Route was deleted in 6a73637b)
           └──> Result: Route outlet renders null / blank page. Broken UX.
```

---

## 3. Code References and Affected Files

### Production Code

#### 1. `packages/ui/src/components/organisms/TopNavRouteMenu.tsx`
- **Lines 1–2:** Imports `Puzzle` icon and `usePluginNavigation`.
- **Line 7:** Imports `useWorkspaceStore` solely for `state.selectedProject`.
- **Lines 23–24:** Evaluates `selectedProject` and executes `usePluginNavigation(project)`.
- **Lines 28–32:** Maps `pluginNavigation.items` into `pluginEntries` with `{ to: item.to, icon: Puzzle, label: item.label }`.
- **Lines 37–41:** Renders accessibility status for `pluginNavigation.error`.
- **Lines 52–60 & 68–80:** Iterates over `navEntries` to render `<TopNavRouteLink>` for both desktop menu and compact mobile grid.

#### 2. `packages/ui/src/lib/navigation.ts`
- **Lines 33–46:**
  ```ts
  export function getNavEntries({
    sshForwardHostAvailable,
    pluginEntries = [],
  }: {
    sshForwardHostAvailable: boolean;
    pluginEntries?: NavEntry[];
  }): NavEntry[] {
    if (pluginEntries.length === 0) {
      return sshForwardHostAvailable ? [...BASE_NAV, SSH_FORWARD_NAV] : BASE_NAV;
    }
    const settings = BASE_NAV.at(-1)!;
    const entries = [...BASE_NAV.slice(0, -1), ...pluginEntries, settings];
    return sshForwardHostAvailable ? [...entries, SSH_FORWARD_NAV] : entries;
  }
  ```
  `pluginEntries` parameter and array slicing logic are solely used for injecting plugin tabs.

#### 3. `packages/ui/src/plugins/use-plugin-navigation.ts`
- **Line 116:** Hardcodes route path:
  ```ts
  to: `/plugins/${encodeURIComponent(metadata.id)}`,
  ```
- **Lines 122–322:** Entire `usePluginNavigation` hook queries two endpoints, manages external store subscriptions, and maintains state for routes that no longer exist.
- **Line 44:** Exports `parsePluginMetadata`, which is imported by `packages/ui/src/plugins/use-plugin-host.ts:31`.

#### 4. `packages/ui/src/embed/dam-hopper-app.tsx`
- **Lines 368–436:** Route definitions. Confirmed `/plugins/:installationId` was removed in commit `6a73637b`. No `/plugins/*` route exists.

---

### Consumer Inventory for `usePluginNavigation` & `pluginEntries`

| Artifact | Type | Usage |
|:---|:---|:---|
| `TopNavRouteMenu.tsx` | Production | Only production consumer of `usePluginNavigation` and creator of `pluginEntries` |
| `navigation.ts` | Production | Only function accepting `pluginEntries` |
| `use-plugin-host.ts` | Production | Imports `parsePluginMetadata` from `use-plugin-navigation.ts` (line 31) |
| `use-plugin-navigation.test.tsx` | Test Suite | Dedicated unit test for `usePluginNavigation` |
| `plugin-document.test.ts` | Test Suite | Imports `pluginNavigationItem` from `use-plugin-navigation.ts` (line 9) |
| `ssh-forward-availability.browser.tsx` | Browser Test | Line 10 mocks `@/plugins/use-plugin-navigation.js` due to `TopNavRouteMenu` import |
| `usage-page.browser.tsx` | Browser Test | Line 47 mocks `@/plugins/use-plugin-navigation.js` due to `TopNavRouteMenu` import |

---

## 4. Downstream Impact

1. **Dead Navigation Surface:** Any non-advisor plugin present on backend creates non-functional tabs in top nav. Clicking routes to `/plugins/:id`, presenting an empty view to the user.
2. **Resource & Network Overhead:** `usePluginNavigation` continuously triggers network calls (`plugins.list`) and store subscriptions on every project/server change, despite producing unusable links.
3. **Ghost Test Mocks:** Test suites for unrelated features (`ssh-forward-availability`, `usage-page`) carry mock overhead for `usePluginNavigation`.
4. **Documentation Discrepancy:** `docs/user-guide-multi-server-profiles.md` line 284 states: *"Ordinary custom/third-party plugins remain hosted under `/plugins/:installationId`"*, which conflicts with the actual deletion in commit `6a73637b`.

---

## 5. Recommended Minimal Fix

### Step 1: Clean Cutover in `TopNavRouteMenu.tsx`
Remove `usePluginNavigation`, `Puzzle` icon, and `pluginEntries`.
```tsx
// packages/ui/src/components/organisms/TopNavRouteMenu.tsx
import { getNavEntries } from "@/lib/navigation.js";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import { cn } from "@/lib/utils.js";
import { TopNavRouteLink } from "@/components/molecules/TopNavRouteLink.js";

interface TopNavRouteMenuProps {
  collapsed: boolean;
  compactLabelClass: string;
  compactTextClass: string;
  isCompactWorkspace: boolean;
}

export function TopNavRouteMenu({
  collapsed,
  compactLabelClass,
  compactTextClass,
  isCompactWorkspace,
}: TopNavRouteMenuProps) {
  const { host, environment } = useSshForwardHost();
  const navEntries = getNavEntries({
    sshForwardHostAvailable:
      host !== null && environment.kind === "nativeDesktop",
  });

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "items-center gap-1 overflow-x-auto transition-all duration-300 ease-in-out",
          isCompactWorkspace ? "hidden sm:flex" : "flex",
          collapsed
            ? "max-w-0 pointer-events-none opacity-0"
            : "ml-1 max-w-[120px] opacity-100 sm:ml-2 sm:max-w-[180px] lg:max-w-[500px] xl:max-w-[1000px]",
        )}
      >
        {navEntries.map((entry) => (
          <TopNavRouteLink
            key={entry.to}
            entry={entry}
            compactTextClass={compactTextClass}
            compactLabelClass={compactLabelClass}
            isCompactWorkspace={isCompactWorkspace}
          />
        ))}
      </nav>

      {isCompactWorkspace && !collapsed && (
        <nav
          aria-label="Primary"
          className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-2 sm:hidden"
        >
          {navEntries.map((entry, index) => (
            <TopNavRouteLink
              key={entry.to}
              entry={entry}
              compactTextClass={compactTextClass}
              compactLabelClass={compactLabelClass}
              isCompactWorkspace={isCompactWorkspace}
              mobileGrid
              fullWidth={
                navEntries.length % 2 === 1 && index === navEntries.length - 1
              }
            />
          ))}
        </nav>
      )}
    </>
  );
}
```

### Step 2: Simplify `navigation.ts`
Remove `pluginEntries` parameter and conditional splice.
```ts
// packages/ui/src/lib/navigation.ts
export function getNavEntries({
  sshForwardHostAvailable,
}: {
  sshForwardHostAvailable: boolean;
}): NavEntry[] {
  return sshForwardHostAvailable ? [...BASE_NAV, SSH_FORWARD_NAV] : BASE_NAV;
}
```

### Step 3: Decouple `parsePluginMetadata` & Retire `use-plugin-navigation.ts`
1. Extract `parsePluginMetadata` to `packages/ui/src/plugins/plugin-metadata.ts` (or keep it in a shared utility).
2. Update import in `packages/ui/src/plugins/use-plugin-host.ts:31`:
   ```ts
   import { parsePluginMetadata } from "./plugin-metadata.js";
   ```
3. Remove `use-plugin-navigation.ts` and `use-plugin-navigation.test.tsx`.
4. Remove `pluginNavigationItem` tests from `packages/ui/src/plugins/plugin-document.test.ts`.
5. Remove obsolete `vi.mock("@/plugins/use-plugin-navigation.js")` from:
   - `packages/ui/browser-tests/ssh-forward-availability.browser.tsx`
   - `packages/ui/browser-tests/usage-page.browser.tsx`

### Step 4: Documentation Alignment
Update:
- `docs/user-guide-multi-server-profiles.md`: Clarify that standalone `/plugins/:installationId` routing has been removed, not retained.
- `docs/frontend-components.md`: Remove mentions of `usePluginNavigation`.

---

## 6. Unresolved Questions

None. Root cause, file references, call chains, test impacts, and minimal remediation steps are completely verified.
