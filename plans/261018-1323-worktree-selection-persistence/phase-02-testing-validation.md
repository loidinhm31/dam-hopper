---
title: "Phase 02 — Testing and validation"
description: "Unit and integration test suites for store persistence, isolation, failure handling, and hook reactivity."
status: completed
priority: P2
effort: 2.5h
branch: feat/worktree-select-persistence
tags: [testing, frontend, vitest, worktrees]
created: 2026-10-18
---

# Phase 02 — Testing and validation

## Overview
Priority P2 · status completed · effort 2.5h. Author regressions concurrently with Phase 01 against the [frozen contract](plan.md#frozen-parallel-contract); execute only after both phases finish. Implementation and verification completed.

## Context links
- [Store implementation contract](phase-01-store-persistence.md), [target tests](../../packages/ui/src/stores/project-target.test.ts), [hook tests](../../packages/ui/src/hooks/use-project-target.test.tsx).
- [Fresh-reset tests](../../packages/ui/src/lib/fresh-state-reset.test.ts), [reconciliation tests](../../packages/ui/src/hooks/use-worktree-target-reconciliation.test.tsx), [dropdown regression tests](../../packages/ui/src/components/organisms/TraditionalTerminalWorktreeSelect.regression.test.tsx): read/reuse patterns; do not edit.
- [UI scripts](../../packages/ui/package.json), [Vitest config](../../packages/ui/vite.config.ts), [code standards](../../docs/code-standards.md#testing-and-delivery), [testing guide](../../docs/testing.md).
- [Web startup](../../apps/web/src/main.tsx) and [native startup](../../apps/native/src/main.tsx) call reset before mounting; static dependency evaluation can hydrate a store earlier.

## Exclusive file ownership
| Action | File | Change |
| --- | --- | --- |
| Modify | `packages/ui/src/stores/project-target.test.ts` | persistence boundary, initialization, failure and reset-integration regressions |
| Modify | `packages/ui/src/hooks/use-project-target.test.tsx` | restored snapshot, reactivity, profile isolation regressions |
No new/deleted test files; no source changes. Specifically, `fresh-state-reset.test.ts` stays read-only per the requested matrix: new selection-store/reset integration assertions belong in the owned `project-target.test.ts`. Main alone edits architecture/changelog and plan status after the join.

## Test architecture and isolation
1. Store tests currently run under default node environment; add file-level `// @vitest-environment jsdom` to exercise localStorage. Keep the hook suite's existing jsdom directive and real Zustand persist middleware.
2. Import the production `PROJECT_TARGET_STORAGE_KEY` for fixtures. Use v1 envelopes matching the contract; never mock out persist/merge or claim `setState` is a refresh.
3. Use actual localStorage for happy paths. Narrow getter/Storage method spies or `vi.stubGlobal` may inject denial/no-browser failures; restore each in `finally`/cleanup. Do not touch application data: tests run in their isolated jsdom origin.
4. Before/after each case, restore spies/globals, clean React roots, reset all three in-memory maps, and clear the target persistence key **after** any `setState` resets that would write it. Clear only known reset marker/notice/legacy fixtures used by a case; do not leave reset notices or persisted selections behind. Do not use state replacement that deletes actions.
5. Capture persisted bytes before resetting memory for a refresh simulation; resetting the singleton writes to storage. Reinstall the captured envelope before `await store.persist.rehydrate()`, or seed storage before a genuinely fresh import.
6. Store-only initialization cases use `vi.resetModules()` plus dynamic imports in isolated cases to create a new singleton with real startup hydration. Obtain snapshots/actions from the newly imported store, not an earlier static import. Clear/retire captured references between cases. No production factory export solely for tests.
7. Hook tests keep one React/module instance: use the existing render harness and singleton with `persist.rehydrate()` inside `act`, not blanket `resetModules()` around mounted React. Always unmount, including failed assertions. Test initial restored selection by hydrating before render and reactive updates by rehydrating after render.
8. Startup hydration must be synchronous: a fresh import's immediate `getState` and the hook's first render already see the selected path, without waiting for a component effect.

## Store regression matrix
Use focused parameterized cases where appropriate; preserve existing helper, normalization, availability and orphan-reconciliation coverage.

| Area | Required cases and assertions |
| --- | --- |
| Durable selections | Select one/multiple worktrees; inspect actual serialized envelope: `version: 1`, state has exactly `activeTargetByProject`, no functions/metadata/failure maps. Recreate store from those bytes and assert immediate restored values. |
| Root/reset durability | Select then root; recreate and remain root. Select then `resetTarget`; recreate and remain root. Another project's/profile's selection survives both operations. Empty hydrated map replaces stale current selections rather than overlaying them. Rename the old fresh-session-at-root test wording to describe root-as-absence, not universal refresh reset. |
| Failure-map exclusion | Populate both unavailable maps and active selections for other owners, serialize, recreate: selections restore; both failure maps start empty. Inject fake failure maps, actions and unknown fields into v1 state; they cannot hydrate, overwrite actions or change current runtime failure maps on manual rehydration. Call every existing action afterward to prove methods survived. |
| Authoritative removal | Hydrate a selection; `markTargetUnavailable` for its normalized alias removes it durably; recreate and remain root. A different unavailable path must not erase the selected path. Existing transient orphan history behavior stays covered. |
| Profile ownership | Use `projectScopeKey({ profileId: 'server-a', project: 'demo' })` and server-b with different paths; recreate and retain each independently. Reset one owner only, recreate and preserve the other. Include bare `demo` preference: bare caller can restore it, but a qualified unselected owner stays root. No active-profile lookup or fallback. |
| Matching-version validation | Seed v1, then manually rehydrate repeatedly with changed payloads. Validation must run each time, not only at creation or migration. Assert malformed entries do not reappear and old removed entries are not merged back. |
| Invalid maps | Missing map, null, array, string, number and Map-like/tuple-list shapes yield an empty selection map for an otherwise supported state. Mixed map retains valid entries but drops empty/whitespace keys and null/number/boolean/object/array/empty/whitespace path values. Non-string object keys cannot exist in JSON; exercise non-string/symbol runtime keys through the configured merge, and reject malformed alternate map representations. |
| Identity preservation | Keep valid path/key bytes unchanged; cover spaces and Windows/UNC paths. Do not normalize persisted ownership or trim a legitimate path. Assert null-prototype active maps and no inherited entries. Exercise actual actions and hook snapshots for absent, selected, hydrated and subsequently removed bare scopes named `constructor`, `toString` and `__proto__`: absent/removed means root, selected means the exact own path. |
| Envelope validation | Absent record, literal null, primitive/array envelope, invalid/missing state, missing/string version, old version 0, unknown future version 2: fresh startup stays root and keeps working actions. Unsupported records are ignored without deletion or replacement. For explicit rehydration of an unreadable envelope, existing live selection remains usable. Assert byte-for-byte preservation and zero `setItem`/`removeItem` calls during startup and repeated hydration of corrupt/unsupported records; only a later explicit state change may replace bytes. |
| Corrupt JSON | Invalid/truncated JSON does not throw on module import or rehydrate; startup starts at root, actions work and the next explicit selection can overwrite the bad record with a valid v1 envelope. No automatic delete/retry on read. |
| Storage denial | Throwing localStorage getter, getItem, setItem/quota and removeItem are handled independently. Initialization/rehydration, select/root/reset/unavailable and `persist.clearStorage()` must not throw. Failed writes still update in-memory state; no-window store initialization remains safe. |
| Fresh-reset integration | `isLegacyResourceKey(PROJECT_TARGET_STORAGE_KEY)` is false. Seed new selection bytes plus legacy active-project/pin fixtures; `performFreshStateReset` removes legacy only, preserves new bytes, and never calls storage clear. Repeat reset to prove idempotence. Test valid, mixed-invalid, corrupt and future envelopes are preserved for the store boundary. |
| Bootstrap order | Seed v1, reset then fresh-store import: selection restores. Seed v1, fresh-store import then reset: in-memory and persisted selection survive. These are order regressions, not a host rewrite or a new startup behavior. |

## Hook regression matrix
1. Hydrate qualified selection before rendering: first snapshot contains exact `{ profileId, project, worktreePath }`, stable worktree target key and `isRoot: false`. Lack of discovery metadata still means `available: false`, not automatic root selection.
2. Render after restoring two `demo` projects owned by server-a/server-b; each reads its own path. A third qualified owner remains root even when a bare `demo` key exists.
3. Switch hook project prop between qualified owners: correctly scoped snapshot each time, no stale path or bare-key fallback.
4. Hydrate an updated valid envelope inside `act` while mounted: hook reacts. Hydrate a supported envelope with empty map: root snapshot, existing action references still callable.
5. Select root/reset for owner A after hydration: A returns root, B stays selected; rehydrate the saved result and confirm no resurrection.
6. Keep current null-project/root/helper/profile-isolation tests. No changes to the production hook should be necessary.

## Implementation steps
1. [x] Adapt existing cleanup to persistence writes before adding test cases; introduce only small local fixture helpers.
2. [x] Add store matrix cases with deterministic real storage and narrowly scoped denial injection.
3. [x] Add fresh-store initialization/reset-order cases without importing a second React instance into hook tests.
4. [x] Extend hook harness cases using the real selector and middleware.
5. [x] Return exact changed paths, coverage mapped to this matrix and any contract disagreement.

## Dependency and execution gates
- Start authoring immediately after contract freeze; Phase 01 source completion is **not** a prerequisite to writing fixtures/assertions.
- Main must collect both terminal results before executing. If contract changes, update both phase documents and notify both owners before proceeding.
- Any failure remains a failed gate; record actual diagnostics, route the smallest fix to the owning slice and repeat only affected checks after edits stop. No weakening assertions or ignoring failures.

## Verification commands — Executed by Main after join
All automated verification commands executed by Main following the join:

### 1. Focused unit and existing integration regressions
```bash
pnpm --filter @dam-hopper/ui test src/stores/project-target.test.ts src/hooks/use-project-target.test.tsx src/lib/fresh-state-reset.test.ts src/hooks/use-worktree-target-reconciliation.test.tsx src/components/organisms/ProjectInfoPanel.test.ts src/components/organisms/TraditionalTerminalWorktreeSelect.test.tsx src/components/organisms/TraditionalTerminalWorktreeSelect.regression.test.tsx
```
Result: Pass (7 test files, 103 tests passed, 0 failures). Initial run failed on prototype pollution defense in unavailable target maps; fixed by initializing and copying all three maps with `Object.create(null)`.
### 2. Shared UI typecheck and changed-file lint
```bash
pnpm --filter @dam-hopper/ui build
pnpm exec eslint packages/ui/src/stores/project-target.ts packages/ui/src/lib/fresh-state-reset.ts packages/ui/src/stores/project-target.test.ts packages/ui/src/hooks/use-project-target.test.tsx
```
Result: Pass (0 TypeScript errors, 0 ESLint warnings/errors).

### 3. Wider UI regression gate
```bash
pnpm --filter @dam-hopper/ui test
```
Result: Pass (327 test files, 2,969 tests passed, 0 failures). Emitted two non-fatal jsdom navigation warnings (`Not implemented: navigation (except hash changes)`), with zero assertion failures.
## Manual page-refresh and side-effect review — Main
Use a development or already-running authenticated instance with two saved profiles and same-name projects, each exposing an available non-root worktree. Do not alter real user's stored data; use isolated test profiles/browser context.
1. Select owner A's worktree from Project panel, refresh, verify both Project panel and Traditional terminal dropdown restore it. Repeat selection from the Traditional dropdown to prove shared-store behavior. Select owner B's different worktree, refresh and verify A/B independently.
2. Start a terminal in the selected target and retain another existing root terminal. Record their session IDs and cwd; change selection/refresh. Existing terminal identity/cwd must not change; a **new explicitly launched** terminal uses the selected target. Confirm no selection-triggered `cd`, PTY restart, checkout or unexpected extra launch.
3. Select root for owner A, refresh and confirm A root/B selected. Observe persisted JSON: only the active map and v1 envelope, no failure/history/functions.
4. With a restored worktree, loading/refetch/transport failure must not erase selection. When successful authoritative discovery reports the worktree missing, confirm existing notice/fallback and persisted removal; refresh stays root. Use disposable repositories/fixtures, not destructive removal of user worktrees.
5. Confirm existing editor tabs/dirty buffers are not rebound, and root-retained Workspace Git panel still targets project root. Check unrelated storage/auth/profile/workspace records are untouched.
6. Check the shared native host reload where available; mark native/platform journey unverified if not exercised. Do not infer real-browser/native qualification from jsdom tests.
Status: Automated jsdom store and hook tests verify reload/rehydration, profile isolation, authoritative missing-target fallback, and state preservation. Real-browser manual interactive journey and native host reload were unexercised in the headless execution environment and remain unverified.

## Per-phase success criteria
- [x] All required store/hook matrix behaviors have real assertions; happy-path recreation proves startup hydration, not just `setState` round-trips.
- [x] Same-name cross-profile separation survives hydration, owner root/reset and recreation; legacy bare keys never leak to qualified callers.
- [x] Transient maps/actions cannot be persisted or injected; malformed v1 maps and corrupt/denied/unsupported storage obey the exact contract.
- [x] Cleanup leaves no leaked globals, mounted roots, persisted state or reset markers; only Phase 02-owned files changed.
- [x] Main has completed the serialized focused/unit/type/lint/full-UI commands; manual interactive browser and native reload journeys remain unverified.

## Risks, documentation and handoff
- Storage-isolation mistakes can mask reload tests or contaminate unrelated tests: assert captured bytes and restore them after memory resets.
- Module cache isolation can duplicate React: keep fresh-import tests in the store suite, singleton rehydration in hook suite.
- Tests may inject browser API failures; they must not mock the persistence behavior being proved.
- After integration, Main updates `docs/system-architecture.md` Traditional Terminal Worktree Shortcut to replace session-only/reload-to-root wording with narrow persisted selection, profile scope and graceful validation behavior. Preserve its PTY and authoritative-discovery safety statements.
- Main adds the dated fix to `docs/CHANGELOG.md`, including only exercised checks; old dated release entries remain historical. Main updates plan/phase status to completed.

## Unresolved questions
None. Native/runtime availability is an execution evidence constraint, not a design ambiguity.
