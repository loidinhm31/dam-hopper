# Phase 02 — Cycle 2 Code Review

## 1. Score: 4/10 — NOT APPROVED

Source inspection confirms lock-retention and `try_wait()` improvements, but descendant proof remains unsafe; new atomic capacity reservation leaks on failure. Phase 02 acceptance remains incomplete. Prior approval/test counts in the plan are historical, not Cycle 2 evidence from this review.

## 2. Reviewed files / scope

All 13 assigned files reviewed, relevant sections (~4,000 lines; not a full unrelated-module audit):

- `server/src/config/schema.rs:580-675` — browser schema/defaults/validation.
- `server/src/config/parser.rs:27-75,598-642` — browser parsing/serialization.
- `server/src/config/global.rs:10-18,85-168` — profile-root default/global serialization.
- `server/src/config/tests.rs:2280-2443` — browser defaults, validation, roundtrip.
- `server/src/browser_host/config.rs:1-632` — budgets, permissions, restart predicate, capability gates.
- `server/src/browser_host/manager.rs:1-691` — launch/reset/recovery/shutdown/agent accounting.
- `server/src/browser_host/profile.rs:1-391` — lock, identity, tombstone, file operations.
- `server/src/browser_host/process.rs:198-809` and endpoint/launch supporting sections — containment, termination, reaping.
- `server/src/browser_host/mod.rs:1-13` — exports.
- `server/src/state.rs:385-438` — lazy manager construction.
- `server/src/main.rs:1198-1290` — shutdown integration.
- `server/tests/browser_host_lifecycle.rs:1-444`.
- `server/tests/browser_host_shutdown.rs:1-249`.

Requirements: `phase-02-managed-lifecycle.md:51-91,180-191`; `architecture-contracts.md:150-165`; project README, PDR, code standards; installed `code-review` skill and development rules. Product/tests/plans unchanged; only this report written. Plan status ownership remains Main's.

### Requested remediation disposition

| Item | Inspection result |
|---|---|
| Reset lock retention | Improved: lock stays in `InnerInstance`; stale/idempotent returns preserve a previously held live lock (`manager.rs:416-453`), failure returns retain it. Recovery transaction still incomplete: M4. No new behavioral regression proof. |
| Descendant exit proof before deletion | **Unresolved:** persisted PID branch proves neither identity nor descendant exit: M1. |
| Atomic global reservation | CAS removes check-then-act race (`manager.rs:281-299`), but failure/cancellation leaks capacity: M3. |
| Reap dead children via `try_wait` | Implemented (`process.rs:621-630`); crash path invokes termination, but ignores failed proof and relaunches: M2. |
| Agent CDP lifecycle hooks | Methods added (`manager.rs:676-689`); gateway wiring reviewed separately by Phase 04 owner. |

## 3. MUST FIX

### M1 — Critical: restart reset kills an unverified PID and deletes without descendant proof

**Evidence:** `manager.rs:529-555`; metadata/tombstone contain only PID, `profile.rs:44-76`. The branch reads `meta.process_pid`, not the tombstone's preserved PID. `kill(pid, 0).is_ok()` is the only identity/liveness test; TERM/KILL target the leader, never its group. Any probe error is treated as absence. Deletion follows at `manager.rs:557-580`.

**Failure/impact [INFERENCE]:** restart while an old leader is gone but descendants still hold the profile permits live credential deletion. A reused PID can instead kill an unrelated same-account process. Permission/probe failures can also become false exit proof. Adding a PID field does not satisfy exact identity + ALL-descendants proof required by contract §11.

**Correction:** persist and validate process identity/containment provenance; recover against the recorded containment object/group, prove no live members, distinguish ESRCH from unknown/error, and keep `CleanupPending` on ambiguity. Never signal a PID on metadata authority alone. Use tombstone identity throughout recovery.

**Confidence:** high; unsafe branch directly inspected. Reproduction not executed.

### M2 — Critical: crash recovery discards failed containment proof, releases lock, relaunches

**Evidence:** `manager.rs:268-276` ignores `proc.terminate().await`, sets Dormant, drops `_held_lock`, releases capacity, then launches again. `terminate()` can return `ContainmentUnproven`, signal/procfs/reap errors (`process.rs:657-678,695-733`). `BrowserProcess::drop` only sends best-effort signals (`process.rs:747-760`), not exit proof.

**Failure/impact [INFERENCE]:** a dead/reaped leader plus surviving or uninspectable descendants is treated as safe recovery. Another browser can access the same credential directory; cross-manager exclusion is released before proven containment cleanup.

**Correction:** preserve lock, process/containment ownership and capacity until successful termination proof. On any uncertain result persist recoverable failure and enter `CleanupPending`; do not relaunch. Make liveness inspection return a typed error rather than treating `try_wait` errors as confirmed death.

**Confidence:** high.

### M3 — High: new reservation leaks permanently on ordinary errors or future cancellation

**Evidence:** count increments at `manager.rs:290-296`; `lock_with_timeout(...).await?` (302), `ensure_user_data_dir()?` (306), metadata load/save (333-337) have no rollback. Only explicit launch-error/timeout branches decrement (318,323). Cancellation at an await also bypasses rollback.

**Failure/impact [INFERENCE]:** with default capacity one, one external profile-lock timeout exhausts capacity despite zero owned browsers; subsequent unrelated principals get `browserBusy` until server restart. Metadata failure after launch additionally drops the process/lock without awaited cleanup proof.

**Correction:** own the reservation with a cancellation-safe RAII permit; transfer it only to the successfully tracked instance. Roll back all prelaunch failures. For a spawned process, retain ownership/fencing until containment cleanup is proven. Test a lock failure followed by successful admission for another principal.

**Confidence:** high; introduced by CAS remediation.

### M4 — High: reset intent/epoch recovery is not transactionally consistent

**Evidence:** tombstone is saved before metadata (`manager.rs:471-477`), while same-operation resume (`436-440`) does not reconcile either persisted or in-memory epoch. Final metadata save is ignored before tombstone removal (`637-640`). Profile writes rename temporary files without syncing file or parent directory (`profile.rs:313-329,345-361`).

**Failure/impact [INFERENCE]:** interruption after tombstone publication but before epoch save leaves target epoch 2 with metadata epoch 1. Retry can delete successfully and return epoch 2 while saving/retaining epoch 1. A metadata error after intent also returns before state becomes Resetting, potentially leaving a Running instance admissible despite intent. Final save failure can clear the only recovery record without persisting completion, allowing a duplicate operation to wipe again. Rename alone does not prove durable intent across power loss.

**Correction:** fail closed immediately once intent exists; reconcile metadata and `inst.profile_epoch` to the tombstone target on every resume, exactly once. Require successful durable completion metadata before clearing the tombstone; persist files/directories with the required durability ordering. Preserve a retryable state on every I/O failure, including pre-intent lock acquisition errors.

**Confidence:** high.

### M5 — High: timed-out deletion continues outside tracked lifecycle ownership

**Evidence:** `manager.rs:575-580` puts `spawn_blocking(delete_user_data)` inside `timeout`; timeout handling (`606-615`) drops its JoinHandle and returns pending, without retaining the running blocking job. Same-operation retry (`436-440`) can start another deletion immediately. A running blocking task is not canceled by dropping its JoinHandle.

**Failure/impact [INFERENCE]:** deletion can overlap retry/recreation and a subsequent successful unlock/relaunch while an older deletion task still runs. This violates the retained fence through the actual deletion lifetime; newly recreated data may race old filesystem work.

**Correction:** retain the deletion worker handle in manager-owned reset state; timeout changes public status, not ownership. Retry must observe/join that exact worker before any second delete, recreate, completion, or lock release.

**Confidence:** high.

### M6 — High: shutdown/stop failure does not preserve a recoverable fenced state

**Evidence:** `shutdown_all` ignores timeout/termination results, sets every instance Dormant and clears count (`manager.rs:663-673`) without creating a failure tombstone. Cancellation token is stored but unused (`119,146`); shutdown does not close manager admissions. `stop_instance` takes the child and decrements before handling errors (`368-382`), leaving Stopping without a tracked process or failure tombstone. Startup derives Dormant solely from tombstone absence (`175-194`).

**Failure/impact [INFERENCE]:** unproven termination can become an apparently clean/relaunchable profile after restart. Shutdown can also race newly admitted instances; setting the global counter to zero is not admission fencing. This fails the phase's shutdown-timeout recovery acceptance.

**Correction:** gate admissions first; cancel/join owned activity; retain containment/lock/permit on failed proof and persist cleanup status. Only successful stop becomes Dormant. Shutdown must report/retain termination failure rather than overwrite it.

**Confidence:** high. Existing timeout test does not execute this branch (see W1).

## 4. SHOULD FIX

### W1 — Remediation-specific regression evidence absent

`git diff` shows lifecycle/shutdown test changes only add `process_pid: None` to existing fixtures. No new tests cover stale/idempotent reset while live followed by lock contention, lock retention after kill/delete failure, PID reuse/leader-dead descendants, simultaneous principal capacity, error rollback, or real crash reaping.

`browser_host_shutdown.rs:198-249` prewrites a tombstone, never launches/tracks that principal, then calls shutdown on an empty manager; it does not exercise termination timeout or tombstone creation. The purported descendant check (`179-185`) probes only leader PID. Browser-dependent tests return success when Chrome is missing (`browser_host_lifecycle.rs:355-360,402-407`; shutdown `129-134`). Add explicit executed/skipped accounting and behavioral failure-path tests; passing counts cannot close these acceptance gaps.

### W2 — Browser restart requirement is a helper, not an integrated reload signal

`config.rs:476-490` defines `requires_restart`; repository search found only its config test callers, no production consumer and no Browser `restartRequired` response. Manager receives an immutable config snapshot (`state.rs:390-394`). Preserve no-hot-swap behavior, but integrate/document the pending restart signal required by phase step 58 rather than silently leaving changed policy/config ineffective.

## 5. NICE TO HAVE

- Use a dedicated owned instance/operation guard bundling process, profile lock, and capacity permit. This is lifecycle ownership, not a new generic task framework; it reduces manual counter/drop ordering defects.
- Keep the positive cutovers: hashed dev/prod-separated paths, lock inode outside `user-data`, atomic CAS admission, `try_wait` leader reaping, explicit executable, sanitized launch log, lazy AppState construction.

## 6. Validation commands and verified results

**Executed:**

- Scoped `git diff --stat -- <13 assigned paths>` — exit 0; 6 changed files, 105 insertions/33 deletions at inspection.
- Scoped `git diff --` for manager/process/profile/lifecycle/shutdown — exit 0; verified exact remediation hunks and test fixture-only adjustments.
- Targeted source reads/searches above — verified control flow and caller/coverage gaps. Behavioral consequences explicitly marked `[INFERENCE]`.

**Not executed:** compilation, tests, clippy, formatter or smoke. Per shared ownership, Main/TesterCycle2 owns integration validation; no duplicate verification workload launched. No fresh build/test/lint pass claimed. Type/test coverage percentages unavailable.

**Main's validation commands:**

```sh
cargo check --manifest-path server/Cargo.toml --tests
cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture
cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture
cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture
cargo test --manifest-path server/Cargo.toml config -- --nocapture
cargo clippy --manifest-path server/Cargo.toml --tests -- -D warnings
```

Existing commands alone insufficient: add/execute regression oracles for M1–M6, including actual descendant PID/group observation and lock contention. Review does not authorize product changes or close qualification gates.

## 7. Unresolved questions

- Fresh integration build/test/lint results and live-process regression evidence remain unobserved by this reviewer; obtain from Main/TesterCycle2. No missing product decision blocks the corrections above.
