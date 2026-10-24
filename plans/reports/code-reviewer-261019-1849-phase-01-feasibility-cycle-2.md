# Code Review — Phase 01 Feasibility & Contract Gates (Cycle 2)

Score: **5.5/10** (mechanism spikes OK + prior code bugs fixed; evidence report overclaims, history proof not native, contract incomplete)

## Prior findings status
| Prior finding | Status |
| --- | --- |
| lastValue stale bug | FIXED (`joint-history-authority.ts` resyncs in `finally` + in content handler when `isApplying`); browser test covers post-undo branch edit |
| active_git_operation integration | FIXED: test calls production `dam_hopper_server::git::active_git_operation` (made `pub`, re-exported). Re-export redundant (`pub mod cli_fallback` already exported) |
| Revert support | PARTIAL: Rust enum + REVERT_HEAD detection + test OK. TS `client.ts:2275` union `"merge"\|"rebase"\|"cherry-pick"` NOT updated -> wire drift |
| Test hermeticity | MOSTLY: TempDir, GIT_CONFIG_NOSYSTEM/GLOBAL, gpgsign off, autocrlf off, `-b main`. Missing GIT_EDITOR/GIT_TERMINAL_PROMPT, GIT_DIR/INDEX_FILE scrub; `/dev/null` not Windows-portable |
| Contract completeness | PARTIAL, see W-contract |
| Honest gate statuses | PARTIAL, see C1/C2 |

## Critical
1. **feasibility-evidence.md claims unproven facts in present tense.**
   - Sec 5D benchmark numbers not emitted by any test (`metrics` array only asserts `<100ms`); re-run here: diff3 100/1k/5k/20k lines = 0.68/2.6/40/420 ms vs report 0.8/9.5/48.2/n.a. Not reproducible.
   - "Planning Target 20,000 lines / 2 MB sync budget" is an invented threshold (phase forbids fabricated line threshold); own measurement shows ~420 ms main-thread diff3 at 20k and superlinear growth -> target contradicts data. No heap/responsiveness/multi-draft metrics (step 10 not done).
   - Matrix says web "Available", Tauri "Host runtime available", captures "Available", reviewer "Assigned" w/o any command/version/host evidence. Owners are role titles ("Primary Reviewer"), not named. Phase requires named owners + recorded unavailable prereqs.
   - "Legacy payload FAILS CLOSED HTTP 400 LEGACY_PAYLOAD_REJECTED" stated as fact; no code/test. Phase requires negative proof.
   - "Frozen" contracts with no cross-layer artifact check (no Rust/TS type compile, no sample payload).
   - No explicit per-step pass/fail/Pending table and no failed/pending-gate record (steps 5,6-Monaco,8,9,10,11 absent/partial). Header "Executed Foundational Primitives" ok but sections read as gate passes.
2. **Joint-history "proof" does not prove the gate (AC4, step 2/3).** Browser test only drives `model.applyEdits` + direct `history.undo()/redo()`. Not exercised: real typing/IME/paste/cut/multicursor, Ctrl/Cmd+Z/redo keybinding, toolbar, native context menu, hidden/reopened model. Nothing intercepts Monaco native undo, so native Ctrl+Z bypasses authority (split histories = exact failure mode phase forbids). Implementation replays via `model.setValue` full-text snapshots: loses cursor/selection/view state, [INFERENCE] resets Monaco's native undo stack/alt-version, O(doc) per undo/redo, 2x full string retained per keystroke (no coalescing; 2 MB doc x N edits = unbounded heap). Phase 06/07 must not be unlocked on this evidence.
3. **AC3/AC6 Monaco-layer byte fidelity untested.** Unit test only round-trips `tokenizeLosslessLines().join("")` (string identity, trivially true). No test loads mixed CRLF/lone-CR/BOM into a Monaco model and reads back (Monaco normalizes EOL on `setValue`/`getValue`). Rust BOM test only proves `git add` stores bytes with autocrlf=false (no attributes/filters/eol/working-tree-encoding). Evidence "Lossless Text & BOM ... proves" overstates.

## Warnings
- **W-contract** wire contract gaps: no draft/history ownership key; no resource limits (payload/line/region/draft budgets); no process/locking acquisition order or timeout/cleanup policy; no rollout/caller-migration plan (inventory only, no mapping of each caller); `terminalHandoffRequired` lacks profile/connection generation/server binding/terminal session+incarnation required by phase; `reviewedText.tokens:string[]` + `eol:'preserve'` cannot represent BOM/invalid-encoding/non-UTF8 bytes or declare retained metadata; `ConflictSnapshot` ships `textTokens` for 3 stages + worktree with no size cap; `ResolveOutcome.applied` lacks index/mode fingerprint; no checkout-conversion (attributes) rejection outcome beyond generic `unsupported`.
- Backend tests validate libgit2/git behavior, not production resolve code (none exists yet): binary-staging test builds `IndexEntry` by hand, `file_size as u32` truncates, asserts on the same in-memory `Index` object (no reopen / `git ls-files -s -u` independent check); delete test same; stage-failure test asserts libgit2 error under hand-made `index.lock`, not "post-publication failure vs preexisting lock" distinction. No exec-bit (100755), symlink/gitlink, SHA-256 object format, linked worktree, nested root, ancestor-replacement, filter/attribute cases (steps 7-8).
- Operation detection (step 9): `rebase-apply` always mapped to Rebase (git am misclassified); no sequencer-only states (`.git/sequencer`, multi-pick between stops); no continue/abort command execution, hook/editor/signing/stdin/hung-descendant, post-attempt refresh, full-index precondition tests. Still legitimately Pending — evidence must say so per row.
- Behavior change: `REVERT_HEAD` now yields `Some(Revert)` for every `active_git_operation` consumer (commit_file_ops, repository, commit_message_rewrite) — blocks/recovery payload now emitted for reverts; add/adjust regression in `git/tests.rs` + update TS type + UI copy.
- Duplicate helpers (`git`, `git_try`, `init_repo`) across 2 new integration files; check `server/tests/common` / `git/tests.rs` first (DRY). Plan said extract regressions into `git/tests.rs`/`api/tests.rs` and delete scaffolds; new files remain with no extraction plan.
- Wall-clock `<100ms` assertion in unit test is flaky on loaded CI and arbitrary; weak assertions elsewhere (`regions.length > 0`, `totalTokensReassembled > 0` for repeated/adjacent-insertion case — no oracle on output tokens; no add/add-empty-base overlap/identical-insertion/adjacent-deletion cases listed in step 4).
- Browser test installs global `unhandledrejection` suppressor for "Canceled" — hides real failures across suite; scope/remove.
- node-diff3 3.2.1: MIT, zero deps confirmed from registry (lockfile `engines: bun >=1.3.10` is just metadata; exports map has `import`/`browser` entries). Version pinned exact, OK. No transitive/notice record beyond the report line.

## Suggestions
- Re-state evidence per step: PASS (mechanism, repro cmd) / PARTIAL / PENDING; delete benchmark and 20k budget until measured with real script printing results + heap.
- Prove history via real keyboard events (Playwright keyboard through Monaco), `editor.trigger('keyboard','undo')`, context menu; or intercept via `editor.addAction`/override `undo` command; test IME composition, paste, multicursor; use `pushUndoStop`/edit-operation grouping or Monaco `IUndoRedoService`-free alternative with delta (not snapshot) transactions + coalescing.
- Add Monaco round-trip test for `\r\n`, mixed, lone `\r`, BOM, no final EOL via `getValue(EndOfLinePreference.TextDefined)` / `getLinesContent` + metadata retention.
- Drop `pub use cli_fallback::active_git_operation` (module already `pub`) or keep re-export only; fix ordering for rustfmt (placed before `blame`; repo rustfmt already dirty elsewhere, not introduced here).
- Update `client.ts` recovery union to include `"revert"` in same change.
- Share git test helpers in `server/tests/common`; add `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0`, remove `GIT_DIR`/`GIT_INDEX_FILE`.
- Reopen index via fresh `Repository::open` + `git ls-files -s`/`-u` and compare `git cat-file` bytes for OID/mode oracle.

## Reviewed files
evidence report; `joint-history-authority.ts`; `conflict-merge-model.ts` (+test); `conflict-monaco-history.browser.tsx`; `types.rs`; `cli_fallback.rs`; `git/mod.rs`; `git_conflict_exact_staging.rs`; `git_conflict_operation_metadata.rs`; `packages/ui/package.json`; `pnpm-lock.yaml` (node-diff3 3.2.1 entries consistent, integrity matches registry).

## Validation run (this review)
- `cargo test --manifest-path server/Cargo.toml --test git_conflict_exact_staging --test git_conflict_operation_metadata` -> 3/3 + 2/2 PASS
- `pnpm --filter @dam-hopper/ui exec vitest run src/lib/conflict-merge-model.test.ts` -> 7/7 PASS
- Temp benchmark (deleted after): diff3 ms 100:0.68, 1k:2.60, 5k:40.2, 20k:420.5 (mismatch with report)
- Not re-run (tester cycle 2 reports pass): browser test, UI build. `rustfmt --check` flags pre-existing unrelated files (blame*.rs); not attributable.
- Phase file left at Pending/0% (accurate; gates not met). Not edited.

## Unresolved questions
- Is Revert continue/abort in scope of Phase 01 `can_continue` semantics (REVERT_HEAD with sequencer multi-revert)? 
- Does Monaco `model.setValue` reset native undo stack in 0.55.1 — verify in browser test rather than infer.
- Who is the named Linux-host owner and human reviewer? Role titles insufficient for matrix.
- Is `rebase-apply`/git-am distinction required in initial scope?
