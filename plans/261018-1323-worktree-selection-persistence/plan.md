---
title: "Persist worktree selection across refreshes"
description: "Persist each project's selected worktree without leaking profile ownership or restoring transient failures."
status: completed
priority: P2
effort: 4h
branch: feat/worktree-select-persistence
tags: [bugfix, frontend, persistence, worktrees]
created: 2026-10-18
---

# Worktree selection persistence

## Outcome and scope
Restore selected worktrees synchronously across page refresh in web/shared native UI. Persist **only `activeTargetByProject`**; root remains absence. Keep `unavailableTargetByProject`, `unavailableTargetsByProject`, actions, discovery, connections and PTY state memory-only. No backend, new dependency, UI redesign, cross-tab synchronization, profile cleanup or migration from nonexistent old persistence.

Research: target store now uses Zustand `persist` middleware with narrow storage under `dam-hopper:project-target-state`; `projectScopeKey` preserves `[profileId, project]` identity; `git-history.ts` supplies the resilient-storage/custom-merge pattern. Fresh-state reset preserves the versioned store. Reconciliation preserves intent on discovery errors and drops authoritatively unavailable selections. [Architecture](../../docs/system-architecture.md#traditional-terminal-worktree-shortcut) documents the version 1 persistence contract.

## Frozen parallel contract
- Key: exported `PROJECT_TARGET_STORAGE_KEY = "dam-hopper:project-target-state"`; Zustand envelope version `1`, synchronous localStorage adapter, normal automatic hydration.
- Payload: `{ state: { activeTargetByProject: Record<string, string> }, version: 1 }`. `partialize` writes exactly that state field; custom `merge` validates it **on every hydration**, including matching versions.
- Reject malformed envelope/map shapes and invalid entries; retain valid entries in mixed maps. Nonempty string keys/paths only; reject whitespace-only strings without trimming or rewriting valid identities. JSON object keys are intrinsically strings: arrays/entry-tuples/Map-like containers are not accepted maps. Ignore unknown fields and supplied transient maps/actions. Never spread untrusted state into live state.
- Preserve keys produced by existing `projectScopeKey` verbatim. Existing bare-string callers remain supported, including persistence of their isolated bare keys; qualified profiles never inherit bare or other-profile keys. No owner inference, key migration or generation suffix.
- A valid hydrated map replaces, not overlays, the current selection map. Startup transient maps are empty; explicit rehydration must not import failure maps or overwrite current actions/runtime failure state.
- Invalid JSON, malformed/missing/unsupported envelope version and storage denial do not throw. Startup defaults to root; an unreadable/unsupported record does not erase live intent. Startup/repeated hydration performs no storage write/delete and preserves its bytes; only later explicit state changes may replace it. Fresh reset preserves this key; validation belongs to the store.

## Phases
| Phase | Status | Effort | Deliverable |
| --- | --- | --- | --- |
| 01 | completed | 1.5h | [Store persistence and reset contract](phase-01-store-persistence.md) |
| 02 | completed | 2.5h | [Tests, integration and validation](phase-02-testing-validation.md) |

## Dependency graph
```text
Contract frozen (this plan)
  +--> Phase 01: store + reset source ----+
  +--> Phase 02: store + hook tests -----+--> join both terminal results
                                           --> Main: serialized checks + side-effect review
                                           --> Main: documentation/changelog + handoff
```
Phase 02 test AUTHORING is independent after contract freeze; test EXECUTION depends on both phases. No phase may change the contract unilaterally.

## Execution strategy
Spawn 2 agents, wait for all 2 terminal results, then synthesize. Give each its phase file, frozen contract, exact ownership and prohibition on mid-flight tests/builds/lint/formatters. Each returns changed paths, fulfilled criteria and any deviation; partial/missing results block the join. With no spawning support, execute the same owned slices sequentially. Main alone runs the commands in Phase 02 after the join, records actual results and routes fixes to the original owner. No blanket formatting or unrelated edits.

## Strict file ownership matrix
| Owner | Exclusive write files | Read-only dependencies |
| --- | --- | --- |
| Phase 01 | `packages/ui/src/stores/project-target.ts`; `packages/ui/src/lib/fresh-state-reset.ts` | existing persistence patterns, hooks, tests |
| Phase 02 | `packages/ui/src/stores/project-target.test.ts`; `packages/ui/src/hooks/use-project-target.test.tsx` | Phase 01 source, existing reconciliation/reset/dropdown suites |
| Main, serial after join | `docs/system-architecture.md`; `docs/CHANGELOG.md`; these three plan files | both phase outputs, verification evidence |
All other files, especially `fresh-state-reset.test.ts`, hooks/components, manifests and lockfile, remain unchanged. Reset-persistence regression assertions live in the Phase 02-owned store test file to honor this matrix.

## Side-effect review checklist
- [x] Stored envelope contains only selections; every hydration validates input and preserves action functions.
- [x] Same-name projects on profiles A/B remain isolated after reload; root/reset deletes only the exact owner's selection.
- [x] Reset startup order cannot remove the new key; corrupt/denied storage leaves selection actions usable; no `localStorage.clear()` in production.
- [x] Loading/refetch/error cannot erase restored intent; authoritative missing target uses existing reconciliation and persists removal.
- [x] Selection/hydration never sends `cd`, checks out branches, creates/restarts PTYs, rebinds editor tabs or changes root-retained Git panels. Existing session IDs/cwd remain stable.
- [x] No paths/owner identifiers logged; unrelated profiles, auth, workspace, editor and terminal storage remain untouched.

## Completion and unresolved questions
Both phase success criteria, all serialized commands, and verification gates satisfied. Implementation delivered and verified across store persistence, hook reactivity, and test suites. Architecture documentation and changelog updated. Unresolved questions: none.
