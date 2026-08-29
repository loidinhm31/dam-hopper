# Preflight Contract: Terminal Title Ordinals

## Output

Frontend-only change that adds a 1-based ordinal to each visible terminal title, for example `dam-hopper:bash #1`, while preserving the existing human-readable label and opaque `sessionId` identity.

## Acceptance Criteria

- Every open terminal title in the terminal panel displays the existing label plus ` #N`, where `N` is its current 1-based position in the global `openTabs` list.
- Titles remain unique across the open terminal list, including duplicate profile/shell commands and terminals split across panes.
- Ordinals update when the open-tab list changes (attach/hydration, close, removal, or ordering changes); no stale or doubled suffixes.
- The same display convention is used by the pane tab strip, runtime navigator, and active runtime header/compact title. Existing free-terminal labels remain understandable and receive the ordinal convention.
- Selection, close, pin, diagnostics, browser handoff, PTY attachment, and navigation continue to use `sessionId`; no ordinal is parsed or used as identity.
- Existing base labels remain unchanged apart from the ordinal suffix; no server/API/WebSocket/database/config contract changes.

## Scope Boundary

In scope: shared UI label formatting and the existing frontend data/rendering paths that expose terminal titles; focused unit/component/browser coverage; concise frontend documentation updates if the implementation changes documented behavior.

Out of scope: changing server session IDs or `incarnation`, changing PTY lifecycle/restart behavior, persistence, backend payloads, sidebar profile-instance semantics, notification payload semantics, visual redesign, or exposing UUID/timestamp IDs.

## Risk / Public Contract Areas

- API/data/auth/permissions: none; `SessionInfo.id` and transport payloads remain untouched.
- Compatibility: presentation-only; keep raw `sessionId` in keys, callbacks, diagnostics, and browser handoff metadata.
- Ordering: use the existing display-only open-list ordinal convention already used by terminal notifications; ordinals are not durable IDs and may change after removal/reordering.
- UX/accessibility: preserve truncation and action hit targets; visible/accessibility labels should include the ordinal without making close/pin controls ambiguous.
- Performance: derive one small order lookup per render or state projection; do not add polling, effects, or PTY work.
- Security/privacy: do not render opaque server IDs as the user-facing substitute; no new logging or persistence.

## Affected Files / Systems

Primary: `packages/ui/src/hooks/use-terminal-manager.ts`, `packages/ui/src/lib/terminal-auto-attach.ts`, `packages/ui/src/components/organisms/TabBar.tsx`, `packages/ui/src/components/organisms/TerminalTabBar.tsx`, `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`, and `packages/ui/src/lib/terminal-runtime-tree.ts` as needed by the chosen single-source presentation approach. Related focused tests: `terminal-auto-attach.test.ts`, `TabBar.test.ts`, `TerminalTabBar.test.tsx`, `ActiveTerminalRuntimeDisplay.test.tsx`, and `terminal-runtime-tree.test.ts`.

Backend `server/src/api/terminal.rs`, `server/src/pty/session.rs`, `server/src/pty/manager.rs`, and WebSocket event code are intentionally unchanged.

Repository evidence: `TerminalTabBar`/`TabBar` render `TabEntry.label`; `useTerminalManager` and `deriveTerminalAutoAttachState` currently derive duplicate base labels; runtime tree and active header consume labels; `TerminalKeepAliveHost` already computes current 1-based open-tab order for notifications. `docs/design-guidelines.md` is absent; use existing `docs/frontend-components.md` and `docs/code-standards.md` conventions.

## Testing Strategy

- Add/adjust pure label/ordinal tests for single, duplicate, free, missing/pending, and reordered/removed tabs.
- Add component assertions for pane tabs, legacy tab bar if still a supported surface, runtime navigator data, and active compact/desktop title.
- Run `pnpm --filter @dam-hopper/ui build` and the focused Vitest files; run the narrowest existing browser test that exercises terminal panel tab rendering if selectors permit.
- Manual browser smoke: open at least two same-command terminals, verify `project:command #1/#2`, close/reorder one, verify remaining ordinals and selection still target the correct session.
- No backend test changes expected; run server checks only if implementation unexpectedly crosses the API boundary.

## Open Questions

None. Assumption: `#N` means the existing global, current 1-based open-terminal position, not a permanent server ID or a per-profile counter. This is the least surprising convention because it already exists for terminal notification context and guarantees uniqueness among simultaneously open terminals.

## Alternatives Considered

- Display raw `sessionId`/`incarnation`: rejected as opaque, unstable across restart/recreate, and unlike the requested `#1` example.
- Count only duplicate labels per profile: rejected because numbers would not be globally unique and would introduce a second ordinal semantic beside the existing open-list convention.
- Assign a durable ordinal at creation: rejected because it needs persistence/state and would become stale after removal; not required for display distinction.
