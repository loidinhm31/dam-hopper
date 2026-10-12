## Code Review Summary — Git blame caching (`feat/git-blame-caching`)

### Scope
- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-git-blame-caching` (uncommitted diff vs `514084d6`)
- Server: `git/blame-cache.rs` (new, 362 LOC incl. tests), `git/blame.rs` (+~1370, 2131 total), `api/git_blame.rs`, `state.rs`, `git/mod.rs`, `Cargo.toml/lock`, `tests/git_blame_api.rs`
- UI: `lib/editor-git-blame-cache.ts` (new, 989), `.test.ts` (997), `hooks/use-editor-git-blame.ts` (1051), `api/queries.ts`, `hooks/use-sse.ts`, `lib/editor-git-blame.ts`, `package.json`/lockfile, docs arch file
- Review focus: static read of all changed code + one throwaway probe (empty committed file + non-empty buffer; removed after). No build/test suite rerun (tester report `tester-261012-1900` already covers: 145 pass / 0 fail).
- Plan files updated: none (report only; plan dir `plans/261012-1739-git-blame-caching/` untouched).

### Overall Assessment
Server side solid: bounded LRU, correct HEAD-fence ordering, shallow bypass, admission semaphore intact, cache keyed by canonical repo path. Client cache design coherent (profile+generation in keys, epoch fencing, leases). Real defects are in the **hook integration** (stuck `loading`, render-phase side effects/perf, unborn-HEAD spurious epoch advance) and doc/hygiene. No critical security issue.

### Criteria Checklist
| Criterion | Verdict |
|---|---|
| LRU entry+byte bounds | OK. Oversize skip, pre-evict loop; accounting drift minor (M3) |
| `parking_lot::Mutex` thread-safety | OK. Lock held only for map ops; no `.await`; `get` promotes under lock; no lock held across git2 calls |
| Canonical root namespacing | OK. Key = `dunce::canonicalize(root_path)` + `root_id` + `head_oid` + baseline path; linked worktrees = distinct root paths; test `test_cross_repository_cache_isolation` |
| Shallow bypass | OK. `repo.is_shallow()` checked live per request; no key built/insert |
| Zero-context projection equivalence | OK by inspection (`old_start+1` for 0-len hunks, cursor+bsearch fallback) and 5 differential tests vs legacy oracle; empty committed file probe → Ok(Uncommitted) |
| HEAD fence before publish | OK. `ensure_head_unchanged` precedes `cache.insert`; blob/mode/size validated *before* lookup; symlink check precedes cache; warm path can't bypass 415 |
| Admission semaphore | OK. try-acquire before target resolve; permit moved into `spawn_blocking`; hit still consumes permit |
| Client key shape | OK. `["profile",pid,gen,"git","git-blame",project,worktreeKey,rootId,headOid\|null,epoch,path,sha256]` |
| Sync `ready` restoration | OK in design (render-phase `getCompletedBlameHit`, seeded `useState`), but see H2/H3 |
| Local vs shared epoch | OK. Edits bump only `localEpochRef`; shared `repositoryEpoch` bumped by mutations/SSE only; undo→cached hit works |
| Shared mutation invalidation | OK for `queries.ts` ops; see M2 (status:changed breadth) |
| Owner retirement | OK. `onConnectionInvalidated` → `retireOwner`; clears leases/entries/unsub; prefix removal also covers `git-blame-lease` |
| Profile/worktree isolation | OK. targetKey + query key both carry profile, generation, project, worktree. Theoretical `:`-join collision (L2) |
| TS strictness | No `any`; non-null `state!` in closure and `as QueryClient` casts on structural types (M5) |

### Critical Issues
None.

### High Priority Findings

**H1. Hook can stick in `loading` after lease invalidation** (`use-editor-git-blame.ts` runBlame ~L475 `if (lease && queryClient && !isLeaseValid(...)) return;`)
- Path: request in flight → `workspace:changed`/`config:changed` → `invalidateBlameForOwner` bumps epoch → lease invalid. Hook's own refresh sees same HEAD (trusted head cleared → `headChanged=false`) while `inFlightRef` true → early return (no abort, no pending intent). Response arrives → silent `return`; `finally` clears inFlight, `pendingIntentRef` false → status stays `"loading"`, nothing scheduled until next focus/edit.
- Fix: on lease-invalid (and any silent post-await bail where model/tab unchanged) set `pendingIntentRef.current = true` + `bypassCacheNextRef = true` so `finally` reschedules; or set `status "waiting"` and call debounced `runBlame`. Add hook test: epoch advance mid-flight → second request issued.

**H2. Render-phase O(n) work on every render** (hook L~170-190)
- Each render calls `model.getValue()`, `isBufferOverLimit()` (allocates full `TextEncoder.encode`, up to 5 MiB), `computeMonacoLineCount()` (full scan) *before* the version-memoized SHA. Memoization only saves hashing. Large buffers + frequent status re-renders (every keystroke sets `waiting`) = avoidable allocation/GC on UI thread.
- Fix: key `{over, lineCount, sha}` on `model.getVersionId()` (extend `getModelBufferSha256` memo to a `getModelFingerprint(model)` returning all three), call `getValue()` only on memo miss.

**H3. Side effects during render** (hook L~290-325 identity-change block + warm-adopt block)
- Mutates refs (`localEpochRef.current++`, `activeControllerRef.abort()`, `clearTimeout`, `dataRef`, `lastHeadCommitRef`) inside render body. Under StrictMode/concurrent rendering a discarded/double render applies abort + epoch bumps for a render that never commits. `setState`-during-render is allowed; ref mutation/abort/timers are not.
- Fix: keep only `setState` calls in render (derive-state pattern); move abort/clearTimeout/epoch bump into `useEffect` keyed on `currentIdentityKey` (existing effect at "Handle enabled/disabled" already depends on it — fold in).

### Medium Priority Improvements

**M1. Unborn HEAD ⇒ spurious epoch advance per refresh** (hook `headOid = owningRoot.status?.lastCommit?.hash ?? ""` vs server `baseCommitOid: null`)
- `completeRootDiscovery` compares `""` to trusted `null` → `headChanged=true` every focus/status event → `advanceTargetEpoch` + bypass reblame; cache never warms on unborn repos. Same if `status` is absent on a normal repo (`""` ≠ real OID).
- Fix: `const headOid = owningRoot.status?.lastCommit?.hash || null`; widen `completeRootDiscovery(discoveredHeadOid: string | null)`; if status missing, treat HEAD as *unknown* (skip trust update) rather than `""`.

**M2. `status:changed` wipes blame cache for whole project** (`use-sse.ts` L560)
- `invalidateBlameForProject(qc, owner, projectName)` on every `status:changed` bumps epoch for all worktrees of project and drops all entries; hook also reblames with bypass. If that event fires on routine file saves/watch ticks, client cache only survives tab switches with no FS activity. Blame depends on HEAD + index rename mapping, not working-tree dirtiness.
- Confirm event frequency (could not locate the emitter in `server/src` by grep). If frequent: invalidate only on HEAD/root change (already handled by discovery) and index-affecting mutations; keep `worktree:changed`/`config:changed`/owner-retire.

**M3. Server accounting drift** (`blame-cache.rs` `insert`)
- Replacing an existing key pops old value but sizes it with the *new* key's `String::capacity()`; evictions use the stored key (correct). Drift only when old/new key capacities differ. Fix: use `lru.pop_entry(&key)` (returns stored key) for old-bytes. Alternatively store accounted bytes in the map value (`(Arc<BlameBaseline>, usize)`) and never recompute.
- No single-flight: concurrent misses for same key duplicate `blame_file` (bounded by 2 permits). Acceptable; note.

**M4. Stale docs** (`docs/architecture/workbench-files-editor-and-git.md`)
- Section "Planned Git Blame Caching — Design only; not implemented or qualified" now false. Rename/rewrite as implemented behavior (server key, client key, epoch/lease rules, bounds: server 128/64 MiB, client 64/32 MiB, GC 5 min) and drop plan link or keep as reference. Qualification claims remain open per tester (E01/E02, B01 remount).

**M5. Type-safety smells** (`editor-git-blame-cache.ts`)
- 4 public fns accept `QueryClient | {invalidateQueries; removeQueries?}` then `as QueryClient` and `clientStateMap.get(qc)`; a structural mock silently skips epoch advance/state cleanup. Use `Pick<QueryClient,"invalidateQueries"|"removeQueries"|"getQueryCache"|...>` or require real `QueryClient`; dedupe the 4× copy of the type into `type BlameQueryClient`.
- `state!` inside `getClientState` subscription closure: restructure (create `state` object first, then subscribe).
- Triplicated "clear target entries" loop (advance/project/retire) → extract `dropTargetEntries(state, targetState)`.

**M6. Modularization / file size**
- `editor-git-blame-cache.ts` 989 LOC, hook 1051 LOC, `blame.rs` 2131 LOC (≈1300 are tests incl. ~400-line legacy oracle), test file 997 LOC. Split: `blame-cache-keys.ts` / `-lru.ts` / `-targets.ts`; hook → `use-blame-refresh-coordinator.ts`; move Rust tests + legacy oracle to `git/blame_tests.rs` (`#[cfg(test)] mod`).
- `TEST_HISTORICAL_LOAD_COUNT` `thread_local!` lacks blank line before next fn and leaks a `#[cfg(test)]` counter into hot-path function body (`load_historical_baseline`). Acceptable but prefer injecting a loader counter via test-only wrapper.

**M7. Circular re-export** (`editor-git-blame.ts` L442 `export * from "./editor-git-blame-cache.js"`)
- `editor-git-blame-cache.ts` imports `validateBlameResponse` from `editor-git-blame.ts`, which re-exports the cache → import cycle; no consumer needs it (hook/queries/sse import cache directly). Remove the re-export.

### Low Priority Suggestions
- **L1.** Rust filename `blame-cache.rs` + `#[path]` deviates from repo's snake_case module files (`commit_details.rs`, `vcs_roots.rs`); rename to `blame_cache.rs`, drop `#[path]`. (Kebab-case applies to TS only.)
- **L2.** `makeTargetKey` joins with `:`; project/worktree path containing `:` can theoretically alias two targets (e.g. project `p`, worktree `/x:root`). Use `JSON.stringify([pid,gen,project,worktreeKey])`.
- **L3.** Dead/unused: `getTargetState`, `discoveryEpoch`, `queryCacheUnsubscriber` (stored never called), `isMatchingBlameQueryKey`, `computeBufferSha256` (used only by memo + tests), `retireOwner` export (only internal). YAGNI trim.
- **L4.** Every invalidate helper does `invalidateQueries` immediately followed by `removeQueries`; invalidate is redundant for no-observer entries (and emits `invalidate` events needlessly). Remove or document.
- **L5.** Abandoned target states: `completeRootDiscovery` stale branch and successful completion without entries leave empty `TargetState` + owner unsubscriber until retirement. Call `cleanupTargetIfSettled` in stale branch.
- **L6.** `setQueryDefaults(gcTime: 5min)` equals TanStack default (5 min) — redundant unless QueryClient overrides default; verify and drop or keep with comment. Defaults accumulate per generation.
- **L7.** Server cache key excludes `replace` refs/grafts/`.mailmap`; same HEAD can yield different blame if those change. Edge; document.
- **L8.** `package.json` hunk reorders `@vitest/browser-playwright` / `@tanstack/react-query` — unrelated noise.
- **L9.** Pre-existing/global: `cargo fmt --check` already fails on ~dozens of unrelated server files; new files also not rustfmt-clean (e.g. `blame.rs` L593 indent). Run rustfmt on touched files only.

### Positive Observations
- HEAD fence ordering and validate-before-lookup preserve prior security posture; warm hits can't bypass symlink/binary/size/mode checks.
- Owned `BlameBaseline` (no `git2::Blame` handles retained); `Arc` sharing; Debug impl; clean `parking_lot` use.
- Differential tests against legacy oracle (repeated lines, CRLF/lone CR/unicode, rename, dirty ranges) + API tests (symlink-after-warm, busy, new HEAD) + benchmark.
- Client: monotonic global epoch counter (no ABA), lease marker in QueryClient makes `clear()` revoke in-flight, query-cache `removed` listener keeps LRU accounting honest, envelope rebinding without mutating cached data, hits re-validated through `validateBlameResponse`.
- Query key carries profile+generation → cross-profile contamination impossible; owner retirement hooked to connection invalidation.

### Recommended Actions (priority)
1. Fix H1 (stuck `loading`) + add regression test.
2. Fix M1 (null vs `""` HEAD) — one-liner + tests for unborn repo.
3. Fix H2/H3 (memoize per version; move ref side effects out of render).
4. Decide M2 with event-frequency evidence; narrow `status:changed` invalidation if frequent.
5. Update docs (M4); remove circular re-export (M7); rename `blame_cache.rs` (L1).
6. M3 pop_entry accounting; M5/M6 refactors; L-items opportunistic.

### Metrics
- Type coverage: strict TS, 0 `any`, 1 `!` assertion, ~5 `as QueryClient` casts
- Test coverage: not measured; tester report: 145 pass/0 fail (Rust 31+16, UI 25+19+50, browser 3); gaps: lease-invalid recovery, unborn-HEAD discovery, StrictMode double-render, real-remount (B01), authenticated E2E (E01/E02)
- Linting: not run (no lint script located in `packages/ui/package.json`); `cargo fmt --check` fails repo-wide pre-existing

### Unresolved Questions
1. What emits `status:changed` and how often? (decides M2 severity)
2. Does `roots[].status.lastCommit` ever arrive empty for a repo with commits (affects M1 scope)?
3. Is QueryClient `defaultOptions.queries.gcTime` overridden app-wide (L6)?
4. Should plan `plans/261012-1739-git-blame-caching/` phase statuses be updated by Main after fixes?
