# Phase 03 — Invalidation, Integration and Performance Qualification

## Overview and dependencies
- Priority P2; status complete (03A authoring complete, 03B targeted validation passed; container E2E open for Main integration agent); effort 6h.
- **03A authoring:** parallel with 01/02, exclusively on files below; use frozen existing DTOs and actual shared invalidation paths. If helper API not landed, agree its signature with owner; do not invent production test hooks.
- **03B execution:** only after 01 and 02 terminal results and 03A tests land. Main integration agent runs all checks; this test-writing agent skips builds/tests/lint/formatters mid-flight.
- Native differential comparison passing is mandatory before shipping owned LF projection. Failures return to Phase 01 file owner; client lifecycle failures return to Phase 02 owner. Tests are not weakened to match new behavior.

## Context links and current coverage
- [Overview and ownership](plan.md), [server phase](phase-01-server-blame-cache.md), [client phase](phase-02-client-blame-query-cache.md), [testing guide](../../docs/testing.md).
- `server/tests/git_blame_api.rs`: real temporary Git repos, Axum router and retained AppState; already covers dirty/EOL, body limits and exhausted semaphore. Extend rather than create a duplicate fixture framework.
- `use-editor-git-blame.test.tsx`: jsdom QueryClientProvider + mock editor, deferred request and fake-clock seams; already exercises same-HEAD mutation and cross-profile exclusion.
- `editor-git-blame.browser.tsx`: currently supplies static gutter data to real Monaco; it does not prove hook caching. Add real hook/QueryClient-driven remount harness alongside existing geometry tests.
- `e2e/editor-git-blame/*`: production authenticated application fixture, real repo copied to isolated container; >200 churn commits currently touch only `churn.txt`, not annotated code. Add a genuinely history-heavy large file for performance, not just deep but unchanged history.

## Exclusive ownership
Modify:
- `server/tests/git_blame_api.rs`.
- `packages/ui/src/hooks/use-editor-git-blame.test.tsx`, `use-sse.test.ts`.
- `packages/ui/src/api/queries-git-diff.test.ts`.
- `packages/ui/src/lib/editor-git-blame.test.ts`.
- `packages/ui/browser-tests/editor-git-blame.browser.tsx`.
- `packages/ui/e2e/editor-git-blame/editor-git-blame.spec.ts`, `git-fixture.ts`.
- `docs/architecture/workbench-files-editor-and-git.md`, `docs/api/git.md`, `docs/testing.md`, `docs/project-roadmap.md`, `docs/CHANGELOG.md`.
Create: `plans/261012-1739-git-blame-caching/qualification.md` only after actual integrated execution, for results/commands/environment/limits.
No production/cache-helper files, manifests, lockfiles or Phase 01 inline tests. No need to modify browser config, E2E fixture core, terminal runtime or application components.

## Qualification matrix — concrete gates
| ID | Layer / scenario | Required observable result |
| --- | --- | --- |
| S01 | Server sequential clean repeat, new snapshot/model IDs | Same semantic attribution; current envelope echoed; one retained baseline. Phase 01 unit-loader counter proves exactly one historical computation across repeats. |
| S02 | Server dirty replacement/add/delete at same HEAD | Dirty spans uncommitted, untouched authors stable; historical loader count stays one; no final-response cache keyed by content only. |
| S03 | Server new HEAD, different path, different canonical root | Distinct baseline entries and correct authors; each cold key performs its own history load. Primary `rootId = "."` across two projects cannot cross-hit. |
| S04 | Same-HEAD staged rename/index change | Re-resolve rename origin for each request; destination removed/recreated or mapped differently never reuses wrong baseline. Cover nested root and linked worktree. |
| S05 | Warm-path bounds/security | Warm then change disk path to symlink; reject. Traversal, NUL, invalid target/removed worktree, oversized baseline/buffer remain existing errors; no cache-hit auth/target bypass. |
| S06 | HEAD safety and admission | Warm cache does not evade final HEAD check or two-permit busy response. Retained Arc holds no native repo handle. No assertion of one computation for simultaneous cold requests without single-flight. |
| S07 | Server LRU/byte eviction | Small injected policy evicts true LRU, rejects oversized admission, preserves normal response and correct replacement accounting. Public `len`/retained-weight seam sufficient for HTTP tests; no new production counters/endpoint. |
| C01 | Enable → disable → enable | First POST once; second activation ready immediately and no blame POST, provided owner/root/content remain trusted. |
| C02 | A → B → A with actual unmount; close/reopen/re-enable | A's attribution restored with current model version/snapshot envelope, zero new A blame calls; never render waiting/loading spinner on eligible warm return. Reopen does not auto-enable session toggle. |
| C03 | Same model version but changed content; new model same content | Changed fingerprint misses; identical content on fresh model hits with rebound envelope. Tab/model identity not part of reusable key. |
| C04 | Dirty edit burst / undo / cancellation | Old attribution cleared in edit callback; zero POST before 250 ms, one for final snapshot; undo to exact cached content may hit after debounce; delayed response cannot publish/cache after edit or invalidation. |
| C05 | Profile/generation/worktree/root separation | Equal project/path/content on other profile, generation, worktree or nested root cannot hit; disconnected/binding mismatch returns unavailable, not cached ready. |
| C06 | Inactive target index/history/branch mutations | Unmount every blame hook, run actual shared mutation invalidator or owner bridge event, remount: old entry rejected. Same-HEAD index change matters; commit/rewrite/reset and branch change yield correct new authors/HEAD. |
| C07 | External HEAD and unborn transition | Focus/visibility root discovery detects new HEAD/root; unborn null is known state and first commit invalidates it. Pending/unknown/invalidated discovery does not authorize a new instant hit; late discovery racing mutation/clear cannot restore obsolete trust. |
| C08 | Manual refresh / unchanged focus | Forced refresh bypasses completed cache and calls blame once; unchanged focus performs root discovery but zero blame requests; duplicate status/query invalidation signals coalesce. |
| C09 | Cache bounds/lifecycle | Churn >64 entries and enough metadata to exceed 32 MiB; eviction leaves existing rendered response intact. Five-minute GC, QueryClient.clear and exact owner retirement release entries/leases/subscriptions; no Monaco retention or lingering timers. |
| C10 | Malformed/busy/error/cancel outcomes | No reusable failed entry; existing UI taxonomy retained. Subsequent explicit refresh can recover; no hidden automatic retry loop. |
| C11 | Clear/retire during first pending request | With no completed entry, defer request, clear QueryClient or retire owner, then resolve ignored-abort response: no visible publication, cache repopulation, retained marker or listener. |
| B01 | Real Monaco lifecycle | Real model/editor unmount/remount with retained host QueryClient; warm author rows/current-version reveal available before any loading element appears, no extra API invocation. |
| E01 | Real authenticated application journey | Observe actual POST `/api/git/{project}/blame`, not mocked hook counter; A/B tab cycle and toggle count unchanged on eligible warm return; separately prove hook/model disposal via close/reopen, not an assumed tab-switch unmount. Dirty edit and explicit Refresh each increase count as specified. |
| E02 | Real branch/commit while inactive | Manipulate only isolated fixture repo/container; return to tab after actual operation/focus and verify new attribution/HEAD; unchanged file bytes but changed authors/history still invalidate. |
| P01 | Large file/history | 10,000 lines, >=100 commits modifying that file, buffer below 5 MiB. Warm/dirty sequential requests reuse baseline; 50 unchanged tab cycles produce zero new blame POSTs and no loading frames. Timing recorded, not substituted for work-count gates. |

## Implementation steps — test authoring
1. Extend real Git API fixtures locally in `git_blame_api.rs`. Keep each test isolated; configure fixed author/timestamp where OIDs/attribution matter. Capture disk/index/tree/HEAD before read-only calls and assert unchanged afterward. Use existing AppState constructor, shared Arc cache, canonical project/worktree resolution and actual router.
2. Build cold/warm/new-revision/index-rename API assertions. Assert expected `baseCommitOid`, referenced commits, contiguous line ranges and current snapshot/model echo. Cache entry count/weight confirms retained data; historical invocation proof stays Phase 01's unit-injected loader, never infer a hit from timing alone.
3. In jsdom hook tests, retain the same QueryClient across full root unmount/recreate. Create different model IDs/versions with identical content. Preserve expected snapshot/model correlation on each mock HTTP response; do not reuse an old response envelope to fabricate correctness.
4. Add helper/mutation/event tests calling `invalidateGitFileOperation`, `invalidateGitHistoryOperation`, `invalidateGitBranchOperation` and owner `installTransportBridge`. Test no mounted hook, multiple worktrees, unrelated profile/generation, missing event project metadata and invalidation during deferred network request. Extend key matcher tests without making blame's own invalidation a recursive Git mutation.
5. Fake timers deterministically prove 249 ms/250 ms boundaries, response cancellation and GC cleanup. Flush promises deliberately; do not turn arbitrary sleeps or exact microtask counts into acceptance.
6. Add real-Monaco browser harness that mounts `useEditorGitBlame` and production gutter through QueryClientProvider and connection fixture, using a counting API seam only at HTTP boundary. Keep existing static-data geometry tests intact. Detect any warm loading element with DOM mutation observation spanning mount, not only a final assertion after spinner disappears. If WorkspacePage imported, mock `TerminalKeepAliveHost: () => null` to isolate editor behavior; do not mock Monaco/cache logic.
7. Extend existing authenticated application journey with actual request counting filtered by POST method, route and body path. Register observer before enabling; retain count baseline for each scenario. No `page.route` fake blame responses or `--no-auth` application journey. Exercise real tab unmount, close/reopen/re-enable, dirty debounce and manual Refresh.
8. Expand `git-fixture.ts` with two files/tabs and a large history-heavy file; preserve existing exact Alice/Bob commits and >200 pagination behavior. Add deterministic branch/history variants with same final file content but different author commits to prove HEAD, not content alone, controls cache identity. Clean host temp directory/container state in existing finally path.
9. Add ignored release-performance test `blame_cache_large_file_performance` in `git_blame_api.rs`, with many attribution-changing commits. Measure fresh-cache first request, sequential warm requests and dirty projections separately; no repeated cold setup in timed interval. Keep construction outside timings and annotate fixture-size/commit-count assertions.

## Main-agent verification strategy — after all three terminal results
Run from feature worktree root, sequentially. No checks executed during this planning assignment.

```bash
# Full Rust gate includes owned-hunk differential and HTTP cache tests.
cargo test --manifest-path server/Cargo.toml

# Full unit suite includes existing regression tests plus new cache helper.
pnpm --filter @dam-hopper/ui test

# Production UI and E2E fixture typechecks.
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm lint

# Focused Chromium regression: real Monaco + hook remount.
E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/editor-git-blame.browser.tsx

# Existing production service/image lifecycle; authenticated browser fixture.
E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e editor-git-blame/editor-git-blame.spec.ts

# Separately identified ignored benchmark, release engine, one runner.
cargo test --release --manifest-path server/Cargo.toml --test git_blame_api blame_cache_large_file_performance -- --ignored --nocapture --test-threads=1
```

These are planned commands, not reported passes. Missing local Chromium/container/auth dependency is an explicit gate limitation; finish available gates, record exact blocker, never downgrade an authenticated E2E into a mock test. Root `pnpm check` includes native build and is not required to claim web/server cache qualification; native runtime remains a separate platform scope.

## Performance and memory evidence
- Deterministic CI blockers: sequential historical loader count, no redundant warm HTTP calls, correct attribution/partition and retained count/byte policy. Do not assert universal sub-millisecond engine cost or busy-free requests.
- Record release toolchain/libgit2/platform/CPU, fixture byte/line/commit counts, cold sample and median/p95 of >=20 warm/dirty samples; cache size/weight before/after LRU churn. Timing goal on same quiet machine: warm median below cold baseline; investigate contrary results, never relax correctness to improve timings.
- Browser: record first-enable latency separately from eligible warm mount latency and hash overhead. Planned warm UI target p95 <=100 ms on 10k-line fixture; 50 cycles, zero extra blame requests, zero loading frames are mandatory. If hash dominates, improve memoization/implementation within Phase 02 ownership rather than adding a worker framework without evidence.
- For memory stress, inspect conservative retained weight plus browser/process heap trend where tools available. Successful model disposal and owner/QueryClient listener release are mandatory; exact allocator/RSS plateau is observational, not inferred from LRU length. The two-evicted-baseline Arc bound requires each worker to pin at most one entry and hold admission until actual blocking completion, including cancellation.
- Keep benchmarks/tests reproducible in existing suites; no throwaway scripts or public telemetry/cache stats endpoints.

## Documentation, release and acceptance
- Only after actual checks: replace planned architecture label with live design matched to code; update API blame caching/bounds/admission note without changing wire schema or SHA-1 engine support; add testing recipe, roadmap qualification status and `docs/CHANGELOG.md` entry.
- `qualification.md` records commands and actual counts/output references, benchmark figures, side-effect checklist findings, platform limits and unmet gates. Planning document status becomes completed only after main integrates and qualifies; no invented verification report before execution.
- Functional automation does not imply human visual acceptance. Commands above disable capture to avoid rewriting unrelated historical screenshots; if main opts into visual capture, explicitly allocate existing E2E evidence files to this phase before writing, follow full-viewport policy and leave human review pending until operator approval.
- Full feature qualification requires every mandatory S/C/B/E/P correctness/lifecycle gate to pass; no production stubs/compatibility paths, abandoned native projection branch or TODO-only tests. Missing real environment prerequisites may finish available execution/reporting work, but leave mandatory differential/browser/authenticated-E2E gates open and implementation/plan status in-progress, not fully qualified/completed. A correctness assertion failure is a failure, never an environment blocker. Main owns final review and remedial file-owner routing.
- Unresolved questions: none blocking. Performance thresholds are target-host qualification policy, not a claim made from this planning session.

## Qualification execution summary
- Date: 2026-10-12
- Rust server unit tests: 31 passed (`cargo test --manifest-path server/Cargo.toml git::blame`)
- Rust server API tests: 16 passed, 1 ignored benchmark (`cargo test --manifest-path server/Cargo.toml --test git_blame_api`)
- Rust large file performance: 1 passed (`cargo test --release --manifest-path server/Cargo.toml --test git_blame_api blame_cache_large_file_performance -- --ignored --nocapture --test-threads=1`)
  - Fixture: 10,000 lines, 101 commits, 407,986 bytes
  - Cold first request: 161.85 ms (1 entry, 416,269 retained bytes)
  - Warm sequential repeats (20 samples): median 7.59 ms, p95 9.17 ms (>21x speedup)
  - Dirty buffer requests (20 samples): median 10.79 ms, p95 12.86 ms (>15x speedup)
- UI unit tests: 44 passed (`pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame-cache.test.ts src/hooks/use-editor-git-blame.test.tsx`)
  - `editor-git-blame-cache.test.ts`: 25 passed
  - `use-editor-git-blame.test.tsx`: 19 passed
- UI git blame/diff regressions: 50 passed (`src/lib/editor-git-blame.test.ts`, `src/api/queries-git-diff.test.ts`)
- UI build & typecheck: clean (`pnpm --filter @dam-hopper/ui build`, `tsc -p tsconfig.json`, exit code 0)
- Browser component tests: 3 passed (`E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/editor-git-blame.browser.tsx`)
- Qualification artifact: detailed commands, evidence and open gates recorded in `plans/261012-1739-git-blame-caching/qualification.md`
