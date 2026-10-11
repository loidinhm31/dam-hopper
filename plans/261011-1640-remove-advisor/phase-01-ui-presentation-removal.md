# Phase 01: UI Presentation and Shortcuts Removal

## 1. Context links

- Plan Root: [plan.md](./plan.md)
- Scope and Architecture Decisions: [reports/00-scope-and-design.md](./reports/00-scope-and-design.md)
- Frontend Research Report: [research/researcher-01-ui-removal-report.md](./research/researcher-01-ui-removal-report.md)
- Scout Inventory Report: [scout/scout-01-advisor-removal-report.md](./scout/scout-01-advisor-removal-report.md)
- Ownership Manifest: [reports/01-ownership-manifest.json](./reports/01-ownership-manifest.json)
- User Validation: [confirmed decisions](./plan.md#validation-summary).

## 2. Parallelization Info

- **Group:** Parallel Group A (UI presentation, hooks, layouts, shortcuts, associated UI unit tests)
- **Concurrent Siblings:** Group B ([Phase 02](./phase-02-client-and-test-infrastructure-removal.md)), Group C ([Phase 03](./phase-03-native-server-removal.md)), Group D ([Phase 04](./phase-04-feature-documentation-removal.md))
- **Editing Pre-requisites:** None. Can start editing immediately in parallel.
- **Validation Pre-requisites:** All editing groups (A, B, C, D) must complete before typecheck, test runners, or builds execute.
- **Unblocks:** [Phase 05](./phase-05-integration-verification.md) (Group E).

## 3. Overview

- **Date:** 2026-10-11
- **Description:** Complete removal of Advisor React presentation components, views, organisms, hooks, context providers, layout tool IDs, keyboard shortcut bindings, and associated UI unit tests.
- **Priority:** P2
- **Status:** done (2026-10-11)
- **Review:** User validation decisions reflected 2026-10-11; implementation review and runtime verification remain pending.

## 4. Key Insights

- The entire `packages/ui/src/advisor/` tree (44 files: panel, views, sub-components, selectors, reducer, actions, and styles) is dead feature code and must be deleted.
- In `WorkspacePage.tsx`, Advisor is mounted via `WorkspaceAdvisorHost`, `AdvisorPanelSlot`, and `WorkspaceAdvisorPlacementProvider`, and queried via `useAdvisorVisibility`. Removing these cleanly restores pure workspace layouts.
- Stale persisted or URL-requested compact surface IDs are already protected by `resolveActiveCompactSurfaceId(requested, available, defaultSurfaceId)`. Stripping `"advisor"` from `IDE_COMPACT_SURFACE_IDS` and `TERMINAL_COMPACT_SURFACE_IDS` automatically falls back to `"editor"` (IDE) or `"terminal"` (Terminal) without needing dedicated migration logic.
- In `SettingsPage.tsx`, removing the `AdvisorSettingsSection` accordion block completely removes Advisor configuration while leaving all remaining settings sections intact (appearance, shortcuts, usage insights, diagnostics export, idle-suspend timing with consent, maintenance, import/export).
- In `TerminalWorkspaceShell.tsx`, `advisorContent` prop and the `activePanelId === "advisor"` branch are deleted.
- In `lib/ide-shell-layout.ts`, `lib/terminal-workspace-panel.ts`, and `lib/reveal-active-file.ts`, `"advisor"` is removed from the tool unions. No dedicated keyboard shortcut key exists for Advisor (shortcuts use `resolveTerminalPanelShortcut`).
- Unrelated presentation invariants remain strictly intact: terminal keep-alive hosts, focus restoration (`activateTerminalAfterNavigation`), mobile input policy (`AndroidChromeInputPolicy`), and `host-resource-state.ts`'s `"Advisory"` severity tone (which is host resource monitoring, not the Advisor feature).

## 5. Requirements

- R01.1: Completely delete `packages/ui/src/advisor/` (all 44 files including components, views, types, styles, and unit tests).
- R01.2: Delete `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx` and its test.
- R01.3: Delete `packages/ui/src/components/organisms/AdvisorPanelSlot.tsx`, `WorkspaceAdvisorHost.tsx`, and their tests.
- R01.4: Delete `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx`, `packages/ui/src/hooks/use-advisor.ts`, and their tests.
- R01.5: Delete `packages/ui/src/lib/workspace-advisor-placement.ts` and its test.
- R01.6: Remove Advisor accordion from `packages/ui/src/components/pages/SettingsPage.tsx` and update `SettingsPage.test.tsx`.
- R01.7: Remove Advisor providers, slots, host, compact IDs, and visibility logic from `packages/ui/src/components/pages/WorkspacePage.tsx` and update `WorkspacePage.test.tsx` and `WorkspacePageBlameReveal.test.tsx`.
- R01.8: Remove `advisorContent` prop and slot handling from `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx` and update `TerminalWorkspaceShell.test.tsx`.
- R01.9: Remove `"advisor"` from `TerminalPanelToolId` in `packages/ui/src/lib/ide-shell-layout.ts` and update `ide-shell-layout.test.ts`.
- R01.10: Remove `"advisor"` from `packages/ui/src/lib/terminal-workspace-panel.ts` and `packages/ui/src/lib/reveal-active-file.ts`.
- R01.11: Do not execute mid-flight build, lint, or test commands during editing.
- R01.12: Remove only DamHopper presentation code. Other-project OMP/Evcrate tooling and external user data are out of scope.

## 6. Architecture

Clean cutover at the presentation boundary:
```
[WorkspacePage / SettingsPage]
       │ (removes hooks & providers)
       ├── ✕ WorkspaceAdvisorPlacementProvider
       ├── ✕ WorkspaceAdvisorHost
       ├── ✕ AdvisorPanelSlot
       └── ✕ AdvisorSettingsSection
              │ (removes component tree)
              └── ✕ packages/ui/src/advisor/*
```
Surviving UI architecture remains identical:
- IDE mode tools: `[explorer, search, git, project, ports, fleet, browser]`
- Terminal mode tools: `[git, ports, project, terminals]`
- Settings sections: `[Appearance, Keyboard Shortcuts, Usage Insights, Idle Suspend, Maintenance, Import/Export]`
- Stale panel ID normalization: handled by existing `resolveActiveCompactSurfaceId` and `resolveTerminalPanelShortcut`.

## 7. Related code files (exclusive)

All paths relative to `ROOT=/home/loidinh/WS/dam-hopper-ws/remove-advisor`:

### Deleted Files (55 files)
- `packages/ui/src/advisor/advisor.css`
- `packages/ui/src/advisor/AdvisorPanel.test.tsx`
- `packages/ui/src/advisor/AdvisorPanel.tsx`
- `packages/ui/src/advisor/advisor-data-provider.ts`
- `packages/ui/src/advisor/advisor-types.ts`
- `packages/ui/src/advisor/index.ts`
- `packages/ui/src/advisor/native-advisor-provider.test.ts`
- `packages/ui/src/advisor/native-advisor-provider.ts`
- `packages/ui/src/advisor/policy-routing-validation.test.ts`
- `packages/ui/src/advisor/policy-routing-validation.ts`
- `packages/ui/src/advisor/app-state-selectors.ts`
- `packages/ui/src/advisor/app-state-types.ts`
- `packages/ui/src/advisor/app-state-selectors.test.ts`
- `packages/ui/src/advisor/app-state-reducer.test.ts`
- `packages/ui/src/advisor/app-state-reducer.ts`
- `packages/ui/src/advisor/app-actions.ts`
- `packages/ui/src/advisor/evaluation-comparison-helpers.ts`
- `packages/ui/src/advisor/views/EvaluationsView.test.tsx`
- `packages/ui/src/advisor/views/ConfigurationView.tsx`
- `packages/ui/src/advisor/views/EvaluationDetail.tsx`
- `packages/ui/src/advisor/views/HistoryView.tsx`
- `packages/ui/src/advisor/views/EvaluationsView.tsx`
- `packages/ui/src/advisor/views/HistoryDetail.tsx`
- `packages/ui/src/advisor/views/OverviewView.tsx`
- `packages/ui/src/advisor/components/PolicySummaryCard.test.tsx`
- `packages/ui/src/advisor/components/PolicySummaryCard.tsx`
- `packages/ui/src/advisor/components/RouteFieldset.tsx`
- `packages/ui/src/advisor/components/CandidatePerformanceTable.tsx`
- `packages/ui/src/advisor/components/ComparableGroupsSection.tsx`
- `packages/ui/src/advisor/components/EvaluationGroupCard.tsx`
- `packages/ui/src/advisor/components/ScoreProvenanceCard.tsx`
- `packages/ui/src/advisor/components/EvaluationDescriptorCard.tsx`
- `packages/ui/src/advisor/components/EvaluationDescriptorsSection.tsx`
- `packages/ui/src/advisor/components/PanelTabs.tsx`
- `packages/ui/src/advisor/components/PanelTabs.test.tsx`
- `packages/ui/src/advisor/components/EvaluationsHeader.tsx`
- `packages/ui/src/advisor/components/RouteGroupCard.tsx`
- `packages/ui/src/advisor/components/TextBlock.tsx`
- `packages/ui/src/advisor/components/PaginationControls.tsx`
- `packages/ui/src/advisor/components/MetricRatio.tsx`
- `packages/ui/src/advisor/components/ActivityScopeControl.tsx`
- `packages/ui/src/advisor/components/DiagnosticPanel.tsx`
- `packages/ui/src/advisor/components/StatusBanner.tsx`
- `packages/ui/src/advisor/components/DataControls.tsx`
- `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx`
- `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.test.tsx`
- `packages/ui/src/components/organisms/AdvisorPanelSlot.tsx`
- `packages/ui/src/components/organisms/AdvisorPanelSlot.test.tsx`
- `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx`
- `packages/ui/src/components/organisms/WorkspaceAdvisorHost.test.tsx`
- `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx`
- `packages/ui/src/hooks/use-advisor.ts`
- `packages/ui/src/hooks/use-advisor.test.tsx`
- `packages/ui/src/lib/workspace-advisor-placement.ts`
- `packages/ui/src/lib/workspace-advisor-placement.test.ts`

### Modified Files (11 files)
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/pages/WorkspacePage.test.tsx`
- `packages/ui/src/components/pages/WorkspacePageBlameReveal.test.tsx`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- `packages/ui/src/components/pages/SettingsPage.test.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`
- `packages/ui/src/lib/ide-shell-layout.ts`
- `packages/ui/src/lib/ide-shell-layout.test.ts`
- `packages/ui/src/lib/terminal-workspace-panel.ts`
- `packages/ui/src/lib/reveal-active-file.ts`

## 8. File Ownership

Phase 01 exclusively owns all 66 files listed in Section 7. No file owned by Phase 01 is modified or deleted by any other phase.

## 9. Implementation Steps

1. Delete all 44 files in `packages/ui/src/advisor/`.
2. Delete `AdvisorSettingsSection.tsx` and `AdvisorSettingsSection.test.tsx` in `packages/ui/src/components/pages/settings-page/`.
3. Delete `AdvisorPanelSlot.tsx`, `AdvisorPanelSlot.test.tsx`, `WorkspaceAdvisorHost.tsx`, `WorkspaceAdvisorHost.test.tsx` in `packages/ui/src/components/organisms/`.
4. Delete `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx`.
5. Delete `packages/ui/src/hooks/use-advisor.ts` and `packages/ui/src/hooks/use-advisor.test.tsx`.
6. Delete `packages/ui/src/lib/workspace-advisor-placement.ts` and `packages/ui/src/lib/workspace-advisor-placement.test.ts`.
7. Edit `packages/ui/src/components/pages/SettingsPage.tsx`:
   - Remove `AdvisorSettingsSection` import.
   - Remove `<SettingsSectionAccordion title="Native Advisor" ...>` render block.
8. Edit `packages/ui/src/components/pages/SettingsPage.test.tsx`:
   - Remove `vi.mock("@/components/pages/settings-page/AdvisorSettingsSection.js", ...)` mock.
   - Remove `"Native Advisor"` from the expected section title array.
9. Edit `packages/ui/src/components/pages/WorkspacePage.tsx`:
   - Remove imports: `WorkspaceAdvisorHost`, `AdvisorPanelSlot`, `WorkspaceAdvisorPlacementProvider`, `NativeAdvisorUiIntent`, `useAdvisorVisibility`.
   - Remove `"advisor"` from `IDE_COMPACT_SURFACE_IDS` and `TERMINAL_COMPACT_SURFACE_IDS`.
   - Simplify `getCompactSurfaceIds(mode: WorkspaceMode)` by removing `isAdvisorVisible` parameter and filtering.
   - Remove `useAdvisorVisibility`, `handleCloseCompactAdvisor`, `priorCompactSurfaceRef`, `advisorLauncherRef`.
   - Remove `targetId === "advisor"` guard and branch in `activateTerminalPanelShortcut`.
   - Remove `<WorkspaceAdvisorPlacementProvider>`, `<AdvisorPanelSlot>`, and `<WorkspaceAdvisorHost>` from JSX tree.
10. Edit `packages/ui/src/components/pages/WorkspacePage.test.tsx` and `WorkspacePageBlameReveal.test.tsx`:
    - Remove `useAdvisorVisibility` mocks and Advisor gating test cases.
11. Edit `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`:
    - Remove `AdvisorPanelSlot` import.
    - Remove `advisorContent` prop from interface and component props.
    - Remove `activePanelId === "advisor"` render branch.
12. Edit `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`:
    - Remove `"advisor"` test cases from the parameterized matrix.
13. Edit `packages/ui/src/lib/ide-shell-layout.ts` and `ide-shell-layout.test.ts`:
    - Remove `"advisor"` from `TerminalPanelToolId`.
    - Remove `targetId === "advisor"` branch in `resolveTerminalPanelShortcut`.
    - Remove Advisor toggle test cases from `ide-shell-layout.test.ts`.
14. Edit `packages/ui/src/lib/terminal-workspace-panel.ts` and `reveal-active-file.ts`:
    - Remove `"advisor"` from `TerminalWorkspacePanelId` and `exclusiveTarget` unions.

## 10. Todo list

- [x] Delete `packages/ui/src/advisor/` tree (44 files)
- [x] Delete standalone organisms, context, hook, and placement files (11 files)
- [x] Modify `SettingsPage.tsx` and `SettingsPage.test.tsx`
- [x] Modify `WorkspacePage.tsx`, `WorkspacePage.test.tsx`, `WorkspacePageBlameReveal.test.tsx`
- [x] Modify `TerminalWorkspaceShell.tsx` and `TerminalWorkspaceShell.test.tsx`
- [x] Modify `ide-shell-layout.ts`, `ide-shell-layout.test.ts`, `terminal-workspace-panel.ts`, `reveal-active-file.ts`

## 11. Success Criteria

- Zero imports of `@/advisor/*`, `@/hooks/use-advisor.js`, or `@/contexts/WorkspaceAdvisorContext.js` remain in UI code.
- WorkspacePage renders without Advisor host or slot wrappers in both IDE and Terminal modes.
- SettingsPage renders without Native Advisor accordion.
- Stale persisted compact surface ID `"advisor"` cleanly falls back to default without crash.
- UI unit tests pass once sibling phases complete.

## 12. Conflict Prevention

- Do not edit `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, or `packages/ui/package.json` (owned by Phase 02).
- Do not edit any files in `server/` (owned by Phase 03) or `docs/` (owned by Phase 04).
- Do not run build/test commands mid-flight while sibling agents are modifying client transport or backend files.

## 13. Risk Assessment

- **Risk:** Type errors due to missing DTO imports in `client.ts` before Phase 02 runs.
  - **Mitigation:** Expected during concurrent editing. All edits settle before Phase 05 validation runs.
- **Risk:** Stale user localStorage crashing Workspace.
  - **Mitigation:** Verified that `resolveActiveCompactSurfaceId` checks against available compact surface IDs and falls back to default.

## 14. Security Considerations

- Does not expose or mutate user data.
- Ensures complete deletion of UI client-side state without leaving hidden background polling or event listeners.

## 15. Next steps

- Sibling Phase 02 executes client transport and test fixture cleanup in parallel.
- Hand qualified UI changes to Phase 05 for the confirmed coordinated UI/server release; do not deploy this phase independently.
