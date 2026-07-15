# Phase 01: Implement And Validate

## Context Links

- [Plan](./plan.md)
- [Architecture](../../docs/system-architecture.md)
- `packages/ui/src/lib/browser-notification-service.ts`
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`
- `packages/ui/src/components/pages/WorkspacePage.tsx`

## Overview

- **Date:** 2026-07-15
- **Priority:** High
- **Status:** Completed

## Key Insights

- Notification events already carry stable `sessionId`; no backend contract needed.
- Open-tab order is mutable display metadata, never navigation identity.
- `WorkspacePage` owns all state required to reveal and focus a terminal.
- Notification metadata must not consume the original body's 180-character allowance.
- Mounted-and-registered fallback is valid only when `alive` is undefined; explicit-dead sessions remain stale.
- Concurrent diagnostics changes in shared files must remain intact.

## Requirements

- Render `Project · Bash #N` without losing the Codex-provided title/body.
- Preserve the full 180-character allowance for the original body after adding metadata.
- Native notification selection focuses the app and originating xterm.
- Desktop IDE mode, Terminal mode, and compact Terminal surface are handled.
- Missing or explicitly dead sessions do not change navigation state or throw.

## Architecture

1. Terminal integration enriches notification delivery with project/order context.
2. Notification service binds a one-shot click handler and emits a typed selection event.
3. `WorkspacePage` validates the session, reveals Terminal, selects it, then schedules xterm focus.

## Related Code Files

- Modify notification service/integration and their tests.
- Add kebab-case notification navigation bridge and tests.
- Modify terminal panel/keep-alive/display props for order metadata.
- Modify `WorkspacePage` and its test additively.
- Update `docs/frontend-components.md` if behavior needs user-facing documentation.

## Implementation Steps

1. Add typed publish/subscribe helpers for notification terminal selection.
2. Format terminal context and bind native notification click handling.
3. Supply project and open-tab ordinal to mounted terminal integrations.
4. Handle selection in `WorkspacePage`, preserving diagnostics work.
5. Add unit coverage plus a Chromium integration test for popup-to-xterm navigation.
6. Run targeted tests, UI build/typecheck, web build, and lint.

## Todo List

- [x] Bridge and service implementation.
- [x] Terminal metadata wiring.
- [x] Workspace reveal/focus integration.
- [x] Tests and documentation.
- [x] Review findings resolved.

## Success Criteria

- Codex popup clearly identifies `Project · Bash #N`.
- Clicking it opens the exact live session and xterm accepts keyboard input.
- Stale notification clicks are harmless.
- Required automated checks pass.

## Risk Assessment

- Browser notification APIs vary; use feature-safe event binding.
- xterm may not be ready immediately; schedule focus after React state update.
- Concurrent shared-file edits require narrow additive patches.

## Security Considerations

- Do not include raw terminal output, command arguments, secrets, or cwd.
- Sanitize all notification text through the existing service.

## Validation

- Focused notification/navigation tests: 40/40 passed.
- Chromium browser suite: 3/3 passed, including the actual OSC9-to-Notification-to-click-to-`WorkspacePage`-to-xterm path.
- Added explicit-dead stale-registry and activation-timeout unsubscribe coverage.
- Full UI unit suite: 459/459 passed after the final test additions.
- UI TypeScript build and production web build passed.
- Feature-scoped ESLint and `git diff --check` passed.
- Repository-wide ESLint remains blocked by unrelated existing errors in `EditorTabs.tsx` and `use-coarse-pointer.ts`.

## Outcome

Implementation and browser coverage are complete. Final review scored 9.5/10
with no critical findings or warnings; user approved on 2026-07-15.

Unresolved questions: none.
