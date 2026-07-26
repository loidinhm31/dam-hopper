# Phase 03 — Terminal commit status

## Context links

- [Plan](plan.md)
- [Phase 01 — superseded Settings placement](phase-01-settings-commit-summary.md)
- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/components/organisms/TabBar.tsx`
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`
- `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`
- `packages/ui/src/api/client.ts`
- `packages/ui/src/api/queries.ts`
- `packages/ui/src/lib/ui-config.ts`
- `packages/ui/src/stores/settings.ts`
- `server/src/config/schema.rs`
- `server/src/config/global.rs`

## Overview

Date: 2026-07-26 · Priority: P2 · Status: planned

Replace the superseded Settings project-status card with an opt-in status chip in
the Terminal surface. Settings owns only the persisted ON/OFF preference.

## Key insights

- `projects:status` already returns `branch`, `lastCommit.message`, `lastCommit.date`,
  `lastCommit.hash`, `pathExists`, and `statusError`; do not add an endpoint.
- `MountedSession.project` is the authoritative project for a terminal session.
  `PaneContainer` can resolve each pane's active session from `mountedSessions`;
  `ActiveTerminalRuntimeDisplay` can resolve its full-width active session.
- `useProjectStatus` is already keyed by project and used elsewhere. Extend its
  enablement or wrap it so the chip does not query when the global toggle is off.
  Do not add polling. Query caching may deduplicate same-project panels.

## Requirements

### Functional

- Add `terminalCommitStatusEnabled` (JSON camelCase; TOML snake_case and accepted
  camelCase alias) to `UiConfig`, settings store, defaults, hydration, and
  debounced persistence. Default is `false` for new and missing config.
- Keep Settings to one accessible ON/OFF switch, with copy explaining that status
  appears in Terminal headers. Remove the Project status accordion, manual refresh
  state, `useManualProjectStatus`, and obsolete Settings status tests/browser mocks.
- When enabled, render one compact accessible responsive chip in each terminal
  panel/tab header, never positioned over xterm output:
  - split layout: `PaneContainer` resolves the pane's `activeSessionId` to
    `MountedSession.project` and supplies status UI to `TabBar`;
  - full-width runtime: `ActiveTerminalRuntimeDisplay` resolves its active session
    and renders the same status UI in its header (including compact/mobile header).
- Show branch, truncated commit message, locale-formatted date, and a short
  seven-character hash. Preserve full values in `title`/accessible text.
- Hide the chip for no active session/project, disabled preference, missing/invalid
  Git (`pathExists === false` or `statusError`), or no commit/hash. Loading and
  request errors must remain quiet or use a non-noisy accessible fallback without
  pretending a value is current.
- Switching tabs, panes, projects, or the global toggle must not display a cached
  result for another project.

### Non-functional

- No polling, refresh button, extra endpoint, server Git changes, or xterm overlay.
- Keep the chip readable at narrow widths with truncation/wrapping rules and
  visible focus/contrast states; preserve keyboard and screen-reader semantics.

## Architecture

1. Persist the boolean through the existing global UI config path:
   `SettingsAppearanceSection` → `useSettingsStore.saveDebounced` →
   `globalConfig:updateUi` → Rust `UiConfig` serde/default/global TOML mapping.
2. Create a focused presentational/query component (for example
   `TerminalCommitStatusChip`) that accepts `project` and `enabled`, calls the
   existing `useProjectStatus` query only when both are valid, and formats/hides
   `GitStatus` states in one place.
3. Pass `mountedSessions` through the existing split-layout path (or derive from
   the already available pane/session props) so `PaneContainer` maps active
   session ID to project. Keep project resolution out of `TabBar`; it should
   receive the chip/project prop only.
4. Reuse the component in `ActiveTerminalRuntimeDisplay` for its active session,
   with a slim header row on wide layouts and the existing compact header on
   mobile. Do not put the chip inside `TerminalRuntimeOutput` or any xterm host.

## Related code files

### Modify

- `packages/ui/src/api/client.ts` — add the optional UI config key/type.
- `packages/ui/src/api/queries.ts` — gate the existing project-status query; retain
  `["project-status", project]` cache keys and endpoint.
- `packages/ui/src/lib/ui-config.ts` — false default and normalization.
- `packages/ui/src/stores/settings.ts` — state, hydrate, persistence, optimistic
  rollback path.
- `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` and
  `SettingsAppearanceSection.test.tsx` — ON/OFF-only control and assertions.
- `packages/ui/src/components/pages/SettingsPage.tsx` — remove status-card query,
  accordion, and obsolete imports/state.
- `packages/ui/src/components/organisms/PaneContainer.tsx`,
  `TabBar.tsx`, `ActiveTerminalRuntimeDisplay.tsx`, `SplitLayout.tsx` — resolve
  active session projects and mount the header chip.
- `server/src/config/schema.rs`, `server/src/config/global.rs`, and config tests —
  serde/default/JSON-to-TOML contract.

### Create

- `packages/ui/src/components/organisms/TerminalCommitStatusChip.tsx` and focused
  unit tests (or an equivalent narrowly scoped component/module).
- Focused browser coverage for toggle visibility, split/full-width placement,
  responsive truncation, project switching, and hidden invalid/no-commit states.

### Delete

- `packages/ui/src/components/organisms/SettingsProjectStatusSection.tsx` and its
  unit test after its behavior is covered by the terminal chip tests.
- Obsolete Settings project-status browser fixtures/mocks if no longer referenced.

## Implementation steps

1. Add the global config field with false defaults, serde aliases, TOML key
   normalization, client type/defaults, store hydration/persistence, and contract
   tests.
2. Replace the Settings project-status surface with one ON/OFF switch; remove its
   manual mutation and stale tests/mocks.
3. Implement the chip's query gating, project-keyed rendering, formatting,
   accessibility labels, responsive classes, and invalid-state hiding.
4. Thread mounted-session data through split panes and full-width runtime headers;
   verify no chip is rendered inside `TerminalRuntimeOutput`/xterm.
5. Add unit/browser coverage and run typecheck/build, focused Vitest, browser
   checks, and Rust config tests. Review Phase 02 independently.

## Todo list

- [ ] Add persisted `terminalCommitStatusEnabled` contract (default off)
- [ ] Reduce Settings to the ON/OFF switch and remove superseded card
- [ ] Implement reusable panel/header chip with query gating and formatting
- [ ] Resolve active session project in split and full-width terminal surfaces
- [ ] Add unit, browser, and Rust config coverage
- [ ] Run release gates and accessibility/responsive checks

## Success criteria

- Settings contains no commit metadata or refresh action.
- With the toggle off (including missing/legacy config), no status request or chip
  occurs. With it on, each active panel shows only its own project's latest commit
  metadata beside the terminal header.
- Chip disappears for invalid/no-Git/no-commit responses and never overlays xterm.
- Existing Git consumers, terminal layout, and Phase 02 scroll controls continue to
  pass typecheck, tests, and browser validation.

## Risk assessment

- **Stale cross-panel data:** keep query keys project-scoped and clear/gate output
  when project changes; test rapid tab/pane switching.
- **Config compatibility:** use serde defaults plus both naming aliases and verify
  read/write round trips.
- **Header crowding:** use a compact flex item with min-width/truncation and
  responsive labels; test narrow and compact layouts.
- **Query fan-out:** no polling; TanStack Query cache/stale policy avoids duplicate
  same-project requests.

## Security considerations

- Existing auth and project sandbox checks remain the only access control.
- Render branch/message/date/hash as escaped text; never use `dangerouslySetInnerHTML`
  or log commit content.
- Do not expose filesystem paths, tokens, or raw terminal output in the chip.

## Side-effect review

- Auth/permissions: unchanged authenticated `projects:status`.
- API/client: same endpoint and payload; only client query enablement changes.
- Data/migrations: optional global boolean; missing values resolve false.
- Business logic: display-only; no Git mutations or freshness claims.
- Security/privacy/logging: text-only metadata, no secrets/logging.
- Performance/concurrency: no polling/extra endpoint; project-keyed cache.
- Docs/config/deploy: config contract tests only; no deployment or schema migration.

## Next steps

Implement this phase after the user-approved Phase 02 work is isolated or complete,
then run the stated quality gates and code review.

## Unresolved questions

None.
