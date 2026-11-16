# Phase 01 — cycle 2 review

## Score: 7/10 — changes required

Good targeted repairs; not ready for technical closure. Three remaining P1 blockers, plus incomplete worker-policy recovery. Windows containment intentionally blocked/fail-closed: **not a defect**. Product code, plans/task state and Git state untouched; only this report written.

Source review, not runtime reproduction. Failure schedules below are **[INFERENCE]**; confidence concerns source reasoning, not demonstrated exploitation.

## Critical issues / merge blockers

### C1 / P1 — Death watcher still signals a reusable PGID
- **Evidence:** `server/src/browser_host/process.rs:434-478`, particularly shell script `:457`; contrast pinned Rust signalling `:724-742,765-810,1422-1531`.
- Rust teardown/recovery now uses verified pidfds. The separately executing death watcher still issues numeric group TERM, sleeps 500ms, then numeric group KILL. After supervisor death, the browser group can exit and be reaped before the second signal; a recycled group number then belongs to unrelated processes. Parent-held pidfds do not protect the shell's numeric signals.
- **Impact:** unrelated same-user processes can be terminated; prior C1 only partially repaired. **Confidence: high.**
- **Correction:** identity-safe watcher teardown too: retained process handles/verified inventories or containment with stable kernel ownership; no delayed bare group signals. Test owner death plus group disappearance/reuse between TERM and KILL, not merely mismatched start time before inspection.

### C2 / P1 — Final PTY check still lacks live auth and browser-incarnation fencing
- **Evidence:** `server/src/browser_debug/store.rs:839-843,902-940,1062-1081,1131-1135`; `server/src/state.rs:794-840`; targeted revocation `server/src/api/browser_host.rs:1440-1470`. Existing full instance check: `server/src/browser_host/manager.rs:1402-1425`.
- Once async auth passes, the blocking worker can wait arbitrarily for the PTY mutex. The final predicate checks captured deadline, profile epoch and observed navigation, **not** session revocation/demotion/version changes. Targeted logout/revoke cancels attachments/input but does not invalidate this handoff. Revoke the login while its handoff waits for PTY, then release PTY: no final predicate sees that revocation.
- Captured `ArtifactSource::ManagedBrowser.browser_incarnation` is also ignored. A crash removes `live_incarnations` before potentially lengthy cleanup (`manager.rs:1891-1935`), without changing profile epoch; the final gate can still admit the old incarnation before selection cleanup arrives.
- **Impact:** revoked actor or retired browser can publish a managed artifact reference. Original navigation/deadline lock-wait repairs do not cover all final authority. **Confidence: high.**
- **Correction:** capture/check a live revocation/version fence at the mutation boundary; include exact browser-incarnation liveness, reusing existing manager authority. Do not perform async DB work under the PTY mutex. Add real-store revoke/demotion and real-manager incarnation-retirement barriers **after** async validation, while PTY is held.

### C3 / P1 — Explicit discard remains cancellation-unsafe; purge can again forget private files
- **Evidence:** `server/src/browser_debug/store.rs:559-561,596-599,704-706,742-745,1430-1458,1616-1635`.
- `PublishedPathCleanupGuard::cleanup_now` takes `self.path` **before** awaiting `remove_files`. Cancelling during that await drops a guard with `path == None`, releasing its quota. The detached unlink task owns neither `PendingSink` nor the in-flight guard; if unlink fails, its result is abandoned and no pending cleanup is registered.
- **Impact:** JSON/PNG left untracked/uncharged; principal purge can declare clean after the outer in-flight guard drops. Prior C3/C4 repaired on tested writer/delete paths, not every discard path. **Confidence: high.**
- **Correction:** retain charged cleanup ownership before starting unlink, or move path+quota+sink together into an owning worker that registers failure independently of its waiter. Add cancellation during post-write admission/generation-rejection cleanup with denied unlink, then reset/retry assertions.

## Warnings

- **W1 / P1 — Worker fail-closed repair incomplete for already-running service workers.** `server/src/browser_host/screencast.rs:1121-1154,1170-1195`; event projection `server/src/browser_host/cdp.rs:188-195,893-908`. Failed interception of an unpaused child closes only `page_target_id`; the worker target identity is discarded. Closing a document is not termination of an event-driven service worker ([W3C lifetime](https://w3c.github.io/ServiceWorker/#service-worker-lifetime)). A running service worker may remain unpoliced. Paused-child branch correctly never resumes, but keeps failed workers paused indefinitely with no retirement/recovery. **Correction:** own and terminate/verify the affected worker or fence the containing instance; bounded cleanup of denied paused children. Existing mock (`screencast.rs:1312-1324`) asserts page close, not worker absence/forbidden-request denial. **Confidence: high for inadequate cleanup contract; deployed-engine reachability unexercised.**

- **W2 / P2 — Cancelled handoff waiter does not cancel the mutation worker.** `server/src/browser_debug/store.rs:866-940`. Started `spawn_blocking` work survives dropping/aborting `execute_handoff`; it retains the global artifact write guard and selection read guard while waiting for PTY, and can write/claim after its caller disappeared. No cancellation receipt reaches `authorize`. This also stalls unrelated artifact operations and selection mutations while that worker is stuck. **Correction:** explicit cancellation ownership checked under PTY before commit, releasing guards when abandoned; or explicitly define/test accepted-operation completion semantics. Test task abort while parked on PTY, with no authority change. **Confidence: high for detached-worker behavior; HTTP disconnect is not assumed always to cancel an Axum handler.**

- **W3 / P2 — Cancelled retirement skips selection-registration removal.** `server/src/browser_debug/store.rs:416-435,1150-1165,180-187`. `finish_retired` awaits unlink before `notify_retired`. Abort DELETE/expiry during unlink: pending files remain discoverable, but retry cleanup has no selection identity and never removes its registration. Repeated cancellation+successful retry can accumulate dangling `pending_artifacts` even as storage quota recovers. **Correction:** cancellation-safe registration retirement, or carry the exact notification obligation in retained cleanup. **Confidence: high.**

- **W4 / P2 — Navigation publication still shares a reader with slow cleanup.** `server/src/browser_host/selection.rs:666-718,1279-1280,1325-1363`. A navigation is marked applied before the watcher awaits artifact unlink/overlay cleanup. Another picker can start while that existing watcher remains registered but is not receiving subsequent queued navigation events; final handoff compares only the already-published counter. **Correction:** keep event ingestion independent of disk/CDP cleanup, or deny selection/handoff while observation is catching up. Add a parked-unlink/overlay-cleanup test, new selection, then second native navigation and handoff. **Confidence: medium-high; schedule unexecuted.**

## Prior findings disposition

| Prior finding | Source disposition |
|---|---|
| C1 process PID/group reuse | Partial: Rust handles repaired; watcher remains C1 above |
| C2 final handoff authority | Native-observation publication and PTY-lock deadline/epoch rechecks added; missing auth/incarnation C2 and observation backlog W4 remain |
| C3 cancelled write denied unlink | Tested pre/post-persist cancellation branches retain quota via `PendingSink`; explicit-discard cancellation remains C3 |
| C4 reset misses in-flight operations | `retire_locked` plus generation-qualified writer tracking repairs original delete/unpublished-writer gaps; C3 can still escape ownership |
| W1 overflow-page ambiguous close | Repaired in inspected path: `manager.rs:2251-2298` keeps/retries pending close and charges raw slot; native regression `browser_host_admission.rs:1302-1351` |
| W2 worker fail-open | Paused child no longer resumed; unpaused/background-worker cleanup incomplete (W1 above) |
| W3 >64 auth identities | Repaired: one absolute deadline includes semaphore wait (`attachments.rs:667-706`); 201-identity regression `browser_host_auth.rs:662-698` |
| W4 metadata initialization outside flock | Repaired: read-only probes (`manager.rs:326-331,372-374`); initialization requires matching retained lock (`profile.rs:455-511`) |

## Suggestions / architecture and performance

1. Close C1–C3 and worker-policy gap before technical task closure; extend production-owner regressions at the omitted boundaries, rather than add predicate-only tests.
2. Keep the existing artifact store as the single cleanup owner. Unify explicit discard, retirement and cancellation around the same ownership transfer; current split paths produced C3/W3. No new service/registry abstraction needed.
3. Preserve current lock-order improvements and moving PTY waits/process inventories off Tokio workers. Profile reads/fsync still run synchronously on async manager paths (`manager.rs:520-542,1063-1073`; `profile.rs:426-452`); move bounded filesystem transactions to blocking workers without releasing flock/transaction ownership.
4. Extract focused existing-domain helpers only when touching these large files. KISS/DRY improvements matter more than mechanical line-count splits; no need for framework or broad refactor. Maintained docs/changelog remain Phase 04-owned.

## Reviewed files

Deep source/selected changed hunks:
- `server/src/browser_host/{process,manager,profile,attachments,screencast,selection,cdp,session,media}.rs`
- `server/src/browser_debug/{store,tests}.rs`, `server/src/state.rs`, `server/src/pty/manager.rs`
- `server/src/api/{browser_host,auth,browser_debug}.rs`, supporting `server/src/auth/{mod,store,policy}.rs` and store search matches.
- Regression sections: `server/tests/browser_host_{process,auth,admission,selection}.rs`, `server/tests/browser_debug_artifacts.rs`.
- Phase overview/Phase 01 plan, cycle-1 review; README, PDR, code standards, browser architecture and original architecture contracts. Scope: cycle-2 repairs/dependent owners, not a full 37-file re-audit or entire-repository audit.

## Validation commands/results

- Executed read-only `git diff --stat && git diff --name-only`, focused `git diff -- <paths>` / `git diff --unified=3 -- server/src/browser_debug/store.rs`, source/range/search inspection. Initial diff: **37 files, +14,675/-2,401**.
- Checked all `write_if_incarnation` callsites by repository search: one production caller, migrated to the authorization closure.
- **No tests/build/typecheck/lint/formatter/install/runtime probes run; no Git-state changes.** No independent coverage percentages or lint counts available.
- Caller-provided validation: full server suite **2,284 pass / 0 fail**, including Mongo-backed tests; browser_host suites stable over **3 reruns**; UI **3,720 pass**. Accepted as supplied, not rerun, and not evidence that the schedules above were exercised.
- Next targeted oracles: watcher TERM→KILL group reuse; live auth/incarnation retirement during PTY wait; cancellation during explicit discard and retirement; cancelled handoff waiter; actual service-worker forbidden requests/absence; navigation while watcher cleanup is parked.

## Unresolved questions

- Deployed Chromium worker/service-worker attach/interception/lifetime behavior still needs the real-engine oracle; mock command receipts do not establish containment.
- Is handoff intentionally an accepted operation that must complete after caller cancellation? Source has that behavior now; no explicit cancellation/commit contract inspected. This does not affect C1–C3.
- Native Windows runner/proof remains intentionally blocked; downstream physical/human/soak qualification not evaluated here.
