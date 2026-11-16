## Code Review Summary

**Score: 7/10 — request changes.** 177 authorized tests passed. Findings below are **[INFERENCE]**, source-derived interleavings, not newly executed repros. No source/tests/plans/docs edited; only this requested report written. Other uncommitted work excluded.

### Critical
None established.

### Warnings

1. **High — a rejected stale external commit can permanently strand the resize fence.** `server/src/browser_host/screencast.rs:1391-1393,1359-1367,1488-1500`.
   - Scenario: producer already at epoch 5; resize to 6 installs `5|T` and awaits its metrics override. A delayed external commit for epoch 4 increments `fence_generation`, then `commit_epoch_monotonic(4)` rejects it without changing epoch/geometry. The override receives a definite Protocol rejection. Restore now rejects the generation, its result is ignored, and resize returns with `5|T`, trust false and cleared caches, although no newer live fence owns that state.
   - Delayed commits are possible: raw fence epoch allocation and producer commit are separated by awaits (`raw_geometry_fence.rs:95-105`); another raw fence/managed transition can overtake one. An earlier begin can precede this resize's generation snapshot, so the *rejected commit* is the invalidating event.
   - Native frames still ACK but publication rejects T (`screencast.rs:2929-2945,3044-3047`); fallback also rejects T (`:3333-3336`). No abort/reconciliation is scheduled on this error; ordinary start/recovery does not clear viewport T. A subsequent successful geometry operation might recover it, not autonomous convergence. The same invalidation can defeat stop-failure rollback.
   - **Correction:** serialize commit admission/ownership with restoration; a rejected stale commit must not revoke an otherwise-current owner. Explicitly reconcile a failed restore instead of assuming every generation change implies a surviving newer fence. Preserve begin-generation protection against same-epoch ABA. Confidence: high.

2. **Medium — `Protocol` does not universally prove this command was rejected.** `server/src/browser_host/cdp.rs:82-85,1237-1246,1164-1167,1741-1753`; consumer `screencast.rs:2145-2154`.
   - Scenario: native stop has been written/executed but awaits its response. An outstanding negative-ID Fetch policy command returns a Protocol error other than the two tolerated codes, e.g. -32603. Actor shutdown fans that *unrelated* Protocol error to every pending stop. Classifier returns definite-not-executed, although no response for that stop was received.
   - Independent ActorLost recovery (`screencast.rs:2297-2300`) normally limits impact; this is **not** evidence of a permanently healthy-looking run by itself. Nevertheless immediate NativeStopAmbiguous handling is skipped, and the advertised outcome proof is false.
   - **Correction:** distinguish owner-routed command rejection from actor-wide failure; fan out an ambiguous actor/transport error while retaining the policy error as its cause. Do not merely classify all Protocol errors ambiguous, recreating healthy-run abortion on genuine rejection. Confidence: high.

3. **Medium — stale successful resize clears somebody else's still-active fence.** `server/src/browser_host/screencast.rs:1568-1586` (residual in inspected ownership path).
   - Scenario: resize target 2 awaits native I/O; external commit 5 wins; another external fence begins, installing `5|T`, and has not committed yet. Resize reaches `commit_epoch_monotonic(2)`, receives false, then unconditionally strips T from the current epoch. The newer fence loses publication suppression before its owner finishes.
   - Old native frames can now publish/reconfirm trust against unchanged geometry (`:3044-3049,3144-3148`). Generation protects rollback but is not consulted here. If restart subsequently fails, `owned=false` starts again without restoring the lost fence.
   - **Correction:** on a rejected stale commit, leave the winner's entire epoch encoding untouched; only the actual fence owner may clear T. Add a begun-but-not-committed successor case. Confidence: high.

### Explicit acceptance verdicts

1. **Classification: mostly conservative, not universally correct — warning 2.**
   - TooManyPendingCommands: slot reservation rejects before serialization/enqueue (`command_budget.rs:54-60`). WriterQueueFull: local/global byte admission or failed `try_send(Full)`; no command enqueued (`command_budget.rs:85-105,121-141`; `cdp.rs:955-974`). CommandTooLarge: bounded serialization rejection (`cdp.rs:456-460`). These definite classifications fix cycle-3 saturation-triggered abortion.
   - CommandTimeout includes pre-dequeue expiry as well as post-write timeout (`cdp.rs:552-564,1074-1079`): true deliberately sacrifices a potentially healthy run rather than assume execution state.
   - ConnectionClosed includes pre-send queue closure and post-send loss (`:973,1094-1100,1741-1753`): conservative true is necessary for the shared variant; even pre-send closure means the actor is unusable.
   - Deserialization also means **outgoing serialization** failed before enqueue (`:926-933`), not necessarily an unreadable response. Conservative true can unnecessarily retire a healthy generic caller; default StopScreencastParams has no fallible custom serialization. Policy-decision serialization errors can also terminate the actor and fan out to already-written commands (`:1517-1522,1164-1167`), so globally changing this variant to definite would be unsafe.
   - MessageTooLarge is **incoming** message failure (`:1198-1203`), never the outgoing size rejection: pending stop may have executed. MalformedResponse/Transport similarly do not establish non-execution. True is appropriate. A normal owner-routed Page.stopScreencast Protocol rejection is definite; actor-wide Protocol fanout is the exception above.

2. **Restore-helper lock order/deadlock: no new cycle found.** Helper takes publish → atomic quality marker → geometry, releases geometry before individual cache locks (`screencast.rs:1356-1383`). Publishers release geometry/candidate locks before publish; under publish they take current_run then individual caches (`:3035-3039,3129,3184-3203,3361,3392-3410`). Retirement releases current_run before cache acquisition (`:1268-1284`). External commit takes geometry but never awaits publish. Input dispatcher releases Page setup before its native gate; geometry reads clone/drop before native I/O (`control_input.rs:70-84,121-134`). No inspected geometry reader holds it while awaiting publication.
   - QualityMutation is a nonblocking atomic writer counter, **not a mutex** (`capture_tier.rs:510-516,548-562`); holding it across geometry await is safe. Drop advances version/decrements writers; discard only decrements. Failed/no-geometry-change restores correctly discard because trust/cache/epoch are not inputs of the quality snapshot; changed geometry drops the guard after its write, as existing commits do. No moved-value issue: snapshots are consumed only on mutually exclusive returning branches; authorized compilation passed.
   - The helper is not a global geometry transaction: external commit changes generation/epoch before acquiring geometry and uses no publish gate. Do not infer whole-transition linearizability from the helper comment; warnings 1/3 remain.

3. **Permanent fence/stale authority: not fully safe — warnings 1/3.** Normal helper expectations match encoding: initial/stop failure expects `old|T`; successful commit stores unmasked target; start failure expects target, restoring old directly. No always-failing ordinary CAS. Raw high-bit target mismatch remains the previously documented, practically unreachable reserved-bit domain limitation, not a new finding.
   - Genuine newer begin: failed helper preserves T/trust=false/caches; its raw fence task is detached and ordinarily completes the successor commit. Genuine newer committed epoch: failed helper preserves its geometry/epoch; a failed restart attempts current geometry and retires if that also fails (`:1627-1633`).
   - Rejected stale external commit is different: nobody remains responsible for clearing the old T (warning 1).
   - `owns_epoch=false` skips requested geometry/trust assignment and uses current geometry for restart, but currently modifies the winner's fence bit anyway (warning 3). No proof of stale-pixel/native-viewport consistency from restarting alone.

4. **Test strength: useful regression coverage, incomplete ownership/provenance coverage.**
   - `external_fence_committed_during_the_native_rollback_is_never_overwritten` (`tests/browser_host_screencast.rs:2792-2824`): real barrier after rollback command observed, then external begin+commit before reply. Meaningful geometry/epoch/trust oracle; rejects old unconditional restore. Epoch and generation both change, so it does not isolate generation protection.
   - `external_fence_begun_during_the_stop_failure_rollback_is_not_cleared` (`:2831-2855`): same `old|T` before/after begin; trust starts true. Error/trust assertions distinguish generation ownership, not just CAS. Author's mutation result not independently repeated. It leaves the successor fence uncommitted; does not prove eventual publication resumes.
   - `failed_resize_does_not_overwrite_a_newer_external_fence` (`:2753-2778`): covers newer commit before restart rejection. Direct commit omits raw begin; Streaming assertion alone does not prove native geometry/start dimensions/frames.
   - Both rollback tests use a peer that withholds/replies without modeling native viewport application (`:1784-1793`). No populated pre-transition frame/candidate cache or emitted post-recovery pixels: passing does not prove cache/native authority consistency. Neither exercises rejected stale commits or `owns_epoch=false` with a newer active T.
   - `ambiguous_native_stop_aborts_the_run_into_recovery` (`:2736-2748`): routeable malformed result on a live actor, no injected ACK/frame/actor-loss cause; new run plus abort counter is meaningful. Does not assert fresh Page identity or preserve a healthy run under actual admission rejection.
   - `outcome_classification_tests` (`cdp.rs:2626-2650`): pins all current variants to the intended table; can fail on table mutations. Cannot detect wrong error provenance/fanout (warning 2), nor exercise dispatch/admission. Not a substitute for stop-pending + unrelated fatal-policy-response coverage.

### Suggestions
- Prioritize warning 1 regression: pause metrics override; deliver a *stale rejected* external commit; reject override; assert no stranded T by proving subsequent native publication and correct trust/epoch (not only masked `viewport_epoch()`).
- Add stale resize + newer committed epoch + successor begin before its commit; assert suppression persists until successor commit. Populate caches first and observe post-transition frames/start parameters.
- Exercise actual slot/byte/queue rejection through stop, asserting same run/no abort, plus unrelated actor-wide Protocol failure asserting ambiguous recovery. No source mutations performed in this read-only review.

### Files reviewed
- Targets: `server/src/browser_host/screencast.rs` (focused fields/cloning, geometry rollback, stop, publication, ingress and related lock lifetimes); `server/src/browser_host/cdp.rs` (classification, admission/enqueue/wait, actor error propagation, relevant unit test); `server/tests/browser_host_screencast.rs` (scripted harness and named/new plus existing rollback tests).
- Supporting excerpts: `server/src/browser_host/{capture_tier.rs,command_budget.rs,raw_geometry_fence.rs,input.rs,control_input.rs,session.rs}`, `server/src/browser_host/screencast/{recovery.rs,recovery_supervisor.rs,fresh_page_session.rs}`, `server/src/api/browser_host.rs`.
- Context: `README.md`, PDR/code-standards excerpts, cycle-2/cycle-3 reports, published agent/development/primary-workflow guidance, code-review skill and test-principles policy. No plan supplied/updated.

### Validation actually run
Server cwd; both with `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium`:
- `cargo test --features vendored --test browser_host_screencast` — **exit 0; 59 passed**, 0 failed/ignored; 17.12s.
- `cargo test --features vendored --lib browser_host::` — **exit 0; 118 passed**, 0 failed/ignored; 1445 filtered out; 5.01s.
- Combined exit 0; evidence `artifact://122`. Compiler warnings emitted. No whole ring, compatibility test, separate lint, mutation, or new repro run; coverage percentages not measured.
- Read-only provenance command: scoped `git diff --stat` and `git diff` filtered to ownership/classification hunks; completed successfully. No git mutation.

### Unresolved questions
No product clarification required. New warning scenarios remain source-backed, not independently reproduced under this read-only assignment; passing scoped suites do not resolve those missing interleavings.
