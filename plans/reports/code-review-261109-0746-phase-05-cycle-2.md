# Phase 05 — Cycle 2 code review

## Score: 4/10 — acceptance blocked

Static review of current Phase 05 implementation, Cycle 1 corrections, production callers, and tests. Loaded published `code-review/SKILL.md`. No production/test/plan edits; task tracking intentionally unchanged per assignment. Approximately 3,000 primary source/test lines plus supporting sections reviewed.

Improvements confirmed: tracked frame reservations now survive tracked clones; unique-buffer count uses shared-owner Drop; publication broadcast capacity is two; governor flush clears stale pending; live account verification and viewer permits exist; normal connection cleanup unregisters paired attachments; media send observes supervisor cancellation; control event fields serialize camelCase. These do not resolve the following end-to-end defects.

## Critical issues

### C1 — Production producer attaches to a nonexistent native target
- Evidence: `server/src/browser_host/media.rs:75-102,198` (producer construction is at 91-99); `screencast.rs:205-215`; `session.rs:313-340`; `server/src/api/browser_host.rs:324-364`.
- `ensure_producer_for_session` supplies logical `browserSessionId` as the native `target_id`. Registry creation generates a UUID and leaves `native_target_id = None`; production create never sends `Target.createTarget` or reconciles a native target. `Target.attachToTarget` therefore receives the wrong identity. Start failure is merely logged; create still returns 201 and media upgrade still succeeds, producing no usable stream.
- Correction: create/reconcile the real owned native target, persist its mapping, construct exactly one producer from that mapping, and return a typed failure when unavailable. Do not equate logical/native IDs. Confidence: high.

### C2 — The advertised global memory safety ceiling remains incomplete
- Evidence: `screencast.rs:553-555,614-621,671-681,753-759,787-796`; `diagnostics.rs:89-95`; reservation caller search across `server/src/browser_host/`.
- Both publication paths still pack/allocate BEFORE `try_reserve`, contrary to the Cycle 1 fix summary. Encoded candidate copies and base64 decoding allocate outside the controller; actor ingress, command budget and raw relays do not join this global reservation. Screenshot fallback has no pre-decode encoded-size check. Only complete published BHJF allocations are charged.
- `clone_data()` also exports an unrestricted `Bytes` clone without its reservation owner; the wrapper does not intrinsically guarantee the final physical buffer clone remains charged. Current writers rely on separate outstanding references rather than allocation-bound ownership.
- Correction: reserve every required payload category before allocation; attach charge lifetime to the actual shared allocation, including writer-owned Bytes. Add production exhaustion and retained-writer tests, not just wrapper tests. Confidence: high.

## Warnings — high priority

### W1 — Native ACK failure still strands run state; old-run recovery is unsafe
- Evidence: `screencast.rs:198-203,328-347,395-407,453-478,509-547`; `cdp.rs:371-380`.
- ACK failure only cancels the background token; state stays Streaming, so later demand cannot restart it. Lagged ingress is still ignored after losing ACK obligations. Oversize current-run events return without ACK or abort. Runs reuse the flattened Page session, so a delayed prior-run first event can establish the new run's native ID. Stop cancels draining before completing accepted ACK obligations. ACK handling awaits a complete command response, blocking event drain/governor/heartbeat processing.
- Correction: serialized run ownership, fresh flattened session, bounded prompt ACK enqueue, explicit failed-run transition/recovery, fatal loss handling, and ordered stop/drain. Never replay ambiguous ACKs. Confidence: high.

### W2 — Resize, cached attach and geometry trust are not wired end to end
- Evidence: `server/src/api/browser_host.rs:590-608`; `screencast.rs:180-195,553-559,608-668,716-750`; `media.rs:457-462`; caller search for `update_geometry`, `get_cached_frame`, `set_expected_viewport_epoch`.
- Production viewport updates only mutate registry DTOs: no producer geometry update, native viewport command/reconfiguration, or input-manager epoch update. Media never sends the valid cached frame on attach. Native candidates with invalid geometry fall back to local metadata yet publish `inputTrusted:true`. Epoch is captured after ACK await and reloaded after publication awaits, allowing stale capture to be relabeled; fallback metrics results are discarded. Scroll/DPR/scale changes can retain old-epoch cache headers.
- Correction: one authoritative serialized native/registry/producer/input epoch transition; reconcile capture geometry and fail input closed on uncertainty; deliver current valid cache explicitly. Confidence: high.

### W3 — Absolute expiry/cancellation is still blocked by selected work
- Evidence: `media.rs:468-495,503-528,629-643,778-800,848-885`.
- The absolute timer lives only in the outer select. A media write selected just before expiry can continue up to five seconds because the send helper watches supervisor cancellation, not the absolute deadline. Control dispatch awaits CDP responses inside its selected branch; neither cancellation nor expiry is observed until those calls finish. Initial status send and teardown release dispatch are unbounded by the connection deadline. Already-expired early returns skip unregister cleanup; media has already registered demand at that point.
- Correction: independent deadline-triggered cancellation shared by every operation, bounded ordered control writer/dispatcher, and unconditional connection cleanup guards including failed upgrades/early returns. Confidence: high.

### W4 — WebSocket abuse bounds are applied after allocation, and rate policy remains missing
- Evidence: `media.rs:427-440,543-548,752-764,829-845`; `router.rs:706-714`.
- Neither upgrade sets max_message_size/max_frame_size. Checking Text length after WebSocket assembly does not enforce the 1 KiB/16 KiB pre-allocation limits; binary traffic is ignored. HTTP body limits do not limit upgraded frames. Media has no rate limiter; control still permits 200 messages every second indefinitely. The sustained-100 constant has no caller.
- Correction: configure transport frame/message caps before upgrade, reject unsupported payloads, and apply a real sustained/burst limiter to both client-control paths. Confidence: high.

### W5 — Upgrade validates account, but not current target/process identity or full dev authority
- Evidence: `media.rs:271-301,343-424,685-749`; `attachments.rs:331-354`; `server/src/api/browser_host.rs:1015-1027`.
- Ticket incarnation/profile epoch are never compared to the current target/manager. Closed sessions can still pass get_session, and control upgrade does not check the session at all. The dev Origin helper accepts every syntactically simple Origin when no_auth is true; missing ConnectInfo also passes the upgrade peer check, and actual listener binding is not rechecked. Duplicate Origin headers are not rejected here, unlike canonical admission.
- Correction: reuse one canonical upgrade policy with exact Origin/header multiplicity, required dev peer/listener checks and live target status/incarnation/profile fences. The stored expected-Origin check helps only when a ticket was originally Origin-bound; it is not a replacement for upgrade policy. Confidence: high.

### W6 — Control teardown can revoke a different viewer's lease; pairing is not input authority
- Evidence: `media.rs:775-785,848-889`; `input.rs:199-203,409-434`; `attachments.rs:358-425`.
- Every control socket's exit calls the session-wide revoke_lease, regardless of which viewer owns the current lease. Thus disconnecting viewer B can release/revoke viewer A's active keys/lease, including a replacement subscription admitted before old cleanup. Input only checks socket subscription, not message session/incarnation/profile, lease-holder viewer, current epoch or media-pair readiness. Registration records pair flags but input never consults them. Status unconditionally announces inputAvailable=true.
- Correction: scope lease/input authority and teardown to the captured viewer/subscription/login/identity, recheck after awaits, require a live pair, and emit truthful status. Confidence: high.

### W7 — Native dispatch suppresses reliable-input failures and bypasses existing coordinate validation
- Evidence: `media.rs:855-866,892-974`; `input.rs:175-196,455-476`.
- All native send errors are discarded; the queue has already advanced sequence/held state. PointerCancel is a no-op. Coordinates are clamped rather than rejected through existing map_fraction_to_css_coords; y is additionally clamped to cssHeight, losing the qualified offsetTop range. Sequence-gap/overflow revocation returns release events internally but discards them, so the new native dispatcher can leave a pressed key/button stuck while held state is forgotten.
- Correction: reuse the checked mapping, implement cancellation/release semantics, propagate dispatch failures into input-unavailable/lease teardown, and dispatch releases from every revocation path. Confidence: high.

### W8 — Diagnostics are still mostly disconnected from production
- Evidence: `diagnostics.rs:233-248,273-290`; `screencast.rs:494-568,680,795`; `media.rs:162-164,189-191,227-234`; repository caller search.
- Production updates local producer ledger and a few global byte/ACK counters, but global received/admitted/drop/ACK-attempt/start/stop/delivered counters and qualification ring are not populated by real paths. Required writer/ACK ages and queue-depth metrics are absent. Global delivered remains zero even when frames are sent.
- Correction: wire counters at actual capture/admission/send/disposition boundaries; expose bounded queue/age/high-water evidence. Confidence: high.

### W9 — Passing tests do not establish the named acceptance criteria
- Evidence: `server/tests/browser_host_screencast.rs:50-80,131-170,175-205,208-254`; `browser_host_media.rs:59-221`; `browser_host_bounds.rs:54-155`.
- Screencast tests supply a correct native target directly, bypassing broken production construction. The heartbeat-expiry test explicitly removes demand after 500 ms; it never waits for 15-second expiry. Resize only mutates local geometry, not native dimensions. Burst uses static about:blank and does not inject old-run/ACK failure. Media tests use controllers, not production WebSockets; bounds tests use wrappers/manually assigned counters.
- Missing acceptance evidence: actual REST-create/ticket/pair/media/control journey, cached attach, real resize/final settled image, genuine heartbeat expiry/restart, ambiguous ACK recovery, blocked physical writer/deadline cancellation, pause/rebind old ACK replay, viewer-scoped lease teardown, two targets and 60-second shared-ceiling/PTy-control responsiveness soak.
- Correction: add boundary-level behavioral coverage and retain Phase 05 incomplete until those proof obligations are exercised. Confidence: high.

## Suggestions — architecture / KISS / DRY

1. Consolidate duplicated media/control upgrade policy and unconditional teardown; reuse canonical admission and coordinate validation instead of a second convention.
2. Let one Arc-owned producer serialize lifecycle rather than manually reconstructing handles containing many Arc fields (`screencast.rs:810-833`). Make registry construction atomic; stop/remove outside the global registry lock (`media.rs:68-72`).
3. Carry immutable parsed publication metadata beside the tracked buffer instead of repeatedly unpacking/validating complete BHJF headers per viewer and pending flush. Remove unused constants/imports only after real policies are wired.

## Reviewed files

Primary: `server/src/browser_host/{media,screencast,diagnostics,protocol,mod}.rs`; `server/src/api/{browser_host,router}.rs`; `server/tests/browser_host_{screencast,media,bounds}.rs`.

Supporting sections/searches: `server/src/browser_host/{attachments,auth,cdp,cdp_gateway,input,session,command_budget}.rs`; Phase 05 plan and architecture contracts; README, PDR, code standards, published workflows and code-review skill; prior Cycle 1 review and final tester report.

## Validation commands / results

- Reviewer executed scope command: `git diff --stat` — four tracked files, 51 inserted lines; new Phase 05 modules/tests separately inspected. `date +%y%m%d` — 261109. Source reads/caller searches grounded all findings.
- No build/test/lint/formatter run by reviewer: Main/designated tester owns validation; no duplicate workload started. No source-text assertions presented as runtime tests.
- Attributed existing evidence only: `plans/reports/tester-261109-0743-phase-05-final-verification.md:33-43` reports exit 0 for `cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture` (3), corresponding media (5) and bounds (3), gateway (14), admission (7), lifecycle (10), `--lib browser_host` (24), and `pnpm --filter @dam-hopper/ui test:e2e:typecheck` (one typecheck). Not independently rerun. Its broad heartbeat/resize assertions exceed the actual tested behavior noted in W9.
- Coverage percentage and lint issue count: not measured. No unimplemented!/todo!/TODO markers found in the three new modules/three phase tests; semantic incompleteness remains.

## Unresolved questions

- No missing repository information prevents acting on these findings. Main/designated tester must supply the still-unexercised production-socket, failure-injection and soak evidence before acceptance; current helper-test passes are insufficient.
