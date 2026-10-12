# Phase 01 — Server Blame Baseline Cache

## Overview
- Priority P2; status complete; effort 6h; prerequisite: frozen DTO/ownership contract in [overview](plan.md).
- Runs independently of Phase 02. Phase 03 may author integration tests concurrently; main agent executes after both implementations land.
- Goal: repeated requests, including different dirty buffers, reuse historical attribution for the same committed path/OID without another `repo.blame_file`.

## Context and observed code
- `server/src/git/blame.rs:117-388`: input validation → root resolution → HEAD/tree/baseline resolution → historical blame → buffer projection → commit DTOs → final HEAD check.
- `blame.rs:185-201,537-575`: staged rename origins are discovered from the current index when destination is absent at HEAD. This mapping is mutable even with unchanged HEAD.
- `blame.rs:413-497`: CRLF path already maps zero-context diff's unchanged spans to native historical hunks; LF path currently calls native `blame_buffer`.
- `server/src/git/vcs_roots.rs:49-53`: primary root ID is `"."`; equal root IDs across projects are not global identities.
- `server/src/api/git_blame.rs:38-51`: admission permit is held by blocking closure. `AppState::new` creates two permits; clones must share one cache.
- Installed git2 0.19.0 `Blame<'repo>` contains a raw pointer and `PhantomData<&Repository>`; do not use lifetime erasure, unsafe Send/Sync or leaked repositories. libgit2 1.8.1 `git_blame_buffer` uses zero-context diff, but that alone does not prove attribution equivalence.
- References: [architecture](../../docs/architecture/workbench-files-editor-and-git.md), [Git API](../../docs/api/git.md), [standards](../../docs/code-standards.md).

## Exclusive ownership
Modify: `server/src/git/blame.rs` and its unit tests, `server/src/state.rs`, `server/src/api/git_blame.rs`, `server/src/git/mod.rs`, `server/Cargo.toml`, `server/Cargo.lock`.
Create: `server/src/git/blame-cache.rs`, registered as `#[path = "blame-cache.rs"] pub mod blame_cache;` to respect kebab-case file naming and ordinary Rust module identifiers. Keep cache policy separate from already-large blame module; no unrelated extraction.
Delete: obsolete production native-only projection helpers after clean cutover; no unrelated files.
Do not edit `server/tests/git_blame_api.rs` (Phase 03), UI or docs.

## Architecture and policy
### Cache identity
Use one process-wide `Arc<BlameBaselineCache>` on `AppState`:

```text
CacheKey {
  repository_identity: canonical resolved owning root path,
  root_id: resolved project-relative owning root ID,
  head_oid: captured git2::Oid,
  committed_baseline_path: current resolved repo-relative HEAD path,
}
```

The required `(root_id, head_oid, repo_relative_path)` tuple lives inside a canonical repository namespace. For a staged rename, `repo_relative_path` in the key is its committed origin, not mutable editor destination. Response `root_relative_path` stays the requested destination. Canonical root/worktree identity deliberately prevents cross-project sharing; immutable OIDs allow old revisions to remain until LRU eviction. Branch name is not a key: identical OID/history can safely reuse server history.

### Shallow repository policy
Check repository shallow status (`repo.is_shallow()`); shallow repositories bypass baseline caching and execute uncached native blame. Deepening or unshallowing a repository without moving HEAD alters reachable history; bypassing shallow repos avoids stale attribution without tracking repository history-depth boundaries.

### Owned value and projection
- Store `Arc<BlameBaseline>` containing owned baseline bytes normalized exactly as existing CRLF helper, native historical spans `(start_line, line_count, final_commit_oid)`, baseline logical line count, and blob OID for validation. Never store editor content, snapshot ID/model version, final response ranges or native handles.
- Normalize committed baseline by stripping only CR before LF, not real whitespace or lone CR. Editor buffer normalization remains existing LF/CRLF/lone-CR logic.
- Retain current commit-header bounds/DTO extraction only for OIDs actually referenced by projected output. Do not eagerly reject metadata of historical lines removed from the editor buffer, or cache all commit objects unnecessarily.
- Cold path obtains native blame, converts hunks to owned sorted spans once. Both cold and warm production paths use the same owned-span projection.
- Zero-context `git2::Patch::from_buffers` projects unchanged baseline gaps to historical spans; changed new spans are uncommitted. Use ordered hunk cursor / binary search, not a per-line allocation or repeated scan over all hunks. Equal normalized buffers can directly visit cached spans.
- Existing partition/merge, terminal empty-row treatment, empty/untracked/unborn behavior and commit ordering remain unchanged. Cached responses must be semantically identical, including commit indices after normalizing request envelopes.

### Bounds and synchronization
- Choose `parking_lot::Mutex<lru::LruCache<Key, Arc<Value>>>`; `parking_lot` exists, add one `lru` dependency at compatible stable version. Moka offers single-flight but adds unnecessary lifecycle machinery; RwLock gains little because hits update recency.
- Defaults: maximum 128 retained entries and 64 MiB accounted retained bytes, whichever is reached first. Account key string/path capacities, baseline byte capacity, span vector capacity and fixed structs using checked/saturating arithmetic. Do not use blob length alone as weight.
- Per-entry larger than total byte budget: return normally but skip admission. Evict least-recent entries until both budgets hold; replacements subtract old weight correctly. Each admitted worker pins at most one baseline Arc and retains its semaphore permit until blocking work actually finishes, even after HTTP cancellation. Therefore retained-budget accounting can exclude at most two in-use evicted baselines; document construction/projection transient allocations separately.
- Clone an `Arc` and update LRU under the mutex; release lock before normalization, diff, ODB work, Git traversal or response creation. Miss construction happens outside lock; insertion rechecks whether another request filled the key.
- No per-key single-flight or new queues in this scope. Two simultaneous cold requests may compute twice; sequential repeats must compute once. Existing global admission bounds transient work and remains unchanged.

## Implementation steps
1. Introduce cache/key/owned-span types with constructor policy and small `get`, `insert`, `len`, `retained_bytes` operations. Small capacities injectable for unit tests; no new configuration/API/cache-stat endpoints.
2. Initialize one cache in `AppState::new`; clones share its Arc. Extend the single `execute_native_blame` entrypoint to accept `&BlameBaselineCache`; route captures its Arc into existing `spawn_blocking` closure. Migrate every colocated test caller to an explicit cache; keep one entrypoint, no compatibility alias/wrapper.
3. Keep input limits, target/root/path containment, disk symlink checks, HEAD lookup and current-index rename discovery before hit eligibility. Validate HEAD entry mode, type, bounded object header and matching blob OID before reuse. Cached immutable, already-validated baseline bytes may avoid reloading the blob; mutable checks never come from cache.
4. Resolve current committed baseline path on every request. Unborn/untracked/new/empty cases preserve current output and safety checks, without negative caching or unnecessary historical traversal.
5. Build historical cache entries on miss. Preserve baseline size/NUL/binary checks before construction; use owned data only. Publish a new entry only after successful validation and HEAD stability check. Never cache failure/partial construction.
6. Implement owned-span projection using existing CRLF mapping, replacing native-hunk lookup with owned spans. Author differential oracle first: fresh native `blame_file` + native `blame_buffer` for LF; existing normalized CRLF projection semantics for CRLF. Test thoroughly with repeated identical lines across different authors, boundary newlines, and mixed EOLs.
6a. **Projection Correctness Gate**: The native differential test suite must pass completely before removing the old production helper. If projection differs from native blame on any test case, the discrepancy must be resolved before cutover.
7. Final response uses current snapshot/model envelope and requested root/path. Recheck HEAD on every path, including cache hits; reject with existing `StaleRevision`. A historical entry remains immutable even if refs move; never label its buffer projection as current after a failed HEAD fence.
8. Remove obsolete production helpers only after main-agent differential execution passes. Until then, treat LF cutover as unqualified; do not deliver a cache that still recomputes LF history on warm requests.

## Authored unit tests and success criteria
Main agent runs these in Phase 03; implementer does not execute mid-flight.
- One injected/test-only historical-loader invocation for sequential clean → same clean → dirty edit requests at same key; a new HEAD/path/repository namespace causes exactly one additional load. Instrument loader inside colocated tests, not production counters/telemetry.
- Cache unit tests: LRU access updates recency; entry/count and byte eviction; replacement accounting; oversized bypass; tiny capacities; arithmetic boundaries; no mutable borrowed objects retained.
- Native differential matrix: repeated identical lines with different historical authors; insertion/deletion at start/end/interior; adjacent replacements; entire replacement/deletion; empty baseline/buffer; trailing and missing newline; CRLF, LF and lone-CR buffer variants; preserved real whitespace; Unicode; staged rename; dirty ranges across historical hunk boundaries. Compare expanded per-line OIDs and final compact response, not only range counts.
- Existing 5 MiB, binary, symlink, nested-root, staged-rename, empty and unborn tests retain assertions; new hit-path symlink/unsupported checks must not be bypassed.
- Same-HEAD staged-rename origin changes are resolved anew. Returning to earlier HEAD may reuse its historical baseline, but buffer output is rebuilt.
- Blocking closure retains admission permit until actual worker completion, even when HTTP request is cancelled; each worker pins at most one baseline Arc. Zero-permit warm request still returns `GIT_BLAME_BUSY`. At most two admitted requests run; cache lock does not serialize distinct history operations.

## Risks and mitigations
- Projection equivalence is the principal implementation risk: native differential tests are a release blocker; fix mapping rather than weakening existing semantics.
- Canonical path namespacing is essential because `root_id` collides. Repository replacement at same path must reopen/revalidate current tree/blob, not trust retained authorization or disk state.
- No lifetime hacks/native handle retention. Account allocator capacities and transient Arc pins honestly; cache retention cap is not total process RSS cap.
- HEAD check detects final revision mismatch, not a transactional lock against arbitrary external Git ABA changes; retain existing safety model, do not introduce ref locks for read-only blame.

## Testing strategy and handoff
- Main: `cargo test --manifest-path server/Cargo.toml git::blame` (includes cache module tests matching module prefix), then `cargo test --manifest-path server/Cargo.toml --test git_blame_api`, then broader server gate in Phase 03.
- Handoff names changed files, entrypoint signature, actual cache limits, authored differential cases and known blockers. No test-pass claim until main executes.
- Unresolved questions: none. Existing two-permit admission is intentional; this phase does not promise busy-free HTTP requests.
