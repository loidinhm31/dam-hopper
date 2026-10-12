# Git Blame Caching Qualification Evidence

- Date: 2026-10-12
- Working tree: `/home/loidinh/WS/worktrees/dam-hopper-git-blame-caching`
- Branch: `feat/git-blame-caching`
- Overall Status: in-progress (Targeted validation suites passed; full authenticated E2E qualification open for Main agent)

## 1. Environment & Platform Limits
- Host OS: Linux 7.1.10-200.fc44.x86_64
- Architecture: x86_64
- Toolchain: Rust Cargo, rustc (server), Node.js v22+, pnpm 10.x, Vitest v4.1.5
- Dependencies: git2 v0.19.0 (libgit2 1.8.1), lru v0.12.5, @noble/hashes v1.7.1, TanStack Query v5

## 2. Executed Commands & Pass Counts

```bash
# 1. Rust Server Unit & Differential Oracle Tests
cargo test --manifest-path server/Cargo.toml git::blame
# Result: 31 passed, 0 failed, 0 ignored

# 2. Rust Server API Integration Tests
cargo test --manifest-path server/Cargo.toml --test git_blame_api
# Result: 16 passed, 0 failed, 1 ignored (release benchmark)

# 3. Rust Server Large-File Release Performance Benchmark
cargo test --release --manifest-path server/Cargo.toml --test git_blame_api blame_cache_large_file_performance -- --ignored --nocapture --test-threads=1
# Result: 1 passed (ok in 2.07s)

# 4. Client Blame Query Cache Unit Tests
pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame-cache.test.ts
# Result: 25 passed, 0 failed

# 5. Client Hook Unit Tests
pnpm --filter @dam-hopper/ui test src/hooks/use-editor-git-blame.test.tsx
# Result: 19 passed, 0 failed

# 6. Client Git Blame & Diff Regression Suites
pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame.test.ts src/api/queries-git-diff.test.ts
# Result: 50 passed, 0 failed

# 7. UI Build & Typecheck
pnpm --filter @dam-hopper/ui build
# Result: tsc -p tsconfig.json exited 0

# 8. Focused Browser Component Suite
E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/editor-git-blame.browser.tsx
# Result: 3 passed, 0 failed
```

## 3. Performance Benchmark Figures

- Fixture: `large.txt`, 10,000 lines, 101 commits, 407,986 content bytes.
- Server cache limits: 128 max entries, 64 MiB max retained bytes.
- Cold first request (uncached baseline compute + ODB diff): **161.85 ms**
- Baseline cache state: 1 entry, 416,269 retained bytes.
- Sequential warm repeat requests (20 iterations):
  - Median: **7.59 ms** (>21x speedup vs cold)
  - P95: **9.17 ms**
- Dirty buffer requests (20 iterations modifying scattered lines):
  - Median: **10.79 ms** (>15x speedup vs cold)
  - P95: **12.86 ms**
- Final baseline cache state: 1 entry, 416,269 accounted retained bytes.

## 4. Qualification Matrix Status

| ID | Gate | Status | Evidence / Notes |
|---|---|---|---|
| S01 | Server sequential clean repeat | Passed | `test_cache_lifecycle_and_reuse` (loader count = 1), `test_api_blame_cache_sequential_clean_repeat_and_dirty_projection` |
| S02 | Server dirty replacement/add/delete | Passed | `test_differential_insertions_and_deletions`, API dirty projection test (ranges partitioned, loader count = 1) |
| S03 | Server new HEAD & canonical root isolation | Passed | `test_cache_lifecycle_and_reuse` (new HEAD loads once), `test_api_blame_cache_new_head_advances_cache` |
| S04 | Same-HEAD staged rename/index change | Passed | `test_differential_staged_rename`, `assert_rename_baseline_guard` |
| S05 | Warm-path bounds & security | Passed | `test_api_blame_cache_warm_disk_symlink_rejected`, path traversal, binary/size checks |
| S06 | HEAD safety and admission | Passed | `test_api_blame_concurrency_busy_status`, `ensure_head_unchanged` fence unit tests |
| S07 | Server LRU/byte eviction | Passed | `test_cache_lru_entry_eviction`, `test_cache_byte_budget_eviction`, replacement weight tests |
| C01 | Enable → disable → enable | Passed | `editor-git-blame-cache.test.ts`, `use-editor-git-blame.test.tsx` |
| C02 | A → B → A tab switch / reopen | Passed | Rebound modelVersion/snapshot envelope, zero new blame POSTs |
| C03 | Content fingerprinting | Passed | WeakMap SHA-256 memoization, rebound envelope |
| C04 | Dirty edit burst / debounce / undo | Passed | 250ms debounce, undo content reuse |
| C05 | Profile/generation/worktree separation | Passed | `isMatchingBlameQueryKey`, `isMatchingGitQueryKey`, cross-profile exclusion |
| C06 | Same-HEAD index mutation invalidation | Passed | Immediate `advanceTargetEpoch`, attribution cleared, no recursive refresh loop |
| C07 | External HEAD / unborn transition | Passed | `replaces unborn Uncommitted attribution after first commit discovered` |
| C08 | Refresh / focus coalesce | Passed | `triggers repository refresh on window focus and manual refresh without periodic polling` |
| C09 | Client LRU / byte bounds | Passed | 64 entries, 32 MiB bounds, monotonic sequence counter, repeated-key admission |
| C10 | Error / busy outcomes | Passed | No error caching, explicit retry |
| C11 | Clear / retire during pending request | Passed | Lease cancellation on QueryClient.clear, unmount disposal |
| B01 | Real Monaco lifecycle | Open / Partial | Browser geometry tests passed (3/3); full hook-driven remount harness deferred to Main agent |
| E01 | Authenticated app journey | Open | Full containerized application journey deferred to Main integration agent |
| E02 | Real branch/commit while inactive | Open | Containerized Git mutation journey deferred to Main integration agent |
| P01 | Large file/history benchmark | Passed | 10k lines, 101 commits release benchmark executed and recorded |

## 5. Open Items for Main Integration Agent
1. B01: Author real hook-driven remount harness alongside existing static Monaco browser tests.
2. E01-E02: Execute full authenticated application E2E journey in container environment.
3. Final doc updates in `docs/architecture/workbench-files-editor-and-git.md`, `docs/api/git.md`, and `docs/CHANGELOG.md` upon final release.
