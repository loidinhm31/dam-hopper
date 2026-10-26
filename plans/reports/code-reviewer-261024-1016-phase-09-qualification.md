# Code Review — Phase 09 Security, Real-Process Tests & Performance Qualification

Date: 2026-10-24 · Reviewer: Phase09CodeReviewer · Mode: read-only (no tests/builds run)
Plan: `plans/260901-1000-lsp-server-integration/phase-09-security-real-process-tests-and-performance-qualification.md`

## Code Review Summary

### Scope
- Files reviewed (focused ranges/diffs):
  - `server/src/semantic/resources.rs` (full), `reaper.rs` (diff + helpers), `child.rs` (diff + reader/stderr tasks), `session.rs:100-525, 1700-1868`, `pressure.rs` (full), `outbound.rs` (full), `supervisor.rs:1-300 (API map), 700-833, 1060-1118`, `launch.rs` (diff), `tool_profile.rs` (diff), `uri.rs` (containment fns spot-check)
  - `server/src/api/semantic_settings.rs` (diff), `semantic_ws.rs:162-773`, `auth.rs` (diff + 360-408), `router.rs` (diff + layer map)
  - `server/tests/semantic_resource_qualification.rs` CPU/RSS sampler (1093-1360, 2660-2724); test-case counts for all semantic suites
  - `phase-09-observations.md`, `phase-09-…-qualification.md`, `phase-09-qualification-report.md` (grep), `phase-09-qualification-budget-v1.json` (grep), `plan.md` ledger (grep)
- LOC analyzed: ~3,000 (of ~8.9k changed server lines)
- Review focus: Phase 09 changes (uncommitted worktree vs `20887bf5`)
- Updated plans: none. Contract was read-only, so I did not edit the plan or ledger. Main needs to reconcile them (see M4).

### Overall Assessment
The engineering is solid and the evidence is unusually honest: failed aggregates are kept, the threshold has one negotiated source, hard cgroup mode is explicitly recorded as unqualified, and settings errors are sanitized. The main security properties hold in the code I read:
- Bundled-only engine with full transitive digest and no-symlink/no-writable payload checks.
- Admin-only PATCH with re-authorization after acquiring locks, and a detached transaction.
- A 2s admission deadline on the settings routes.
- Cancellation-first live auth watcher. The writer races `cancel_rx` and the session token against the pending send, so a non-reading consumer cannot delay the cutoff.
- Component-wise symlink containment for virtual URIs.
- Atomic diagnostics snapshots (`SessionPressureCounters::snapshot`), with no actor round-trip in `get_aggregate_status`.

Three issues stop approval: the CI formatting gate fails, killing recorded descendants by bare PID is unsafe if the PID is reused, and the semantic WS handshake auth lookup has no deadline. No critical (exploitable auth bypass or data-loss) issue was found.

### Critical Issues
None.

### High Priority Findings

**W1 — Semantic WS handshake auth lookup has no 2s deadline; backend reason is echoed** (`server/src/api/semantic_ws.rs:251`, `:299-303`)
- `state.auth_service.evaluate_claims(&claims).await` is not wrapped in `AUTH_STORE_LOOKUP_TIMEOUT`. `AuthService::evaluate_claims` (`server/src/auth/mod.rs:141`) has no internal timeout.
- A stalled store, such as the WAL reader-lock fixture this phase built, hangs the upgrade request indefinitely. The settings routes (`semantic_settings.rs:143-164`) and the live watcher (`semantic_ws.rs:556`) are bounded; admission is not. This conflicts with the Phase 09 requirement "auth backend error/timeout denied" (plan :32-33, :70). The auth matrices only cover the post-admission watcher.
- `AuthDecision::Unavailable { reason }` is formatted into the 503 body. Phase 09 sanitized the same variant in `evaluate_current_admin` (`auth.rs` diff). The same leak exists in shared `authenticate_request` (`auth.rs:248`), which the new settings middleware calls, and in core `ws.rs:233`. That part predates this phase, but sanitization is now inconsistent.
- Fix: wrap the call in `tokio::time::timeout(AUTH_STORE_LOOKUP_TIMEOUT, …)` and map a timeout to 503 `AUTH_UNAVAILABLE` with a static message. Add a handshake-under-WAL-lock case to `semantic_ws_auth_containment.rs`.

**W2 — Changed Rust files fail the CI rustfmt gate** (AGENTS.md:218; `.github/workflows/pr-quality-gate.yml:176`)
- `rustfmt --edition 2021 --check` on 8 changed files gives 51 diff hunks:
  - `outbound.rs`: 9
  - `pressure.rs`: 5
  - `child.rs`: 5
  - `reaper.rs`: 1
  - `session.rs`: 21
  - `semantic_settings.rs`: 4
  - `semantic_ws.rs`: 6
- `outbound.rs` uses hand-compressed one-line items (`pub enum SendError { Closed, Oversized }`, inline `impl` bodies).
- The PR gate runs exactly this check on changed server files, so it will fail. Fix: `cargo fmt --manifest-path server/Cargo.toml`. I did not run it because this review is read-only.

**W3 — Descendant kill/verify uses bare PIDs and PGIDs that may have been reused** (`child.rs:344-350` ticker accumulation, `:303-310`, `:426-433`; `reaper.rs:207-229`; `session.rs:1803-1849`)
- `recorded_descendants` collects every PID ever seen by the 200 ms resource ticker and never prunes exited ones. At teardown, which can be hours later, each entry gets SIGTERM/SIGKILL by bare PID.
- `session.rs` keeps `unreaped_pgid = Some((pgid, descendants))` and retries `signal_pgid(pgid, SIGKILL)` plus per-PID kills later.
- After a PID or PGID is recycled, this can:
  - (a) SIGKILL an unrelated process with the same UID, e.g. a PTY shell, whose `setsid` makes PGID = PID;
  - (b) make `verify_pids_dead` permanently false, which reports a false `DescendantLeak` and leaves `has_unclean_or_retiring_resources()` true, so `prepare_enable` stays blocked.
- The qualification sampler already identifies processes by `(pid, starttime)` (`semantic_resource_qualification.rs:1111-1133, 1159`). Production does not.
- Fix:
  - Record `(pid, starttime)` from `/proc/<pid>/stat` field 22.
  - Before signalling or verifying, re-read starttime and skip entries that no longer match.
  - Prune the ticker list to the live `sample.pids`.
  - For the stale-PGID retry, signal the group only if a recorded member with a matching starttime still exists. Consider `pidfd_open` / `pidfd_send_signal` where available.

### Medium Priority Improvements

**M1 — Attach path still sends inspection requests to busy actors; some enqueues ignore revocation**
- `supervisor.rs:726`: `existing.get_state().await` → `session.rs:488-503` does `reserve().await` and then `rx.await`, neither raced with revocation. A session actor inside `do_initialize` (up to `STARTUP_TIMEOUT` = 30s, `session.rs:977`) or with a full queue blocks re-attach for that key.
- `cancel_request` (`session.rs:438-447`) also uses an unraced `reserve().await` on the gateway's sequential reader path.
- Fix: publish `SemanticState` into an `AtomicU8` (as already done for pgid and overlay stats), or use the existing revocation-raced helper pattern (`session.rs:279-283`, `:305-308`).

**M2 — Dead actor inspection command** (`session.rs:142-144`, `:747-750`, `:859-865`)
- `SessionCommand::GetOverlayStats` is never sent: `get_overlay_stats()` (`:505-507`) returns cached atomics.
- Remove the variant and both match arms. Make `get_overlay_stats` synchronous, or drop it in favour of `cached_overlay_stats()` (the supervisor already uses both).

**M3 — DRY violations**
- The force-kill sequence (`signal_pgid(SIGKILL)` plus a per-PID `kill` loop, each with its own local `use nix::…`) is repeated five times: `child.rs:303-310`, `child.rs:426-433`, `session.rs:1813-1821`, `session.rs:1841-1849`, `reaper.rs:223-229`. Extract `reaper::force_kill_tree(pgid, &pids)`, which is also where the W3 starttime guard would go.
- `semantic_settings::authenticate_settings_request` (`:143-164`) duplicates `auth::authenticate_stream_request` (`auth.rs:378-408`) except for the GET guard. Extract `auth::authenticate_request_bounded(state, jar, req)` and use it from both.

**M4 — Plan and evidence status drift** (plan-hygiene contract)
- Phase file `:15` says "Implementation status: Pending (0%)" and `:16` says "no implementation… executed". All 22 TODO checkboxes (`:82-104`) are unchecked, even though observations claim most gates passed.
- `plan.md:50` ledger row still reads `Pending | 0%`.
- `phase-09-observations.md:26` still says "production repair and real backend rerun pending" for aggregate-status hashing. The code is fixed: `build_settings_response` and `get_aggregate_status` use only `cached_status`, and line 15 records the passing rerun.
- Main (or whoever owns the plan) should tick verified items, set status to "Implemented — awaiting Step 4 user review", and correct line 26.

**M5 — Hard cgroup path unwired in production; constant conflation**
- `resources/linux.rs` `LinuxResourceController` and `launch.rs:44,103-106,165` (`cgroup_procs_path` with `pre_exec`) are only reachable from tests. The qualification report (`:153`) confirms that production does not wire them.
- The portable RSS cap reuses `LINUX_CGROUP_MEMORY_MAX_BYTES` (`launch.rs:85`).
- Fix: add `MAX_SAMPLED_TREE_RSS_BYTES` in `resources.rs`. Either wire the controller behind capability detection in a later phase, or mark it test-only or deferred in the module docs so it does not look like an enforced control.

### Low Priority Suggestions
- **L1** `child.rs:343-366`: the owner actor runs synchronous procfs `read_dir`/`read_to_string` across all tasks of every tree process every 200 ms on a Tokio worker. This is cheap at ≤8 processes, but the phase already hit runtime starvation from synchronous work. Consider `spawn_blocking`, or document the bound. `interval` defaults to `MissedTickBehavior::Burst`, so after a stalled stdin write (`STDIN_WRITE_TIMEOUT`) samples will burst; `Delay` is preferable.
- **L2** `semantic_ws.rs:405-409`, `:453`: if the session-token `RwLock` is poisoned, the writer treats the token as not revoked (fail-open for this one check; the epoch and supervisor checks still apply). The watcher at `:613` likewise skips `revoke()`. Use `unwrap_or_else(|e| e.into_inner())`, as the supervisor does.
- **L3** `semantic_resource_qualification.rs:2662-2709`: `totalCpuDeltaMs` is a sum of lifetime ticks per `(pid, starttime)`, not a delta. Rename it to `cumulativeLifetimeCpuMs`; the `cpuAccounting` text already says this. The interval series baselining is correct: it skips first observations and gaps, and is a documented lower bound.
- **L4** `tool_profile.rs:300-304`: `is_packaged_tuple_verified()` hashes the full tuple synchronously and is only used by tests. Mark it `#[doc(hidden)]` or move it to test support so it cannot creep into a hot async path again.
- **L5** `semantic_ws.rs:411-415`: the per-frame `get_connection_epoch().await` happens outside the cancellation `select!`. It is only bounded by `RwLock` hold times, so this is minor.
- **L6** `child.rs:293-312`: after the direct child exits, `merge_descendants(pgid)` can no longer walk `/proc/<pgid>`. Escapers spawned within the last 200 ms (setsid outside the PGID) may be missed. This is best-effort and acceptable, but the limit should be documented in `reaper.rs`.

### Positive Observations
- `outbound.rs`: the byte reservation covers queued frames plus the in-progress send, and the extra reservation on rewrite is accounted. `closed()`-biased `select!` wakes byte waiters on close.
- `child.rs`:
  - `wait_terminated` uses a `watch` channel, so terminal status does not depend on bounded event-queue capacity.
  - `drop(cmd_rx)` happens before the terminal acknowledgement, and `OutboundSlotPermit` releases the byte budget on drop.
- `reaper.rs`:
  - `get_proc_children` enumerates every `/proc/<pid>/task/<tid>/children`, which covers non-leader spawners.
  - `verify_tree_reaped` unifies the PGID check and the recorded-PID check.
  - The zombie filter in `read_proc_rss_bytes` is correct.
- `pressure.rs`: diagnostics are cheap atomic snapshots with RAII slot permits, so `get_aggregate_status` and `handle_idle_session` no longer touch actors.
- `semantic_settings.rs`:
  - The detached transaction survives a client drop.
  - Admin is re-checked after acquiring locks, including on the no-op path.
  - Internal paths and errors are mapped to stable codes.
  - Capability is reported honestly as "portable-only".
- `semantic_ws.rs`:
  - Close ownership is published before revocation.
  - The writer never flushes a retained data frame after cancellation.
  - Revoked non-null results are rewritten to `AUTH_REVOKED`.
  - Cutoff timings are recorded separately from close delivery.
- The threshold has a single source: `ADAPTIVE_SYNC_THRESHOLD_BYTES`, negotiated by the gateway (`gateway.rs:591`, `:871`). The client consumes it, has no drifting constant, and rejects aliases.
- `uri.rs`: component-by-component `symlink_metadata`, root re-canonicalization, and a dangling-path ancestor check.
- Evidence discipline: failed aggregates are kept (auth attempt-01, resource disposition-01), budgets were frozen before the final run, and hard mode is explicitly unqualified.

### Recommended Actions
1. Run `cargo fmt --manifest-path server/Cargo.toml` (W2).
2. Bound the semantic WS handshake `evaluate_claims` with `AUTH_STORE_LOOKUP_TIMEOUT` and sanitize the `Unavailable` reason in `semantic_ws.rs`, `auth.rs:248` and `ws.rs:233`. Add a WAL-lock handshake regression (W1).
3. Introduce `(pid, starttime)` identity in the reaper. Prune `recorded_descendants` to live PIDs in the ticker. Route all force-kill sites through one `reaper::force_kill_tree` (W3 + M3).
4. Replace the actor `get_state` round-trip with a cached atomic state. Race `cancel_request`'s reserve against revocation (M1).
5. Delete `SessionCommand::GetOverlayStats` and its arms (M2).
6. Reconcile the plan file, ledger and observations line 26 (M4).
7. Add a separate portable RSS constant. Document or relocate the unwired cgroup controller (M5).

### Metrics
- Type coverage: N/A (Rust); no `unsafe` added beyond the existing `sysconf`.
- Test inventory (`#[test]` counts, which match the claims in observations): child_process 18, supervisor 32, settings 22 (1 subprocess-only ignored → 21 counted), websocket 11, tsls_e2e 4, resource_qualification 5 (1 ignored runner → 4), ws_auth_containment 4 (1 helper ignored; 20 matrix cases). UI claims 120/120 and browser 9/9 were not re-checked.
- Test execution: **not run by this reviewer** (read-only contract). Pass counts above are the implementer's claims from `phase-09-observations.md`.
- Lint: rustfmt **51 hunks / 8 files (FAIL)**; clippy not run.

### Validation Commands / Results
| Command | Result |
|---|---|
| `git status --short`, `git diff --stat -- server/` | 28 modified server files, +8,919/−910; new `outbound.rs`, `pressure.rs`, 3 new test suites |
| `rustfmt --edition 2021 --check <8 changed files>` (read-only) | FAIL — 51 diff hunks |
| `grep -c '#[(tokio::)?test'` per semantic suite | Counts match the observation claims |
| cargo test / clippy / pnpm test | Not run (contract: read-only) |

### Unresolved Questions
1. Is the semantic handshake's missing auth deadline accepted as parity with core `/ws`, or is it in Phase 09 scope? The plan wording (:32-33) suggests in scope.
2. Should the PID-reuse hardening (W3) block Step 4 approval, or be accepted as a Phase 10 carry-over? Its probability depends on host `pid_max`.
3. Out of reviewed scope: `gateway.rs` (+1.4k lines), the `supervisor.rs` toggle and retirement internals, and the UI/browser changes. Does anyone else own those reviews?
4. Should the reviewer or main tick the plan TODOs? This review was read-only, so the plan file is unchanged.
