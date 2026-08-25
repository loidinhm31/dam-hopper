# Phase 05 — Validation, Documentation, and Release Gate

## Context links

- Parent: [plan.md](./plan.md)
- Dependencies: [phase-01](./phase-01-dependency-and-search-controller.md), [phase-02](./phase-02-find-bar-and-terminal-panel-lifecycle.md), [phase-03](./phase-03-active-pane-shortcut-and-reparenting.md), [phase-04](./phase-04-unit-and-browser-tests.md)
- Architecture: `docs/system-architecture.md`
- Component docs: `docs/frontend-components.md` if present
- Roadmap: `docs/project-roadmap.md` if present

## Overview

- Date: 2026-07-15
- Priority: P2
- Status: Pending
- Review status: Not started
- Description: Validate the feature in the real workspace layouts and update documentation to reflect the shipped client-only search boundary.
- Estimate: 1.5h

## Key Insights

- The search feature changes terminal UI behavior but not server contracts.
- The important regressions are focus, shortcut precedence, addon lifecycle, renderer behavior, and reparenting—not backend correctness.
- Documentation must explicitly state the 5,000-line client buffer boundary so users do not infer server-history search.

## Requirements

- Run the repository's relevant checks: UI build, UI Vitest tests, lint, and focused Playwright test.
- Run manual checks against a local server in `--no-auth` mode if a full-app path is used.
- Validate at least:
  - Chrome/Chromium desktop, light/dark app styling as applicable.
  - DOM renderer and WebGL renderer/fallback.
  - one terminal, multiple tabs, split panes, tab switch, pane focus switch, drag/dock/reparent, workspace mode switch.
  - active and inactive sessions, empty/no-match/multiple-match query, Escape/close, selection restoration.
  - mobile/custom-keyboard mode does not unexpectedly invoke native keyboard.
- Update component/architecture/roadmap docs only after behavior is stable.
- Keep docs under the repository's size and naming standards.

## Architecture

Document the final flow in the existing frontend architecture section:

```text
PTY output → xterm buffer (scrollback 5000)
Ctrl/Cmd+F → active PaneContainer handler
           → per-session SearchAddon/controller
           → portal find bar in terminal.element
           → local decorations/status/focus restore
```

Record invariants:

- Search is local to one visible active xterm buffer.
- Search queries never use transport/API/server history.
- Terminal/controller/addon lifetime follows `TerminalPanel`, not pane host lifetime.
- Reparenting moves the existing DOM element and does not recreate search state while active.
- Inactive session search is closed/cleared.

## Related code files

Modify after implementation:

- `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — TerminalPanel/data-flow and feature progression.
- `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md` — if this file exists and owns component behavior.
- `/mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md` — mark the planned terminal search item complete or update phase status.

No source files should be changed in this phase except small fixes discovered by validation; such fixes must return to the owning phase and be retested.

## Implementation Steps

1. Run unit/build/lint/browser checks and capture failures by phase.
2. Start the local server with no-auth only for full-app manual checks; use synthetic terminal output.
3. Exercise the matrix across active/inactive sessions and reparenting paths.
4. Check decoration contrast, focus ring, button labels, status announcements, and keyboard behavior.
5. Verify no search query appears in transport calls, diagnostics, URL, localStorage, or PTY writes.
6. Update existing docs with scope, lifecycle, data flow, limitations, and test commands.
7. Re-run the full relevant validation after documentation/source fixes.
8. Request code review before claiming completion; record any deferred browser/renderer limitation.

## Todo list

- [ ] Run UI build and tests.
- [ ] Run lint and focused Playwright.
- [ ] Complete renderer/layout/manual matrix.
- [ ] Verify no PTY/network/persistence leakage.
- [ ] Update architecture/component/roadmap docs.
- [ ] Re-run checks after docs/source fixes.
- [ ] Obtain code review.

## Success Criteria

- All automated checks pass, or documented environment-only limitations have an owner.
- Manual matrix confirms active-only behavior, focus restoration, reparenting, renderer decorations, and no input leakage.
- Docs describe the feature and its client-buffer limitation accurately.
- The final diff contains only scoped dependency, UI, tests, harness, and documentation changes.

## Risk Assessment

- Risk: manual matrix reveals browser-specific renderer behavior. Mitigation: preserve DOM fallback and document supported browser behavior; do not weaken search semantics.
- Risk: architecture docs drift from implementation. Mitigation: update only after final code review and compare lifecycle/data-flow statements with the code.
- Risk: scope expands into global search or server history. Mitigation: reject those changes from this plan and create a separate plan if needed.

## Security Considerations

- Terminal output can contain secrets; tests/docs must use synthetic content and avoid query/output telemetry.
- No server endpoint, persistence field, or auth scope is needed.
- Review any diagnostic/logging changes to ensure search state is not included.

## Next steps

After this release gate, either mark the plan complete or open a separate follow-up for explicitly excluded features such as server history, all-terminal search, or advanced search options.
