# Phase 02 fresh code review — Managed Lifecycle and Principal Profiles

## Score: 3/10 — changes required

Good module boundaries, stable external lock layout and conservative launch flags. Core lock ownership, reset durability, crash recovery and shutdown guarantees remain broken. Prior Phase 02 approval not supported by current source.

Review is read-only except this report. Product code, tests and plan/task status unchanged. Findings below are source-backed; described race/fault outcomes are **[INFERENCE]**, not freshly reproduced runtime results.

## Reviewed files and coverage

All 13 requested files reviewed; relevant sections ~3,800 LOC:

- `server/src/config/schema.rs:570-675`, `parser.rs:16-76,598-642`, `global.rs:10-168`, `tests.rs:2280-2443` — schema, persistence, validation, reload expectations.
- `server/src/browser_host/config.rs:1-632`, `manager.rs:1-640`, `profile.rs:1-386`, `process.rs:1-938`, `mod.rs:1-13` — principal isolation, locks, lifecycle, reset, containment, arguments.
- `server/src/state.rs:130-131,385-438`, `main.rs:1198-1314` — construction and shutdown.
- `server/tests/browser_host_lifecycle.rs:1-442`, `browser_host_shutdown.rs:1-248` — behavioral coverage and proof limits.

Supporting evidence: phase specification, overview, architecture contracts §§1–3/11, acceptance matrix A28/A30/A34, README, PDR, code standards; read installed `code-review` skill and development rules. Narrow caller inspection: `server/src/api/config.rs:36-109,1131-1169`, `server/src/api/browser_host.rs:998-1058`. No findings assigned to those callers as independently owned Phase 03 work.

### Phase acceptance assessment

| Area | Assessment |
|---|---|
| Principal hashing / dev namespace | Implemented; filesystem hardening incomplete |
| Stable lock inode outside deleted data | Correct layout; lifetime enforcement fails |
| Lazy construction / no launch during capabilities | Implemented |
| Reconnect existing live process | Happy path implemented; death detection incorrect |
| Durable idempotent reset / recovery | Incomplete; unsafe failure/restart paths |
| All-descendant proof before deletion | Only in current-process happy path |
| Shutdown 10s / recoverable failure | Incomplete; errors discarded, no admission fence |
| Executable qualification / hard memory ceiling | Not enforced truthfully |
| Restart-required configuration reporting | Helper exists, no runtime integration |
| Secrets in managed process arguments | No bearer, ticket or credential values supplied by inspected manager launch path |

## Critical issues — MUST FIX

### C1. Reset releases the live profile lock on rejected or failed requests

**Evidence:** `manager.rs:415-418` removes the lock from `inst._held_lock` into a local. Early returns at `423-449`, `479-519`, and subsequent error paths drop it without restoring ownership. `profile.rs:157-165` explicitly unlocks on drop.

**Failure / impact:** Start a browser, send a stale-epoch reset: operation rejects but the browser remains alive with no manager advisory lock. Retrying an old completed operation after a new browser launch also unlocks the running instance. Simulated kill failure does the same while explicitly retaining a live process. Another manager can then acquire the same stable inode during active use. This is not fixed by retaining the lock file itself.

**Correction:** Keep the lock in the instance through validation, running, reset and cleanup-pending states. Borrow/reuse it rather than transferring it to a request-local variable; release only after verified stop and no continuing worker. Add cross-manager lock assertions after stale epoch, duplicate operation, metadata error and kill failure. **Confidence: high.**

### C2. Restart/retry can delete credentials without proving the old process tree exited

**Evidence:** `profile.rs:44-52` persists subject/epoch/incarnation but no process start identity or descendant containment identity. `manager.rs:175-194` reconstructs instances with `process: None`; `492-521` only terminates a present process; `523-546` proceeds directly to deletion otherwise. Termination errors also consume the process handle via `take()` before returning pending.

**Failure / impact:** After server crash or an unproven termination, a matching reset retry sees no process handle and treats that as sufficient to delete. The old death-pipe watcher may still be terminating descendants, or termination may have failed; neither absence of a handle nor ownership of a released advisory lock proves browser exit. There is no startup reconciler or persisted identity verification before relaunch either. Violates A28 and reset delete-after-exit contract.

**Correction:** Persist verifiable process/containment identity before exposing the instance; reconcile under the stable lock. Retain process ownership on failed termination. On restart, prove the exact prior tree gone or remain `CleanupPending`; never adopt a foreign process or equate `None` with exit proof. **Confidence: high.**

### C3. Timed-out deletion continues after the lock is dropped

**Evidence:** `manager.rs:541-546` times out a `spawn_blocking(remove_dir_all)` join handle. Timeout at `572-581` returns pending, dropping the local profile lock. The blocking task owns only a cloned profile, not the lock or an operation fence.

**Failure / impact:** Tokio cannot cancel an already running blocking closure by dropping its join handle. A retry or second manager can delete/recreate/start while the original recursive delete still operates on the same tree; newly created browser data can be removed. Shutdown can also wait on an untracked blocking task beyond the advertised deletion deadline.

**Correction:** Manager-owned cleanup worker retains the lock and tracked join handle until actual completion. Deadline changes externally visible status only; retry observes/resumes that worker, never starts overlapping deletion or relaunch. **Confidence: high.**

## Additional high-priority findings — MUST FIX

### H1. Reset persistence is not a durable, coherent epoch transaction

**Evidence:** `manager.rs:452-469` writes tombstone then separately writes metadata. Resume at `432-436` uses the tombstone epoch without reconciling `meta.profile_epoch` or `inst.profile_epoch`. Final completion ignores `save_metadata` failure at `603-605` before clearing the tombstone. `profile.rs:307-356,359-364` uses write/rename/unlink without file or directory sync. Epoch increment saturates at `manager.rs:452`.

**Failure / impact:** Fault between intent and epoch writes can be resumed, deleted and marked completed with the *old* epoch still authoritative. Final metadata failure can erase retry identity while reporting completion. A crash/power loss can lose claimed durable intent/completion. At u64 exhaustion reset reuses an epoch instead of retiring identity. Separately, cached epoch is loaded before acquiring the profile lock (`175-190,302`) and never refreshed on launch (`331-350`), so another manager's completed reset can leave stale handles.

**Correction:** Under lock, atomically persist one coherent operation/epoch state, sync file and containing directory, reconcile interrupted states deterministically, propagate completion-write errors, refresh cached identity from locked metadata, and reject/retire exhausted epochs. Test faults at every commit boundary. **Confidence: high.**

### H2. Crash detection mistakes an unreaped dead child for a live browser

**Evidence:** `manager.rs:255-269` tests only `kill(pid, 0)`. There is no child `try_wait`/exit monitor. A child is waited only in `process.rs:665-666`. The dead-process branch (`manager.rs:279-287`) drops the process/lock and transitions straight to Dormant without awaited descendant proof; `process.rs:735-748` drop only sends signals.

**Failure / impact:** A crashed browser leader remaining a zombie passes `kill(pid,0)` and returns an obsolete endpoint/incarnation indefinitely. If the dead branch is reached, relaunch is permitted after signal delivery rather than verified group exit. No `Recovering` transition implements the contract's proof requirement.

**Correction:** Expose child exit observation through the supervisor; drive crash recovery from actual exit status, await contained-tree cleanup while retaining the lock, invalidate resources, then relaunch with fresh identity or remain pending. **Confidence: high.**

### H3. Global process admission is a check-then-act race

**Evidence:** `manager.rs:293-299` loads a global count, but only increments after launch at `341`; per-instance mutexes differ across principals.

**Failure / impact:** Two simultaneous different-principal starts both observe zero and both launch despite default capacity one. Reservation is absent during the full startup interval. Failed/unproven termination also releases count before exit proof (`369,494`).

**Correction:** Acquire a non-queued RAII global process permit before launch, retaining it through verified teardown. Capacity failures return typed busy immediately. Test concurrent principals and slow startup. **Confidence: high.**

### H4. Shutdown has no lifecycle admission fence and suppresses cleanup failure

**Evidence:** Constructor supplies an otherwise unused cancellation token (`state.rs:390-394`; `manager.rs:119,146`). `shutdown_all` snapshots instances and serially terminates them, discards all results and unconditionally sets Dormant/count zero (`620-638`). It does not write failure tombstones. `ensure_running` never checks shutdown. `main.rs:1247-1254` is a 10s HTTP connection-close timer, not a browser cleanup deadline; browser teardown occurs only after HTTP drain and artifact disposal (`1283-1290`).

**Failure / impact:** Starts can race the shutdown snapshot. Failed/unproven termination is represented as clean dormant state without recovery evidence; configured multiple processes get separate serial 10s allowances. Calling shutdown then ensure on an existing entry can also self-contend on the retained lock. Current timer does not establish the phase's bounded browser-shutdown guarantee.

**Correction:** Atomically close admission before drain, cancel owned work, stop/reap processes under one explicit lifecycle deadline, preserve lock/identity and persist cleanup pending on failure, dispose artifacts after Browser invalidation. Keep unrelated PTY policy unchanged. **Confidence: high.**

### H5. Capability qualification is inferred from file executability, not engine qualification

**Evidence:** `config.rs:552-555` treats all Unix as supported; successful executable permission checks lead directly to `available: true, engine_qualified: true` (`595-630`). Disabled configuration even reports `engine_qualified: true` (`571-580`). No version/hash/qualification lookup exists in this evaluator. `ensure_running` checks only `enabled` (`manager.rs:238-240`), not validated capability state.

**Failure / impact:** An executable unrelated to the qualified Chromium build can be advertised as qualified. Unsupported engine acceptance from phase step 57/60 is not met. Direct manager callers can bypass configuration validation entirely.

**Correction:** Resolve capabilities against an explicit qualified engine/platform receipt or bounded qualification identity check; unknown engine remains unavailable. Enforce validated availability at launch, not merely in an optional probe. **Confidence: high.**

### H6. Configuration can raise the immutable Browser payload ceiling eightfold

**Evidence:** `config.rs:18-19,173-179` accepts up to 1 GiB, rather than the contract's 128 MiB global safety ceiling. Tests explicitly accept 256 MiB (`config/tests.rs:2393,2412`).

**Failure / impact:** Raising configuration beyond protocol safety ceilings is accepted without contract/version review or requalification. Advertised limits no longer preserve the frozen resource bound.

**Correction:** Cap configured payload reservation at 128 MiB; reject combinations exceeding it. Larger deployments require explicit contract/requalification work, not an ordinary config override. **Confidence: high.**

## Warnings — SHOULD FIX

1. **Medium — restart-required reporting is dead code.** `config.rs:475-490` helper is called only by tests; manager stores an immutable construction snapshot (`state.rs:390-394`). Config reload publishes new settings without updating the manager or reporting restart (`api/config.rs:108-109,1137-1169`). Disabled/new-path config can disagree with the still-active manager. Wire restart-required state into the existing reload convention and report effective versus pending settings; never hot-swap credentials. Confidence high.

2. **Medium — restricted filesystem layout is not enforced on existing paths.** `profile.rs:245-279` skips checks on existing directories and ignores chmod failures; path symlinks/ownership are not verified. Metadata permissions are changed only after writing and errors ignored (`315-320,347-352`); lock creation sets no explicit mode (`93-99`). A new configured root is accepted when absent (`config.rs:379-389`) but profile creation does not chmod that root, so ordinary umask 022 can subsequently make the same configured root fail validation. Non-Unix `try_acquire` returns success without locking (`profile.rs:124-130`). Use restrictive create modes, reject unsafe existing paths, fail on permission errors, and explicitly fail closed where a real lock is unavailable. No same-account hostile-tenant isolation claim requested. Confidence high.

3. **High — startup cancellation leaves raw ownership outside RAII.** `process.rs:282-311,443-566` holds raw death-pipe write descriptors across the endpoint-discovery await; conversion into owned `File` occurs only at `591-594`. The manager's outer 15s timeout (`manager.rs:313`) can cancel this future before its explicit error cleanup runs. Group guard signals KILL, but leaked write fd keeps the separate watcher waiting and consumes resources. Make pipe descriptors and watcher cleanup cancellation-safe from creation; retain ownership until verified cleanup. Confidence high.

4. **Medium — failure tests do not prove their names/acceptance.** Shutdown timeout test (`browser_host_shutdown.rs:198-248`) manually seeds a tombstone, never starts a process and never forces a shutdown timeout. Its manager has no instance entry to shut down. Kill/delete failures use booleans before real failure paths (`browser_host_lifecycle.rs:203-277`); live-browser tests return success on missing engine (`352-359,398-405`; shutdown `128-135`). Cookie tests write marker files rather than demonstrating real cookie persistence across restart. Add mandatory real-engine qualification plus deterministic fault/race tests; distinguish unavailable prerequisites from passed behavior. A28/A30 not established by current suites. Confidence high.

## Suggestions — NICE TO HAVE

- Redact/remove derived `Debug` on `BrowserInstanceHandle` (`manager.rs:88-97`), which contains a raw debug endpoint and profile path. No actual logging leak found, but accidental diagnostic formatting would expose them.
- Replace production-public simulation switches and underscore-prefixed unused resource counters with a narrow injected fault boundary when adding required failure coverage; avoid maintaining two independent resource authorities.
- Keep modules focused when repairing lifecycle ownership; a small explicit transition/operation owner is preferable to more ad hoc booleans. Do not add a general task engine or waiter queue.

## Positive observations

- SHA-256 principal paths and separate `prod`/`dev` namespaces prevent subject path traversal (`profile.rs:181-192`).
- Lock, manager metadata and tombstone are outside `user-data`; recursive credential deletion targets only `user-data`.
- Explicit executable resolution, default sandbox/TLS protections, random debug port and allowlisted arguments preserved (`process.rs:85-105,249-267,769-798`). Inspected managed launch passes only profile path, safe flags and `about:blank`; no auth/session tokens.
- Endpoint formats and discovery data are bounded; routine launch log omits raw endpoint (`process.rs:156-195,583,823-935`).
- AppState construction is lazy; capability DTO does not launch Chromium or expose its debugger address.

## Validation commands and verified results

**This review:** static inspection only; no compile, tests, linters, formatter or smoke commands run, avoiding overlap with the main agent's designated test owner. No fresh runtime pass claims.

Executed `git diff --stat -- <13 assigned paths>`: exit 0; only current uncommitted scoped delta shown was one added line in `browser_host/mod.rs`. Therefore reviewed current committed implementation as well as working-tree module registration, not just that one-line diff.

Historical record inspected: `plans/reports/tester-261108-1838-phase-02-principal-profiles-clean.md:20-28` reports 221 passing / two ignored across six targets. Not re-executed or adopted as fresh proof; those tests omit the fault/race cases above.

**Main/test-owner commands recommended (not executed here):**

```sh
cargo check --manifest-path server/Cargo.toml --all-targets
cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture
cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture
cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture
cargo test --manifest-path server/Cargo.toml config -- --nocapture
cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture
```

Required additional observations: rejected-reset retains cross-manager lock; restart with surviving descendants blocks delete/relaunch; timed-out deletion cannot overlap retry; crash after each durable-write boundary preserves epoch; simultaneous principal startup respects one-process cap; actual child crash is detected; shutdown deadline/failure yields a recoverable tombstone; real cookie survives ordinary restart then disappears only after proven reset.

### Metrics and disposition

- Findings: 3 critical + 6 high MUST FIX; 4 warnings (including one additional high cancellation issue); 3 suggestions.
- Type coverage: not measured; Rust-only review. Runtime test/line coverage and fresh lint counts: not measured.
- Existing checked Phase 02 tasks were not edited under read-only ownership. Main should reopen lifecycle/configuration/integration acceptance rather than carry forward the prior approval.

## Unresolved questions

- No user decision needed. Fresh runtime results and the fault/race/real-cookie evidence above remain unobserved in this review; designated main/test owner must supply them.
