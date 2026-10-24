# Code Review — Git Conflict Resolver Phase 09 (Qualification and documentation)

Score: **3/10**. Backend hardening mostly sound. Qualification evidence and docs claim what was not run or does not exist. Phase 09 is not complete per its own go/no-go.

## Critical
1. `reports/qualification-evidence.md:6` — "working tree verified clean" is false. 10 tracked files are modified and 4 untracked at review time. Fingerprint is HEAD only.
2. `reports/qualification-evidence.md:16,19,104` + `docs/CHANGELOG.md:10` + `docs/project-roadmap.md:11,28` — marks AC12, "Linux-native host" and "initial release qualified" **QUALIFIED/Complete**. Phase-09 lines 16, 64–66, 162 make these blocking. None was produced:
   - no actual Linux Tauri launch/interaction record
   - no fresh full-viewport captures
   - no human ACCEPTED (`review.md`)
   - no `e2e/git-conflict-resolver/*.spec.ts`
   - Chromium and a smoke script are explicitly not native proof.
3. `scripts/qualify-git-conflict-resolver.mjs:138` — harness runs `--no-auth`. Phase 09 step 6 says this never qualifies authenticated production web. Evidence line 18 ("Production Web UI Surface QUALIFIED") is unsupported.
4. `reports/qualification-evidence.md` cites **non-existent artifacts** (verified missing):
   - `packages/ui/src/lib/conflict-region-mapper.test.ts` (:51, AC4)
   - `packages/ui/src/lib/conflict-tokenization.test.ts` ("15 unit tests passing", :71, AC7)
   - `packages/ui/src/lib/conflict-draft-key.test.ts` (:86, AC9)
   - `server/tests` fns `test_preconditioned_resolve_rejects_stale_index` and `test_binary_conflict_detection` (:78, :64)
   - "12 tests" in `conflict-draft-capacity.test.ts`; the tester report shows 3.
5. `reports/resource-qualification.md:13-16,20-22` — stated bounds contradict code. `server/src/git/conflict.rs:11-15` has 5 MB stage, 15 MB total, 5 MB worktree, 50,000 lines and 100,000-byte lines. The report says 2 MB / 10 MB / 20,000 / 10,000. The "Measured Platform Performance" section (ms latencies, 22/28 MB RSS, 14 MB UI heap) has no measurement tooling or artifact (the script has no timing). Fabricated. Phase 09 step 8 also needs at/over-bound loads and a grown-dirty-result check; none run.
6. `docs/CHANGELOG.md:7,8` — claims the harness covers "primary and nested repositories" and a "commit-message editor sentinel handoff". The script only builds the nested repo, never calls it, and never executes a real `continue` that hits the sentinel. It reads `stoppedReason` from the status endpoint. The `del-mod` resolve (script :300-312) is unasserted and conditional. Tester confirmed nested not exercised.

## Warnings
- `server/src/git/operation.rs:384` — `RollingSentinelScanner::feed` replaces `tail` with only the current chunk's bytes. A sentinel split across 3+ small reads (a chunk shorter than 14 bytes) is missed. Keep the combined tail. It also allocates a `Vec` per chunk (:372-374). No unit test for the scanner.
- `operation.rs:548` — sentinel now scanned on stdout too. A commit subject or hunk containing `DAM_HOPPER_EDITOR_REQUIRED` triggers a false `MessageEditRequired` handoff. Scope to stderr (the editor writes there) or justify.
- `operation.rs:116` — `read_to_string(sequencer/todo)` now fail-closes on non-UTF-8, so a legitimate cherry-pick/revert sequence with a non-UTF-8 subject becomes `Unknown` and un-continuable/un-abortable. Use `fs::read` + `from_utf8_lossy`.
- `operation.rs:695-700` — a failed post-attempt refresh is swallowed via `.ok().and_then(r.ok())` and falls through to `Failed("Continue failed")`. Phase 09 line 45/95: refresh failure must be `OutcomeUnknown`/no-replay. Also the refresh runs before the cheap `editor_invoked` check.
- `operation.rs:168,178` — `repo.head()` called twice; fold into one call.
- `operation.rs` `ProcessGroupGuard` (:417-475) — no test (timeout kill, drop-on-cancel). Windows branch runs blocking `taskkill ... .output()` inside `Drop`/async. Grandchildren in other process groups are not covered. The `tokio::spawn` handler change (`api/git_diff.rs:395-401`) has no disconnect-survival test.
- `server/src/git/mod.rs:44` — `run_bounded_git_command` re-exported pub, with no external consumer (grep found none). Unneeded API surface. Also unrelated removal of `pub use progress::ProgressSender` (:45).
- `conflict_resolve.rs:54-95` — `disk_path: Option<&Path>` is always `Some` (YAGNI; use `&Path`). `fs::metadata` follows symlinks (use `symlink_metadata`). A metadata error silently zeroes stat. Large unix/non-unix cfg block. No test proves the "git merge --abort recognizes resolved files" claim (CHANGELOG:7); `ino`/`dev` are truncated `as u32`.
- `server/tests/git_conflict_operation_lifecycle.rs` `test_hook_failure_not_misclassified_by_precommit_path` — misnamed. It only asserts the `Conflicts` block and never reaches the hook-classification path. `test_stopped_reason_unsupported_vs_unknown` never asserts `Unknown`.
- `browser-tests/git-conflict-resolver.browser.tsx` z-order test (:~440) — uses a synthetic `<header z-50>` and `elementFromPoint(20,20)`. Not the real TopNav/app layout, so W5 ("validate in full application page layout") is unmet. The 1400px test only asserts text and no tablist, not 3-pane geometry. These are weak wiring tests (Phase 09: no wiring/source-text tests).
- `docs/api/git-operation-lifecycle.md:118` — `stoppedReason` enum not updated for the new `"unsupported"` value (`types.rs:676`, `client.ts:2548`). Phase 09 also requires updating `docs/api/git.md`, `rest-endpoints.md`, `architecture/workbench-files-editor-and-git.md`, `frontend-components/terminal-and-ide.md`, `system-architecture.md`. Only CHANGELOG/roadmap changed.
- `plans/…/phase-09-*.md` and `plan.md:36` still "Pending 0%", all todos unchecked, including inherited W2/W3/W5/W6 and Step 12. W6 (view zones, geometry retention, hook consolidation, legacy parser removal) is not implemented, yet the roadmap/CHANGELOG say complete.
- `scripts/qualify-git-conflict-resolver.mjs`:
  - fixed port 14820
  - debug-binary-only, no freshness check
  - server stdout piped but never drained
  - `git` run with the user's global config/hooks (no `GIT_CONFIG_GLOBAL`/`HOME` isolation)
  - no wait after SIGTERM before `rmSync`
- `docs/CHANGELOG.md:4` — "client request disconnects cannot abort mutations" is only true for the operation endpoint, not other mutation handlers. "W2, W5/W10, W11" labels are undefined in-repo.

## Suggestions
- Re-scope the evidence report to what ran: 42 backend integration tests, 204 lib tests, 14 targeted browser tests, 37+31 unit tests, and the 45-assertion `--no-auth` smoke. Mark AC12, Linux-native, captures and human review **Pending/blocking**.
- Replace the resource report with real measured numbers (from `conflict.rs` constants plus a measurement script), or delete it.
- Fix the roadmap/CHANGELOG to "In progress — Phase 09 evidence incomplete".
- Add unit tests for the scanner (split chunks), `ProcessGroupGuard`/timeout kill, fail-closed metadata (permission error), and stat population. Extend the smoke script to run a real `continue` through the editor sentinel, hit the nested root, and assert the `del-mod` resolve.
- Drop the incidental blank-line deletions in `types.rs:~677` and `client.ts:~2549`.

## Reviewed files
All 13 listed, plus `plans/reports/tester-261021-1610-phase-09-qualification.md` and phase-09/plan files.

## Validation
- `cargo test --test git_conflict_operation_lifecycle` (run by reviewer): 14/14 pass.
- Tester report (not re-run by reviewer):
  - backend integration suites 42/42
  - `--lib git::` 204/204
  - `tsc --noEmit` clean
  - 4 targeted browser files 14/14
  - UI unit 37 + merge-model 31
  - smoke script 45/45
- Existence checks (`ls`/grep) show the cited test files and fns above are missing.
- `cargo fmt --check` is repo-wide noisy (many unrelated files); not used as a signal.

## Unresolved questions
- Is the Linux Tauri host and human reviewer actually available? If not, Phase 09 and initial release must stay Pending.
- Should the `ProgressSender` re-export removal stay in this phase?
- Should `Unsupported` vs `Unknown` also be surfaced in UI copy (no UI handler found)?
