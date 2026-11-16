---
title: "Native Browser tabs and session continuity"
description: "Native-style Browser chrome, open tabs and owner-scoped address continuity without recreating live pages."
status: completed
priority: P2
effort: 48h
branch: feat/ai-os-redesign
tags: [feature, frontend, auth]
created: 2026-11-11
---

# Native Browser tabs and session continuity

## Authority and status
- **All Phases 01–05 complete (2026-11-12); automated qualification and Gate 2 docs reconciliation complete; human visual receipt ledger initialized as PENDING_HUMAN_REVIEW.** Canonical design: [architecture + UX + acceptance matrix](design.md).
- Settled choices: [coordinator decisions](reports/coordinator-decisions.md). Evidence: [UI](reports/ui-evidence.md), [sessions](reports/session-evidence.md); rejected report proposals are not requirements.
- Requested engine research: [combined recommendation](research/engine-scope-recommendation.md), [agent-browser](research/agent-browser-replacement-assessment.md), [OpenMausBot](research/openmausbot-agent-browser-integration.md); current proposed implementation scope remains unchanged.
- Planning complete: initial [review](reports/plan-review.md) and [targeted F1–F3 follow-up](reports/plan-review-followup.md) closed; [final scope validation](reports/final-validation.md) confirms UX-only scope. No engine replacement, implementation authorization or product pass inferred.
- Maintained-doc Gate 1 publication, Phase 01 owner/state contracts, Phase 02 persistence/lifecycle, Phase 03 tab-scoped root resources, Phase 04 native tab chrome & launch/recipe cutover, and Phase 05 targeted qualification, live acceptance authoring, and Gate 2 docs reconciliation completed `2026-11-12` (`publish-browser-architecture`, `bind-browser-owner-model`, `project-browser-continuity`, `own-browser-target-lifecycle`, `tab-fence-snapshots-popups`, `tab-key-root-viewers`, `compose-native-browser-chrome`, `cutover-browser-launch-recipes`, `author-browser-qualification`, `verify-browser-acceptance`, `reconcile-browser-docs`); human visual acceptance ledger remains PENDING_HUMAN_REVIEW.
- Explicit path remains usable. Active-plan persistence unavailable (`EVCRATE_SESSION_ID` unset); no activation/task hydration claimed.

## Fixed scope
- Native horizontal tabs, compact navigation, per-tab memory drafts, in-tab New Tab; existing dev/selection controls remain accessible.
- App reload/network reconnect reattaches exact live pages. Restart/missing targets stay unavailable until explicit Reload; never automatic recreation.
- Explicit window close destroys unshared targets, remembers ordinary committed addresses/order/active index. Default reopen with no existing Browser restores fresh pages lazily; New Window blank; URL/deep-link behavior and existing recipe execution semantics unchanged.
- Verified profile + normalized endpoint + server principal + prod/dev namespace ownership; popup URLs excluded; ordinary query/hash retained as plaintext with clear action and warning.
- Recovery updates/settlement/clear/consume and Browser address saves share origin-wide exclusive Web Locks with fresh durable reads; unavailable locking fails closed. Native-target close census/gate spans matching endpoint/principal/namespace/session across same-client profiles, without sharing credentials.
- Inactive tabs keep targets alive with **zero media/control attachments or audio**. Existing target/viewer budgets unchanged (default 2); useful capacity placeholders, no eviction.
- Unknown create/close outcomes remain visible and fail closed. No key replay/URL matching/empty-list proof; affected auto-restore blocked; manual inventory actions or explicit duplicate-risk acknowledgment only.
- No backend/API changes, new dependencies, search/favicons, background audio, new global shortcuts or browser-manager extras.

## Ordered phases
| Phase | Deliverable | Status | Effort |
|---|---|---|---|
| [01](phase-01-owner-and-state-contracts.md) | Publish intended architecture; verified owner + tab model | DONE (2026-11-11) | 8h |
| [02](phase-02-persistence-and-lifecycle.md) | Canonical projections, remembered groups, create/close reconciliation | DONE (2026-11-11) | 12h |
| [03](phase-03-tab-root-resources.md) | Tab-fenced snapshots/popups; stable active-only root viewers | DONE (2026-11-11) | 10h |
| [04](phase-04-native-chrome-and-launches.md) | Native chrome, drafts, recovery UI; every launch/recipe caller | DONE (2026-11-11) | 10h |
| [05](phase-05-qualification-and-docs.md) | Targeted regressions + full-app live visual acceptance; drift/docs | DONE (2026-11-12) | 8h |

## Ownership and overlap
- Future **BrowserIntegrator** is single sequential integration owner; phase DAG serializes all shared source/test files. New code modules <200 LOC; targeted edits only in existing large modules.
- Docs owner publishes Gate 1 before code and owns final Gate 2/changelog; no competing docs writers.
- [Host-review remediation](../261109-2251-host-browser-review-remediation/plan.md) phases 02/03/04: concurrent overlap in host/sync/window/persistence; serialize writers, preserve decimal-string fences; not a whole-plan blocker.
- [Login popup](../261111-0024-browser-cloudflare-google-login/plan.md) and [video/audio](../261111-0220-browser-video-audio-streaming/plan.md): informational baselines/potential writable overlap; no edits or qualification inferred from their labels.

## Acceptance and future checks
- Execute design matrix **A01–A15**; observable identity/network/resource/privacy checks, not screenshots alone.
- Phase 05 owns one integrated verification run after all edits: targeted UI/unit/browser/live journeys and approved colocated full-viewport captures; actual human hash-bound ACCEPTED receipt required for visual qualification, separate from automation/agent inspection.
- Phases 01–04 targeted UI/web build and Vitest unit checks ran `2026-11-11`; Phase 05 targeted Vitest unit suite (19/19 files, 207/207 passed), browser component regressions (10/10 files, 66/66 passed via `vitest.browser.config.ts`), TypeScript builds (`ui build` and `test:e2e:typecheck` clean), and full-app Playwright journey authoring completed `2026-11-12`. Mandatory colocated human visual receipt in `packages/ui/e2e/os-host-browser/tabs-visual/review.md` initialized as `PENDING_HUMAN_REVIEW` per repository governance.
- [Revision report + structural self-check](reports/planner-revision.md) supplements the original [planner report](reports/planner-report.md); no product verification or readiness inferred.

## Risks and gates
- Idempotency records expire after 600s; existing API cannot resolve arbitrary lost create by key. Explicit fail-closed recovery is intentional, not guaranteed cleanup.
- Local plaintext ordinary addresses can contain secrets, including same-tab OAuth; popup provenance exclusion is not general secret detection.
- LocalStorage or Web Locks failure blocks durable lifecycle mutation before dispatch; known-ID reconnect and drafts remain usable. Async unload saves are best effort, never an unlocked bypass.
- Material future changes require propagation through affected design/tasks/ownership/checks and appropriate review; existing research is not approval to add an automation dependency.

Unresolved product/scope questions: none. User selected `keep-ux`; agent-browser remains optional separate future work. Gate 1 publication, Phases 01–05 delivered and verified `2026-11-12`. Human visual review ledger in `packages/ui/e2e/os-host-browser/tabs-visual/review.md` remains PENDING_HUMAN_REVIEW as per project governance.

## Validation summary
- Live reconnect, close/reopen addresses and unchanged capacity confirmed; researched engine scope explicitly kept unchanged. Optional interview was offered/cancelled for research; no interview completion inferred. [Receipt](reports/final-validation.md).
- Phase 01 DONE (`completed`, 2026-11-11): code review 9/10 (user approved; 0 critical, 0 outstanding warnings); `pnpm --filter @dam-hopper/ui build` exit 0; 7 targeted Vitest files passed 64/64 (0 failed, 0 skipped: `connections.test.ts` 21/21, `connections-mfa.test.tsx` 4/4, `browser-host-client.test.ts` 8/8, `browser-owner-scope.test.ts` 5/5, `browser-tab-state.test.ts` 6/6, `HostSleepConsentHost.test.tsx` 5/5, `login-devices-connections.test.tsx` 15/15). Phases 02–05, runtime cutover, full suites, browser/E2E runs, and human visual receipt remain unexecuted.
- Phase 02 DONE (`completed`, 2026-11-11): code review Cycle 4 6/10 (approved per user direction for Phase 02 closeout; 0 critical build/runtime crashes; noted static concurrency and cleanup follow-ups tracked into Phase 05); `pnpm --filter @dam-hopper/ui build` exit 0; 9 targeted Vitest files passed 64/64 (0 failed, 0 skipped: `browser-tab-state.test.ts` 6/6, `browser-persistence.test.ts` 11/11, `browser-owner-scope.test.ts` 5/5, `browser-recovery-store.test.ts` 6/6, `persistence.test.ts` 21/21, `browser-session-inventory.test.ts` 4/4, `browser-create-lifecycle.test.ts` 4/4, `browser-close-lifecycle.test.ts` 3/3, `browser-window-lifecycle.test.ts` 2/2). Phases 03–05, tab-fenced viewers, runtime UX cutover, full suites, browser/E2E runs, and human visual receipt remain unexecuted.
- Phase 03 DONE (`completed`, 2026-11-11): code review Cycle 3 8/10 (user approved; 0 critical build/runtime crashes; noted non-blocking race/subscription edge cases tracked into Phase 05); `pnpm --filter @dam-hopper/ui build` exit 0; 12 targeted Vitest files passed 103/103 (0 failed, 0 skipped: `browser-session-sync.test.ts` 6/6, `browser-popup-tabs.test.ts` 3/3, `BrowserStreamKeepAliveHost.test.tsx` 30/30, `browser-tab-state.test.ts` 6/6, `browser-persistence.test.ts` 13/13, `browser-owner-scope.test.ts` 5/5, `browser-recovery-store.test.ts` 6/6, `persistence.test.ts` 21/21, `browser-session-inventory.test.ts` 4/4, `browser-close-lifecycle.test.ts` 3/3, `browser-create-lifecycle.test.ts` 4/4, `browser-window-lifecycle.test.ts` 2/2). Phases 04–05, native chrome and launch callers, full suites, browser/E2E runs, and human visual receipt remain unexecuted.
- Phase 04 DONE (`completed`, 2026-11-11): code review progression Cycle 1 (5/10, 2 Critical) -> Cycle 2 (7/10, 0 Critical) -> Cycle 3 (8/10, 0 Critical) -> Cycle 3 fixes applied (`browser-control-gate.ts` shared toolbar/canvas control serialization, `sanitizeBrowserError` static allowlist, `BrowserApp.tsx` typing, and serialization test coverage) & verified -> user approved after 3 review cycles; `Phase04TesterCycle4Clean` (PASS): `pnpm --filter @dam-hopper/ui build` exit 0 (0 diagnostics), `pnpm --filter @dam-hopper/web build` exit 0 (6120 modules), `pnpm --filter @dam-hopper/ui test` exit 0 (396/396 files, 3877/3877 tests, 0 failed, 0 skipped), and verbose 7-file Vitest check exit 0 (7/7 files, 113/113 tests: `BrowserApp.test.tsx` 19/19, `browser-navigation.test.ts` 7/7, `action-executor.test.ts` 12/12, `deep-links.test.ts` 23/23, `schema.test.ts` 9/9, `recipe-engine.test.ts` 12/12, `BrowserStreamKeepAliveHost.test.tsx` 31/31). Phase 05 integrated browser-mode (`vitest.browser.config.ts`), Playwright E2E (`e2e/**`), live visual acceptance, mandatory colocated human visual receipt (`packages/ui/e2e/os-host-browser/tabs-visual/review.md`), Gate 2 docs reconciliation, `pnpm lint`, and `cargo test` remain pending and unexecuted.
- Phase 05 DONE (`completed`, 2026-11-12): automated verification passed: `pnpm --filter @dam-hopper/ui build` exit 0 (0 diagnostics), `pnpm --filter @dam-hopper/ui test:e2e:typecheck` exit 0 (0 diagnostics), 19 targeted Vitest files passed 207/207, 10 browser component regression files passed 66/66 (`vitest.browser.config.ts`), total 273/273 automated tests passed (0 failed, 0 skipped); A01–A15 acceptance matrix mapped; full-app journeys authored (`tabs-session.spec.ts`, `tabs-recovery.spec.ts`, `tabs-visual.spec.ts`, `selection.spec.ts`, `navigation.spec.ts`); Gate 2 docs reconciliation complete (`docs/system-architecture.md`, `docs/architecture/host-browser-cdp-streaming.md`, `docs/design-guidelines.md`, `docs/code-standards.md`, `docs/CHANGELOG.md`); human visual decision ledger in `packages/ui/e2e/os-host-browser/tabs-visual/review.md` initialized to PENDING_HUMAN_REVIEW per repo governance.
