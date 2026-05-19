# Phase 05: Verification and Docs

## Context Links

- Overview: [./plan.md](./plan.md)
- Frontend components docs: [../../docs/frontend-components.md](../../docs/frontend-components.md)
- Code standards: [../../docs/code-standards.md](../../docs/code-standards.md)

## Overview

Priority: P1  
Status: Pending  
Goal: validate terminal workspace mode and docking behavior, then update docs for future maintainers.

## Key Insights

- Terminal behavior requires manual verification because xterm, reparenting, resize observers, and WebSocket PTY streams interact at runtime.
- Unit tests should cover pure config/layout logic.
- Manual checks should cover actual server-backed terminal sessions.

## Requirements

- Add/adjust unit tests for config, shortcuts, and docking helpers.
- Run web test suite.
- Run web build.
- Update docs for:
  - terminal workspace mode
  - shortcut setting
  - docking behavior
  - terminal layout persistence keys
- Do not mark complete if tests fail.

## Architecture

Testing layers:

- Unit:
  - `shortcuts.test.ts`
  - `ui-config.test.ts`
  - terminal layout docking helper tests
- Build:
  - `pnpm --filter @dam-hopper/web test`
  - `pnpm build`
- Manual:
  - run server and web app when available
  - verify terminal sessions against real PTY.

Docs:

- Update `docs/frontend-components.md` with terminal workspace and docking architecture.
- Update `docs/user-guide-multi-server-profiles.md` only if UI navigation text changes server profile behavior; otherwise skip.
- Update changelog/roadmap only after implementation, not during planning.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md`: document workspace mode and docking.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/CHANGELOG.md`: add entry after implementation.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/project-roadmap.md`: update progress after implementation if roadmap tracks this feature.

## Implementation Steps

1. Run unit tests:
   - `pnpm --filter @dam-hopper/web test`
2. Run build:
   - `pnpm build`
3. If config schema changed, run focused Rust config tests:
   - `cd server && cargo test config::tests::ui_config`
4. Manual verification with running app:
   - Open IDE workspace.
   - Launch terminal from Fleet Terminal.
   - Switch to Terminal workspace by button.
   - Switch back by shortcut.
   - Confirm no duplicate PTY/session appears.
   - Drag active terminal tab to center of another pane.
   - Drag active terminal tab to each edge.
   - Reorder tabs within a pane.
   - Drop tab into empty pane.
   - Close pane and verify terminal selection stays coherent.
5. Update docs after behavior is confirmed.
6. Record any residual limitations in changelog or plan notes.

## Todo List

- [ ] Add/run web unit tests.
- [ ] Run web build.
- [ ] Run focused Rust config tests.
- [ ] Manual terminal workspace verification.
- [ ] Manual docking verification.
- [ ] Update docs/changelog as appropriate.

## Success Criteria

- All relevant tests pass.
- Build passes.
- Manual runtime checks pass against real PTY sessions.
- Docs explain where mode state and docking layout are persisted.
- No unresolved blocker remains.

## Risk Assessment

- Automated tests cannot fully validate xterm reparent/focus. Mitigation: manual verification is required.
- Build may reveal unrelated existing type errors. Mitigation: report separately if unrelated and do not hide failures.

## Security Considerations

- Confirm no new unauthenticated routes or backend mutations were added.
- Confirm shortcut config does not expose command execution.

## Next Steps

After verification, implementation can be reviewed and committed with a focused conventional commit.
