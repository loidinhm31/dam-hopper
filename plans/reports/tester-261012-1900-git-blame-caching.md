# Phase 03 Qualification Report: Git Blame Caching

- Date: 2026-10-12
- Working tree: `/home/loidinh/WS/worktrees/dam-hopper-git-blame-caching`
- Branch: `feat/git-blame-caching`
- Scope: Phase 03 Invalidation, Integration and Performance Qualification
- Overall Status: in-progress (Targeted validation suites passed; full container E2E qualification open for Main agent)
---

## 1. Test Results Overview

| Test Suite | Commands | Passed | Failed | Ignored / Skipped | Duration |
|---|---|---|---|---|---|
| Rust server unit / differential | `cargo test --manifest-path server/Cargo.toml git::blame` | 31 | 0 | 0 | 0.00s |
| Rust server API integration | `cargo test --manifest-path server/Cargo.toml --test git_blame_api` | 16 | 0 | 1 (perf benchmark) | 0.83s |
| Rust large-file performance benchmark | `cargo test --release --manifest-path server/Cargo.toml --test git_blame_api blame_cache_large_file_performance -- --ignored --nocapture --test-threads=1` | 1 | 0 | 0 | 1.89s |
| UI client blame cache unit | `pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame-cache.test.ts` | 25 | 0 | 0 | 24ms |
| UI client blame hook unit | `pnpm --filter @dam-hopper/ui test src/hooks/use-editor-git-blame.test.tsx` | 19 | 0 | 0 | 69ms |
| UI git-blame & git-diff regressions | `pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame.test.ts src/api/queries-git-diff.test.ts` | 50 | 0 | 0 | 13ms |
| UI build & typecheck | `pnpm --filter @dam-hopper/ui build` | Exit 0 | 0 | 0 | 7.67s |
| Monaco browser component tests | `E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/editor-git-blame.browser.tsx` | 3 | 0 | 0 | 213ms |
| **Total** | | **145** | **0** | **1** | |

---

## 2. Issues Investigated & Resolved

1. **Rust Server `BlameBaselineCache` Debug Trait & Differential Test Type Mismatch**
   - Error: `CacheInner` missing `std::fmt::Debug`; `model_version: i as u64` expected `i64`.
   - Fix: Manual `Debug` implementation for `BlameBaselineCache` reporting entry count and retained bytes. Fixed `model_version: idx as i64` in differential test matrix.

2. **Rust Test Multi-Threading Race on `TEST_HISTORICAL_LOAD_COUNT`**
   - Symptom: `test_cache_lifecycle_and_reuse` assertion `left == 14, right == 8` under multi-threaded test runners.
   - Fix: Scoped `TEST_HISTORICAL_LOAD_COUNT` to `thread_local!` atomic counter. Zero cross-thread interference; 31/31 unit tests pass in parallel.

3. **TypeScript Build TS2345 in `queries.ts`**
   - Error: `invalidateGitFileOperation`, `invalidateGitHistoryOperation`, etc. pass `ConnectionRef | undefined` from `resolveTargetOwner`, while `invalidateBlameForTarget` strictly expected `ConnectionRef | null`.
   - Fix: Extended parameter type in `invalidateBlameForTarget` to `owner: ConnectionRef | null | undefined`. Clean `pnpm --filter @dam-hopper/ui build`.

4. **Client LRU Sub-Millisecond Timestamp Aliasing**
   - Symptom: `touchCompletedBlameHit` test failed because `Date.now()` resolution assigned identical timestamps across rapid in-memory writes, evicting the touched item.
   - Fix: Replaced `Date.now()` in `LRUEntry.lastAccessed` with strictly monotonic counter `let globalLruAccessCounter = 0;`. Touches and inserts increment monotonically; true LRU preserved.

5. **Client Cache Repeated-Key Admission Byte Accounting**
   - Issue: Overwriting existing key in `setCompletedBlamePayload` double-counted `state.totalBytes` and checked `size + 1` against capacity.
   - Fix: Deduct existing entry's weight from `state.totalBytes` before capacity checks, use `entryCountDelta = existingEntry ? 0 : 1`, and update weight correctly. Added repeated admission unit test.

6. **Client Same-HEAD Mutation & Reblame Feedback Loop**
   - Issue: Staged rename / index diff mutation on same HEAD bypassed reblame due to warm client cache hit; conversely, blame's own invalidation triggered recursive refresh loops.
   - Fix:
     - On git-diff mutation invalidation, immediately call `advanceTargetEpoch(queryClient, owner, target)`, clear attribution, set waiting status, and set `bypassCache: true`.
     - Removed blame query invalidation from refresh trigger list, respecting Phase 03 invariant: "Extend key matcher tests without making blame's own invalidation a recursive Git mutation."
     - Excluded cache evictions (`isRemoved`) from repository mutation triggers.

---

## 3. Qualification Matrix Verification & Gate Status

- **S01–S02**: Verified via `test_cache_lifecycle_and_reuse` (historical loader count = 1 on clean/dirty reuse) and `test_api_blame_cache_sequential_clean_repeat_and_dirty_projection` (envelope rebound, 4 ranges partitioned).
- **S03**: Verified distinct baseline entries and cold load per HEAD via `test_cache_lifecycle_and_reuse` and `test_api_blame_cache_new_head_advances_cache`.
- **S04**: Verified dynamic staged rename origin resolution via `test_differential_staged_rename` and `assert_rename_baseline_guard`.
- **S05**: Verified warm cache does not bypass disk symlink security check via `test_api_blame_cache_warm_disk_symlink_rejected` (415 error preserved).
- **S06**: Verified two-permit concurrency busy response and HEAD fence preservation via `test_api_blame_concurrency_busy_status`.
- **S07**: Verified LRU eviction and byte-budget limits via `test_cache_lru_entry_eviction` and `test_cache_byte_budget_eviction`.
- **C01–C05**: Verified client query cache hit derivation, envelope rebinding, undo recovery, and profile/target separation in `editor-git-blame-cache.test.ts`.
- **C06–C08**: Verified same-HEAD staged rename invalidation, window focus debounce, and intent coalesce in `use-editor-git-blame.test.tsx`.
- **C09–C11**: Verified LRU/byte limit eviction, lease revocation on clear, no feedback loop in `editor-git-blame-cache.test.ts`.
- **B01**: Partially verified via Monaco browser geometry tests (3/3 passed); real hook/QueryClient remount harness open for Main integration agent.
- **E01–E02**: Open for Main integration agent (requires containerized environment and authenticated application fixture).
- **P01**: Verified via `blame_cache_large_file_performance` benchmark (10k lines, 101 commits).
---

## 4. Performance & Benchmark Observations

Release build benchmark (`blame_cache_large_file_performance`):
- Host: Linux 7.1.10-200.fc44.x86_64, cargo release profile (optimized).
- Fixture: 10,000 lines, 101 attribution commits, 407,986 content bytes.
- Cold first request (uncached baseline compute + ODB diff): **161.85 ms**
- Baseline cache state: 1 entry, 416,269 retained bytes.
- Sequential warm repeat requests (20 iterations):
  - Median: **7.59 ms** (>21x speedup vs cold)
  - P95: **9.17 ms**
- Dirty buffer requests (20 iterations modifying scattered lines):
  - Median: **10.79 ms** (>15x speedup vs cold)
  - P95: **12.86 ms**
- Accounted retained bytes: stable at 416,269 bytes throughout warm and dirty passes.
---

## 5. Build Status & Next Steps

- Backend: Targeted Rust server unit and integration suites passed.
- Frontend: Targeted TypeScript typecheck and Vitest suites passed.
- Code Standards: Tiny functions inlined, modular structure maintained.
- Next Steps: Hand off to Main integration agent for full containerized E2E validation (E01/E02), hook-remount browser harness (B01), and release documentation.

## 6. Unresolved Questions

- None blocking for targeted test suites. Full E2E container validation remains scheduled for Main agent integration pass.
