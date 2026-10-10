# Phase 01 — Scoped target and launch routing

## Context links

- [Parent plan](./plan.md); [findings](./reports/01-codebase-analysis.md).
- [Ownership standards](../../docs/code-standards.md#ownership-and-asynchronous-work).
- [Architecture design](../../docs/system-architecture.md#traditional-terminal-worktree-shortcut--proposed).

## Overview

Date: 2026-10-09. Priority: P2. Estimate: 3h. Status: complete. Implementation: complete. Review: passed (10/10). User approval: approved.
Make the existing shared target and shell launch path safe for per-project sidebar switching.

## Key Insights

- `project-target.ts` already accepts `ProjectRef` and keys through `projectScopeKey`; no second store needed.
- `use-project-target.ts:18-21` reads qualified state then falls back to a bare project-name key. Root on one profile must not inherit another profile's legacy target.
- `ProjectWorktreesSection.tsx:96-99,290` reads/writes bare-name target state even when `target.target` carries a profile. Sharing a new qualified sidebar with this panel otherwise diverges.
- `TraditionalTerminalProjectsDisplay.tsx:107-165` remembers bare group project names. `WorkspacePage.tsx:1830` passes `selectedProjectId`, which is already a qualified UI identifier despite the prop name.
- `use-terminal-manager.ts:461-467` resolves bare names by first matching project; `terminalLaunchForProject:867-877` additionally falls back to bare project/root paths.

## Requirements

- One canonical profile/project target, read by both selectors and the terminal launcher.
- Root is absence of the exact scope key; a qualified root never falls through to bare state.
- Desktop/compact New terminal controls route to selected group owner; changing an inactive row's dropdown does not redirect them.
- Preserve workspace-project revision precedence, tab-selection precedence, and Free-terminal behavior.
- Do not mutate existing session cwd/worktreePath/identity or send terminal input.

## Architecture

Qualified project ref -> `projectScopeKey` target read/write -> existing `getTerminalLaunchRequest` -> owner-bound `terminal.create`.

Keep display labels separate from opaque launch identifiers. Reuse `projectKey(group.projectRef)` when a group has an owner; do not assume legacy `project:NAME` group IDs parse as project keys. Existing unqualified fixtures must be updated to explicit owners where representing actual configured projects. Use root-target refs for discovery, never a selected missing worktree.

## Related code files

Modified in Phase 01:
- `packages/ui/src/hooks/use-project-target.ts`: exact qualified scope read (`projectScopeKey`); no qualified-to-bare fallback leaks.
- `packages/ui/src/hooks/use-project-target.test.tsx`: isolated unit test suite covering exact scoped reads/writes and multi-profile isolation.
- `packages/ui/src/stores/editor.ts`: preserves `profileId` on `availabilityTarget` for worktree availability tracking.
- `packages/ui/src/components/organisms/ProjectWorktreesSection.tsx`: qualifies target-store lookups, selection, loss/recovery, and removal target refs from supplied snapshot; preserves editor ownership.
- `packages/ui/src/components/organisms/ProjectWorktreesSection.test.tsx`: updated tests for qualified target actions and removal contracts.
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`: retains qualified project identity across tab/project selection and new-terminal creation callbacks.
- `packages/ui/src/components/pages/WorkspacePage.tsx`: passes qualified project identifier to shell-launch handler.
- `packages/ui/browser-tests/terminal-traditional-projects.browser-fixture.tsx`: updated fixtures to provide explicit owner profiles for configured projects.
- `packages/ui/src/hooks/use-terminal-manager.ts`: exact-owner root and worktree resolution with fail-closed missing/disconnected owner handling; extracted pure `resolveTerminalLaunchForProject`; synchronous dispatch-time store read eliminates stale render closures and subscription overhead.
- `packages/ui/src/hooks/use-terminal-manager.test.ts`: behavioral assertions for exact-owner root resolution, worktree target launch, and multi-profile isolation.
- `packages/ui/src/lib/workflow-workspace-integration.ts`: migrated consumer callsites to eliminate fallback aliases.

Reuse unchanged unless implementation proves necessary:
- `packages/ui/src/stores/project-target.ts`: store API and normalized target keys.
- `packages/ui/src/lib/traditional-terminal-projects.ts`: project groups and stable layout keys.
- `packages/ui/src/api/ownership.ts`: opaque project identity helpers.

No server API, schema, dependency, or persistence additions.

## Implementation Steps

1. Resolve changed exported-symbol references with LSP. If unavailable, enumerate exact callers using repository grep; session LSP had no server.
2. Replace qualified target fallbacks with `projectScopeKey` lookup in the target hook and launch resolver. Do not delete legitimate unqualified behavior for genuinely unqualified callers; migrate owner-aware callers rather than add aliases.
3. Derive one project scope from `target.target` in ProjectWorktreesSection. Use it for active/unavailable state, select/reset/loss/recovery. Carry profile through editor and removal target operations; preserve current safety blockers.
4. Separate Traditional current-project identifier from display name. Remember a group-derived qualified identifier with existing revision/active-session precedence; pass it to the existing shell-launch callback.
5. Make qualified launch root lookup exact-owner only. Missing/disconnected owner fails closed using existing error handling, never another profile or a first-matching root.
6. Check immediate select-then-New ordering uses current target state. If a captured render value can be stale, read canonical store at dispatch in the existing launch resolver; no new asynchronous layer.
7. Update affected contract tests and fixture data; no wiring-only assertions.

## Todo list

- [x] Exact scoped target reads and writes (`use-project-target.ts`).
- [x] Project panel loss/removal/recovery retains ownership (`ProjectWorktreesSection.tsx`, `editor.ts`).
- [x] Traditional launch target retains profile across project/tab transitions (`TraditionalTerminalProjectsDisplay.tsx`, `WorkspacePage.tsx`).
- [x] Exact-owner root & worktree resolution with fail-closed missing/disconnected handling (`use-terminal-manager.ts`).
- [x] Root/new-terminal precedence and Free terminals preserved (`use-terminal-manager.ts`).
- [x] Dispatch-time freshness via direct store read without subscription overhead (`use-terminal-manager.ts`).
- [x] Consumers migrated; no fallback aliases (`workflow-workspace-integration.ts`).
- [x] Contract tests, unit suites, and browser fixtures updated (`use-project-target.test.tsx`, `use-terminal-manager.test.ts`, `ProjectWorktreesSection.test.tsx`, `terminal-traditional-projects.browser-fixture.tsx`).

## Verification and Results

- **Code Review**: Passed with 10/10 rating (report: `plans/reports/code-review-261009-1536-phase-01-scoped-target-routing.md`). 0 critical issues, 0 high findings.
- **User Approval**: Formally approved by user.
- **Targeted Unit & Contract Tests**: 60/60 passing (`use-project-target.test.tsx`, `project-target.test.ts`, `ProjectWorktreesSection.test.tsx`, `use-terminal-manager.test.ts`, `workflow-workspace-integration.test.ts`).
- **Phase 01 Extended Regression Suite**: 100/100 passing across 7 test files (`use-project-target.test.tsx`, `project-target.test.ts`, `ProjectWorktreesSection.test.tsx`, `use-terminal-manager.test.ts`, `workflow-workspace-integration.test.ts`, `TraditionalTerminalProjectsDisplay.test.tsx`, `TraditionalTerminalProjectsNavigator.test.tsx`, `WorkspacePage.test.tsx`).
- **Monorepo Test Suite**: 2,707/2,707 passing.
- **TypeScript Compilation**: Clean compilation (`pnpm --filter @dam-hopper/ui build` exit 0).
- **Linter**: Clean execution (`pnpm lint` — 0 errors, 0 new warnings).

## Success Criteria

- Select feature worktree on profile A/demo; profile B/demo stays root, including when a legacy bare demo key exists.
- Select worktree in either Project panel or sidebar; the other observes the same target.
- New shell opens on correct owner with exact selected cwd/worktreePath; selecting root clears only that owner's target.
- Immediate selection followed by New uses current target; changing inactive project's selection does not change active launch project.
- Original terminals retain id/incarnation/cwd/worktreePath and live output.

## Risk Assessment

Shared-reader changes affect other target-aware callers. Inventory them before edits, preserve consumer behavior and generation guards. Do not treat stored paths as proof of worktree availability.

## Security Considerations

Owner identity never inferred from ambient focus. No arbitrary path input or owner substitution. Backend registration validation remains authoritative.

## Next steps

Phase 02 uses the corrected shared target contract; Phase 03 proves real launch behavior.

## Unresolved questions

None.
