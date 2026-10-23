# Code Review Cycle 2 — Phase 06 Admin-only global hot toggle

Plan: `plans/260901-1000-lsp-server-integration/phase-06-global-hot-toggle-and-unsafe-override-gate.md`
Reviewer: ReviewerCycle2 | Date: 2026-10-23 | Branch: feat/lsp-server-integration-reassess
Prior: `plans/reports/code-reviewer-261023-1825-phase-06-toggle.md` (5.5/10)

## Score: 7.5 / 10

Cycle-1 criticals mostly fixed: raw-write bypass closed on all wired sinks, `prepare_disable` now bounded + keeps failed handles + returns error, startup applies persisted intent, tests isolated, GET guard dropped before await. Remaining: cancellation safety NOT actually implemented (handler not detached), `prepare_disable` truthfulness has 2 holes (leak status ignored; re-enable not blocked), no regression tests for the new failure paths. No data-loss/security-bypass critical left; 3 High warnings should be fixed or explicitly waived before marking Phase 06 complete.

## Verification of 5 target items

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Raw mutation paths guarded | PASS (wired sinks) | async `secure_path::persist_temp` `secure_path.rs:1517-1522` (ws `fs:write_commit` caller `ws.rs:1185`); `persist_temp_sync` `:1584`; `write_bytes` `:1601`; `ops::atomic_write_with_check` `ops.rs:231`; `ops::atomic_persist_with_check` `ops.rs:309`; `mutate::assert_safe_mutation` `mutate.rs:25` (create/rename src+dst/delete/move). Guard = canonical-path + parent/filename + inode/dev hardlink check. Gap: `fs/decrypt.rs:91 decrypt_and_write` (`pub use` in `fs/mod.rs:20`, `tmp.persist(&output_abs)` unguarded, no non-test caller) — same class as `atomic_*` that was guarded. No tests for async `persist_temp`/`atomic_*`/WS path/hardlink alias. |
| 2 | Bounded, truthful `prepare_disable` | PARTIAL | `supervisor.rs:152-208`: per-session `timeout(TOTAL_TEARDOWN_BUDGET, handle.shutdown())`; failed handles re-inserted; `Err(Shutdown)` returned; handler `semantic_settings.rs:197-205` calls `record_disable_failure` and returns 500, durable config NOT written. Holes: see W1, W2, W3. |
| 3 | Startup sync | PASS | `main.rs:891-924`: reads `global_config.semantic.enabled`; on true → passive `prepare_enable` → `commit_enable` (0 child), on failure → `record_disable_failure` (safe-disabled, durable intent kept). Logged. Zero-child preserved. |
| 4 | Test isolation | PASS (with nit) | `semantic_settings.rs:43` `TEST_ENV_LOCK` (tokio Mutex) held by all 7 tests; `create_test_app` sets `XDG_CONFIG_HOME` to per-test tempdir (`:104`). Nit: `test_raw_fs_mutation_refuses_global_config_tampering` (`:362`) does not create an app → uses whatever `XDG_CONFIG_HOME` the previous test left (dangling deleted tempdir) or real env if first. Read-only (guard rejects), so no pollution, but not hermetic. |
| 5 | `get_settings` guard drop | PASS | `semantic_settings.rs:139-142` read guard scoped in block, copied bool; `build_settings_response` awaits afterwards. `patch_settings` only holds `global_config.read()` transiently for `.clone()` (`:182`). |

## Critical issues

None blocking-by-bypass. (W1 is the closest; see below.)

## Warnings (High)

W1. **Cancellation safety not implemented.** `patch_settings` (`semantic_settings.rs:159-266`) is run inline by axum; no `tokio::spawn`/drop-guard anywhere in file (grep: 0 hits). Client disconnect drops the future mid-transition:
- after `prepare_disable` drained sessions but before persist/`record_disable_failure`: runtime `enabled=false`, `safe_disabled=false`, no `transition_error`, durable intent still `true`. Fail-closed (actors terminate once `cmd_tx` dropped, `session.rs:340-343` → `cleanup()`), but failure is silent + sessions removed from map without confirmed reap.
- after `write_global_config_at` but before `*global_config.write().await = gc` / `commit_*` (`:230-239`, `:259-261`): disk and memory/runtime diverge.
Fix: run transition body in `tokio::spawn` and await the `JoinHandle` (detached completion), or add a drop guard that calls `record_disable_failure` if not completed. Locks are owned `MutexGuard`s → move them into the spawned task.

W2. **`prepare_disable` ignores child terminal status → can claim success with leaked tree.** `SemanticSessionActor::cleanup` (`session.rs:930-945`) discards `ChildEvent::Terminated(status)` (incl. `Crashed("Descendant leak in PGID …")`, `child.rs:260,353-367`) and `SessionCommand::Shutdown` always replies `Ok(())` (`session.rs:413-415`); handle also maps dropped reply to `Ok(())` (`session.rs:228`). Net: supervisor only detects timeout, not leak/crash → durable `false` persisted while descendants may remain. Fix: capture terminal status in `cleanup()`, return `Err(SessionError::…)` for `Crashed`/leak; treat `Shutdown` reply drop as error unless actor state is known-terminal.

W3. **Re-enable not blocked while failed-teardown handles retained.** `prepare_enable` (`supervisor.rs:226-236`) checks integrity only; `commit_enable` clears `safe_disabled`. After failed OFF the retained handles are re-inserted (`:197-205`), then ON → `commit_enable` → `get_or_create_session` fast path may return a stuck/ShuttingDown handle (`:331-335`; `get_state().await` has no timeout). Plan table: "block reenable; never claim zero trees". Fix: `prepare_enable` returns error if `sessions` non-empty and any session unclean (or require successful retry teardown first); same check at startup is trivially satisfied.

W4. **Teardown "total" budget is per-session and sequential** (`supervisor.rs:171-195`). N stuck sessions → N×5s holding `global_config_mutation_lock` + `transition_lock`. With `MAX_GLOBAL_SEMANTIC_TREES=2` worst ≈10s (still bounded, but not "TOTAL"). Also supervisor timeout (5s) < actor cleanup worst case (5s child + 0.5 + 0.5 post-verify/send + 0.5 wait = ~5.5-6s, `child.rs:294-375`, `session.rs:934`) → can spurious-fail a healthy-but-slow reap (fail-safe but noisy). Fix: drain→`join_all` shutdowns under one `timeout(TOTAL_TEARDOWN_BUDGET + margin)`; margin ≥ actor cleanup bound.

W5. **Missing regression tests for the fixed paths** (cycle-1 #8 partly open). No test for: failed/timed-out teardown keeps handles + returns error + no durable write; async `persist_temp` / `atomic_write_with_check` / `atomic_persist_with_check` refusal; hardlink/symlink alias; startup init (`main.rs` block untested); demotion between request and commit; `record_disable_failure` is invoked manually (`semantic_settings.rs:411`) not via real failure branch. `grep prepare_disable` shows zero tests.

W6. **(Carry-over cycle-1 #6) `transition_error` leaks raw strings to any authenticated caller.** `build_settings_response` sanitizes `integrity_status` (`:89-106`) but `transition_error` (`:114`) is raw. Sources now include `main.rs:911` `Startup toolchain verification failed: {e}` where `e = ToolProfile(format!("{:?}", integrity))` (paths/digests, `supervisor.rs:230`), `semantic_settings.rs:233` `{write_err}` (paths). Startup path makes it reachable on every boot with bad toolchain. Fix: store stable codes; log detail server-side.

## Suggestions (Medium/Low)

- S1. Guard `decrypt_and_write` (or delete — no callers) and, better, move guard into one lowest sink so new callers can't bypass (carry-over cycle-1 #1 suggestion).
- S2. Guard runs sync canonicalize/stat inside `async persist_temp` on runtime thread (`secure_path.rs:1518`); move inside `spawn_blocking` closure.
- S3. `test_raw_fs_mutation_refuses_global_config_tampering`: create temp `XDG_CONFIG_HOME` under lock and add async `persist_temp`, `atomic_*` + hardlink cases.
- S4. `std::env::set_var` in multi-thread tokio tests is process-global; OK under lock in own test binary, restore/remove var at end for hygiene.
- S5. `patch_settings` does sync `read/write_global_config_at` under async locks (blocking FS on runtime thread) — pre-existing pattern; consider `spawn_blocking`.
- S6. DRY: `SemanticSettingsResponse` built 3× in PATCH + GET (cycle-1 #10) still open; `mutate_global_config` writes unconditionally (cycle-1 #11).
- S7. UI items from cycle-1 #17 (`onSettled`, retry control) not in scope of this fix round; unverified.
- S8. Cycle-1 #9 (unparseable global config → default → overwrite) unchanged; startup at `main.rs:670` now also drives semantic intent from that fallback (typo ⇒ OFF, safe).

## Positive

- Guard placement covers all active write sinks incl. WS chunked commit; clear refusal message.
- `prepare_disable` drops `sessions` write lock before awaiting shutdowns; failed handles re-inserted, not lost; failure path persists nothing and records safe-disabled.
- Startup init is passive, zero-child, falls back to safe-disabled on integrity failure.
- GET no longer holds config lock across supervisor awaits; lock order config→transition retained.
- Test file serialized with env lock + per-test XDG tempdir; 7/7 pass.

## Reviewed files

server: `src/semantic/supervisor.rs`, `src/semantic/session.rs` (shutdown/cleanup), `src/semantic/child.rs` (teardown), `src/semantic/resources.rs` (const), `src/api/semantic_settings.rs`, `src/main.rs` (:660-925), `src/state.rs` (mutate_global_config), `src/fs/secure_path.rs` (guards), `src/fs/ops.rs`, `src/fs/mutate.rs`, `src/fs/decrypt.rs`, `src/fs/upload.rs` (caller), `src/api/ws.rs` (callers :1185,:1953,:2954), `src/api/router.rs` (route), `tests/semantic_settings.rs`.
UI/docs not re-reviewed this cycle.

## Validation (run by reviewer)

| Command (cwd `server/`) | Result |
|---|---|
| `cargo check --all-targets` | PASS (no errors) |
| `cargo test --test semantic_settings` | 7/7 PASS |
| `cargo test --lib semantic` | 43/43 PASS |
| `cargo test --lib config::tests` | 108/108 PASS |
| `cargo test --test semantic_resources` | 8/8 PASS |
Not run: clippy, UI tests/tsc, Windows build, full workspace test, real child-process teardown-failure scenario.

## Recommended actions (priority)

1. Detach transition from request future (spawn + await JoinHandle) or add drop guard recording `safe_disabled` (W1).
2. Make `cleanup`/`shutdown` surface child terminal failure/leak; supervisor propagates (W2).
3. `prepare_enable` must refuse while retained/unclean sessions exist (W3).
4. Concurrent teardown under single deadline ≥ actor cleanup bound (W4).
5. Add tests: failed teardown retains+errors, guarded sinks (async persist_temp, atomic_*, hardlink), startup init, demotion-before-commit (W5).
6. Sanitize `transition_error` (W6); guard/delete `decrypt_and_write` (S1).

Plan file not edited (Main owns status). Phase 06 should stay "in progress" until W1-W3 + W5 resolved or waived.

## Unresolved questions

- Is detached/spawned transition (W1) required for Phase 06 acceptance, or is fail-closed-on-cancel (runtime OFF, durable ON, no error) accepted?
- Should leaked-descendant (`Crashed` terminal) count as OFF failure (W2)? Plan wording "never claim zero trees" implies yes.
- Is `decrypt_and_write` slated for removal, or must it be guarded?
- `AuthService::new_mock` accepted vs real-store auth tests (carried from cycle 1)?
