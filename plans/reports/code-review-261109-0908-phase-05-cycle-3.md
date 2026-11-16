# Phase 05 — Cycle 3 code review

## Score: 4/10 — acceptance blocked

Static review: security, correctness, performance, architecture, YAGNI/KISS/DRY and Phase 05 acceptance. Published `code-review/SKILL.md` and required workflows read. No source/test/plan changes; task tracking intentionally untouched per assignment. Approximately 3,200 primary implementation/test lines plus supporting sections inspected. Findings below have high source-evidence confidence; runtime reproductions were not executed by reviewer.

### Improvements confirmed

Real `Target.createTarget` identity now reaches the producer; pre-decode reservation exists; tracked-wrapper clones share an owner; ACK failure sets Stopped; cached attach and producer/input epoch calls exist; WebSocket transport message/frame caps are configured; unrelated viewer IDs no longer unconditionally revoke another viewer's lease; production capture counters are partly connected. These are partial corrections, not evidence that C1/C2/W1–W9 are fully resolved. In particular, PointerCancel remains an empty branch, and the absolute deadline remains in the outer select rather than an independent cancellation task.

## Critical issues

### C1 — Native targets escape logical lifecycle and capacity

- Evidence: `server/src/browser_host/media.rs:55-110`; `server/src/api/browser_host.rs:351-364,419-429`; `server/src/browser_host/screencast.rs:386-419`; `server/src/browser_host/session.rs:401-425`.
- Creation now opens a real tab, but deletion only stops screencasting: no `Target.closeTarget` is issued. The logical target count is decremented while the native tab remains alive. Repeated create/delete therefore bypasses the two-target bound and retains pages executing with the principal's browser credentials.
- `ensure_producer_for_session` also performs check/connect/create/insert non-atomically. Concurrent first attachment/retry can allocate different native targets/producers for one logical session; insertion replaces the registry entry without stopping the loser. The native ID is never saved to the logical session's mapping. Create failures are swallowed and still return 201.
- Correction: one atomic per-logical-target creation/ownership transaction, persist native correlation, commit only after successful reconciliation, close the exact native target before releasing capacity, clean failed/losing allocations. Return typed unavailable/pending failures rather than success.

### C2 — 128 MiB payload ceiling is still not a global allocation invariant

- Evidence: `screencast.rs:557-563,620-637,687-691,737-772,806-809`; `diagnostics.rs:44-52,78-105`; `cdp.rs:242-263,619-628`; `command_budget.rs:14-28,62-82`; reservation-caller search across `server/src`.
- Encoded candidates are copied before any global reservation. Actor ingress, raw relay and command payloads do not join the global controller. Publication reserves approximately base64 length plus header, but simultaneously retains decoded JPEG and a copied complete BHJF allocation, exceeding that reservation even before accounting for encoded storage. Screenshot response/base64 is also already allocated before reservation and lacks the producer's encoded-size precheck.
- `clone_data()` exports a naked `Bytes` clone without the reservation owner. Dropping all tracked wrappers can release the charge while that buffer remains alive. `MemoryReservation::adjust` can additionally grow without admission or high-water accounting.
- Correction: reserve each simultaneously live payload category before allocation, unify the global budget with existing bounded subsystem budgets, attach the reservation to the actual shared allocation exported to writers, and make growth fallible. Exercise exhaustion and retained physical-writer buffers, not only wrapper clones.

## Warnings

### W1 — Run/ACK recovery remains ambiguous and can stall permanently — High

- Evidence: `screencast.rs:198-224,328-347,395-407,453-478,510-550`; `cdp.rs:209-215,243-263,370-384`.
- Runs reuse the same flattened Page session; the first delayed prior-run event can establish the replacement run's native session ID. Lagged ingress and oversized current-run events lose ACK obligations without aborting. Stop cancels draining before ordered completion. ACK awaits the full command response, blocking drain/governor/heartbeat work.
- Setting Stopped on ACK failure is helpful but does not reconnect the failed actor or create a fresh Page session. Heartbeats do not restart a failed run. Actor death is not reliably observable through receiver closure because `CdpClient` retains its own broadcast sender.
- Correction: explicit actor-failure propagation, fresh session/run ownership, bounded prompt ACK enqueue, fatal handling of lost obligations, ordered stop/drain and bounded recovery without ambiguous ACK replay.

### W2 — Resize still does not resize Chromium; geometry epochs can diverge — High

- Evidence: `api/browser_host.rs:596-623`; `session.rs:547-557`; `screencast.rs:180-195,554-564,614-684,725-759`; `cdp_gateway.rs:1024-1041`.
- The new API call changes local producer geometry only; there is no native device-metrics command or screencast reconfiguration. Registry geometry uses clamped values while producer geometry uses raw request values and ignores failure. Example: width 5000 yields registry width 1920 and a new input epoch, but producer validation rejects the update and retains its old epoch.
- Candidate epoch is captured after ACK await and reloaded after later awaits; old captures can be relabeled. Invalid native geometry falls back to local values with `inputTrusted:true`. Scroll/DPR/scale changes may retain an old-epoch cached header, and input dispatch uses producer local geometry rather than the published native geometry. Screenshot metrics are collected but discarded. Native target correlation is missing for gateway-driven geometry fences.
- Correction: serialize one authoritative clamped native/registry/producer/input transition; publish immutable capture-epoch metadata; validate cached compatibility and fail input closed on uncertainty.

### W3 — Deadline/cancellation is still blocked inside selected work — High

- Evidence: `media.rs:468-495,499-528,647-660,798-820,875-905`.
- The absolute timer cannot interrupt an already-selected media send; that send can run five seconds past expiry. Cached attach happens before timer setup and ignores send failure. Control initial status and CDP dispatch/release awaits are outside deadline/cancellation races. Expired early returns skip demand/connection cleanup.
- Correction: independent deadline-triggered shared cancellation, deadline-aware bounded writes/dispatch and unconditional cleanup guards, including failed upgrades and early returns.

### W4 — Transport size caps are fixed, traffic abuse policy is not — High

- Evidence: `media.rs:44-47,551-635,848-891`.
- Media controls have no rate limiter. Control enforces 200 per one-second window indefinitely, not sustained 100/s with burst 200; the sustained constant is unused. Binary/unsupported messages are silently ignored. Foreign credit messages can also generate unbounded warning volume under an admitted flood.
- Correction: shared sustained/burst limiter on both paths, disconnect abusive/unsupported traffic, bounded rejection logging.

### W5 — Upgrade still omits live target identity and canonical dev authority — High

- Evidence: `media.rs:280-310,352-433,703-768`; `attachments.rs:331-354`; `api/browser_host.rs:1032-1039`; `session.rs:370-381`; `auth.rs:113-149,297-304`.
- Neither media nor control compares ticket incarnation/profile epoch with the current process/session. Closed sessions still pass `get_session`; control upgrade never checks the target at all. Cached producer lookup skips current lifecycle checks.
- The dev Origin helper explicitly accepts every superficially formatted Origin when `no_auth` is true; missing peer information is accepted, actual loopback listener binding is not checked, and duplicate Origin headers are not rejected. Live account verification does not cover these checks.
- Correction: reuse canonical exact-Origin/header-multiplicity and required peer/listener policy; fence closed/replaced target/process identities at upgrade and after awaits. Do not resurrect retired sessions.

### W6 — Input pairing/lease authority and replacement teardown remain incomplete — High

- Evidence: `media.rs:798-805,867-905`; `input.rs:271-273,279-311,414-439`; `attachments.rs:374-425,519-557`.
- Input checks subscription plus lease token but not captured viewer/login/session/incarnation/profile, pair readiness or trusted current geometry. Initial status always says input is available. A control-only attachment can dispatch input with a lease; missing-mate timeout is pruned only during another registration, not by a timer.
- The new viewer-ID guard fixes the simple A-versus-B disconnect case, but check-then-revoke is non-atomic. A new lease can be acquired between the two awaits; an old subscription for the same viewer also matches the replacement lease.
- Correction: atomic lease revocation by immutable subscription/login/lease generation; enforce live pair and full identity/geometry authority before each dispatch; emit truthful availability and actually time out unmatched pairs.

### W7 — PointerCancel is still a no-op; reliable release failures remain silent — High

- Evidence: `media.rs:914-1007`; `input.rs:451-480,484-505`; `api/browser_host.rs:750-753`.
- `InputEvent::PointerCancel => {}` remains unchanged despite the fix summary. Enqueue clears held buttons, but Chromium never receives releases. Sequence-gap/overflow revocations and REST lease release also discard generated release events. Native send errors are all ignored after sequence/held-state mutation, allowing stuck native keys/buttons with forgotten server state.
- Correction: dispatch captured release events for every cancellation/revocation path, propagate native failures to input-unavailable/lease shutdown, and reuse `map_fraction_to_css_coords` rather than four duplicated coordinate implementations.

### W8 — Required delivery/stop diagnostics remain disconnected — Medium

- Evidence: `diagnostics.rs:244-305`; `media.rs:157-201,647-660`; `screencast.rs:247,425,494-574`; production instrumentation caller search.
- Capture received/admitted/overwrite/ACK/decode counters are now wired, but global delivered/start/zero-demand-stop counters and qualification ring have no production updates. Required writer/ACK age and queue-depth diagnostics are absent. Fallback decoded/JPEG work is not included in the corresponding byte counters.
- Correction: instrument actual successful send, lifecycle and disposition boundaries; expose bounded ages/depths/high-water evidence. Do not substitute manually assigned test counters for production instrumentation.

### W9 — Passing tests still do not prove Phase 05 acceptance — High

- Evidence: `tests/browser_host_media.rs:224-296`; `tests/browser_host_screencast.rs:50-80,131-170,175-205,208-254`; `tests/browser_host_bounds.rs:86-155`; phase plan `:56-92,176-182`.
- The new “full journey” calls fresh local `AttachmentManager`/`SessionInputManager` objects directly; it never mounts REST handlers, upgrades sockets, constructs a production producer, sends JPEG/input, or runs real teardown. Its lease guard repeats the production condition instead of exercising it.
- Heartbeat-expiry test explicitly removes demand after 500 ms, never observing 15-second expiry. Resize tests only mutate local state. The burst test uses static about:blank; reported run observed one event. Bounds tests retain tracked wrappers only and set diagnostics counters manually.
- Still missing: production REST-create/ticket/pair/media/control journey, native resize/final image, real expiry/restart, old-run/ACK fault injection, blocked physical-writer expiry/cancellation, pause/rebind old-ACK replay, replacement lease teardown, two-target/60-second shared-ceiling soak and PTY/control responsiveness. Keep phase incomplete until these named obligations are observed.

## Suggestions — architecture / YAGNI / KISS / DRY

1. One lifecycle-owning producer/service should serialize create/start/stop/resize/delete and hold current native identity. Avoid separate mutable epoch authorities and duplicated media/control upgrade policy.
2. Accept `self: &Arc<Self>` for spawned producer work rather than manually reconstructing a struct with many shared fields (`screencast.rs:823-846`). Remove producer from the global map before awaiting native shutdown (`media.rs:68-72`) so one stalled target does not block all lookups.
3. Carry immutable parsed publication metadata beside shared bytes; do not repeatedly JSON-deserialize and revalidate a complete frame per viewer/flush. Reuse existing coordinate/admission helpers instead of second implementations. Avoid unused protocol variants/constants standing in for missing behavior.

## Reviewed files

Primary: `server/src/browser_host/{media,screencast,diagnostics,protocol,mod,input}.rs`; `server/src/api/{browser_host,router}.rs`; `server/tests/browser_host_{media,screencast,bounds}.rs`.

Supporting inspected sections/searches: `server/src/browser_host/{cdp,command_budget,attachments,auth,session,cdp_gateway}.rs`; `plans/261108-0237-host-browser-cdp-streaming/{phase-05-producer-fanout,architecture-contracts}.md`; Cycle 2 review; Cycle 3 tester report; README, PDR, code standards, system architecture and maintained host-browser architecture; published agent/workflow/code-review guidance.

Updated plans: none; no TODO tracking per assigned review constraints. No TODO/FIXME/unimplemented!/todo! marker found in the three new modules/three phase tests; behavioral incompleteness is documented above.

## Validation commands / results

Reviewer executed scope commands only:
- `git diff --stat`: five tracked files, 74 insertions, one deletion; new Phase 05 files are untracked and were reviewed separately.
- `git status --short`: identified new modules/tests and existing review/test reports.
- `git diff -- server/src/api/browser_host.rs server/src/api/router.rs server/src/browser_host/input.rs server/src/browser_host/mod.rs server/src/browser_host/protocol.rs`: inspected integration changes.
- `date +%y%m%d`: `261109`.
- Source reads/caller searches provide finding evidence; no build/test/lint/formatter run by reviewer. Main/designated tester owns validation; no duplicate workload launched.

Attributed evidence, not independently rerun: `plans/reports/tester-261109-0904-phase-05-cycle-3.md:33-43` reports exit 0 for:
- `cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture`: 3 passed.
- `cargo test --manifest-path server/Cargo.toml --test browser_host_media -- --nocapture`: 6 passed.
- `cargo test --manifest-path server/Cargo.toml --test browser_host_bounds -- --nocapture`: 3 passed.
- Corresponding `browser_host_gateway`, `browser_host_admission`, `browser_host_lifecycle` targets: 14, 7, 10 passed.
- `cargo test --manifest-path server/Cargo.toml --lib browser_host`: 24 passed.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: exit 0.

Total reported: 67 tests plus one typecheck. Its claims of actual heartbeat expiry/full production journey exceed the inspected test behavior. Coverage percentage, lint issue count and release build status: not measured by this review.

## Unresolved questions

No missing repository information blocks corrective action. Acceptance remains unresolved until Main/designated tester provides production-boundary, fault-injection and soak evidence listed in W9; current helper/unit passes are insufficient.
