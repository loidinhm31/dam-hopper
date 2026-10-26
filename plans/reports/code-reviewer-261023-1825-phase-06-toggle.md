# Code Review — Phase 06 Admin-only global hot toggle

Plan: `plans/260901-1000-lsp-server-integration/phase-06-global-hot-toggle-and-unsafe-override-gate.md`
Reviewer: Reviewer | Date: 2026-10-23 | Branch: feat/lsp-server-integration-reassess

## Score: 5.5 / 10

Auth helper, strict schema, lock order, PATCH/GET shape, UI shape = solid. But OFF cleanup truthfulness (core Phase 06 contract), one raw-write bypass, startup reload, test isolation fail plan success criteria. Not ready to mark Phase 06 complete.

## Scope
- Reviewed: all files in assignment list (server auth/config/state/semantic/fs/api + UI client/queries/transport/section/page + tests). `server/src/config/global.rs` NOT modified (no need: `enabled` single-word, normalization passthrough ok).
- Skipped: Windows branch compile (not runnable on Linux).
- Plan file not edited (Main owns status).

## Critical issues

1. **Raw WS write bypasses protected-file guard.** `server/src/api/ws.rs:1185` (`fs:write_commit`) calls async `secure_path::persist_temp` (`server/src/fs/secure_path.rs:1509`) which calls `unix::persist_temp` directly. Guard was added only to sync `persist_temp_sync` (upload) and `write_bytes`. Same for `fs::ops::atomic_write_with_check` (re-exported `fs/mod.rs:35`; no non-test caller found, still an open sink). Authenticated User with config.toml reachable (alias/hardlink/symlink inside workspace) can overwrite `[semantic]` via chunked WS write → violates success criterion "User cannot mutate intent through protected raw write". Fix: put guard once in the lowest shared sink (`unix::persist_temp`/`write_bytes` impl, or both async+sync wrappers) and add WS-commit test.
2. **OFF swallows teardown failure → false "success".** `supervisor.rs` `prepare_disable`: `let _ = handle.shutdown().await;` and always `Ok(())`; `SemanticSessionHandle::shutdown` also maps dropped reply to `Ok(())` (`session.rs:228`). Sessions are `drain()`ed from map first, so failed handle ownership is lost, retry impossible. Plan table: "OFF cleanup fails → remain admission-disabled, report failure, retain ownership, block reenable; never claim zero trees". Currently failed cleanup → persist false → `commit_disable` → clean state. Fix: collect shutdown errors/timeouts, keep failed handles in map (or reaper set), on failure `record_disable_failure` + return error; `prepare_enable` must refuse while cleanup incomplete.
3. **No bound + not cancellation-safe OFF while holding both locks.** `patch_settings` holds `global_config_mutation_lock` + `transition_lock` across unbounded `shutdown().await` (no timeout). One stalled session actor blocks every global writer (UI settings, defaults, known-workspace add/remove). Also axum drops handler on client disconnect: after `enabled=false` + drain but before persist/`record_disable_failure` → runtime disabled, `safe_disabled=false`, durable intent `true`, no error recorded, handles half-reaped. Fix: run transition in `tokio::spawn` (detached, awaited via JoinHandle) + per-session/total shutdown deadline → failure path.

## Warnings (High)

4. **Persisted intent never applied at startup.** `main.rs:892` logs "disabled by default"; no read of `gc.semantic.enabled` anywhere (grep). After daemon restart configured=true/runtime=disabled → UI mismatch banner until admin re-PATCHes. Plan: "reloads configured intent at startup... passive validation must still pass before admission". Either implement (passive `prepare_enable` + `commit_enable` at boot, zero child) or record explicit deferral in plan (Phase 08?). Phase 08/09 text does not own it.
5. **Tests write to real global config.** `semantic_settings.rs` never sets `XDG_CONFIG_HOME`; PATCH writes `global_config_path()`. Verified: `/var/lib/dam-hopper/.config/dam-hopper/config.toml` (from env) now contains `[semantic] enabled = false` with test-time mtime. Tests also share one file in parallel → order-dependent coupling. Fix: serialized env guard / injectable config path in `AppState` (best: `AppState.global_config_path`, removes `global_config_path()` calls in handlers + the `gc_path == &global_config_path()` hack in `update_global_ui_at_path`). My re-run used temp XDG: 7/7 pass.
6. **GET leaks server paths/digests to every authenticated user.** `integrity_status = format!("{:?}", ToolIntegrityStatus)` includes `PathBuf`, expected/actual digests (`tool_profile.rs:80-91`); `prepare_enable` error returns same Debug string to Admin; `transition_error` includes `write_err` text (can contain path). Plan Security: no raw paths in status. Map to stable enum codes (`valid|missing|invalid-type|permission|digest-mismatch`) and fixed transition messages; log detail server-side.
7. **`GET` holds `global_config.read()` across awaits** (`semantic_settings.rs:82`, through `get_aggregate_status` → session actor round-trips). Writer `mutate_global_config` (`state.rs:569`) waits on same RwLock while holding `global_config_mutation_lock` → stalled session blocks all global writes. Copy `configured_enabled` then drop guard.
8. **Test gaps vs plan task 10 / success criteria.** Missing: demotion between request and commit (OFF post-teardown recheck path, plan says "test this exact case"), auth-store timeout, OFF cleanup failure, persist failure, concurrent toggle + unrelated writer (test named "serialized…" — verify it truly races; only single-flow seen), WS commit path, hardlink/symlink alias. `record_disable_failure` is invoked manually in the safe-disabled test, so the real failure branches are untested.
9. **Strict schema is fail-open for entire global config.** `[semantic]` with unknown key → `read_global_config_at` returns `Ok(None)` (warn + ignore whole file; test comment confirms). Server boots with default config (workspaces/UI lost); next `mutate_global_config` falls back to in-memory default and overwrites the operator file. Safe w.r.t. semantic (stays OFF) but destructive otherwise. Consider rejecting at startup / refusing to overwrite an unparseable file in mutate boundary (pre-existing behavior, newly reachable via semantic typo).

## Suggestions (Medium/Low)

10. DRY: PATCH handler builds `SemanticSettingsResponse` 3× + GET once (~25 lines each). Extract `async fn snapshot(state, configured, can_mutate)`.
11. DRY: `workspace.rs` add_known/remove_known re-implement `add_known_workspace_at`/`remove_known_workspace_at` logic. Extract pure `upsert_known(&mut GlobalConfig,..)`/`remove_known(..)` in `config/global.rs`; delete or deprecate-by-removal the unlocked public `add_known_workspace`, `remove_known_workspace`, `write_global_config` wrappers (footguns bypassing lock; no callers found). Also `remove_known` now creates/writes config even when nothing changes (old: early return when absent); `mutate_global_config` writes unconditionally — return `bool changed`.
12. Widened visibility only for tests: `fs::secure_path` mod, `DirectoryIdentity`, `persist_temp_sync`, `write_bytes` → `pub`. Prefer `pub(crate)` + in-crate tests, or a narrow `pub fn is_protected_global_config_path` re-export.
13. `rename`/`move_path` now also run `assert_safe_mutation(dst)`: also forbids dst in `.git`/project root — behavior change beyond scope (reasonable, but note + test). Directory ancestors of config.toml (delete/rename of containing dir) not guarded.
14. Race in `is_protected_global_config_path`: TOCTOU vs rename/symlink swaps (check → use); acceptable per plan "operator boundary", document. Per-call 2× canonicalize + 2× stat: negligible.
15. Casing/alias: workspace parser rejects exact `semantic` / `server.semantic` only; plan asked aliases/casing (e.g. `Semantic`, `[server.hostResources]`-style nesting). Cheap to add case-insensitive key check.
16. `update_config` precheck only top-level + `server.semantic`; `update_global_defaults` rejects `semantic` but body unknown fields otherwise silently dropped (pre-existing).
17. UI: mutation `onSuccess` only invalidates; on error (incl. new safe-disabled after cleanup/recheck failure) status stays stale → mismatch banner missing exactly when needed. Use `onSettled`. No explicit "Retry/Recover" control: with configured=true & runtime safe-disabled the switch shows ON; recovery needs OFF→ON. UI tests are static-markup only; `handleToggle` (403 copy, success copy, pending lockout) unexercised.
18. `evaluate_current_admin`: unused `CurrentAdminSession` returned value ignored by callers (YAGNI) — fine as audit hook, else return `()`. Initial check outside config lock vs plan step 2 "under lock" — recheck-before-commit makes it safe; order is documented. `Json` extractor rejects malformed body before auth (422 precedes 403) — harmless.
19. `SafeDisabled` + `Disabled` states: PATCH `false` when already safe-disabled and durable false is a no-op that never clears `safe_disabled`; only ON recovers. Acceptable, document in UI copy.

## Positive
- `evaluate_current_admin`: rejects no_auth / NoAuthDev / mismatched actor-claims / non-admin; bounded 2s; stable 401/403/503 mapping; no-auth denial before locks and side effects (tested).
- Strict `SemanticConfig` (`deny_unknown_fields`, default false), `Option` + `skip_serializing_if` preserves legacy files; roundtrip test.
- Documented lock order config→transition; ON path zero-child; healthy enabled→enabled authorized no-op; post-teardown fresh-admin recheck with safe-disabled mismatch.
- All known in-repo global writers (defaults, ui, add/remove known) routed through one mutex and read-current-from-disk.
- UI: owner-bound REST via existing `channelToEndpoint` (no `/ws` multiplexing), admin-only actionable toggle, read-only copy, portable warning, mismatch banner, no command/profile fields.

## Validation (run by reviewer, `XDG_CONFIG_HOME` = temp dir)
- `cargo check` (server): PASS
- `cargo test --test semantic_settings`: 7/7 PASS
- `cargo test --lib config::tests::semantic`: 3/3 PASS
- Tester reports (`tester-261023-1819-phase-06-toggle.md`) cite UI tsc + 16 UI tests + semantic regression suites passing; not re-run by me.
- Not run: clippy, UI tests, Windows build, full workspace test.

## Recommended actions (priority)
1. Guard async `persist_temp` + `atomic_write_with_check` (or move guard into lowest sink); add WS write-commit and hardlink alias tests.
2. Make `prepare_disable` truthful: bounded per-session shutdown, keep failed handles, error → `record_disable_failure`, block re-enable until clean; run transition detached.
3. Apply persisted `semantic.enabled` at startup (passive, zero child) or document deferral.
4. Isolate tests from real global config (injectable path or env guard); remove polluted `[semantic]` from `/var/lib/dam-hopper/.config/dam-hopper/config.toml` if unwanted.
5. Sanitize `integrityStatus`/`transitionError`; drop `global_config` read guard in GET.
6. Add missing failure-path tests (demotion, timeout, cleanup fail, concurrent writers); UI `onSettled` invalidate + interaction test.
7. DRY response builder + known-workspace helpers; narrow visibility.

## Unresolved questions
- Is startup reload of persisted intent intentionally deferred to a later phase? (No phase text claims it.)
- Is chunked WS `fs:write_commit` expected to reach config.toml in supported deployments (workspace root = config dir)? Guard needed regardless for alias/hardlink.
- Should an unparseable global config at mutation time refuse overwrite (fail-closed) rather than overwrite from in-memory default?
- Expected real-store (Mongo/SQLite) auth tests, or is `AuthService::new_mock` accepted for Phase 06 (plan says "real auth/current-role/store")?
