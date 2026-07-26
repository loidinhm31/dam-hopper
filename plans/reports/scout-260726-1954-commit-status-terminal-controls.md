# Scout — commit status + terminal controls

## Scope

Read-only scout for showing the active project's latest commit and simplifying the terminal scroll control. No application code changed. Gemini was installed but unconfigured; `agy` completed the UI/design searches and timed out on the backend search, so backend findings below were verified locally.

## Existing contracts

### Latest commit data already exists server-side

- `server/src/git/types.rs`: `GitStatus` contains `branch` and `lastCommit { hash, message, date }`, serialized camelCase.
- `server/src/git/repository.rs`: `get_status()` resolves the checked-out branch and HEAD commit; date is RFC-2822 string and message is the commit summary.
- `server/src/api/config.rs`: `GET /api/projects/:name/status` returns that `GitStatus`; `packages/ui/src/api/ws-transport.ts` maps `projects:status` to it.
- `packages/ui/src/api/queries.ts`: `useProjectStatus(name)` is the existing TanStack Query entry (`["project-status", name]`), with invalidations after Git actions and SSE workspace changes.
- `packages/ui/src/api/client.ts` has a stale/narrow `GitStatus` declaration: it lacks `lastCommit`, `pathExists`, and `statusError`, and types `modified`/`untracked` as arrays although Rust returns counts. Extend this shared client contract rather than make another endpoint.
- Related presentational patterns: `packages/ui/src/components/atoms/BranchBadge.tsx` and `packages/ui/src/components/organisms/CommitDetailsPanel.tsx` (date formatting and a seven-character hash).

### Terminal scroll controls

- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`: four permanent 40px circular overlays: jump top, step up, step down, jump bottom. Click handlers preserve terminal focus and call xterm through `terminalRegistry`.
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx`: shows it only with an active session and `terminalScrollButtonsEnabled`; compact mobile changes its bottom offset to avoid `MobileTerminalAccessoryBar`.
- Preference is server-backed/global UI config: `packages/ui/src/stores/settings.ts`, `packages/ui/src/lib/ui-config.ts`; setting control is in `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`. It defaults off and step defaults to 3 (clamped 1–50).

## Recommended UX

### Commit context: compact status chip in terminal header (recommended)

Add a non-interactive, truncating `LatestCommitSummary` beside the `Terminal` label in `packages/ui/src/components/pages/WorkspacePage.tsx`'s existing terminal header. Resolve its project from the active terminal session; render nothing for free/unassigned terminals, loading, Git errors, detached/no-commit repos, or absent data. Show branch icon + branch, one-line commit message, a locale-formatted date, and 7-character hash; use a title/tooltip for full message/hash/date.

Why: it is visible while working yet does not cover xterm text or compete with per-terminal controls. The header is already the workspace terminal context, while the Git page remains the place for history/actions.

Alternatives:

1. Add it to each terminal runtime/tab label — stronger per-session association, but overcrowds labels and breaks on narrow/multi-pane layouts.
2. Add it to `ProjectInfoPanel` or the Git panel — minimal risk and data already reaches project context, but it is hidden during ordinary terminal work.
3. Place it as a terminal viewport overlay — always adjacent to output, but competes directly with search/accessory overlays and obscures text; reject.

### Scroll control: one expanding pill

Keep the four existing xterm actions and preference/step behavior. Replace the always-expanded vertical stack with a single low-profile bottom-right circular "scroll navigation" button. On click/tap it reveals a compact vertical pill/rail with top, up, down, and bottom icon buttons; close on a second click/Escape/outside click if project conventions support it. Use consistent lucide icons (replace raw `^`/`v`), clear focus-visible rings, 36–40px touch targets, and retain the mouse-down focus protection. Keep the current `TerminalRuntimeOutput` overlay position/mobile offset; no automatic xterm-scroll visibility heuristic in this scope.

This is simpler, reduces visual weight/occlusion, and requires no new persistence or backend work.

## Expected touch points

- `packages/ui/src/api/client.ts` — correct `GitStatus`/`LastCommit` client contract.
- New small focused UI component under `packages/ui/src/components/atoms/` or `molecules/` for commit summary; avoid expanding `WorkspacePage.tsx` with formatting logic.
- `packages/ui/src/components/pages/WorkspacePage.tsx` — map active session to project and host chip in terminal header.
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx` — visual/interaction redesign only.
- Optional focused styles/util helpers only if duplication is otherwise unavoidable.

## Tests

- `server/src/git/tests.rs` already verifies clean-repo last-commit hash/message; extend for non-empty/parseable date only if backend behavior changes (not expected).
- Add unit/render tests for commit summary: full fields, long message truncation/title, no-data/error/empty branch fallback, short hash, and date formatting helper if extracted.
- Update `TerminalScrollButtons.test.tsx`: still calls all xterm actions; assert disclosure state and accessible labels/focus preservation.
- Update `SettingsAppearanceSection.test.tsx`, `settings.test.ts`, `ui-config.test.ts` only if preference wording/defaults change (not expected).
- Browser regression recommended for desktop and compact/coarse-pointer layout: collapsed control does not cover mobile accessory bar; opening/clicking controls keeps terminal input focused.

## Risks / constraints

- The header must derive from the active session's project, not merely the selected project, so multi-project terminals do not show stale metadata.
- `lastCommit.date` is an RFC-2822 string, unlike Git-log epoch timestamps; format defensively and never throw on invalid data.
- Detached HEAD may report `HEAD`; preserve it rather than inventing a branch. Empty/default commit values occur for no repository/no commits/error responses and must be hidden.
- Extending the TypeScript `GitStatus` must preserve existing consumers (`ProjectInfoPanel`, terminal tree, branch control) and reflect the actual Rust serialized payload.
- No auth, database, permission, or configuration migration impact; project-status API is already authenticated by normal server middleware.

## Unresolved questions

- Should the commit chip be read-only (recommended), or open the Git side panel when clicked?
- For the scroll disclosure, should it dismiss automatically after an action, or stay open until explicitly closed? Recommended: stay open for repeated paging, dismiss on outside/Escape.
