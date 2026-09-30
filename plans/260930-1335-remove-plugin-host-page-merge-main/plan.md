---
title: "Remove standalone PluginHostPage and merge main"
description: "Delete the standalone plugin page and route, reconcile all nine merge conflicts, and verify the integrated Advisor and native-hook changes."
status: completed
priority: P2
effort: 3h
branch: feat/plugin-platform
tags: [refactor, frontend, backend, docs, plugins]
created: 2026-09-30
---

# Remove PluginHostPage and merge origin/main

## Context and boundaries

- Source of conflict decisions: [debugger report](../reports/debugger-investigate-260930-1329-plugin-host-page-merge-analysis.md), especially §§3–5. Observed revisions: `feat/plugin-platform` HEAD `b3046625`; `origin/main` `bdd7f0e4`; report merge base `443b934c78f72bc76b8ec008265f74b60d263255`.
- Hard cutover: remove the page, its dedicated test, lazy import, and `/plugins/:installationId` route. No bookmark unavailable screen, redirect, alias, replacement route, or new wildcard fallback. Existing unmatched-route behavior stays unchanged.
- Preserve `PluginHost.tsx`, `PluginUnavailableState` where used elsewhere, `WorkspaceAdvisorHost.tsx`, and `.plugin-host-page` CSS: frame/container consumers still need them. Preserve sandbox/CSP, owner-generation revocation, qualified targets, and plugin registry/deployment contracts.
- Reuse canonical ownership helpers; no plugin-platform redesign, new abstraction, native-hook changes beyond the merge, or speculative third-party plugin host.
- Repo guidance: `AGENTS.md`, `docs/code-standards.md`, existing focused plans. `docs/development-rules.md` and local `.omp/skills/` are absent; planning/advisor skills read directly from installed `~/.omp/agent/skills/`.
- Architecture reviewed: `docs/system-architecture.md` profile ownership and trusted-plugin host invariants. Removal changes entry routing, not frame isolation or wire/schema contracts; no architecture redesign required. Planning deliverable edits only this plan.

## Phases

| Phase | Work | Status | Estimate | Dependency |
| --- | --- | --- | --- | --- |
| 1 | Remove component, dedicated tests, lazy import, route | Completed (`6a73637b`) | 0.5h | Clean, understood working tree |
| 2 | Merge pinned main; resolve all nine reported conflicts | Completed (`5895431d`, `43a98463`) | 1.5h | Phase 1 removal committed |
| 3 | Reconcile docs; tests, actual UI smoke, reviewer/advisor gate | Completed (`122f4b55`) | 1h | All merge resolutions landed |

## Phase 1 — Removal of PluginHostPage component, test file, and dam-hopper-app route

1. Inspect `git status --short`, branch, and `git rev-parse origin/main` before changing code. Require `feat/plugin-platform` and target `bdd7f0e4`; preserve unrelated user changes. Do not reset/clean, indiscriminately stash, or fetch a newer main into this merge. If refs changed, reconcile against the report before proceeding.
2. Delete `packages/ui/src/components/PluginHostPage.tsx` and `packages/ui/src/components/PluginHostPage.test.tsx`. Dedicated test contains no shared utilities or unrelated suite; do not move or re-pin obsolete unavailable/bookmark tests.
3. Modify `packages/ui/src/embed/dam-hopper-app.tsx`: remove the entire `const PluginHostPage = lazy(...)` block and its entire `<Route path="/plugins/:installationId" ... />`. Keep `lazy`, `Suspense`, and `ErrorBoundary` for other routes, plus all existing workspace/settings/Git/legacy redirect behavior.
4. Search active source/tests for `PluginHostPage` and the removed route; migrate any live caller actually found. Historical plans/reports remain historical evidence, not active contracts. Do not delete container CSS by name similarity.
5. Stage only these three removal paths and commit, e.g. `refactor(ui): remove standalone plugin host page`. Commit before merging so Git does not block on local modifications. Defer broad checks until Phase 3.

**Acceptance:** both files absent; no lazy import or standalone route; no bookmark stub/redirect; integrated Workspace Advisor remains the supported Advisor entry point.

## Phase 2 — Merge origin/main into feat/plugin-platform and resolve conflicts

Run `git merge --no-ff --no-commit origin/main` after verifying the pinned target. A nonzero conflict exit is expected, not a reason to abort or choose a blanket side. The debugger predicts nine conflicted paths; deleting the two page files first converts their conflicts to modify/delete. Preserve all non-conflicting changes from both branches. Inspect any additional conflict caused by baseline drift rather than ignoring it.

| # | Conflicting file | Exact resolution |
| --- | --- | --- |
| 1 | `docs/CHANGELOG.md` | Keep both September 30 milestones: HEAD's **Workspace-integrated Advisor — Phase 09 paired qualification, docs, and release handoff DONE (2026-09-30; 100%)**, and main's **Codex and Claude native-hook status — Phase 06 DONE (2026-09-30 Asia/Saigon; 100%)**. Adopt main's blank lines before older date headings. Do not drop either qualification record. |
| 2 | `docs/codebase-summary.md` | Keep HEAD's Repomix v1.18.0 generated header/statistics and Workspace Advisor summary. Adopt main's Markdown table-column formatting, D03 `POST /api/plugins/view-context` documentation, and Agent Status Phase 06 qualification text. Rewrite the Advisor summary to say standalone `/plugins/:installationId` routing is completely removed, not fail-closed behind a bookmark stub. |
| 3 | `packages/ui/browser-tests/project-worktree-target.browser.tsx` | Take main's clean multiline `Link` mock in `vi.mock("react-router-dom")` and main's `vi.fn(...)`-wrapped `useGitPrepareLeasedPush` / `useGitPublishLeasedPush` mocks in `vi.mock("@/api/queries.js")`. Keep HEAD's `toServerProjectTarget` mock in `vi.mock("@/api/client.js")`; do not replace the whole test file. |
| 4 | `packages/ui/src/components/PluginHostPage.tsx` | Resolve modify/delete in favor of deletion with `git rm packages/ui/src/components/PluginHostPage.tsx`. Do not resurrect main's multi-profile page or HEAD's Advisor unavailable stub. |
| 5 | `packages/ui/src/components/PluginHostPage.test.tsx` | Resolve modify/delete in favor of deletion with `git rm packages/ui/src/components/PluginHostPage.test.tsx`. Do not retain describeView mocks or standalone routing assertions. |
| 6 | `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx` | Take main's complete version: synchronize `internalLauncherRef` and `externalLauncherRef` in `setLauncherElement`, retain its scoped `react-hooks/immutability` suppression, and omit unused `AdvisorSlotPlacementMode` import. |
| 7 | `packages/ui/src/plugins/use-plugin-host.ts` | Take main's complete version: canonical `@/api/ownership.js` import, `useEffect` updating `onUiIntentRef` with `[onUiIntent]`, and effect-based owner-change revocation with `[ownerKey]`. Do not carry HEAD's unparameterized effect or synchronous ref checks / broad `react-hooks/refs` disable. |
| 8 | `packages/ui/src/plugins/use-plugin-navigation.ts` | Combine both: main's `import { toServerProjectTarget } from "@/api/ownership.js"`; HEAD's exact `isAdvisorMetadata` predicate `metadata.id === "evcrate.advisor"`; HEAD's `meta.id !== "evcrate.advisor"` filters in standalone navigation item lists. Preserve target/owner qualification and other ordinary-plugin behavior. |
| 9 | `server/tests/plugin_api_integration.rs` | In `test_describe_view_api_behavioral`, use main's token subject `"bob-new-user"`, already seeded. Remove HEAD's extra `"bob-view-user"` user fixture and corresponding `("bob-view-user", "session-bob-view")` session fixture when now unused; keep the existing bob-new-user/session-bob-new seed and other test behavior. Do not loosen authorization or change expected responses to make tests pass. |

For files 6–7 only, `git restore --source=origin/main --worktree -- <path>` can materialize the chosen version; then explicitly stage it. Resolve the mixed files surgically. Stage all resolved paths with `git add -- <explicit-paths>`; resolve deleted paths with `git rm`, not an incoming checkout. Confirm `git diff --name-only --diff-filter=U` returns no paths and inspect affected source/docs for conflict markers. Keep the merge uncommitted through Phase 3; no `git add .` or unrelated cleanup.

**Acceptance:** all nine decisions implemented; both deleted files remain deleted; both branches' qualification work survives; no unmerged entries or conflict markers; no route resurrection from automatically merged code.

## Phase 3 — Documentation and test verification

### Documentation reconciliation

- `docs/CHANGELOG.md`: retain both milestones above and the September 28 historical multi-profile fix. Add a concise delivered-change entry recording complete page/test/route removal and intentional bookmark behavior; clarify any historical `PluginHostPage` mention as superseded, not currently available.
- `docs/codebase-summary.md`: ensure the merged current-state source map describes `WorkspaceAdvisorHost.tsx`, removal of standalone routing, view-context API, and native-hook qualification. Keep the existing generated-header provenance; do not fabricate fresh compaction metrics. Stay within the repo's 800-line documentation limit.
- `docs/frontend-components.md`: reconcile main's incoming paragraph naming `PluginHostPage.tsx` / `.test.tsx` to `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx` / `WorkspaceAdvisorHost.test.tsx`. Describe integrated Advisor placements (IDE dock, Terminal float, compact overlay); remove current standalone-routing claims and state no bookmark unavailable screen.
- Preserve immutable historical plans/reports. Update any additional *active* documentation only if the merged content still claims the removed route is supported.

### Exact verification commands

Main agent owns project-wide validation, once after all edits land. Commands below run from repository root unless specified. Install dependencies with `pnpm install --frozen-lockfile` only if missing; browser tests require configured Chromium/Playwright. Rust authenticated integration tests require disposable MongoDB (`TEST_MONGODB_URI`, default `mongodb://127.0.0.1:27018`); the existing helper attempts Podman Mongo 8.2 startup. Ensure it is actually ready, not silently absent; never point tests at production data.

```bash
# Focused retained behavior (no deleted-file test invocation)
pnpm --filter @dam-hopper/ui test -- src/components/organisms/WorkspaceAdvisorHost.test.tsx src/plugins/use-plugin-navigation.test.tsx
pnpm --filter @dam-hopper/ui test:browser -- browser-tests/project-worktree-target.browser.tsx browser-tests/workspace-advisor.browser.tsx
cargo test --manifest-path server/Cargo.toml --test plugin_api_integration test_describe_view_api_behavioral -- --exact --nocapture

# Full required suites and static checks, once after integration
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
cargo test --manifest-path server/Cargo.toml
pnpm --filter @dam-hopper/ui build
pnpm lint
pnpm build
```

`cargo test --manifest-path server/Cargo.toml` is the root-safe equivalent of exact command `cargo test` with working directory `server/`; do not run both redundantly. The repo's documented broad `pnpm check` gate includes web build, `pnpm build:native`, lint, and Cargo tests: use it instead of duplicating those checks when native build prerequisites are available; still run UI build and Vitest/browser suites separately. Record command, exit status, counts/skips, and prerequisite failures accurately. Fix consumer-visible failures; delete obsolete incidental-behavior tests rather than re-pinning them. Never claim environment-blocked checks passed.

### Actual application smoke (required; suites alone insufficient)

Launch the web application with `pnpm dev`; use its printed local URL and the existing authenticated plugin-capable test backend/profile. In Chromium:

1. Open `/plugins/evcrate.advisor` directly and reload. Verify the shell's existing unmatched-route behavior, **no** `Plugin · Unavailable`, no plugin host iframe, no replacement redirect, and no legacy page chunk request. Repeat an unknown installation bookmark to cover the removed route pattern, not just one ID.
2. Open `/workspace`; launch Advisor via existing integrated controls. Verify IDE dock, Terminal float, and compact overlay still mount the integrated host. Close/reopen it; change owner/profile and observe old frame/session revocation without stale data or cross-profile requests.
3. Verify Advisor absent from standalone top-nav plugin entries; existing `/`, `/workspace`, `/git`, `/settings`, `/agent-store`, `/usage`, supported `/ssh-forwarding`, and `/terminals` / `/ide` redirects still behave as before.
4. Capture visual evidence and observed routing/network results; close browser tab and owned dev services. Remove throwaway smoke scaffolds. If a real authenticated Advisor runtime is unavailable, run a throwaway mounted-app/host scenario and explicitly report the physical/runtime visual limit—do not mark real integration qualified.

### Explicit code-reviewer and advisor checkpoint

1. Obtain a **code-reviewer** review of the complete removal plus resolved merge, including both source deletions, route absence, every mixed-file resolution, owner revocation effects/ref synchronization, authenticated bob-new-user fixture, docs, and terminal verification evidence. Store report under this plan's `reports/`; no review limited to the easy deletion diff.
2. Before acting on terminal reviewer findings or declaring the merge ready, execute a fresh named advisor checkpoint **`review:plugin-host-removal-merge`**. Ask: “Does the resolved merge satisfy complete standalone-page removal while preserving Workspace Advisor isolation, qualified ownership, and both qualification milestones; what must block completion?”
3. Follow installed `.omp/evcrate/workflows/advisor-mentoring.md`, falling back to `~/.omp/agent/evcrate/workflows/advisor-mentoring.md`: caller manages task state `init → checkpoint → controller → state get → disposition → outcome → complete`; invoke POSIX controller `~/.evcrate/bin/evcrate-advisor` with the exact v2 checkpoint JSON on stdin. Supply terminal reviewer/test evidence, bounded changed paths, at most four `{path, excerpt, digest}` file objects, precise constraints, prior counsel/disposition if any. No secrets, broad dumps, fabricated digests, or provider overrides. Tool-less counsel agent must not invoke the controller itself.
4. Require terminal `ADVICE_READY`; record recommendation and owner accept/reject rationale. `FAILED`, malformed output, unavailable controller, and `needs_human` leave the gate incomplete, never implied approval. Resolve accepted must-fix findings; rerun only affected checks after corrections and refresh review evidence when needed.
5. After docs, verification, smoke, and both review gates pass, explicitly stage changed documentation/resolutions, complete merge commit (e.g. `chore: merge main into plugin platform`), and record pinned incoming parent plus validation/review artifacts. Never push unless requested. Mark this plan completed only with evidence.

**Acceptance:** required UI/Cargo suites and lint/build gates pass; actual route removal observed; retained Advisor behavior exercised; current docs consistent; code-reviewer report and fresh advisor disposition recorded; merge includes `bdd7f0e4` and excludes both deleted files.

## Risks and unresolved questions

- Expected bookmark breakage is intentional. Do not “fix” it with a stub or fallback route.
- Existing ordinary-plugin navigation can still produce `/plugins/<id>` links; the debugger identifies only Advisor installed currently. Preserve its hooks/tests as requested; generic third-party hosting is explicitly outside this cutover. If merged runtime reveals another installed consumer, report that concrete scope conflict rather than silently designing a replacement.
- Missing MongoDB/browser/native toolchains or controller are verification prerequisites, not permission to weaken tests or claim qualification. Preserve plugin registry/packages and explicit disabled intent throughout.
- No unresolved product questions. Execution prerequisites and any findings remain implementation-time evidence, not completed checks in this planning deliverable.

## Implementation Status & Next Steps (2026-09-30)

- **Phase 1 (DONE):** Removed `PluginHostPage.tsx`, `PluginHostPage.test.tsx`, lazy import and route in `dam-hopper-app.tsx` (`6a73637b`).
- **Phase 2 (DONE):** Merged `origin/main` (`bdd7f0e4`) into `feat/plugin-platform`, reconciled all 9 conflict files (`5895431d`), and resolved ESLint immutability / duplicate mock keys (`43a98463`).
- **Phase 3 (IN PROGRESS):**
  - Docs reconciled in `docs/CHANGELOG.md`, `docs/codebase-summary.md`, and `docs/frontend-components.md`.
  - Automated tests verified: 1,978 UI unit tests passed, 223 browser tests passed, cargo test passed, UI build passed, ESLint passed (0 errors, 130 warnings).
  - Code review completed (`plans/reports/code-review-260930-1400-plugin-host-page-merge.md`). Score: 9.8/10.
  - Next step: Execute advisor checkpoint `review:plugin-host-removal-merge`.
