# Phase 01 — Settings commit summary

## Context links

- [Plan](plan.md)
- [Scout report](../reports/scout-260726-1954-commit-status-terminal-controls.md)
- `server/src/git/types.rs`, `packages/ui/src/api/client.ts`, `packages/ui/src/api/queries.ts`

## Overview

Date: 2026-07-26 · Priority: medium · Status: completed 2026-07-26

## Key insights

The Rust `GitStatus` already includes `branch`, `lastCommit`, `pathExists`, and `statusError`; the frontend declaration is stale. `activeProject` is persisted in the workspace store. The normal query fetches immediately, so a manually triggered query/wrapper is required for this surface.

## Requirements

- Add a collapsed **Project status** accordion near Workspace Config.
- Start idle: no project-status request on Settings entry. An explicit, accessible **Refresh latest commit** starts retrieval for the active project.
- On success, present branch, full commit message, locale-formatted RFC-2822 date, and a seven-character hash; full values remain available through title/accessible text.
- Handle no active project, loading, invalid date, missing Git repo/no commit, and server error clearly; no stale data may represent a different active project.

## Architecture

Correct `GitStatus` to Rust: numeric `staged`/`modified`/`untracked`, `hasStash`, `lastCommit`, optional `pathExists` and `statusError`. Reuse `api.projects.status` through a disabled/explicit TanStack Query or tiny Settings-specific hook. Keep display/format logic in a focused component, not `SettingsPage`.

## Related code files

- `packages/ui/src/api/client.ts`
- `packages/ui/src/api/queries.ts`
- `packages/ui/src/stores/workspace.ts`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- new focused Settings project-status component and its tests

## Implementation steps

1. Verify every current `GitStatus` consumer remains valid after type alignment.
2. Add a manual-only status query/controller keyed to the active project; reset or identify results when active project changes.
3. Build the restrained read-only card: subtle branch/hash metadata, truncating message, safe date formatting, explicit status states, and Refresh button.
4. Mount it in the new collapsed Settings accordion near Workspace Config.
5. Add focused render/interaction tests.

## Todo list

- [x] Align client payload type
- [x] Implement manual status component/hook
- [x] Mount Project status accordion
- [x] Add tests and typecheck

## Validation evidence

- Focused Settings/status unit tests: 4/4 passed.
- Browser regression suite: 62/62 passed.
- UI production build completed successfully.

## Success criteria

Only explicit Refresh calls status from Settings; the result is correct for the active project and handles all empty/error states without throwing.

## Risk assessment

Medium compatibility risk from the stale shared type; mitigate by checking all consumers and testing meaningful payload variants.

## Security considerations

Treat commit text as plain React text; do not introduce raw HTML, logging, credentials, or permissions changes.

## Next steps

Phase 01 is complete. Proceed to Phase 02 terminal scroll-control redesign.
