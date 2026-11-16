# Phase 05 post-fix code review

## Score: 4/10 — acceptance blocked

Static re-review of security, performance, lifecycle, architecture and YAGNI/KISS/DRY. Published code-review skill, development rules, README, product/architecture requirements and Phase 05 acceptance inspected. Source/tests/plans unchanged; no task tracking performed.

## Targeted fixes: disposition

- `Target.closeTarget` is now called, but errors are discarded and target ownership/admission remains non-atomic.
- Native emulation/reconfiguration commands now exist, but are not serialized with run lifecycle and their errors are discarded.
- Both publication paths reserve before base64 decode and adjust the retained frame charge. This does not account for all simultaneously live payloads or enforce admission on reservation growth.
- Both upgrades configure message AND frame limits: media 1 KiB, control 16 KiB. Confirmed improvement.
- Live Axum WebSocket upgrade test exists. It is not a REST/native-media/input journey.
- Control currently permits 100 text messages per fixed second. Media also permits 100, not the stated 50/s. Neither implements the specified sustained/burst policy.

## Critical issues

### C1 — Native target lifecycle still bypasses capacity

**Evidence:** `server/src/browser_host/media.rs:55-112`; `server/src/browser_host/screencast.rs:178-185`; `server/src/api/browser_host.rs:351-364,419-429,1032-1044`; `server/src/browser_host/session.rs:370-381,401-425`.

Producer creation is check/connect/create/insert, not an atomic ownership transaction. Concurrent first attachments can create two native targets; insertion replaces one producer without closing its target. DELETE releases logical capacity before native close, while `close_target()` suppresses failure and always returns success. Closed sessions remain retrievable; ticket issuance and lazy producer creation do not reject them. A closed logical session can therefore obtain a fresh native target without reacquiring logical capacity. Native IDs are also not persisted into the logical session mapping.

**Impact:** leaked/resurrected credential-bearing pages, ineffective two-target limit, incorrect lifecycle and gateway correlation. **Correction:** serialize creation/deletion per logical target, commit real identity once, reject retired/stale identities, clean losing allocations, and retain capacity/cleanup ownership until native closure is proven. Return typed errors rather than fabricated creation/closure success. **Confidence: high.**

### C2 — 128 MiB ceiling remains incomplete allocation accounting

**Evidence:** `screencast.rs:587-602,650-721,767-839`; `diagnostics.rs:44-52,78-105,173-219`; `protocol.rs:321-359`; `cdp.rs:242-263,619-628`; `command_budget.rs:14-28,62-82`; reservation caller search.

Encoded candidate strings are copied before global admission; ingress, command and raw-relay payloads do not participate in this controller. A reservation of base64 length plus header does not cover simultaneously retained base64, decoded JPEG and copied complete BHJF allocation. Fallback screenshot response is already allocated before admission and has no encoded-length precheck. `adjust()` can grow beyond the hard cap without rejection or peak updates. `clone_data()`/`data().clone()` export Bytes independently of the reservation owner; wrapper-only lifetime tests cannot prove last-allocation accounting.

**Impact:** reported reservations/high-water values do not enforce the promised global payload ceiling. **Correction:** charge each live payload category before allocation, make growth fallible, and attach reservation ownership to the actual shared allocation exported to transport. Exercise exhaustion and naked transport-buffer retention. **Confidence: high.**

## Warnings

1. **High — Reconfiguration violates demand/run ownership.** `screencast.rs:189-225,339-409`; `api/browser_host.rs:596-623`; `session.rs:547-557`. Resize issues `Page.startScreencast` whenever a Page session exists, even after zero-demand stop, without a fresh run/subscription/drainer or state transition. It can restart native capture while logical state remains Stopped. Native errors are ignored; initial start never applies configured device metrics. REST passes raw geometry after registry clamping, so width 5000 advances registry/input epoch but producer rejects the update. Use one authoritative clamped transition serialized with demand/start/stop and propagate failures. Add paused-resize and native-dimension assertions.

2. **High — Capture epochs and input geometry remain incoherent.** `screencast.rs:193-203,584-594,644-715,755-833`; `media.rs:890-895`. Candidate epoch is assigned after ACK await and reloaded after further awaits; old captures can acquire a new epoch. Non-dimension changes retain old-epoch cache. Invalid native geometry falls back to local geometry yet sets `inputTrusted:true`; dispatch uses local producer geometry rather than the published capture geometry. Carry immutable capture ownership/signature and disable input until reconciled.

3. **High — Upgrade bypasses canonical Origin/live-target fences.** `media.rs:281-311,353-434,714-779`; `auth.rs:113-149,293-304`. Dev Origin helper accepts any superficially formatted Origin; absent peer information is accepted; duplicate Origins and actual listener binding are not checked. Neither path validates ticket incarnation/profile epoch against the current target/process; control does not validate target existence. Reuse canonical admission policy and recheck live resource identity after awaits.

4. **High — Input authority and replacement lease teardown incomplete.** `media.rs:809-815,878-918`; `input.rs:271-311,414-439`; `attachments.rs:364-425`. Control-only attachment can process input: pair readiness and captured viewer/login/process/profile identity are not enforced. Initial status always claims availability. Missing-mate timeout is only pruned on later registration. Teardown check-then-revoke is non-atomic and compares viewer ID, not immutable subscription/lease generation; an old socket can revoke a replacement lease. Bind dispatch and atomic revocation to complete captured authority; add a real pair-expiry timer.

5. **High — Reliable release failures remain silently lost.** `media.rs:925-1018`; `input.rs:451-505`; `api/browser_host.rs:750-753`. PointerCancel remains a no-op while enqueue clears held buttons. Sequence-gap/overflow and REST release discard generated native release events; CDP errors are suppressed after state/sequence mutation. Stuck native keys/buttons become untracked. Dispatch every captured release, propagate native failure into input-unavailable/lease teardown, and reuse checked coordinate mapping.

6. **High — ACK/run recovery is still unsafe.** `screencast.rs:228-254,339-448,483-507,540-581`; `cdp.rs:209-215,370-384`. Runs reuse flattened Page sessions; delayed old events can establish replacement native identity. Broadcast lag and oversized current-run events lose ACK obligations without aborting. ACK awaits the complete command response, blocking drain/governor/expiry. Stop cancels before draining; failure does not reconnect the actor, and heartbeats do not restart stopped runs. Implement fresh-session run ownership, bounded prompt ACK enqueue, explicit failure propagation and ordered stop/recovery without ambiguous replay.

7. **High — Absolute deadline and cleanup are not independent.** `media.rs:469-498,501-548,658-671,809-831,886-918`. Outer deadline selection cannot interrupt an already-selected five-second send or awaited CDP dispatch. Initial control send has no timeout/cancellation race; cached attach precedes timer setup and ignores send failure. Already-expired returns skip unregister/demand cleanup; failed upgrades have no cleanup guard. Use independently triggered deadline cancellation and unconditional connection cleanup, including initial writes and dispatch.

8. **Medium — Abuse policy differs from stated fix.** `media.rs:485-486,563-574,644-645,818-819,866-902`. Media allows 100 text controls per fixed second, not 50/s. Control fixed windows reject the permitted burst-200 behavior and allow boundary bursts; burst constant is unused. Binary/unsupported traffic bypasses text rate checks and is ignored; malformed control input is ignored. Use one small sustained/burst limiter with explicit per-path settings; disconnect unsupported/abusive traffic and bound rejection logs.

9. **Medium — Operational proof remains disconnected.** `diagnostics.rs:244-305`; production caller search; `tests/browser_host_bounds.rs:129-155`. Global delivered/start/zero-demand-stop counters and qualification ring have no production updates. Required writer/ACK ages and queue-depth observations are absent. Test directly assigns counters rather than observing real delivery. Instrument actual lifecycle/send/disposition boundaries, not test fixtures.

## Acceptance/validation gaps

`tests/browser_host_media.rs:299-444` mounts a real Axum listener and upgrades both sockets, but synthesizes a nonexistent session/incarnation and issues tickets directly through the global manager. It sends no HTTP create/ticket requests, receives no JPEG, dispatches no input and asserts no teardown. Its successful upgrade demonstrates missing resource checks rather than end-to-end readiness.

`tests/browser_host_screencast.rs:131-170,175-205,208-258` does not assert a native resized image, actual 15-second heartbeat expiry, or a generated animation burst. `tests/browser_host_bounds.rs:86-155` retains wrappers only and manually sets diagnostic counters. Required faulted ACK/old-run recovery, blocked physical writer cancellation, fresh pause/rebind replay, replacement lease isolation, two-target 60-second global-budget soak and PTY/control responsiveness remain unproven. Passing tests do not complete these acceptance obligations.

## Suggestions — architecture, performance, KISS/DRY

- One lifecycle-owning target service should serialize create/start/stop/resize/delete and own native identity plus epoch. Avoid independent mutable authorities and duplicated upgrade policy.
- Remove producer from the global map before awaiting native shutdown; current global write lock blocks unrelated producer access during CDP waits (`media.rs:68-73`).
- Spawn with `self: &Arc<Self>` rather than reconstructing a many-field shared handle (`screencast.rs:853-876`).
- Store immutable parsed publication metadata beside shared bytes; avoid allocating/parsing target header strings per viewer and pending flush. Reuse existing coordinate/admission helpers.

Positive: contiguous shared BHJF Bytes, exact subscription-scoped credit removal, two-outstanding/one-pending governor, fixed subprotocol echo, transport size caps and cancel-aware media writes are appropriate primitives. No image decode/re-encode engine or periodic screenshot loop introduced.

## Reviewed files

Primary: `server/src/browser_host/{screencast,media,diagnostics,protocol,input,mod}.rs`; `server/src/api/{browser_host,router}.rs`; `server/tests/browser_host_{screencast,media,bounds}.rs`.

Supporting sections/searches: `server/src/browser_host/{cdp,command_budget,attachments,auth,session,manager,cdp_gateway}.rs`; `plans/261108-0237-host-browser-cdp-streaming/{phase-05-producer-fanout,architecture-contracts}.md`; prior cycle review/test report; README; `docs/{code-standards,project-overview-pdr,system-architecture}.md`; `docs/architecture/host-browser-cdp-streaming.md`; published workflow/skill guidance. Approximately 3,500 implementation/test lines plus supporting sections. Updated plans: none, per no-task-tracking assignment.

## Validation commands/results

Reviewer ran scope commands only: `git diff --stat` (five tracked files, 74 insertions/one deletion), targeted `git diff -- ...` for integration, source reads/searches, and `date +%y%m%d` (`261109`). No TODO/FIXME/todo!/unimplemented! markers found in the three new modules/three Phase 05 tests.

No build/test/lint/formatter run by reviewer; Main/designated tester owns execution. Assignment supplies **45/45 tests passing**; attributed, not independently reproduced. Prior Cycle 3 report records older runs and is not current post-fix proof.

Validation commands for integration owner:
- `cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture`
- `cargo test --manifest-path server/Cargo.toml --test browser_host_media -- --nocapture`
- `cargo test --manifest-path server/Cargo.toml --test browser_host_bounds -- --nocapture`
- Corresponding `browser_host_gateway`, `browser_host_admission`, `browser_host_lifecycle` targets; `cargo test --manifest-path server/Cargo.toml --lib browser_host`.

Coverage percentages, fresh lint counts and release build status not measured. Static finding confidence high; runtime failure reproductions not executed.

## Unresolved questions

No missing repository information blocks the fixes. Current post-fix command-level results belong to Main/designated tester; named production-boundary, fault-injection and soak acceptance evidence above remains unresolved. Phase 05 should remain technically incomplete.
