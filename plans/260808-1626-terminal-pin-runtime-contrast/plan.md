---
title: "Terminal Pinning and Runtime Contrast"
description: "Add shared session-only terminal pin protection and improve Runtime terminal readability without changing PTY or persistence contracts."
status: completed
priority: P2
effort: 8h
branch: main
tags: [feature, frontend, terminal, accessibility]
created: 2026-08-08
---

# Terminal Pinning and Runtime Contrast

## Outcome

One memory-only `TabEntry.isPinned` state drives Traditional/IDE and Runtime controls. Pinned tabs cannot invoke tab-close/PTY termination; unpin restores existing close semantics. Runtime gains clearer output/surface separation and a more legible shared xterm palette, without a second renderer/theme.

## Working assumptions

- Pin lifetime = current `useTerminalManager` mount only. No server, workspace, URL, browser-storage, or config persistence.
- Live Traditional UI is `TabBar.tsx` through `PaneContainer`; `TerminalTabBar.tsx` currently owns the shared type but is not mounted.
- Existing explicit lifecycle paths (process exit, profile deletion, direct kill/remove actions) remain unchanged; pin protects the tab close action.

## Preflight contract

- Scope: `packages/ui` client state, components, styles, and focused tests only.
- Done: both modes show pin + close when unpinned; pinned state is selected and close absent; unpin restores close; manager rejects pinned tab close; mode switch and auto-attach refresh preserve pin.
- Visual: Runtime output clearly separates from navigator/header; ANSI text, focus, hover, active, and pressed states remain readable.
- Constraints: no backend/API/schema/config/dependency/image work; no broad redesign; unpinned close still kills PTY and removes UI state.

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| Optional `isPinned` on shared `TabEntry` | Small prop flow; same state already feeds both modes | Recommended |
| Separate manager `Set<sessionId>` | Extra synchronization with tab discovery/removal | Reject |
| Persist pin in server/storage | New contract, stale cleanup, exceeds session-only need | Out of scope |

## Phases

| # | Phase | Status | Effort | Progress | Link |
|---|---|---|---:|---:|---|
| 1 | Shared pin state and controls | Completed | 4h | 100% | [phase-01](./phase-01-shared-terminal-pin-state.md) |
| 2 | Runtime contrast and validation | Completed | 4h | 100% | [phase-02](./phase-02-runtime-contrast-and-validation.md) |

## Side-effect review

- [ ] Auth/session/permissions: no change; “session-only” means React manager lifetime, not authentication session.
- [ ] API/database/config: no change; no payload or persisted field.
- [ ] Business logic: only close guard + transient toggle; unpinned PTY kill unchanged.
- [ ] Security/privacy: no new data, telemetry, storage, or terminal-content access.
- [ ] Performance: one boolean per open tab and O(n) immutable toggle; negligible.
- [ ] Docs/deploy: none expected. Update `docs/frontend-components.md` only if implementation materially changes documented terminal behavior; never touch modified `docs/system-architecture.md` for this internal flow.

## Architecture gate

Existing UI flow/state change only: `WorkspacePage → useTerminalManager → shared tabs → both renderers`. No server/public contract or architecture invariant changes. Architecture docs need no pre-plan edit; post-implementation review should confirm this remains true.

## Implementation and validation status

- Completed shared session-memory pin state, close guard, Traditional/Runtime controls, metadata propagation, and focused coverage.
- Completed shared xterm contrast palette, semantic terminal hosts, Runtime framing/focus states, and DOM assertions.
- Validation evidence present in the feature changes and focused tests; no fresh commands run during this tracking-only update.
- Manual Chromium/host checks remain follow-ups from Phase 02 and do not block plan bookkeeping completion.

## Handoff

Implementation is complete. Validation commands and manual mode-switch checks remain documented in Phase 02 for follow-up execution.

## Unresolved questions

- Fresh automated validation was not rerun during this tracking-only update.
- Manual Chromium contrast, mode-reparent, PTY identity, and host/renderer checks remain unresolved.
