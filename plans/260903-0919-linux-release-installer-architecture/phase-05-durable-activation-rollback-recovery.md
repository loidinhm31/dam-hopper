# Phase 05 — Durable Activation, Rollback, and Crash Recovery

## Context Links

- [Parent plan](./plan.md)
- [Phase 02 staging](./phase-02-rust-cli-safe-acquisition-staging.md)
- [Phase 04 systemd ownership](./phase-04-role-aware-systemd-ownership.md)
- [Systemd transaction research](./research/researcher-02-systemd-transaction-runtime.md)
- [Accepted brainstorm](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md)
- [Server graceful shutdown](../../server/src/main.rs)

## Overview

- **Date:** 2026-09-03
- **Description:** Make explicit activation a durable state machine that commits only after exact process/listener/health stability and restores the previous release on failure or interruption.
- **Priority:** P1
- **Implementation status:** Completed 2026-09-03 23:45:08 +07:00
- **Review status:** Approved 2026-09-03 (Cycle 2; 9.8/10; no blocking findings)
- **Progress:** 100% (13/13 implementation steps; 7/7 todo items)

## Key Insights

- Filesystem rename gives atomic visibility; crash durability also requires file and parent-directory `fsync`.
- A symlink cannot be authoritative: units use concrete paths and a crash can occur between state, unit, and pointer updates.
- `Restart=on-failure` handles post-commit process crashes. It must not infer release failure or create unbounded version rollback loops.
- Mid-activation reboot recovery needs a boot-time root one-shot before selected services. Otherwise an enabled unit file could start an uncommitted candidate.

## Requirements

### Functional

- Durable progression: `ABSENT|ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`; invalid combinations become `RECOVERY_REQUIRED`.
- `install`/`role set` stop at `PENDING`. Unified `start` with no pending starts/verifies the committed role; with pending, it runs the transaction.
- Preflight validates manifests, state generation, selected roles, concrete units, identities (API runs as `root`, web as `dam-hopper-web`), current cgroups/listeners, forbidden `4800`, expected current SQLite holders, and candidate config.
- Transition quiesces the union of old/new roles, proves cgroups and `4801/4802` listeners free, and proves no foreign holder of runtime SQLite before switch.
- Candidate start deadline: 20 seconds. Then require 20 consecutive 500ms probes (10 seconds) for each selected unit: active/MainPID, exact executable, UID/GID, exact wildcard listener, and exact-version JSON health.
- Commit only after the full stability window. Then atomically set active/previous, clear pending, enable selected units, disable removed-role units, and repair `current`.
- Any candidate start/probe/early-exit failure automatically stops candidate, restores previous concrete units/config/state, starts old role, and applies the same 20s + 10s verification.
- First-install failure restores no active release and disabled/stopped app units. Old restoration failure sets `RECOVERY_REQUIRED` and never reports rollback success.
- Manual `rollback` activates the recorded previous release with the same transaction/probe rules; failure attempts to restore the original active release before declaring recovery required.
- Boot-time `dam-hopper-recovery.service` runs `dam-hopper recover --boot` before app units and blocks them on inconsistent/uncommitted state.

### Non-functional

- One root lock covers state inspection through final commit/rollback.
- Authoritative `/var/lib/dam-hopper-manager/state.json` is one strict generation-numbered envelope containing active, previous, pending, transaction, role/config hashes, and latest failure reference.
- Every transition uses create-new temp → write/sync → rename → parent sync. Unit/config replacements keep verified transaction backups until commit.
- Retain active + one previous known-good + pending or latest failed candidate. After a later successful commit, remove only unreferenced older trees whose manifests/ownership still verify.
- Never modify user API config, token, SQLite, project trees, external MongoDB, firewall, TLS, DNS, or SELinux policy.

## Architecture

The manager owns a serialized transaction and adapters for durable filesystem, systemd, process evidence, and HTTP health. State is authoritative; `/opt/dam-hopper/current` is repaired after commit and ignored for decisions.

Unified `start` activation order:

```text
lock/reconcile → validate old+candidate → QUIESCED
→ stop/disable selected old and prove clear
→ install concrete candidate units/config, daemon-reload → SWITCHED
→ start candidate → PROBING → exact health stability
→ enable selected/disable removed → atomic COMMITTED state
→ repair current symlink → GC only unreferenced verified trees
```

Rollback uses transaction-owned backups, never reconstructs old units from guesses. API probe is loopback `GET /api/health`; web probe is loopback `GET /__dam-hopper/health`. Both must be JSON, schema `1`, status `ok`, expected role, and expected version; redirects and HTML are failures.

Recovery table:

- `STAGED/PENDING`: leave old active; keep candidate pending.
- `QUIESCED/SWITCHED/PROBING`: restore old or no-active first-install baseline, then verify.
- `COMMITTED`: keep candidate; verify/repair unit enablement and convenience pointer without version rollback.
- Missing/corrupt state, unowned backups, manifest/unit/config hash disagreement, or multiple plausible active releases: `RECOVERY_REQUIRED`.

## Related Code Files

### Create

- `deploy/systemd/dam-hopper-recovery.service.in` — root one-shot ordered before app units.
- `server/src/linux_release/durable_fs.rs` — atomic write, directory sync, rename/exchange helpers.
- `server/src/linux_release/state.rs` — strict authoritative state envelope and generations.
- `server/src/linux_release/journal.rs` — allowed transition graph and recovery classification.
- `server/src/linux_release/transaction.rs` — lock-scoped orchestration.
- `server/src/linux_release/health.rs` — bounded exact JSON stability probes.
- `server/src/linux_release/activate.rs` — quiesce/switch/probe/commit (transaction engine dispatched by `start`).
- `server/src/linux_release/rollback.rs` — automatic/manual restoration.
- `server/src/linux_release/recovery.rs` — command/boot reconciliation.
- `server/src/linux_release/retention.rs` — reference-safe bounded cleanup.
- `server/tests/linux_release_state_machine.rs` — transition/crash-boundary tests with real temp files.
- `server/tests/linux_release_health.rs` — real local processes/listeners/HTTP probes.

### Modify

- `server/src/linux_release/cli.rs` — dispatch start/status/rollback/recover (unified `start` owns activation).
- `server/src/linux_release/stage.rs` — write pending into the authoritative envelope.
- `server/src/linux_release/systemd.rs` — unit backup/install/enable/disable/reload and boot recovery handling.
- `server/src/linux_release/process.rs` — role-aware cgroup/listener/database holder proofs.
- `server/src/linux_release/mod.rs` — compose transaction modules.
- `deploy/systemd/dam-hopper-api.service.in` — order after and require successful boot recovery, without API↔web coupling.
- `deploy/systemd/dam-hopper-web.service.in` — same recovery ordering; remain independent of API.
- `deploy/release/release-manifest.schema.json` — include recovery template inventory/hash.

### Delete

- None; Phase 07 removes legacy assets only after migration tests.

## Implementation Steps

1. Implement one strict state envelope with monotonic generation, transaction UUID, exact manifest/unit/config hashes, and invariant validation before any mutation.
2. Implement durable write/sync primitives and same-filesystem checks. Treat sync/rename failures as incomplete transactions, never success.
3. Define transition methods that reject skipped/backward states except the explicit rollback/recovery graph.
4. Preflight current services: allow only PIDs/listeners/SQLite holders attributable to expected active API unit; reject foreign processes, drop-ins, port `4800`, extra listeners, and ambiguous systemd state.
5. Quiesce the old/new role union. Wait at most `TimeoutStopSec` plus bounded manager allowance; verify MainPID zero, empty cgroups, released ports, and no runtime DB holders.
6. Backup exact transaction-owned units/config, install candidate unit/config files atomically, reload systemd, start selected units, and record every boundary durably.
7. Probe every 500ms: reset the consecutive-success count on transient failure; fail immediately on wrong version/role/executable/identity/listener or early unit exit; enforce 20s startup deadline plus 10s uninterrupted stability.
8. On success, set enablement, atomically commit active/previous/pending state, repair pointer, and apply reference-safe retention.
9. On failure, execute old restoration and health verification; preserve candidate plus bounded sanitized failure reason as latest failed.
10. Add boot recovery one-shot. Pending-only reboot leaves units disabled; mid-switch reboot restores old; committed reboot permits only committed selected role.
11. Add crash tests after every durable boundary by terminating a child manager process and rerunning recovery against real files. Phase 08 repeats critical cases with actual Fedora systemd.
12. Plan compile proof: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`.
13. Submit to `evcrate-code-reviewer`; fix all blocking findings, rerun compile proof and state-machine tests, and require terminal approval.

## Todo List

- [x] Add durable state envelope and transition graph.
- [x] Add lock-scoped activation and exact health stability probes.
- [x] Add automatic/manual rollback with verified old health.
- [x] Add boot-time recovery and fail-closed state classification.
- [x] Add bounded reference-safe retention.
- [x] Add every-boundary crash tests.
- [x] Run compile check and pass reviewer gate.

## Success Criteria

- Successful both-role activation runs one exact version under correct identities/ports and commits only after 20 consecutive successful probes.
- Candidate unit, binary, port, wrong-version JSON, HTML health, timeout, early crash, and second-role failures all restore and verify previous health automatically.
- First-install failure leaves no active/previous, no enabled app unit, and no listener.
- Process kill or reboot at each state yields exactly old-active, pending-old-active, rolled-back, committed, or `RECOVERY_REQUIRED`; never guessed success.
- State/pointer/unit disagreement is detected; the only known-good or referenced tree is never deleted.
- Post-commit process crash uses systemd restart and does not change release version.
- User runtime files and ownership hashes remain identical across success and rollback.
- Compile check exits `0`; reviewer has no unresolved P1/P2 findings.

## Risk Assessment

- **Multi-file atomicity:** Single authoritative state plus durable backups and recovery makes unit/config updates replayable.
- **Downtime:** 20s startup + 10s stability is bounded; rollback has the same bound. Document worst-case outage rather than hide it.
- **Rollback-incompatible state:** Enforce manifest `n-1` declaration and release policy; arbitrary DB migrations remain out of scope.
- **Recovery service privilege:** Fixed argv, no network, no operator input, root-owned binary/state, strict unit sandbox where compatible.
- **GC data loss:** Set-based reference calculation plus manifest/owner verification; fail closed on any uncertainty.

## Security Considerations

- Root transaction state and backups are `0700/0600`; no service identity can read manager internals.
- Health follows no redirects and uses loopback exact ports with strict body/size/content-type/time limits.
- Subprocesses use argv arrays, fixed absolute executables, minimal environment, and bounded output.
- Failure records redact URLs beyond origin, paths beyond approved deployment roots, HTTP bodies, env, and tokens.

## Next Steps

1. Phase 05 review approved (Cycle 2); all durability findings resolved.
2. Phase 06 publishes exact inputs consumed by this state machine.
3. Phase 07 adds verified legacy takeover. Unresolved questions: none.
