# Phase 04 — Unit Tests and Focused Browser Harness

## Context links

- Parent: [plan.md](./plan.md)
- Dependencies: [phase-01](./phase-01-dependency-and-search-controller.md), [phase-02](./phase-02-find-bar-and-terminal-panel-lifecycle.md), [phase-03](./phase-03-active-pane-shortcut-and-reparenting.md)
- Existing test command: `pnpm --filter @dam-hopper/ui test`
- Existing browser host: `apps/web`
- Official addon behavior: https://github.com/xtermjs/xterm.js/blob/master/addons/addon-search/README.md

## Overview

- Date: 2026-07-15
- Priority: P2
- Status: Pending
- Review status: Not started
- Description: Cover pure behavior in Vitest and add a minimal Playwright harness for real xterm rendering, decoration, focus, and navigation.
- Estimate: 3.5h

## Key Insights

- Current Vitest tests are primarily Node/pure-function tests; they cannot prove canvas/WebGL decoration or browser focus.
- Playwright infrastructure is new, so keep it feature-specific and avoid turning it into a full application E2E suite.
- Real xterm behavior should be tested with deterministic terminal writes, not a live PTY transcript or timing-sensitive server output.

## Requirements

### Unit coverage

- Controller: open/close, empty query, match, no match, next, previous, result event normalization, clear/dispose, independent sessions.
- Shortcut helper: Ctrl+F, Meta+F, modifier rejection, `preventDefault`, return value, coexistence with Ctrl/Cmd+Shift+F and existing shortcuts.
- Attachment/integration helper: inactive controller close if that behavior is placed in attachment code.
- Find bar: static accessibility contract can be checked with existing render style; interactive focus/Escape belongs in browser coverage unless adding a DOM test dependency is justified.

### Browser coverage

Add the smallest supported Playwright setup (config, one deterministic fixture/harness, one spec, and package/root script). The fixture should use the production `TerminalFindController` and `TerminalFindBar` with a real `Terminal` and `SearchAddon`, then write known lines into the buffer.

Required scenarios:

1. Open via Ctrl+F; browser default is suppressed; input receives focus and existing text is selected.
2. Enter a query; match decorations appear; status reports `1 of N`.
3. Next and previous move the active result and update status.
4. No-match state shows `No matches`; empty query clears decorations and shows neutral status.
5. Escape and close clear the bar and restore xterm focus.
6. Search input/navigation does not cause fixture PTY-write counter to increase.
7. DOM renderer/default path works; WebGL path is attempted where the browser/runtime supports it and otherwise covered by documented manual verification.
8. Optional focused reparenting check: move the terminal element between two hosts and confirm the bar remains attached without creating a second terminal.

## Architecture

```text
Playwright browser
  → test-only xterm fixture/harness
  → real Terminal + SearchAddon + production controller/bar
  → deterministic buffer + DOM assertions
```

Do not make the test depend on Rust, auth, WebSocket timing, or a user's workspace. If the repository convention requires a root-level Playwright config, keep the fixture under `packages/ui/e2e` and scope the web server command to the fixture. If a browser test against the full app is chosen instead, use `--no-auth` and a deterministic seeded session, but do not add a second production API.

## Related code files

Modify/create:

- `packages/ui/src/lib/terminal-find-controller.test.ts` — controller tests.
- `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts` — shortcut tests.
- `packages/ui/src/lib/terminal-host-attachment.test.ts` — only if needed.
- `packages/ui/package.json` — focused browser script/dev dependency if owned by UI package.
- `package.json` — root forwarding script only if consistent with repo conventions.
- `pnpm-lock.yaml` — Playwright dependency resolution.
- `packages/ui/e2e/*` or repository-standard e2e directory — fixture/spec/config.

Delete: none.

## Implementation Steps

1. Add unit tests using fakes for `SearchAddon`, controller snapshots, and keyboard events.
2. Select the smallest Playwright ownership/configuration that does not affect production bundles.
3. Add deterministic fixture markup with stable `data-testid` hooks and a PTY-write counter.
4. Instantiate real xterm and SearchAddon in the fixture; reuse production controller/bar modules.
5. Write ANSI/plain text lines covering repeated, wrapped, and no-match cases.
6. Assert text/status/focus and search decoration presence without relying only on screenshots.
7. Add optional screenshot/debug artifact handling for failures, not committed golden images.
8. Run package unit tests, type-check, browser tests, and lint; record missing browser dependencies as a setup gate.

## Todo list

- [ ] Add controller unit tests.
- [ ] Extend shortcut unit tests.
- [ ] Add fixture and Playwright config/script.
- [ ] Test open/query/navigation/no-match/close/focus.
- [ ] Test no PTY writes from find UI.
- [ ] Cover renderer fallback or document the unsupported WebGL environment.
- [ ] Run all relevant checks.

## Success Criteria

- Unit suite proves deterministic state and shortcut behavior.
- Playwright proves actual xterm addon search, decorations, navigation, and focus.
- Browser test is isolated, deterministic, and does not require a running server/database.
- No broad E2E framework or unrelated test migration is introduced.

## Risk Assessment

- Risk: browser tests fail in environments without installed browsers. Mitigation: document `pnpm exec playwright install` as setup and keep unit tests authoritative for CI without browsers.
- Risk: WebGL is unavailable in headless CI. Mitigation: test default renderer in CI; include a manual WebGL/fallback matrix and only gate WebGL if the runner supports it.
- Risk: testing implementation details creates brittle specs. Mitigation: assert user-visible status/focus/decorations and a write counter, not xterm internals.

## Security Considerations

- Fixture data must be synthetic; never use real terminal output or credentials.
- Keep Playwright artifacts out of source control and avoid logging query/output text.

## Next steps

Run the manual cross-layout/rendering matrix and update the architecture/component docs in Phase 05.
