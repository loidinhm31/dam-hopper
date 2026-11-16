# Phase 01 — cycle 3 final review

## Score: 7/10 — changes required

Material repairs; Linux backend-core technical closure still blocked. **No P0 demonstrated; five P1 findings below.** Windows containment intentionally blocked/fail-closed: not a defect. Read-only source review; only this report written, no plans/task-state edits. Failure schedules are **[INFERENCE]**, not runtime reproductions.

## Critical issues / merge blockers

### C1 / P1 — Older-kernel watcher can pin and kill members of a recycled group
- **Evidence:** `server/src/browser_host/process/death_watcher.rs:253-280,401-406`.
- `scan_signal` checks the leader incarnation once, before traversing `/proc`. After that check, the original group can empty and its number become a new group's number. New members satisfy `pgrp == leader_pid` and `start >= leader_start`; opening/rechecking their pidfds proves their identity, **not membership in the original launch**. They are then signalled. Holding the old leader pidfd does not reserve its numeric PID indefinitely.
- **Impact:** unrelated same-user processes killed on the MemberScan fallback. Modern group-object signalling repairs the original shell issue, not this fallback race. **Confidence: high.**
- **Correction/oracle:** prove launch ownership for each pinned member independently of the reusable group number, or fail closed where stable ownership cannot be established. Test reuse **after** the initial leader check, not merely an already-mismatched leader. Linux [`free_pid`](https://github.com/torvalds/linux/blob/master/kernel/pid.c) removes the numeric IDR mapping independently of final `put_pid`; [`pidfd_send_signal`](https://github.com/torvalds/linux/blob/master/kernel/signal.c) explains why the modern group-object branch avoids that lookup.

### C2 / P1 — Failed temp-file publication still forgets denied unlink
- **Evidence:** `server/src/browser_debug/store.rs:1610-1629,1672-1694`; contrast explicit retained cleanup `:1635-1647`. Locked `tempfile 3.27.0`: `src/file/mod.rs:402-406,516-520,821-831` in the local Cargo registry.
- Change the artifact directory to mode `0500` after the temporary file is written, without cancelling the caller. `persist_noclobber` fails; `map_err` discards `PersistError.file`. Its destructor silently ignores the denied unlink. Earlier `set_permissions`/write/fsync `?` exits likewise rely on best-effort temp destruction. No published path/pending entry records that file; outer quota/in-flight ownership disappears.
- **Impact:** private JSON/PNG temp files become untracked/uncharged; principal purge can report clean. The repaired cancellation/discard paths do not cover ordinary I/O failure. **Confidence: high.**
- **Correction/oracle:** retain explicit ownership of the temp and charge through every error exit, including `PersistError.file`; use the existing `PendingSink`. Add non-cancelled publication failure + denied unlink, then purge/retry/quota assertions.

### C3 / P1 — Normal MFA rotation bypasses the new handoff revocation epoch
- **Evidence:** `server/src/api/auth_mfa.rs:927-1003,1076-1159`; `server/src/auth/policy.rs:132-136`; `server/src/browser_debug/store.rs:939-954,1116-1144`; `server/src/state.rs:695-710,822-847`. Repository search finds epoch publication only in targeted Browser revocation and managed-artifact principal fencing.
- A handoff passes async credential-version validation and parks on PTY. Complete normal StepUp MFA meanwhile: `advance_session_mfa` supersedes the old credential version, but publishes no Browser epoch. Release PTY before the old deadline: incarnation/navigation/epoch predicates remain true and the old credential's handoff writes. StepUp initiation does not require the old MFA deadline already to have expired.
- **Impact:** a credential explicitly invalidated by an ordinary server route still authorizes publication. This is **not** the accepted DB-direct demotion limitation. **Confidence: high.**
- **Correction/oracle:** publish the same synchronous fence for successful credential rotation before returning the replacement token. Test the real StepUp route after async handoff validation while PTY is held; no extra DB work under PTY.

### C4 / P1 — Surviving-worker escalation has no durable containment owner
- **Evidence:** `server/src/browser_host/screencast.rs:1256-1265,998-1020`; producer retirement `server/src/browser_host/media.rs:83-91`; native departure `server/src/browser_host/manager.rs:1943-1949`. Current escalation regression `screencast.rs:1542-1566` checks command presence only.
- After worker termination cannot be proven, escalation first awaits closing its page, then sends `Browser.close`. Native page destruction can remove the last producer and abort its interceptor **during that first await**, before browser closure is requested. Independently, a `Browser.close` rejection/queue-admission failure merely logs and returns; the running unpoliced worker has neither a manager-owned termination obligation nor a retry.
- **Impact:** the worker the fail-closed branch was meant to contain can survive. Successful `Browser.close` also closes every sibling page of this principal; that blast radius must be reconciled as one incarnation failure, not just one retired page. **Confidence: high for missing error ownership; medium-high for the abort schedule.**
- **Correction/oracle:** transfer the incarnation fence/termination obligation to the existing manager before closing the producer's page; retain it until containment is proven. Test last-producer removal during escalation, rejected/saturated `Browser.close`, and sibling retirement/late-create rejection.

### C5 / P1 — Raw getdents parser forms an out-of-bounds array reference
- **Evidence:** `server/src/browser_host/process/death_watcher.rs:203-228`, especially `:223`; locked `libc 0.2.184`, `src/unix/linux_like/linux_l4re_shared.rs:315-320` defines `d_name: [c_char; 256]`.
- `getdents64` returns variable-length records. `(*entry).d_name.as_ptr()` implicitly borrows the full 256-byte array, although a short final record near the end of the 4096-byte allocation has no such array in bounds. Reading only a short numeric name afterward does not make that reference valid.
- **Impact:** undefined behavior in the older-kernel containment helper under ordinary full-buffer `/proc` scans. No observed crash claimed. **Confidence: high.**
- **Correction/oracle:** parse a bounded record byte slice, or use raw field-address formation without creating the array reference; bound header/reclen/name traversal to returned bytes. Exercise a short last record at the allocation boundary. Preserve allocation-free post-fork execution.

## Warnings

- **W1 / P2 — Delayed cleanup can disable a newer picker.** `selection.rs:666-681,1031-1045,1336-1347,1455-1463`. Park old artifact unlink; start a new interactive picker; release unlink. Old cleanup blindly sends `Overlay.setInspectMode(mode:none)` to the current page session, leaving the new logical selection active but native picking disabled. Fence overlay teardown by the captured selection generation; do not let obsolete cleanup mutate the current picker. **Confidence: high; schedule unexecuted.**
- **W2 / P2 — New cleanup queue is unbounded and detached from shutdown.** `selection.rs:1336-1347,1399-1406`; `main.rs:1315-1317`; artifact disposal `browser_debug/store.rs:1072-1088`. Every navigation with an existing selection entry queues a record, including empty invalidations; one slow unlink/CDP cleanup allows unlimited queued work. The worker retains `AppState`, has no retained join/shutdown handle, and may continue after artifact disposal/session teardown. Coalesce empty/obsolete overlay work, bound retained obligations without blocking event publication, and give the existing lifecycle owner a drain signal. **Confidence: high for queue/lifetime; shutdown outcome unexecuted.**
- **W3 / P2 — Denied paused children remain indefinitely.** `screencast.rs:1234-1254`. Failed page-owned paused interception returns without retirement; service/shared workers that resist closure also remain paused with no tracked retry. Never resuming is safe for execution, but not bounded resource recovery. Preserve denied state while assigning cleanup/retry to an owner. **Confidence: high.**

## Prior cycle findings disposition

| Cycle 2 item | Inspected disposition |
|---|---|
| C1 shell numeric group TERM/KILL | Shell removed; modern kernel branch uses pinned group object. Older-kernel ownership C1 and parser C5 remain. |
| C2 auth/browser final predicate | Logout/device revoke epoch and exact browser incarnation now checked inside PTY authorization. Ordinary credential rotation remains C3. |
| C3 explicit-discard cancellation | `cleanup_now` retains path/charge through await; Drop transfers ownership. Original schedule addressed in source. Ordinary failed temp publication remains C2. |
| W1 service/shared worker survival | Exact target close plus inventory proof added; real-engine request-cessation test authored. Escalation C4 and paused retention W3 remain. |
| W2 cancelled handoff worker writes | Cancel-on-drop flag checked inside PTY boundary. Addressed for parked-waiter write; inability to abort blocking mutex wait/guard retention accepted, not reflagged. |
| W3 cancelled registration retirement | `PendingCleanup.selection_notice` transfers to detached removal before unlink. Addressed in source for normal runtime cancellation; no shutdown-drain proof claimed. |
| W4 navigation reader waits on cleanup | Ordered independent cleanup task removes disk/CDP wait from ingestion; parked-cleanup/second-navigation regression authored. New stale-overlay/queue warnings above. |

## Suggestions / security, performance, architecture

1. Close C1–C5 before backend-core technical closure. Extend production-owner boundary tests; passing existing suites does not establish these omitted schedules.
2. Keep one artifact cleanup owner: cover temp I/O errors with existing `PendingSink`/quota ownership, not another registry. Same principle for worker escalation: manager-owned incarnation teardown, not an interceptor-owned shutdown service.
3. No allocation/lock/libc directory-stream use found in inspected watcher `run`/scan bodies; descriptor normalization plus mandatory `close_range` correctly addresses inherited flock/death-writer retention on successful arming. `close_range` failure explicitly rejects launch. Older-kernel support must not imply kernels lacking the required syscalls are qualified.
4. Final authorization is described as non-blocking, but takes short synchronous mutex/RwLock guards. Keep their critical sections tiny; clarify that comment. No deadlock/panic cycle established in inspected production Drop paths; do not add catch-all panic suppression.
5. Maintain focused existing-domain modules; avoid broad refactoring/frameworks during these repairs. Maintained docs/changelog remain Phase 04-owned. No TODO/FIXME/todo!/unimplemented! found in the searched repair owners; unchecked plan boxes intentionally untouched by read-only review.

## Reviewed files

Deep/selected source and changed hunks, **not a complete re-audit of all 38 changed files**:
- `server/src/browser_host/process.rs`, new untracked `server/src/browser_host/process/death_watcher.rs`.
- `server/src/browser_host/{manager,profile,screencast,selection,cdp,media}.rs`.
- `server/src/browser_debug/{store,tests}.rs`; `server/src/{state,main}.rs`; `server/src/pty/manager.rs`.
- `server/src/api/{auth,browser_host,auth_mfa}.rs`; supporting `server/src/auth/policy.rs`.
- Selected regressions: `server/tests/browser_host_{process,selection}.rs`, `server/tests/browser_debug_artifacts.rs`; request-policy tests in `screencast.rs`.
- `packages/ui/src/api/auth-client.ts`; `server/Cargo.lock`; locked tempfile/libc source cited above.
- README, PDR, code standards, Browser architecture, phase overview/Phase 01 acceptance, cycle-1/cycle-2 reports; active development/primary workflows and code-review skill.

## Validation commands/results

- Executed read-only `git diff --stat && git status --short`; initial scope **38 tracked files, +15,934/-2,567**, plus untracked watcher and planning/review artifacts.
- Executed focused `git diff --unified=3 -- server/src/state.rs server/src/api/auth.rs server/src/pty/manager.rs packages/ui/src/api/auth-client.ts` and `git diff --unified=1 -- server/src/browser_host/process.rs server/src/browser_host/selection.rs server/src/browser_debug/store.rs server/src/browser_host/screencast.rs`; source/range/search inspection.
- **No tests, builds, typechecks, linters, formatters, installs, runtime probes or Git mutations run.** Coverage percentages/lint counts unavailable. Advisor consultation unavailable (disabled); no external validation substituted.
- Caller-provided status, not independently exercised: server suite all pass except one unrelated `idle_suspend` timing flake that passes in isolation; Browser-host suites stable over four reruns and under load; UI **3,720 pass**. Preserve that failure qualification; not an all-green server claim.
- Main-agent follow-up commands after repairs: `cargo test --manifest-path server/Cargo.toml --lib`; `cargo test --manifest-path server/Cargo.toml --test browser_host_process --test browser_host_selection --test browser_debug_artifacts --test browser_host_shutdown`; include real configured Chromium and the targeted boundary oracles above. MFA regression should exercise production StepUp, not only flip a mock fence.

## Unresolved questions

- Required oracles unexecuted here: post-check group reuse on fallback; short final getdents record; non-cancelled failed publication + denied unlink; real MFA rotation during PTY wait; producer-aborted/rejected worker escalation and sibling retirement; newer interactive picker versus old cleanup; cleanup drain at shutdown.
- Accepted limits not scored as new defects: DB-direct demotion lacks synchronous publication; cancelled blocking PTY mutex waiter retains guards until released; page-session Overflow loses worker identity.
- Windows native containment/proof and downstream physical/human/soak qualification remain separately blocked/pending; not Linux defects or release approval.
