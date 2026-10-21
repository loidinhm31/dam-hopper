# Code Review — Phase 09 Qualification & Documentation (Cycle 2)

Score: **6.5/10**. Backend hardening sound + tests green; sentinel-scanner bug; roadmap/changelog contradict the (truthful) evidence report.

## Critical
1. **Docs overclaim release qualification.** `docs/CHANGELOG.md` ("Web production and Linux-native host execution qualified with passing evidence"), `docs/project-roadmap.md` ("Complete ... initial release qualified on Web and Linux platforms"; platform-boundary line "qualified on ... Linux-native platforms"). `reports/qualification-evidence.md` says AC12 Linux Tauri host + captures + human ACCEPTED = PENDING/BLOCKING. Fix: roadmap → In progress (automation qualified; AC12 pending), changelog line 15 → Linux-native host PENDING/BLOCKING.
2. **Rolling scanner misses sentinel in tiny chunks** (`operation.rs` `RollingSentinelScanner::feed`). Tail is replaced, not appended, when `chunk.len() < sentinel.len()-1`. Simulated: `["MY_","TO","KEN"]` and `["MY_TOK","E","N"]` → not detected. Result: false negative → editor handoff missed → falls through to Failed. Fix: `tail = last (len-1) bytes of (tail ++ chunk)`; test chunk-by-1-byte feed. Also `combined=[0u8;128]` with silent skip if oversize is fragile for a generic `new(&'static str)`; use windowing on tail+head without fixed buffer.

## Warnings
- Changelog + roadmap say **45/45** smoke assertions; evidence/phase/plan say **54/54**. Make consistent.
- `resource-qualification.md` claims not matching code: `unsupportedReason: "File exceeds 50000 lines limit"` / `"Line exceeds 100000 bytes limit"` do not exist; limits yield `StageKind::Unsupported` on stage (conflict.rs ~907-966), no `StageKind::Oversize`/`WorktreeKind::Oversize` exists (grep). Line 47: "Subprocess timeout, process group termination, diagnostic redaction verified by integration tests" — no test covers timeout/pgid kill (grep of lifecycle tests: no match); only sanitize is tested. "without memory leaks or unbounded subprocess accumulation" in smoke claim is unmeasured. Line 45 cites tests for the 50k/100k/5MB limits; only `split_lossless_line_tokens_bounded` unit test exists.
- Phase file **W6 silently narrowed**: checked `[x]` after deleting "Implement Monaco view zones and scroll alignment for unequal hunks" and "remove legacy marker-parser fallbacks". No view-zone code in `packages/ui/src` (grep); marker parsing still referenced in `MergeConflictEditor.tsx`. Either implement or leave unchecked/explicit user-approved deferral.
- **W5/W2 checks overclaimed**: browser test builds a synthetic `<header z-50>` and a single panel; asserts `elementFromPoint(20,20)` hits it (passes irrespective of panel). Not "full application page layout", not files+tool+resolver multi-panel. `page.viewport(1400,900)` not reset (leak risk to later tests).
- `Continue` non-zero path: post-status inspection error now preempts `editor_invoked`, so a valid editor handoff degrades to `OutcomeUnknown`. Prefer: check `editor_invoked` first (needs no status), then refresh.
- `stage_index_entry` uses `fs::metadata` (follows symlinks); git uses lstat → symlink entries get target stat (harmless re-hash, but incorrect). Use `symlink_metadata`. No Rust test asserts stat coherence (only covered by smoke abort `worktreeCleaned`). Add a test: resolve then `git status`/`merge --abort` clean.
- `test_rolling_sentinel_scanner_no_false_positives` has scratch comments and an unasserted/self-contradicting block (`MY_TOKE`+`N_NOT_MATCH` actually matches). Rewrite; add 1-byte-chunk case. `test_hook_failure_not_misclassified_by_precommit_path` name/comment mismatch (says rebase, runs merge; never tests a commit subject containing "pre-commit").
- Abort success path re-reads `repo.index()` from the pre-opened repo (possibly cached) — pre-existing; verify `read(true)` or reopen. Smoke abort passes, so low risk.
- Windows `Drop` runs blocking `taskkill` `.output()` on async runtime thread; minor.
- `plan.md` Phase 09 "Complete*" at 95% while AC12 todo open; acceptable only if footnote states release blocked.

## Suggestions
- Smoke script: readiness loop spins without sleep when response non-ok; hardcoded port 14820 / `server/target/debug` binary; add timeout/pgid kill and sanitize checks or drop claims.
- Fingerprint HEAD dedupe, fail-closed metadata, UTF-8 lossy `sequencer/todo` read, `Unsupported` variant (types.rs/client.ts/docs), `ProgressSender` re-export (present at mod.rs:46): all verified OK.
- `tokio::spawn` wrapper in `execute_operation` correct; JoinError mapped to Internal.
- Redundant `git_dir.exists` branches in `rebase-apply` (applying/else both Unsupported): collapse.

## Verified OK
- Items 2,3,4,5(code),6,7(integration) present as described; stderr-only scan; non-allocating per chunk; `process_group(0)` on Unix; evidence report AC12 PENDING correct; resource constants (50,000 / 100,000 / 5 MB / 15 MB / 5 MB) match `conflict.rs:11-15`; backend test count 11+10+5+14+2=42 matches.

## Validation executed
- `cd server && cargo test --test git_conflict_operation_lifecycle` → 14 passed, 0 failed.
- `cargo test --lib -- git::operation git::conflict` → 9 passed (3 scanner tests).
- Python simulation of scanner algorithm → missed split tokens (confirmed).
- NOT run: node smoke script (needs server binary; `target/` access blocked), Chromium browser tests, tsc, UI unit tests, clippy. Counts "342 tests", "54/54", "tsc 0 errors" are unverified by me.

## Unresolved questions
1. Is the roadmap "Complete" status intentional given AC12 blocking? (recommend not.)
2. Was W6 view-zone/marker-parser removal approved as deferral?
3. Should timeout/pgid kill get an integration test (e.g. fake `git` via PATH sleeping child) before claiming it verified?
