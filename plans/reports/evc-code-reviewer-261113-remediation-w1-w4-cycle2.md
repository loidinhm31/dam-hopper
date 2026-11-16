## Code Review Summary

**Score: 7/10 — request changes.** 170 targeted tests passed. Original header re-read, screenshot await-accounting gap, active-start resize and abandoned-start transition improved; four correctness gaps remain. Findings below are **[INFERENCE]**, source-derived interleavings, not newly executed repros. Confidence: high.

### Critical
None established.

### Warnings

1. **High — spawned start can escape a subsequent explicit stop.** `server/src/browser_host/screencast.rs:1837-1847,1959-1963`. Scenario: poll `start_screencast_run`, spawning its child; before that child first runs, complete `stop_screencast` on the still-Stopped producer. Stop increments the recovery epoch and returns. Child then captures that *new* epoch and starts anyway, resurrecting a run after stop returned. Moving the epoch capture inside the spawned body loses the original cancellation ordering. **Correction:** capture the recovery epoch before spawning; pass it into the serialized body and compare under the operation gate. Existing queued-start test only covers a child already polled before stop (`server/tests/browser_host_screencast.rs:2148-2170`).

2. **High — resize treats an ambiguous native stop as an untouched live run.** `server/src/browser_host/screencast.rs:1448-1473,2028-2030`. Scenario: Chromium executes `Page.stopScreencast`, but its reply misses the command deadline; the metrics rollback subsequently succeeds. Code restores old epoch/trust/caches and leaves state Streaming/current_run unchanged, without restarting or poisoning the Page session. Chromium is stopped: no frames, no new ACK failure to trigger recovery, cached picture can persist. `PendingCommand::wait` explicitly permits response timeout after dispatch (`server/src/browser_host/cdp.rs:532-542`). **Correction:** distinguish definite rejection from ambiguous timeout/transport outcome; retire/re-establish the native boundary on ambiguity, never assume the live run survived. Same helper now affects both resize and tier switches.

3. **High — rollback can overwrite a newer raw-CDP epoch and geometry.** `server/src/browser_host/screencast.rs:1426-1430,1468-1472,1519-1528`; external commits at `:1331-1348`. Scenario: resize awaits native stop/start; an external fence commits epoch 3 and new geometry; resize then fails and unconditionally restores saved epoch 1, old geometry/trust/cache. Registry/input remain on the newer epoch while producer regresses; old cached pixels/authority return and client epoch floors can reject the recovered stream. Successful commit uses monotonic CAS, but failure paths bypass it. **Correction:** ownership-check rollback against the transition it owns; never restore over a newer fence. If ownership changed, reconcile current authority or retire fail-closed instead of replaying the saved snapshot.

4. **Medium — external fences still bypass the publication gate.** `server/src/browser_host/screencast.rs:1314-1325,3059-3081,3267-3287`. Scenario: publisher passes its final epoch check under `publish_gate`; another task runs `begin_external_geometry_fence`, sets the transition bit and clears caches without taking that gate; publisher then caches/broadcasts its old frame after the fence. Captured header epochs prevent the original transitional-header bug, but this remaining path defeats atomic fence-versus-publication and can repopulate invalidated caches. **Correction:** make external fencing participate in the same publication transaction; keep epoch/geometry/trust/cache ordering coherent with warning 3.

### Explicit acceptance verdicts

1. **Deadlock/lock order: no cycle found in inspected paths.** Geometry takes operation → state → page_setup → publish; publishers take publish → current_run → individual cache locks, never operation/state/page_setup. Retirement releases current_run before cache locks. `drop(setup)` at `screencast.rs:1501` precedes both the new-size start and its rollback restart; other exits never re-enter start. Input dispatch releases Page setup before taking its native gate (`control_input.rs:70-76,121-133`). Recovery uses the same lifecycle owner. Not a whole-repository deadlock proof.
2. **Cancellation: partial.** Owned start/geometry tasks survive caller drop; JoinError is returned, not unwrapped. Stop now poisons before its first internal await (`:1983-1985`) and restores prior poison on the no-session path (`:2011`). An interrupted stop remains recoverable by the next lifecycle owner, not guaranteed to finish autonomously. Start-versus-stop scheduling still fails warning 1. No caller task-local dependency found in inspected consumers.
3. **Stop→start resize: correct ordinary Chromium path; failure handling incomplete.** Real streaming-resize test passed. Old run/native ID/caches retire before fresh producerRun; audio source/token/sequence survive video-only restart. Client retires video runs independently of audio (`stream-controller.ts:672-679,751-773`). Lower native IDs are old-session credits, not current-session credits; dropping without ACK is consistent with that boundary. Higher IDs abort/recover rather than silently strand the current stream. Warnings 2–3 block unconditional acceptance.
4. **Epoch/header: original re-label/transitional-bit defects fixed in the two publishers.** Native header uses validated candidate epoch (`:3027-3036`); fallback uses checked `epoch_after` (`:3208-3211,3250`); both recheck under publish gate. No transitional header observed. Global fence safety remains incomplete: warnings 3–4. W2 fixed for its stated scope: text/decoded/packed guards are acquired before the post-screenshot metrics await (`:3174-3205`); no intervening await.

Known state-write-lock-across-native-I/O/viewer-registration delay excluded as instructed.

### Suggestions
- Add barrier-driven regressions at `server/tests/browser_host_screencast.rs:185,2148,2565`: stop before spawned-start first poll; executed stop with delayed reply; newer external fence during rollback; publisher paused after final epoch check while external fencing runs. Current real-resize test covers ordinary progress, not these failure interleavings.

### Files reviewed
- Targets: `server/src/browser_host/screencast.rs` (fields, lifecycle, geometry, ingress, publication, fallback, cloning); `server/src/browser_host/screencast/recovery.rs`.
- Supporting code/excerpts: `server/src/browser_host/screencast/{recovery_supervisor.rs,fresh_page_session.rs}`, `server/src/browser_host/{raw_geometry_fence.rs,input.rs,control_input.rs,cdp.rs,media.rs}`, `server/src/api/browser_host.rs`, `server/tests/browser_host_screencast.rs`, `packages/ui/src/browser-host/stream-controller.ts`.
- Context: `README.md`, `docs/{project-overview-pdr.md,code-standards.md}`, previous `plans/reports/evc-code-reviewer-261113-remediation-payload-lifecycle-review.md`; published development rules and code-review skill/reference.
- No source, tests, plans or docs edited; only this requested report written. Other uncommitted work not assessed.

### Validation actually run
Server cwd; both prefixed `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium`:
- `cargo test --features vendored --test browser_host_screencast` — **exit 0; 53 passed**, 0 failed/ignored; includes real Chromium resize and dropped-start/native-ID regressions.
- `cargo test --features vendored --lib browser_host::` — **exit 0; 117 passed**, 0 failed/ignored, 1445 filtered out.

Output: `artifact://82`. Compiler warnings emitted; no separate lint/full-suite run. Earlier 16-suite claim not independently verified.

### Unresolved questions
- No product clarification needed. Deterministic runtime repros for the four source-derived interleavings remain unexecuted; existing passing suites do not cover them.
