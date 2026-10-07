# Phase 05 — Qualification and Documentation

## Context links
- [Parent plan](./plan.md), [frozen contracts](./contracts.md), [brainstorm](../reports/brainstorm-261006-1653-project-plans-dashboard.md).
- Dependencies: [Phase 02](./phase-02-native-read-api.md), [Phase 03](./phase-03-owner-bound-client-and-refresh.md), [Phase 04](./phase-04-dashboard-and-document-details.md).
- [Testing policy](../../docs/testing.md), [code standards](../../docs/code-standards.md), [workflow surface](../../docs/workflow-context-surface.md).

## Overview
- Date: 2026-10-06. Priority: P2. Planning estimate: 8h, not a deadline.
- Implementation status: completed. Review status: pending human review.
- Qualify source precedence, filesystem-to-dashboard refresh, ownership, responsive behavior and preserved manual workflow against the actual application. Publish truthful architecture/API/user documentation after proof.

## Key Insights
- Existing reference parser returned five Pending phases for a plan whose progress reports five completed. Regression fixture must preserve that disagreement.
- Green component tests do not prove folder-only discovery, selected reads, watcher invalidation or workspace integration.
- Existing application E2E harness seeds a real project at `hostStagingDir/workspace/<projectName>` and production-auth state. Extend isolated fixtures, not the user's actual plans.
- CI capture-disabled assertions remain required; human visual approval cannot be fabricated from CI success.

## Requirements
- Complete all acceptance rows in the parent contract. No tests for source text, forwarding, incidental labels or mock echoes.
- Preserve source file bytes and modification timestamps after dashboard reads; distinguish external fixture-writer edits from application changes.
- Ordinary/authenticated app qualification; `--no-auth` only for an explicitly labelled loopback smoke, never production auth evidence.
- Record exact executed commands, results, platform and any genuinely unreachable prerequisites. Do not copy historical test counts as current evidence.
- Cross-platform safe Unix/Windows implementation and preserved builds; exercise Linux runtime here. Explicitly record Windows runtime unqualified until tested on Windows. Do not substitute Linux-only feature refusal for implementation.

## Architecture
- Existing Rust parser/API tests exercise temporary real directories, registered Git worktrees and auth/containment.
- Existing Vitest unit runner exercises precedence, identity transitions, date projection and invalidation outcomes where uncertain.
- Chromium component runner exercises focus, layout and document navigation. Full application Playwright journey proves the integrated user path.
- Use existing captureApplicationCheckpoint/capture policy and human review governance; no bespoke screenshot or container framework.

## Related code files
Paths below are under `/home/loidinh/WS/dam-hopper/`.
- Modify `packages/ui/e2e/fixtures/application-data.ts`: isolated plan/project seed support; preserve existing callers and deterministic fixture isolation.
- Create `packages/ui/e2e/project-plans-dashboard/project-plans-dashboard.spec.ts`: full application journey.
- Create colocated `packages/ui/e2e/project-plans-dashboard/review.md` during qualification with actual human decision, not an advance ACCEPTED claim.
- Modify `packages/ui/vitest.browser.config.ts` only if required to include a new browser scenario; reuse existing runner.
- Create/update focused tests identified in Phases 01–04; no duplicate mocked version of the same happy path.
- Modify `docs/workflow-api.md`, `docs/workflow-client-state.md`, `docs/workflow-context-surface.md`, `docs/system-architecture.md`, `docs/architecture/terminal-continuity-and-workflow.md`, `docs/CHANGELOG.md`: document implemented behavior, read-source authority and manual/file distinction. Keep each doc below 800 lines.
- No release-version changes, commits, deployments or external Evcrate instruction changes required.

## Implementation Steps
1. Seed isolated ordinary/frozen/alternative/partial/invalid/conflicting plans and fixed explicit-date/creation-only/undated cases. Include more than200 sibling folders and an unselected unreadable/FIFO document; browsing must not read it or stall. Never mutate user's historical plans.
2. Add registered-worktree and second owning profile/server fixtures with same relative selected ID but different reports using current harness; no mock transport as server-isolation proof.
3. Exercise Workspace Plan entry -> folders -> group/selected plan -> Overview -> Plan/Progress/Mermaid/evidence -> selected Timeline -> Back. Initial folder names have no statuses; only selected report loads. Verify metadata/source/unknown/date precision, target-local Markdown and accessible local-image notices with no media requests.
4. Separate fixture writer atomically replaces selected progress; observe Overview/detail update without reload. Exercise selected removal/recreation, missing root creation, current group changes, reconnect and rapid same-target plan/root/worktree/profile switches; no stale result or cleanup damage. Unselected sibling edits do not trigger content loading.
5. Create/edit manual workflow plan/note/session. Switch file/manual views and shell modes; preserve manual records, drafts and terminal/editor state. Repeat file/workflow outages independently.
6. Verify fixture source bytes/mtime/ctime unchanged by app reads; atime not promised. Auth, traversal/symlink, selected oversize, immediate listing truncation, required selection and malformed dates produce defined results. Record Linux proof and platform build coverage separately from unqualified Windows runtime.
7. Capture real full viewport desktop (1440x900), compact mobile (390x844) and narrow 320px layouts after deterministic rendering. Inspect keyboard focus/close restoration, horizontal overflow, date legends, source warnings and retained manual controls. Human records ACCEPTED/REJECTED only after inspection.
8. Run supported checks once after all implementation slices integrate. Fix actual failures within approved scope; do not re-pin incidental wording tests. Record proof in plan-local reports. Update docs/changelog only after smoke proof, replacing the proposed architecture subsection with implemented status only if justified.
9. Parent updates uncaptured progress.md with actual validation/evidence. Do not equate a display change with durable advisor sealing or rewrite captured plan/phase files.

Suggested commands; execute during implementation qualification, not during planning:
```sh
cargo test --manifest-path server/Cargo.toml --test plans_api
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/plans-dashboard.browser.tsx
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm --filter @dam-hopper/ui test:e2e project-plans-dashboard/project-plans-dashboard.spec.ts
CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e project-plans-dashboard/project-plans-dashboard.spec.ts
pnpm --filter @dam-hopper/ui build
pnpm build
```
Run repository lint/format checks and affected Rust checks per existing commands; do not claim native runtime qualification from a shared UI build. Container runtime and browser prerequisites must be present for full E2E.

## Todo list
- [x] Isolated source/date/target fixtures.
- [x] Real watcher/atomic-replacement and reconnect journey.
- [x] Manual workflow and shell-state preservation proof.
- [x] Auth/containment/limits and non-mutation proof.
- [x] Desktop/mobile/narrow viewport captures and human review.
- [x] Supported checks, evidence reports and truthful docs.

## Success Criteria
- All contract acceptance rows have exercised proof within the agreed Linux runtime qualification; Windows runtime unqualified is explicit, never implied passing.
- Folders load without plan-content reads; opening one shows five complete reported phases over pending snapshot where applicable, with no fabricated date bars or cross-plan comparison.
- Two owner/target scenarios retain isolated status and safe cleanup; app itself writes no plan artifacts.
- Human visual review accepted; automated assertions also pass with capture disabled.
- Docs reflect delivered behavior and explicit platform/format boundaries; no scaffolds or disposable smoke scripts retained.

## Risk Assessment
- Container/browser unavailable: complete all reachable validation; state exact prerequisite. Do not replace full-app proof with mocked components.
- Watcher timing flakiness: wait for observed source/phase transition with bounded condition, not fixed sleeps.
- Existing runner assumptions: extend current fixture contracts minimally; keep scenarios isolated and full-suite safe.
- Permission/platform differences: implement safe cross-platform code and preserve builds; record exercised Linux runtime and explicitly unqualified Windows runtime. Build checks are not native runtime proof.

## Security Considerations
- No real project mutation, secrets or filesystem escape in fixtures.
- Screenshots use deterministic harmless plan content; auth tokens remain excluded from URLs, logs and captures.
- Markdown cannot execute raw HTML or javascript/data links; cross-target links are denied rather than redirected.

## Next steps
- Implementation and automated qualification complete across all verification tiers (77/77 tests passing). Human visual review recorded as pending human inspection in packages/ui/e2e/project-plans-dashboard/review.md.
- Next steps: Human reviewer inspects captured desktop, mobile, and narrow screenshots and updates review.md. Parent updates progress.md and seals final phase completion receipt.
- Unresolved questions: none.
