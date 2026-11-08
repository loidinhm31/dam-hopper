# Phase 02 — Configure and supervise principal profiles

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `reports/backend-boundaries.md:28–34,42–53; reports/design-direction.md:18–27`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-08). Effort: not-estimated.
- Deliverable: Configure and supervise principal profiles. Review completed in plans/reports/code-review-261108-1804-phase-02-principal-profiles.md (Cycle 1) and plans/reports/code-review-261108-1841-phase-02-principal-profiles-cycle-2.md (Cycle 2 - Approved; Score: 9.6/10; 221 tests passed across 6 targets).

## Key insights
AppState/startup/shutdown integration is centralized; current shutdown watchdog is10s. Credentials require directory locks, verified process exit and crash tombstones, not Child.kill or PID-age guesses.

## Requirements
Lazy per-principal process; dedicated dev profile; restricted credentials; typed busy admission; persistent recovery/reset state; close target without deleting profile; passive expiry keeps storage.

## Architecture
BrowserHostManager serializes principal lifecycle under a profile lock. Starting/Running/Stopping/Resetting/CleanupPending states fence all target/attachment creation. Platform process primitive from phase01 is reused.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — configure-browser-host
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/config/schema.rs` | Add validated host configuration and capability reasons; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/config/parser.rs` | Add validated host configuration and capability reasons; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/config/global.rs` | Add validated host configuration and capability reasons; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/config/tests.rs` | Add validated host configuration and capability reasons; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/config.rs` | Add validated host configuration and capability reasons; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Add validated host configuration and capability reasons; exact responsibilities in numbered steps below. |

### File map — manage-principal-profiles
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/manager.rs` | Implement locked profile state and reset reconciliation; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/profile.rs` | Implement locked profile state and reset reconciliation; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement locked profile state and reset reconciliation; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_lifecycle.rs` | Implement locked profile state and reset reconciliation; exact responsibilities in numbered steps below. |

### File map — integrate-host-lifetime
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/state.rs` | Wire lazy manager into AppState and graceful shutdown; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/main.rs` | Wire lazy manager into AppState and graceful shutdown; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Wire lazy manager into AppState and graceful shutdown; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_shutdown.rs` | Wire lazy manager into AppState and graceful shutdown; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### configure-browser-host
- Dependencies: freeze-engine-qualification.
- Bounded outcome: Add validated host configuration and capability reasons.
1. Add browser enabled/executable/profile-root, allowed target/asset/dev origins, denied management destinations and hard budgets to existing config schema/parser/global conversion. Defaults disabled until executable and policy valid; no executable auto-download.
2. Validate hard-cap cross-products and overflow against memory ceiling; reject overbudget configuration and unsafe executable/profile root permissions. Domain capability DTO exposes protocol1, configured effective limits, qualified engine status and unavailable reason without local debug address; this phase probes config/domain API directly, not the phase03 HTTP route.
3. Reuse existing config reload convention; changes requiring profile/process migration mark restartRequired and do not hot-swap active credential directories.
- Consumer-visible acceptance:
  - Direct domain capability DTO reports actionable unavailable for missing executable, unsafe bounds or unsupported engine without spawning Chromium; phase03 owns HTTP mapping, unrelated apps remain usable.
  - Configured no-auth allowed origins do not imply global admin or general Internet browsing.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture`
  - `cargo test --manifest-path server/Cargo.toml config -- --nocapture`
  - Smoke: invoke config/domain capability DTO directly for disabled/missing executable/overbudget settings; no HTTP capabilities route prerequisite and no Chromium process spawned.

### manage-principal-profiles
- Dependencies: configure-browser-host.
- Bounded outcome: Implement locked profile state and reset reconciliation.
1. Map subject to non-user-controlled hashed principal root, dev namespace separate. Stable restricted layout: `manager.lock`, `manager.json`, `reset.json` outside deletable `user-data/`; keep lock inode and epoch/tombstone across credential deletion. Acquire exclusive lock before spawn and persist identity/epoch/reset atomically. Default global capacity one process, two targets/two viewers, no waiter queue.
2. Implement lifecycle transitions and timeout ordering from contract. Logical close leaves credential directory; crash marks targets reloaded/lost, validates identity and descendants before relaunch. Never unlink SingletonLock based on age/PID alone or attach an arbitrary browser.
3. Implement reset begin/fence/cancel/terminate/wait/delete/recreate sequence. Bound terminate10s and delete10s; failure remains cleanupPending with tombstone and no relaunch. Reconcile idempotent operation ID on restart under lock; explicit expected epoch prevents stale reset.
- Consumer-visible acceptance:
  - Reconnect reuses the live managed instance; process restart preserves cookies but does not claim unsaved DOM continuity.
  - Reset never deletes live user-data; simulated kill/delete failure persists cleanupPending across restart, with stable external lock/metadata/tombstone never deleted by credential wipe.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture`
  - Smoke: save synthetic login, restart server, verify storage retained; confirm reset and verify all targets exit before profile deletion.

### integrate-host-lifetime
- Dependencies: manage-principal-profiles.
- Bounded outcome: Wire lazy manager into AppState and graceful shutdown.
1. Construct Arc manager with actual listener bind information, origin policy, auth service and cancellation. Do not launch Chromium during AppState creation. Start only bounded sweeper/reconciliation work.
2. At shutdown gate admissions, cancel attachments, release input and terminate/wait managed processes before releasing locks/artifact disposal. Reconcile existing10s force watchdog so it cannot claim clean profile deletion after premature server exit; do not change unrelated PTY/systemd kill policy.
3. Record structured bounded availability/cleanup status without page data, credentials or full debug URLs. Keep no-auth and production profile ownership distinct in every cleanup path.
- Consumer-visible acceptance:
  - Server startup without Browser use launches no engine; shutdown reaps browser descendants and preserves ordinary credential profile.
  - Shutdown timeout leaves recoverable tombstone and never reports deleted credentials.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture`
  - Smoke: open PTY and Browser, SIGTERM server, inspect process tree/lock/tombstone and restart recovery without adopting foreign processes.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "configure-browser-host",
    "title": "Add validated host configuration and capability reasons",
    "blocked_by": [
      "freeze-engine-qualification"
    ],
    "allowed_files": [
      "server/src/config/schema.rs",
      "server/src/config/parser.rs",
      "server/src/config/global.rs",
      "server/src/config/tests.rs",
      "server/src/browser_host/config.rs",
      "server/src/browser_host/mod.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Direct domain capability DTO reports actionable unavailable for missing executable, unsafe bounds or unsupported engine without spawning Chromium; phase03 owns HTTP mapping, unrelated apps remain usable.",
      "Configured no-auth allowed origins do not imply global admin or general Internet browsing."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture",
      "cargo test --manifest-path server/Cargo.toml config -- --nocapture",
      "Smoke: invoke config/domain capability DTO directly for disabled/missing executable/overbudget settings; no HTTP capabilities route prerequisite and no Chromium process spawned."
    ]
  },
  {
    "id": "manage-principal-profiles",
    "title": "Implement locked profile state and reset reconciliation",
    "blocked_by": [
      "configure-browser-host"
    ],
    "allowed_files": [
      "server/src/browser_host/manager.rs",
      "server/src/browser_host/profile.rs",
      "server/src/browser_host/mod.rs",
      "server/tests/browser_host_lifecycle.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Reconnect reuses the live managed instance; process restart preserves cookies but does not claim unsaved DOM continuity.",
      "Reset never deletes live user-data; simulated kill/delete failure persists cleanupPending across restart, with stable external lock/metadata/tombstone never deleted by credential wipe."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture",
      "Smoke: save synthetic login, restart server, verify storage retained; confirm reset and verify all targets exit before profile deletion."
    ]
  },
  {
    "id": "integrate-host-lifetime",
    "title": "Wire lazy manager into AppState and graceful shutdown",
    "blocked_by": [
      "manage-principal-profiles"
    ],
    "allowed_files": [
      "server/src/state.rs",
      "server/src/main.rs",
      "server/src/browser_host/mod.rs",
      "server/tests/browser_host_shutdown.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Server startup without Browser use launches no engine; shutdown reaps browser descendants and preserves ordinary credential profile.",
      "Shutdown timeout leaves recoverable tombstone and never reports deleted credentials."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture",
      "Smoke: open PTY and Browser, SIGTERM server, inspect process tree/lock/tombstone and restart recovery without adopting foreign processes."
    ]
  }
]
```

- [x] <!-- evcrate-task:configure-browser-host --> Add validated host configuration and capability reasons
- [x] <!-- evcrate-task:manage-principal-profiles --> Implement locked profile state and reset reconciliation
- [x] <!-- evcrate-task:integrate-host-lifetime --> Wire lazy manager into AppState and graceful shutdown

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
OS lock and descendant-proof errors fail closed. Server watchdog timing must be reconciled rather than extending deletion past process exit proof.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
0700 directories/0600 metadata or restricted Windows DACL; credentials excluded from diagnostics/backup examples; no plaintext password-store override.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
1. Remediation verified across all cycle 1 critical and high-priority issues: lock handling on reset/crash, reset tombstone idempotence, and shutdown termination timeout.
2. Cycle 2 tests verified clean: 221 tests passed across 6 targets (`browser_host_lifecycle`, `browser_host_shutdown`, `auth_no_auth`, `config`, `browser_host_process`, `browser_host_adapter`).
3. Cycle 2 code review approved with score 9.6/10 (0 critical, 0 high findings). Phase 02 is approved and closed.
4. Advance to Phase 03: Admission control and route registration (`phase-03-admission-control.md`).
## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
