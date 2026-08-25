# Phase 05 — Release Validation, Documentation, and Rollout

## Context links

- [Parent plan](./plan.md)
- [Phase 04](./phase-04-ghost-geometry-and-explicit-history-list.md)
- [Brainstorm validation criteria](../reports/brainstorm-260716-0030-inline-terminal-suggestions.md#validation-criteria)
- [Configuration guide](../../docs/configuration-guide.md)

## Overview

- Date: 2026-07-16
- Description: prove safety/compatibility, document limits, and release behind fail-closed gates
- Priority: P1
- Implementation status: pending
- Review status: pending
- Effort: 14h

## Key Insights

- Unit/browser tests cannot replace real shell/PTY behavior.
- Geometry, IME, password prompts, line-editor modes, and prompt frameworks need matrix coverage.
- Current filesystem exhaustion blocks credible fresh test evidence.

## Requirements

- Free disk space before installing, building, or testing; record fresh command output.
- Run pure/controller/component/browser tests plus supported real-shell matrix.
- Cover password/no-echo, SSH-like, REPL, silent command, completion, vi/readline, paste, TUI.
- Test DOM renderer; WebGL per validated release policy; split/reparent/scroll/wrap/zoom/DPR.
- Manual real IME and screen-reader smoke on at least one desktop OS.
- Document lifecycle trust, shell support, fallback, history retention/clear, shortcuts, and mobile limit.
- Keep a kill switch: setting off immediately disables controller/UI/history persistence.
- Compare implementation with architecture and update intended drift before completion.

## Architecture

Release gate is layered: pure state tests -> fake transport/xterm controller tests -> real
browser layout/a11y tests -> real PTY/shell tests -> manual platform smoke. Automatic mode
defaults on only for verified supported capability; all other sessions expose explicit
fallback or disabled status without repeated toast noise.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/**/*.test.ts` — focused unit/controller coverage
- Modify/Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/**/*.test.tsx` — component/a11y coverage
- Modify/Create: `/mnt/data/ws/sharing/dam-hopper/tests/e2e-playwright/` — real browser/xterm scenarios if present
- Modify/Create: `/mnt/data/ws/sharing/dam-hopper/server/tests/` — PTY/shell lifecycle integration matrix
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/configuration-guide.md` — settings/privacy/clear/shell support
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — post-implementation drift review
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/ws-protocol-guide.md` — lifecycle event contract
- Modify: `/mnt/data/ws/sharing/dam-hopper/docs/codebase-summary.md` — shipped behavior/test inventory
- Modify: `/mnt/data/ws/sharing/dam-hopper/CLAUDE.md` — current test list/manual verification note
- Delete: none

## Implementation Steps

1. Free space and capture `git status`; reconcile all concurrent changes before validation.
2. Run targeted pure/controller/history tests; fix root causes, not expectations.
3. Run component/browser matrix for keys, geometry, reparenting, a11y, and storage controls.
4. Run Rust parser/PTY tests and real supported shells with common prompt frameworks.
5. Execute password/interactive/alternate-buffer scenarios and inspect localStorage for zero capture.
6. Perform IME/screen-reader/manual renderer smoke; record supported/fallback outcomes.
7. Run package lint/type-check/build, UI suite, Rust suite, then full `pnpm check` as capacity permits.
8. Update user/config/protocol/architecture docs and review architecture drift.
9. Roll out only for verified capability; retain immediate kill switch and unsupported-shell fallback.

## Todo list

- [ ] Resolve `ENOSPC`
- [ ] Complete pure/controller/component tests
- [ ] Complete browser geometry/key/a11y matrix
- [ ] Complete real PTY/shell/security matrix
- [ ] Complete manual IME/screen-reader smoke
- [ ] Run lint/type/build/full tests with fresh evidence
- [ ] Update configuration/protocol/architecture/codebase docs
- [ ] Security and code review
- [ ] Confirm fail-closed rollout and kill switch

## Success Criteria

- Zero captured secrets in every password/interactive regression scenario.
- Zero native-key byte regressions across supported shell/mode matrix.
- Zero stale acceptance; exact raw command/history fidelity corpus passes 100%.
- Ghost is cursor-adjacent or hidden across every geometry case; never stale/clipped.
- Unsupported shells, replay, respawn, SSH, and mobile remain explicitly fail closed.
- Fresh lint/type/build/test results pass; known unrelated failures are documented, not hidden.
- Architecture and user documentation match shipped behavior.

## Risk Assessment

- Platform/shell matrix may expose adapter incompatibility; reduce supported matrix, never weaken gate.
- Full disk can create misleading partial failures; do not claim test status before freeing space.
- Concurrent work may invalidate planned line paths; re-scout and preserve user edits.

## Security Considerations

Review marker parsing, nonce lifecycle, history migration, diagnostics redaction, and every
fallback path. Inspect persisted browser keys after negative scenarios. Never include raw
commands, OSC payloads, or nonces in reports/logs/screenshots.

## Next steps

After successful validation, request code review, land phases in dependency order, and
monitor capability fallback rates before expanding shell or mobile support.

## Unresolved questions

- Required OS/shell/framework matrix for release sign-off?
- May WebGL geometry fall back to DOM renderer?
- Which known unrelated failures may be documented versus must be fixed first?
