# Phase 01 backend authority/lifecycle review

## Score: 6/10

Substantial improvements: verified-listener admission; shared exact Origin checks; trusted ws/wss discovery; atomic ticket admission; native single-flight/Closing/Lost ownership; synced reset markers and tombstone recovery; conservative unsent-Bearer logout. Four core tasks **not ready for technical closure**. Windows remains intentionally blocked/fail-closed, not a finding. Plans/product code untouched; only this report written.

Source-backed review, not runtime reproduction. Failure schedules below are **[INFERENCE]**; confidence stated per finding. No P0 established.

## Critical issues / merge blockers

1. **P1 — Recovered process groups still signalled by reusable number.** `server/src/browser_host/process.rs:1274-1308,1390-1402,1446-1459`. Inspection verifies a group, returns a bare PGID, then `signal_tree` calls `killpg`; the group can disappear and its number be reused between inspection and signal. Only strays use pidfds. Ordinary termination also signals an unverified watcher PID and PGID (`:727-742`; Drop `:843-854`), including after `try_is_alive` has reaped the leader. Impact: unrelated same-user process termination; violates never-signal-reused-PID requirement. **Fix:** retain verified per-process handles and signal through pidfds, re-inventory descendants until absence; remove unverified watcher/group signalling paths. Existing different-start-time test (`server/tests/browser_host_process.rs:970-983`) covers mismatch before inspection, not reuse after inspection. **Confidence: high.**

2. **P1 — Final handoff is not atomic with current native/reset/deadline authority.** `server/src/browser_debug/store.rs:828-908`; `server/src/browser_host/selection.rs:615-625`; `server/src/state.rs:793-839`; supporting `server/src/pty/manager.rs:2098-2137`. Holding the selection read guard postpones navigation bookkeeping while final DB checks await; it cannot postpone Chromium's navigation. The new regression actually queues native navigation before final validation, then expects successful stale handoff (`server/tests/browser_host_selection.rs:1480-1503`). Separately, the final deadline/epoch predicate runs **before** `write_if_incarnation` acquires its synchronous PTY mutex; that acquisition can block while deadline passes or another worker advances reset epoch. No `.await` is not a cross-thread fence. **Fix:** publish observed navigation invalidation independently of the blocked cleanup lock; perform final authority/deadline check inside the PTY mutation boundary after its lock wait, retaining shared lifecycle guards through mutation. Add native-navigation-during-auth and PTY-lock/reset/deadline barriers. **Confidence: high.**

3. **P1 — Cancelled persisted artifact writes still forget denied unlink.** `server/src/browser_debug/store.rs:1303-1323,1385-1397`. `WriteCancellationGuard` and the blocking writer's cancelled branch discard `remove_file` errors and drop quota, bypassing the new retained `PendingSink`. Abort after `persist_noclobber` plus denied unlink leaves private JSON/PNG untracked and uncharged; reset cannot discover it. The cancellation regression (`server/src/browser_debug/tests.rs:665-722`) only exercises successful unlink. **Fix:** use the same charged, owner-qualified retained cleanup on every cancellation branch; test post-persist abort with denied unlink, then retry/reset. **Confidence: high.**

4. **P1 — Reset's purge can miss artifact operations already in flight.** `server/src/browser_debug/store.rs:711-725,736-750,298-326,458-470,947-979`. Delete/invalidate removes metadata before awaiting unlink; pending ownership is registered only after a failure. Reset can fence/snapshot during that gap, see neither an entry nor pending cleanup, and complete before the failed operation reinserts/registers its private file. A still-running pre-publication writer is likewise absent from both sets. `server/src/api/browser_host.rs:1591-1602` only retries what the snapshot saw. **Fix:** transfer cleanup ownership under the entry lock **before** any I/O await, retain in-flight write ownership, and drain the principal's pre-fence operations before declaring purge complete. Existing denied-unlink reset test (`server/tests/browser_host_logout.rs:1382-1491`) starts with a published idle artifact, not these interleavings. **Confidence: high.**

## Warnings

- **W1 / P1 — Refused native pages lose cleanup ownership after ambiguous close.** `server/src/browser_host/manager.rs:2239-2261,2277-2278,2608-2611`. Pending-close identity is removed before attempting close; `Unconfirmed` only logs. The rejected page has no registry slot, no retry is scheduled, and later observations return `Rejected` immediately. Inject one overflow close failure: a retained native page survives outside the cap; subsequent logical admission can reuse capacity. Keep rejected pages charged/Closing and retry until positive absence. Current overflow regression (`server/tests/browser_host_admission.rs:1237-1254`) only exercises successful close. **Confidence: high.**
- **W2 / P1 — Worker HTTP policy explicitly fails open.** `server/src/browser_host/screencast.rs:1112-1129`. Failed worker/service-worker interception still resumes execution (`!strict`), explicitly leaving requests unpoliced. Ordinary page-created worker fetches are not the documented raw-CDP/WS/WebRTC/DNS exceptions; this does not satisfy Phase 01's browser-initiated HTTP policy. Install a supported worker request-policy path, or deny/terminate workers whose interception cannot be established. Add actual worker/service-worker forbidden-destination observations; redirect/image coverage alone is insufficient. **Confidence: high for fail-open branch; exact engine reachability unexercised.**
- **W3 / P2 — Auth concurrency ceiling reintroduces serial revocation windows.** `server/src/browser_host/attachments.rs:632-681,709-721`. Semaphore wait occurs outside the two-second timeout. With more than 64 distinct live identities, checks run in batches, and the supervisor waits for the entire round before starting another. Control-only connection admission has no corresponding identity bound (`:380-486`). Thus the advertised independent 5s/7s window is not guaranteed. Bound admitted identities to the checking capacity or include queue wait in an absolute per-round deadline with fail-closed cancellation. Test covers four slow identities (`server/tests/browser_host_auth.rs:596-653`), not saturation. **Confidence: high.**
- **W4 / P2 — Initial metadata writes still happen outside flock.** `server/src/browser_host/manager.rs:326-328,368-369`; `server/src/browser_host/profile.rs:456-477`. Instance/capability lookup calls `load_or_init_metadata` before acquiring the retained profile lock. Two first-use processes can both observe missing metadata; a delayed default-metadata rename can overwrite the other's already-persisted launch intent/identity. Acquire flock for initialization and use read-only capability inspection; all metadata mutation belongs to the same lock owner. **Confidence: medium-high; first-initialization race unexercised.**

## Suggestions

- Consolidate artifact terminal paths around one cancellation-safe ownership transfer; current delete/reinsert, invalidate/pend, expiry/reinsert and writer-drop cleanup conventions caused C3/C4. Reuse the existing store, not another registry.
- Keep request-policy overflow fail-closed, but retire/recover the affected producer instead of merely logging and leaving dropped paused requests permanently stuck (`screencast.rs:1062-1067,1132-1133`).
- Keep blocking profile fsync and full `/proc` scans off Tokio workers/hot locks (`profile.rs:426-452`; `process.rs:1191-1242,1424-1429`); preserve the retained lock/identity across blocking work. Avoid rereading every process environment/cmdline every 50ms where one bounded snapshot suffices.
- Split manager native observation, session admission and artifact cleanup into existing-domain modules when fixing defects; current manager/session/media/selection files substantially exceed the 200-line guideline. Do not add framework/service abstractions merely to meet line count.
- Retain current successful security cutovers; add adversarial boundary tests above, not more predicate-only assertions. Maintained docs/changelog remain Phase 04-owned; no plan/task status edits in this read-only review.

## Reviewed files

Deep production paths / changed sections:
- `server/src/browser_host/{auth,attachments,config,network_policy,cdp,cdp_gateway,manager,process,profile,session,media,screencast,selection}.rs`
- `server/src/api/{auth,browser_host}.rs`, `server/src/browser_debug/{store,tests}.rs`, `server/src/{state,main}.rs`
- `packages/ui/src/api/{auth-client,auth-client.test}.ts`

Selected regression sections / changed hunks:
- `server/tests/browser_host_{admission,auth,gateway,lifecycle,logout,process,selection,shutdown,platform,media,input,security}.rs`
- `server/tests/browser_debug_artifacts.rs`

Supporting evidence: `server/src/{pty/manager,api/router}.rs`; phase overview + Phase 01 plan; prior LA L1–L14 and OSQ S1–S4/L1 reports; original architecture contracts; README, PDR, code standards and browser architecture. Coverage is scoped, not a whole-repository audit.

## Validation commands/results

- Executed read-only `git diff --stat`, `git diff --name-only`, scoped `git diff -- <paths>`; 34 changed files, +12,641/-2,261 at initial inspection. Source/range/search inspection only afterward.
- No build, test, lint, formatter, install or runtime probe run; no Git-state changes.
- Caller-reported prior results: browser_host suites **182/182**, lib **1465** passing; not independently rerun or evidence that the above schedules passed. Coverage percentages unavailable.
- Main-agent validation needed after repairs: identity-reuse-after-inspection; PTY-lock final authority; cancelled/unpublished artifact cleanup versus reset; overflow close failure; worker policy; >64-identity supervisor saturation; simultaneous fresh-manager initialization. Existing suites passing does not replace these missing oracles.

## Unresolved questions

- None needed to establish the source findings. Listed race/engine schedules remain unexecuted evidence gaps.
- Native Windows implementation/proof and downstream platform/human/soak qualification remain separately blocked/pending, intentionally not counted as Phase 01 Linux defects.
