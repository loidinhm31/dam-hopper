# Research Report: Frontend Advisor Removal Strategy

**Author:** UiRemovalResearch  
**Date:** 2026-10-11  
**Target:** Clean cutover removal of Advisor UI from WorkspacePage, SettingsPage, and associated UI lifecycle.  
**Baseline Commit:** `abba947c` (merged with `origin/main`).  
**Status:** research-only; no implementation checks run.

---

## 1. Executive Summary & Invariants

Removal strictly eliminates all Advisor UI integration surfaces, providers, and settings panels with zero shims, zero replacement panels, and zero touch of host `~/.evcrate` files.
- **YAGNI / KISS:** Compact surface IDs, layout requests, and settings accordions prune advisor entries directly.
- **Terminal & Focus Integrity:** Terminal keep-alive, focus restoration (`activateTerminalAfterNavigation`), and mobile input policies (`AndroidChromeInputPolicy`, custom keyboard) remain untouched.
- **Graceful Surface Fallback:** Existing `resolveActiveCompactSurfaceId` ensures stale persisted `"advisor"` compact selections immediately fallback to `editor` (IDE mode) or `terminal` (Terminal mode).

---

## 2. WorkspacePage Integration Analysis

**File:** `packages/ui/src/components/pages/WorkspacePage.tsx`

### 2.1 Imports & Symbols to Remove
- **Lines 28-33:**
  - `WorkspaceAdvisorHost` (`@/components/organisms/WorkspaceAdvisorHost.js`)
  - `AdvisorPanelSlot` (`@/components/organisms/AdvisorPanelSlot.js`)
  - `WorkspaceAdvisorPlacementProvider`, `NativeAdvisorUiIntent` (`@/contexts/WorkspaceAdvisorContext.js`)
  - `useAdvisorVisibility` (`@/hooks/use-advisor.js`)
- **Line 24:** `Sparkles` icon import (if exclusively used for Advisor launcher/tabs).

### 2.2 Compact Surface Enumerations & Fallback
- **Lines 262-280:**
  - Remove `"advisor"` from `IDE_COMPACT_SURFACE_IDS` (`[explorer, search, editor, terminal, browser, git, project]`).
  - Remove `"advisor"` from `TERMINAL_COMPACT_SURFACE_IDS` (`[terminal, fleet, ports, browser, git, project]`).
- **Lines 310-316 (`getCompactSurfaceIds`):**
  - Simplify signature to `getCompactSurfaceIds(mode: WorkspaceMode)`.
  - Delete `isAdvisorVisible` filter branching (`ids.filter(id => id !== "advisor")`).
- **Lines 434-436, 480-496:**
  - Remove `const { isVisible: isAdvisorVisible } = useAdvisorVisibility(workspaceOwner)`.
  - Remove `handleCloseCompactAdvisor`, `priorCompactSurfaceRef`, `advisorLauncherRef`.
  - Persisted or active fallback: `resolveActiveCompactSurfaceId(requestedCompactSurface, availableCompactSurfaceIds, defaultCompactSurfaceId)` handles unrecognized IDs automatically by defaulting to `defaultCompactSurfaceId` (`terminal` or `editor`).

### 2.3 Panel Shortcuts & Mode Transitions
- **Lines 1010-1035 (`activateTerminalPanelShortcut`):**
  - Delete guard: `if (targetId === "advisor" && !isAdvisorVisible) return;`.
  - Delete `targetId === "advisor"` branch in `setIdeRightTopToolRequest`.
- **Lines 1205-1240 (`setWorkspaceMode`, `toggleWorkspaceMode`):**
  - Remove `isAdvisorVisible` parameter passed to `getCompactSurfaceIds(mode)`.

### 2.4 Rendered Surfaces & Placement Providers
- **Render tree wrapping:**
  - Remove `<WorkspaceAdvisorPlacementProvider ...>` wrapper around workspace shells.
  - Remove `<AdvisorPanelSlot ...>` mounts inside IDE tool slots (right top / bottom) and mobile shells.
  - Remove `<WorkspaceAdvisorHost ...>` conditional mounting.

---

## 3. SettingsPage Integration Analysis

**File:** `packages/ui/src/components/pages/SettingsPage.tsx`

### 3.1 Imports & Render Tree
- **Line 27:** Remove `AdvisorSettingsSection` import from `@/components/pages/settings-page/AdvisorSettingsSection.js`.
- **Lines 405-410:**
  - Remove the entire accordion block:
    ```tsx
    <SettingsSectionAccordion
      title="Native Advisor"
      description="Configure server-side Evcrate Advisor integration and inspect history directory status."
    >
      <AdvisorSettingsSection profileId={settingsProfileId} />
    </SettingsSectionAccordion>
    ```
- **Preservation:**
  - Maintain all other sections: `SettingsAppearanceSection`, `SettingsKeyboardShortcutsSection`, `SettingsUsageInsightsSection`, `DiagnosticsExportButton`, `SettingsIdleSuspendTimingSection` (including newly merged idle-suspend consent behavior), `SettingsMaintenancePanel`, and `SettingsImportExportPanel`.

---

## 4. UI vs API Ownership Boundary

| Scope | UI Component / Package | API / Backend Layer (Delegated to BackendDocsResearch) |
|---|---|---|
| **Settings** | Delete `AdvisorSettingsSection` & accordion in `SettingsPage.tsx` | Delete `server/src/api/advisor.rs` endpoints (`/api/advisor/settings`, etc.) |
| **Workspace** | Delete `WorkspaceAdvisorHost`, `AdvisorPanelSlot`, `WorkspaceAdvisorPlacementProvider`, `useAdvisorVisibility` | Delete advisor query keys in `api/queries.ts` and REST calls in `api/client.ts` |
| **Domain UI** | Delete `packages/ui/src/advisor/*` components and providers | Delete `server/src/advisor/*` history scanning and policy modules |
| **Transport** | Remove advisor methods on `ApiClient.advisor` and `WsTransport` mappings | Remove Axum routing table entries |

---

## 5. Lifecycle, Terminal, & Focus Invariants

1. **Terminal Keep-Alive & Navigation:**
   - Session tracking (`registeredTerminalIds`, `mountedSessions`) and keep-alive hosts (`BrowserDebugKeepAliveHost`, terminal background hosts) are completely isolated from Advisor.
   - `navigateToTerminalNotification` exclusively selects session tabs and activates terminal fit. No Advisor side-effects.
2. **Mobile / Responsive Input Policy:**
   - Coarse pointer detection (`isCoarsePointer`) and Android input suppression (`isAndroidChromeNativeInputSuppressed`) operate independently of compact surface list changes.
3. **Storage / Local State:**
   - Stored surface strings in `localStorage` or session state fall back cleanly via `resolveActiveCompactSurfaceId`. No manual migration script needed.

---

## 6. Validation Scenarios (for Implementation Phase)

1. **Workspace IDE Mode:**
   - Mount `WorkspacePage` in IDE mode; confirm tools (explorer, search, git, project info, ports, fleet) open without error.
   - Confirm right-top panel toggles work without `advisor` target.
2. **Workspace Terminal Mode & Compact View:**
   - Switch between IDE and terminal modes; confirm compact bottom navigation displays only valid tools.
   - Set mock stored active surface to `"advisor"`; verify it resolves to fallback (`editor` in IDE, `terminal` in terminal mode).
3. **Settings Navigation:**
   - Navigate to `/settings`; confirm page renders without Native Advisor accordion.
   - Verify idle-suspend timing section and nuclear reset modals operate normally.
4. **Build & Bundle:**
   - Confirm zero unresolved imports from `@/advisor/*`, `@/hooks/use-advisor.js`, or `@/contexts/WorkspaceAdvisorContext.js`.

---

## 7. Unresolved Questions

1. Are there any E2E Playwright tests explicitly asserting the existence of the `Native Advisor` accordion title or `advisor` compact tab? (Scout to verify in test inventory).
2. Should `TerminalPanelToolId` in `types.ts` (or equivalent tool union) be cleaned up in the UI package simultaneously, or does it share definition with server DTOs?
