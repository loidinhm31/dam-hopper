# Phase 01 — cycle 4 review

## Score: 7/10 — changes required

Substantial repairs; **three P1 blockers remain, no P0 demonstrated**. Read-only source review; only this report written. Failure schedules below are **[INFERENCE]**, not runtime reproductions. Windows containment intentionally blocked/fail-closed: not a defect. No phase/task-state edits; maintained docs/changelog remain Phase 04-owned.

## Critical issues / merge blockers

### C1 / P1 — Recycled-group ownership race remains in the supervisor/recovery scanner
- **Evidence:** `server/src/browser_host/process.rs:1233-1284,1316-1346,1441-1449,1513-1518`. Locked `procfs 0.17.0` explicitly documents its iterator as lazy, not a snapshot (`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/procfs-0.17.0/src/process/mod.rs:1001-1027`).
- `scan_processes` can record the original leader, then record members of a replacement group after that leader/group exits and its number recycles. `inspect_prior_tree` trusts the old leader's captured start time and admits **every** captured member with that numeric pgrp, without requiring their independent launch marker. Later pidfd/start-time verification proves those replacement members' identities, not their membership in the original launch. Recovery can scan while the old death watcher terminates the tree and the processes are reaped. Removing the watcher's fallback does not remove this separate path.
- **Impact:** unrelated same-user processes can be signalled during prior-tree reconciliation/termination. **Confidence: high.** Require independently verified ownership of each candidate or a pinned, still-live group identity across classification/signalling; otherwise remain ambiguous. Test recycling **during** inventory, after the original leader was captured. Existing different-start-time regression tests an already-reused leader, not this schedule.

### C2 / P1 — StepUp fence still depends on successfully resuming after committed I/O
- **Evidence:** `server/src/api/auth_mfa.rs:939-969`; `server/src/auth/store/sqlite.rs:50-62,407-433,555-563`; `server/src/auth/store/mongo.rs:403-412`; final handoff `server/src/browser_debug/store.rs:939-954,1116-1144`.
- Rotation commits in the blocking SQLite worker / Mongo server **before** the handler publishes its epoch after `.await`. A parked handoff can write in that interval. Dropping the StepUp future while its blocking update continues loses publication altogether; an ambiguous Mongo error after commit also returns through the unfenced error branch. Final PTY authorization does not re-read credential version. Publishing before returning the replacement token fixes the completed-response schedule, not committed-but-unpublished rotation.
- **Impact:** a server-invalidated credential still authorizes final artifact publication. **Confidence: high.** Use a synchronous rotation-in-progress fence before dispatch, with cancellation-independent ownership through committed/ambiguous completion and final epoch publication. Prevent new handoffs from validating through an outstanding rotation; merely moving one epoch increment before the await is insufficient. Test the commit/continuation boundary and cancelled caller, not only release PTY after HTTP 200.

### C3 / P1 — Live containment reuses a dead-browser retirement path even when termination fails
- **Evidence:** `server/src/browser_host/manager.rs:1333-1342,1943-1999`; `server/src/browser_host/session.rs:1045-1074`; termination `server/src/browser_host/process.rs:731-758`.
- `contain_incarnation` now invokes `reap_dead_instance` for a potentially **live** unpoliced browser. On termination error the helper preserves `CleanupPending`/tombstone, correctly, but still decrements the global process count and unconditionally retires all native sessions/raw slots. `retire_incarnation` explicitly assumes every page is gone, marks sessions Closed/Lost and frees target capacity. A procfs/permission/proof failure is not absence; the watcher has already been disabled before these failures, so surviving descendants are possible.
- **Impact:** configured process/target caps undercount surviving native resources; Closing can become Closed without absence. **Confidence: high.** Fence public access immediately, but retain containment/native capacity ownership until verified teardown; distinguish inaccessible/cleanup-pending from proven-gone. Add failed-termination escalation with surviving children, retained counts, sibling isolation and retry/recovery assertions. Current manager regression covers successful teardown only (`server/tests/browser_host_lifecycle.rs:701-849`).

## Warnings

- **W1 / P2 — Cleanup IDs still lack a hard bound.** `selection.rs:338-405,1142-1147`. Empty-navigation overlay work now coalesces, but `queued.pending.extend(pending)` retains historical IDs. While one unlink is slow, repeatedly create → navigate → independently DELETE/expire artifacts: deletion releases artifact quota but removes registrations only from `entry.pending_artifacts`, not the queued vector. Quota therefore does not bound queued IDs as the comment claims. Retire queued IDs with artifact terminal state, or bound/coalesce obligations against the existing store-owned pending set. **Confidence: high; schedule unexecuted.**
- **W2 / P2 — Shutdown drain is not a shutdown barrier.** `selection.rs:370-441,890-906,1483-1545`; `main.rs:1317-1319`; `manager.rs:1348-1379`; `screencast.rs:1257-1275`. Navigation producers remain active after the drain snapshot, a session removed before its drain is absent from that snapshot, and five-second timeout only logs while its worker continues into artifact disposal. Preliminary detached worker-proof tasks are not in the manager's containment map; they may escalate after its one-time drain. A timed-out manager JoinHandle is detached, then shutdown can wait indefinitely for the same task's instance mutex. Quiesce submissions/producers first; retain task ownership through an explicit drain/cancellation outcome. No ordinary successful-path deadlock established; current tests do not prove timeout shutdown. **Confidence: high for lifecycle gaps.**
- **W3 / P2 — Not all overlay writes use the new gate.** `selection.rs:1172-1176,1588-1621` correctly serialize queued teardown/new installation; cancellation `:1627-1635` and inspect-result teardown/highlight `:1693-1716` still bypass that gate. The result branch sends native commands even when its revision check rejected metadata. A superseded observer already polling on another worker can enqueue stale `mode:none`/highlight despite abort; new installation does not order against it. Route every observer overlay mutation through the same generation-qualified gate. The new regression covers delayed artifact cleanup, not observer cancellation/result delivery. **Confidence: medium-high; schedule unexecuted.**

## Prior findings disposition / positive observations

| Cycle 3 | Source disposition |
|---|---|
| C1 older-kernel watcher fallback; C5 raw getdents UB | Both mechanisms deleted. Watcher uses only group-object pidfd signalling; unsupported flag fails launch (`death_watcher.rs:194-207`). Separate supervisor scanner issue is C1 above. |
| C2 failed temp publication | Explicit ownership now covers fill/fsync errors and `PersistError.file` (`store.rs:1667-1732`). Non-cancelled publication/denied-unlink regression authored (`server/tests/browser_debug_artifacts.rs:1296-1321`). No equivalent omission found in these inspected branches. |
| C3 MFA rotation | Completed StepUp publishes epoch; real-route SQLite/PTY regression authored (`browser_host_selection.rs:1843-1949`). Cancellation/commit placement remains C2 above. |
| C4 abortable/log-only escalation | Worker proof survives interceptor abort; manager callback owns escalation, no `Browser.close`. Matching principal/incarnation protects replacements and sibling principals in inspected success path; no teardown loop found. Failed-proof accounting and shutdown remain C3/W2. |
| W1 stale cleanup overlay | Revision gate addresses the originally reported delayed-unlink schedule; observer mutation paths remain W3. |
| W2 queue/shutdown | Empty work coalesces; session drain and shutdown call added. Hard bounds/quiescence remain W1/W2. |
| W3 denied paused children | Paused children now enter page retirement / exact worker close-and-inventory proof, with escalation when unsuccessful. Source regressions cover paused and abort schedules (`screencast.rs:1457-1493,1632-1710`). |

## Suggestions — security, performance, architecture

1. Close C1–C3 before backend-core technical closure; extend production-owner failure/cancellation oracles, not only callback-presence assertions.
2. Reuse current manager, artifact pending set and overlay gate. Avoid another cleanup registry/service. Keeping native resources charged until absence is both simpler accounting and the planned contract.
3. Make comments truthful: `publish_revocation` takes a synchronous mutex despite “without waiting for any lock”; bounded drain does not imply joined workers. Document Linux 6.9+ operator requirement in Phase 04-owned maintained docs.
4. Linux destructive signalling inspected uses pidfds; remaining Linux numeric `kill(wpid, 0)` / `killpg(..., None)` are probes, numeric SIGKILL in watcher tests is test-only. Non-Linux Unix numeric branches remain in source; no supported Linux bare numeric TERM/KILL identified. Identity-safe handles alone do not establish launch ownership (C1).
5. No TODO/FIXME/todo!/unimplemented! found in searched repair owners. No unrelated refactor or cosmetic modularization recommended during security repair. Raw-CDP/Admin and DNS/WebSocket/WebRTC non-sandbox caveats remain explicit.

## Reviewed files / coverage

Deep/selected source ranges and changed hunks, **not an exhaustive re-audit of all 39 tracked changed files**:
- `server/src/browser_host/{process,manager,screencast,selection,media,session,auth,network_policy,cdp}.rs`; untracked `server/src/browser_host/process/death_watcher.rs`.
- `server/src/browser_debug/{store,tests}.rs`; `server/src/{state,main}.rs`; changed `server/src/pty/manager.rs` hunk.
- `server/src/api/{auth,auth_mfa,browser_host}.rs`; supporting `server/src/auth/store/{sqlite,mongo}.rs`; `server/Cargo.lock` and locked procfs iterator.
- Selected regressions: `server/tests/browser_host_{lifecycle,process,selection}.rs`, `server/tests/browser_debug_artifacts.rs`; shutdown coverage searched. Changed `packages/ui/src/api/auth-client.ts` hunk.
- README, PDR, code standards, Browser architecture, Phase 01 plan/acceptance and cycle-3 report; published development/primary workflows and code-review skill.
- Coverage complete for tracing each prior finding's repair owner; incomplete for exhaustive whole-diff/platform/runtime qualification. Windows remains an explicit prerequisite, not silently completed.

## Validation commands/results

- Executed read-only `git diff --stat && git status --short`: initial scope **39 tracked files, +16,870/-2,629**, plus untracked watcher/planning/review artifacts.
- Executed `git diff --unified=3 -- server/src/api/auth_mfa.rs server/src/main.rs server/src/state.rs server/src/pty/manager.rs packages/ui/src/api/auth-client.ts` and `git diff --unified=1 -- server/src/browser_host/manager.rs server/src/browser_host/process.rs server/src/browser_host/screencast.rs server/src/browser_host/selection.rs server/src/browser_debug/store.rs`; focused source/search inspection.
- **No tests, builds, typechecks, linters, formatters, installs, runtime probes or Git mutations run here.** Type/test coverage percentages unavailable.
- **Caller-provided, not independently executed:** full server **2,285 pass / 1 flaky failure** — `browser_host_compatibility`, geometry case 5 “no click recorded,” under multi-binary full run; passes isolated and whole-binary rerun. Browser-host suites stable ×4 and with `--test-threads=4`; clippy **0 errors**; UI **3,720 pass**. Not an all-green full-server claim.
- Main-agent follow-up after authorized repairs: `cargo test --manifest-path server/Cargo.toml --lib`; `cargo test --manifest-path server/Cargo.toml --test browser_host_process --test browser_host_lifecycle --test browser_host_selection --test browser_debug_artifacts --test browser_host_shutdown`. Include configured real Chromium and deterministic C1–C3/W1–W3 boundaries; these commands alone do not add missing oracles.

## Unresolved questions

- Unexecuted: mixed-generation proc inventory; StepUp commit-before-publication/cancellation; failed live containment with retained capacity; queue growth after independent artifact retirement; producer-quiesced/timeout shutdown; cancelled/stale observer overlay ordering.
- Accepted prior limits not reflagged: DB-direct demotion publication, cancelled blocking PTY wait retaining guards, page-session overflow losing worker identity.
- Native Windows containment/proof and downstream physical/human/soak qualification remain blocked/pending. This review is neither release approval nor final user acceptance.
