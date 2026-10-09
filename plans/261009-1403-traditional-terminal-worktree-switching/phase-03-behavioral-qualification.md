# Phase 03 — Behavioral qualification

## Context links

- [Parent plan](./plan.md); [routing](./phase-01-scoped-target-routing.md); [UI](./phase-02-sidebar-worktree-dropdown.md).
- [Testing policy](../../docs/testing.md); [browser regression](../../packages/ui/browser-tests/terminal-traditional-projects.browser.tsx).

## Overview

Date: 2026-10-09. Priority: P2. Estimate: 2h. Implementation: complete. Review: complete.
Prove selected worktree affects newly launched real terminals, not existing ones; qualify actual desktop/compact UI.

## Key Insights

- Existing Chromium fixture uses real DOM but mocked transport/terminal attachment. It cannot certify server target resolution or process cwd.
- Existing navigator tests pin class names, text layout, query forwarding and no-worktree-query when metadata disabled. Those incidental/wiring assertions must be deleted, not re-pinned to the new markup.
- New permanent tests must target plausible consumer-visible bugs, not dropdown mount, callback echo or merely nonempty output.

## Requirements

- Deterministic, isolated fixtures with root, feature worktree, detached/shared-commit paths, unavailable/prunable/bare and valid locked worktree.
- Same-name projects on two independent profiles; qualified root never inherits a bare target.
- Real application proof of new PTY cwd, old PTY identity/cwd/output, root return and fail-closed owner behavior.
- Fresh screenshots reviewed by a human. CI assertions cannot synthesize ACCEPTED status.

## Architecture

Tier 2 covers shared scoped-state/launch boundary regressions where existing tests exist. Tier 3 extends Traditional Chromium interactions. Tier 4 or a throwaway real-app smoke covers server/PTY execution. Add a permanent E2E only for the uncertain end-to-end routing/unchanged-live-session invariant, using existing application services and capture policy.

## Related code files

Modify:
- `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`.
- `packages/ui/browser-tests/terminal-traditional-projects.browser-fixture.tsx`.
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`: delete incidental/wiring assertions, retain or move genuine behavior coverage.
- `packages/ui/src/stores/project-target.test.ts` and relevant existing terminal-manager/Project-panel tests only where scoped behavior changes.
- `docs/worktree-operation.md`: add Traditional sidebar instructions and immutable existing-terminal semantics after smoke proof.
- `docs/system-architecture.md`: replace proposed design status with implemented/qualified facts only after proof.
- `docs/CHANGELOG.md`: concise feature entry after delivery; follow existing release convention, no version bump solely for this plan.

Create if using permanent full-app regression:
- `packages/ui/e2e/traditional-terminal-worktree-switching/traditional-terminal-worktree-switching.spec.ts`.
- Required colocated capture/review artifacts under repository policy, not ad-hoc screenshots claimed as reviewed.

Reuse `packages/ui/e2e/fixtures/` application services/data/capture helpers. No new runner or copied container harness.

## Implementation Steps

1. Update fixtures with explicit profile-qualified projects and multiple worktrees; reset target stores/query clients/runtime state per case.
2. In Chromium, select a feature target then root. Assert visible choice, distinct project contexts and unchanged existing terminal tab/split selection. Verify selector works when commit metadata disabled and Free group lacks it.
3. Exercise keyboard: project roving navigation, focus selector, open/choose, Escape/focus restoration. Repeat inside compact Projects Dialog; dropdown choice must not dismiss project sheet.
4. Exercise unavailable/prunable/bare/locked/detached states; equal commit or branch does not conflate paths. Verify fresh-open discovery and failure preserving selection; retired generation cannot overwrite new owner state.
5. Run real application with isolated root and Git-linked feature worktree. Start root shell, record server session id/incarnation and cwd, and print a unique root marker. Select feature in sidebar, click New, execute `pwd` and a branch-specific file read; assert actual directory and content. Original root shell still reports root `pwd`, same id/incarnation and continuing output. Return to Project root, open new shell and assert root again.
6. Run same-name two-profile isolation and disconnected-owner denial. No request or session appears on the other owner. After selection, open Project panel and verify synchronization; switching there updates sidebar.
7. Run focused existing suites once after integration, then package typecheck. Suggested commands:
   - `pnpm --filter @dam-hopper/ui exec vitest run src/stores/project-target.test.ts src/components/organisms/ProjectInfoPanel.test.ts`
   - `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-traditional-projects.browser.tsx`
   - `pnpm --filter @dam-hopper/ui exec tsc -p tsconfig.json --noEmit`
   - If E2E added: `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui exec playwright test traditional-terminal-worktree-switching/`
   Update selectors to actual affected test inventory; do not claim unexecuted commands passed.
8. Capture real application at wide, narrow and compact layouts with dropdown open and selected feature. Human review checks truncation, focus, clipping and touch layout; retain honest review status until inspected.
9. Only after runtime proof, update guide/changelog/architecture, remove throwaway smoke scaffolds and report exact exercised checks and remaining platform limits.

## Todo list

- [x] Scoped target/launch consumer regressions.
- [x] Desktop/compact browser interactions and discovery edges.
- [x] Real PTY cwd and preserved old-session lifecycle proof.
- [x] Same-name multi-profile and disconnected-owner proof.
- [x] Fresh actual-app captures and human review.
- [x] Typecheck and focused affected suites.
- [x] Current docs and changelog match delivered behavior.

## Success Criteria

All parent-plan contract items pass. No wiring/class-name/text-layout tests substituted for behavior; no browser fixture mistaken for full-app proof. Feature declared complete only after real PTY scenario and required visual review. Linux/web evidence separate from untested native/Windows behavior.

## Risk Assessment

Full-app services may require container runtime/browser prerequisites. Validate infrastructure using existing readiness probes; do not silently downgrade to mocked evidence. Record exact unavailable environment prerequisite if blocked.

## Security Considerations

Use isolated repositories/profiles; never mutate user's live worktrees or PTYs. Loopback-only no-auth permitted for throwaway development smoke, not production/Advisor. No secrets in captured artifacts.

## Next steps

Visual review inspection by human reviewer and merge readiness.

## Unresolved questions

None.
