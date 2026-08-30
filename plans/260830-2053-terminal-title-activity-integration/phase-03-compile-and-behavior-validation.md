# Phase 03 — Compile and Behavior Validation

## Context links

- [Parent plan](./plan.md)
- [Reconciliation phase](./phase-02-merge-and-reconcile-terminal-contracts.md)
- [`packages/ui/package.json`](../../packages/ui/package.json)
- [`apps/web/package.json`](../../apps/web/package.json)
- [`apps/native/package.json`](../../apps/native/package.json)

## Overview

- Date: 2026-08-30
- Priority: P1
- Implementation status: Pending
- Review status: Pending
- Description: Prove derivation, component composition, browser rendering, activity/restart transitions, and host compilation after the merge.

## Key insights

- Unit tests prove pure projection and state precedence; Chromium proves truncation, accessibility, and real rendered coexistence.
- UI TypeScript build catches the broad `TabEntry`/`DisplayTabEntry` migration.
- Complete develop integration also warrants web/native builds and Rust regression tests, run once after focused UI gates.

## Requirements

- Fix source contracts, never weaken/delete one branch's assertions to obtain green.
- Keep focused test file selection deterministic.
- No formatter. Run lint only once in Phase 4 after code is stable.

## Architecture

Validation order: conflict hygiene → pure/state tests → component tests → Chromium scenarios → UI/web/native compilation → Rust regression.

## Related code files

### Focused unit/component tests

- `packages/ui/src/lib/terminal-title.test.ts`
- `packages/ui/src/lib/terminal-auto-attach.test.ts`
- `packages/ui/src/lib/terminal-runtime-tree.test.ts`
- `packages/ui/src/lib/browser-terminal-handoff.test.ts`
- `packages/ui/src/lib/terminal-output-activity.test.ts`
- `packages/ui/src/lib/terminal-stream-replay-gate.test.ts`
- `packages/ui/src/lib/traditional-terminal-projects.test.ts`
- `packages/ui/src/hooks/use-terminal-manager.test.ts`
- `packages/ui/src/components/organisms/TabBar.test.ts`
- `packages/ui/src/components/organisms/TerminalTabBar.test.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx`
- `packages/ui/src/components/organisms/SplitLayout.test.ts`
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`

### Browser tests

- `packages/ui/browser-tests/terminal-title-ordinals.browser.tsx`
- `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`
- `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx`

## Implementation steps

1. Check merge hygiene:
   ```bash
   git diff --check
   git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- .
   ```
2. Run focused unit/component tests:
   ```bash
   pnpm --filter @dam-hopper/ui test -- \
     src/lib/terminal-title.test.ts \
     src/lib/terminal-auto-attach.test.ts \
     src/lib/terminal-runtime-tree.test.ts \
     src/lib/browser-terminal-handoff.test.ts \
     src/lib/terminal-output-activity.test.ts \
     src/lib/terminal-stream-replay-gate.test.ts \
     src/lib/traditional-terminal-projects.test.ts \
     src/hooks/use-terminal-manager.test.ts \
     src/components/organisms/TabBar.test.ts \
     src/components/organisms/TerminalTabBar.test.tsx \
     src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx \
     src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx \
     src/components/organisms/SplitLayout.test.ts \
     src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx
   ```
3. Require assertions for same-project `#1/#2`, another project `#1`, projectless/free grouping, starting labels, reorder/close recompute, base-state immutability, structured title plus activity in one row, stopped/unavailable/receiving/quiet precedence, replay exclusion, restart reopening, authoritative project hydration, local-stop/pin preservation, and Traditional aggregate status.
4. Run focused real-browser scenarios:
   ```bash
   pnpm --filter @dam-hopper/ui test:browser -- \
     browser-tests/terminal-title-ordinals.browser.tsx \
     browser-tests/terminal-traditional-projects.browser.tsx \
     browser-tests/terminal-panel-replay-notifications.browser.tsx
   ```
5. Visually verify in Chromium: base truncates while ` #N` remains; exactly one accessible full title; indicator and title coexist; project aggregate changes on live-output transitions; replay/synthetic restart banner does not turn green; fresh post-restart output does.
6. Compile affected hosts/packages:
   ```bash
   pnpm --filter @dam-hopper/ui build
   pnpm --filter @dam-hopper/web build
   pnpm --filter @dam-hopper/native build
   ```
7. Run the server regression gate once because complete develop ancestry includes Windows PTY changes:
   ```bash
   pnpm test
   ```
8. On failure, repair the source behavior and rerun the exact failed command. After it passes, rerun all Phase 3 commands once for coherent final evidence.

## Todo list

- [ ] Merge hygiene clean
- [ ] Focused UI tests pass
- [ ] Focused Chromium scenarios pass
- [ ] UI, web, and native builds pass
- [ ] Server tests pass
- [ ] Exact command/exit evidence recorded

## Success criteria

- All commands exit zero with no skipped named contract.
- Browser evidence demonstrates title/activity/Traditional/restart coexistence.
- Compilation proves all migrated callers agree on structured display types.

## Risk assessment

- **Chromium unavailable:** install repository-supported Playwright Chromium; do not substitute unit-test confidence for visual proof.
- **Ref drift removes a test path:** locate its merged successor and preserve the same observable contract; never silently omit it.
- **Late fix invalidates evidence:** rerun the complete phase.

## Security considerations

- Fixtures use synthetic metadata only. Do not emit real PTY output, tokens, registry values, or browser-debug artifacts.

## Next steps

Pass exact commands, exits, browser observations, and changed paths into Phase 4 review.
