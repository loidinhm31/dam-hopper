# Phase 02 Cycle 3 — Code Review

## Score: 5/10 — changes requested

Static review: Cycle 3 improves process accounting and reset fencing, but does **not** close all lifecycle safety issues. Findings below distinguish observed source behavior from unexecuted failure scenarios. No product code, tests, or plan state changed.

## Scope / reviewed files

- `server/src/config/{schema.rs,parser.rs,global.rs,tests.rs}` — Browser schema, validation, persistence, regression coverage.
- `server/src/browser_host/{config.rs,manager.rs,profile.rs,process.rs,mod.rs}` — configuration/capabilities, launch/reconnect, process containment, profile/reset persistence.
- `server/src/{state.rs,main.rs}` — construction and shutdown integration.
- `server/tests/{browser_host_lifecycle.rs,browser_host_shutdown.rs}` — lifecycle and shutdown coverage.
- Supporting evidence: `server/src/api/config.rs:1126-1169`; phase specification, overview, architecture contracts §§1–3/11; README, PDR, code standards. Required code-review skill and published development/review guidance read directly.
- Review focus: current implementation plus working-tree Cycle 3 diff. No TypeScript changes in assigned scope.

## Critical issues — MUST FIX

### C1 — Critical: persisted PGID is signalled without proving ownership

**Evidence:** `manager.rs:553-564`; persisted identity fields `profile.rs:44-54,69-78`; successful stop `manager.rs:391-414` never clears persisted process identity.

Reset after restart sends TERM/KILL to the saved group immediately. `process_pid` is persisted but never checked; no process birth identity, executable/profile identity or descendant ownership is verified. A normal successful stop leaves a stale PGID in metadata. If the OS later reuses that number, a reset can kill an unrelated same-UID process group. The subsequent ESRCH check proves absence only **after** the destructive signal, not that the group belonged to Browser.

**Correction:** clear durable process identity after proven termination; before restart reconciliation signals anything, verify non-reusable identity and owned group/descendants. Ambiguous identity must remain `CleanupPending`, not signal a foreign group. Reject invalid/nonpositive group IDs. Add a regression where saved PGID belongs to a different live process and assert it survives.

**Confidence:** high from source; PID/PGID reuse failure scenario not executed.

### C2 — Critical: unproven termination is not durably fenced across every exit path

**Evidence:** `manager.rs:175-194,269-281,348-360,383-405,690-700`.

- Crash cleanup failure now retains the lock and sets `CleanupPending` in memory, but writes no durable cleanup marker. A new manager reconstructs `Dormant` whenever `reset.json` is absent, ignoring saved process identity and previous failed containment.
- On launch metadata-save failure, termination result is discarded, state becomes `Dormant`, and the local profile lock drops. Unproven descendants can outlive ownership; process `Drop` sends KILL but does not prove exit (`process.rs:751-765`).
- Ordinary stop failure leaves `Stopping` with no process handle, not durable cleanup-pending state. A second stop takes the no-process branch and sets `Dormant` even for an existing `CleanupPending` instance.
- Shutdown discards termination error/timeout and sets every instance `Dormant`, without persisting failed containment.

**Impact:** cleanup status/ownership can be lost on restart; Browser can attempt relaunch against a profile whose previous descendants were never proven dead. This violates the phase's explicit fail-closed recovery contract even though the new crash branch is safer within one manager lifetime.

**Correction:** route all unproven termination paths through one durable cleanup transition retaining profile ownership and process/group recovery identity. Reconcile that marker under lock before any new launch. Never convert `CleanupPending` to `Dormant` merely because the in-memory child handle is absent; successful proof alone releases the fence.

**Confidence:** high; adverse OS/filesystem paths not dynamically exercised.

### C3 — Critical: reset intent/epoch transaction can reopen the old epoch

**Evidence:** `manager.rs:459-503,662-679`; `profile.rs:315-332,347-372`.

Reset writes `reset.json` first, then the epoch in `manager.json`. Crash or metadata-write failure between those writes leaves a tombstone targeting epoch 2 and metadata still at epoch 1. The resume branch takes `existing.target_profile_epoch` but never repairs `meta.profile_epoch` or `inst.profile_epoch`. It can finish with `Completed { new_profile_epoch: 2 }` while both actual metadata and the live manager remain epoch 1. If the write fails without a restart, the old `Running` state also remains usable because the in-memory fence is only set after that write.

At completion, metadata-save failure is explicitly ignored before clearing the tombstone. This can lose idempotency/identity cleanup and report completion without a committed final record. Atomic rename alone also lacks file/directory sync needed for the claimed durable crash intent.

**Correction:** make tombstone epoch authoritative during recovery; durably reconcile metadata and in-memory epoch before exposing/resetting the instance. Fence immediately once intent exists. Require successful final metadata commit before clearing intent/reporting completion; use crash-durable publication ordering. Exhaustion must fail closed, not `saturating_add(1)` at `u64::MAX` (`manager.rs:482`). Test interruptions at both writes and final commit failure.

**Confidence:** high; interruption scenario derived directly from write/resume ordering, not run.

### C4 — High: metadata-read failure still leaks the global process reservation

**Evidence:** CAS reservation `manager.rs:286-304`; unchecked post-launch read `manager.rs:348`.

After reserving a process slot and launching Chromium, `load_or_init_metadata()?` can return directly. Unlike lock/directory/save failures, this path never decrements `global_process_count` and leaves state `Starting`. At the default capacity of one, subsequent principals remain `browserBusy` although the local process was dropped. Cancellation while awaiting lock/startup similarly has no reservation guard.

**Correction:** own the reservation with an RAII guard until committed into the running instance; release exactly once on every error/cancellation, including metadata read. Preserve the containment fence when cleanup cannot be proved (C2). Add a metadata-read-failure regression, then demonstrate another principal can reserve capacity after safe cleanup.

**Confidence:** high from the unguarded `?`; failure path not executed.

### C5 — High: deletion timeout detaches destructive work, permitting overlapping retries

**Evidence:** `manager.rs:601-606,632-641`; `profile.rs:383-392`.

`timeout(spawn_blocking(delete_user_data))` drops the join handle on timeout; the blocking deletion continues. No handle/in-flight deletion state is retained. An immediate retry of the same operation can delete/recreate, clear the tombstone and admit a fresh browser while the first recursive deletion still runs. Old work can then remove files from the new credential directory.

**Correction:** keep ownership of the single deletion worker after the HTTP/operation deadline; retries observe/join that worker, never start another or reopen the profile until it has actually settled. Test a deliberately blocked deletion and repeated same-operation retries.

**Confidence:** high about detached blocking work; overlapping-directory damage is an unexecuted race scenario.

## Warnings — SHOULD FIX

1. **Shutdown lacks admission gate/cancellation ordering.** `manager.rs:119,146` stores but never observes its cancellation token; `ensure_running` has no shutdown check. `shutdown_all` snapshots instances and later resets global count to zero (`:683-700`), so concurrent launches can miss the snapshot or invalidate accounting. `main.rs:1285-1290` disposes artifacts before Browser shutdown; no manager-owned attachment/input cancellation precedes termination. Gate at shutdown signal, cancel dependent Browser activity, then stop processes before artifact disposal. Current shutdown tests call the manager directly, not signal/drain integration.
2. **Restart-required helper is not integrated.** `config.rs:475-490` has only test callers (repository search). Reload publishes new config (`api/config.rs:1131-1168`) while manager retains its construction-time clone (`state.rs:390-394`); no `restartRequired` response/status is emitted. An operator can disable/change Browser settings successfully in config while the active manager silently uses old settings. Implement the specified reload notification/fence; do not hot-swap profiles.
3. **Capabilities overstate qualification; configuration raises the immutable ceiling.** `config.rs:552-555,623-628` equates Unix + executable permissions with `engine_qualified: true`, without binary/version qualification evidence. `:18-19,173-179` allows a 1 GiB payload ceiling despite contract §3's 128 MiB ceiling. Expose truthful qualified status and enforce immutable protocol ceiling; keep unqualified deployment bounds explicit.
4. **Restricted persistence is best-effort rather than enforced.** `profile.rs:252-284,322-331,354-363` ignores chmod failures and only restricts newly created directories, leaving existing permissive paths unchanged. Newly absent profile-root validation checks only parent directory type (`config.rs:378-390`). Create with restrictive modes, validate existing hierarchy, propagate permission failures. Use the repository's durable/restricted I/O patterns rather than claiming enforced permissions from best-effort chmod.
5. **Cycle 3 branches have no meaningful regression proof in assigned tests.** Diff changes only initialize new fields to `None`. No assigned test exercises persisted PGID recovery, failed crash containment, concurrent capacity reservation, metadata read/save failure, or cancellation. Shutdown test claims descendant proof but only checks leader PID (`browser_host_shutdown.rs:179-185`); its timeout test prewrites a tombstone and starts no Browser (`:198-232`). Browser absence returns test success via early return (`lifecycle.rs:355-362,402-409`; `shutdown.rs:128-134`). Report these as skips/unverified, and test actual failure boundaries.

## Suggestions — NICE TO HAVE

- Centralize process-slot ownership, durable lifecycle transitions and reset worker ownership to prevent per-path accounting/fence drift; avoid introducing a second lifecycle convention.
- Use the otherwise-unused persisted PID as one component of validated recovery identity, not as standalone authority.

## Positive observations

- Stable hashed principal layout separates dev/prod and keeps lock/intent outside `user-data`.
- CAS admission removes the previous load/increment oversubscription race on the normal path.
- New explicit lock/directory/metadata-save failures release their process reservation.
- `try_is_alive` uses owned child status instead of PID-only liveness; crash termination failure now retains the in-memory lock.
- Restart-reset path requires ESRCH before proceeding with deletion when PGID exists; unproven group absence retains the reset fence.
- AppState construction remains lazy; default Browser disabled; no product/test edits performed by review.

## Completeness against Phase 02

| Task | Review disposition |
|---|---|
| configure-browser-host | Implemented baseline; incomplete reload/qualification/ceiling guarantees (warnings 2–4). |
| manage-principal-profiles | Incomplete safety/recovery acceptance (C1–C5). |
| integrate-host-lifetime | Lazy construction present; failed-containment durability, shutdown cancellation/admission and true descendant/timeout proof incomplete (C2, warning 1/5). |

Existing checked tasks/previous approval are historical claims, not Cycle 3 verification. Plan/task state intentionally unchanged under this assignment's no-tracking/file-ownership constraint. Main owns disposition and any reopening.

## Validation commands and verified results

Executed review-only commands:

- `git diff --stat -- <13 assigned paths>` — exit 0; six modified files, 151 insertions / 42 deletions.
- `git diff -- server/src/browser_host/{manager.rs,profile.rs,process.rs,mod.rs} server/tests/{browser_host_lifecycle.rs,browser_host_shutdown.rs}` — exit 0; inspected remediation and test changes.
- Specialized reads/searches — inspected current code and helper/cancellation callers; results cited above.

**No build, lint or test run by this reviewer.** Single integration/test owner retains execution; no fresh runtime pass count claimed. Earlier 221-test plan ledger is not current verification. Type/test coverage and lint counts unmeasured.

Commands for integration owner/tester:

```sh
cargo check --manifest-path server/Cargo.toml --all-targets
cargo test --manifest-path server/Cargo.toml config -- --nocapture
cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_process --test auth_no_auth -- --nocapture
```

Existing commands alone do not prove C1–C5 regressions until meaningful failure-boundary coverage exists. Real Chromium restart/storage/descendant and SIGTERM/drain behavior remain separate runtime gates.

## Unresolved questions

- No missing repository information blocks these findings. Current-cycle tester output and real restart/failure-boundary evidence were not supplied to this reviewer; Main must attach exact results before any acceptance claim.
