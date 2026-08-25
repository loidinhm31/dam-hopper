# Phase 01: Implement and Validate

## Context Links

- [Plan](./plan.md)
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`
- `packages/ui/src/lib/terminal-notification-navigation.ts`
- `packages/ui/src/components/organisms/TopNav.tsx`
- `packages/ui/src/components/organisms/TopNavUtilityStrip.tsx`
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `docs/design-guidelines.md` if present; otherwise follow `packages/ui/src/index.css` tokens and existing header/popover conventions.

## Overview

- Date: 2026-07-16
- Priority: P2
- Status: Completed 2026-07-16 01:36 +07
- Add a focused notification store, accessible bell panel, and global toast viewport to the existing OSC 9 pipeline.

## Key Insights

- Native popup lifetime is browser/OS controlled; in-app UI provides durable session visibility.
- Parsing, sanitization, terminal identity, and click navigation already exist and must remain the single source of truth.
- In-app delivery must occur before and independently of native permission/rate-limit results.
- Compact header hides the desktop utility strip; render the bell in only one responsive location.

## Requirements

- Session-only history, newest first, maximum 50.
- Unique record IDs; unread count derived from record state and visually capped at `99+`.
- Panel: explicit per-item read via selection, mark all read, clear, empty state.
- Toasts: maximum 3 visible, 6-second timeout, manual close, polite live region.
- Toast dismissal does not change unread state.
- Selecting panel item or toast marks record read and dispatches existing session selection.
- Outside click closes while preserving the clicked target; Escape closes and restores trigger focus; expose expanded state and useful labels.
- Existing disabled setting prevents native, history, and toast delivery.

## Architecture

`xterm OSC 9 -> existing parser -> in-memory Zustand store -> history + toast`

`                                     -> existing BrowserNotificationService`

UI reads store through narrow selectors. Store owns record transitions only; components own panel focus and toast timeout effects. No persistent storage or server calls.

## Related Code Files

- Create `packages/ui/src/stores/terminal-notifications.ts` and unit test.
- Create focused bell/panel and toast viewport components/tests under existing atomic component conventions.
- Modify `packages/ui/src/lib/terminal-agent-notification-integration.ts` and its test.
- Modify `packages/ui/src/components/organisms/TopNav.tsx` and `TopNavUtilityStrip.tsx` for responsive placement.
- Modify `packages/ui/src/embed/dam-hopper-app.tsx` to mount one toast viewport.
- Extend existing browser navigation/header coverage where practical.
- Avoid unrelated dirty-worktree files, especially overlapping user edits.

## Implementation Steps

1. Define notification record/store actions: add, mark read, mark all read, clear, dismiss toast; enforce 50/3 bounds and stable unique IDs.
2. Publish parsed OSC 9 notifications into the store before attempting native delivery; keep current master-setting gate.
3. Implement accessible bell and feed using current tokens, Lucide icons, outside-click/Escape/focus restoration, and responsive placement.
4. Implement the fixed safe-area-aware top-right toast viewport with timer cleanup, selection, and manual dismissal.
5. Add happy-path, boundary, disabled, native-denied, timer, accessibility, and navigation tests.
6. Run focused tests, full UI tests, browser tests if environment permits, build, and lint. Review diff for security, performance, architecture, YAGNI/KISS/DRY.

## Todo List

- [x] Implement bounded store and tests.
- [x] Integrate OSC 9 publication and denied-native coverage.
- [x] Implement responsive bell/feed and tests.
- [x] Implement global toast viewport and tests.
- [x] Validate tests, build, lint, and review.

## Success Criteria

- A valid enabled Codex OSC 9 event immediately adds one unread feed record and one toast.
- Native browser permission cannot suppress in-app delivery.
- Bell remains reachable on desktop and compact layouts.
- Read/clear/dismiss transitions match the contract without leaks or duplicated state.
- Focus, labels, live region, Escape, and outside-click behavior are verified.
- Required automated checks exit successfully; any environment limitation is reported precisely.

## Risk Assessment

- Duplicate terminal events: assign unique record IDs; do not reuse native notification tags as record identity.
- Stale sessions: reuse existing selection dispatcher/listener behavior and close UI without crashing.
- Timer leaks: clear timeouts on toast removal and component unmount.
- Dirty worktree: inspect before edits and do not overwrite unrelated user changes.

## Security Considerations

- Render notification title/body as React text only; never HTML.
- Reuse parser sanitization and truncation.
- Keep history memory-only and bounded; no terminal content storage or logging.

## Completion

- Completed: 2026-07-16 01:36 +07.
- User approved the notification center implementation after validation and review gates.
- Validation passed: UI TypeScript compile; 93 files / 482 UI tests; 2 files / 10 browser tests; changed-file ESLint; feature diff and whitespace checks.
- Root `pnpm lint` remains blocked by three pre-existing errors in `EditorTabs.tsx` and `use-coarse-pointer.ts`; neither file is part of this feature.
- Unresolved questions: none.
