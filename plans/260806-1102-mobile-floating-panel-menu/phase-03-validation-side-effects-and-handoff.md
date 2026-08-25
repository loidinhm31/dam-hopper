# Phase 03 — Validation, Side Effects, and Handoff

## Context links

- [Parent plan](./plan.md)
- [Phase 01](./phase-01-compact-selector-and-header.md)
- [Phase 02](./phase-02-interaction-and-responsive-tests.md)
- [Frontend component contract](../../docs/frontend-components.md)
- [System architecture](../../docs/system-architecture.md)
- [Repository guidelines](../../AGENTS.md)

## Overview

- **Date:** 2026-08-06
- **Description:** Validate implementation, audit side effects, align existing docs, and complete review/test gates.
- **Priority:** P2
- **Implementation status:** Complete
- **Review status:** Complete

## Key Insights

- Change should remain a compact presentation swap. Any API/store/desktop-shell change indicates scope drift.
- `docs/frontend-components.md` currently promises bottom tabs and must be corrected if code changes; `docs/system-architecture.md` stays unchanged because no persistent architecture/API changes.
- Existing pnpm scripts provide all required unit, Chromium, TypeScript, and lint gates.

## Requirements

- `/code` must use the available frontend guidance skill (`frontend-dev-guidelines`/equivalent) and `web-testing`; call `ui-ux-designer` before UI choices.
- After implementation, run `code-reviewer`, then `tester`; route failures through `debugger`, rerun affected gates, and review final diff again.
- Update only the existing compact contract in `docs/frontend-components.md`; do not create `docs/design-guidelines.md`, `docs/project-roadmap.md`, or unrelated docs.
- Preserve unrelated dirty worktree files; verify scoped diff before completion.

## Architecture

Expected diff boundary: compact React shell + tests + one existing component-contract paragraph. No server, shared protocol, config, database, transport, desktop template, dependency, or build-system changes.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md` — replace bottom-tab wording with floating selector and compact header behavior.
- **Validate:** all files named in Phases 01–02.
- **Reference only:** `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md`, `packages/ui/src/components/templates/IdeShell.tsx`, `TerminalWorkspaceShell.tsx`, `TerminalFloatingToolPanel.tsx`.
- **Create/delete:** no production/docs files beyond Phase 02 browser test; no dependency changes.

## Implementation Steps

1. Inspect `git diff --` only for named files. Reject incidental formatting or user-dirty-file changes.
2. Update `docs/frontend-components.md` compact contract concisely; state one active surface, floating Panels selector, preserved mounted surface behavior, compact toolbar row, and desktop unchanged.
3. Run targeted unit tests: `pnpm --filter @dam-hopper/ui exec vitest run src/components/templates/MobileWorkspaceShell.test.tsx src/components/pages/WorkspacePage.test.tsx src/hooks/compact-workspace-media-query.test.ts`.
4. Run targeted Chromium tests: `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/mobile-workspace-shell.browser.tsx browser-tests/workspace-page-notification-navigation.browser.tsx`.
5. Run typecheck: `pnpm --filter @dam-hopper/ui build`. Run targeted ESLint via `pnpm exec eslint <changed TS/TSX files>`; run root `pnpm lint` or `pnpm check` if time/risk warrants.
6. `tester` verifies acceptance evidence at 320/375/666 and desktop. `debugger` owns any failure diagnosis; do not weaken assertions or skip failures.
7. `code-reviewer` checks accessibility, controlled-state integrity, safe area/z-index, reduced motion, content overlap, desktop isolation, and docs accuracy. Apply findings, rerun gates.

## Todo list

- [x] Scoped diff clean
- [x] Existing frontend contract updated
- [x] Unit and browser gates pass
- [x] Typecheck and lint pass
- [x] 320/375/666 and desktop evidence reviewed
- [x] Tester/debugger/code-reviewer gates complete
- [x] Side-effect checklist complete

## Success Criteria

- All observable acceptance criteria from parent preflight demonstrated.
- No new dependencies, backend changes, persistent state, architecture edits, or unrelated worktree mutations.
- Review finds no keyboard/focus, overlap, or desktop regression blocker.

## Risk Assessment

- **Broad lint/test failures:** distinguish pre-existing failures with evidence; never edit unrelated files to hide them.
- **Documentation drift:** update current compact paragraph only.
- **Artifact ambiguity:** rely only on supplied 52 px metadata; never invent absent artifact details.

## Security Considerations

- [x] **Auth/session/permissions:** no change; selector does not trigger privileged actions.
- [x] **API compatibility:** no endpoint, payload, transport, or public package contract change beyond internal shell rendering.
- [x] **DB/migrations:** none.
- [x] **Business logic:** existing mode/surface lists and fallback remain source of truth.
- [x] **Security/privacy/logging:** no artifact content, page HTML, labels, or interaction data logged/persisted.
- [x] **Performance/concurrency:** no polling/listeners added; Radix portal only while open; mounted-surface count unchanged.
- [x] **Docs/config/deployment:** one existing UI contract update; no config/env/package/deploy change.

## Next steps

- Hand plan to `/code`; implement phases sequentially, then return command outputs and viewport evidence.

## Completion Evidence

- Existing compact component contract is updated in the worktree; no docs file was edited in this bookkeeping pass.
- Targeted unit and browser gates passed (3 files/21 tests; 2 files/7 tests).
- Validation scope intentionally excludes full-repository checks and visual/accessibility snapshots.
- Production, test, docs, logs, and unrelated dirty files were not modified by this bookkeeping pass.

## Unresolved Questions

- None beyond the parent plan's panel-scope assumption; surface it before coding if contradicted.
