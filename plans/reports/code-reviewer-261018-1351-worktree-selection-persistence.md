# Code Review: feat/worktree-select-persistence

## Scope
- `packages/ui/src/stores/project-target.ts` (+~300), `lib/fresh-state-reset.ts` (comments), `stores/project-target.test.ts` (+~1080), `hooks/use-project-target.test.tsx` (+~300)
- Re-ran both test files: 68/68 pass. ESLint on 4 files: clean.
- Plan file: none given → nothing updated.

## Overall
Solid. Persist is narrow (only `activeTargetByProject`), envelope strictly validated, null-proto maps, per-entry filtering, all storage access try/caught. No critical/high issues.

## Critical / High
None.

## Medium
1. Scope creep in working tree, unrelated to feature: `docs/configuration-guide.md` + `server/src/api/tests.rs` (`gleanOak`→`gleanHub`), untracked `.omp/evcrate/scripts/worktree.cjs`, unrelated `plans/reports/*` (android-compose, mongodb-auth). Exclude from the commit.
2. Whole-map last-writer-wins, no `storage` event sync: two tabs clobber each other's selections for other projects (tab writes its full in-memory map). Same pattern as other persisted stores; accept or note in docs.
3. No pruning: entries for deleted projects/profiles live forever; no cap on entries/value length when hydrating tampered storage. Same-origin only, low impact; optional cap.

## Low
- `persist` writes localStorage on every `set`, incl. changes only to unavailable maps (frequent via `markTargetUnavailableIfNeeded`). Tiny payload; fine. Could skip when `activeTargetByProject` ref unchanged.
- Hydrated selection is used (terminal launch `resolveTerminalLaunchForProject`, `use-terminal-tree`) before worktree discovery; stale paths are self-healed by `use-worktree-target-reconciliation` + server target errors → `markProjectTargetUnavailable` (persisted removal). Acceptable; one failed first op possible.
- Persisted values not shape-checked beyond non-blank string ("." / "/" normalize to root in snapshot but raw value still reaches `getTerminalLaunchRequest`). Server validates; no throw in `normalizeProjectTargetPath`, so no render poison-pill.
- Bare-name keys (no profileId) are not profile-scoped (pre-existing `projectScopeKey`); fresh-state-reset comment says "owner-scoped" — accurate only for profile-qualified entries.
- Tests use `vi.resetModules()` + dynamic import → extra store singletons per test; no listeners, no leak. Tests assert key invariants (no write on read, no delete on corrupt, live state preserved).

## Security
- Prototype pollution: `Object.create(null)` maps, `Reflect.ownKeys` + own-property check, symbol keys rejected, `__proto__`/`constructor`/`toString` covered by hook test. `Object.assign` onto null-proto target safe (no `__proto__` setter). Safe.
- No secrets stored; paths in localStorage consistent with `workspace-state`.
- `fresh-state-reset`: `isLegacyResourceKey("dam-hopper:project-target-state")` false (no quarantine/legacy-unowned match) → preserved; covered by test.

## Positives
Explicit version gate in storage adapter, `merge` replaces (no overlay resurrection), actions never taken from storage, SSR/disabled-storage fallbacks tested.

## Unresolved
- Is multi-tab clobbering acceptable for this feature?
- Should unrelated edits (gleanHub rename, worktree.cjs) land in this branch?
