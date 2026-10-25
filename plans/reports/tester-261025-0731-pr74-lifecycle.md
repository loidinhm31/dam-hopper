# Supplemental Lifecycle Validation Report (PR #74)

## Request and Authority
- **Operation / Scope**: `run` supplemental lifecycle validation. Empirically verify empty initialize idle leak (R3/F11) and crash-budget exhaustion didOpen revival bypass with dirty overlay replay omission (R2/F10) via real production actor APIs.
- **Authority**: Review-only. No modifications to tracked production source, tests, or CI configuration. Report artifact only.
- **Policy/Procedures Loaded**: `/home/loidinh/.omp/agent/skills/test/references/{test-principles,code-validation}.md`.
- **Harness & Environment**: Standalone Rust probe outside repo (`/home/loidinh/tmp/lifecycle_probe_PR74`) with Cargo.lock seeded from `server/Cargo.lock` (exact dependency equivalence not independently verified) on local disk storage to avoid tmpfs quota exhaustion. Real pinned Node v24.16.0 executable (`/home/loidinh/.nvm/versions/node/v24.16.0/bin/node`) and SHA-256 verified toolchain profile with disposable instrumented test fixture (`lsp-test-server.mjs`). Explicitly production supervisor/session boundary, not real TSLS or WebSocket end-to-end qualification.

## Executive Summary & Per-Probe Status
- **Probe R3 (Idle Eviction Leak — F11 / P2)**: **REPRODUCED AT RUNTIME (FAIL)**. Empty initialized sessions were not evicted after 65 seconds (exceeding the 60s idle timeout), retaining both global tree slots and blocking admission of a subsequent connection. Positive control verified that an equivalent session opening and closing a document evicts cleanly.
- **Probe R2 (Crash Budget Exhaustion didOpen Revival & Replay Omission — F10 / P2)**: **REPRODUCED AT RUNTIME (FAIL)**. After 2 automatic restarts exhausted the crash budget, opening document B revived the session from Crashed state and spawned a new child PGID (budget bypass), but omitted replaying existing dirty overlay document A to the replacement child process.

## Probe R3: Empty Initialize Idle Leak (F11 / P2)
- **Invariant (Source-Independent)**: A semantic session with zero open documents and zero in-flight requests must be idle-evicted after `IDLE_SHUTDOWN_TIMEOUT` (60s), freeing process group resources and releasing global tree capacity (`MAX_GLOBAL_SEMANTIC_TREES = 2`).
- **Commands & Harness**:
  - Build: `cargo build --manifest-path /home/loidinh/tmp/lifecycle_probe_PR74/Cargo.toml --target-dir /home/loidinh/tmp/target_cache`
  - Execution: `TMPDIR=/home/loidinh/tmp /home/loidinh/tmp/target_cache/debug/lifecycle-probe` (output captured in runner job `bg_7`, total duration 175.43s).
- **Part 1 — Positive Control (Document Open + Close)**:
  - Session initialized (`pgid=311160`, `state=Ready`). Opened `file:///ctrl.ts`, then closed it via `did_close` (arming `check_schedule_idle_timer()`).
  - Elapsed wait: 63.00s (>60s timeout).
  - Observation: Eviction succeeded (`evicted=true`, `active_sessions=0`, `active_trees=0`, `pgid_empty=true`). Positive control proves eviction logic and background reaper function when armed.
- **Part 2 — Defect Probe (Empty Initialize Leak)**:
  - Supervisor initialized 2 empty sessions: Session 1 (`pgid=323152`), Session 2 (`pgid=324142`). `active_sessions=2`, `active_trees=2`.
  - Elapsed wait: 65.00s (>60s timeout) holding handles alive with 0 documents and 0 requests.
  - Observation (First Failure): Neither session was evicted. Session 1 stayed `Ready` (`pgid=323152` alive); Session 2 stayed `Ready` (`pgid=324142` alive). Supervisor status remained `active_sessions=2`, `active_trees=2`.
  - Capacity Exhaustion: Third admission attempt (`supervisor.get_or_create_session("conn-r3-3", ...)`) returned `Err(SupervisorError::GlobalTreeLimitExceeded(2))` (`GlobalTreeLimitExceeded: true`).
  - Teardown: `supervisor.shutdown()` cleanly reaped both child process groups (`pgid1_reaped=true`, `pgid2_reaped=true`, `active_sessions=0`).

## Probe R2: Crash Budget Exhaustion & didOpen Replay Omission (F10 / P2)
- **Invariant (Source-Independent)**:
  1. Once automatic crash restarts exhaust `MAX_RESTARTS_PER_WINDOW` (2), the session must remain in `Crashed` state without spawning new child processes unless explicitly recovered by budgeted policy.
  2. If a session is revived with dirty overlays in memory, the replacement child process must receive replays of all open/dirty overlays before processing requests against them.
- **Commands & Harness**: State-synchronized crash/restart loop using POSIX `SIGKILL` to probe-owned child PGIDs only.
- **Execution & Observations**:
  - Step 1 (Initial): Opened `file:///docA.ts` (`pgid_1=337248`). Applied dirty change (`docs=1`, `bytes=30`). Child 1 confirmed holding doc A (`openDocs count=1`).
  - Step 2 (Crash 1): `SIGKILL` to `pgid_1`. Automatic restart 1 succeeded (`pgid_2=337922`, 1s backoff). Navigation confirmed doc A present in child 2 `openDocs`.
  - Step 3 (Crash 2): `SIGKILL` to `pgid_2`. Automatic restart 2 succeeded (`pgid_3=338898`, 3s backoff). Navigation confirmed doc A present in child 3 `openDocs`.
  - Step 4 (Crash 3 — Exhaustion): `SIGKILL` to `pgid_3`. Budget exhausted (`MAX_RESTARTS_PER_WINDOW=2`). State entered `Crashed`, `current_pgid=None`, `pgid_3_empty=true`. No automatic restart occurred.
  - Step 5 (Budget Bypass): Called `session.did_open("file:///docB.ts")` on crashed session. `did_open` succeeded (`Ok(())`); state transitioned to `Ready`; new child spawned (`pgid_4=339383`, `alive=true`). Confirms crash budget bypass via `do_did_open -> do_initialize()`.
  - Step 6 (Replay Omission):
    - Actor View: Overlay stats report `docs=2`, `bytes=42`. Both `file:///docA.ts` and `file:///docB.ts` retained in actor overlay map (`snap_a.is_some() == true`).
    - Child 4 View: Querying navigation from B (`textDocument/definition`) returned child's actual `openDocs`: count=1, containing only `file:///docB.ts` (`child_has_b=true`, `child_has_a=false`).
    - Disposable Fixture Event Log: PID 339383 received only `initialize` and `textDocument/didOpen` for B. Document A was never sent to child 4 (`received_a=false`).
  - Teardown: `supervisor.shutdown()` cleanly reaped child 4 (`pgid_4_reaped=true`).

## Runtime vs. Static Conclusions
| Finding | Previous Evidence | Supplemental Probe Evidence | Final Disposition |
|---|---|---|---|
| **F11 / R3** (Empty initialize idle leak) | Static code path | Runtime execution: positive control evicted at 63s; empty initialize failed eviction at 65s, leaking 2 global tree slots and blocking 3rd admission (`GlobalTreeLimitExceeded(2)`). Static analysis confirms `check_schedule_idle_timer()` absent on initialize path. | **REPRODUCED AT RUNTIME** |
| **F10 / R2** (Exhausted revival & replay omission) | Static code path | Runtime execution: 3rd kill exhausted budget; `did_open(B)` bypassed budget and spawned child 4 (`pgid=339383`); child received B only while actor held A+B. Static analysis confirms `do_did_open` calls `do_initialize()` unconditionally without replaying overlays. | **REPRODUCED AT RUNTIME** |

## Verification and Cleanup
- **Cleanup Verified**: All probe run data in `/home/loidinh/tmp/lifecycle_probe_PR74/run_data`, compiled binaries, and target caches in `/home/loidinh/tmp` were removed. Output verifies control PGID (311160), both R3 PGIDs (323152, 324142), and R2 PGIDs 3 (338898) and 4 (339383) were reaped/empty. PGIDs 1 and 2 received SIGKILL during crash transitions. `/home/loidinh/tmp` returned to clean initial state.
- **Repo State**: No production source, tests, or CI configurations modified. Only report artifact added.

## Unresolved Questions
1. Should `session.did_open` on a crashed/exhausted session reject with `SessionError::ChildCrashed` requiring explicit connection re-establishment, or should it run budgeted restart with full overlay replay?
2. Should empty initialized sessions arm idle eviction immediately in `do_initialize`, or should empty sessions be kept alive until an initial inactivity timeout (e.g., 30s) if a client is expected to send `didOpen` shortly after connection?
