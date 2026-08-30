# Preflight: Project-Scoped Terminal Title Ordinals

## Output

Correct terminal title ordinals so each project has its own current 1-based sequence. Example: project A shows `a:bash #1`, `a:bash #2`; project B shows `b:bash #1`. Preserve the existing suffix-safe renderer and session identity behavior.

## Acceptance criteria

- Ordinals are counted independently by stable project key, in current `openTabs` order within each project.
- Reorder, attach, hydration, close, and removal recompute only the affected project's sequence.
- Project A and project B can both display `#1`; duplicate labels remain distinguishable inside a project.
- Project grouping uses explicit tab/session metadata, never regex parsing of display labels.
- Pending/project tabs retain their existing base labels and structured `{baseLabel, ordinal, fullText}` output.
- Split tabs, legacy tabs, runtime navigator/header, drag overlay, and browser handoff open targets use corrected ordinals.
- Mounted-only browser/runtime fallbacks remain readable and unsuffixed.
- `sessionId`, PTY actions, diagnostics, browser targets, keys, and callbacks remain unchanged.
- No backend, API, WebSocket, PTY, database, persistence, config, dependency, or notification-order changes.

## Scope boundary

In scope: frontend `TabEntry` project metadata, title projection grouping, production tab creation/hydration, focused unit/component/browser tests, existing frontend behavior docs, and plan bookkeeping.

Out of scope: server/API contracts, persistence schema, terminal lifecycle, `TerminalKeepAliveHost` notification ordering, visual redesign, and unrelated pre-existing worktree changes.

## Risk/public contract areas

- `TabEntry` gains presentation grouping metadata; base labels remain unsuffixed.
- `SessionInfo.project` is authoritative when available; explicit creation metadata must cover pending tabs.
- Projectless/free tabs use a stable sentinel and do not derive identity from labels.
- Existing `BrowserTerminalTarget` presentation data remains optional; `sessionId` remains identity.
- Ordinals are display-only and are not persisted or sent over transport.

## Affected files/systems

- `packages/ui/src/lib/terminal-title.ts` and focused tests.
- `packages/ui/src/components/organisms/TerminalTabBar.tsx` tab metadata type.
- `packages/ui/src/hooks/use-terminal-manager.ts` creation and projection.
- `packages/ui/src/lib/terminal-auto-attach.ts` hydration metadata.
- Existing title consumers and tests only where their structured title fixtures/expectations change.
- `docs/frontend-components.md` and new correction plan artifacts.

## Testing strategy

- Pure projection tests: same project, different projects, reorder/removal, duplicate labels, missing project sentinel, immutability.
- Manager tests: pending/open/hydrated project metadata and per-project ordinals.
- Existing focused title/component tests across all consumers.
- Chromium fixture: cross-project `#1/#2` reset, suffix geometry, accessibility fullText, handoff target semantics, and sessionId callbacks.
- UI TypeScript build and actual browser smoke with two projects.

## Open questions

None. User semantics are explicit: ordinal sequences reset per project.
