# Phase 07 — end-to-end qualification and documentation

## Context links

- [Plan](./plan.md); [all acceptance contracts](./design-contract.md).
- [Server message phase](./phase-01-server-message-search.md); [Workspace integration](./phase-05-workspace-git-integration.md); [Git page integration](./phase-06-git-page-integration.md).
- Dependency: all implementation slices integrated. Coordinator owns this gate, shared fixes and recorded evidence.

## Overview

- Date: 2026-10-01. Priority: P2. Implementation: complete (2026-10-02). Review: complete (2026-10-02; score 9.4/10 PASS).
- Proved actual API + visible Git behavior across real throwaway repository and Playwright Chromium browser tests; documentation and architecture updated to match implementation. See the [qualification report](../reports/qualification-261002-0245-git-history-qualification.md), [tester report](../reports/tester-261002-0238-phase-07-qualification.md), and [code review](../reports/code-review-261002-0240-phase-07-qualification.md).
## Key Insights

- Existing Rust tests use real temp repositories; UI uses Vitest plus existing Chromium browser harness. Reuse them, no new test framework/dependencies.
- Planning only checked installed Git filter flags; feature/API/UI evidence still required.
- `pnpm check` includes native build as well as web/lint/server tests; report platform/prerequisite blockers honestly rather than silently reducing it.

## Requirements

- Deterministic regressions protect message matching/pagination and persisted selection identity/transitions; no permanent tests of wiring, copied keys or incidental wording.
- Run application against real throwaway repo and observe both actual surfaces; tests alone not proof.
- Capture screenshots at desktop/compact sizes, actual request scope and HEAD stability; no destructive actions on user's repositories.
- Update API/architecture/frontend/changelog after smoke; all statuses remain pending until evidence and every acceptance case complete.

## Architecture

Temporary real repositories → actual local server → owner-bound browser UI → persisted browser preferences → reload/navigation/scope transitions.

Fixture setup is throwaway outside user repository; application configuration temporary and explicitly local. Two profiles with same project name exercise ownership; feature requests use real backend, not a mocked log response. Do not include credentials in evidence.

## Related code files

Modify where necessary:

- Existing server Git/API tests and affected UI controller/store/GitPage/panel tests from prior phases.
- Create `packages/ui/browser-tests/git-history-search-persistence.browser.tsx` only for browser-dependent regressions (IME/focus/view selection/persistence interaction); follow current harness, don't permanently duplicate pure store tests.
- `docs/api-reference.md`: log query field, full-message matching, trimmed/literal/case behavior, matching offset, unchanged subject DTO, errors.
- `docs/frontend-components.md`: shared controller/store ownership, follow-active vs pinned, bulk-set independence, restoration/unavailable semantics.
- `docs/system-architecture.md`: change proposed subsection to implemented only when proven; record actual structure/invariants and plan link.
- `docs/CHANGELOG.md`: concise unreleased feature entry; no release/version bump in this task.
- `plan.md`, `cmd-plan.md`, phase statuses: update progress/evidence only after observed completion.

## Implementation Steps

1. Coordinator reviews integrated changes against contract: all Rust/client/hook callsites migrated; no obsolete local refresh/branch helpers or duplicate persistence scalar; page slices retain mutation safety. Use configured LSP references if available; no routine git validation commands.
2. Run focused checks once per integrated wave; final focused commands below. Fix observed failures, rerun only affected checks after fixes; never rerun user-reported failures just to confirm them.
3. Add permanent tests only where plausible consumer bug protected: older/body/literal matching and offset; owner/root/ref isolation; hydrate null-vs-[]; unavailable-bulk fail-closed; pin/follow-active/deletion; stale response/timer; view no-checkout. Delete old wording/key-copy/forwarding tests rather than repinning them.
4. Build disposable real repository with deterministic commits: initial body-only `needle-body`; >200 newer nonmatches; multiple distinct `release needle` matches separated by nonmatches; literal `.*`/`--flag`/`+ & # ? %`; local feature branch containing unique commit; remote ref and colliding local `origin/main`; nested Git root; worktree if existing harness supports it. Record hashes and HEAD before smoke.
5. Launch actual backend and browser hosts with isolated local config (`pnpm dev:server` and `pnpm dev` are existing commands). Existing server script binds 0.0.0.0 with --no-auth: prefer equivalent explicit loopback launch in isolated config; --no-auth only local without production environment. Do not overwrite user's config/ports or use user's repo for mutation scenarios.
6. Direct API smoke: request actual GET log with encoded messageQuery, root/ref/worktree, small limit/offset; assert exact expected commit hashes and subject/body behavior. Verify no-match, cleared term, controlled multiline/NUL, authorization boundary where configured, and unchanged HEAD. Record request examples/results without auth tokens.
7. Browser actual Workspace: open Git panel, select qualified project + nonactive branch, type term; observe old matching commit, correct subject/body hint, no graph edges while filtered, keyboard clear/Escape, page reset, valid error/no-match recovery. Select details and verify file diff target/root.
8. Browser actual Git page: exactly one project → select branch/root → search/paging/refresh; multi/empty selectors hide history; fetch/push controls still use intended targets. Multi/Clear preserve Workspace focus. Never click real destructive/publish operations; existing safety tests cover guarded mutation contract.
9. Persistence walkthrough: branch selected in Workspace → close/reopen → Git page same project → navigate away/back → reload. Repeat pin on another project/profile/root, return and assert each preference restored. Follow-active updates on externally changed checkout; pinned branch remains. View selection/restoration must leave HEAD unchanged.
10. Availability/race walkthrough: disconnect selected profile while saved selection nonempty (bulk not all); reconnect restores; delay old history/refresh then switch profile/worktree/root (old result not published); remove pinned branch in disposable fixture then refresh (visible follow-active fallback); fail discovery (pin not erased); vanished worktree remains fail-closed.
11. Verify desktop and compact Workspace mounts plus Git page narrow layout, accessible labels/tab order, IME composition on real Chromium, context-menu keyboard focus and error containment. Save screenshots under plan-specific evidence/artifact directory, not generated binaries in source folders. Browser test fixture mocks allowed only for browser-only edges, not substitute for real API/UI smoke.
12. Measure sparse/no-match history latency on reasonably large disposable repo and request count for fast typing. Document measurements/environment; don't invent SLA or add indexing/retry/telemetry. If unacceptable, report concrete design risk before expanding scope.
13. Run relevant complete suites/build/lint and broad `pnpm check` when platform prerequisites available. Record exact command/exit/outcome and any platform limit. Do not claim native visual verification from web Chromium alone; shared native mapping can be code/type verified, native UI qualification only where runnable.
14. After successful smoke, update listed docs/changelog and convert architecture proposal to actual behavior. Remove temporary fixtures/services/scripts created for smoke; no user source or unrelated state deletion. Keep only useful behavior regressions/evidence.
15. Mark phases complete only after their acceptance criteria and integration checks; final report includes scenario evidence, remaining risks and platform limits. No commit/push unless requested.

## Todo list

- [x] Qualify real message search/API target and pagination behavior.
- [x] Qualify both actual UI surfaces and restored selections.
- [x] Qualify unavailable/race/action-safety boundaries.
- [x] Run focused and integrated verification; record actual outcomes.
- [x] Update API/frontend/architecture/changelog to shipped behavior.

## Success Criteria

| Scenario | Required observation |
|---|---|
| Older-than-200 body match | Expected old hash returned/displayed; subject unchanged |
| Literal/case/query encoding | Exact matching hashes; punctuation not regex/options; encoded term intact |
| Filtered pagination/clear | Matching offsets, no duplicates; clear returns page 0 ordinary graph |
| Branch/root/profile/worktree isolation | Only selected scope's expected hashes/preferences; no cross-owner fallback |
| Project/branch restore | Navigation/remount/reload retains requested qualified project/branch intent |
| Bulk modes | Explicit [] all persists; multi persists; unavailable nonempty never all; Workspace focus retained |
| Follow-active/pinned | Every explicit selection pins, including active branch; survives external checkout. Explicit Follow action tracks checkout; missing confirmed pin visibly falls back |
| Stale response/refresh | Old scope cannot render actionable rows or write new scope's selection |
| Read-only restoration | HEAD unchanged after branch view selection and all restores |
| UI | Actual desktop/compact controls usable; errors distinct; filtered rows no fake ancestry |

### Validation commands

Run from repository root unless stated. These are planned commands, NOT planning-session results:

```sh
cargo test --manifest-path server/Cargo.toml git::tests::
pnpm --filter @dam-hopper/ui test src/stores/git-history.test.ts src/hooks/use-git-history-view.test.tsx src/components/pages/GitPage.test.tsx src/components/organisms/WorkspaceGitPanel.test.ts src/components/organisms/GitBranchControl.test.tsx
pnpm --filter @dam-hopper/ui test:browser browser-tests/git-history-search-persistence.browser.tsx browser-tests/project-worktree-target.browser.tsx browser-tests/consumer-context-menu.browser.tsx
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test
pnpm check
```

Coordinator selects actual new Git/API test name filter (must cover added tests, not just old names). If separate `server/tests/git_history_search_api.rs` created, also `cargo test --manifest-path server/Cargo.toml --test git_history_search_api`. Run modified-file Rust formatting and `pnpm exec prettier --write <modified TS/TSX/Markdown paths>`; not repository-wide format. Browser executable/channel overrides already supported by `vitest.browser.config.ts`.

## Risk Assessment

- Mock-only passing tests can miss ignored wire query or real Git matching semantics: mandatory direct API and actual browser smoke.
- Local --no-auth server exposed on 0.0.0.0: use loopback equivalent/isolated config and stop fixture services.
- Native full build/visual gate might need external toolchain: record exact platform blocker, never call web evidence native evidence.
- Existing empty/unborn Git behavior may be error rather than []: preserve and label error honestly; do not add unrequested fallback.

## Security Considerations

Disposable repos/config only; redact credentials. No actual force publish/checkout/rewrites in user repos. Observe owner generation/current target before state writes; browser preferences never contain tokens or commit message contents.

## Next steps
Phase 07 implementation, end-to-end qualification, documentation, and code review (score 9.4/10 PASS) are complete. Next steps: Coordinator integrated qualification closeout, whole-tree validation, and release readiness. Unresolved questions: none; external native platform qualification, if unavailable, is an explicit verification limit rather than claimed success.
