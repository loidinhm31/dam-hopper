---
title: "Phase 01 — Store persistence"
description: "Add narrow, resilient Zustand persistence without changing callers or target routing."
status: completed
priority: P2
effort: 1.5h
branch: feat/worktree-select-persistence
tags: [bugfix, frontend, persistence, worktrees]
created: 2026-10-18
---

# Phase 01 — Store persistence

## Overview
Priority P2 · status completed · effort 1.5h. Add narrow, resilient Zustand persistence without changing callers or target routing. Can run alongside Phase 02 test authoring after the [main contract](plan.md#frozen-parallel-contract) is frozen. Implementation completed and verified.

## Context links and research
- [Target store](../../packages/ui/src/stores/project-target.ts): current plain `create`, three maps; only selected non-root paths are durable intent.
- [Fresh-state reset](../../packages/ui/src/lib/fresh-state-reset.ts): unknown keys already survive; reset marker does not stop later key scans.
- [Git history store](../../packages/ui/src/stores/git-history.ts): resilient storage adapter and custom validated merge, not a second persistence framework.
- [Workspace store](../../packages/ui/src/stores/workspace.ts): existing `create<State>()(persist(...))` convention.
- [Reconciliation](../../packages/ui/src/hooks/use-worktree-target-reconciliation.ts): only completed, non-error discovery marks selections unavailable.
- [Hook](../../packages/ui/src/hooks/use-project-target.ts) and [ownership helpers](../../packages/ui/src/api/ownership.ts): exact scope identity; qualified key is `JSON.stringify([profileId, project])`.
- [Code standards](../../docs/code-standards.md), [architecture](../../docs/system-architecture.md#multi-profile-ownership-model).

## Exclusive file ownership
| Action | File | Change |
| --- | --- | --- |
| Modify | `packages/ui/src/stores/project-target.ts` | persist middleware, narrow storage adapter, per-hydration validation |
| Modify | `packages/ui/src/lib/fresh-state-reset.ts` | document intentional preservation of the new selection store |
No new/deleted production files; no edits to tests, hook callers, components, manifests, shared adapters or docs owned by Main. Preserve established API exports; only add the storage-key constant needed by tests.

## Functional and nonfunctional requirements
1. Selecting a worktree writes it durably under the exact existing scope key; a fresh store restores it before consumers render or launch terminals.
2. Selecting root removes that owner's key. `resetTarget` keeps existing behavior for all three maps and persists its selection removal.
3. `markTargetUnavailable` preserves its normalized identity behavior and removes/persists only matching active selection; unavailable maps remain useful in memory but never durable.
4. Preserve bare-string API keys as independent scopes; never qualify them with the active profile or use them as a qualified fallback.
5. Storage must be optional. Blocked access, quota, malformed JSON and unexpected values cannot break module initialization, selection/reset actions or clear-storage calls.
6. Validate at every merge, not just `migrate`: same-version payloads are untrusted. No new migration, async startup gate, storage event listener or telemetry.
7. Maintain all helper/snapshot semantics, including Windows/UNC normalization already applied for identity comparisons; do not rewrite stored valid paths.

## Architecture and exact boundary policy
Data flow: `selectTarget/resetTarget/markTargetUnavailable -> existing set -> persist(partialize) -> safe localStorage`; on startup `safe read + envelope validation -> custom merge -> existing hook selector -> existing discovery reconciliation`.

### Persisted envelope
```json
{
  "state": {
    "activeTargetByProject": {
      "[\"server-a\",\"demo\"]": "/worktrees/feature-a",
      "[\"server-b\",\"demo\"]": "/worktrees/feature-b"
    }
  },
  "version": 1
}
```
- Constant `PROJECT_TARGET_STORAGE_KEY = "dam-hopper:project-target-state"`; numeric envelope version `1`.
- `partialize` returns only `activeTargetByProject`. Neither failure map, methods, `worktree` metadata nor profile generation belongs in storage.
- Use a small synchronous `PersistStorage` adapter colocated in the owned store, following `createSafeGitHistoryStorage`; do not import another store or extract a general library.
- Resolve `localStorage` inside each adapter operation's `try`, not at module scope. Catch getter/read/write/remove failures and JSON parsing errors. Missing browser globals return null/no-op. Parse errors return no persisted value, without deleting records or writing on read.
- Read accepts only a non-null, non-array plain envelope with an own `version === 1` and an own plain-object `state`. Missing/string/unsupported versions, primitive/array/null envelopes or state are ignored. Reject unsupported versions before Zustand can bypass merging; no guessed migration. Unknown future records remain on disk unless an ordinary later state change writes this implementation's v1 value.
- `setItem` serializes the narrow Zustand envelope inside the same guarded operation; `removeItem` is also guarded. In-memory `set` must still complete when persistence fails. Do not catch programming errors outside this explicit storage boundary.

### Custom merge on every hydration
1. Begin with current state/actions, not a spread of persisted state. Missing/unreadable persisted value returns current state unchanged.
2. For accepted persisted state, validate `activeTargetByProject` as an own, non-null, non-array plain object (normal or null prototype). Missing/invalid map becomes an empty selection map; this is not a Map, tuple-list or string-array format.
3. Filter entries individually: key and value must be strings with `trim().length > 0`. Keep valid exact strings, including internal spaces and Windows/UNC paths; trimming is validation only. Reject symbol keys in direct runtime payloads; JSON objects cannot carry non-string own keys. A mixed map retains valid entries while dropping invalid ones.
4. Build sanitized maps with a null prototype and own data entries so serialized `__proto__` cannot mutate a prototype and missing `constructor`/`toString` scopes cannot resolve inherited functions. Preserve this invariant for the initial active map and all active-map copies created by select/root/reset/unavailable actions using a small local map-copy helper. Keep failure maps and action behavior otherwise unchanged. Preserve string-key API compatibility; no owner inference or new key grammar, no hook/source ownership expansion.
5. Return current state with **only** `activeTargetByProject` replaced by the sanitized map. Do not overlay entries from current selections: an empty persisted map must remove old intent. Ignore persisted unknown properties, functions and both failure maps. Keep live action references and current transient maps untouched; a fresh store's transient maps naturally start empty.
6. Keep validation on the normal `merge` path even with version `1`; `migrate` is not a validation substitute.

### Fresh-state reset contract
- The new key is not legacy. Preserve it for valid v1, mixed-invalid v1, malformed JSON and unsupported-version records; the store alone validates/ignores input. This avoids conflicting deletion/filtering policies and destructive treatment of future versions.
- Existing classifier already returns false for this key. Update its contract/header comments in `fresh-state-reset.ts` to explicitly include durable, owner-scoped project-target selections among preserved records. Do not add redundant parsing/duplicate validators or advance reset markers just to make this file change substantive.
- Do not import the store into reset: that could hydrate before reset or pull runtime dependencies into bootstrap. No blanket clear, unrelated key changes or new startup calls.
- Static imports may initialize the store before hosts call reset; both `reset -> store import` and `store import -> reset` must preserve the selection record.

## Implementation steps
1. [x] Preserve current helper/action semantics; introduce the persisted subset type, stable key constant and prototype-safe active-map construction with the store's existing naming/style.
2. [x] Add narrowly scoped safe storage and merge validation described above, with concise comments explaining the trust boundary and transient exclusions.
3. [x] Wrap the existing initializer with typed `persist` using `create<ProjectTargetState>()(...)`, explicit version/storage/partialize/merge. Retain synchronous automatic hydration; no `skipHydration` or component effect that briefly defaults to root.
4. [x] Document reset preservation without changing existing legacy cleanup behavior.
5. [x] Hand back exact changed paths and implementation/contract deviations.

## Success criteria
- [x] Startup restores a valid persisted owner-qualified worktree synchronously; owner IDs/project names/path bytes remain unchanged.
- [x] Exactly one selection map is written; supplied failure maps/actions cannot hydrate or replace methods.
- [x] Malformed map fields/entries and corrupt/unsupported envelopes behave exactly as above; validation also occurs for same-version manual rehydration.
- [x] Root/reset/unavailable removal survives recreation, remains owner-scoped and never resurrects by map overlay.
- [x] Denied getter/get/set/remove and no-window environments leave normal in-memory APIs usable.
- [x] Reset preserves this key regardless of host import order; existing legacy cleanup remains intact.
- [x] No edits outside Phase 01 ownership; no PTY/editor/Git/transport behavior changes.

## Verification commands — Executed by Main after join
Executed by Main following the join. All gates passed with 0 errors:
```bash
pnpm --filter @dam-hopper/ui test src/stores/project-target.test.ts src/lib/fresh-state-reset.test.ts
pnpm --filter @dam-hopper/ui build
```
Storage payload and source boundaries verified against the [side-effect checklist](plan.md#side-effect-review-checklist).

## Risks and security
- Valid preference is not authorization or proof of worktree availability; existing captured-owner APIs and server validation remain authoritative.
- Browser storage exposes project/path metadata to same-origin scripts: never log raw payloads or add server/cloud sync.
- Storage writes happen for store updates; retain Zustand's boring persistence model, no debounce/cache/retry subsystem.
- Existing file already exceeds general size guidance; keep changes local rather than expanding ownership through unrelated modularization.

## Next step and unresolved questions
Phase completed and verified. Terminal results joined with Phase 02 and validated. Unresolved questions: none.
