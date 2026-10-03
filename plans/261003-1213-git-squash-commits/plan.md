---
title: "Squash commits in Git panel and Git page"
description: "Shared consecutive-commit squash with atomic local rewrite and explicit leased publication."
status: completed
priority: P2
branch: main
tags: [feature, frontend, backend, api]
created: 2026-10-03
---

# Squash commits in Git panel and Git page

## Deliverable
Select at least two consecutive commits in either Git surface, edit the complete combined message, and squash locally. Pushed commits supported with shared-history warning. Linear history only; selected or rewritten-descendant merges blocked. Publication stays separately prepared and explicitly confirmed with exact-OID lease.

## Contract and evidence
- [Preflight, acceptance criteria and side-effect checklist](./preflight.md).
- [Backend scout](../reports/scout-261003-1213-squash-backend.md).
- [Frontend scout](../reports/scout-261003-1213-squash-frontend.md).
- User decisions: include pushed commits; linear history only.
- Current repo raw rewrite/CAS and shared view/actions/leased push are authoritative; no external research required.

## Architecture decision
Use existing raw Git object rewrite safeguards, not interactive rebase/reset. Synthesize one commit from newest selected tree, oldest predecessor/author and current committer; remap linear descendants, preserve final tree/index/worktree, move only active branch through locked CAS. Reuse full-message snapshot reads, signature consent, owner/root fencing and explicit leased push.

Alternatives: CLI rebase offers familiar Git semantics but adds worktree/index/conflict side effects; latest-N reset is simpler but cannot squash an older selected range and disturbs index semantics. Raw-object linear squash fits existing engine and agreed scope.

## Phases
| Phase | Status / progress | Contract |
| --- | --- | --- |
| 01 Backend squash | Implemented and verified | [Backend](./phase-01-backend-squash.md) |
| 02 Shared selection/dialog/API and both surfaces | Implemented and verified | [UI](./phase-02-shared-squash-ui.md) |
| 03 Integrated qualification/review/docs | Complete; user approved implementation | [Qualification](./phase-03-qualification-finalization.md) |

API contract permits independent backend/frontend implementation after common DTO decisions. Both must settle before checks/qualification; proceed through all feature scope, no phase-boundary stop.

## Safety and non-goals
- Active checked-out branch, qualified available target/worktree/root; no bulk/cross-project squash.
- Ordered oldest-first exact OIDs; reject gaps/duplicates/unreachable/stale/merge ranges without moving refs.
- Full UTF-8 message bodies preserved in draft; signature removal consent is explicit.
- Root and older ranges supported; dirty worktree preserved; remote untouched by squash.
- Separate same-history-root Publish rewritten branch confirmation; no unconditional force/auto-push.
- No new dependencies, assets, database/config changes, persistent selection or automatic development commit/push.

## Validation and ownership
Real temporary Git/repos/bare remotes, in-process API tests, focused UI behaviors/typecheck/build, real isolated server+Chromium journeys on both surfaces, independent tester and terminal code review with user approval. [Phase 03](./phase-03-qualification-finalization.md) owns evidence and actual doc updates; no fake/mocked E2E claims.

Current evidence: [Integrated qualification](./reports/qualification.md). Focused Rust: 34 passed; full UI: 2,245 passed; Chromium components: 9 passed; UI TypeScript/lint/web build passed. Actual Workspace and nested-root Git-page squash plus successful/stale leased publication exercised. Review findings resolved. Full broad gates (`pnpm check` and complete server `cargo test` across 55 suites / 1,750 tests) are verified green; deb and rpm native packaging succeeds. User explicitly selected “Approve implementation”; no development commit/push.

Handoff: `/cmd-code plans/261003-1213-git-squash-commits/plan.md`. Default advice mode; no active advisor run supplied/created. cmd-code sole implementation/finalization owner. Do not mutate prior sealed plans/evidence. UI designer required during frontend implementation; dedicated design-guidelines.md absent in repository discovery, use existing frontend docs/components. No setup/onboarding required. Open questions: none.
