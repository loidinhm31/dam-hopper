# Phase 05 code review — bounded native JPEG / independent credits

## Score: 3/10 — not ready for acceptance

Scope: changed/untracked Phase 05 implementation and tests, with supporting admission, actor, input, session and lifecycle call sites. Static review; no product or plan edits. Plan task state intentionally unchanged under assignment ownership constraints.

Good foundations: complete immutable BHJF `Bytes`, checked existing JPEG/header validation, exact socket-subscription equality before credit removal, local credit cardinality bounds, bounded diagnostic ring, and no periodic screenshot timer.

## Critical issues

### C1 — Payload ceiling does not account for live allocations
- Evidence: `server/src/browser_host/screencast.rs:642-660,755-769`; `diagnostics.rs:46-49,56-79`; `media.rs:73-75`.
- Successful `try_reserve` values are discarded immediately by `if let Err(...)`; RAII releases the reservation before cache/broadcast retains the buffer. Reservation also happens after packing/allocation. Production never constructs `TrackedBhjfFrame`; candidates, CDP ingress, command budgets and raw gateway buffers are not integrated with this global controller. Publication broadcast retains up to 16 complete frames, rather than one latest publication (`screencast.rs:119`).
- Impact: advertised 128 MiB safety ceiling and last-writer accounting are ineffective. Unit tests exercise an unused helper, not production ownership.
- Correction: reserve before allocation; make reservation lifetime follow the actual shared buffer through cache, fanout, pending, outstanding and active writes; connect all required payload categories to the same ceiling. Remove the 16-publication backlog. Do not allow `clone_data()` to outlive its accounting owner. Confidence: high.

### C2 — New upgrades bypass current admission and absolute auth expiry
- Evidence: `media.rs:199-275,427-502`; supporting `attachments.rs:293-354,514-558`; contrast `cdp_gateway.rs:639-641,793-809,876-884`.
- Both handlers ignore AppState/listener/peer/actor, consume stored ticket metadata, then upgrade without live role/session/version and current target/incarnation/profile checks. Ticket consume itself only checks token/purpose/TTL/recorded Origin. No per-connection absolute-deadline timer exists; shared supervisor checks connections serially on its interval.
- Impact: tickets issued before demotion/revocation can enter the new transports until a later supervisor pass; development listener/peer restrictions are not repeated at upgrade, and exact auth expiry is not enforced.
- Correction: reuse canonical upgrade admission/live verification, validate ticket target generation, and carry an independent absolute deadline into connection execution. Confidence: high.

## Warnings — high priority / acceptance blockers

### W1 — No production producer wiring
- Evidence: `media.rs:40-58,288-295`; `api/browser_host.rs:304-360,588-601,1136-1138`.
- Repository search finds no production construction of `ScreencastProducer` and no caller of `get_or_register_producer` beyond its declaration/re-export. Only the test constructs one. A real media socket therefore has no producer and silently receives nothing. Creation, resize, close/reset/recovery do not manage this registry.
- Correction: wire one producer to the owned native target lifecycle, including demand-driven creation, viewport changes and teardown. Reject missing/stale target state rather than accepting an inert socket. Confidence: high.

### W2 — Control channel is not an ordered native input/event transport
- Evidence: `media.rs:505-567`; `input.rs:350-365,409-525`; `protocol.rs:484-506`.
- Sink is never used; `ServerControlEvent` has no sender. Inputs are only enqueued, with no production `pop_next_input`/`drain_inputs` consumer or CDP dispatch. Only subscription equality is checked at the socket; browserSessionId/incarnation/profile and paired-media readiness are not checked. Disconnect/auth-cancel does not release that subscription's lease/held input.
- Impact: input never reaches the page, status/dialog/lease errors never reach the viewer, and subscription teardown leaves stale control authority/state.
- Correction: connect the bounded ordered queue to native dispatch and bounded server events, enforce full captured identity/pair readiness, and release original held state and lease on every teardown path. Confidence: high.

### W3 — Governor can strand final frames and later send stale pending frames
- Evidence: `media.rs:104-126,157-186,297-310`.
- Pending delivery is attempted only on a new publication or successful ACK/discard. A frame queued within 100 ms of the last delivery stays pending indefinitely if the last ACK was already received and the page settles. Also, sending a newer incoming frame immediately does not clear an older pending frame; a later credit return can send the older image after the newer one.
- Correction: one explicit per-viewer delivery deadline must flush the latest pending publication when credit exists; replace/take pending before choosing a send so older frames cannot follow newer ones. Add settled-frame and monotonic-delivery tests. Confidence: high.

### W4 — Native ACK/run recovery contract is not implemented
- Evidence: `screencast.rs:183-209,313-353,438-453,501-525`; `cdp.rs:371-384`.
- Page session is reused across runs instead of freshly attached. Native session ID is stored but never compared. ACK handling awaits a full CDP response, blocking ingress; broadcast lag is logged and ignored despite losing ACK obligations. ACK failure merely returns, leaving Streaming state; actor closure does not perform recovery. Stop cancels the drain before completing accepted-event obligations.
- Impact: stale-run frames/ACKs can be misattributed, overload can strand native credits, and failed runs do not actually restart despite the log text.
- Correction: fresh Page session per serial run, bounded nonblocking ACK enqueue/accounting, abort on lost/ambiguous obligations, explicit failed-run recovery and ordered stop/drain. Never retry an ambiguous ACK. Confidence: high.

### W5 — Epoch/geometry fences permit stale input-trusted publications
- Evidence: `screencast.rs:175-181,54-59,575-640,460-463,674-753`.
- `update_geometry` ignores validation failure, changes metadata/epoch only, does not reconfigure capture or invalidate candidate/cache. Candidate records contain neither capture epoch nor run. Publication stamps the current epoch/run and always sets `input_trusted: true`, even when native geometry is invalid and local geometry is substituted. A pre-resize/pre-stop candidate can become a new-epoch/new-run frame. A nonempty old cache prevents resize/restart fallback; media never sends the valid cached frame on attach. Fallback layout metrics results are discarded rather than reconciled.
- Correction: serialize reconfiguration with demand/run transitions; fence candidates and publication by captured run/epoch, invalidate incompatible cache, reconcile checked metrics, and keep input untrusted until geometry is coherent. Send valid current cache on attach. Confidence: high.

### W6 — Cancellation and send-failure handling are incomplete
- Evidence: `media.rs:300-325,363-390`.
- A selected branch awaits `timeout(send)` without selecting cancellation, so auth cancellation waits behind up to five seconds of media writing. Pending-frame ACK/discard sends ignore both timeout and transport errors and keep the session alive.
- Correction: use a cancellation/deadline-aware send helper (existing gateway pattern), close on every failed/ambiguous send, preserve buffer accounting through teardown. Confidence: high.

### W7 — Pause/disconnect leaks attachment registrations and paired controls
- Evidence: `media.rs:256,420-424,484,565-567`; `attachments.rs:449-459`.
- Both handlers discard connection IDs and never unregister on exit or failed upgrade. Media pause only removes producer demand and exits; it does not cancel paired control or release lease/input. Fully connected pair entries do not expire in normal pair pruning.
- Impact: healthy authenticated sessions retain dead connection/pair records, old control sockets survive pause, and repeated fresh subscriptions accumulate state.
- Correction: connection-scoped cleanup guard including failed upgrades; unregister exact connection and revoke/release only its paired captured authority. Confidence: high.

### W8 — Client abuse and timeout policies are not enforced
- Evidence: `media.rs:189-195,272-275,305-309,351-410,499-502,535-545`.
- No 1 KiB media / bounded control WebSocket message limit; HTTP body limits do not bound post-upgrade messages. Media controls have no rate limiter and malformed JSON only logs. Control enforces 200 per fixed second, never the declared 100/s sustained limit. Outstanding timeout deletes entries and continues rather than reaping the stalled subscription, allowing further deliveries without disposition of old frames. These new routes also do not reserve the qualified global two-viewer capacity.
- Correction: upgrade-level frame/message limits, bounded parsers and abuse disconnects, actual sustained/burst governor, bounded active-viewer admission, timeout teardown rather than silent credit renewal. Confidence: high.

### W9 — Tests do not prove the named phase acceptance criteria
- Evidence: `browser_host_media.rs:57-185` tests controllers/Bytes only, no production sockets; `browser_host_bounds.rs:87-156` tests an unused wrapper and directly assigns counters. `browser_host_screencast.rs:121-150` changes only local geometry and checks that any cached frame exists; `:157-186` does not wait for heartbeat expiry; `:190-235` uses a static blank page without injecting burst/old-run/ACK-failure events.
- Missing: socket pair admission, blocked physical writer/auth cancellation, pause/rebind replay, cached attach, actual resized/final settled images, genuine expiry, two targets, shared production reservation exhaustion/last-writer lifetime, and 60-second bounded soak/PTy-control responsiveness.
- Correction: add behavioral tests at the actual transport/native boundaries. Keep phase incomplete until its explicit proof obligations are exercised. Confidence: high.

## Suggestions — medium priority

1. Wire diagnostics to real events. `diagnostics.rs:222-238` declares received/admitted/drop/ACK/start/stop counters that production does not update; `screencast.rs:662` increments delivered on publication, not per viewer delivery. Writer/ACK age and queue depths are absent; qualification recording has no production caller. Separate capture/publication/delivery and enforce opt-in bounded labels.
2. Add `rename_all_fields = "camelCase"` to `ServerControlEvent` (`protocol.rs:485`) before exposing it; current fields serialize as `dialog_id`, `input_available`, etc., unlike the contract and existing media DTO.
3. Simplify ownership instead of adding abstractions: keep one `Arc<ScreencastProducer>` with serialized run state, rather than manually reconstructing Arc-wrapped handles (`screencast.rs:774-797`). Share media/control ticket parsing and one correct send/teardown path. Remove unused constants/imports only after real behavior is connected.
4. Move unique-buffer decrement to a shared allocation owner's destructor. `diagnostics.rs:98-104` uses a racy `Arc::strong_count == 1` observation; concurrent final drops can leave the diagnostic count elevated.

## Reviewed files

Primary: `server/src/browser_host/{screencast,media,diagnostics,protocol,mod}.rs`; `server/src/api/{browser_host,router}.rs`; `server/tests/browser_host_{screencast,media,bounds}.rs`.

Supporting sections/call-site searches: `browser_host/{attachments,auth,cdp,cdp_gateway,input,session,manager,command_budget}.rs`; Phase 05 plan and architecture contracts; README, PDR, code standards; prior tester report. Approximately 2,300 primary lines plus supporting sections.

## Validation commands/results

- Executed for scope only: `git diff --stat && git status --short`; `git diff -- server/src/api/browser_host.rs server/src/api/router.rs server/src/browser_host/mod.rs server/src/browser_host/protocol.rs`. Result: four tracked modified files plus six new Phase 05 source/test files.
- No compile/test/lint/formatter run by reviewer: validation belongs to Main/designated tester; no duplicate verification workload started.
- Existing tester report `plans/reports/tester-261109-0721-phase-05-stream-bounded-jpeg.md:29-36` reports exits 0 for the three phase tests (3/4/3), gateway/admission/lifecycle (14/7/10), browser-host library tests (24), and UI E2E typecheck. This is attributed prior evidence, not reviewer-exercised verification. Passing helper tests do not establish missing production behavior above. Coverage percentage unavailable.

## Unresolved questions

- Current designated tester's raw terminal results are outside this review's observed evidence. No additional repository information is needed to act on the identified blockers.
